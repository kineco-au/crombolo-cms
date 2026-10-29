/**
 * Redirects: the routes a page used to answer on, and the rules a site declares.
 *
 * Tracking writes a rule per route a publish or a move retired; the site's own
 * `redirects` config is synced into the same table so the backoffice can list
 * everything in force, and those rows are marked `config` and refuse to be
 * deleted through the API — the file owns them. A rule an administrator wrote in
 * the backoffice is `manual`, and is the only kind this repository will let a
 * bundle touch (`server/src/bundles.ts`).
 *
 * A rule is identified by what it matches (kind, pattern, hostname root and
 * culture), so re-registering a route replaces where it points instead of
 * stacking another row behind it, which is how Umbraco's "most recent wins"
 * ends up behaving without the duplicates.
 */
import { normaliseUuid } from '@crombolo/core'
import type { SelectQueryBuilder } from 'kysely'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { sql } from '../query.ts'
import type { CoreTables } from '../tables.gen.ts'

export type RedirectMatchKind = 'exact' | 'prefix' | 'regex'
export type RedirectTargetKind = 'document' | 'path' | 'url'
/**
 * Where a rule came from, and — because `ORDER` sorts on this column — its
 * precedence: `config` before `manual` before `tracked`, which is alphabetical
 * and so needs no CASE expression. That order is the intent, not a coincidence:
 * a rule in the site's code outranks one an administrator typed, which outranks
 * one a rename recorded by itself.
 */
export type RedirectSource = 'tracked' | 'config' | 'manual'

export interface RedirectRow {
  key: string
  source: RedirectSource
  matchKind: RedirectMatchKind
  pattern: string
  rootKey: string | null
  culture: string | null
  targetKind: RedirectTargetKind
  target: string
  statusCode: number
  sortOrder: number
  createDate: Date
}

/** A rule to store; `key` and `createDate` are assigned when it is new. */
export type RedirectInput = Omit<RedirectRow, 'key' | 'createDate'>

interface Row {
  key: string
  source: string
  match_kind: string
  pattern: string
  root_key: string | null
  culture: string | null
  target_kind: string
  target: string
  status_code: number
  sort_order: number
  create_date: unknown
}

const COLUMNS = [
  'key',
  'source',
  'match_kind',
  'pattern',
  'root_key',
  'culture',
  'target_kind',
  'target',
  'status_code',
  'sort_order',
  'create_date',
] as const

const selectRules = (db: Db) => db.q.selectFrom('redirect_url').select(COLUMNS)

/** By source — see `RedirectSource` — then by the rule's own order, newest first. */
// biome-ignore lint/suspicious/noExplicitAny: any select over redirect_url
const ordered = <Q extends SelectQueryBuilder<CoreTables, 'redirect_url', any>>(query: Q): Q =>
  query
    .orderBy('source')
    .orderBy('sort_order')
    .orderBy('create_date', 'desc')
    .orderBy('id', 'desc') as Q

const hydrate = (row: Row): RedirectRow => ({
  key: normaliseUuid(String(row.key)),
  source: String(row.source) as RedirectSource,
  matchKind: String(row.match_kind) as RedirectMatchKind,
  pattern: String(row.pattern),
  rootKey: row.root_key === null ? null : String(row.root_key),
  culture: row.culture === null ? null : String(row.culture),
  targetKind: String(row.target_kind) as RedirectTargetKind,
  target: String(row.target),
  statusCode: Number(row.status_code),
  sortOrder: Number(row.sort_order),
  createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
})

/** A digest of everything a rule matches on; see migration 015. */
export function matchHash(input: {
  source: RedirectSource
  matchKind: RedirectMatchKind
  pattern: string
  rootKey: string | null
  culture: string | null
}): string {
  const parts = [
    input.source,
    input.matchKind,
    input.pattern,
    input.rootKey ?? '',
    (input.culture ?? '').toLowerCase(),
  ]
  return new Bun.CryptoHasher('sha256').update(parts.join('\u0000')).digest('hex')
}

export class RedirectRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Every rule, in the order they are matched. */
  async all(): Promise<RedirectRow[]> {
    const rows = await selectRules(this.#db).$call(ordered).execute()
    return rows.map(hydrate)
  }

  async byKey(key: string): Promise<RedirectRow | undefined> {
    const row = await selectRules(this.#db).where('key', '=', normaliseUuid(key)).executeTakeFirst()
    return row ? hydrate(row) : undefined
  }

  /**
   * A page of rules, newest first, optionally filtered on either URL. Umbraco's
   * dashboard searches the original URL; matching the destination too costs
   * nothing and is what someone auditing "where does this page get traffic
   * from" actually wants.
   */
  async list(options: { filter?: string; skip?: number; take?: number } = {}): Promise<{
    total: number
    items: RedirectRow[]
  }> {
    const filter = options.filter?.trim().toLowerCase()
    const matching = <Q extends SelectQueryBuilder<CoreTables, 'redirect_url', object>>(
      query: Q,
    ): Q =>
      filter
        ? (query.where((eb) =>
            eb.or([
              eb(eb.fn('lower', ['pattern']), 'like', `%${filter}%`),
              eb(eb.fn('lower', ['target']), 'like', `%${filter}%`),
            ]),
          ) as Q)
        : query
    const counted = await this.#db.q
      .selectFrom('redirect_url')
      .select(sql<number>`count(*)`.as('total'))
      .$call(matching)
      .executeTakeFirst()
    const rows = await selectRules(this.#db)
      .$call(matching)
      .$call(ordered)
      .limit(options.take ?? 100)
      .offset(options.skip ?? 0)
      .execute()
    return { total: Number(counted?.total ?? 0), items: rows.map(hydrate) }
  }

  /** The rules pointing at one document, newest first. */
  async byDocument(
    documentKey: string,
    options: { skip?: number; take?: number } = {},
  ): Promise<{ total: number; items: RedirectRow[] }> {
    const target = normaliseUuid(documentKey)
    const pointing = <Q extends SelectQueryBuilder<CoreTables, 'redirect_url', object>>(
      query: Q,
    ): Q =>
      query
        .where('target_kind', '=', 'document')
        .where((eb) => eb(eb.fn('lower', ['target']), '=', target)) as Q
    const counted = await this.#db.q
      .selectFrom('redirect_url')
      .select(sql<number>`count(*)`.as('total'))
      .$call(pointing)
      .executeTakeFirst()
    const rows = await selectRules(this.#db)
      .$call(pointing)
      .$call(ordered)
      .limit(options.take ?? 100)
      .offset(options.skip ?? 0)
      .execute()
    return { total: Number(counted?.total ?? 0), items: rows.map(hydrate) }
  }

  /**
   * Stores a rule, replacing any existing one matching the same thing. The
   * returned row carries the key, which is a fresh one only when the rule is new.
   *
   * One statement, not a read then a write: two nodes recording the same retired
   * route at once would both find nothing and the second insert would hit the
   * unique index. The upsert lets the database decide which one is new.
   */
  async save(input: RedirectInput): Promise<RedirectRow> {
    const hash = matchHash(input)
    const now = new Date()
    const row = await this.#db.q
      .insertInto('redirect_url')
      .values({
        key: crypto.randomUUID(),
        source: input.source,
        match_kind: input.matchKind,
        pattern: input.pattern,
        root_key: input.rootKey,
        culture: input.culture,
        target_kind: input.targetKind,
        target: input.target,
        status_code: input.statusCode,
        sort_order: input.sortOrder,
        match_hash: hash,
        create_date: DbDate.toDb(now),
      })
      .onConflict((oc) =>
        oc.column('match_hash').doUpdateSet((eb) => ({
          target_kind: eb.ref('excluded.target_kind'),
          target: eb.ref('excluded.target'),
          status_code: eb.ref('excluded.status_code'),
          sort_order: eb.ref('excluded.sort_order'),
          create_date: eb.ref('excluded.create_date'),
        })),
      )
      .returning('key')
      .executeTakeFirst()
    return { ...input, key: normaliseUuid(String(row?.key)), createDate: now }
  }

  /** Deletes one rule. `false` means there was nothing with that key. */
  async delete(key: string): Promise<boolean> {
    const found = await this.byKey(key)
    if (!found) return false
    await this.#db.q.deleteFrom('redirect_url').where('key', '=', normaliseUuid(key)).execute()
    return true
  }

  /**
   * Drops any rule that matches `path` under `rootKey` and points at this
   * document — the case where a page was renamed and then renamed back, which
   * would otherwise leave a rule redirecting a live URL to itself.
   */
  async removeSelfReferencing(
    documentKey: string,
    rootKey: string | null,
    path: string,
  ): Promise<void> {
    await this.#db.q
      .deleteFrom('redirect_url')
      .where('source', '=', 'tracked')
      .where('target_kind', '=', 'document')
      .where((eb) => eb(eb.fn('lower', ['target']), '=', normaliseUuid(documentKey)))
      .where('match_kind', '=', 'exact')
      .where((eb) => eb(eb.fn('lower', ['pattern']), '=', path.toLowerCase()))
      .where('root_key', rootKey === null ? 'is' : '=', rootKey)
      .execute()
  }

  /**
   * Brings the `config` rows into line with the site's configuration: the ones
   * it still declares are stored in order, and any left over from a previous
   * boot are removed. Tracked rows are untouched.
   */
  async syncConfigured(inputs: readonly Omit<RedirectInput, 'source' | 'sortOrder'>[]): Promise<{
    stored: number
    removed: number
  }> {
    const kept = new Set<string>()
    let sortOrder = 0
    for (const input of inputs) {
      const rule: RedirectInput = { ...input, source: 'config', sortOrder: sortOrder++ }
      kept.add(matchHash(rule))
      await this.save(rule)
    }
    const stale = await this.#db.q
      .selectFrom('redirect_url')
      .select('match_hash')
      .where('source', '=', 'config')
      .execute()
    let removed = 0
    for (const row of stale) {
      const hash = String(row.match_hash)
      if (kept.has(hash)) continue
      await this.#db.q.deleteFrom('redirect_url').where('match_hash', '=', hash).execute()
      removed += 1
    }
    return { stored: kept.size, removed }
  }
}
