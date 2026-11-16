/**
 * Tokens that may be used once: the remote's exchanged provider tokens (story
 * 364) and preview links (story 368), by issuer and id, each kept until its
 * token expires so none is used twice.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export class SingleUseTokens {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Uses a token's id; false when it was used before. Sweeps the ids whose tokens have expired. */
  async use(issuer: string, tokenId: string, expiresAt: Date, now = new Date()): Promise<boolean> {
    await this.#db.q
      .deleteFrom('single_use_token')
      .where('expires_at', '<', DbDate.toDb(now))
      .execute()
    const seen = await this.#db.q
      .selectFrom('single_use_token')
      .select('id')
      .where('issuer', '=', issuer)
      .where('token_id', '=', tokenId)
      .executeTakeFirst()
    if (seen) return false
    try {
      await this.#db.q
        .insertInto('single_use_token')
        .values({ issuer, token_id: tokenId, expires_at: DbDate.toDb(expiresAt) })
        .execute()
      return true
    } catch {
      // Two uses of one token at once: the unique index lets one in.
      return false
    }
  }
}
