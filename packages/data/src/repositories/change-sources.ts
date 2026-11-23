/**
 * Where site bundles staged as changes come from (story 399). A source's base is the
 * bundle's items as its last merged staging carried them; a workspace staged from a
 * source holds what it staged until it merges, when that becomes the source's base, or
 * is discarded, when the base stays as it was. docs/changes.md.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export class ChangeSourceRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** The source's base, as text, when a staging from it has merged. */
  async base(name: string): Promise<string | undefined> {
    const row = await this.#db.q
      .selectFrom('change_source')
      .select('snapshot')
      .where('name', '=', name)
      .executeTakeFirst()
    return row ? String(row.snapshot) : undefined
  }

  /** The open workspace staged from the source, when there is one. */
  async stagedFrom(name: string): Promise<number | undefined> {
    const row = await this.#db.q
      .selectFrom('change_source_staged as s')
      .innerJoin('workspace as w', 'w.id', 's.workspace_id')
      .select('s.workspace_id')
      .where('s.source', '=', name)
      .where('w.state', '=', 'open')
      .executeTakeFirst()
    return row ? Number(row.workspace_id) : undefined
  }

  /** What a workspace holds, staged from the source: its base once the workspace merges. */
  async staged(workspaceId: number, name: string, snapshot: string): Promise<void> {
    await this.#db.q
      .deleteFrom('change_source_staged')
      .where('workspace_id', '=', workspaceId)
      .execute()
    await this.#db.q
      .insertInto('change_source_staged')
      .values({ workspace_id: workspaceId, source: name, snapshot })
      .execute()
  }

  /** A workspace merged: what it staged from a source becomes that source's base. */
  async merged(workspaceId: number): Promise<void> {
    const row = await this.#db.q
      .selectFrom('change_source_staged')
      .select(['source', 'snapshot'])
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst()
    if (!row) return
    const name = String(row.source)
    const now = DbDate.toDb(new Date())
    await this.#db.q.deleteFrom('change_source').where('name', '=', name).execute()
    await this.#db.q
      .insertInto('change_source')
      .values({ name, snapshot: String(row.snapshot), updated_at: now })
      .execute()
    await this.#db.q
      .deleteFrom('change_source_staged')
      .where('workspace_id', '=', workspaceId)
      .execute()
  }
}
