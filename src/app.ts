import 'dotenv/config'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
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
import { loadScanSession } from './services/scan_session_store'
import {
  createScanSession,
  createScanSessionId,
  walletRefFromAddress,
} from './services/scan_session'

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

const scanStatusResponseSchema = z.object({
  scanSessionId: z.string(),
  walletRef: z.string(),
  createdAt: z.string(),
  status: z.enum(['pending', 'running', 'completed', 'partial', 'failed']),
  progress: z.number(),
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
      zerionTotalUsd: z.number().optional(),
      privacyScore: z.number().optional(),
      privacyBand: z.string().optional(),
      privacyConfidence: z.number().optional(),
    })
    .optional(),
  /** Report Composer (opcional al cliente). */
  report: z.unknown().optional(),
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
            report: z.unknown().optional(),
          }),
          503: z.object({ error: z.literal('redis_unavailable') }),
        },
      },
    },
    async (_request, reply) => {
      const redis = getRedis(fastify)
      if (env.SCAN_REQUIRE_REDIS && !redis) {
        return reply.code(503).send({ error: 'redis_unavailable' })
      }

      const walletRef = walletRefFromAddress(_request.body.wallet)
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
        _request.body.wallet,
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
        },
      }
    }
  )
}

const start = async () => {
  try {
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
