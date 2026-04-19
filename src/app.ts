import 'dotenv/config'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyRedis from '@fastify/redis'
import type { Redis } from 'ioredis'
import { createConnectedRedis } from './utils/redis_connect'
import { z } from 'zod'
import {
  ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import { env } from './config/env'
import { runScanOrchestrator } from './services/scan_orchestrator'
import { loadScanSession, saveScanSession } from './services/scan_session_store'
import {
  createRecoveryToken,
  resolveRecoveryToken,
} from './services/recovery_token_store'
import {
  trackRemediationEvent,
  type RemediationEvent,
} from './services/remediation_tracking'
import {
  createScanSession,
  createScanSessionId,
  walletRefFromAddress,
} from './services/scan_session'
import { resolveWalletInput, WalletInputError } from './services/wallet_input'
import {
  alphaSupportedAssets,
  createMockWavyRiskScan,
  deriveAlphaRiskAssessment,
  nextActionsForRisk,
} from './services/alpha_policy'

/** Logs legibles en dev: colores por nivel, hora y objetos bien separados ([pino-pretty](https://github.com/pinojs/pino-pretty)) */
const devLoggerOptions = {
  level: 'debug' as const,
  // Issue 2.3 — evitar exposición accidental de PII/secrets en logs.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.wallet',
      'req.body.address',
      '*.apiKey',
      '*.api_key',
      '*.token',
      '*.secret',
      '*.password',
    ],
    remove: true,
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      colorizeObjects: true,
      levelFirst: true,
      translateTime: 'SYS:HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: false,
      errorLikeObjectKeys: ['err', 'error'],
      errorProps: 'type,message,stack,code,statusCode',
    },
  },
}

const fastify = Fastify({
  logger:
    env.NODE_ENV === 'development'
      ? devLoggerOptions
      : {
          level: 'info',
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.wallet',
              'req.body.address',
              '*.apiKey',
              '*.api_key',
              '*.token',
              '*.secret',
              '*.password',
            ],
            remove: true,
          },
        },
}).withTypeProvider<ZodTypeProvider>()

fastify.setValidatorCompiler(validatorCompiler)
fastify.setSerializerCompiler(serializerCompiler)

const allowedOrigins =
  env.CORS_ORIGINS && env.CORS_ORIGINS.length > 0
    ? env.CORS_ORIGINS
    : ['http://localhost:3000', 'http://127.0.0.1:3000']

const getRedis = (instance: FastifyInstance): Redis | undefined =>
  'redis' in instance
    ? (instance as FastifyInstance & { redis: Redis }).redis
    : undefined

const scanRequestBodySchema = z.object({
  wallet: z
    .string()
    .min(3)
    .transform((value) => value.trim()),
})

const scanStatusParamsSchema = z.object({
  scanSessionId: z.string().uuid(),
})

const scanReportParamsSchema = z.object({
  scanSessionId: z.string().uuid(),
})

const scanRecoveryParamsSchema = z.object({
  scanSessionId: z.string().uuid(),
})

const recoveryTokenParamsSchema = z.object({
  token: z.string().min(32),
})

const remediationBodySchema = z.object({
  event: z.enum(['report_to_cta_click', 'cta_to_stage2_start']),
  scanSessionId: z.string().uuid().optional(),
})

const migrationEligibilityBodySchema = z.object({
  wallet: z
    .string()
    .min(3)
    .transform((value) => value.trim()),
  scanSessionId: z.string().uuid().optional(),
})

const scanStatusResponseSchema = z.object({
  scanSessionId: z.string(),
  walletRef: z.string(),
  createdAt: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'partial', 'failed']),
  progress: z.number(),
  currentStage: z.string().optional(),
  stages: z.array(
    z.object({
      stage: z.string(),
      status: z.string(),
      progress: z.number(),
      error: z.string().optional(),
    })
  ),
  updatedAt: z.string(),
  summary: z
    .object({
      arkhamOk: z.boolean(),
      zerionOk: z.boolean(),
      neynarOk: z.boolean(),
      wavyOk: z.boolean().optional(),
      zerionTotalUsd: z.number().optional(),
      privacyScore: z.number().optional(),
      privacyBand: z.string().optional(),
      privacyConfidence: z.number().optional(),
      riskScore: z.number().optional(),
      riskLevel: z.string().optional(),
      migrationEligible: z.boolean().optional(),
    })
    .optional(),
  /** Report Composer (opcional al cliente). */
  report: z.unknown().optional(),
  supportedAssets: z
    .array(
      z.object({
        symbol: z.enum(['USDC', 'USDT', 'WBTC', 'WETH']),
        displaySymbol: z.enum(['USDC', 'USDT', 'WBTC', 'ETH']),
        name: z.string(),
        kind: z.enum(['erc20', 'wrapped_native']),
        migrationRoute: z.enum(['direct', 'wrap_then_migrate']),
        description: z.string(),
      })
    )
    .optional(),
  nextActions: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        intent: z.string(),
        enabled: z.boolean(),
      })
    )
    .optional(),
})

const scanReportResponseSchema = z.object({
  scanSessionId: z.string(),
  status: z.enum(['completed', 'partial']),
  report: z.unknown(),
})

const migrationEligibilityResponseSchema = z.object({
  wallet: z.string(),
  registration: z.object({
    provider: z.literal('wavy'),
    status: z.enum(['simulated']).optional(),
    error: z.string().optional(),
  }),
  risk: z.object({
    available: z.boolean(),
    provider: z.literal('wavy'),
    chainId: z.number(),
    score: z.number().optional(),
    level: z.string(),
    suspiciousActivity: z.boolean(),
    migrationEligible: z.boolean(),
    reviewRecommended: z.boolean(),
    policyBand: z.enum(['eligible', 'review', 'blocked']),
    reason: z.string(),
    riskReason: z.string().optional(),
    failureReason: z.string().optional(),
    analysisId: z.string().optional(),
    patternsDetected: z.array(z.string()),
    transactionsAnalyzed: z.number().optional(),
    completedAt: z.string().optional(),
  }),
  supportedAssets: z.array(
    z.object({
      symbol: z.enum(['USDC', 'USDT', 'WBTC', 'WETH']),
      displaySymbol: z.enum(['USDC', 'USDT', 'WBTC', 'ETH']),
      name: z.string(),
      kind: z.enum(['erc20', 'wrapped_native']),
      migrationRoute: z.enum(['direct', 'wrap_then_migrate']),
      description: z.string(),
    })
  ),
  nextActions: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      intent: z.string(),
      enabled: z.boolean(),
    })
  ),
})

const registerRoutes = (): void => {
  fastify.get(
    '/',
    {
      schema: {
        response: {
          200: z.object({
            hello: z.string(),
          }),
        },
      },
    },
    async () => {
      return { hello: 'world' }
    }
  )

  fastify.post(
    '/api/scan',
    {
      schema: {
        body: scanRequestBodySchema,
        response: {
          200: z.object({
            scanSessionId: z.string(),
            status: z.enum(['completed', 'partial']),
            progress: z.number(),
            currentStage: z.string().optional(),
            stages: z.array(
              z.object({
                stage: z.enum([
                  'identity',
                  'financial',
                  'exchange',
                  'score',
                ]),
                status: z.enum([
                  'completed',
                  'partial',
                  'failed',
                  'skipped',
                ]),
                progress: z.number(),
                error: z.string().optional(),
              })
            ),
            data: z.object({
              arkham: z.unknown().optional(),
              zerion: z.unknown().optional(),
              neynar: z.unknown().optional(),
            }),
            privacy: z.object({
              score: z.number(),
              band: z.enum(['Low', 'Moderate', 'High', 'Critical']),
              confidence: z.number(),
            }),
            supportedAssets: z.array(
              z.object({
                symbol: z.enum(['USDC', 'USDT', 'WBTC', 'WETH']),
                displaySymbol: z.enum(['USDC', 'USDT', 'WBTC', 'ETH']),
                name: z.string(),
                kind: z.enum(['erc20', 'wrapped_native']),
                migrationRoute: z.enum(['direct', 'wrap_then_migrate']),
                description: z.string(),
              })
            ),
            nextActions: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                intent: z.string(),
                enabled: z.boolean(),
              })
            ),
            report: z.unknown().optional(),
          }),
          400: z.object({ error: z.literal('invalid_wallet_or_ens') }),
          503: z.object({ error: z.literal('redis_unavailable') }),
        },
      },
    },
    async (_request, reply) => {
      const redis = getRedis(fastify)
      if (env.SCAN_REQUIRE_REDIS && !redis) {
        return reply.code(503).send({ error: 'redis_unavailable' })
      }

      let resolvedAddress: string
      try {
        const resolved = await resolveWalletInput(_request.body.wallet)
        resolvedAddress = resolved.address
      } catch (err) {
        if (err instanceof WalletInputError) {
          return reply.code(400).send({ error: 'invalid_wallet_or_ens' })
        }
        throw err
      }

      const walletRef = walletRefFromAddress(resolvedAddress)
      const scanSessionId = createScanSessionId()
      const createdAtInit = new Date().toISOString()

      let createdAt = createdAtInit
      if (redis) {
        const s = await createScanSession(
          redis,
          scanSessionId,
          walletRef,
          env.SCAN_SESSION_TTL_SECONDS
        )
        createdAt = s.createdAt
      }

      const result = await runScanOrchestrator(
        resolvedAddress,
        { scanSessionId, walletRef, createdAt },
        {
          redis,
          sessionTtlSeconds: env.SCAN_SESSION_TTL_SECONDS,
          providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
        }
      )
      return reply.code(200).send(result)
    }
  )

  fastify.post(
    '/api/migration/eligibility',
    {
      schema: {
        body: migrationEligibilityBodySchema,
        response: {
          200: migrationEligibilityResponseSchema,
          400: z.object({ error: z.literal('invalid_wallet_or_ens') }),
        },
      },
    },
    async (request, reply) => {
      let resolvedAddress: string
      try {
        const resolved = await resolveWalletInput(request.body.wallet)
        resolvedAddress = resolved.address
      } catch (err) {
        if (err instanceof WalletInputError) {
          return reply.code(400).send({ error: 'invalid_wallet_or_ens' })
        }
        throw err
      }

      let registration:
        | { provider: 'wavy'; status?: 'simulated'; error?: string }
        = { provider: 'wavy' }
      const simulatedWavyScan = createMockWavyRiskScan(
        resolvedAddress,
        env.WAVY_CHAIN_ID
      )
      registration = {
        provider: 'wavy',
        status: 'simulated',
      }
      const risk = deriveAlphaRiskAssessment(simulatedWavyScan)

      const nextActions = nextActionsForRisk(risk)
      const supportedAssets = alphaSupportedAssets

      const redis = getRedis(fastify)
      if (redis && request.body.scanSessionId) {
        const session = await loadScanSession(redis, request.body.scanSessionId)
        if (session) {
          await saveScanSession(
            redis,
            request.body.scanSessionId,
            {
              ...session,
              risk,
              supportedAssets,
              nextActions,
              summary: {
                arkhamOk: session.summary?.arkhamOk ?? false,
                zerionOk: session.summary?.zerionOk ?? false,
                neynarOk: session.summary?.neynarOk ?? false,
                wavyOk: risk.available,
                zerionTotalUsd: session.summary?.zerionTotalUsd,
                privacyScore: session.summary?.privacyScore,
                privacyBand: session.summary?.privacyBand,
                privacyConfidence: session.summary?.privacyConfidence,
                riskScore: risk.score,
                riskLevel: risk.level,
                migrationEligible: risk.migrationEligible,
              },
            },
            env.SCAN_SESSION_TTL_SECONDS
          )
        }
      }

      return reply.send({
        wallet: resolvedAddress,
        registration,
        risk,
        supportedAssets,
        nextActions,
      })
    }
  )

  fastify.get(
    '/api/scan/:scanSessionId/status',
    {
      schema: {
        params: scanStatusParamsSchema,
        response: {
          200: scanStatusResponseSchema,
          404: z.object({ error: z.literal('not_found') }),
          503: z.object({ error: z.literal('redis_unavailable') }),
        },
      },
    },
    async (request, reply) => {
      const redis = getRedis(fastify)
      if (!redis) {
        return reply.code(503).send({ error: 'redis_unavailable' })
      }
      const session = await loadScanSession(redis, request.params.scanSessionId)
      if (!session) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.send(session)
    }
  )

  fastify.get(
    '/api/scan/:scanSessionId/report',
    {
      schema: {
        params: scanReportParamsSchema,
        response: {
          200: scanReportResponseSchema,
          404: z.object({ error: z.literal('not_found') }),
          409: z.object({ error: z.literal('not_ready') }),
          503: z.object({ error: z.literal('redis_unavailable') }),
        },
      },
    },
    async (request, reply) => {
      const redis = getRedis(fastify)
      if (!redis) {
        return reply.code(503).send({ error: 'redis_unavailable' })
      }
      const session = await loadScanSession(redis, request.params.scanSessionId)
      if (!session) {
        return reply.code(404).send({ error: 'not_found' })
      }
      if (!session.report || (session.status !== 'completed' && session.status !== 'partial')) {
        return reply.code(409).send({ error: 'not_ready' })
      }
      return reply.send({
        scanSessionId: session.scanSessionId,
        status: session.status,
        report: session.report,
      })
    }
  )

  fastify.post(
    '/api/cta/remediation',
    {
      schema: {
        body: remediationBodySchema,
        response: {
          200: z.object({ ok: z.boolean() }),
          503: z.object({ error: z.literal('redis_unavailable') }),
        },
      },
    },
    async (request, reply) => {
      const redis = getRedis(fastify)
      if (!redis) {
        return reply.code(503).send({ error: 'redis_unavailable' })
      }
      await trackRemediationEvent(redis, request.body.event as RemediationEvent)
      return reply.send({ ok: true })
    }
  )

  fastify.post(
    '/api/scan/:scanSessionId/recovery-token',
    {
      schema: {
        params: scanRecoveryParamsSchema,
        response: {
          200: z.object({
            recoveryToken: z.string(),
            expiresInSeconds: z.number(),
          }),
          404: z.object({ error: z.literal('not_found') }),
          503: z.object({ error: z.literal('redis_unavailable') }),
        },
      },
    },
    async (request, reply) => {
      const redis = getRedis(fastify)
      if (!redis) {
        return reply.code(503).send({ error: 'redis_unavailable' })
      }
      const session = await loadScanSession(redis, request.params.scanSessionId)
      if (!session) {
        return reply.code(404).send({ error: 'not_found' })
      }
      const token = await createRecoveryToken(
        redis,
        request.params.scanSessionId,
        env.RECOVERY_TOKEN_TTL_SECONDS
      )
      return reply.send({
        recoveryToken: token.token,
        expiresInSeconds: token.expiresInSeconds,
      })
    }
  )

  fastify.get(
    '/api/recovery/:token/status',
    {
      schema: {
        params: recoveryTokenParamsSchema,
        response: {
          200: scanStatusResponseSchema,
          404: z.object({ error: z.literal('not_found') }),
          503: z.object({ error: z.literal('redis_unavailable') }),
        },
      },
    },
    async (request, reply) => {
      const redis = getRedis(fastify)
      if (!redis) {
        return reply.code(503).send({ error: 'redis_unavailable' })
      }
      const scanSessionId = await resolveRecoveryToken(redis, request.params.token)
      if (!scanSessionId) {
        return reply.code(404).send({ error: 'not_found' })
      }
      const session = await loadScanSession(redis, scanSessionId)
      if (!session) {
        return reply.code(404).send({ error: 'not_found' })
      }
      return reply.send(session)
    }
  )

  fastify.get(
    '/health',
    {
      schema: {
        response: {
          200: z.object({
            ok: z.boolean(),
            services: z.object({
              redis: z.boolean(),
              /** Issue 1.3 — Nym mix-fetch habilitado a nivel configuración */
              nym: z.boolean(),
              arkham: z.boolean(),
              zerion: z.boolean(),
              neynar: z.boolean(),
              wavy: z.boolean(),
            }),
          }),
        },
      },
    },
    async () => {
      return {
        ok: true,
        services: {
          redis: Boolean(env.REDIS_URL),
          nym: env.NYM_ENABLED,
          arkham: Boolean(env.ARKHAM_API_KEY),
          zerion: Boolean(env.ZERION_API_KEY),
          neynar: Boolean(env.NEYNAR_API_KEY),
          wavy: Boolean(env.WAVY_API_KEY && env.WAVY_PROJECT_ID),
        },
      }
    }
  )
}

const start = async () => {
  try {
    await fastify.register(fastifyCors, {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true)
          return
        }
        callback(new Error('Origin not allowed by CORS'), false)
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['content-type'],
      credentials: false,
    })

    if (env.REDIS_URL) {
      const redis = await createConnectedRedis(env.REDIS_URL)
      await fastify.register(fastifyRedis, {
        client: redis,
        closeClient: true,
      })
    }

    registerRoutes()
    await fastify.ready()
    await fastify.listen({ port: env.PORT, host: env.HOST })
  } catch (err) {
    fastify.log.error(err)
    try {
      await fastify.close()
    } catch {
      // best-effort
    }
  }
}

const shutdown = async (signal: string) => {
  fastify.log.info({ signal }, 'Shutting down')
  try {
    await fastify.close()
  } catch (err) {
    fastify.log.error({ err }, 'Error during shutdown')
  } finally {
    process.exit(0)
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

start()
