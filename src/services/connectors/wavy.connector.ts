import { env } from '../../config/env'
import { nymFetch } from '../../plugins/nym_client'
import { connectorFetchTimeoutMs } from './connector_timeout'

export type WavyRiskLevel =
  | 'verified'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical'
  | 'unknown'

export type WavyRiskScan = {
  source: 'wavy'
  address: string
  chainId: number
  analysisId?: string
  riskScore: number
  riskLevel: WavyRiskLevel
  riskReason: string
  suspiciousActivity: boolean
  patternsDetected: string[]
  transactionsAnalyzed?: number
  completedAt?: string
  raw: unknown
}

export type WavyRegistrationResult = {
  source: 'wavy'
  address: string
  projectId: number
  status: 'registered' | 'already_exists'
  raw: unknown
}

type WavyScanApiResult = {
  analysisId?: string
  address?: string
  chainId?: string | number
  riskScore?: number
  riskLevel?: string
  riskReason?: string
  suspiciousActivity?: boolean
  patternsDetected?: unknown[]
  transactionsAnalyzed?: number
  completedAt?: string
}

type WavyScanApiEnvelope = {
  data?: {
    total?: number
    missing?: number
    results?: unknown[]
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const normalizeRiskLevel = (value: unknown): WavyRiskLevel => {
  if (typeof value !== 'string') return 'unknown'
  const normalized = value.trim().toLowerCase()
  switch (normalized) {
    case 'verified':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'critical':
      return normalized
    default:
      return 'unknown'
  }
}

const normalizePatterns = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (isRecord(entry) && typeof entry.name === 'string') return entry.name
      if (isRecord(entry) && typeof entry.type === 'string') return entry.type
      return undefined
    })
    .filter((entry): entry is string => Boolean(entry))
}

const formatApiKeyHeader = (rawApiKey: string): string => {
  const trimmed = rawApiKey.trim()
  if (trimmed.toLowerCase().startsWith('apikey ')) {
    return trimmed
  }
  return `ApiKey ${trimmed}`
}

const readResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return response.text()
}

const extractErrorMessage = (payload: unknown): string | undefined => {
  if (typeof payload === 'string' && payload.trim()) return payload
  if (!isRecord(payload)) return undefined
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  return undefined
}

const normalizeScanResult = (
  address: string,
  chainId: number,
  payload: unknown
): WavyRiskScan => {
  if (!isRecord(payload)) {
    throw new Error('Wavy response payload is not an object')
  }

  const data = (payload as WavyScanApiEnvelope).data
  if (!isRecord(data) || !Array.isArray(data.results)) {
    throw new Error('Wavy response does not include results')
  }

  const normalizedAddress = address.trim().toLowerCase()
  const firstMatch = data.results.find((entry): entry is WavyScanApiResult => {
    if (!isRecord(entry)) return false
    return (
      typeof entry.address === 'string' &&
      entry.address.trim().toLowerCase() === normalizedAddress
    )
  })

  const result = firstMatch ?? (data.results[0] as WavyScanApiResult | undefined)
  if (!result) {
    const missing =
      typeof data.missing === 'number' && Number.isFinite(data.missing)
        ? data.missing
        : undefined

    if (missing && missing > 0) {
      throw new Error(
        'Wavy did not return any analysis result. The address may not be registered in the Wavy project yet.'
      )
    }

    throw new Error(
      'Wavy did not return any analysis result. The address may not have a completed risk analysis yet.'
    )
  }

  return {
    source: 'wavy',
    address,
    chainId:
      typeof result.chainId === 'number'
        ? result.chainId
        : Number(result.chainId ?? chainId),
    analysisId: result.analysisId,
    riskScore:
      typeof result.riskScore === 'number' && Number.isFinite(result.riskScore)
        ? result.riskScore
        : 100,
    riskLevel: normalizeRiskLevel(result.riskLevel),
    riskReason:
      typeof result.riskReason === 'string' && result.riskReason.trim()
        ? result.riskReason
        : 'Risk analysis completed without an explicit reason.',
    suspiciousActivity: Boolean(result.suspiciousActivity),
    patternsDetected: normalizePatterns(result.patternsDetected),
    transactionsAnalyzed:
      typeof result.transactionsAnalyzed === 'number' &&
      Number.isFinite(result.transactionsAnalyzed)
        ? result.transactionsAnalyzed
        : undefined,
    completedAt:
      typeof result.completedAt === 'string' ? result.completedAt : undefined,
    raw: payload,
  }
}

export const fetchWavyRiskScan = async (
  address: string,
  chainId = env.WAVY_CHAIN_ID
): Promise<WavyRiskScan> => {
  if (!env.WAVY_API_KEY) {
    throw new Error('WAVY_API_KEY is required')
  }
  if (!env.WAVY_PROJECT_ID) {
    throw new Error('WAVY_PROJECT_ID is required')
  }

  const url = new URL(
    `/v1/projects/${env.WAVY_PROJECT_ID}/addresses/scan-risk`,
    env.WAVY_API_BASE_URL
  )
  url.searchParams.set('addresses', address)
  url.searchParams.set('chainId', String(chainId))

  const response = await nymFetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-api-key': formatApiKeyHeader(env.WAVY_API_KEY),
    },
    timeoutMs: connectorFetchTimeoutMs(),
  })

  if (!response.ok) {
    throw new Error(`Wavy request failed: ${response.status}`)
  }

  const payload = await response.json()
  return normalizeScanResult(address, chainId, payload)
}

export const registerWavyAddress = async (
  address: string,
  description = 'Tezcatli migration eligibility wallet',
  foreignUserId?: string
): Promise<WavyRegistrationResult> => {
  if (!env.WAVY_API_KEY) {
    throw new Error('WAVY_API_KEY is required')
  }
  if (!env.WAVY_PROJECT_ID) {
    throw new Error('WAVY_PROJECT_ID is required')
  }

  const url = new URL(`/v1/projects/${env.WAVY_PROJECT_ID}/addresses`, env.WAVY_API_BASE_URL)
  const body = {
    address,
    description,
    ...(foreignUserId ? { foreign_user_id: foreignUserId } : {}),
  }

  const response = await nymFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': formatApiKeyHeader(env.WAVY_API_KEY),
    },
    body: JSON.stringify(body),
    timeoutMs: connectorFetchTimeoutMs(),
  })

  const payload = await readResponseBody(response)
  const message = extractErrorMessage(payload)

  if (!response.ok) {
    if (message && /already|exists|duplicate/i.test(message)) {
      return {
        source: 'wavy',
        address,
        projectId: env.WAVY_PROJECT_ID,
        status: 'already_exists',
        raw: payload,
      }
    }
    throw new Error(
      message ? `Wavy register failed: ${message}` : `Wavy register failed: ${response.status}`
    )
  }

  if (isRecord(payload) && payload.success === false) {
    if (message && /already|exists|duplicate/i.test(message)) {
      return {
        source: 'wavy',
        address,
        projectId: env.WAVY_PROJECT_ID,
        status: 'already_exists',
        raw: payload,
      }
    }
    throw new Error(message ? `Wavy register failed: ${message}` : 'Wavy register failed')
  }

  return {
    source: 'wavy',
    address,
    projectId: env.WAVY_PROJECT_ID,
    status: 'registered',
    raw: payload,
  }
}
