/**
 * Site search for visitors (story 140): what a page puts in the index, from
 * its published values only, and the query a results page runs. The indexer
 * that writes backoffice search rows writes these too (`search.ts`), from the
 * same queue. docs/search.md.
 */
import { ObjectTypes, type SiteSearchLevel } from '@crombolo/core'
import type { Db } from './database.ts'
import { DbDate, fromDbBool } from './dialect.ts'
import { sql } from './query.ts'
import { publishedValueRows } from './repositories/documents.ts'
import { hiddenElementProperties } from './search.ts'
import { searchTerms, searchWords, valueText } from './search-text.ts'

/** A page's text as written, by weight: what an excerpt is cut from. */
export interface SiteSearchText {
  name: string
  high: string[]
  normal: string[]
  low: string[]
}

/** One row of `site_search_document`: a page in one culture, '' when invariant. */
export interface SiteSearchEntry {
  culture: string
  text: SiteSearchText
}

export interface SiteSearchOptions {
  /** The culture searched, lowercase; an invariant page matches every culture. */
  culture: string
  /** Content type aliases; every searchable type when empty or absent. */
  types?: readonly string[]
  skip: number
  take: number
  /**
   * Protected nodes, by id, that the person searching may not open and may:
   * `branchAccess` in `@crombolo/core`. A page is left out when the nearest
   * protected node on its path is denied.
   */
  access?: { denied: readonly number[]; allowed: readonly number[] }
}

export interface SiteSearchHit {
  key: string
  culture: string
  score: number
  text: SiteSearchText
}

const LEVELS: readonly SiteSearchLevel[] = ['high', 'normal', 'low']

const folded = (texts: readonly string[]) => texts.flatMap(searchWords).join(' ')

/**
 * What the site-search index holds for a page: a row per published culture,
 * or one invariant row, from the values that culture shows visitors. Nothing
 * for a page that is unpublished or trashed, whose type has no component (it
 * has no address) or is left out of site search, or for anything not a page.
 * A property marked `site-search = false` or `searchable = false` is left out,
 * here and inside blocks.
 */
export async function siteEntriesFor(db: Db, nodeId: number): Promise<SiteSearchEntry[]> {
  const node = await db.q
    .selectFrom('node as n')
    .innerJoin('content as c', 'c.node_id', 'n.id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .innerJoin('document as d', 'd.node_id', 'n.id')
    .select((eb) => [
      'n.node_object_type',
      'n.trashed',
      'c.content_type_id',
      'ct.site_search',
      'ct.site_settings',
      'ct.is_element',
      'd.published',
      eb
        .selectFrom('content_type_template as t')
        .select((sub) => sub.fn.countAll().as('n'))
        .whereRef('t.content_type_node_id', '=', 'ct.node_id')
        .as('components'),
    ])
    .where('n.id', '=', nodeId)
    .executeTakeFirst()
  if (
    !node ||
    String(node.node_object_type) !== ObjectTypes.Document ||
    fromDbBool(node.trashed) ||
    !fromDbBool(node.published) ||
    !fromDbBool(node.site_search) ||
    fromDbBool(node.site_settings) ||
    fromDbBool(node.is_element) ||
    Number(node.components) === 0
  )
    return []

  const invariant = await db.q
    .selectFrom('content_version as cv')
    .innerJoin('document_version as dv', 'dv.id', 'cv.id')
    .select(['cv.id', 'cv.text'])
    .where('cv.node_id', '=', nodeId)
    .where('dv.published', '=', db.dialect.boolValue(true) as boolean)
    .orderBy('cv.id', 'desc')
    .limit(1)
    .executeTakeFirst()
  if (!invariant) return []
  const cultures = (
    await db.q
      .selectFrom('document_culture_variation as dcv')
      .innerJoin('language as l', 'l.id', 'dcv.language_id')
      .select([
        'dcv.language_id',
        'l.iso_code',
        'dcv.published_event_id',
        'dcv.published_name',
        'dcv.name',
      ])
      .where('dcv.node_id', '=', nodeId)
      .where('dcv.published', '=', db.dialect.boolValue(true) as boolean)
      .execute()
  ).map((row) => ({
    languageId: Number(row.language_id),
    culture: String(row.iso_code).toLowerCase(),
    eventId: Number(row.published_event_id ?? 0),
    name: String(row.published_name ?? row.name ?? ''),
  }))

  const latest = Math.max(Number(invariant.id), ...cultures.map((c) => c.eventId))
  const history = (
    await db.q
      .selectFrom('property_value as pv')
      .innerJoin('property_type as p', 'p.id', 'pv.property_type_id')
      .select([
        'pv.id',
        'pv.event_id',
        'pv.property_type_id',
        'pv.language_id',
        'pv.segment',
        'pv.varchar_value',
        'pv.text_value',
        'p.alias',
        'p.site_search',
      ])
      .where('pv.node_id', '=', nodeId)
      .where('pv.event_id', '<=', latest)
      .where('p.retired_at', 'is', null)
      .where('p.searchable', '=', db.dialect.boolValue(true))
      .where('p.site_search', '<>', 'off')
      .orderBy('pv.id')
      .execute()
  ).map((row) => ({
    eventId: Number(row.event_id),
    propertyTypeId: Number(row.property_type_id),
    languageId: row.language_id === null ? null : Number(row.language_id),
    segment: (row.segment as string | null) ?? null,
    raw: row.text_value ?? row.varchar_value,
    level: (LEVELS as readonly string[]).includes(String(row.site_search))
      ? (String(row.site_search) as SiteSearchLevel)
      : 'normal',
  }))
  const shown = publishedValueRows(history, Number(invariant.id), cultures).filter(
    (row) => row.segment === null,
  )
  const hidden = await hiddenElementProperties(db, true)

  const entry = (culture: string, languageId: number | null, name: string): SiteSearchEntry => {
    const text: SiteSearchText = { name, high: [], normal: [], low: [] }
    for (const row of shown) {
      if (row.languageId !== null && row.languageId !== languageId) continue
      text[row.level].push(...valueText(row.raw, hidden))
    }
    return { culture, text }
  }
  if (cultures.length === 0) return [entry('', null, String(invariant.text ?? ''))]
  return cultures.map((c) => entry(c.culture, c.languageId, c.name))
}

/** Replaces a page's site-search rows. */
export async function writeSiteEntries(
  tx: Db,
  nodeId: number,
  entries: readonly SiteSearchEntry[],
): Promise<void> {
  await tx.q.deleteFrom('site_search_document').where('node_id', '=', nodeId).execute()
  const indexedAt = DbDate.toDb(new Date())
  for (const entry of entries)
    await tx.q
      .insertInto('site_search_document')
      .values({
        node_id: nodeId,
        culture: entry.culture,
        name: folded([entry.text.name]),
        high: folded(entry.text.high),
        normal: folded(entry.text.normal),
        low: folded(entry.text.low),
        text: JSON.stringify(entry.text),
        indexed_at: indexedAt,
      })
      .execute()
}

/**
 * The visitor search over published pages. Every word of the query must be in
 * a page as a word prefix; the name counts most, then the high, normal and low
 * properties. Pages the person searching may not open are left out in the query
 * itself, so `total` counts only what they may see.
 */
export class SiteSearch {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async query(
    term: string,
    options: SiteSearchOptions,
  ): Promise<{ total: number; items: SiteSearchHit[] }> {
    const terms = searchTerms(term)
    if (terms.length === 0) return { total: 0, items: [] }
    const dialect = this.#db.dialect
    const types = options.types?.filter(Boolean) ?? []
    const denied = options.access?.denied ?? []
    const allowed = options.access?.allowed ?? []
    const hits = this.#db.q
      .selectFrom(dialect.siteSearchMatches(dialect.fullTextQuery(terms)).as('h'))
      .innerJoin('site_search_document as s', 's.id', 'h.row_id')
      .innerJoin('node as n', 'n.id', 's.node_id')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .where('s.culture', 'in', [options.culture.toLowerCase(), ''])
      .where('n.trashed', '=', dialect.boolValue(false) as boolean)
      .$if(types.length > 0, (q) => q.where('ct.alias', 'in', types))
      // Closed: under a denied node, with no allowed node between it and the page.
      .$if(denied.length > 0, (q) =>
        q.where(({ not, exists, selectFrom }) =>
          not(
            exists(
              selectFrom('node as p')
                .select((eb) => eb.lit(1).as('one'))
                .where('p.id', 'in', denied)
                .where((eb) =>
                  eb.or([
                    eb('p.id', '=', eb.ref('n.id')),
                    eb('n.path', 'like', sql<string>`${eb.ref('p.path')} || ',%'`),
                  ]),
                )
                .$if(allowed.length > 0, (sub) =>
                  sub.where(({ not, exists, selectFrom }) =>
                    not(
                      exists(
                        selectFrom('node as q')
                          .select((eb) => eb.lit(1).as('one'))
                          .where('q.id', 'in', allowed)
                          .where((eb) =>
                            eb.or([
                              eb('q.id', '=', eb.ref('n.id')),
                              eb('n.path', 'like', sql<string>`${eb.ref('q.path')} || ',%'`),
                            ]),
                          )
                          .where((eb) =>
                            eb('q.path', 'like', sql<string>`${eb.ref('p.path')} || ',%'`),
                          ),
                      ),
                    ),
                  ),
                ),
            ),
          ),
        ),
      )
    const count = await hits.select((eb) => eb.fn.countAll().as('n')).executeTakeFirst()
    const rows = await hits
      .select(['n.unique_id as key', 's.culture', 's.text', 'h.score'])
      .orderBy('h.score', 'desc')
      .orderBy('n.id')
      .limit(options.take)
      .offset(options.skip)
      .execute()
    return {
      total: Number(count?.n ?? 0),
      items: rows.map((row) => ({
        key: String(row.key).toLowerCase(),
        culture: String(row.culture),
        score: Number(row.score),
        text: JSON.parse(String(row.text)) as SiteSearchText,
      })),
    }
  }
}
