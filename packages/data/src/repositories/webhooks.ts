/**
 * Webhooks kept in this environment, and the delivery queue and log every
 * webhook and bundle event handler shares. docs/webhooks.md.
 *
 * A delivery is claimed with `UPDATE … WHERE state = 'pending' … RETURNING`, as
 * form workflows are, so on a cluster exactly one node delivers each.
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'

export interface WebhookRow {
  key: string
  name: string | null
  description: string | null
  url: string
  enabled: boolean
  events: string[]
  contentTypeKeys: string[]
  /** The headers as one sealed value; the server holds the key that opens it. */
  sealedHeaders: string | null
}

const parseList = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value ?? '[]')) as unknown
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

export class WebhookRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  async all(): Promise<WebhookRow[]> {
    const rows = await this.#db.q
      .selectFrom('webhook')
      .select([
        'key',
        'name',
        'description',
        'url',
        'enabled',
        'events',
        'content_type_keys',
        'headers',
      ])
      .orderBy('create_date')
      .orderBy('key')
      .execute()
    return rows.map((row) => ({
      key: String(row.key),
      name: (row.name as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      url: String(row.url),
      enabled: fromDbBool(row.enabled),
      events: parseList(row.events),
      contentTypeKeys: parseList(row.content_type_keys),
      sealedHeaders: (row.headers as string | null) ?? null,
    }))
  }

  async byKey(key: string): Promise<WebhookRow | undefined> {
    return (await this.all()).find((row) => row.key === key.toLowerCase())
  }

  async save(webhook: WebhookRow): Promise<void> {
    const now = DbDate.toDb(new Date())
    const values = {
      name: webhook.name,
      description: webhook.description,
      url: webhook.url,
      enabled: this.#db.dialect.boolValue(webhook.enabled),
      events: JSON.stringify(webhook.events),
      content_type_keys: JSON.stringify(webhook.contentTypeKeys),
      headers: webhook.sealedHeaders,
      update_date: now,
    }
    const updated = await this.#db.q
      .updateTable('webhook')
      .set(values)
      .where('key', '=', webhook.key.toLowerCase())
      .returning('key')
      .execute()
    if (updated.length > 0) return
    await this.#db.q
      .insertInto('webhook')
      .values({ ...values, key: webhook.key.toLowerCase(), create_date: now })
      .execute()
  }

  async remove(key: string): Promise<boolean> {
    const rows = await this.#db.q
      .deleteFrom('webhook')
      .where('key', '=', key.toLowerCase())
      .returning('key')
      .execute()
    return rows.length > 0
  }
}

export type WebhookDeliveryState = 'pending' | 'running' | 'done' | 'failed'

export interface WebhookDelivery {
  id: string
  /** A webhook's key, or `bundle:<id>` for a bundle's handler. */
  subscriber: string
  eventAlias: string
  payload: unknown
  state: WebhookDeliveryState
  attempts: number
  lastError: string | null
  runAfter: Date
  createDate: Date
  /** The content event it was dispatched from (story 171); null for one raised before. */
  eventId: string | null
}

export interface WebhookLogEntry {
  key: string
  deliveryId: string
  subscriber: string
  eventAlias: string
  url: string
  statusCode: number | null
  success: boolean
  exception: boolean
  retryCount: number
  requestHeaders: string
  requestBody: string
  responseHeaders: string
  responseBody: string
  date: Date
}

const DELIVERY_COLUMNS = [
  'id',
  'subscriber',
  'event_alias',
  'payload',
  'state',
  'attempts',
  'last_error',
  'run_after',
  'create_date',
  'event_id',
] as const

const hydrateDelivery = (row: Record<string, unknown>): WebhookDelivery => {
  let payload: unknown = null
  try {
    payload = JSON.parse(String(row.payload))
  } catch {
    payload = null
  }
  return {
    id: String(row.id),
    subscriber: String(row.subscriber),
    eventAlias: String(row.event_alias),
    payload,
    state: String(row.state) as WebhookDeliveryState,
    attempts: Number(row.attempts),
    lastError: (row.last_error as string | null) ?? null,
    runAfter: DbDate.fromDb(row.run_after) ?? new Date(0),
    createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
    eventId: row.event_id === null || row.event_id === undefined ? null : String(row.event_id),
  }
}

/** Bodies and headers are kept to what a person will read, not what a server sent. */
const clip = (value: string) => value.slice(0, 10_000)

export class WebhookDeliveryRepository {
  #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  /**
   * Queues deliveries. One per event and subscriber: a dispatcher repeating a
   * step after a crash queues nothing twice. Answers the ids actually queued.
   */
  async enqueue(
    deliveries: ReadonlyArray<{
      subscriber: string
      eventAlias: string
      payload: unknown
      eventId?: string
    }>,
    now = new Date(),
  ): Promise<string[]> {
    const ids: string[] = []
    for (const delivery of deliveries) {
      const id = randomUUID()
      const rows = await this.#db.q
        .insertInto('webhook_delivery')
        .values({
          id,
          subscriber: delivery.subscriber,
          event_alias: delivery.eventAlias,
          payload: JSON.stringify(delivery.payload),
          state: 'pending',
          attempts: 0,
          last_error: null,
          run_after: DbDate.toDb(now),
          create_date: DbDate.toDb(now),
          event_id: delivery.eventId ?? null,
          update_date: DbDate.toDb(now),
        })
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .execute()
      if (rows.length > 0) ids.push(id)
    }
    return ids
  }

  /** Claims older than `olderThan` belong to a node that died: they go back in the queue. */
  async releaseStale(olderThan: Date): Promise<number> {
    const rows = await this.#db.q
      .updateTable('webhook_delivery')
      .set({ state: 'pending', update_date: DbDate.toDb(new Date()) })
      .where('state', '=', 'running')
      .where('update_date', '<', DbDate.toDb(olderThan))
      .returning('id')
      .execute()
    return rows.length
  }

  /** Puts failed deliveries back, all or one; answers how many. */
  async retry(id?: string): Promise<number> {
    const now = DbDate.toDb(new Date())
    const rows = await this.#db.q
      .updateTable('webhook_delivery')
      .set({ state: 'pending', attempts: 0, run_after: now, update_date: now })
      .where('state', '=', 'failed')
      .$if(Boolean(id), (q) => q.where('id', '=', id as string))
      .returning('id')
      .execute()
    return rows.length
  }

  /** Delivered rows and log entries older than `before` go; failed ones stay until retried. */
  async prune(before: Date): Promise<number> {
    const done = await this.#db.q
      .deleteFrom('webhook_delivery')
      .where('state', '=', 'done')
      .where('update_date', '<', DbDate.toDb(before))
      .returning('id')
      .execute()
    const logged = await this.#db.q
      .deleteFrom('webhook_log')
      .where('log_date', '<', DbDate.toDb(before))
      .returning('key')
      .execute()
    return done.length + logged.length
  }

  async failed(limit = 100): Promise<WebhookDelivery[]> {
    const rows = await this.#db.q
      .selectFrom('webhook_delivery')
      .select(DELIVERY_COLUMNS)
      .where('state', '=', 'failed')
      .orderBy('update_date', 'desc')
      .limit(limit)
      .execute()
    return rows.map(hydrateDelivery)
  }

  async all(): Promise<WebhookDelivery[]> {
    const rows = await this.#db.q
      .selectFrom('webhook_delivery')
      .select(DELIVERY_COLUMNS)
      .orderBy('create_date')
      .execute()
    return rows.map(hydrateDelivery)
  }

  async due(now = new Date(), limit = 25): Promise<WebhookDelivery[]> {
    const rows = await this.#db.q
      .selectFrom('webhook_delivery')
      .select(DELIVERY_COLUMNS)
      .where('state', '=', 'pending')
      .where('run_after', '<=', DbDate.toDb(now))
      .orderBy('run_after')
      .orderBy('create_date')
      .limit(limit)
      .execute()
    return rows.map(hydrateDelivery)
  }

  /** Takes a delivery, or finds another node already has. */
  async claim(id: string): Promise<WebhookDelivery | undefined> {
    const row = await this.#db.q
      .updateTable('webhook_delivery')
      .set((eb) => ({
        state: 'running',
        attempts: eb('attempts', '+', 1),
        update_date: DbDate.toDb(new Date()),
      }))
      .where('id', '=', id)
      .where('state', '=', 'pending')
      .returning(DELIVERY_COLUMNS)
      .executeTakeFirst()
    return row ? hydrateDelivery(row) : undefined
  }

  async succeed(id: string): Promise<void> {
    await this.#db.q
      .updateTable('webhook_delivery')
      .set({ state: 'done', last_error: null, update_date: DbDate.toDb(new Date()) })
      .where('id', '=', id)
      .execute()
  }

  /** `retryAt` puts it back in the queue; without one it has failed for good. */
  async fail(id: string, error: string, retryAt?: Date): Promise<void> {
    await this.#db.q
      .updateTable('webhook_delivery')
      .set({
        state: retryAt ? 'pending' : 'failed',
        last_error: error.slice(0, 2000),
        run_after: DbDate.toDb(retryAt ?? new Date()),
        update_date: DbDate.toDb(new Date()),
      })
      .where('id', '=', id)
      .execute()
  }

  async byId(id: string): Promise<WebhookDelivery | undefined> {
    const row = await this.#db.q
      .selectFrom('webhook_delivery')
      .select(DELIVERY_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst()
    return row ? hydrateDelivery(row) : undefined
  }

  async log(entry: Omit<WebhookLogEntry, 'key' | 'date'>, date = new Date()): Promise<void> {
    await this.#db.q
      .insertInto('webhook_log')
      .values({
        key: randomUUID(),
        delivery_id: entry.deliveryId,
        subscriber: entry.subscriber,
        event_alias: entry.eventAlias,
        url: entry.url,
        status_code: entry.statusCode,
        success: this.#db.dialect.boolValue(entry.success),
        exception: this.#db.dialect.boolValue(entry.exception),
        retry_count: entry.retryCount,
        request_headers: clip(entry.requestHeaders),
        request_body: clip(entry.requestBody),
        response_headers: clip(entry.responseHeaders),
        response_body: clip(entry.responseBody),
        log_date: DbDate.toDb(date),
      })
      .execute()
  }

  /** The log, newest first; one subscriber's when named. */
  async logs(options: {
    subscriber?: string
    skip: number
    take: number
  }): Promise<{ total: number; items: WebhookLogEntry[] }> {
    const { subscriber } = options
    const log = this.#db.q
      .selectFrom('webhook_log')
      .$if(Boolean(subscriber), (q) => q.where('subscriber', '=', subscriber as string))
    const total = await log.select((eb) => eb.fn.countAll().as('n')).executeTakeFirst()
    const rows = await log
      .select([
        'key',
        'delivery_id',
        'subscriber',
        'event_alias',
        'url',
        'status_code',
        'success',
        'exception',
        'retry_count',
        'request_headers',
        'request_body',
        'response_headers',
        'response_body',
        'log_date',
      ])
      .orderBy('log_date', 'desc')
      .orderBy('retry_count', 'desc')
      .orderBy('key')
      .limit(options.take)
      .offset(options.skip)
      .execute()
    return {
      total: Number(total?.n ?? 0),
      items: rows.map((row) => ({
        key: String(row.key),
        deliveryId: String(row.delivery_id),
        subscriber: String(row.subscriber),
        eventAlias: String(row.event_alias),
        url: String(row.url),
        statusCode:
          row.status_code === null || row.status_code === undefined
            ? null
            : Number(row.status_code),
        success: fromDbBool(row.success),
        exception: fromDbBool(row.exception),
        retryCount: Number(row.retry_count),
        requestHeaders: String(row.request_headers),
        requestBody: String(row.request_body),
        responseHeaders: String(row.response_headers),
        responseBody: String(row.response_body),
        date: DbDate.fromDb(row.log_date) ?? new Date(0),
      })),
    }
  }
}
