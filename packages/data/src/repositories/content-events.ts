/**
 * The content event outbox (story 171): what a change announces, recorded with
 * the change and dispatched after it. Claimed one event at a time, so two nodes
 * never dispatch the same one at once; a claim left behind by a node that died
 * is released after a while.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { sql } from '../query.ts'

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

const COLUMNS = [
  'id',
  'kind',
  'entity_type',
  'entity_key',
  'facts',
  'actor',
  'occurred_at',
  'state',
  'attempts',
  'last_error',
  'run_after',
] as const

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
  const rows = await db.q
    .selectFrom(table)
    .select((eb) => [
      'state',
      eb.fn.countAll<number>().as('n'),
      eb.fn.min('create_date').as('oldest'),
    ])
    .groupBy('state')
    .execute()
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
    await this.#db.q
      .insertInto('content_event')
      .values({
        id,
        kind: event.kind,
        entity_type: event.entityType,
        entity_key: event.entityKey,
        facts: JSON.stringify(event.facts),
        actor: JSON.stringify(event.actor),
        occurred_at: at,
        state: 'pending',
        attempts: 0,
        last_error: null,
        run_after: at,
        create_date: at,
        update_date: at,
      })
      .execute()
    return id
  }

  async due(now = new Date(), limit = 50): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('content_event')
      .select('id')
      .where('state', '=', 'pending')
      .where('run_after', '<=', DbDate.toDb(now))
      .orderBy('occurred_at')
      .orderBy('create_date')
      .limit(limit)
      .execute()
    return rows.map((row) => String(row.id))
  }

  /** Takes an event, or finds another node already has. */
  async claim(id: string): Promise<ContentEvent | undefined> {
    const rows = await this.#db.q
      .updateTable('content_event')
      .set({
        state: 'running',
        attempts: sql<number>`attempts + 1`,
        update_date: DbDate.toDb(new Date()),
      })
      .where('id', '=', id)
      .where('state', '=', 'pending')
      .returning(COLUMNS)
      .execute()
    return rows[0] ? hydrate(rows[0]) : undefined
  }

  async dispatched(id: string): Promise<void> {
    await this.#db.q
      .updateTable('content_event')
      .set({ state: 'dispatched', last_error: null, update_date: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
  }

  /** `retryAt` puts it back in the queue; without one it has failed until someone retries it. */
  async fail(id: string, error: string, retryAt?: Date): Promise<void> {
    await this.#db.q
      .updateTable('content_event')
      .set({
        state: retryAt ? 'pending' : 'failed',
        last_error: error.slice(0, 2000),
        run_after: DbDate.toDb(retryAt ?? new Date()),
        update_date: DbDate.toDb(new Date()),
      })
      .where('id', '=', id)
      .execute()
  }

  /** Claims older than `olderThan` belong to a node that died: they go back in the queue. */
  async releaseStale(olderThan: Date): Promise<number> {
    const rows = await this.#db.q
      .updateTable('content_event')
      .set({ state: 'pending', update_date: DbDate.toDb(new Date()) })
      .where('state', '=', 'running')
      .where('update_date', '<', DbDate.toDb(olderThan))
      .returning('id')
      .execute()
    return rows.length
  }

  /** Puts failed events back, all or one; answers how many. */
  async retry(id?: string): Promise<number> {
    const now = DbDate.toDb(new Date())
    const rows = await this.#db.q
      .updateTable('content_event')
      .set({ state: 'pending', attempts: 0, run_after: now, update_date: now })
      .where('state', '=', 'failed')
      .$if(Boolean(id), (q) => q.where('id', '=', id as string))
      .returning('id')
      .execute()
    return rows.length
  }

  async prune(before: Date): Promise<number> {
    const rows = await this.#db.q
      .deleteFrom('content_event')
      .where('state', '=', 'dispatched')
      .where('update_date', '<', DbDate.toDb(before))
      .returning('id')
      .execute()
    return rows.length
  }

  async byId(id: string): Promise<ContentEvent | undefined> {
    const row = await this.#db.q
      .selectFrom('content_event')
      .select(COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? hydrate(row) : undefined
  }

  async failed(limit = 100): Promise<ContentEvent[]> {
    const rows = await this.#db.q
      .selectFrom('content_event')
      .select(COLUMNS)
      .where('state', '=', 'failed')
      .orderBy('occurred_at', 'desc')
      .limit(limit)
      .execute()
    return rows.map(hydrate)
  }

  async all(): Promise<ContentEvent[]> {
    const rows = await this.#db.q
      .selectFrom('content_event')
      .select(COLUMNS)
      .orderBy('occurred_at')
      .orderBy('create_date')
      .execute()
    return rows.map(hydrate)
  }
}
