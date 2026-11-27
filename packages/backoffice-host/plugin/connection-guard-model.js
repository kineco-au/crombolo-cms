/**
 * When the server stops answering: a request that fails on the network, or that a
 * gateway answers for a server it can't reach, is a lost connection. A read waits until
 * the connection is back and is asked again; a write is not resent, since it may have
 * arrived, and fails as it would have. Pure, but for the `send` and `connection` given.
 */

/** Statuses a proxy or gateway answers with when the server behind it can't be reached. */
export const UNREACHABLE = new Set([502, 503, 504, 521, 522, 523, 524, 525, 526, 530, 598, 599])

/**
 * Whether an answer is a gateway's for a server it can't reach. The server itself
 * answers 503 on purpose (another site not answering, maintenance), always as JSON; a
 * load balancer's or proxy's is a page or plain text. Pure.
 */
export const unreachable = (response) => {
  if (!UNREACHABLE.has(response.status)) return false
  if (response.status !== 503) return true
  return !/json/i.test(response.headers.get('content-type') ?? '')
}

/** Whether a fetch's own error is the network failing, rather than being aborted. Pure. */
export const isNetworkFailure = (error) => error instanceof TypeError

const methodOf = (input, init) =>
  (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

/** Whether a request may be sent again after the connection comes back: reads only. Pure. */
export const resendable = (input, init) => {
  const method = methodOf(input, init)
  if (method !== 'GET' && method !== 'HEAD') return false
  // A Request's body is read once; a GET has none, so one is safe to clone and resend.
  return true
}

/** Whether a request goes to this site, rather than somewhere else on the internet. Pure. */
export const ownOrigin = (input, origin) => {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), origin)
    return url.origin === origin
  } catch {
    return false
  }
}

/**
 * `send` with lost connections handed to `connection`: `lost()` says it is lost and
 * answers a promise settled when it is back.
 */
export function connectionGuardedFetch(send, connection, origin) {
  return async (input, init) => {
    if (!ownOrigin(input, origin)) return send(input, init)
    const again = resendable(input, init)
    const copy = again && input instanceof Request ? input.clone() : input
    try {
      const response = await send(input, init)
      if (!unreachable(response)) return response
      const back = connection.lost()
      if (!again) return response
      await back
      return send(copy, init)
    } catch (error) {
      if (!isNetworkFailure(error)) throw error
      const back = connection.lost()
      if (!again) throw error
      await back
      return send(copy, init)
    }
  }
}
