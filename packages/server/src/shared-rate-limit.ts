/**
 * A rate limit every node shares (story 282): each request counted as a row of
 * `rate_limit_hit` under its bucket, so behind several servers the limit is the limit.
 * Rows a day old are swept now and then.
 */
import { type Db, DbDate } from '@crombolo/data'

const DAY = 24 * 60 * 60 * 1000
const SWEEP_EVERY = 60 * 1000

export class SharedRateLimiter {
  readonly #db: Db
  readonly #now: () => number
  #swept = 0

  constructor(db: Db, options: { now?: () => number } = {}) {
    this.#db = db
    this.#now = options.now ?? Date.now
  }

  /** Counts a request: undefined when it may go ahead, or the seconds until one may. */
  async take(bucket: string, max: number, windowMs: number): Promise<number | undefined> {
    const now = this.#now()
    await this.#sweep(now)
    const since = DbDate.toDb(new Date(now - windowMs))
    const recent = await this.#db.q
      .selectFrom('rate_limit_hit')
      .select((eb) => [eb.fn.countAll().as('count'), eb.fn.min('hit_at').as('first')])
      .where('bucket', '=', bucket)
      .where('hit_at', '>', since)
      .executeTakeFirst()
    if (Number(recent?.count ?? 0) >= max) {
      const first = DbDate.fromDb(recent?.first as never)?.getTime() ?? now
      return Math.max(1, Math.ceil((first + windowMs - now) / 1000))
    }
    await this.#db.q
      .insertInto('rate_limit_hit')
      .values({ id: crypto.randomUUID(), bucket, hit_at: DbDate.toDb(new Date(now)) })
      .execute()
    return undefined
  }

  async #sweep(now: number): Promise<void> {
    if (now - this.#swept < SWEEP_EVERY) return
    this.#swept = now
    await this.#db.q
      .deleteFrom('rate_limit_hit')
      .where('hit_at', '<', DbDate.toDb(new Date(now - DAY)))
      .execute()
      .catch(() => {})
  }
}
