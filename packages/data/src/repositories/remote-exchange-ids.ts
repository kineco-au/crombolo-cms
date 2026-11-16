/**
 * The one-time ids of tokens a provider issued for the remote's exchange
 * (story 364), each kept until its token expires, so no token is exchanged
 * twice.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export class RemoteExchangeIds {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Spends an id; false when it was spent before. Sweeps the ids whose tokens have expired. */
  async spend(
    issuer: string,
    tokenId: string,
    expiresAt: Date,
    now = new Date(),
  ): Promise<boolean> {
    await this.#db.q
      .deleteFrom('remote_exchange_id')
      .where('expires_at', '<', DbDate.toDb(now))
      .execute()
    const seen = await this.#db.q
      .selectFrom('remote_exchange_id')
      .select('id')
      .where('issuer', '=', issuer)
      .where('token_id', '=', tokenId)
      .executeTakeFirst()
    if (seen) return false
    try {
      await this.#db.q
        .insertInto('remote_exchange_id')
        .values({ issuer, token_id: tokenId, expires_at: DbDate.toDb(expiresAt) })
        .execute()
      return true
    } catch {
      // Two exchanges of one token at once: the unique index lets one in.
      return false
    }
  }
}
