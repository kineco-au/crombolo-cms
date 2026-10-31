/**
 * The audit log: who did what, when and from where. Entries are only ever
 * added, read and aged out; nothing edits one. docs/audit-log.md.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Expression, ExpressionBuilder, SqlBool } from 'kysely'
import type { Db } from './database.ts'
import { DbDate } from './dialect.ts'
import { sql } from './query.ts'
import { STATE_AUDIT_LOG } from './schema/audit-log.ts'
import { escapeLike } from './search-text.ts'
import type { CoreTables } from './tables.gen.ts'

export type AuditCategory =
  | 'content'
  | 'media'
  | 'member'
  | 'schema'
  | 'settings'
  | 'user'
  | 'permission'
  | 'sign-in'
  | 'system'

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  'content',
  'media',
  'member',
  'schema',
  'settings',
  'user',
  'permission',
  'sign-in',
  'system',
]

/** Where an entry came from: a request (with its address), the command line, or a background job. */
export type AuditSource = 'request' | 'cli' | 'job' | 'boot'

export interface AuditEntryInput {
  category: AuditCategory
  action: string
  source: AuditSource
  userKey?: string | null
  /** The user's name when the entry was written; for a failed sign-in, the login tried. */
  userName?: string | null
  entityType?: string | null
  entityKey?: string | null
  entityName?: string | null
  ipAddress?: string | null
  forwardedFor?: string | null
  detail?: string | null
  occurredAt?: Date
}

export interface AuditEntry {
  id: number
  occurredAt: Date
  category: AuditCategory
  action: string
  source: AuditSource
  userKey: string | null
  userName: string | null
  entityType: string | null
  entityKey: string | null
  entityName: string | null
  ipAddress: string | null
  forwardedFor: string | null
  detail: string | null
}

export interface AuditFilter {
  userKey?: string
  entityKey?: string
  category?: AuditCategory
  action?: string
  since?: Date
  until?: Date
  /** Matched anywhere in the item's name or key, or the user's name. */
  text?: string
  ascending?: boolean
  /**
   * A person by e-mail, login or key: their account's entries, or, for a login
   * with no account, the entries that name it (a failed sign-in).
   */
  user?: string
}

/** Where a page of entries starts: newest first below `before`, or oldest first above `after`. */
export interface AuditCursor {
  before?: number
  after?: number
  limit: number
}

export interface AuditPage {
  items: AuditEntry[]
  /** The cursor for the next page; null when a newest-first read has reached the end. */
  next: number | null
  /** The `after` cursor names an entry retention has already deleted, so some were missed. */
  truncated: boolean
}

/** An entry as every reader gets it: the dashboard, the command line and a remote. */
export function auditRecord(entry: AuditEntry) {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    category: entry.category,
    action: entry.action,
    source: entry.source,
    user: entry.userKey || entry.userName ? { key: entry.userKey, name: entry.userName } : null,
    item: entry.entityType
      ? { type: entry.entityType, key: entry.entityKey, name: entry.entityName }
      : null,
    ipAddress: entry.ipAddress,
    forwardedFor: entry.forwardedFor,
    detail: entry.detail,
  }
}

export type AuditRecord = ReturnType<typeof auditRecord>

/** What a key names, for an entry to carry once the thing itself has gone. */
export interface AuditSubject {
  entityType: string
  entityKey: string
  entityName: string | null
}

const UUID = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i

const LIMITS = {
  action: 64,
  userName: 255,
  entityType: 64,
  entityKey: 255,
  entityName: 255,
  ipAddress: 64,
  forwardedFor: 255,
  detail: 4000,
} as const

type Condition = (eb: ExpressionBuilder<CoreTables, 'audit_entry'>) => Expression<SqlBool>

const likeLower = (column: string, pattern: string) =>
  sql<SqlBool>`lower(${sql.ref(column)}) like ${pattern} escape '\\'`

function clip(value: string | null | undefined, limit: number): string | null {
  if (value === null || value === undefined || value === '') return null
  return value.length > limit ? value.slice(0, limit) : value
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function toEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id: Number(row.id),
    occurredAt: DbDate.fromDb(row.occurred_at) ?? new Date(0),
    category: String(row.category) as AuditCategory,
    action: String(row.action),
    source: String(row.source) as AuditSource,
    userKey: row.user_key ? normaliseUuid(String(row.user_key)) : null,
    userName: text(row.user_name),
    entityType: text(row.entity_type),
    entityKey: text(row.entity_key),
    entityName: text(row.entity_name),
    ipAddress: text(row.ip_address),
    forwardedFor: text(row.forwarded_for),
    detail: text(row.detail),
  }
}

export class AuditLog {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async record(entries: AuditEntryInput | readonly AuditEntryInput[]): Promise<void> {
    const list = Array.isArray(entries) ? entries : [entries as AuditEntryInput]
    for (const entry of list) {
      const userKey =
        entry.userKey && UUID.test(entry.userKey) ? normaliseUuid(entry.userKey) : null
      const entityKey =
        entry.entityKey && UUID.test(entry.entityKey)
          ? normaliseUuid(entry.entityKey)
          : entry.entityKey
      await this.#db.q
        .insertInto('audit_entry')
        .values({
          occurred_at: DbDate.toDb(entry.occurredAt ?? new Date()),
          category: entry.category,
          action: clip(entry.action, LIMITS.action) as string,
          user_key: userKey,
          user_name: clip(entry.userName, LIMITS.userName),
          entity_type: clip(entry.entityType, LIMITS.entityType),
          entity_key: clip(entityKey, LIMITS.entityKey),
          entity_name: clip(entry.entityName, LIMITS.entityName),
          source: entry.source,
          ip_address: clip(entry.ipAddress, LIMITS.ipAddress),
          forwarded_for: clip(entry.forwardedFor, LIMITS.forwardedFor),
          detail: clip(entry.detail, LIMITS.detail),
        })
        .execute()
    }
  }

  /** The conditions a filter comes to, or undefined when it can match nothing. */
  async #where(filter: AuditFilter): Promise<Condition[] | undefined> {
    const where: Condition[] = []
    if (filter.userKey !== undefined) {
      if (!UUID.test(filter.userKey)) return undefined
      const userKey = normaliseUuid(filter.userKey)
      where.push((eb) => eb('user_key', '=', userKey))
    }
    if (filter.entityKey !== undefined) {
      const entityKey = UUID.test(filter.entityKey)
        ? normaliseUuid(filter.entityKey)
        : filter.entityKey
      where.push((eb) => eb('entity_key', '=', entityKey))
    }
    const { category, action, since, until } = filter
    if (category !== undefined) where.push((eb) => eb('category', '=', category))
    if (action !== undefined) where.push((eb) => eb('action', '=', action))
    if (since !== undefined) where.push((eb) => eb('occurred_at', '>=', DbDate.toDb(since)))
    if (until !== undefined) where.push((eb) => eb('occurred_at', '<', DbDate.toDb(until)))
    const needle = filter.text?.trim().toLowerCase()
    if (needle) {
      const like = `%${escapeLike(needle)}%`
      where.push((eb) =>
        eb.or([
          likeLower('entity_name', like),
          likeLower('entity_key', like),
          likeLower('user_name', like),
        ]),
      )
    }
    if (filter.user !== undefined) {
      const who = filter.user.trim()
      const account = await this.#db.q
        .selectFrom('user_account')
        .select('key')
        .$if(UUID.test(who), (q) => q.where('key', '=', normaliseUuid(who)))
        .$if(!UUID.test(who), (q) =>
          q.where((eb) =>
            eb.or([
              eb(eb.fn('lower', ['email']), '=', eb.fn('lower', [eb.val(who)])),
              eb(eb.fn('lower', ['login']), '=', eb.fn('lower', [eb.val(who)])),
              eb(eb.fn('lower', ['user_name']), '=', eb.fn('lower', [eb.val(who)])),
            ]),
          ),
        )
        .executeTakeFirst()
      if (account) {
        const userKey = normaliseUuid(String(account.key))
        where.push((eb) => eb('user_key', '=', userKey))
      } else if (UUID.test(who)) {
        const userKey = normaliseUuid(who)
        where.push((eb) => eb('user_key', '=', userKey))
      } else {
        where.push((eb) =>
          eb.and([
            eb('user_key', 'is', null),
            eb(eb.fn('lower', ['user_name']), '=', eb.fn('lower', [eb.val(who)])),
          ]),
        )
      }
    }
    return where
  }

  #entries(where: Condition[]) {
    let query = this.#db.q.selectFrom('audit_entry')
    for (const condition of where) query = query.where(condition)
    return query
  }

  async query(
    filter: AuditFilter = {},
    page: { skip: number; take: number } = { skip: 0, take: 100 },
  ): Promise<{ total: number; items: AuditEntry[] }> {
    const where = await this.#where(filter)
    if (!where) return { total: 0, items: [] }
    const counted = await this.#entries(where)
      .select((eb) => eb.fn.countAll().as('total'))
      .executeTakeFirst()
    const order = filter.ascending ? 'asc' : 'desc'
    const rows = await this.#entries(where)
      .selectAll()
      .orderBy('occurred_at', order)
      .orderBy('id', order)
      .limit(page.take)
      .offset(page.skip)
      .execute()
    return { total: Number(counted?.total ?? 0), items: rows.map(toEntry) }
  }

  /**
   * A page by id (story 156): newest first below `before`, or oldest first
   * above `after`, for a reader that resumes where it stopped. Id order is
   * write order, since every entry is stamped as it is written.
   */
  async page(filter: AuditFilter, cursor: AuditCursor): Promise<AuditPage> {
    const ascending = cursor.after !== undefined
    const where = await this.#where(filter)
    if (!where)
      return { items: [], next: ascending ? (cursor.after ?? null) : null, truncated: false }
    const { after, before } = cursor
    if (after !== undefined) where.push((eb) => eb('id', '>', after))
    if (before !== undefined) where.push((eb) => eb('id', '<', before))
    const rows = await this.#entries(where)
      .selectAll()
      .orderBy('id', ascending ? 'asc' : 'desc')
      .limit(cursor.limit)
      .execute()
    const items = rows.map(toEntry)
    const last = items.at(-1)?.id
    const next = ascending
      ? (last ?? cursor.after ?? null)
      : items.length === cursor.limit && last !== undefined
        ? last
        : null
    return { items, next, truncated: ascending && (await this.#pruned(cursor.after as number)) }
  }

  /** Whether the entry a cursor names has gone while older ones are kept no longer. */
  async #pruned(after: number): Promise<boolean> {
    if (after <= 0) return false
    const row = await this.#db.q
      .selectFrom('audit_entry')
      .select((eb) => [
        eb.fn.min('id').as('oldest'),
        eb.fn
          .sum<number | string | null>(eb.case().when('id', '=', after).then(1).else(0).end())
          .as('there'),
      ])
      .executeTakeFirst()
    const oldest = row?.oldest
    return (
      Number(row?.there ?? 0) === 0 &&
      oldest !== null &&
      oldest !== undefined &&
      Number(oldest) > after
    )
  }

  /** Everyone the log names, by the name they had most recently. */
  async users(): Promise<Array<{ key: string; name: string }>> {
    const rows = await this.#db.q
      .selectFrom('audit_entry as e')
      .innerJoin(
        (eb) =>
          eb
            .selectFrom('audit_entry')
            .select((eb) => ['user_key', eb.fn.max('id').as('id')])
            .where('user_key', 'is not', null)
            .groupBy('user_key')
            .as('latest'),
        (join) => join.onRef('latest.id', '=', 'e.id'),
      )
      .select(['e.user_key', 'e.user_name'])
      .orderBy('e.user_name')
      .execute()
    return rows.map((row) => ({
      key: normaliseUuid(String(row.user_key)),
      name: row.user_name ? String(row.user_name) : '',
    }))
  }

  /** Deletes entries older than `before`, and returns how many went. */
  async prune(before: Date): Promise<number> {
    const counted = await this.#db.q
      .selectFrom('audit_entry')
      .select((eb) => eb.fn.countAll().as('total'))
      .where('occurred_at', '<', DbDate.toDb(before))
      .executeTakeFirst()
    const total = Number(counted?.total ?? 0)
    if (total > 0)
      await this.#db.q
        .deleteFrom('audit_entry')
        .where('occurred_at', '<', DbDate.toDb(before))
        .execute()
    return total
  }

  /** When this database began keeping the log; history before it is in the content versions. */
  async startedAt(): Promise<Date | undefined> {
    const row = await this.#db.q
      .selectFrom('migration_history')
      .select((eb) => eb.fn.min('applied_at').as('applied_at'))
      .where('to_state', '=', STATE_AUDIT_LOG)
      .executeTakeFirst()
    return DbDate.fromDb(row?.applied_at)
  }

  /**
   * What a key names. A version answers for the item it belongs to, so a
   * rollback is filed under the page it rolled back.
   */
  async describe(entityType: string, key: string): Promise<AuditSubject> {
    const named = (entityName: unknown, type = entityType, entityKey = key): AuditSubject => ({
      entityType: type,
      entityKey,
      entityName: entityName === null || entityName === undefined ? null : String(entityName),
    })
    if (entityType.endsWith('Version') && /^\d+$/.test(key)) {
      const row = await this.#db.q
        .selectFrom('content_version as cv')
        .innerJoin('node as n', 'n.id', 'cv.node_id')
        .select(['n.unique_id', 'n.text'])
        .where('cv.id', '=', Number(key))
        .executeTakeFirst()
      const owner = entityType.slice(0, -'Version'.length)
      return row ? named(row.text, owner, normaliseUuid(String(row.unique_id))) : named(null)
    }
    if (entityType === 'Language') {
      const row = await this.#db.q
        .selectFrom('language')
        .select('culture_name')
        .where('iso_code', '=', key)
        .executeTakeFirst()
      return named(row?.culture_name ?? null)
    }
    if (!UUID.test(key)) return named(null)
    const uuid = normaliseUuid(key)
    const q = this.#db.q
    const row = await (entityType === 'User'
      ? q.selectFrom('user_account').select('user_name as name').where('key', '=', uuid)
      : entityType === 'UserGroup'
        ? q.selectFrom('user_group').select('name').where('key', '=', uuid)
        : entityType === 'DictionaryItem'
          ? q.selectFrom('dictionary_item').select('item_key as name').where('key', '=', uuid)
          : q.selectFrom('node').select('text as name').where('unique_id', '=', uuid)
    ).executeTakeFirst()
    return named(row?.name ?? null, entityType, uuid)
  }
}
