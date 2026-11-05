/**
 * A page's children as its list view shows them (story 269): searched by name,
 * sorted by a built-in column or a property's value (story 276) and paged in
 * the database, with who created and last edited each one.
 */
import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import type { ExpressionBuilder, SelectQueryBuilder, SqlBool } from 'kysely'
import type { Db } from '../database.ts'
import { type Expression, sql } from '../query.ts'
import type { CoreTables } from '../tables.gen.ts'

export type DocumentSortField =
  | 'createDate'
  | 'updateDate'
  | 'name'
  | 'sortOrder'
  | 'creator'
  | 'updater'

export interface DocumentListingQuery {
  parentId: number
  /** Every one must appear in the name shown, ignoring case. */
  names?: readonly string[]
  /** A built-in column, or a property's current draft value by its alias (story 276). */
  sort?: { field: DocumentSortField; ascending: boolean } | { property: string; ascending: boolean }
  /** The culture whose names are searched and sorted; the draft name otherwise. */
  culture?: string | null
  excludeKeys?: readonly string[]
  skip: number
  take: number
}

type Listed = {
  n: CoreTables['node']
  head: CoreTables['content_version']
  dcv: CoreTables['document_culture_variation']
  lang: CoreTables['language']
  made: CoreTables['user_account']
  edited: CoreTables['user_account']
}
type Aliases = keyof Listed
type Eb = ExpressionBuilder<CoreTables & Listed, Aliases>

const nameOf = (eb: Eb) => eb.fn.coalesce('dcv.name', 'head.text', 'n.text')

const SORT_COLUMNS: Record<DocumentSortField, (eb: Eb) => Expression<unknown>> = {
  createDate: (eb) => eb.ref('n.create_date'),
  updateDate: (eb) => eb.fn.coalesce('head.version_date', 'n.create_date'),
  name: (eb) => eb.fn('lower', [nameOf(eb)]),
  sortOrder: (eb) => eb.ref('n.sort_order'),
  creator: (eb) => eb.fn('lower', [eb.ref('made.user_name')]),
  updater: (eb) => eb.fn('lower', [eb.ref('edited.user_name')]),
}

/** A property value's columns, in the order a sort reads them: one is set, by its storage. */
const VALUE_COLUMNS = ['int_value', 'decimal_value', 'date_value', 'sortable_value'] as const

/**
 * The current draft value of the property `alias` for the row's page, in the
 * culture shown when it varies, from one column: a correlated subquery, so a
 * page is listed once whatever its values.
 */
function propertyValue(eb: Eb, db: Db, alias: string, column: (typeof VALUE_COLUMNS)[number]) {
  const inner = eb as unknown as ExpressionBuilder<
    CoreTables & Listed & { pv: CoreTables['property_value']; pt: CoreTables['property_type'] },
    Aliases | 'pv' | 'pt'
  >
  return inner
    .selectFrom('property_value as pv')
    .innerJoin('property_type as pt', 'pt.id', 'pv.property_type_id')
    .select(
      column === 'sortable_value'
        ? (e) => e.fn('lower', [e.ref('pv.sortable_value')]).as('v')
        : (e) => e.ref(`pv.${column}`).as('v'),
    )
    .whereRef('pv.node_id', '=', 'n.id')
    .where('pt.alias', '=', alias)
    .where('pt.retired_at', 'is', null)
    .where('pv.is_current', '=', db.dialect.boolValue(true) as boolean)
    .where('pv.segment', 'is', null)
    .where((e) =>
      e.or([e('pv.language_id', 'is', null), e('pv.language_id', '=', e.ref('lang.id'))]),
    )
    .orderBy('pv.id', 'desc')
    .limit(1)
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

export class DocumentListingRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** A page of a parent's children: their keys in order, and how many match in all. */
  async children(query: DocumentListingQuery): Promise<{ total: number; keys: string[] }> {
    const names = query.names ?? []
    const excluded = (query.excludeKeys ?? []).map(normaliseUuid)
    const db = this.#db
    const listing = () =>
      (
        db.q.selectFrom('node as n') as unknown as SelectQueryBuilder<
          CoreTables & Listed,
          Aliases,
          object
        >
      )
        .leftJoin('content_version as head', (join) =>
          join
            .onRef('head.node_id', '=', 'n.id')
            .on('head.current', '=', db.dialect.boolValue(true)),
        )
        .leftJoin('language as lang', (join) =>
          join.on((eb) =>
            eb(eb.fn('lower', [eb.ref('lang.iso_code')]), '=', (query.culture ?? '').toLowerCase()),
          ),
        )
        .leftJoin('document_culture_variation as dcv', (join) =>
          join.onRef('dcv.node_id', '=', 'n.id').onRef('dcv.language_id', '=', 'lang.id'),
        )
        .leftJoin('user_account as made', 'made.id', 'n.node_user')
        .leftJoin('user_account as edited', 'edited.id', 'head.user_id')
        .where('n.parent_id', '=', query.parentId)
        .where('n.node_object_type', '=', ObjectTypes.Document)
        .where('n.trashed', '=', db.dialect.boolValue(false))
        .$if(excluded.length > 0, (q) => q.where('n.unique_id', 'not in', excluded))
        .$call((q) =>
          names.reduce(
            (acc, part) =>
              acc.where(
                (eb) =>
                  sql<SqlBool>`${eb.fn('lower', [nameOf(eb)])} like ${`%${likeEscape(part.toLowerCase())}%`} escape '\\'`,
              ),
            q,
          ),
        )
    const counted = await listing().select(sql<number>`count(*)`.as('n')).executeTakeFirst()
    const sort = query.sort
    const rows =
      query.take <= 0
        ? []
        : await listing()
            .select('n.unique_id')
            .$call((q) => {
              if (!sort) return q
              const direction = sort.ascending ? 'asc' : 'desc'
              if ('field' in sort) return q.orderBy((eb) => SORT_COLUMNS[sort.field](eb), direction)
              // Pages with no value come last either way, then by the column the value is kept in.
              const sorted = q.orderBy(
                (eb) =>
                  eb
                    .case()
                    .when(
                      eb.or(
                        VALUE_COLUMNS.map((column) =>
                          eb(propertyValue(eb, db, sort.property, column), 'is not', null),
                        ),
                      ),
                    )
                    .then(0)
                    .else(1)
                    .end(),
                'asc',
              )
              return VALUE_COLUMNS.reduce(
                (acc, column) =>
                  acc.orderBy((eb) => propertyValue(eb, db, sort.property, column), direction),
                sorted,
              )
            })
            .orderBy('n.sort_order')
            .orderBy('n.id')
            .limit(query.take)
            .offset(Math.max(0, query.skip))
            .execute()
    return {
      total: Number(counted?.n ?? 0),
      keys: rows.map((row) => normaliseUuid(String(row.unique_id))),
    }
  }

  /** Who created each page and who saved its current draft, by key, in one query. */
  async people(
    keys: readonly string[],
  ): Promise<Map<string, { creator: string | null; updater: string | null }>> {
    const out = new Map<string, { creator: string | null; updater: string | null }>()
    if (keys.length === 0) return out
    const rows = await this.#db.q
      .selectFrom('node as n')
      .leftJoin('content_version as head', (join) =>
        join
          .onRef('head.node_id', '=', 'n.id')
          .on('head.current', '=', this.#db.dialect.boolValue(true)),
      )
      .leftJoin('user_account as made', 'made.id', 'n.node_user')
      .leftJoin('user_account as edited', 'edited.id', 'head.user_id')
      .select(['n.unique_id', 'made.user_name as creator', 'edited.user_name as updater'])
      .where('n.unique_id', 'in', keys.map(normaliseUuid))
      .execute()
    for (const row of rows)
      out.set(normaliseUuid(String(row.unique_id)), {
        creator: row.creator ? String(row.creator) : null,
        updater: row.updater ? String(row.updater) : null,
      })
    return out
  }
}
