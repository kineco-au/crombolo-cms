/**
 * What an import last applied to each node (story 163): the base a later import
 * compares the bundle and the site against. Written inside the import's
 * transaction, with the state it replaced, so a revert can put it back.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

/** One node as an import left it. Values are keyed `alias|culture|segment`, names by culture. */
export interface AppliedState {
  values: Record<string, unknown>
  names: Record<string, string>
  parent: string | null
  /** The order the bundle gave it among its siblings. */
  bundleSortOrder: number
  /** The order it had here once the import was done. */
  sortOrder: number
}

export const appliedValueKey = (alias: string, culture: string | null, segment: string | null) =>
  `${alias}|${culture ?? ''}|${segment ?? ''}`

const parse = (text: unknown): AppliedState | null =>
  text === null || text === undefined ? null : (JSON.parse(String(text)) as AppliedState)

export class ContentAppliedRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async byKeys(keys: readonly string[]): Promise<Map<string, AppliedState>> {
    const out = new Map<string, AppliedState>()
    for (let i = 0; i < keys.length; i += 500) {
      const chunk = keys.slice(i, i + 500).map(normaliseUuid)
      if (chunk.length === 0) continue
      const rows = await this.#db.q
        .selectFrom('content_applied')
        .select(['node_key', 'state'])
        .where('node_key', 'in', chunk)
        .execute()
      for (const row of rows) {
        const state = parse(row.state)
        if (state) out.set(normaliseUuid(String(row.node_key)), state)
      }
    }
    return out
  }

  /** Records what a run applied to a node, keeping what it replaced. */
  async record(key: string, runId: string, state: AppliedState): Promise<void> {
    const nodeKey = normaliseUuid(key)
    const was = await this.#db.q
      .selectFrom('content_applied')
      .select(['run_id', 'state'])
      .where('node_key', '=', nodeKey)
      .executeTakeFirst()
    const now = DbDate.toDb(new Date())
    if (!was) {
      await this.#db.q
        .insertInto('content_applied')
        .values({
          node_key: nodeKey,
          run_id: runId,
          state: JSON.stringify(state),
          applied_at: now,
          previous_run_id: null,
          previous_state: null,
        })
        .execute()
      return
    }
    await this.#db.q
      .updateTable('content_applied')
      .set({
        run_id: runId,
        state: JSON.stringify(state),
        applied_at: now,
        previous_run_id: String(was.run_id),
        previous_state: String(was.state),
      })
      .where('node_key', '=', nodeKey)
      .execute()
  }

  /** Undoes what a run recorded: the state before it, or no record where it made the first. */
  async revert(runId: string): Promise<void> {
    await this.#db.q
      .deleteFrom('content_applied')
      .where('run_id', '=', runId)
      .where('previous_state', 'is', null)
      .execute()
    await this.#db.q
      .updateTable('content_applied')
      .set((eb) => ({
        run_id: eb.ref('previous_run_id').$notNull(),
        state: eb.ref('previous_state').$notNull(),
        previous_run_id: null,
        previous_state: null,
      }))
      .where('run_id', '=', runId)
      .execute()
  }
}
