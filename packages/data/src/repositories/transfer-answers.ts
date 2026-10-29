/**
 * Pending content imports and the answers given to their conflicts in the
 * backoffice. The answers are laid over a bundle's `resolutions.json` at import.
 */
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'

export interface PendingTransfer {
  bundleId: string
  label: string | null
  /** A package name the site depends on, or a directory on this server. */
  target: string
  targetKind: 'package' | 'directory'
  /** Where the check placed the bundle's roots, as given. */
  under: string | null
  publish: boolean
  allowMissingBlobs: boolean
  checkedAt: Date
  checkedBy: string | null
}

export interface TransferAnswer {
  nodeKey: string
  /** `"*"` for the whole node, else `alias` or `alias@culture`. */
  handle: string
  resolution: string
  answeredBy: string | null
  answeredAt: Date
}

/** Answers as `byNode`, the shape `resolutions.json` and the import take. Pure. */
export function answersByNode(
  answers: readonly Pick<TransferAnswer, 'nodeKey' | 'handle' | 'resolution'>[],
): Record<string, Record<string, string>> {
  const byNode: Record<string, Record<string, string>> = {}
  for (const answer of answers)
    byNode[answer.nodeKey] = {
      ...(byNode[answer.nodeKey] ?? {}),
      [answer.handle]: answer.resolution,
    }
  return byNode
}

const pendingFrom = (row: Record<string, unknown>): PendingTransfer => ({
  bundleId: row.bundle_id as string,
  label: (row.label as string | null) ?? null,
  target: row.target as string,
  targetKind: row.target_kind === 'directory' ? 'directory' : 'package',
  under: (row.under_target as string | null) ?? null,
  publish: fromDbBool(row.publish),
  allowMissingBlobs: fromDbBool(row.allow_missing_blobs),
  checkedAt: DbDate.fromDb(row.checked_at) ?? new Date(0),
  checkedBy: (row.checked_by as string | null) ?? null,
})

export class TransferAnswerRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  /** Records the latest check of a bundle; its answers stand. */
  async recordCheck(pending: PendingTransfer): Promise<void> {
    const bool = (value: boolean) => this.#db.dialect.boolValue(value)
    await this.#db.transaction(async (tx) => {
      await tx.q.deleteFrom('transfer_pending').where('bundle_id', '=', pending.bundleId).execute()
      await tx.q
        .insertInto('transfer_pending')
        .values({
          bundle_id: pending.bundleId,
          label: pending.label,
          target: pending.target,
          target_kind: pending.targetKind,
          under_target: pending.under,
          publish: bool(pending.publish),
          allow_missing_blobs: bool(pending.allowMissingBlobs),
          checked_at: DbDate.toDb(pending.checkedAt),
          checked_by: pending.checkedBy,
        })
        .execute()
    })
  }

  async pending(bundleId: string): Promise<PendingTransfer | undefined> {
    const row = await this.#db.q
      .selectFrom('transfer_pending')
      .selectAll()
      .where('bundle_id', '=', bundleId)
      .executeTakeFirst()
    return row ? pendingFrom(row) : undefined
  }

  async allPending(): Promise<PendingTransfer[]> {
    const rows = await this.#db.q
      .selectFrom('transfer_pending')
      .selectAll()
      .orderBy('checked_at', 'desc')
      .execute()
    return rows.map(pendingFrom)
  }

  async setAllowMissingBlobs(bundleId: string, allow: boolean): Promise<void> {
    await this.#db.q
      .updateTable('transfer_pending')
      .set({ allow_missing_blobs: this.#db.dialect.boolValue(allow) })
      .where('bundle_id', '=', bundleId)
      .execute()
  }

  async answers(bundleId: string): Promise<TransferAnswer[]> {
    const rows = await this.#db.q
      .selectFrom('transfer_answer')
      .selectAll()
      .where('bundle_id', '=', bundleId)
      .orderBy('node_key')
      .orderBy('handle')
      .execute()
    return rows.map((row) => ({
      nodeKey: row.node_key as string,
      handle: row.handle as string,
      resolution: row.resolution as string,
      answeredBy: (row.answered_by as string | null) ?? null,
      answeredAt: DbDate.fromDb(row.answered_at) ?? new Date(0),
    }))
  }

  /** Sets one answer, or clears it when `resolution` is null. */
  async answer(
    bundleId: string,
    answer: { nodeKey: string; handle: string; resolution: string | null; by: string | null },
  ): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await tx.q
        .deleteFrom('transfer_answer')
        .where('bundle_id', '=', bundleId)
        .where('node_key', '=', answer.nodeKey)
        .where('handle', '=', answer.handle)
        .execute()
      if (answer.resolution === null) return
      await tx.q
        .insertInto('transfer_answer')
        .values({
          bundle_id: bundleId,
          node_key: answer.nodeKey,
          handle: answer.handle,
          resolution: answer.resolution,
          answered_by: answer.by,
          answered_at: DbDate.toDb(new Date()),
        })
        .execute()
    })
  }

  /** Once the import is applied there is nothing pending, and nothing left to answer. */
  async clear(bundleId: string): Promise<void> {
    await this.#db.q.deleteFrom('transfer_answer').where('bundle_id', '=', bundleId).execute()
    await this.#db.q.deleteFrom('transfer_pending').where('bundle_id', '=', bundleId).execute()
  }
}
