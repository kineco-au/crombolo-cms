/**
 * What went wrong rendering a workspace's pages, as each node notes it (story 408):
 * the newest kept per workspace, so any node answers for the whole site.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

/** How many of a workspace's errors are kept, the newest. */
export const WORKSPACE_ERRORS_KEPT = 200

export interface WorkspaceError {
  at: Date
  node: string
  page: string
  says: string
}

export class WorkspaceErrorRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Notes one, and drops what is past the newest kept. */
  async note(
    workspaceKey: string,
    error: { node: string; page: string; says: string },
    now = new Date(),
    kept = WORKSPACE_ERRORS_KEPT,
  ): Promise<void> {
    const key = normaliseUuid(workspaceKey)
    await this.#db.q
      .insertInto('workspace_error')
      .values({
        workspace_key: key,
        node_id: error.node.slice(0, 64),
        page: error.page.slice(0, 1000),
        says: error.says.slice(0, 4000),
        noted_at: DbDate.toDb(now),
      })
      .execute()
    const oldestKept = (
      await this.#db.q
        .selectFrom('workspace_error')
        .select('id')
        .where('workspace_key', '=', key)
        .orderBy('id', 'desc')
        .limit(1)
        .offset(kept - 1)
        .execute()
    )[0]
    if (oldestKept)
      await this.#db.q
        .deleteFrom('workspace_error')
        .where('workspace_key', '=', key)
        .where('id', '<', oldestKept.id)
        .execute()
  }

  /** A workspace's errors from every node, oldest first, from `since` on. */
  async of(workspaceKey: string, since?: Date): Promise<WorkspaceError[]> {
    const rows = await this.#db.q
      .selectFrom('workspace_error')
      .select(['node_id', 'page', 'says', 'noted_at'])
      .where('workspace_key', '=', normaliseUuid(workspaceKey))
      .orderBy('id')
      .execute()
    return rows
      .map((r) => ({
        at: DbDate.fromDb(r.noted_at) ?? new Date(0),
        node: String(r.node_id),
        page: String(r.page),
        says: String(r.says),
      }))
      .filter((e) => !since || e.at >= since)
  }

  /** A merged or discarded workspace keeps none. */
  async clear(workspaceKey: string): Promise<void> {
    await this.#db.q
      .deleteFrom('workspace_error')
      .where('workspace_key', '=', normaliseUuid(workspaceKey))
      .execute()
  }
}
