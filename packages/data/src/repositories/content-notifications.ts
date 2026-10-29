/**
 * The content notification outbox (story 045): who is to hear of which change
 * to which page, and whether they have. A row is claimed by one node, the same
 * way a form workflow run is: the `state = 'pending'` in the UPDATE is the
 * whole mechanism.
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { sql } from '../query.ts'

export type ContentNotificationState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface ContentNotification {
  id: string
  recipientUserKey: string
  actionId: string
  nodeKey: string
  nodeName: string
  actorUserKey: string | null
  actorName: string | null
  detail: string | null
  occurredAt: Date
  state: ContentNotificationState
  attempts: number
  lastError: string | null
  runAfter: Date
}

export interface NewContentNotification {
  recipientUserKey: string
  actionId: string
  nodeKey: string
  nodeName: string
  actorUserKey: string | null
  actorName: string | null
  detail: string | null
  occurredAt: Date
  runAfter: Date
  /** The content event it was dispatched from (story 171): one row per event, person and action. */
  eventId?: string
}

const COLUMNS = [
  'id',
  'recipient_user_key',
  'action_id',
  'node_key',
  'node_name',
  'actor_user_key',
  'actor_name',
  'detail',
  'occurred_at',
  'state',
  'attempts',
  'last_error',
  'run_after',
] as const

function hydrate(row: Record<string, unknown>): ContentNotification {
  const text = (value: unknown) => (value === null || value === undefined ? null : String(value))
  return {
    id: String(row.id),
    recipientUserKey: String(row.recipient_user_key),
    actionId: String(row.action_id),
    nodeKey: String(row.node_key),
    nodeName: String(row.node_name),
    actorUserKey: text(row.actor_user_key),
    actorName: text(row.actor_name),
    detail: text(row.detail),
    occurredAt: DbDate.fromDb(row.occurred_at) ?? new Date(0),
    state: String(row.state) as ContentNotificationState,
    attempts: Number(row.attempts),
    lastError: text(row.last_error),
    runAfter: DbDate.fromDb(row.run_after) ?? new Date(0),
  }
}

export class ContentNotificationRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async enqueue(rows: readonly NewContentNotification[]): Promise<void> {
    if (rows.length === 0) return
    const now = DbDate.toDb(new Date())
    await this.#db.transaction(async (tx) => {
      for (const row of rows)
        await tx.q
          .insertInto('content_notification')
          .values({
            id: crypto.randomUUID(),
            recipient_user_key: row.recipientUserKey,
            action_id: row.actionId,
            node_key: row.nodeKey,
            node_name: row.nodeName,
            actor_user_key: row.actorUserKey,
            actor_name: row.actorName,
            detail: row.detail,
            occurred_at: DbDate.toDb(row.occurredAt),
            state: 'pending',
            attempts: 0,
            last_error: null,
            run_after: DbDate.toDb(row.runAfter),
            create_date: now,
            update_date: now,
            event_id: row.eventId ?? null,
          })
          .onConflict((oc) => oc.doNothing())
          .execute()
    })
  }

  /** The people with something due to them: each one is a single e-mail. */
  async dueRecipients(now = new Date(), limit = 25): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('content_notification')
      .select('recipient_user_key')
      .where('state', '=', 'pending')
      .where('run_after', '<=', DbDate.toDb(now))
      .groupBy('recipient_user_key')
      .orderBy((eb) => eb.fn.min('run_after'))
      .limit(limit)
      .execute()
    return rows.map((row) => String(row.recipient_user_key))
  }

  /** Takes everything due to one person, or nothing when another node got there first. */
  async claimFor(recipientUserKey: string, now = new Date()): Promise<ContentNotification[]> {
    const rows = await this.#db.q
      .updateTable('content_notification')
      .set({ state: 'running', attempts: sql<number>`attempts + 1`, update_date: DbDate.toDb(now) })
      .where('recipient_user_key', '=', recipientUserKey)
      .where('state', '=', 'pending')
      .where('run_after', '<=', DbDate.toDb(now))
      .returning(COLUMNS)
      .execute()
    return rows.map(hydrate).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
  }

  async #finish(
    ids: readonly string[],
    state: ContentNotificationState,
    error: string | null,
    runAfter?: Date,
  ) {
    if (ids.length === 0) return
    await this.#db.q
      .updateTable('content_notification')
      .set({
        state,
        last_error: error?.slice(0, 2000) ?? null,
        update_date: DbDate.toDb(new Date()),
        ...(runAfter ? { run_after: DbDate.toDb(runAfter) } : {}),
      })
      .where('id', 'in', ids)
      .execute()
  }

  succeed(ids: readonly string[]): Promise<void> {
    return this.#finish(ids, 'done', null)
  }

  /** Not sent, and not to be: the reason is kept for whoever looks. */
  skip(ids: readonly string[], reason: string): Promise<void> {
    return this.#finish(ids, 'skipped', reason)
  }

  /** A failure: back in the queue at `retryAt`, or finished when there is none. */
  fail(ids: readonly string[], error: string, retryAt?: Date): Promise<void> {
    return this.#finish(ids, retryAt ? 'pending' : 'failed', error, retryAt)
  }

  /** Rows a node took and never finished — it died — go back in the queue. */
  async releaseStale(olderThan: Date): Promise<number> {
    const rows = await this.#db.q
      .updateTable('content_notification')
      .set({ state: 'pending', update_date: DbDate.toDb(new Date()) })
      .where('state', '=', 'running')
      .where('update_date', '<', DbDate.toDb(olderThan))
      .returning('id')
      .execute()
    return rows.length
  }

  /** Puts failed notifications back, all or one; answers how many. */
  async retry(id?: string): Promise<number> {
    const now = DbDate.toDb(new Date())
    const rows = await this.#db.q
      .updateTable('content_notification')
      .set({ state: 'pending', attempts: 0, run_after: now, update_date: now })
      .where('state', '=', 'failed')
      .$if(Boolean(id), (q) => q.where('id', '=', id as string))
      .returning('id')
      .execute()
    return rows.length
  }

  async failed(limit = 100): Promise<ContentNotification[]> {
    const rows = await this.#db.q
      .selectFrom('content_notification')
      .select(COLUMNS)
      .where('state', '=', 'failed')
      .orderBy('occurred_at', 'desc')
      .limit(limit)
      .execute()
    return rows.map(hydrate)
  }

  async prune(before: Date): Promise<number> {
    const rows = await this.#db.q
      .deleteFrom('content_notification')
      .where('state', 'in', ['done', 'skipped'])
      .where('update_date', '<', DbDate.toDb(before))
      .returning('id')
      .execute()
    return rows.length
  }

  async forRecipient(recipientUserKey: string): Promise<ContentNotification[]> {
    const rows = await this.#db.q
      .selectFrom('content_notification')
      .select(COLUMNS)
      .where('recipient_user_key', '=', recipientUserKey)
      .orderBy('occurred_at')
      .execute()
    return rows.map(hydrate)
  }

  async all(): Promise<ContentNotification[]> {
    const rows = await this.#db.q
      .selectFrom('content_notification')
      .select(COLUMNS)
      .orderBy('occurred_at')
      .execute()
    return rows.map(hydrate)
  }
}
