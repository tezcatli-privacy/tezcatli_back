import { env } from '../../config/env'
import { nymFetch } from '../../plugins/nym_client'
import { connectorFetchTimeoutMs } from './connector_timeout'

export type NeynarIdentity = {
  source: 'neynar'
  address: string
  found: boolean
  username?: string
  displayName?: string
  raw: unknown
}

const replaceAddressTemplate = (template: string, address: string): string =>
  template.replace('{address}', encodeURIComponent(address))

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null

const normalizeAddr = (a: string): string => a.trim().toLowerCase()

/**
 * Issue 1.5 — OpenAPI Neynar `BulkUsersByAddressResponse`: objeto cuyas propiedades
 * son arrays de `User`, y/o clave `users` en algunas respuestas.
 */
const extractNeynarUsers = (payload: Record<string, unknown>): unknown[] => {
  if (Array.isArray(payload.users)) {
    return payload.users
  }
  const out: unknown[] = []
  for (const v of Object.values(payload)) {
    if (Array.isArray(v)) {
      out.push(...v)
    }
  }
  return out
}

const userMatchesWallet = (
  user: Record<string, unknown>,
  walletNorm: string
): boolean => {
  const custody =
    typeof user.custody_address === 'string'
      ? normalizeAddr(user.custody_address)
      : ''
  if (custody && custody === walletNorm) {
    return true
  }
  const verifications = user.verifications
  if (Array.isArray(verifications)) {
    return verifications.some(
      (v) => typeof v === 'string' && normalizeAddr(v) === walletNorm
    )
  }
  return false
}
  
export const fetchNeynarIdentity = async (
  address: string
): Promise<NeynarIdentity> => {
  if (!env.NEYNAR_API_KEY) {
    throw new Error('NEYNAR_API_KEY is required')
  }

  const path = replaceAddressTemplate(env.NEYNAR_LOOKUP_PATH_TEMPLATE, address)
  const url = new URL(path, env.NEYNAR_API_BASE_URL)

  const response = await nymFetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-api-key': env.NEYNAR_API_KEY,
    },
    timeoutMs: connectorFetchTimeoutMs(),
  })

  if (!response.ok) {
    throw new Error(`Neynar request failed: ${response.status}`)
  }

  const payload = (await response.json()) as Record<string, unknown>
  const candidates = extractNeynarUsers(payload)
  const walletNorm = normalizeAddr(address)

  const first = candidates.find(
    (u): u is Record<string, unknown> => isRecord(u) && userMatchesWallet(u, walletNorm)
  )

  /** Si la API ya filtró por address, usar el primer user válido */
  const fallback =
    first ??
    candidates.find((u): u is Record<string, unknown> => isRecord(u) && u.object === 'user')

  return {
    source: 'neynar',
    address,
    found: Boolean(fallback),
    username: typeof fallback?.username === 'string' ? fallback.username : undefined,
    displayName:
      typeof fallback?.display_name === 'string' ? fallback.display_name : undefined,
    raw: payload,
  }
}
