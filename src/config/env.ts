import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().url().optional(),
  NYM_ENABLED: z.coerce.boolean().default(false),
  NYM_BASE_URL: z.string().url().optional(),
  NYM_CLIENT_ID: z.string().default('tezcatli-backend'),
  NYM_PREFERRED_GATEWAY: z.string().optional(),
  NYM_FORCE_TLS: z.coerce.boolean().default(true),
  ARKHAM_API_BASE_URL: z.string().url().default('https://api.arkm.com'),
  ARKHAM_API_KEY: z.string().optional(),
  ZERION_API_BASE_URL: z.string().url().default('https://api.zerion.io/v1'),
  ZERION_API_KEY: z.string().optional(),
  ZERION_PORTFOLIO_PATH_TEMPLATE: z
    .string()
    .default('/wallets/{address}/portfolio'),
  NEYNAR_API_BASE_URL: z.string().url().default('https://api.neynar.com'),
  NEYNAR_API_KEY: z.string().optional(),
  NEYNAR_LOOKUP_PATH_TEMPLATE: z
    .string()
    .default('/v2/farcaster/user/bulk-by-address/?addresses={address}'),
})

export type AppEnv = z.infer<typeof envSchema>

export const env: AppEnv = envSchema.parse(process.env)
