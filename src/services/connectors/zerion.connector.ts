import { env } from '../../config/env'
import { nymFetch } from '../../plugins/nym_client'

export type ZerionExposure = {
  source: 'zerion'
  address: string
  totalUsdVisible: number
  perChainUsd: Record<string, number>
  raw: unknown
}

const replaceAddressTemplate = (template: string, address: string): string =>
  template.replace('{address}', encodeURIComponent(address))

export const fetchZerionExposure = async (
  address: string
): Promise<ZerionExposure> => {
  if (!env.ZERION_API_KEY) {
    throw new Error('ZERION_API_KEY is required')
  }

  const path = replaceAddressTemplate(env.ZERION_PORTFOLIO_PATH_TEMPLATE, address)
  const url = new URL(path, env.ZERION_API_BASE_URL)

  const response = await nymFetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${env.ZERION_API_KEY}:`).toString('base64')}`,
    },
    timeoutMs: 12_000,
  })

  if (!response.ok) {
    throw new Error(`Zerion request failed: ${response.status}`)
  }

  const payload = (await response.json()) as Record<string, unknown>
  const attributes =
    typeof payload.data === 'object' &&
    payload.data !== null &&
    typeof (payload.data as Record<string, unknown>).attributes === 'object' &&
    (payload.data as Record<string, unknown>).attributes !== null
      ? ((payload.data as Record<string, unknown>).attributes as Record<
          string,
          unknown
        >)
      : {}

  const totalUsd =
    typeof attributes.total?.toString === 'function'
      ? Number(attributes.total)
      : 0

  return {
    source: 'zerion',
    address,
    totalUsdVisible: Number.isFinite(totalUsd) ? totalUsd : 0,
    perChainUsd: {},
    raw: payload,
  }
}
