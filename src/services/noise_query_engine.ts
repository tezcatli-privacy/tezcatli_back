import crypto from 'node:crypto'
import { env } from '../config/env'

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

const randomIntInclusive = (min: number, max: number): number => {
  if (max <= min) return min
  return min + Math.floor(Math.random() * (max - min + 1))
}

const randomWalletAddress = (): string => `0x${crypto.randomBytes(20).toString('hex')}`

const shuffle = <T>(arr: T[]): T[] => {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const isTransientError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('timeout') ||
    msg.includes('abort') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('econnrefused') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('500')
  )
}

const shouldSwallowDecoyError = (err: unknown): boolean => {
  if (!(err instanceof Error)) return true
  const m = err.message
  const status = Number(m.split(':').pop()?.trim())
  if (Number.isFinite(status) && TRANSIENT_HTTP_STATUS.has(status)) return true
  return isTransientError(err)
}

const decoysCount = (): number => {
  const min = Math.max(0, env.NOISE_DECOYS_MIN)
  const max = Math.max(min, env.NOISE_DECOYS_MAX)
  const n = randomIntInclusive(min, max)
  return Math.min(n, env.NOISE_MAX_DECOYS_PER_PROVIDER)
}

/**
 * ejecuta consulta real + señuelos (k-anonymity) con orden aleatorio.
 * Las respuestas señuelo se descartan y nunca alimentan el score/report.
 */
export const withNoiseQueries = async <T>(input: {
  realAddress: string
  query: (address: string) => Promise<T>
}): Promise<T> => {
  if (!env.NOISE_ENABLED) {
    return input.query(input.realAddress)
  }

  const totalDecoys = decoysCount()
  if (totalDecoys === 0) {
    return input.query(input.realAddress)
  }

  const jobs = [
    { kind: 'real' as const, address: input.realAddress },
    ...Array.from({ length: totalDecoys }).map(() => ({
      kind: 'decoy' as const,
      address: randomWalletAddress(),
    })),
  ]

  const shuffled = shuffle(jobs)
  let realPromise: Promise<T> | null = null

  for (const job of shuffled) {
    if (job.kind === 'real') {
      realPromise = input.query(job.address)
      continue
    }
    // Fire-and-forget: genera patrón de tráfico sin frenar la respuesta al usuario.
    void input.query(job.address).catch((err: unknown) => {
      if (!shouldSwallowDecoyError(err)) {
        // Evitar throws no manejados sin exponer datos sensibles.
        return
      }
    })
  }

  if (!realPromise) {
    realPromise = input.query(input.realAddress)
  }

  return realPromise
}

