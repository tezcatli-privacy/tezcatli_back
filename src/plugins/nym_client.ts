import { env } from '../config/env'

type NymRequestOptions = RequestInit & {
  timeoutMs?: number
}

/** alineado con presupuesto global de proveedores */
const defaultTimeoutMs = (): number => env.PROVIDER_TIMEOUT_MS

const withTimeout = async (
  input: string | URL,
  options: NymRequestOptions = {},
  fetchImpl: typeof fetch = fetch
): Promise<Response> => {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof (timer as ReturnType<typeof setTimeout>).unref === 'function') {
    ;(timer as ReturnType<typeof setTimeout> & { unref: () => void }).unref()
  }

  try {
    return await fetchImpl(input, {
      ...options,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * HTTP saliente unificado — (Nym + fallback)
 */
type NymMixFetchFn = (
  url: string,
  args: RequestInit,
  opts?: {
    clientId?: string
    preferredGateway?: string
    forceTls?: boolean
    mixFetchOverride?: {
      requestTimeoutMs?: number
    }
  }
) => Promise<Response>

let cachedMixFetch: NymMixFetchFn | null = null

const getMixFetch = async (): Promise<NymMixFetchFn | null> => {
  if (cachedMixFetch) {
    return cachedMixFetch
  }

  try {
    const { mixFetch } = await import('@nymproject/mix-fetch-full-fat')
    cachedMixFetch = mixFetch as NymMixFetchFn
    return cachedMixFetch
  } catch {
    return null
  }
}

const toUrlString = (url: string | URL): string =>
  typeof url === 'string' ? url : url.toString()

export const nymFetch = async (
  url: string | URL,
  options: NymRequestOptions = {}
): Promise<Response> => {
  if (!env.NYM_ENABLED) {
    return withTimeout(url, options)
  }

  const mixFetch = await getMixFetch()
  if (!mixFetch) {
    return withTimeout(url, options)
  }

  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs()
  const { timeoutMs: _timeoutMs, ...requestInit } = options

  try {
    return await withTimeout(
      toUrlString(url),
      requestInit,
      (_input, init) =>
        mixFetch(toUrlString(url), init ?? {}, {
          clientId: env.NYM_CLIENT_ID,
          preferredGateway: env.NYM_PREFERRED_GATEWAY,
          forceTls: env.NYM_FORCE_TLS,
          mixFetchOverride: {
            requestTimeoutMs: timeoutMs,
          },
        })
    )
  } catch {
    return withTimeout(url, options)
  }
}
