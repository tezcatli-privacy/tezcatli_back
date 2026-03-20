import Redis from 'ioredis'

/**
 * Conecta Redis antes de registrar `@fastify/redis`.
 *
 * Si reutilizamos el cliente ya en `ready`, el plugin no engancha `on('end')` → `quit()`,
 * lo que evita el crash `Connection is closed` cuando ioredis agota reintentos antes del `ready`.
 */
export const createConnectedRedis = async (url: string): Promise<Redis> => {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 10_000,
    retryStrategy: (times: number) => {
      if (times > 8) {
        return null
      }
      return Math.min(times * 150, 1500)
    },
  })

  try {
    await client.connect()
  } catch (err) {
    client.disconnect()
    throw err
  }

  return client
}
