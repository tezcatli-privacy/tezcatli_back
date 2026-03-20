import { env } from '../../config/env'

/**
 * Mismo presupuesto que `PROVIDER_TIMEOUT_MS` del orquestador.
 * El abort de HTTP termina un poco antes que el `promiseWithTimeout` externo
 * para favorecer errores claros de red sobre la carrera al límite.
 */
export const connectorFetchTimeoutMs = (): number =>
  Math.max(1_000, env.PROVIDER_TIMEOUT_MS - 500)
