import { env } from '../config/env'

type NymRequestOptions = RequestInit & {
  timeoutMs?: number
}

/** alineado con presupuesto global de proveedores */
const defaultTimeoutMs = (): number => env.PROVIDER_TIMEOUT_MS
const retryAttempts = (): number => Math.max(1, env.NYM_RETRY_ATTEMPTS)
const retryBaseMs = (): number => env.NYM_RETRY_BASE_MS
const retryJitterMs = (): number => env.NYM_RETRY_JITTER_MS

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

const isTransientError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound')
  )
}

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    if (typeof (timer as ReturnType<typeof setTimeout>).unref === 'function') {
      ;(timer as ReturnType<typeof setTimeout> & { unref: () => void }).unref()
    }
  })

const backoffMs = (attempt: number): number => {
  const exp = retryBaseMs() * 2 ** Math.max(0, attempt - 1)
  const jitter = Math.floor(Math.random() * (retryJitterMs() + 1))
  return exp + jitter
}

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

const shouldRetryResponse = (response: Response): boolean =>
  TRANSIENT_HTTP_STATUS.has(response.status)

const withRetry = async (
  execute: () => Promise<Response>
): Promise<Response> => {
  const attempts = retryAttempts()
  let lastErr: unknown = null

  for (let i = 1; i <= attempts; i++) {
    try {
      const response = await execute()
      if (!shouldRetryResponse(response) || i === attempts) {
        return response
      }
      await wait(backoffMs(i))
      continue
    } catch (err) {
      lastErr = err
      if (!isTransientError(err) || i === attempts) {
        throw err
      }
      await wait(backoffMs(i))
    }
  }

  if (lastErr) {
    throw lastErr
  }
  throw new Error('nymFetch: retry failed without explicit error')
}

export const nymFetch = async (
  url: string | URL,
  options: NymRequestOptions = {}
): Promise<Response> => {
  if (!env.NYM_ENABLED) {
    return withRetry(() => withTimeout(url, options))
  }

  const mixFetch = await getMixFetch()
  if (!mixFetch) {
    if (!env.NYM_ALLOW_DIRECT_FALLBACK) {
      throw new Error('nym_unavailable')
    }
    return withRetry(() => withTimeout(url, options))
  }

  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs()
  const { timeoutMs: _timeoutMs, ...requestInit } = options

  try {
    return await withRetry(() =>
      withTimeout(
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
    )
  } catch {
    if (!env.NYM_ALLOW_DIRECT_FALLBACK) {
      throw new Error('nym_request_failed')
    }
    return withRetry(() => withTimeout(url, options))
  }
}
