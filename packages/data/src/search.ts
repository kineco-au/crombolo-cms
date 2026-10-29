/**
 * The backoffice search index: what a write queues, how the indexer turns a
 * queued item into rows, and the two indexes the Examine dashboard shows. The
 * same indexer writes a page's site-search rows (`site-search.ts`). docs/search.md.
 */
import { ObjectTypes } from '@crombolo/core'
import type { Db } from './database.ts'
import { DbDate, fromDbBool } from './dialect.ts'
import { type Expression, now, rowLock } from './query.ts'
import { searchTerms, searchWords, type UnsearchableProperty, valueText } from './search-text.ts'
import { siteEntriesFor, writeSiteEntries } from './site-search.ts'

/** Umbraco's names for the two backoffice indexes, which the dashboard shows. */
export type SearchIndexName = 'InternalIndex' | 'MembersIndex'

export interface SearchIndexDefinition {
  name: SearchIndexName
  searcherName: string
  objectTypes: readonly string[]
}

export const SEARCH_INDEXES: readonly SearchIndexDefinition[] = [
  {
    name: 'InternalIndex',
    searcherName: 'InternalSearcher',
    objectTypes: [ObjectTypes.Document, ObjectTypes.Media],
  },
  { name: 'MembersIndex', searcherName: 'MembersSearcher', objectTypes: [ObjectTypes.Member] },
]

const INDEXED_TYPES: readonly string[] = SEARCH_INDEXES.flatMap((index) => index.objectTypes)

const INDEX_TYPE: Record<string, string> = {
  [ObjectTypes.Document]: 'content',
  [ObjectTypes.Media]: 'media',
  [ObjectTypes.Member]: 'member',
}

/** Queues the rows a select of `node_id, generation, queued_at` answers, bumping any already queued. */
async function enqueue(db: Db, rows: Expression<unknown>): Promise<void> {
  await db.q
    .insertInto('search_index_queue')
    .columns(['node_id', 'generation', 'queued_at'])
    .expression(rows)
    .onConflict((oc) =>
      oc.column('node_id').doUpdateSet((eb) => ({
        generation: eb('search_index_queue.generation', '+', 1),
        queued_at: eb.ref('excluded.queued_at'),
      })),
    )
    .execute()
}

/** Every node of these object types, as rows to queue. */
function nodesOfTypes(db: Db, objectTypes: readonly string[], ids?: readonly number[]) {
  return db.q
    .selectFrom('node')
    .select((eb) => ['id', eb.lit(1).as('generation'), now(db).as('queued_at')])
    .$if(ids !== undefined, (q) => q.where('id', 'in', ids ?? []))
    .where('node_object_type', 'in', objectTypes)
}

/**
 * Queues items for the indexer. Called inside the write's own transaction, so
 * the queue row commits with the change or not at all. Ids of anything that is
 * not a page, media item or member are ignored.
 */
export async function queueForSearch(db: Db, nodeIds: Iterable<number>): Promise<void> {
  const ids = [...new Set(nodeIds)]
  if (ids.length === 0) return
  for (let i = 0; i < ids.length; i += 500) {
    await enqueue(db, nodesOfTypes(db, INDEXED_TYPES, ids.slice(i, i + 500)))
  }
}

/** Queues every item of these content types, and of the types composing them. */
export async function queueContentTypesForSearch(
  db: Db,
  contentTypeNodeIds: Iterable<number>,
): Promise<void> {
  const types = new Set(contentTypeNodeIds)
  let frontier = [...types]
  while (frontier.length > 0) {
    const children = await db.q
      .selectFrom('content_type_composition')
      .select('child_content_type_id as id')
      .where('parent_content_type_id', 'in', frontier)
      .execute()
    frontier = children.map((row) => Number(row.id)).filter((id) => !types.has(id))
    for (const id of frontier) types.add(id)
  }
  if (types.size === 0) return
  await enqueue(
    db,
    db.q
      .selectFrom('content')
      .select((eb) => ['node_id', eb.lit(1).as('generation'), now(db).as('queued_at')])
      .where('content_type_id', 'in', [...types]),
  )
}

/**
 * Queues every page, media item and member. An element type's properties are
 * read inside blocks wherever they are used, which no query can narrow.
 */
export async function queueEverythingForSearch(db: Db): Promise<void> {
  await enqueue(db, nodesOfTypes(db, INDEXED_TYPES))
}

/** One row of `search_document`: an item in one culture, '' when invariant. */
export interface SearchEntry {
  culture: string
  name: string
  body: string
  fields: Record<string, string[]>
}

export interface SearchIndexStats {
  documentCount: number
  fieldCount: number
  /** Items queued and not yet indexed. */
  pending: number
}

export interface SearchHit {
  key: string
  score: number
  fields: Array<{ name: string; values: string[] }>
}

export class SearchIndex {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  static definition(name: string): SearchIndexDefinition | undefined {
    return SEARCH_INDEXES.find((index) => index.name.toLowerCase() === name.toLowerCase())
  }

  static bySearcher(name: string): SearchIndexDefinition | undefined {
    return SEARCH_INDEXES.find((index) => index.searcherName.toLowerCase() === name.toLowerCase())
  }

  /**
   * Indexes up to `limit` queued items, oldest first, and returns how many it
   * indexed. Each item is its own transaction, claimed by locking its queue row:
   * a second indexer passes over it, and a write queueing it again bumps the
   * generation, so the row outlives this run and the item is indexed once more.
   */
  async indexQueued(limit = 200): Promise<number> {
    const queued = await this.#db.q
      .selectFrom('search_index_queue')
      .select(['node_id', 'generation'])
      .orderBy('queued_at')
      .orderBy('node_id')
      .limit(limit)
      .execute()
    let indexed = 0
    for (const row of queued) {
      const nodeId = Number(row.node_id)
      const generation = Number(row.generation)
      const done = await this.#db.transaction(async (tx) => {
        const claimed = await tx.q
          .selectFrom('search_index_queue')
          .select('node_id')
          .where('node_id', '=', nodeId)
          .where('generation', '=', generation)
          .$call(rowLock(tx, 'update skip locked'))
          .execute()
        if (claimed.length === 0) return false
        await writeEntries(tx, nodeId, await entriesFor(tx, nodeId))
        await writeSiteEntries(tx, nodeId, await siteEntriesFor(tx, nodeId))
        await tx.q
          .deleteFrom('search_index_queue')
          .where('node_id', '=', nodeId)
          .where('generation', '=', generation)
          .execute()
        return true
      })
      if (done) indexed++
    }
    return indexed
  }

  /** Indexes until nothing is queued. For tests and the command line. */
  async indexAll(): Promise<number> {
    let total = 0
    for (;;) {
      const indexed = await this.indexQueued()
      total += indexed
      if (indexed === 0) return total
    }
  }

  /** Queues every item the index covers; the index keeps answering meanwhile. */
  async rebuild(index: SearchIndexDefinition): Promise<void> {
    await enqueue(this.#db, nodesOfTypes(this.#db, index.objectTypes))
  }

  async stats(index: SearchIndexDefinition): Promise<SearchIndexStats> {
    const types = index.objectTypes
    const documents = await this.#db.q
      .selectFrom('search_document as sd')
      .innerJoin('node as n', 'n.id', 'sd.node_id')
      .select((eb) => [
        eb.fn.count('sd.node_id').distinct().as('n'),
        eb.fn.max('sd.field_count').as('fields'),
      ])
      .where('n.node_object_type', 'in', types)
      .executeTakeFirst()
    const pending = await this.#db.q
      .selectFrom('search_index_queue as q')
      .innerJoin('node as n', 'n.id', 'q.node_id')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('n.node_object_type', 'in', types)
      .executeTakeFirst()
    return {
      documentCount: Number(documents?.n ?? 0),
      fieldCount: Number(documents?.fields ?? 0),
      pending: Number(pending?.n ?? 0),
    }
  }

  /** The Examine dashboard's search: every stored field of each matching item, best first. */
  async query(
    index: SearchIndexDefinition,
    term: string,
    paging: { skip: number; take: number },
  ): Promise<{ total: number; items: SearchHit[] }> {
    const terms = searchTerms(term)
    if (terms.length === 0) return { total: 0, items: [] }
    const types = index.objectTypes
    const dialect = this.#db.dialect
    const hits = this.#db.q
      .selectFrom(dialect.fullTextMatches(dialect.fullTextQuery(terms)).as('h'))
      .innerJoin('node as n', 'n.id', 'h.node_id')
      .where('n.node_object_type', 'in', types)
    const count = await hits.select((eb) => eb.fn.countAll().as('n')).executeTakeFirst()
    const rows = await hits
      .select(['n.id', 'n.unique_id as key', 'h.score'])
      .orderBy('h.score', 'desc')
      .orderBy('n.id')
      .limit(paging.take)
      .offset(paging.skip)
      .execute()
    const items: SearchHit[] = []
    for (const row of rows) {
      const stored = await this.#db.q
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
  }
}

async function writeEntries(tx: Db, nodeId: number, entries: readonly SearchEntry[]) {
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

const folded = (texts: readonly string[]) => texts.flatMap(searchWords).join(' ')

/**
 * The element-type properties marked `searchable = false`, by type key and
 * alias, for the blocks inside a value. A property a composition contributes
 * counts on every type composing it, which is the key a block carries.
 */
function unsearchableElementProperties(db: Db): Promise<UnsearchableProperty> {
  return hiddenElementProperties(db, false)
}

/**
 * The properties marked `searchable = false`, and with `siteSearch` those whose
 * site search is `off` too, as a test by type key and alias: what a block's
 * text is checked against. Shared with site search.
 */
export async function hiddenElementProperties(
  db: Db,
  siteSearch: boolean,
): Promise<UnsearchableProperty> {
  const rows = await db.q
    .selectFrom('property_type as p')
    .select(['p.content_type_id as type_id', 'p.alias'])
    .where((eb) => {
      const unsearchable = eb('p.searchable', '=', db.dialect.boolValue(false))
      return siteSearch ? eb.or([unsearchable, eb('p.site_search', '=', 'off')]) : unsearchable
    })
    .where('p.retired_at', 'is', null)
    .execute()
  if (rows.length === 0) return () => false
  const composedBy = new Map<number, number[]>()
  for (const row of await db.q
    .selectFrom('content_type_composition')
    .select(['parent_content_type_id as parent', 'child_content_type_id as child'])
    .execute())
    composedBy.set(Number(row.parent), [
      ...(composedBy.get(Number(row.parent)) ?? []),
      Number(row.child),
    ])
  const keys = new Map<number, string>()
  for (const row of await db.q
    .selectFrom('node as n')
    .innerJoin('content_type as ct', 'ct.node_id', 'n.id')
    .select(['n.id', 'n.unique_id'])
    .execute())
    keys.set(Number(row.id), String(row.unique_id).toLowerCase())
  const hidden = new Set<string>()
  for (const row of rows) {
    const seen = new Set<number>()
    const pending = [Number(row.type_id)]
    while (pending.length > 0) {
      const id = pending.pop() as number
      if (seen.has(id)) continue
      seen.add(id)
      hidden.add(`${keys.get(id)}|${row.alias}`)
      pending.push(...(composedBy.get(id) ?? []))
    }
  }
  return (typeKey, alias) => hidden.has(`${typeKey.toLowerCase()}|${alias}`)
}

/**
 * What the index holds for an item, from its current (draft) values: a row per
 * culture it has a name in, each carrying the invariant values too, or one
 * invariant row. Retired properties are left out, and so is sensitive member
 * data, which a search must not reveal to somebody who cannot see it. Trashed
 * items are kept and filtered when searched, so the recycle bin is searchable.
 */
export async function entriesFor(db: Db, nodeId: number): Promise<SearchEntry[]> {
  const node = await db.q
    .selectFrom('node as n')
    .innerJoin('content as c', 'c.node_id', 'n.id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .select([
      'n.id',
      'n.unique_id',
      'n.text',
      'n.path',
      'n.node_object_type',
      'n.trashed',
      'ct.alias as type_alias',
    ])
    .where('n.id', '=', nodeId)
    .executeTakeFirst()
  if (!node || !INDEXED_TYPES.includes(String(node.node_object_type))) return []

  const values = await db.q
    .selectFrom('property_value as pv')
    .innerJoin('property_type as p', 'p.id', 'pv.property_type_id')
    .leftJoin('language as l', 'l.id', 'pv.language_id')
    .leftJoin('member_property_type as mpt', 'mpt.property_type_id', 'p.id')
    .select(['p.alias', 'l.iso_code', 'pv.varchar_value', 'pv.text_value'])
    .where('pv.node_id', '=', nodeId)
    .where('pv.is_current', '=', db.dialect.boolValue(true) as boolean)
    .where('p.retired_at', 'is', null)
    .where('p.searchable', '=', db.dialect.boolValue(true))
    .where((eb) =>
      eb.or([
        eb('mpt.is_sensitive', 'is', null),
        eb('mpt.is_sensitive', '=', db.dialect.boolValue(false) as boolean),
      ]),
    )
    .orderBy('p.sort_order')
    .orderBy('p.id')
    .execute()
  const unsearchable = await unsearchableElementProperties(db)
  const names = await db.q
    .selectFrom('content_version as cv')
    .innerJoin('content_version_culture_variation as cvcv', 'cvcv.version_id', 'cv.id')
    .innerJoin('language as l', 'l.id', 'cvcv.language_id')
    .select(['l.iso_code', 'cvcv.name'])
    .where('cv.node_id', '=', nodeId)
    .where('cv.current', '=', db.dialect.boolValue(true) as boolean)
    .orderBy('l.iso_code')
    .execute()
  const extraNames: string[] = []
  const extraFields: Record<string, string[]> = {}
  if (String(node.node_object_type) === ObjectTypes.Member) {
    const member = await db.q
      .selectFrom('member')
      .select(['email', 'login_name'])
      .where('node_id', '=', nodeId)
      .executeTakeFirst()
    if (member) {
      extraNames.push(String(member.email), String(member.login_name))
      extraFields.email = [String(member.email)]
      extraFields.loginName = [String(member.login_name)]
    }
  }

  const textOf = (culture: string | null) => {
    const fields: Record<string, string[]> = {}
    for (const row of values) {
      const iso = row.iso_code === null || row.iso_code === undefined ? null : String(row.iso_code)
      if (iso !== null && iso.toLowerCase() !== culture?.toLowerCase()) continue
      const texts = valueText(row.text_value ?? row.varchar_value, unsearchable)
      if (texts.length === 0) continue
      const name = iso ? `${String(row.alias)}_${iso.toLowerCase()}` : String(row.alias)
      fields[name] = [...(fields[name] ?? []), ...texts]
    }
    return fields
  }

  const base = (culture: string, name: string): SearchEntry => {
    const valueFields = textOf(culture || null)
    const fields: Record<string, string[]> = {
      __NodeId: [String(node.id)],
      __Key: [String(node.unique_id)],
      __IndexType: [INDEX_TYPE[String(node.node_object_type)] ?? 'content'],
      __NodeTypeAlias: [String(node.type_alias)],
      __Path: [String(node.path)],
      ...(fromDbBool(node.trashed) ? { __Trashed: ['true'] } : {}),
      nodeName: [name],
      ...(culture ? { __Culture: [culture] } : {}),
      ...extraFields,
      ...valueFields,
    }
    return {
      culture,
      name: folded([name, ...extraNames]),
      body: folded(Object.values(valueFields).flat()),
      fields,
    }
  }

  if (names.length === 0) return [base('', String(node.text ?? ''))]
  return names.map((row) => base(String(row.iso_code).toLowerCase(), String(row.name)))
}
