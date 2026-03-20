import { env } from '../../config/env'
import { nymFetch } from '../../plugins/nym_client'
import { connectorFetchTimeoutMs } from './connector_timeout'

export type ArkhamFinding = {
  source: 'arkham'
  address: string
  entities: unknown[]
  labels: unknown[]
  confidence?: number
  raw: unknown
}

const replaceAddressTemplate = (template: string, address: string): string =>
  template.replace('{address}', encodeURIComponent(address))

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const dedupeByKey = <T>(items: T[], keyFor: (item: T) => string): T[] => {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = keyFor(item)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

const entityKey = (e: unknown): string => {
  if (isRecord(e)) {
    if (typeof e.id === 'string' && e.id) return `entity:id:${e.id}`
    if (typeof e.name === 'string' && e.name) return `entity:name:${e.name}`
  }
  try {
    return `entity:json:${JSON.stringify(e)}`
  } catch {
    return 'entity:unknown'
  }
}

const labelKey = (l: unknown): string => {
  if (isRecord(l)) {
    const name = typeof l.name === 'string' ? l.name : ''
    const address = typeof l.address === 'string' ? l.address : ''
    const chainType = typeof l.chainType === 'string' ? l.chainType : ''
    if (name || address || chainType) {
      return `label:${name}:${address}:${chainType}`
    }
  }
  try {
    return `label:json:${JSON.stringify(l)}`
  } catch {
    return 'label:unknown'
  }
}

/**
 * Respuesta GET /intelligence/address/{address}/all: mapa chain → fila,
 * o una única fila tipo Address (doc Arkham Intel API v1.1).
 */
const collectFromIntelRow = (
  row: Record<string, unknown>,
  entities: unknown[],
  labels: unknown[]
): void => {
  for (const key of ['arkhamEntity', 'predictedEntity', 'userEntity'] as const) {
    const e = row[key]
    if (isRecord(e)) {
      entities.push(e)
    }
  }
  const tags = row.populatedTags
  if (Array.isArray(tags)) {
    labels.push(...tags)
  }
  if (row.arkhamLabel) {
    labels.push(row.arkhamLabel)
  }
  if (row.userLabel) {
    labels.push(row.userLabel)
  }
}

const normalizeArkhamPayload = (
  payload: unknown
): { entities: unknown[]; labels: unknown[]; confidence?: number } => {
  if (!isRecord(payload)) {
    return { entities: [], labels: [] }
  }

  const entities: unknown[] = []
  const labels: unknown[] = []

  /** Fila única tipo Address (GET sin `/all`) */
  const isSingleAddressRow =
    typeof payload.chain === 'string' &&
    (typeof payload.address === 'string' ||
      isRecord(payload.arkhamEntity) ||
      isRecord(payload.predictedEntity))

  if (isSingleAddressRow) {
    collectFromIntelRow(payload, entities, labels)
  } else {
    /** Mapa multichain: GET …/all — valores con `chain` por fila */
    let anyRow = false
    for (const value of Object.values(payload)) {
      if (isRecord(value) && typeof value.chain === 'string') {
        collectFromIntelRow(value, entities, labels)
        anyRow = true
      }
    }
    if (!anyRow) {
      collectFromIntelRow(payload, entities, labels)
    }
  }

  const confidence =
    typeof payload.confidence === 'number' ? payload.confidence : undefined

  // evitar que el score se infle con entidades/labels repetidos
  // entre cadenas (el endpoint /all puede repetir actores y tags).
  const dedupedEntities = dedupeByKey(entities, entityKey)
  const dedupedLabels = dedupeByKey(labels, labelKey)

  return { entities: dedupedEntities, labels: dedupedLabels, confidence }
}

export const fetchArkhamAddressIntelligence = async (
  address: string
): Promise<ArkhamFinding> => {
  if (!env.ARKHAM_API_KEY) {
    throw new Error('ARKHAM_API_KEY is required')
  }

  const path = replaceAddressTemplate(env.ARKHAM_INTELLIGENCE_PATH_TEMPLATE, address)
  const url = new URL(path, env.ARKHAM_API_BASE_URL)

  const response = await nymFetch(url, {
    method: 'GET',
    headers: {
      'API-Key': env.ARKHAM_API_KEY,
      Accept: 'application/json',
    },
    timeoutMs: connectorFetchTimeoutMs(),
  })

  if (!response.ok) {
    throw new Error(`Arkham request failed: ${response.status}`)
  }

  const payload = (await response.json()) as Record<string, unknown>
  const { entities, labels, confidence } = normalizeArkhamPayload(payload)

  return {
    source: 'arkham',
    address,
    entities,
    labels,
    confidence,
    raw: payload,
  }
}
