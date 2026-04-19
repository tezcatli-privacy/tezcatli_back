import crypto from 'node:crypto'
import type { Redis } from 'ioredis'

const RECOVERY_PREFIX = 'tezcatli:recovery'

const tokenHash = (token: string): string =>
  crypto.createHash('sha256').update(token).digest('hex')

const tokenKey = (token: string): string => `${RECOVERY_PREFIX}:token:${tokenHash(token)}`

export const createRecoveryToken = async (
  redis: Redis,
  scanSessionId: string,
  ttlSeconds: number
): Promise<{ token: string; expiresInSeconds: number }> => {
  const token = crypto.randomBytes(32).toString('hex')
  await redis.set(tokenKey(token), scanSessionId, 'EX', ttlSeconds)
  return { token, expiresInSeconds: ttlSeconds }
}

export const resolveRecoveryToken = async (
  redis: Redis,
  token: string
): Promise<string | null> => {
  return redis.get(tokenKey(token))
}

