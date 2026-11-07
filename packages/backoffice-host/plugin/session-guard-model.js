/**
 * What a screen's own `fetch` does when a session has ended. Pure, given how to
 * send and how to recover, so each is tested on its own.
 */
const SIGNING_IN = /\/(security|login|oauth_complete)(\/|$)/

const hasAuthorization = (input, init) => {
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  )
  return headers.has('authorization')
}

/**
 * Whether a request is one of the back office's own, sent with the session cookie.
 * The client's API calls carry a token and have a queue of their own, and signing
 * in must never wait for itself.
 *
 * @param {RequestInfo | URL} input
 * @param {RequestInit | undefined} init
 * @param {string} base the back office's address, e.g. `http://localhost/crombolo`
 */
export function covers(input, init, base) {
  const url = input instanceof Request ? input.url : new URL(String(input), `${base}/`).href
  if (!url.startsWith(`${base}/`)) return false
  return !SIGNING_IN.test(new URL(url).pathname) && !hasAuthorization(input, init)
}

/** A consumed request cannot be sent twice, but a 401 means none of it was acted on. */
const canResend = (input) => !(input instanceof Request) || input.method === 'GET'

/**
 * A `fetch` that waits for someone to sign in, rather than answering a 401.
 *
 * @param {typeof fetch} send
 * @param {{
 *   covers: (input: RequestInfo | URL, init?: RequestInit) => boolean,
 *   signedIn: () => Promise<void>,
 *   recover: () => Promise<void>,
 * }} session `signedIn` settles at once unless the session has ended; `recover`
 *   renews it, or asks the person to sign in, and settles when it is back.
 */
export function guardedFetch(send, session) {
  return async (input, init) => {
    if (!session.covers(input, init)) return send(input, init)
    await session.signedIn()
    let response = await send(input, init)
    for (let tries = 0; tries < 2 && response.status === 401 && canResend(input); tries++) {
      await session.recover()
      response = await send(input, init)
    }
    return response
  }
}
