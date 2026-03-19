import crypto from 'node:crypto'
import type { Redis } from 'ioredis'
import {
  saveScanSession,
  type ScanSessionRedisPayload,
} from './scan_session_store'

/** Hash estable de la wallet — nunca guardar dirección en claro (Issue 1.1). */
export const walletRefFromAddress = (address: string): string =>
  crypto.createHash('sha256').update(address.trim().toLowerCase()).digest('hex')

export const createScanSessionId = (): string => crypto.randomUUID()

const nowIso = (): string => new Date().toISOString()

/**
 * Crea la sesión en Redis al inicio del scan (TTL = expiración automática).
 */
export const createScanSession = async (
  redis: Redis,
  scanSessionId: string,
  walletRef: string,
  ttlSeconds: number
): Promise<ScanSessionRedisPayload> => {
  const createdAt = nowIso()
  const payload: ScanSessionRedisPayload = {
    scanSessionId,
    walletRef,
    status: 'pending',
    progress: 0,
    stages: [],
    createdAt,
    updatedAt: createdAt,
  }
  await saveScanSession(redis, scanSessionId, payload, ttlSeconds)
  return payload
}
