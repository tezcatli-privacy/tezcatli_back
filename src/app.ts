import 'dotenv/config'
import Fastify from 'fastify'
import { z } from 'zod'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { env } from './config/env'
import { runScanOrchestrator } from './services/scan_orchestrator'

const fastify = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>()

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

const scanRequestBodySchema = z.object({
  wallet: z
    .string()
    .min(3)
    .transform((value) => value.trim()),
})

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
              stage: z.enum(['identity', 'financial', 'exchange', 'score']),
              status: z.enum(['completed', 'partial', 'failed', 'skipped']),
              progress: z.number(),
              error: z.string().optional(),
            })
          ),
          data: z.object({
            arkham: z.unknown().optional(),
            zerion: z.unknown().optional(),
            neynar: z.unknown().optional(),
          }),
        }),
      },
    },
  },
  async (request, reply) => {
    const result = await runScanOrchestrator(request.body.wallet)
    return reply.code(200).send(result)
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
        arkham: Boolean(env.ARKHAM_API_KEY),
        zerion: Boolean(env.ZERION_API_KEY),
        neynar: Boolean(env.NEYNAR_API_KEY),
      },
    }
  }
)

const start = async () => {
  try {
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
