/**
 * Capa externa de timeout en el orquestador (además del Abort del HTTP).
 */
export const promiseWithTimeout = <T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}: timeout after ${ms}ms`))
    }, ms)
    if (typeof (timer as ReturnType<typeof setTimeout>).unref === 'function') {
      ;(timer as ReturnType<typeof setTimeout> & { unref: () => void }).unref()
    }

    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err: unknown) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
