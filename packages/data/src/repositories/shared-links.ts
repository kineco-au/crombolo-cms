/**
 * Links to Shared (story 447): each kept by the SHA-256 of its secret, with who made it,
 * whether it lets its holder write, when it lapses, and whether it was withdrawn.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'

export interface SharedLink {
  id: number
  madeBy: string
  writes: boolean
  createdAt: Date
  expiresAt: Date
  withdrawnAt: Date | null
}

export class SharedLinkRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  #view(row: Record<string, unknown>): SharedLink {
    return {
      id: Number(row.id),
      madeBy: normaliseUuid(String(row.made_by)),
      writes: fromDbBool(row.writes),
      createdAt: DbDate.fromDb(row.created_at) ?? new Date(0),
      expiresAt: DbDate.fromDb(row.expires_at) ?? new Date(0),
      withdrawnAt: DbDate.fromDb(row.withdrawn_at) ?? null,
    }
  }

  async make(link: {
    madeBy: string
    secretHash: string
    writes: boolean
    expiresAt: Date
  }): Promise<SharedLink> {
    await this.#db.q
      .insertInto('shared_link')
      .values({
        secret_hash: link.secretHash,
        made_by: normaliseUuid(link.madeBy),
        writes: this.#db.dialect.boolValue(link.writes) as boolean,
        created_at: DbDate.toDb(new Date()),
        expires_at: DbDate.toDb(link.expiresAt),
        withdrawn_at: null,
      })
      .execute()
    return (await this.bySecretHash(link.secretHash)) as SharedLink
  }

  async bySecretHash(hash: string): Promise<SharedLink | undefined> {
    const rows = await this.#db.q
      .selectFrom('shared_link')
      .selectAll()
      .where('secret_hash', '=', hash)
      .execute()
    return rows[0] ? this.#view(rows[0]) : undefined
  }

  async byId(id: number): Promise<SharedLink | undefined> {
    if (!Number.isInteger(id)) return undefined
    const rows = await this.#db.q
      .selectFrom('shared_link')
      .selectAll()
      .where('id', '=', id)
      .execute()
    return rows[0] ? this.#view(rows[0]) : undefined
  }

  /** Every link, or one person's, newest first. */
  async list(madeBy?: string): Promise<SharedLink[]> {
    return (
      await this.#db.q
        .selectFrom('shared_link')
        .selectAll()
        .$if(madeBy !== undefined, (q) => q.where('made_by', '=', normaliseUuid(madeBy as string)))
        .orderBy('id', 'desc')
        .execute()
    ).map((row) => this.#view(row))
  }

  async withdraw(id: number): Promise<boolean> {
    // Read first: not every driver reports the rows an update changed.
    const link = await this.byId(id)
    if (!link || link.withdrawnAt) return false
    await this.#db.q
      .updateTable('shared_link')
      .set({ withdrawn_at: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
    return true
  }
}
