/**
 * Request limits for a bundle's member and public routes (story 186): counted
 * per server, in memory, in a sliding window, as sign-in throttling counts
 * failures (`AttemptLimiter`). Behind N servers a site allows up to N times
 * the limit in total.
 */

/** Keys held before the idle ones are swept, so a flood of addresses cannot grow the map for ever. */
const SWEEP_AT = 10_000

export class RateLimiter {
  #hits = new Map<string, number[]>()
  readonly #max: number
  readonly #windowMs: number
  readonly #now: () => number

  constructor(options: { max: number; windowMs: number; now?: () => number }) {
    this.#max = options.max
    this.#windowMs = options.windowMs
    this.#now = options.now ?? Date.now
  }

  /** Counts a request: undefined when it may go ahead, or the seconds until one may. */
  take(key: string): number | undefined {
    const now = this.#now()
    const since = now - this.#windowMs
    if (this.#hits.size >= SWEEP_AT)
      for (const [held, times] of this.#hits)
        if ((times.at(-1) ?? 0) <= since) this.#hits.delete(held)
    const recent = (this.#hits.get(key) ?? []).filter((t) => t > since)
    if (recent.length >= this.#max) {
      this.#hits.set(key, recent)
      return Math.max(1, Math.ceil(((recent[0] as number) + this.#windowMs - now) / 1000))
    }
    recent.push(now)
    this.#hits.set(key, recent)
    return undefined
  }
}

const PRIVATE_ADDRESS =
  /^(?:::ffff:)?(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)|^(?:::1|f[cd][0-9a-f]{2}:|fe80:)/i

/**
 * The address a request came from. The socket's peer, unless that is a
 * private address — a proxy or load balancer in front of the site — when the
 * last `X-Forwarded-For` entry, the one that proxy added, is the caller.
 * Earlier entries are the client's own to write, so they are never trusted.
 */
export function callerAddress(peer: string | undefined, forwardedFor: string | null): string {
  const forwarded = forwardedFor?.split(',').at(-1)?.trim()
  if (forwarded && (!peer || PRIVATE_ADDRESS.test(peer))) return forwarded
  return peer ?? 'unknown'
}
