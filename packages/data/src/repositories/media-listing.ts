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
import type { Db } from '../database.ts'

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

const NAME = 'COALESCE(head.text, n.text)'
const FROM = `FROM node n
  JOIN content c ON c.node_id = n.id
  JOIN content_type ct ON ct.node_id = c.content_type_id
  LEFT JOIN content_version head ON head.node_id = n.id AND head.current = ?`

const SORT_COLUMNS: Record<MediaSortField, string> = {
  createDate: 'n.create_date',
  updateDate: 'COALESCE(head.version_date, n.create_date)',
  name: `LOWER(${NAME})`,
  sortOrder: 'n.sort_order',
}

const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Who may read a child, as SQL, under one rule: `memberMay('read', …)` with
 * everything but the item's own columns worked out here. Pure.
 */
function readableUnder(
  rule: MediaRule | undefined,
  member: MediaMember | undefined,
): { sql: string; params: unknown[] } {
  const held = new Set(member?.groups.map((g) => g.toLowerCase()) ?? [])
  const inGroups = (names: readonly string[]) => names.some((n) => held.has(n.toLowerCase()))
  const groups =
    inGroups(rule?.readGroups ?? []) ||
    Boolean(
      member && rule?.readMembers?.some((key) => key.toLowerCase() === member.key.toLowerCase()),
    )
  const inherited = !rule || rule.publicRead || groups
  const parts = ["c.read_policy = 'public'"]
  const params: unknown[] = []
  if (groups) parts.push("c.read_policy = 'groups'")
  if (member) {
    parts.push("c.read_policy = 'members'")
    parts.push("(c.read_policy = 'creator' AND c.creator_member_key = ?)")
    params.push(normaliseUuid(member.key))
  }
  if (inherited) parts.push("(c.read_policy IS NULL OR c.read_policy = 'inherit')")
  return { sql: `(${parts.join(' OR ')})`, params }
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
    const joins: string[] = []
    const joinParams: unknown[] = []
    if (query.readable || mediaTypes.length > 0) joins.push('JOIN content c ON c.node_id = n.id')
    if (mediaTypes.length > 0) joins.push('JOIN content_type ct ON ct.node_id = c.content_type_id')
    const head = 'LEFT JOIN content_version head ON head.node_id = n.id AND head.current = ?'
    const where = ['n.parent_id = ?', 'n.node_object_type = ?', 'n.trashed = ?']
    const params: unknown[] = [query.parentId, ObjectTypes.Media, this.#db.dialect.boolValue(false)]
    for (const alias of mediaTypes) {
      where.push('ct.alias = ?')
      params.push(alias)
    }
    for (const part of names) {
      where.push(`LOWER(${NAME}) LIKE ? ESCAPE '\\'`)
      params.push(`%${likeEscape(part.toLowerCase())}%`)
    }
    if (query.readable) {
      // The children share the rule above them, except one with a rule of its own.
      const { rules, member } = query.readable
      const own = [...rules.values()]
      const above = readableUnder(nearestMediaRule(query.parentPath, rules), member)
      const clauses: string[] = []
      if (own.length === 0) clauses.push(above.sql)
      else
        clauses.push(
          `(n.id NOT IN (${own.map(() => '?').join(', ')}) AND ${above.sql})`,
          ...own.map((rule) => `(n.id = ? AND ${readableUnder(rule, member).sql})`),
        )
      where.push(`(${clauses.join(' OR ')})`)
      if (own.length > 0) params.push(...own.map((rule) => rule.nodeId))
      params.push(...above.params)
      for (const rule of own) params.push(rule.nodeId, ...readableUnder(rule, member).params)
    }
    const from = (withHead: boolean) =>
      `FROM node n ${[...joins, ...(withHead ? [head] : [])].join(' ')} WHERE ${where.join(' AND ')}`
    const headParams = (withHead: boolean) =>
      withHead ? [...joinParams, this.#db.dialect.boolValue(true)] : joinParams
    const countHead = names.length > 0
    const counted = await this.#db.query<{ n: unknown }>(
      `SELECT COUNT(*) AS n ${from(countHead)}`,
      [...headParams(countHead), ...params],
    )
    const pageHead = countHead || sortsByHead
    const order = query.sort
      ? `${SORT_COLUMNS[query.sort.field]} ${query.sort.ascending ? 'ASC' : 'DESC'}, n.sort_order, n.id`
      : 'n.sort_order, n.id'
    const rows =
      query.take <= 0
        ? []
        : await this.#db.query<{ unique_id: string }>(
            `SELECT n.unique_id ${from(pageHead)} ORDER BY ${order} LIMIT ? OFFSET ?`,
            [...headParams(pageHead), ...params, query.take, Math.max(0, query.skip)],
          )
    return {
      total: Number(counted[0]?.n ?? 0),
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
    const rows = await this.#db.query<{ id: number; unique_id: string; path: string }>(
      'SELECT id, unique_id, path FROM node WHERE unique_id = ? AND node_object_type = ? AND trashed = ?',
      [normaliseUuid(key), ObjectTypes.Media, this.#db.dialect.boolValue(false)],
    )
    const row = rows[0]
    return row
      ? { id: Number(row.id), key: normaliseUuid(String(row.unique_id)), path: String(row.path) }
      : undefined
  }

  async #childNamed(parentId: number, name: string) {
    const lowered = name.toLowerCase()
    const query = (extra: string, params: unknown[], limit = '') =>
      this.#db.query<{ id: number; unique_id: string; path: string; name: string }>(
        `SELECT n.id, n.unique_id, n.path, ${NAME} AS name ${FROM}
          WHERE n.parent_id = ? AND n.node_object_type = ? AND n.trashed = ? ${extra}
          ORDER BY n.sort_order, n.id ${limit}`,
        [
          this.#db.dialect.boolValue(true),
          parentId,
          ObjectTypes.Media,
          this.#db.dialect.boolValue(false),
          ...params,
        ],
      )
    let rows = await query(`AND LOWER(${NAME}) = ?`, [lowered], 'LIMIT 1')
    // SQLite lowers only ASCII, so a name with other letters is matched here.
    if (rows.length === 0 && this.#db.dialect.name === 'sqlite' && /[^ -~]/.test(name))
      rows = (await query('', [])).filter((row) => String(row.name).toLowerCase() === lowered)
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
      const rows = await this.#db.query<{ id: number; name: string }>(
        `SELECT n.id, ${NAME} AS name FROM node n
          LEFT JOIN content_version head ON head.node_id = n.id AND head.current = ?
          WHERE n.id IN (${slice.map(() => '?').join(', ')})`,
        [this.#db.dialect.boolValue(true), ...slice],
      )
      for (const row of rows) out.set(Number(row.id), String(row.name ?? ''))
    }
    return out
  }
}
