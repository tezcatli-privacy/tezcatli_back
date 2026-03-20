import type { Redis } from 'ioredis'
import type { Report } from './report_composer'

export const scanSessionKey = (scanSessionId: string): string =>
  `tezcatli:scan:${scanSessionId}`

/** Referencia a wallet sin guardar texto plano */
export type ScanSessionRedisPayload = {
  scanSessionId: string
  walletRef: string
  createdAt: string
  status: 'pending' | 'running' | 'completed' | 'partial' | 'failed'
  progress: number
  stages: Array<{
    stage: string
    status: string
    progress: number
    error?: string
  }>
  updatedAt: string
  /** Resumen pequeño (evita meter raw enormes en Redis) */
  summary?: {
    arkhamOk: boolean
    zerionOk: boolean
    neynarOk: boolean
    zerionTotalUsd?: number
    /** resultado compacto del motor de score */
    privacyScore?: number
    privacyBand?: string
    privacyConfidence?: number
  }
  /**
   * Report listo para el frontend (sin campos `raw` ni direcciones).
   * Se persiste para que un endpoint tipo `/api/scan/:id/report` lo pueda retornar.
   */
  report?: Report
}

export const saveScanSession = async (
  redis: Redis,
  scanSessionId: string,
  payload: ScanSessionRedisPayload,
  ttlSeconds: number
): Promise<void> => {
  await redis.set(
    scanSessionKey(scanSessionId),
    JSON.stringify(payload),
    'EX',
    ttlSeconds
  )
}

export const loadScanSession = async (
  redis: Redis,
  scanSessionId: string
): Promise<ScanSessionRedisPayload | null> => {
  const raw = await redis.get(scanSessionKey(scanSessionId))
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as ScanSessionRedisPayload
  } catch {
    return null
  }
}
