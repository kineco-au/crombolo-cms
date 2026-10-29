/**
 * Finding documents by their facts (story 183): type, place, dates, state,
 * name, the full-text index and up to five property comparisons, in one SQL
 * statement over the draft. The caller says who is asking: start nodes narrow
 * the statement itself, and a Browse check (when some group can withhold it) is
 * applied to a bounded window. `docs/search.md`, "Finding content by its
 * properties".
 */
import {
  ObjectTypes,
  STORAGE_COLUMN,
  type StartNodes,
  type ValueStorageTypeName,
} from '@crombolo/core'
import type { Db } from './database.ts'
import { DbDate, fromDbBool } from './dialect.ts'
import { type Expression, sql } from './query.ts'
import { escapeLike, searchTerms } from './search-text.ts'

export const QUERY_STATES = ['published', 'draft', 'changed', 'trashed'] as const
export type QueryState = (typeof QUERY_STATES)[number]
export const PROPERTY_OPS = [
  'eq',
  'ne',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'exists',
  'empty',
] as const
export type PropertyOp = (typeof PROPERTY_OPS)[number]
export const NAME_OPS = ['contains', 'startsWith', 'equals'] as const
export const SORT_FIELDS = ['name', 'createDate', 'updateDate', 'path', 'sortOrder'] as const
export const MAX_PROPERTY_CLAUSES = 5
export const MAX_TAKE = 100
export const DEFAULT_TAKE = 25
/** How many rows a restricted user's query reads before Browse is checked. */
export const QUERY_WINDOW = 1_000
/** Postgres stops a query that runs longer than this. */
export const QUERY_TIMEOUT_MS = 5_000

export interface ContentQuery {
  entity: 'document'
  contentTypes?: string[]
  name?: { op: (typeof NAME_OPS)[number]; value: string }
  text?: string
  under?: string
  parent?: string
  maxDepth?: number
  created?: { from?: Date; to?: Date }
  updated?: { from?: Date; to?: Date }
  state?: QueryState[]
  culture?: string
  properties?: Array<{ alias: string; op: PropertyOp; value?: unknown }>
  sort?: { by: (typeof SORT_FIELDS)[number]; dir: 'asc' | 'desc' }
  skip: number
  take: number
}

export type ParsedQuery = { ok: true; query: ContentQuery } | { ok: false; problems: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A request body checked into a query, or every problem with it, each named. */
export function parseContentQuery(body: unknown): ParsedQuery {
  const problems: string[] = []
  if (!isRecord(body)) return { ok: false, problems: ['The request must be a JSON object.'] }
  const known = new Set([
    'entity',
    'contentTypes',
    'name',
    'text',
    'under',
    'parent',
    'maxDepth',
    'created',
    'updated',
    'state',
    'culture',
    'properties',
    'sort',
    'skip',
    'take',
  ])
  for (const key of Object.keys(body))
    if (!known.has(key)) problems.push(`"${key}" is not a query field.`)
  if (body.entity !== 'document')
    problems.push('"entity" must be "document"; media is not searchable this way yet.')

  const strings = (field: string): string[] | undefined => {
    const value = body[field]
    if (value === undefined) return undefined
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v === '')) {
      problems.push(`"${field}" must be a list of strings.`)
      return undefined
    }
    return value as string[]
  }
  const text = (field: string): string | undefined => {
    const value = body[field]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`"${field}" must be a non-empty string.`)
      return undefined
    }
    return value
  }
  const count = (field: string, fallback: number, max = Number.POSITIVE_INFINITY) => {
    const value = body[field]
    if (value === undefined) return fallback
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > max) {
      problems.push(
        `"${field}" must be a whole number from 0${max < Infinity ? ` to ${max}` : ''}.`,
      )
      return fallback
    }
    return value as number
  }
  const range = (field: string) => {
    const value = body[field]
    if (value === undefined) return undefined
    if (!isRecord(value)) {
      problems.push(`"${field}" must be { from?, to? }.`)
      return undefined
    }
    const out: { from?: Date; to?: Date } = {}
    for (const end of ['from', 'to'] as const) {
      if (value[end] === undefined) continue
      const date = typeof value[end] === 'string' ? new Date(value[end] as string) : undefined
      if (!date || Number.isNaN(date.getTime())) problems.push(`"${field}.${end}" must be a date.`)
      else out[end] = date
    }
    return out
  }

  let name: ContentQuery['name']
  if (body.name !== undefined) {
    const n = body.name
    if (
      !isRecord(n) ||
      !NAME_OPS.includes(n.op as never) ||
      typeof n.value !== 'string' ||
      n.value === ''
    )
      problems.push(`"name" must be { op: ${NAME_OPS.join(' | ')}, value }.`)
    else name = { op: n.op as (typeof NAME_OPS)[number], value: n.value }
  }

  const state = strings('state')
  for (const s of state ?? [])
    if (!QUERY_STATES.includes(s as never))
      problems.push(`"${s}" is not a state; use ${QUERY_STATES.join(', ')}.`)

  let properties: ContentQuery['properties']
  if (body.properties !== undefined) {
    if (!Array.isArray(body.properties)) problems.push('"properties" must be a list.')
    else if (body.properties.length > MAX_PROPERTY_CLAUSES)
      problems.push(`At most ${MAX_PROPERTY_CLAUSES} property clauses.`)
    else {
      properties = []
      body.properties.forEach((clause, index) => {
        if (
          !isRecord(clause) ||
          typeof clause.alias !== 'string' ||
          !PROPERTY_OPS.includes(clause.op as never)
        ) {
          problems.push(
            `"properties[${index}]" must be { alias, op: ${PROPERTY_OPS.join(' | ')}, value? }.`,
          )
          return
        }
        const op = clause.op as PropertyOp
        const valued = op !== 'exists' && op !== 'empty'
        if (valued && (clause.value === undefined || clause.value === null))
          problems.push(`"properties[${index}]" needs a value for "${op}".`)
        properties?.push({ alias: clause.alias, op, value: clause.value })
      })
    }
  }

  let sort: ContentQuery['sort']
  if (body.sort !== undefined) {
    const s = body.sort
    if (
      !isRecord(s) ||
      !SORT_FIELDS.includes(s.by as never) ||
      (s.dir !== undefined && s.dir !== 'asc' && s.dir !== 'desc')
    )
      problems.push(`"sort" must be { by: ${SORT_FIELDS.join(' | ')}, dir: asc | desc }.`)
    else
      sort = { by: s.by as (typeof SORT_FIELDS)[number], dir: (s.dir as 'asc' | 'desc') ?? 'asc' }
  }

  const query: ContentQuery = {
    entity: 'document',
    contentTypes: strings('contentTypes'),
    name,
    text: text('text'),
    under: text('under'),
    parent: text('parent'),
    maxDepth: body.maxDepth === undefined ? undefined : count('maxDepth', 0),
    created: range('created'),
    updated: range('updated'),
    state: state as QueryState[] | undefined,
    culture: text('culture'),
    properties,
    sort,
    skip: count('skip', 0),
    take: count('take', DEFAULT_TAKE, MAX_TAKE),
  }
  if (query.maxDepth !== undefined && !query.under && !query.parent)
    problems.push('"maxDepth" counts from "under"; give one.')
  if (query.text !== undefined && searchTerms(query.text).length === 0)
    problems.push('"text" has no words to search for.')
  return problems.length > 0 ? { ok: false, problems } : { ok: true, query }
}

/** Who is asking: where they may look, and whether Browse must be checked per page. */
export interface QueryScope {
  start: StartNodes
  /** Undefined when every group can browse everything; else Browse for a key chain. */
  browses?: (chain: readonly string[]) => boolean
  /** Whether the user may read a property type's value, by its key. */
  readsProperty: (propertyTypeKey: string) => boolean
  /** How many rows are read before Browse is checked; `QUERY_WINDOW` unless a test says. */
  window?: number
}

export interface QueryItem {
  id: string
  name: string
  path: Array<{ id: string; name: string }>
  contentType: { id: string; alias: string }
  state: QueryState
  createDate: string
  updateDate: string
  cultures?: Array<{ culture: string; name: string; state: QueryState }>
}

export interface QueryResult {
  total: number
  /** False when a restricted user's window was cut before Browse was checked. */
  exact: boolean
  items: QueryItem[]
}

/** A query the request asked for that cannot be run as asked; a 400 by name. */
export class ContentQueryRefused extends Error {}

/** Editors whose value is JSON or markup: only `exists` and `empty` apply; `text` searches them. */
const STRUCTURED_EDITORS = new Set([
  'Umbraco.BlockList',
  'Umbraco.BlockGrid',
  'Umbraco.RichText',
  'Umbraco.MediaPicker3',
  'Umbraco.MultiUrlPicker',
  'Umbraco.MultiNodeTreePicker',
  'Umbraco.ElementPicker',
  'Umbraco.ImageCropper',
  'Umbraco.UploadField',
  'Umbraco.Tags',
])

const stateOf = (published: boolean, edited: boolean, trashed: boolean): QueryState =>
  trashed ? 'trashed' : published && edited ? 'changed' : published ? 'published' : 'draft'

interface PropertyTarget {
  ids: number[]
  column: string
  storage: ValueStorageTypeName
}

/** The documents a query matches, as the scope may see them. */
export async function queryDocuments(
  db: Db,
  query: ContentQuery,
  scope: QueryScope,
): Promise<QueryResult> {
  const run = async (tx: Db) => {
    if (tx.dialect.name === 'postgres')
      await tx.exec(`SET LOCAL statement_timeout = ${QUERY_TIMEOUT_MS}`)
    return runQuery(tx, query, scope)
  }
  // Postgres's timeout is per transaction; SQLite has none, so the window bounds it.
  return db.dialect.name === 'postgres' ? db.transaction(run) : run(db)
}

async function runQuery(db: Db, query: ContentQuery, scope: QueryScope): Promise<QueryResult> {
  const bool = (value: boolean) => db.dialect.boolValue(value) as boolean

  // ---- culture
  let languageId: number | undefined
  if (query.culture) {
    const culture = query.culture
    const language = await db.q
      .selectFrom('language')
      .select('id')
      .where((eb) => eb(eb.fn('lower', ['iso_code']), '=', eb.fn('lower', [eb.val(culture)])))
      .executeTakeFirst()
    if (!language) throw new ContentQueryRefused(`There is no language "${query.culture}".`)
    languageId = Number(language.id)
  }
  const byCulture = <T>(column: 'published' | 'edited' | 'name', fallback: string) =>
    languageId === undefined
      ? sql.ref<T>(fallback)
      : sql<T>`coalesce(${sql.ref(`dcv.${column}`)}, ${sql.ref(fallback)})`
  const published = byCulture<unknown>('published', 'd.published')
  const edited = byCulture<unknown>('edited', 'd.edited')
  const nameColumn = byCulture<string | null>('name', 'n.text')

  let q = db.q
    .selectFrom('node as n')
    .innerJoin('content as c', 'c.node_id', 'n.id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .innerJoin('node as tn', 'tn.id', 'ct.node_id')
    .innerJoin('document as d', 'd.node_id', 'n.id')
    .innerJoin('content_version as cv', (join) =>
      join.onRef('cv.node_id', '=', 'n.id').on('cv.current', '=', bool(true)),
    )
    .$if(languageId !== undefined, (qb) =>
      qb.leftJoin('document_culture_variation as dcv', (join) =>
        join.onRef('dcv.node_id', '=', 'n.id').on('dcv.language_id', '=', languageId as number),
      ),
    )
    .where('n.node_object_type', '=', ObjectTypes.Document)

  // ---- types
  let typeIds: number[] | undefined
  if (query.contentTypes?.length) {
    const rows = await db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as tn', 'tn.id', 'ct.node_id')
      .select(['ct.node_id', 'ct.alias', 'tn.unique_id'])
      .where('tn.node_object_type', '=', ObjectTypes.DocumentType)
      .execute()
    typeIds = []
    for (const wanted of query.contentTypes) {
      const found = rows.find(
        (r) =>
          String(r.alias).toLowerCase() === wanted.toLowerCase() ||
          String(r.unique_id).toLowerCase() === wanted.toLowerCase(),
      )
      if (!found) throw new ContentQueryRefused(`There is no content type "${wanted}".`)
      typeIds.push(Number(found.node_id))
    }
    q = q.where('c.content_type_id', 'in', typeIds)
  }

  // ---- place
  const nodeByKey = async (key: string, field: string) => {
    const row = await db.q
      .selectFrom('node')
      .select(['id', 'path', 'level'])
      .where('unique_id', '=', key.toLowerCase())
      .where('node_object_type', '=', ObjectTypes.Document)
      .executeTakeFirst()
    if (!row) throw new ContentQueryRefused(`"${field}" names no page: ${key}.`)
    return { id: Number(row.id), path: String(row.path), level: Number(row.level) }
  }
  const under = query.under ? await nodeByKey(query.under, 'under') : undefined
  const parent = query.parent ? await nodeByKey(query.parent, 'parent') : undefined
  if (under) q = q.where(like(sql.ref('n.path'), `${escapeLike(under.path)},%`))
  if (parent) q = q.where('n.parent_id', '=', parent.id)
  if (query.maxDepth !== undefined) {
    const from = (under ?? parent) as { level: number }
    q = q.where('n.level', '<=', from.level + query.maxDepth)
  }

  // ---- start nodes: the statement itself stays inside them
  if (!scope.start.root) {
    if (scope.start.keys.length === 0) return { total: 0, exact: true, items: [] }
    const starts = await db.q
      .selectFrom('node')
      .select('path')
      .where(
        'unique_id',
        'in',
        scope.start.keys.map((k) => k.toLowerCase()),
      )
      .execute()
    if (starts.length === 0) return { total: 0, exact: true, items: [] }
    q = q.where((eb) =>
      eb.or(
        starts.map((s) =>
          eb.or([
            eb('n.path', '=', String(s.path)),
            like(eb.ref('n.path'), `${escapeLike(String(s.path))},%`),
          ]),
        ),
      ),
    )
  }

  // ---- state; trashed only when asked for, and never outside root access
  const states = query.state?.length ? query.state : ['published', 'draft', 'changed']
  const wantsTrashed = states.includes('trashed') && scope.start.root
  const live = states.filter((s) => s !== 'trashed')
  if (live.length === 0 && !wantsTrashed) return { total: 0, exact: true, items: [] }
  q = q.where((eb) => {
    const clauses: Expression<boolean | 0 | 1>[] = []
    if (live.length > 0) {
      const parts: Expression<boolean | 0 | 1>[] = []
      if (live.includes('published'))
        parts.push(eb.and([eb(published, '=', bool(true)), eb(edited, '=', bool(false))]))
      if (live.includes('changed'))
        parts.push(eb.and([eb(published, '=', bool(true)), eb(edited, '=', bool(true))]))
      if (live.includes('draft')) parts.push(eb(published, '=', bool(false)))
      clauses.push(eb.and([eb('n.trashed', '=', bool(false)), eb.or(parts)]))
    }
    if (wantsTrashed) clauses.push(eb('n.trashed', '=', bool(true)))
    return eb.or(clauses)
  })

  // ---- dates
  const between = (
    column: 'n.create_date' | 'cv.version_date',
    range: { from?: Date; to?: Date } | undefined,
  ) => {
    if (range?.from) q = q.where(column, '>=', DbDate.toDb(range.from))
    if (range?.to) q = q.where(column, '<=', DbDate.toDb(range.to))
  }
  between('n.create_date', query.created)
  between('cv.version_date', query.updated)

  // ---- name
  if (query.name) {
    const value = query.name.value.toLowerCase()
    const lowered = sql`lower(${nameColumn})`
    if (query.name.op === 'equals') q = q.where((eb) => eb(lowered, '=', value))
    else
      q = q.where(
        like(
          lowered,
          query.name.op === 'startsWith' ? `${escapeLike(value)}%` : `%${escapeLike(value)}%`,
        ),
      )
  }

  // ---- full text, through the existing index
  if (query.text) {
    const hits = db.dialect.fullTextMatches(db.dialect.fullTextQuery(searchTerms(query.text)))
    q = q.where((eb) => eb('n.id', 'in', eb.selectFrom(hits.as('h')).select('h.node_id')))
  }

  // ---- properties
  for (const clause of query.properties ?? []) {
    const target = await propertyTarget(db, clause.alias, typeIds, scope, clause.op)
    const col = sql.ref(`pv.${target.column}`)
    const text = target.storage === 'Ntext' || target.storage === 'Nvarchar'
    let value: unknown
    if (clause.op !== 'exists' && clause.op !== 'empty') {
      value = comparable(clause.value, target.storage, clause.alias)
      if (clause.op === 'contains' && !text)
        throw new ContentQueryRefused(`"contains" compares text; "${clause.alias}" is not text.`)
    }
    q = q.where((eb) => {
      const row = eb
        .selectFrom('property_value as pv')
        .select(eb.lit(1).as('one'))
        .whereRef('pv.node_id', '=', 'n.id')
        .where('pv.is_current', '=', bool(true))
        .where('pv.segment', 'is', null)
        .where('pv.property_type_id', 'in', target.ids)
        .$if(languageId !== undefined, (sub) =>
          sub.where((e) =>
            e.or([e('pv.language_id', '=', languageId as number), e('pv.language_id', 'is', null)]),
          ),
        )
      if (clause.op === 'exists' || clause.op === 'empty') {
        const hasValue = row.where(col, 'is not', null).$if(text, (sub) => sub.where(col, '<>', ''))
        return clause.op === 'empty' ? eb.not(eb.exists(hasValue)) : eb.exists(hasValue)
      }
      if (clause.op === 'contains')
        return eb.exists(
          row.where(like(sql`lower(${col})`, `%${escapeLike(String(value).toLowerCase())}%`)),
        )
      const operator = ({ eq: '=', ne: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const)[
        clause.op
      ]
      const left = text ? sql`lower(${col})` : col
      const right = text ? String(value).toLowerCase() : value
      // `ne` is "has no value equal to this", so a page without the value matches too.
      const matches = eb.exists(row.where(left, operator, right))
      return clause.op === 'ne' ? eb.not(matches) : matches
    })
  }

  // ---- sort
  const by = query.sort?.by ?? 'name'
  const dir = query.sort?.dir === 'desc' ? 'desc' : 'asc'
  const sortColumn = {
    name: sql`lower(${nameColumn})`,
    createDate: sql.ref('n.create_date'),
    updateDate: sql.ref('cv.version_date'),
    path: sql.ref('n.path'),
    sortOrder: sql.ref('n.sort_order'),
  }[by]

  const select = q
    .select([
      'n.id',
      'n.unique_id',
      'n.path',
      'n.trashed',
      'n.create_date',
      nameColumn.as('name'),
      'ct.alias as type_alias',
      'tn.unique_id as type_key',
      'cv.version_date',
      published.as('published'),
      edited.as('edited'),
    ])
    .orderBy(sortColumn, dir)
    .orderBy('n.id', dir)

  let rows: Row[]
  let total: number
  let exact = true
  if (!scope.browses) {
    const count = await q.select((eb) => eb.fn.countAll().as('n')).executeTakeFirst()
    total = Number(count?.n ?? 0)
    rows = await select.limit(query.take).offset(query.skip).execute()
  } else {
    const limit = scope.window ?? QUERY_WINDOW
    const window = await select.limit(limit + 1).execute()
    exact = window.length <= limit
    const keys = await keysByIds(db, window.slice(0, limit))
    const visible = window
      .slice(0, limit)
      .filter((row) => scope.browses?.(chainOf(row.path, row.unique_id, keys)) ?? true)
    total = visible.length
    rows = visible.slice(query.skip, query.skip + query.take)
  }
  return { total, exact, items: await toItems(db, rows) }
}

type Row = {
  id: number
  unique_id: string
  path: string
  trashed: unknown
  create_date: unknown
  name: string | null
  type_alias: string
  type_key: string
  version_date: unknown
  published: unknown
  edited: unknown
}

/** `left LIKE pattern`, with `\` escaping the pattern's wildcards as `escapeLike` writes them. */
const like = (left: Expression<unknown>, pattern: string) =>
  sql<boolean>`${left} like ${pattern} escape '\\'`

/** The property types a clause compares, checked for reading and for being comparable. */
async function propertyTarget(
  db: Db,
  alias: string,
  typeIds: number[] | undefined,
  scope: QueryScope,
  op: PropertyOp,
): Promise<PropertyTarget> {
  const owners = typeIds ? await withCompositions(db, typeIds) : undefined
  const rows = await db.q
    .selectFrom('property_type as pt')
    .innerJoin('data_type as dt', 'dt.node_id', 'pt.data_type_id')
    .innerJoin('content_type as ct', 'ct.node_id', 'pt.content_type_id')
    .innerJoin('node as tn', 'tn.id', 'ct.node_id')
    .select(['pt.id', 'pt.unique_id', 'dt.db_type', 'dt.editor_alias'])
    .where((eb) => eb(eb.fn('lower', ['pt.alias']), '=', eb.fn('lower', [eb.val(alias)])))
    .where('pt.retired_at', 'is', null)
    .where('tn.node_object_type', '=', ObjectTypes.DocumentType)
    .$if(owners !== undefined, (qb) => qb.where('pt.content_type_id', 'in', owners as number[]))
    .execute()
  if (rows.length === 0)
    throw new ContentQueryRefused(
      `There is no property "${alias}"${typeIds ? ' on the content types given' : ''}.`,
    )
  // A filter on a value the user cannot read would tell them about it.
  if (rows.some((r) => !scope.readsProperty(String(r.unique_id))))
    throw new ContentQueryRefused(`You cannot read the property "${alias}".`)
  const storages = new Set(rows.map((r) => r.db_type))
  if (storages.size > 1)
    throw new ContentQueryRefused(
      `"${alias}" is stored differently on different types; name one content type.`,
    )
  const structured = rows.some((r) => STRUCTURED_EDITORS.has(r.editor_alias))
  if (structured && op !== 'exists' && op !== 'empty')
    throw new ContentQueryRefused(
      `"${alias}" holds structured content; use "exists" or "empty", or "text" to search it.`,
    )
  const storage = rows[0]?.db_type as ValueStorageTypeName
  const column = STORAGE_COLUMN[storage]
  if (!column) throw new ContentQueryRefused(`"${alias}" cannot be compared.`)
  return { ids: rows.map((r) => Number(r.id)), column, storage }
}

/** The types and every type they are composed of, transitively. */
async function withCompositions(db: Db, typeIds: number[]): Promise<number[]> {
  const links = await db.q
    .selectFrom('content_type_composition')
    .select(['parent_content_type_id as parent', 'child_content_type_id as child'])
    .execute()
  const found = new Set(typeIds)
  let grew = true
  while (grew) {
    grew = false
    for (const link of links)
      if (found.has(Number(link.child)) && !found.has(Number(link.parent))) {
        found.add(Number(link.parent))
        grew = true
      }
  }
  return [...found]
}

/** A clause's value as its storage type compares it. */
function comparable(value: unknown, storage: ValueStorageTypeName, alias: string): unknown {
  if (storage === 'Integer') {
    const n = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value)
    if (!Number.isFinite(n)) throw new ContentQueryRefused(`"${alias}" compares numbers.`)
    return Math.trunc(n)
  }
  if (storage === 'Decimal') {
    const n = Number(value)
    if (!Number.isFinite(n)) throw new ContentQueryRefused(`"${alias}" compares numbers.`)
    return n
  }
  if (storage === 'Date') {
    const date = new Date(String(value))
    if (Number.isNaN(date.getTime())) throw new ContentQueryRefused(`"${alias}" compares dates.`)
    return DbDate.toDb(date)
  }
  if (typeof value === 'object') throw new ContentQueryRefused(`"${alias}" compares text.`)
  return String(value)
}

/** id → key for every node on these rows' paths, for Browse and the path chain. */
async function keysByIds(
  db: Db,
  rows: ReadonlyArray<{ path: string }>,
): Promise<Map<number, { key: string; name: string }>> {
  const ids = new Set<number>()
  for (const row of rows)
    for (const part of String(row.path).split(',')) {
      const id = Number(part)
      if (id > 0) ids.add(id)
    }
  const map = new Map<number, { key: string; name: string }>()
  const all = [...ids]
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500)
    const found = await db.q
      .selectFrom('node')
      .select(['id', 'unique_id', 'text'])
      .where('id', 'in', chunk)
      .execute()
    for (const f of found)
      map.set(Number(f.id), { key: String(f.unique_id).toLowerCase(), name: String(f.text ?? '') })
  }
  return map
}

/** A page's ancestor keys then its own, root first, as the permission rules read them. */
function chainOf(
  path: string,
  key: string,
  keys: Map<number, { key: string; name: string }>,
): string[] {
  const ancestors = String(path)
    .split(',')
    .map(Number)
    .filter((id) => id > 0)
    .slice(0, -1)
    .map((id) => keys.get(id)?.key ?? '')
  return [...ancestors.filter(Boolean), String(key).toLowerCase()]
}

async function toItems(db: Db, rows: readonly Row[]): Promise<QueryItem[]> {
  if (rows.length === 0) return []
  const keys = await keysByIds(db, rows)
  const ids = rows.map((r) => Number(r.id))
  const cultures = await db.q
    .selectFrom('document_culture_variation as dcv')
    .innerJoin('language as l', 'l.id', 'dcv.language_id')
    .select(['dcv.node_id', 'l.iso_code', 'dcv.name', 'dcv.published', 'dcv.edited'])
    .where('dcv.available', '=', db.dialect.boolValue(true) as boolean)
    .where('dcv.node_id', 'in', ids)
    .orderBy('l.iso_code')
    .execute()
  const iso = (value: unknown) => (DbDate.fromDb(value) ?? new Date(0)).toISOString()
  return rows.map((row) => {
    const trashed = fromDbBool(row.trashed)
    const own = cultures.filter((c) => Number(c.node_id) === Number(row.id))
    const path = String(row.path)
      .split(',')
      .map(Number)
      .filter((id) => id > 0 && id !== Number(row.id))
      .map((id) => ({ id: keys.get(id)?.key ?? '', name: keys.get(id)?.name ?? '' }))
      .filter((step) => step.id !== '')
    return {
      id: String(row.unique_id).toLowerCase(),
      name: String(row.name ?? ''),
      path,
      contentType: { id: String(row.type_key).toLowerCase(), alias: String(row.type_alias) },
      state: stateOf(fromDbBool(row.published), fromDbBool(row.edited), trashed),
      createDate: iso(row.create_date),
      updateDate: iso(row.version_date),
      ...(own.length > 0
        ? {
            cultures: own.map((c) => ({
              culture: String(c.iso_code),
              name: String(c.name ?? ''),
              state: stateOf(fromDbBool(c.published), fromDbBool(c.edited), trashed),
            })),
          }
        : {}),
    }
  })
}
