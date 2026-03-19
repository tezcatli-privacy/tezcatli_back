import { env } from '../../config/env'
import { nymFetch } from '../../plugins/nym_client'

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
    timeoutMs: 12_000,
  })

  if (!response.ok) {
    throw new Error(`Neynar request failed: ${response.status}`)
  }

  const payload = (await response.json()) as Record<string, unknown>
  const users = Array.isArray(payload.users) ? payload.users : []
  const first = users[0] as Record<string, unknown> | undefined

  return {
    source: 'neynar',
    address,
    found: Boolean(first),
    username: typeof first?.username === 'string' ? first.username : undefined,
    displayName:
      typeof first?.display_name === 'string' ? first.display_name : undefined,
    raw: payload,
  }
}
