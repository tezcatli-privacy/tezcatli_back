import { createPublicClient, getAddress, http, isAddress } from 'viem'
import { normalize as normalizeEns } from 'viem/ens'
import { mainnet } from 'viem/chains'
import { env } from '../config/env'

export class WalletInputError extends Error {
  constructor(message = 'invalid_wallet_or_ens') {
    super(message)
    this.name = 'WalletInputError'
  }
}

export type ResolvedWalletInput = {
  address: string
  inputType: 'address' | 'ens'
  ensName?: string
}

let cachedPublicClient: ReturnType<typeof createPublicClient> | null = null

const getPublicClient = (): ReturnType<typeof createPublicClient> => {
  if (cachedPublicClient) {
    return cachedPublicClient
  }
  cachedPublicClient = createPublicClient({
    chain: mainnet,
    transport: env.ETH_RPC_URL ? http(env.ETH_RPC_URL) : http(),
  })
  return cachedPublicClient
}

const looksLikeEns = (v: string): boolean => v.toLowerCase().endsWith('.eth')

/**
 * Issue 3.1 — acepta wallet o ENS y normaliza a dirección EVM checksum.
 */
export const resolveWalletInput = async (
  rawInput: string
): Promise<ResolvedWalletInput> => {
  const input = rawInput.trim()
  if (!input) {
    throw new WalletInputError()
  }

  if (isAddress(input)) {
    return { address: getAddress(input), inputType: 'address' }
  }

  if (!looksLikeEns(input)) {
    throw new WalletInputError()
  }

  try {
    const normalizedName = normalizeEns(input)
    const client = getPublicClient()
    const resolved = await client.getEnsAddress({ name: normalizedName })
    if (!resolved || !isAddress(resolved)) {
      throw new WalletInputError()
    }
    return {
      address: getAddress(resolved),
      inputType: 'ens',
      ensName: normalizedName,
    }
  } catch {
    throw new WalletInputError()
  }
}

