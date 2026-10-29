/**
 * What content imports have been applied here, and what each one touched.
 *
 * The rows exist so that reverting is a lookup rather than a guess: each change
 * remembers the event its node was at beforehand and the published event it was
 * serving, which together *are* the previously-live state.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { sql } from '../query.ts'

export type TransferDirection = 'import' | 'revert'
export type TransferRunStatus = 'applied' | 'reverted' | 'failed'
/**
 * What a run did to one node.
 *
 * `unchanged` is recorded too: a run that decided to do nothing still owns the
 * node. `recycle` is what a *revert* does to a node the import created, and it
 * is recorded so that reverting the revert knows to bring it back out of the
 * bin rather than only restoring its values.
 */
export type TransferAction = 'create' | 'update' | 'unchanged' | 'skip' | 'recycle'

export interface TransferRun {
  id: string
  bundleId: string
  bundleLabel: string | null
  /** The npm package the content arrived in, and its version. */
  packageName: string | null
  packageVersion: string | null
  direction: TransferDirection
  revertsRunId: string | null
  schemaStateId: number
  startedAt: Date
  finishedAt: Date | null
  appliedBy: string | null
  nodeCount: number
  status: TransferRunStatus
}

export interface TransferChange {
  id: number
  runId: string
  nodeKey: string
  kind: string
  action: TransferAction
  /** The node's latest event before this run, or null when the run created it. */
  beforeEventId: number | null
  /** The event it was serving before this run, or null if it was not published. */
  beforePublishedEventId: number | null
  /** The event this run appended, when it appended one. */
  eventId: number | null
}

export class TransferRunRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  async start(run: Omit<TransferRun, 'finishedAt' | 'status'>): Promise<void> {
    await this.#db.q
      .insertInto('content_transfer_run')
      .values({
        id: run.id,
        bundle_id: run.bundleId,
        bundle_label: run.bundleLabel,
        package_name: run.packageName,
        package_version: run.packageVersion,
        direction: run.direction,
        reverts_run_id: run.revertsRunId,
        schema_state_id: run.schemaStateId,
        started_at: DbDate.toDb(run.startedAt),
        applied_by: run.appliedBy,
        node_count: run.nodeCount,
        status: 'applied',
      })
      .execute()
  }

  async finish(id: string, nodeCount: number): Promise<void> {
    await this.#db.q
      .updateTable('content_transfer_run')
      .set({ finished_at: DbDate.toDb(new Date()), node_count: nodeCount })
      .where('id', '=', id)
      .execute()
  }

  async setStatus(id: string, status: TransferRunStatus): Promise<void> {
    await this.#db.q
      .updateTable('content_transfer_run')
      .set({ status })
      .where('id', '=', id)
      .execute()
  }

  async record(change: Omit<TransferChange, 'id'>): Promise<void> {
    await this.#db.q
      .insertInto('content_transfer_change')
      .values({
        run_id: change.runId,
        node_key: change.nodeKey,
        kind: change.kind,
        action: change.action,
        before_event_id: change.beforeEventId,
        before_published_event_id: change.beforePublishedEventId,
        event_id: change.eventId,
      })
      .execute()
  }

  async byId(id: string): Promise<TransferRun | undefined> {
    const row = await this.#db.q
      .selectFrom('content_transfer_run')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? mapRun(row) : undefined
  }

  /**
   * The import of this bundle that still stands here, if there is one. A run
   * that was reverted does not count: the content is gone, so importing again
   * is the right answer. This is what makes `start --bundle` import once.
   */
  async appliedFor(bundleId: string): Promise<TransferRun | undefined> {
    const row = await this.#standing().where('bundle_id', '=', bundleId).executeTakeFirst()
    return row ? mapRun(row) : undefined
  }

  /** The latest standing import of a package's content, whichever version brought it. */
  async appliedForPackage(packageName: string): Promise<TransferRun | undefined> {
    const row = await this.#standing().where('package_name', '=', packageName).executeTakeFirst()
    return row ? mapRun(row) : undefined
  }

  /** The latest standing import, narrowed by the caller. */
  #standing() {
    return this.#db.q
      .selectFrom('content_transfer_run')
      .selectAll()
      .where('direction', '=', 'import')
      .where('status', '=', 'applied')
      .orderBy('started_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
  }

  /** Runs, newest first. */
  async recent(limit = 20, offset = 0): Promise<TransferRun[]> {
    const rows = await this.#db.q
      .selectFrom('content_transfer_run')
      .selectAll()
      .orderBy('started_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute()
    return rows.map(mapRun)
  }

  async count(): Promise<number> {
    const row = await this.#db.q
      .selectFrom('content_transfer_run')
      .select(sql<number>`count(*)`.as('n'))
      .executeTakeFirst()
    return Number(row?.n ?? 0)
  }

  async changes(runId: string): Promise<TransferChange[]> {
    const rows = await this.#db.q
      .selectFrom('content_transfer_change')
      .selectAll()
      .where('run_id', '=', runId)
      .orderBy('id')
      .execute()
    return rows.map(mapChange)
  }

  /**
   * Runs after this one that touched any of the same nodes. Reverting while one
   * of these stands would quietly undo its work too, so revert refuses.
   */
  async laterRunsTouching(runId: string): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('content_transfer_change as mine')
      .innerJoin('content_transfer_change as theirs', 'theirs.node_key', 'mine.node_key')
      .innerJoin('content_transfer_run as later', 'later.id', 'theirs.run_id')
      .innerJoin('content_transfer_run as self', 'self.id', 'mine.run_id')
      .select('later.id')
      .distinct()
      .where('mine.run_id', '=', runId)
      .whereRef('theirs.run_id', '<>', 'mine.run_id')
      .whereRef('later.started_at', '>=', 'self.started_at')
      .where('later.status', '=', 'applied')
      .execute()
    return rows.map((row) => String(row.id))
  }
}

function mapRun(row: Record<string, unknown>): TransferRun {
  return {
    id: String(row.id),
    bundleId: String(row.bundle_id),
    bundleLabel: (row.bundle_label as string | null) ?? null,
    packageName: (row.package_name as string | null) ?? null,
    packageVersion: (row.package_version as string | null) ?? null,
    direction: String(row.direction) as TransferDirection,
    revertsRunId: (row.reverts_run_id as string | null) ?? null,
    schemaStateId: Number(row.schema_state_id),
    startedAt: DbDate.fromDb(row.started_at) ?? new Date(0),
    finishedAt: DbDate.fromDb(row.finished_at) ?? null,
    appliedBy: (row.applied_by as string | null) ?? null,
    nodeCount: Number(row.node_count),
    status: String(row.status) as TransferRunStatus,
  }
}

function mapChange(row: Record<string, unknown>): TransferChange {
  const int = (value: unknown) => (value === null || value === undefined ? null : Number(value))
  return {
    id: Number(row.id),
    runId: String(row.run_id),
    nodeKey: String(row.node_key),
    kind: String(row.kind),
    action: String(row.action) as TransferAction,
    beforeEventId: int(row.before_event_id),
    beforePublishedEventId: int(row.before_published_event_id),
    eventId: int(row.event_id),
  }
}
