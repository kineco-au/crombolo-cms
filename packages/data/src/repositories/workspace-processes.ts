/**
 * The processes workspaces render in, as each node reports them (story 396): which
 * run on which node, and each failure, kept for an hour, so any node can answer for
 * the whole site.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

/** How far back failures are counted. */
export const PROCESS_FAILURE_WINDOW_MS = 3600_000

/** One workspace's processes and failures, across the nodes. */
export interface WorkspaceProcessReport {
  key: string
  /** The live nodes running a process for it. */
  nodes: string[]
  failures: number
  lastError: string | null
  /** When its first counted failure happened, or when its oldest process started. */
  since: Date
}

export class WorkspaceProcessRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async started(nodeId: string, workspaceKey: string, now = new Date()): Promise<void> {
    const key = normaliseUuid(workspaceKey)
    await this.stopped(nodeId, key)
    await this.#db.q
      .insertInto('workspace_process')
      .values({ node_id: nodeId, workspace_key: key, started_at: DbDate.toDb(now) })
      .execute()
  }

  async stopped(nodeId: string, workspaceKey: string): Promise<void> {
    await this.#db.q
      .deleteFrom('workspace_process')
      .where('node_id', '=', nodeId)
      .where('workspace_key', '=', normaliseUuid(workspaceKey))
      .execute()
  }

  /** Forgets what a node said it ran: it starts with none. */
  async nodeStarted(nodeId: string): Promise<void> {
    await this.#db.q.deleteFrom('workspace_process').where('node_id', '=', nodeId).execute()
  }

  async failed(
    nodeId: string,
    workspaceKey: string,
    reason: string,
    now = new Date(),
  ): Promise<void> {
    await this.#db.q
      .deleteFrom('workspace_process_failure')
      .where('failed_at', '<', DbDate.toDb(new Date(now.getTime() - PROCESS_FAILURE_WINDOW_MS)))
      .execute()
    await this.#db.q
      .insertInto('workspace_process_failure')
      .values({
        node_id: nodeId,
        workspace_key: normaliseUuid(workspaceKey),
        reason: reason.slice(0, 1000),
        failed_at: DbDate.toDb(now),
      })
      .execute()
  }

  /**
   * Each workspace with a process on a node seen within `seenWithinMs`, or a failure
   * in the last hour, whichever node it was on.
   */
  async report(options: { seenWithinMs: number; now?: Date }): Promise<WorkspaceProcessReport[]> {
    const now = options.now ?? new Date()
    const running = await this.#db.q
      .selectFrom('workspace_process as p')
      .innerJoin('server as s', 's.node_id', 'p.node_id')
      .select(['p.workspace_key', 'p.node_id', 'p.started_at'])
      .where('s.last_seen', '>=', DbDate.toDb(new Date(now.getTime() - options.seenWithinMs)))
      .execute()
    const failures = await this.#db.q
      .selectFrom('workspace_process_failure')
      .select(['workspace_key', 'reason', 'failed_at'])
      .where('failed_at', '>=', DbDate.toDb(new Date(now.getTime() - PROCESS_FAILURE_WINDOW_MS)))
      .orderBy('failed_at')
      .orderBy('id')
      .execute()
    const out = new Map<string, WorkspaceProcessReport>()
    const entry = (key: string, at: Date) => {
      const found = out.get(key)
      if (found) {
        if (at < found.since) found.since = at
        return found
      }
      const made: WorkspaceProcessReport = {
        key,
        nodes: [],
        failures: 0,
        lastError: null,
        since: at,
      }
      out.set(key, made)
      return made
    }
    for (const row of running) {
      const report = entry(String(row.workspace_key), DbDate.fromDb(row.started_at) ?? now)
      report.nodes.push(String(row.node_id))
    }
    for (const row of failures) {
      const report = entry(String(row.workspace_key), DbDate.fromDb(row.failed_at) ?? now)
      report.failures += 1
      report.lastError = String(row.reason)
    }
    for (const report of out.values()) report.nodes.sort()
    return [...out.values()]
  }

  /** How many workspaces failed `atLeast` times in the last hour. */
  async failing(atLeast: number, now = new Date()): Promise<number> {
    const rows = await this.#db.q
      .selectFrom('workspace_process_failure')
      .select(['workspace_key', (eb) => eb.fn.countAll<number>().as('n')])
      .where('failed_at', '>=', DbDate.toDb(new Date(now.getTime() - PROCESS_FAILURE_WINDOW_MS)))
      .groupBy('workspace_key')
      .execute()
    return rows.filter((r) => Number(r.n) >= atLeast).length
  }
}
