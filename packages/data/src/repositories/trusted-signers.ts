/**
 * The keys and CI sources a site trusts to sign the site bundles it applies
 * (story 316), as an administrator manages them in Settings.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export type TrustedSignerKind = 'user' | 'site' | 'source'

export interface TrustedSigner {
  id: string
  kind: TrustedSignerKind
  name: string
  /** A key's public line; null for a CI source. */
  publicKey: string | null
  fingerprint: string | null
  /** A CI source, `org/repo@v*`; null for a key. */
  source: string | null
  addedBy: string | null
  addedAt: Date
  lastSignedAt: Date | null
}

const map = (row: Record<string, unknown>): TrustedSigner => ({
  id: String(row.id),
  kind: row.kind === 'site' ? 'site' : row.kind === 'source' ? 'source' : 'user',
  name: String(row.name),
  publicKey: (row.public_key as string | null) ?? null,
  fingerprint: (row.fingerprint as string | null) ?? null,
  source: (row.source as string | null) ?? null,
  addedBy: (row.added_by as string | null) ?? null,
  addedAt: DbDate.fromDb(row.added_at) ?? new Date(0),
  lastSignedAt: DbDate.fromDb(row.last_signed_at) ?? null,
})

export class TrustedSignerRepository {
  readonly #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  async all(): Promise<TrustedSigner[]> {
    const rows = await this.#db.q
      .selectFrom('trusted_signer')
      .selectAll()
      .orderBy('added_at')
      .execute()
    return rows.map((row) => map(row as Record<string, unknown>))
  }

  async add(
    signer: Pick<
      TrustedSigner,
      'kind' | 'name' | 'publicKey' | 'fingerprint' | 'source' | 'addedBy'
    >,
  ): Promise<TrustedSigner> {
    const id = randomUUID()
    const now = new Date()
    await this.#db.q
      .insertInto('trusted_signer')
      .values({
        id,
        kind: signer.kind,
        name: signer.name,
        public_key: signer.publicKey,
        fingerprint: signer.fingerprint,
        source: signer.source,
        added_by: signer.addedBy,
        added_at: DbDate.toDb(now),
      })
      .execute()
    return { ...signer, id, addedAt: now, lastSignedAt: null }
  }

  async rename(id: string, name: string): Promise<boolean> {
    const result = await this.#db.q
      .updateTable('trusted_signer')
      .set({ name })
      .where('id', '=', id)
      .executeTakeFirst()
    return Number(result.numUpdatedRows) > 0
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.#db.q
      .deleteFrom('trusted_signer')
      .where('id', '=', id)
      .executeTakeFirst()
    return Number(result.numDeletedRows) > 0
  }

  /** Notes that a signer's bundle was applied, for the list's "last signed". */
  async signed(id: string): Promise<void> {
    await this.#db.q
      .updateTable('trusted_signer')
      .set({ last_signed_at: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
  }
}
