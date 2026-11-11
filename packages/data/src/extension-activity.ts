/**
 * What each extension did (story 327): its writes, requests out, rows written,
 * refusals, calls and screens one row each, and its reads counted per minute.
 * Read by Installed's Activity view, newest first; pruned by the window the
 * site keeps. docs/extensions.md, "Watching one".
 */
import type { Db } from './database.ts'
import { DbDate } from './dialect.ts'

export type ActivityKind = 'read' | 'write' | 'request' | 'rows' | 'call' | 'screen' | 'refused'
export const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'read',
  'write',
  'request',
  'rows',
  'call',
  'screen',
  'refused',
]

export type ActivityOutcome = 'ok' | 'failed' | 'refused'

export interface ActivityInput {
  extensionId: string
  /** Whom it acted for; null when it acted as itself. */
  personKey: string | null
  personName: string | null
  kind: ActivityKind
  /** The area, the host, the table, or the route or screen it called. */
  area: string | null
  verb: string | null
  entityKey: string | null
  count: number
  outcome: ActivityOutcome
  ms: number | null
  occurredAt: Date
}

export interface ActivityEntry extends ActivityInput {
  id: number
}

export interface ActivityFilter {
  kind?: ActivityKind
  /** A person's key, or `itself` for what it did as itself. */
  person?: string
  since?: Date
  until?: Date
}

const MAX_TEXT = 255
const clip = (value: string | null): string | null =>
  value === null ? null : value.slice(0, MAX_TEXT)

export class ExtensionActivityLog {
  readonly #db: Db
  constructor(db: Db) {
    this.#db = db
  }

  async record(rows: readonly ActivityInput[]): Promise<void> {
    if (rows.length === 0) return
    await this.#db.q
      .insertInto('extension_activity')
      .values(
        rows.map((row) => ({
          extension_id: row.extensionId,
          person_key: clip(row.personKey),
          person_name: clip(row.personName),
          kind: row.kind,
          area: clip(row.area),
          verb: clip(row.verb),
          entity_key: clip(row.entityKey),
          count: row.count,
          outcome: row.outcome,
          ms: row.ms === null ? null : Math.round(row.ms),
          occurred_at: DbDate.toDb(row.occurredAt),
        })),
      )
      .execute()
  }

  #filtered(extensionId: string, filter: ActivityFilter) {
    let query = this.#db.q.selectFrom('extension_activity').where('extension_id', '=', extensionId)
    if (filter.kind) query = query.where('kind', '=', filter.kind)
    if (filter.person === 'itself') query = query.where('person_key', 'is', null)
    else if (filter.person) query = query.where('person_key', '=', filter.person)
    if (filter.since) query = query.where('occurred_at', '>=', DbDate.toDb(filter.since))
    if (filter.until) query = query.where('occurred_at', '<', DbDate.toDb(filter.until))
    return query
  }

  /** Newest first, below `before` when given. */
  async page(
    extensionId: string,
    filter: ActivityFilter,
    cursor: { before?: number; limit: number },
  ): Promise<{ items: ActivityEntry[]; next: number | null }> {
    let query = this.#filtered(extensionId, filter)
    if (cursor.before !== undefined) query = query.where('id', '<', cursor.before)
    const rows = await query.selectAll().orderBy('id', 'desc').limit(cursor.limit).execute()
    const items = rows.map(
      (row): ActivityEntry => ({
        id: Number(row.id),
        extensionId: row.extension_id,
        personKey: row.person_key ?? null,
        personName: row.person_name ?? null,
        kind: row.kind as ActivityKind,
        area: row.area ?? null,
        verb: row.verb ?? null,
        entityKey: row.entity_key ?? null,
        count: Number(row.count),
        outcome: row.outcome as ActivityOutcome,
        ms: row.ms === null || row.ms === undefined ? null : Number(row.ms),
        occurredAt: DbDate.fromDb(row.occurred_at) ?? new Date(0),
      }),
    )
    return {
      items,
      next: items.length === cursor.limit ? (items.at(-1)?.id ?? null) : null,
    }
  }

  /** How many of each kind since a time, reads counted as many as were made. */
  async counts(extensionId: string, since?: Date): Promise<Record<ActivityKind, number>> {
    const rows = await this.#filtered(extensionId, { since })
      .select((eb) => ['kind', eb.fn.sum<number | string>('count').as('total')])
      .groupBy('kind')
      .execute()
    const out = Object.fromEntries(ACTIVITY_KINDS.map((kind) => [kind, 0])) as Record<
      ActivityKind,
      number
    >
    for (const row of rows) out[row.kind as ActivityKind] = Number(row.total ?? 0)
    return out
  }

  /** Everyone it acted for, by the name it last recorded. */
  async people(extensionId: string): Promise<Array<{ key: string; name: string }>> {
    const rows = await this.#filtered(extensionId, {})
      .where('person_key', 'is not', null)
      .select((eb) => ['person_key', eb.fn.max('person_name').as('name')])
      .groupBy('person_key')
      .execute()
    return rows.map((row) => ({ key: String(row.person_key), name: String(row.name ?? '') }))
  }

  /** Deletes what is older than `before`; how many went. Counted first, as the wrapper does not say. */
  async prune(before: Date): Promise<number> {
    const counted = await this.#db.q
      .selectFrom('extension_activity')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('occurred_at', '<', DbDate.toDb(before))
      .executeTakeFirst()
    const total = Number(counted?.total ?? 0)
    if (total > 0)
      await this.#db.q
        .deleteFrom('extension_activity')
        .where('occurred_at', '<', DbDate.toDb(before))
        .execute()
    return total
  }

  /** Keeps an extension's newest `max` rows and deletes the rest; how many went. */
  async cap(extensionId: string, max: number): Promise<number> {
    const edge = await this.#db.q
      .selectFrom('extension_activity')
      .select('id')
      .where('extension_id', '=', extensionId)
      .orderBy('id', 'desc')
      .offset(max)
      .limit(1)
      .executeTakeFirst()
    if (!edge) return 0
    const counted = await this.#db.q
      .selectFrom('extension_activity')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('extension_id', '=', extensionId)
      .where('id', '<=', Number(edge.id))
      .executeTakeFirst()
    await this.#db.q
      .deleteFrom('extension_activity')
      .where('extension_id', '=', extensionId)
      .where('id', '<=', Number(edge.id))
      .execute()
    return Number(counted?.total ?? 0)
  }

  /** The extensions it has rows for, for the cap. */
  async extensions(): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('extension_activity')
      .select('extension_id')
      .distinct()
      .execute()
    return rows.map((row) => row.extension_id)
  }
}
