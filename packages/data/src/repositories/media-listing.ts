/**
 * The media tree read a page at a time (story 197): the Delivery API's media
 * listing, an item by its path of names, and those paths, as indexed queries
 * over `node`, so no request holds the library in memory. The order is
 * Umbraco's: `sort_order`, then the node id. docs/delivery-api.md, "Media".
 */
import {
  type MediaMember,
  type MediaRule,
  nearestMediaRule,
  normaliseUuid,
  ObjectTypes,
} from '@crombolo/core'
import type { ExpressionBuilder, SelectQueryBuilder, SqlBool } from 'kysely'
import type { Db } from '../database.ts'
import { type Expression, sql } from '../query.ts'
import type { CoreTables } from '../tables.gen.ts'

export type MediaSortField = 'createDate' | 'updateDate' | 'name' | 'sortOrder'

export interface MediaListingQuery {
  /** The parent's node id; -1 for the top level. */
  parentId: number
  /** Its path, for the rule the children inherit; `-1` for the top level. */
  parentPath: string
  /** Every one must match: a media type alias. */
  mediaTypes?: readonly string[]
  /** Every one must match: part of the name, in any case. */
  names?: readonly string[]
  sort?: { field: MediaSortField; ascending: boolean }
  skip: number
  take: number
  /** Leaves out what this caller may not read; everything when absent. */
  readable?: { rules: ReadonlyMap<number, MediaRule>; member: MediaMember | undefined }
}

type Listed = {
  n: CoreTables['node']
  c: CoreTables['content']
  ct: CoreTables['content_type']
  head: CoreTables['content_version']
}
type Aliases = keyof Listed
type Eb = ExpressionBuilder<CoreTables & Listed, Aliases>

const nameOf = (eb: Eb) => eb.fn.coalesce('head.text', 'n.text')

const SORT_COLUMNS: Record<MediaSortField, (eb: Eb) => Expression<unknown>> = {
  createDate: (eb) => eb.ref('n.create_date'),
  updateDate: (eb) => eb.fn.coalesce('head.version_date', 'n.create_date'),
  name: (eb) => eb.fn('lower', [nameOf(eb)]),
  sortOrder: (eb) => eb.ref('n.sort_order'),
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Who may read a child, as a condition, under one rule: `memberMay('read', …)`
 * with everything but the item's own columns worked out here. Pure.
 */
function readableUnder(
  eb: Eb,
  rule: MediaRule | undefined,
  member: MediaMember | undefined,
): Expression<SqlBool> {
  const held = new Set(member?.groups.map((g) => g.toLowerCase()) ?? [])
  const inGroups = (names: readonly string[]) => names.some((n) => held.has(n.toLowerCase()))
  const groups =
    inGroups(rule?.readGroups ?? []) ||
    Boolean(
      member && rule?.readMembers?.some((key) => key.toLowerCase() === member.key.toLowerCase()),
    )
  const inherited = !rule || rule.publicRead || groups
  const parts: Expression<SqlBool>[] = [eb('c.read_policy', '=', 'public')]
  if (groups) parts.push(eb('c.read_policy', '=', 'groups'))
  if (member) {
    parts.push(eb('c.read_policy', '=', 'members'))
    parts.push(
      eb.and([
        eb('c.read_policy', '=', 'creator'),
        eb('c.creator_member_key', '=', normaliseUuid(member.key)),
      ]),
    )
  }
  if (inherited)
    parts.push(eb.or([eb('c.read_policy', 'is', null), eb('c.read_policy', '=', 'inherit')]))
  return eb.or(parts)
}

export class MediaListingRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /**
   * A page of a parent's children: their keys in order, and how many match in
   * all. Only the tables a filter or sort reads are joined, so the count over a
   * large folder reads the node index alone where it can.
   */
  async children(query: MediaListingQuery): Promise<{ total: number; keys: string[] }> {
    const mediaTypes = query.mediaTypes ?? []
    const names = query.names ?? []
    const sortsByHead = query.sort?.field === 'name' || query.sort?.field === 'updateDate'
    const db = this.#db
    const listing = (withHead: boolean) =>
      (
        db.q.selectFrom('node as n') as unknown as SelectQueryBuilder<
          CoreTables & Listed,
          Aliases,
          object
        >
      )
        .$if(Boolean(query.readable) || mediaTypes.length > 0, (q) =>
          q.innerJoin('content as c', 'c.node_id', 'n.id'),
        )
        .$if(mediaTypes.length > 0, (q) =>
          q.innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id'),
        )
        .$if(withHead, (q) =>
          q.leftJoin('content_version as head', (join) =>
            join
              .onRef('head.node_id', '=', 'n.id')
              .on('head.current', '=', db.dialect.boolValue(true)),
          ),
        )
        .where('n.parent_id', '=', query.parentId)
        .where('n.node_object_type', '=', ObjectTypes.Media)
        .where('n.trashed', '=', db.dialect.boolValue(false))
        .$call((q) => mediaTypes.reduce((acc, alias) => acc.where('ct.alias', '=', alias), q))
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
        .$if(Boolean(query.readable), (q) =>
          q.where((eb) => {
            // The children share the rule above them, except one with a rule of its own.
            const { rules, member } = query.readable as NonNullable<MediaListingQuery['readable']>
            const own = [...rules.values()]
            const above = readableUnder(eb, nearestMediaRule(query.parentPath, rules), member)
            if (own.length === 0) return eb.or([above])
            return eb.or([
              eb.and([
                eb(
                  'n.id',
                  'not in',
                  own.map((rule) => rule.nodeId),
                ),
                above,
              ]),
              ...own.map((rule) =>
                eb.and([eb('n.id', '=', rule.nodeId), readableUnder(eb, rule, member)]),
              ),
            ])
          }),
        )
    const countHead = names.length > 0
    const counted = await listing(countHead)
      .select(sql<number>`count(*)`.as('n'))
      .executeTakeFirst()
    const pageHead = countHead || sortsByHead
    const sort = query.sort
    const rows =
      query.take <= 0
        ? []
        : await listing(pageHead)
            .select('n.unique_id')
            .$call((q) =>
              sort
                ? q.orderBy((eb) => SORT_COLUMNS[sort.field](eb), sort.ascending ? 'asc' : 'desc')
                : q,
            )
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

  /** The node at a path of names below the top level, in any case; the first by sort order. */
  async byPath(path: string): Promise<{ id: number; key: string; path: string } | undefined> {
    let parentId = -1
    let found: { id: number; key: string; path: string } | undefined
    for (const segment of path.split('/').filter(Boolean)) {
      found = await this.#childNamed(parentId, segment)
      if (!found) return undefined
      parentId = found.id
    }
    return found
  }

  /** A node's id and path, by key; undefined for anything not media or in the bin. */
  async byKey(key: string): Promise<{ id: number; key: string; path: string } | undefined> {
    const row = await this.#db.q
      .selectFrom('node')
      .select(['id', 'unique_id', 'path'])
      .where('unique_id', '=', normaliseUuid(key))
      .where('node_object_type', '=', ObjectTypes.Media)
      .where('trashed', '=', this.#db.dialect.boolValue(false))
      .executeTakeFirst()
    return row
      ? { id: Number(row.id), key: normaliseUuid(String(row.unique_id)), path: String(row.path) }
      : undefined
  }

  async #childNamed(parentId: number, name: string) {
    const lowered = name.toLowerCase()
    const db = this.#db
    const query = (exact: boolean) =>
      (
        db.q.selectFrom('node as n') as unknown as SelectQueryBuilder<
          CoreTables & Listed,
          Aliases,
          object
        >
      )
        .innerJoin('content as c', 'c.node_id', 'n.id')
        .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
        .leftJoin('content_version as head', (join) =>
          join
            .onRef('head.node_id', '=', 'n.id')
            .on('head.current', '=', db.dialect.boolValue(true)),
        )
        .select((eb) => ['n.id', 'n.unique_id', 'n.path', nameOf(eb).as('name')])
        .where('n.parent_id', '=', parentId)
        .where('n.node_object_type', '=', ObjectTypes.Media)
        .where('n.trashed', '=', db.dialect.boolValue(false))
        .$if(exact, (q) => q.where((eb) => eb(eb.fn('lower', [nameOf(eb)]), '=', lowered)))
        .orderBy('n.sort_order')
        .orderBy('n.id')
        .$if(exact, (q) => q.limit(1))
        .execute()
    let rows = await query(true)
    // SQLite lowers only ASCII, so a name with other letters is matched here.
    if (rows.length === 0 && this.#db.dialect.name === 'sqlite' && /[^ -~]/.test(name))
      rows = (await query(false)).filter((row) => String(row.name).toLowerCase() === lowered)
    const row = rows[0]
    return row
      ? { id: Number(row.id), key: normaliseUuid(String(row.unique_id)), path: String(row.path) }
      : undefined
  }

  /** Each node's name, by id: for the paths of names an answer carries. */
  async names(ids: readonly number[]): Promise<Map<number, string>> {
    const wanted = [...new Set(ids.filter((id) => id > 0))]
    const out = new Map<number, string>()
    for (let at = 0; at < wanted.length; at += 500) {
      const slice = wanted.slice(at, at + 500)
      const rows = await (
        this.#db.q.selectFrom('node as n') as unknown as SelectQueryBuilder<
          CoreTables & Listed,
          'n',
          object
        >
      )
        .leftJoin('content_version as head', (join) =>
          join
            .onRef('head.node_id', '=', 'n.id')
            .on('head.current', '=', this.#db.dialect.boolValue(true)),
        )
        .select((eb) => ['n.id', eb.fn.coalesce('head.text', 'n.text').as('name')])
        .where('n.id', 'in', slice)
        .execute()
      for (const row of rows) out.set(Number(row.id), String(row.name ?? ''))
    }
    return out
  }
}
