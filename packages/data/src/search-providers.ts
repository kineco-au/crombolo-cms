/**
 * The search providers a database answers with (story 273): the database
 * ones by default, or a site's own, registered per connection so every handle
 * on it, transactions included, finds the same. The queries that join the
 * full-text match into their own SQL read it through `fullTextHits`, and what
 * a delete takes away waits in `search_removal` for providers outside the
 * database. docs/search.md, "Providers".
 */
import {
  BACKOFFICE_INDEX_KINDS,
  type BackofficeIndexName,
  type BackofficeSearchEntry,
  type BackofficeSearchHit,
  type BackofficeSearchProvider,
  ObjectTypes,
  type SearchItem,
  type SearchKind,
  type SearchMatch,
  type SiteSearchEntry,
  type SiteSearchHit,
  type SiteSearchProvider,
  type SiteSearchQuery,
  searchTerms,
} from '@crombolo/core'
import type { RawBuilder } from 'kysely'
import type { Db } from './database.ts'
import { DbDate, type FullTextHit, fromDbBool } from './dialect.ts'
import { sql } from './query.ts'

export const KIND_OBJECT_TYPES: Readonly<Record<SearchKind, string>> = {
  document: ObjectTypes.Document,
  media: ObjectTypes.Media,
  member: ObjectTypes.Member,
}

export function kindOf(objectType: string): SearchKind | undefined {
  return (Object.keys(KIND_OBJECT_TYPES) as SearchKind[]).find(
    (kind) => KIND_OBJECT_TYPES[kind] === objectType,
  )
}

/** A provider kept in this database: the indexer writes it inside the claim's transaction. */
export interface InDatabase<E> {
  readonly inDatabase: true
  writeIn(tx: Db, item: Pick<SearchItem, 'id'>, entries: readonly E[]): Promise<void>
}

export type DatabaseBackofficeSearch = BackofficeSearchProvider &
  InDatabase<BackofficeSearchEntry> & {
    /** The full-text match as a subquery of `node_id` and `score`, to join in SQL. */
    sqlMatches(query: string): RawBuilder<FullTextHit> | undefined
  }

export type DatabaseSiteSearch = SiteSearchProvider & InDatabase<SiteSearchEntry>

export function isInDatabase<E>(provider: object): provider is InDatabase<E> {
  return (provider as Partial<InDatabase<E>>).inDatabase === true
}

async function writeBackofficeRows(
  tx: Db,
  nodeId: number,
  entries: readonly BackofficeSearchEntry[],
): Promise<void> {
  await tx.q.deleteFrom('search_document').where('node_id', '=', nodeId).execute()
  const indexedAt = DbDate.toDb(new Date())
  for (const entry of entries)
    await tx.q
      .insertInto('search_document')
      .values({
        node_id: nodeId,
        culture: entry.culture,
        name: entry.name,
        body: entry.body,
        fields: JSON.stringify(entry.fields),
        field_count: Object.keys(entry.fields).length,
        indexed_at: indexedAt,
      })
      .execute()
}

/** Backoffice search over `search_document`: FTS5 on SQLite, `tsvector` on Postgres. */
export function databaseBackofficeSearch(db: Db): DatabaseBackofficeSearch {
  const sqlMatches = (query: string) => {
    const terms = searchTerms(query)
    return terms.length > 0
      ? db.dialect.fullTextMatches(db.dialect.fullTextQuery(terms))
      : undefined
  }
  const objectTypes = (index: BackofficeIndexName) =>
    BACKOFFICE_INDEX_KINDS[index].map((kind) => KIND_OBJECT_TYPES[kind])
  return {
    name: 'the database',
    inDatabase: true,
    sqlMatches,
    writeIn: (tx, item, entries) => writeBackofficeRows(tx, item.id, entries),
    write: (item, entries) => writeBackofficeRows(db, item.id, entries),
    async remove(item) {
      await db.q.deleteFrom('search_document').where('node_id', '=', item.id).execute()
    },
    async matches(query, options): Promise<SearchMatch[]> {
      const hits = sqlMatches(query)
      if (!hits || options.kinds.length === 0) return []
      const rows = await db.q
        .selectFrom(hits.as('h'))
        .innerJoin('node as n', 'n.id', 'h.node_id')
        .select(['n.id', 'h.score'])
        .where(
          'n.node_object_type',
          'in',
          options.kinds.map((kind) => KIND_OBJECT_TYPES[kind]),
        )
        .orderBy('h.score', 'desc')
        .orderBy('n.id')
        .limit(options.limit)
        .execute()
      return rows.map((row) => ({ id: Number(row.id), score: Number(row.score) }))
    },
    async query(index, query, paging) {
      const hits = sqlMatches(query)
      if (!hits) return { total: 0, items: [] }
      const matching = db.q
        .selectFrom(hits.as('h'))
        .innerJoin('node as n', 'n.id', 'h.node_id')
        .where('n.node_object_type', 'in', objectTypes(index))
      const count = await matching.select((eb) => eb.fn.countAll().as('n')).executeTakeFirst()
      const rows = await matching
        .select(['n.id', 'n.unique_id as key', 'h.score'])
        .orderBy('h.score', 'desc')
        .orderBy('n.id')
        .limit(paging.take)
        .offset(paging.skip)
        .execute()
      const items: BackofficeSearchHit[] = []
      for (const row of rows) {
        const stored = await db.q
          .selectFrom('search_document')
          .select('fields')
          .where('node_id', '=', Number(row.id))
          .orderBy('culture')
          .execute()
        const merged = new Map<string, string[]>()
        for (const entry of stored)
          for (const [name, values] of Object.entries(
            JSON.parse(entry.fields) as Record<string, string[]>,
          ))
            merged.set(name, [...new Set([...(merged.get(name) ?? []), ...values])])
        items.push({
          key: String(row.key),
          score: Number(row.score),
          fields: [...merged].map(([name, values]) => ({ name, values })),
        })
      }
      return { total: Number(count?.n ?? 0), items }
    },
    async stats(index) {
      const row = await db.q
        .selectFrom('search_document as sd')
        .innerJoin('node as n', 'n.id', 'sd.node_id')
        .select((eb) => [
          eb.fn.count('sd.node_id').distinct().as('n'),
          eb.fn.max('sd.field_count').as('fields'),
        ])
        .where('n.node_object_type', 'in', objectTypes(index))
        .executeTakeFirst()
      return { documentCount: Number(row?.n ?? 0), fieldCount: Number(row?.fields ?? 0) }
    },
    health: async () => ({ ok: true }),
  }
}

/** Site search over `site_search_document`, weighted by `site-search` level. */
export function databaseSiteSearch(
  db: Db,
  rows: {
    write(tx: Db, nodeId: number, entries: readonly SiteSearchEntry[]): Promise<void>
    query(
      db: Db,
      query: string,
      options: SiteSearchQuery,
    ): Promise<{ total: number; items: SiteSearchHit[] }>
  },
): DatabaseSiteSearch {
  return {
    name: 'the database',
    inDatabase: true,
    writeIn: (tx, item, entries) => rows.write(tx, item.id, entries),
    write: (item, entries) => rows.write(db, item.id, entries),
    async remove(item) {
      await db.q.deleteFrom('site_search_document').where('node_id', '=', item.id).execute()
    },
    query: (query, options) => rows.query(db, query, options),
    async stats() {
      const row = await db.q
        .selectFrom('site_search_document')
        .select((eb) => eb.fn.count('node_id').distinct().as('n'))
        .executeTakeFirst()
      return { documentCount: Number(row?.n ?? 0) }
    },
    health: async () => ({ ok: true }),
  }
}

export interface SearchProviders {
  backoffice: BackofficeSearchProvider
  site: SiteSearchProvider
  /** How many matches a query joining them takes from a provider outside the database. */
  matchLimit: number
  /** Told of a provider's failure; the item stays queued and is tried again. */
  onError?: (error: unknown, context: { provider: string; key?: string }) => void
  /** Told once a query took `matchLimit` matches, so its total may be capped. */
  onCapped?: () => void
}

export const DEFAULT_MATCH_LIMIT = 1000

const registered = new WeakMap<object, SearchProviders>()
const defaults = new WeakMap<object, SearchProviders>()

/**
 * The providers `db` searches with: what `useSearchProviders` registered, else
 * the database ones. Kept per connection, so its transactions see the same.
 */
export function searchProvidersOf(db: Db): SearchProviders {
  const found = registered.get(db.locks)
  if (found) return found
  let fallback = defaults.get(db.locks)
  if (!fallback) {
    fallback = {
      backoffice: databaseBackofficeSearch(db),
      site: defaultSiteSearch(db),
      matchLimit: DEFAULT_MATCH_LIMIT,
    }
    defaults.set(db.locks, fallback)
  }
  return fallback
}

/** Whether either search is kept outside this database, so it must be told what changes here. */
export function searchesOutsideDatabase(db: Db): boolean {
  const { backoffice, site } = searchProvidersOf(db)
  return !isInDatabase(backoffice) || !isInDatabase(site)
}

/** Registers the providers every handle on `db`'s connection searches with. */
export function useSearchProviders(db: Db, providers: Partial<SearchProviders>): SearchProviders {
  const base = searchProvidersOf(db)
  const chosen: SearchProviders = {
    backoffice: providers.backoffice ?? base.backoffice,
    site: providers.site ?? base.site,
    matchLimit: providers.matchLimit ?? base.matchLimit,
    onError: providers.onError ?? base.onError,
    onCapped: providers.onCapped ?? base.onCapped,
  }
  registered.set(db.locks, chosen)
  return chosen
}

let defaultSiteSearch: (db: Db) => SiteSearchProvider = () => {
  throw new Error('site search is not wired')
}

/** Set once by `site-search.ts`, which owns the site-search rows, to avoid an import cycle. */
export function setDefaultSiteSearch(make: (db: Db) => SiteSearchProvider): void {
  defaultSiteSearch = make
}

const cappedOnce = new WeakSet<object>()

/**
 * Backoffice search's matches for `query`, as a subquery of `node_id` and
 * `score` to join: the database provider's own match, or a provider's matches
 * as a table of values, at most the match limit. Undefined when the query
 * holds no words.
 */
export async function fullTextHits(
  db: Db,
  query: string,
  kinds: readonly SearchKind[],
): Promise<RawBuilder<FullTextHit> | undefined> {
  if (searchTerms(query).length === 0) return undefined
  const providers = searchProvidersOf(db)
  const provider = providers.backoffice as Partial<DatabaseBackofficeSearch>
  if (provider.sqlMatches) return provider.sqlMatches(query)
  const matches = await providers.backoffice.matches(query, {
    kinds,
    limit: providers.matchLimit,
  })
  if (matches.length >= providers.matchLimit && !cappedOnce.has(providers)) {
    cappedOnce.add(providers)
    providers.onCapped?.()
  }
  // The matches as a table of values, built as every other query is.
  const row = (m: { id: number; score: number }) =>
    db.q.selectNoFrom([sql.lit(m.id).as('node_id'), sql.lit(m.score).as('score')])
  const [first, ...rest] = matches
  const table = first
    ? rest.reduce((acc, m) => acc.unionAll(row(m)), row(first))
    : row({ id: 0, score: 0 }).where(sql<boolean>`${sql.lit(false)}`)
  return sql<FullTextHit>`(${table})`
}

/**
 * Records what a provider outside the database must forget, inside the
 * delete's transaction and before its rows go: each page, media item and
 * member among `nodeIds`.
 */
export async function recordSearchRemovals(tx: Db, nodeIds: readonly number[]): Promise<void> {
  const removedAt = DbDate.toDb(new Date())
  for (let i = 0; i < nodeIds.length; i += 500) {
    const rows = await tx.q
      .selectFrom('node')
      .select(['id', 'unique_id', 'node_object_type'])
      .where('id', 'in', nodeIds.slice(i, i + 500))
      .where('node_object_type', 'in', Object.values(KIND_OBJECT_TYPES))
      .execute()
    if (rows.length === 0) continue
    await tx.q
      .insertInto('search_removal')
      .values(
        rows.map((row) => ({
          node_id: Number(row.id),
          node_key: String(row.unique_id).toLowerCase(),
          kind: kindOf(String(row.node_object_type)) as SearchKind,
          removed_at: removedAt,
        })),
      )
      .execute()
  }
}

/** One removal waiting for the providers outside the database. */
export interface SearchRemoval {
  id: number
  nodeId: number
  key: string
  kind: SearchKind
}

export async function pendingSearchRemovals(db: Db, limit: number): Promise<SearchRemoval[]> {
  const rows = await db.q
    .selectFrom('search_removal')
    .select(['id', 'node_id', 'node_key', 'kind'])
    .orderBy('id')
    .limit(limit)
    .execute()
  return rows.map((row) => ({
    id: Number(row.id),
    nodeId: Number(row.node_id),
    key: String(row.node_key),
    kind: String(row.kind) as SearchKind,
  }))
}

export async function forgetSearchRemovals(db: Db, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return
  await db.q
    .deleteFrom('search_removal')
    .where('id', 'in', [...ids])
    .execute()
}

/** What a provider is told an item is, read from the node. Undefined for anything not indexed. */
export async function searchItemFor(db: Db, nodeId: number): Promise<SearchItem | undefined> {
  const row = await db.q
    .selectFrom('node as n')
    .leftJoin('content as c', 'c.node_id', 'n.id')
    .leftJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .select(['n.id', 'n.unique_id', 'n.path', 'n.node_object_type', 'n.trashed', 'ct.alias'])
    .where('n.id', '=', nodeId)
    .executeTakeFirst()
  const kind = row && kindOf(String(row.node_object_type))
  if (!row || !kind) return undefined
  return {
    id: Number(row.id),
    key: String(row.unique_id).toLowerCase(),
    kind,
    contentTypeAlias: String(row.alias ?? ''),
    path: String(row.path)
      .split(',')
      .map(Number)
      .filter((id) => id > 0),
    trashed: fromDbBool(row.trashed),
  }
}
