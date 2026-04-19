import { z } from 'zod'

/** dotenv deja `KEY=` como `""`; URLs opcionales deben contarse como ausentes */
const emptyToUndefined = (v: unknown): unknown => (v === '' ? undefined : v)

const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional())
const optionalCsv = z.preprocess(
  emptyToUndefined,
  z.string().optional().transform((value) =>
    value
      ?.split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)
  )
)

const envBoolean = (defaultValue: boolean) =>
  z.preprocess(
    (v) => {
      if (v === undefined) return undefined
      if (typeof v === 'boolean') return v
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase()
        if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true
        if (['false', '0', 'no', 'n', 'off'].includes(s)) return false
      }
      return v
    },
    z.boolean().default(defaultValue)
  )

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: optionalCsv,
  REDIS_URL: optionalUrl,
  /** TTL de sesión de scan — por defecto 30 min */
  SCAN_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  /**
   * Timeout por proveedor en el orquestador (capa `promiseWithTimeout`).
   * Los conectores usan un valor ligeramente menor vía `connectorFetchTimeoutMs`.
   */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  /** Si true, POST /api/scan exige Redis y sesión persistente */
  SCAN_REQUIRE_REDIS: envBoolean(true),
  /**
   * Salidas HTTP vía Nym mix-fetch cuando está habilitado y el paquete
   * carga correctamente; si no, fallback a `fetch` con el mismo presupuesto de tiempo.
   */
  NYM_ENABLED: envBoolean(false),
  NYM_BASE_URL: optionalUrl,
  NYM_CLIENT_ID: z.string().default('tezcatli-backend'),
  NYM_PREFERRED_GATEWAY: z.preprocess(
    emptyToUndefined,
    z.string().optional()
  ),
  NYM_FORCE_TLS: envBoolean(true),
  /** Retries/jitter en capa Nym */
  NYM_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(6).default(3),
  NYM_RETRY_BASE_MS: z.coerce.number().int().min(50).default(250),
  NYM_RETRY_JITTER_MS: z.coerce.number().int().min(0).default(150),
  /** Si false, cuando Nym falla no se hace fallback a fetch directo. */
  NYM_ALLOW_DIRECT_FALLBACK: envBoolean(true),
  /** Ruido k-anonymity */
  NOISE_ENABLED: envBoolean(false),
  NOISE_DECOYS_MIN: z.coerce.number().int().min(0).max(10).default(2),
  NOISE_DECOYS_MAX: z.coerce.number().int().min(0).max(10).default(4),
  NOISE_MAX_DECOYS_PER_PROVIDER: z.coerce.number().int().min(0).max(10).default(4),
  /** ENS resolution vía viem */
  ETH_RPC_URL: optionalUrl,
  /** Recovery token TTL (3 días) */
  RECOVERY_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(259200),
  /** Intel API (véase intel.arkm.com); path típico incluye `/all` multichain */
  ARKHAM_API_BASE_URL: z.string().url().default('https://api.arkm.com'),
  ARKHAM_API_KEY: z.string().optional(),
  ARKHAM_INTELLIGENCE_PATH_TEMPLATE: z
    .string()
    .default('/intelligence/address/{address}/all'),
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
  WAVY_API_BASE_URL: z.string().url().default('https://api.wavynode.com'),
  WAVY_API_KEY: z.string().optional(),
  WAVY_PROJECT_ID: z.coerce.number().int().positive().optional(),
  WAVY_CHAIN_ID: z.coerce.number().int().positive().default(421614),
})

export type AppEnv = z.infer<typeof envSchema>

export const env: AppEnv = envSchema.parse(process.env)
