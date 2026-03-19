import { env } from '../../config/env'
import { nymFetch } from '../../plugins/nym_client'

export type ArkhamFinding = {
  source: 'arkham'
  address: string
  entities: unknown[]
  labels: unknown[]
  confidence?: number
  raw: unknown
}

export const fetchArkhamAddressIntelligence = async (
  address: string
): Promise<ArkhamFinding> => {
  if (!env.ARKHAM_API_KEY) {
    throw new Error('ARKHAM_API_KEY is required')
  }

  const url = new URL(
    `/intelligence/address/${encodeURIComponent(address)}`,
    env.ARKHAM_API_BASE_URL
  )

  const response = await nymFetch(url, {
    method: 'GET',
    headers: {
      'API-Key': env.ARKHAM_API_KEY,
      Accept: 'application/json',
    },
    timeoutMs: 12_000,
  })

  if (!response.ok) {
    throw new Error(`Arkham request failed: ${response.status}`)
  }

  const payload = (await response.json()) as Record<string, unknown>

  return {
    source: 'arkham',
    address,
    entities: Array.isArray(payload.entities) ? payload.entities : [],
    labels: Array.isArray(payload.labels) ? payload.labels : [],
    confidence:
      typeof payload.confidence === 'number' ? payload.confidence : undefined,
    raw: payload,
  }
}
