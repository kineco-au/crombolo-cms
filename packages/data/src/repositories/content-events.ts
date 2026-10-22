/**
 * The content event outbox (story 171): what a change announces, recorded with
 * the change and dispatched after it. Claimed one event at a time, so two nodes
 * never dispatch the same one at once; a claim left behind by a node that died
 * is released after a while.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export type ContentEventState = 'pending' | 'running' | 'dispatched' | 'failed'

export interface NewContentEvent {
  kind: string
  entityType: string
  entityKey: string | null
  /** What was true when the change committed; versioned by its own `v`. */
  facts: Record<string, unknown>
  actor: Record<string, unknown>
}

export interface ContentEvent extends NewContentEvent {
  id: string
  occurredAt: Date
  state: ContentEventState
  attempts: number
  lastError: string | null
  runAfter: Date
}

/** How many items sit in each state, and when the oldest waiting one was queued. */
export interface QueueCounts {
  pending: number
  running: number
  failed: number
  oldestPending: Date | null
}

const COLUMNS =
  'id, kind, entity_type, entity_key, facts, actor, occurred_at, state, attempts, last_error, run_after'

const json = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(String(value ?? '{}')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function hydrate(row: Record<string, unknown>): ContentEvent {
  return {
    id: String(row.id),
    kind: String(row.kind),
    entityType: String(row.entity_type),
    entityKey:
      row.entity_key === null || row.entity_key === undefined ? null : String(row.entity_key),
    facts: json(row.facts),
    actor: json(row.actor),
    occurredAt: DbDate.fromDb(row.occurred_at) ?? new Date(0),
    state: String(row.state) as ContentEventState,
    attempts: Number(row.attempts),
    lastError: (row.last_error as string | null) ?? null,
    runAfter: DbDate.fromDb(row.run_after) ?? new Date(0),
  }
}

/** Counts by state for a queue table, and its oldest pending item's date. */
export async function queueCounts(
  db: Db,
  table: 'content_event' | 'webhook_delivery' | 'content_notification',
): Promise<QueueCounts> {
  const rows = await db.query<{ state: string; n: number; oldest: unknown }>(
    `SELECT state, COUNT(*) AS n, MIN(create_date) AS oldest FROM ${table} GROUP BY state`,
  )
  const of = (state: string) => rows.find((row) => row.state === state)
  return {
    pending: Number(of('pending')?.n ?? 0),
    running: Number(of('running')?.n ?? 0),
    failed: Number(of('failed')?.n ?? 0),
    oldestPending: DbDate.fromDb(of('pending')?.oldest) ?? null,
  }
}

export class ContentEventRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Records an event; called inside the change's transaction, so it commits with it. */
  async record(event: NewContentEvent, now = new Date()): Promise<string> {
    const id = crypto.randomUUID()
    const at = DbDate.toDb(now)
    await this.#db.exec(
      `INSERT INTO content_event (${COLUMNS}, create_date, update_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, ?, ?, ?)`,
      [
        id,
        event.kind,
        event.entityType,
        event.entityKey,
        JSON.stringify(event.facts),
        JSON.stringify(event.actor),
        at,
        at,
        at,
        at,
      ],
    )
    return id
  }

  async due(now = new Date(), limit = 50): Promise<string[]> {
    const rows = await this.#db.query<{ id: string }>(
      `SELECT id FROM content_event WHERE state = 'pending' AND run_after <= ?
        ORDER BY occurred_at, create_date LIMIT ?`,
      [DbDate.toDb(now), limit],
    )
    return rows.map((row) => String(row.id))
  }

  /** Takes an event, or finds another node already has. */
  async claim(id: string): Promise<ContentEvent | undefined> {
    const rows = await this.#db.query(
      `UPDATE content_event SET state = 'running', attempts = attempts + 1, update_date = ?
        WHERE id = ? AND state = 'pending' RETURNING ${COLUMNS}`,
      [DbDate.toDb(new Date()), id],
    )
    return rows[0] ? hydrate(rows[0]) : undefined
  }

  async dispatched(id: string): Promise<void> {
    await this.#db.exec(
      `UPDATE content_event SET state = 'dispatched', last_error = NULL, update_date = ? WHERE id = ?`,
      [DbDate.toDb(new Date()), id],
    )
  }

  /** `retryAt` puts it back in the queue; without one it has failed until someone retries it. */
  async fail(id: string, error: string, retryAt?: Date): Promise<void> {
    await this.#db.exec(
      'UPDATE content_event SET state = ?, last_error = ?, run_after = ?, update_date = ? WHERE id = ?',
      [
        retryAt ? 'pending' : 'failed',
        error.slice(0, 2000),
        DbDate.toDb(retryAt ?? new Date()),
        DbDate.toDb(new Date()),
        id,
      ],
    )
  }

  /** Claims older than `olderThan` belong to a node that died: they go back in the queue. */
  async releaseStale(olderThan: Date): Promise<number> {
    const rows = await this.#db.query(
      `UPDATE content_event SET state = 'pending', update_date = ?
        WHERE state = 'running' AND update_date < ? RETURNING id`,
      [DbDate.toDb(new Date()), DbDate.toDb(olderThan)],
    )
    return rows.length
  }

  /** Puts failed events back, all or one; answers how many. */
  async retry(id?: string): Promise<number> {
    const now = DbDate.toDb(new Date())
    const rows = await this.#db.query(
      `UPDATE content_event SET state = 'pending', attempts = 0, run_after = ?, update_date = ?
        WHERE state = 'failed'${id ? ' AND id = ?' : ''} RETURNING id`,
      id ? [now, now, id] : [now, now],
    )
    return rows.length
  }

  async prune(before: Date): Promise<number> {
    const rows = await this.#db.query(
      `DELETE FROM content_event WHERE state = 'dispatched' AND update_date < ? RETURNING id`,
      [DbDate.toDb(before)],
    )
    return rows.length
  }

  async byId(id: string): Promise<ContentEvent | undefined> {
    const rows = await this.#db.query(`SELECT ${COLUMNS} FROM content_event WHERE id = ?`, [id])
    return rows[0] ? hydrate(rows[0]) : undefined
  }

  async failed(limit = 100): Promise<ContentEvent[]> {
    const rows = await this.#db.query(
      `SELECT ${COLUMNS} FROM content_event WHERE state = 'failed' ORDER BY occurred_at DESC LIMIT ?`,
      [limit],
    )
    return rows.map(hydrate)
  }

  async all(): Promise<ContentEvent[]> {
    const rows = await this.#db.query(
      `SELECT ${COLUMNS} FROM content_event ORDER BY occurred_at, create_date`,
    )
    return rows.map(hydrate)
  }
}
