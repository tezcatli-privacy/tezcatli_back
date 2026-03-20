import { env } from '../../config/env'
import { nymFetch } from '../../plugins/nym_client'
import { connectorFetchTimeoutMs } from './connector_timeout'

export type ZerionExposure = {
  source: 'zerion'
  address: string
  totalUsdVisible: number
  perChainUsd: Record<string, number>
  raw: unknown
}

const replaceAddressTemplate = (template: string, address: string): string =>
  template.replace('{address}', encodeURIComponent(address))

const parseFiniteNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

/**
 * Issue 1.5 — JSON:API de Zerion: atributos incluyen total y
 * `positions_distribution_by_chain` (changelog Zerion API).
 */
const extractPortfolioUsd = (
  attrs: Record<string, unknown>
): { totalUsd: number; perChainUsd: Record<string, number> } => {
  const perChainUsd: Record<string, number> = {}
  const dist = attrs.positions_distribution_by_chain
  if (isRecord(dist)) {
    for (const [chain, val] of Object.entries(dist)) {
      let n: number | undefined
      if (isRecord(val)) {
        n =
          parseFiniteNumber(val.usd) ??
          parseFiniteNumber(val.value) ??
          parseFiniteNumber(val.total)
      } else {
        n = parseFiniteNumber(val)
      }
      if (n !== undefined && n >= 0) {
        perChainUsd[chain] = n
      }
    }
  }

  let totalUsd = 0
  const totalRaw = attrs.total
  if (totalRaw !== undefined) {
    if (isRecord(totalRaw)) {
      totalUsd =
        parseFiniteNumber(totalRaw.positions) ??
        parseFiniteNumber(totalRaw.value) ??
        parseFiniteNumber(totalRaw.usd) ??
        0
    } else {
      totalUsd = parseFiniteNumber(totalRaw) ?? 0
    }
  }

  if (totalUsd <= 0 && Object.keys(perChainUsd).length > 0) {
    totalUsd = Object.values(perChainUsd).reduce((a, b) => a + b, 0)
  }

  return { totalUsd: Number.isFinite(totalUsd) ? totalUsd : 0, perChainUsd }
}

export const fetchZerionExposure = async (
  address: string
): Promise<ZerionExposure> => {
  if (!env.ZERION_API_KEY) {
    throw new Error('ZERION_API_KEY is required')
  }

  // si `ZERION_API_BASE_URL` incluye `/v1` y el template empieza con `/`,
  // el pathname puede “pisarse” y perder `/v1`, generando 404.
  const rawPath = replaceAddressTemplate(
    env.ZERION_PORTFOLIO_PATH_TEMPLATE,
    address
  )
  const relPath = rawPath.replace(/^\/+/, '')
  const base =
    env.ZERION_API_BASE_URL.endsWith('/')
      ? env.ZERION_API_BASE_URL
      : `${env.ZERION_API_BASE_URL}/`
  const url = new URL(relPath, base)

  const response = await nymFetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${env.ZERION_API_KEY}:`).toString('base64')}`,
    },
    timeoutMs: connectorFetchTimeoutMs(),
  })

  if (!response.ok) {
    throw new Error(`Zerion request failed: ${response.status}`)
  }

  const payload = (await response.json()) as Record<string, unknown>
  let totalUsd = 0
  let perChainUsd: Record<string, number> = {}

  const data = payload.data
  if (isRecord(data)) {
    const attrs = data.attributes
    if (isRecord(attrs)) {
      const parsed = extractPortfolioUsd(attrs)
      totalUsd = parsed.totalUsd
      perChainUsd = parsed.perChainUsd
    }
  }

  return {
    source: 'zerion',
    address,
    totalUsdVisible: totalUsd,
    perChainUsd,
    raw: payload,
  }
}
