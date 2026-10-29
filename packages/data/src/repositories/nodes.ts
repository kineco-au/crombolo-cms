/**
 * Shared access to `node`, the universal tree.
 *
 * Every tree in the backoffice — documents, content types, data types, templates —
 * is the same query with a different object type, so it lives here once.
 */
import { normaliseUuid, ObjectTypes, type Page, SystemNodes } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { sql } from '../query.ts'
import { searchTerms } from '../search-text.ts'

export interface NodeRow {
  id: number
  key: string
  parentId: number
  level: number
  path: string
  sortOrder: number
  trashed: boolean
  text: string | null
  objectType: string | null
  createDate: Date | undefined
}

export function mapNode(row: Record<string, unknown>): NodeRow {
  return {
    id: Number(row.id),
    key: normaliseUuid(String(row.unique_id)),
    parentId: Number(row.parent_id),
    level: Number(row.level),
    path: String(row.path),
    sortOrder: Number(row.sort_order),
    trashed: fromDbBool(row.trashed),
    text: (row.text as string | null) ?? null,
    objectType: row.node_object_type ? normaliseUuid(String(row.node_object_type)) : null,
    createDate: DbDate.fromDb(row.create_date),
  }
}

const NODE_COLUMNS = [
  'id',
  'unique_id',
  'parent_id',
  'level',
  'path',
  'sort_order',
  'trashed',
  'text',
  'node_object_type',
  'create_date',
] as const

export interface CreateNodeInit {
  key?: string
  parentId: number
  objectType: string
  text: string
  userId?: number
  sortOrder?: number
}

export class NodeRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async byKey(key: string): Promise<NodeRow | undefined> {
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('unique_id', '=', normaliseUuid(key))
      .execute()
    return rows[0] ? mapNode(rows[0]) : undefined
  }

  async byId(id: number): Promise<NodeRow | undefined> {
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('id', '=', id)
      .execute()
    return rows[0] ? mapNode(rows[0]) : undefined
  }

  async byKeys(keys: readonly string[]): Promise<NodeRow[]> {
    if (keys.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('unique_id', 'in', keys.map(normaliseUuid))
      .execute()
    return rows.map(mapNode)
  }

  /**
   * Creates a node, computing `level` and the materialised `path` from the
   * parent. The path is what makes descendant queries a prefix match.
   */
  async create(init: CreateNodeInit): Promise<NodeRow> {
    const key = normaliseUuid(init.key ?? crypto.randomUUID())
    const parent = init.parentId === SystemNodes.Root ? undefined : await this.byId(init.parentId)
    const level = parent ? parent.level + 1 : 1
    const sortOrder = init.sortOrder ?? (await this.#nextSortOrder(init.parentId, init.objectType))
    const now = DbDate.toDb(new Date())

    await this.#db.q
      .insertInto('node')
      .values({
        unique_id: key,
        parent_id: init.parentId,
        level,
        path: '',
        sort_order: sortOrder,
        trashed: this.#db.dialect.boolValue(false),
        node_user: init.userId ?? null,
        text: init.text,
        node_object_type: init.objectType,
        create_date: now,
      })
      .execute()
    const created = await this.byKey(key)
    if (!created) throw new Error('Node insert did not produce a row.')

    const path = parent ? `${parent.path},${created.id}` : `${SystemNodes.Root},${created.id}`
    await this.#db.q.updateTable('node').set({ path }).where('id', '=', created.id).execute()
    return { ...created, path }
  }

  async rename(id: number, text: string): Promise<void> {
    await this.#db.q.updateTable('node').set({ text }).where('id', '=', id).execute()
  }

  async delete(id: number): Promise<void> {
    await this.#db.q.deleteFrom('node').where('id', '=', id).execute()
  }

  /** Root-level items of a type, i.e. those parented to the system root. */
  async roots(objectType: string, skip: number, take: number): Promise<Page<NodeRow>> {
    return this.children(SystemNodes.Root, objectType, skip, take)
  }

  async children(
    parentId: number,
    objectType: string,
    skip: number,
    take: number,
    trashed = false,
    excludeKeys: readonly string[] = [],
  ): Promise<Page<NodeRow>> {
    const matching = this.#db.q
      .selectFrom('node')
      .where('parent_id', '=', parentId)
      .where('node_object_type', '=', objectType)
      .where('trashed', '=', this.#db.dialect.boolValue(trashed))
      .$if(excludeKeys.length > 0, (q) =>
        q.where('unique_id', 'not in', excludeKeys.map(normaliseUuid)),
      )
    const totals = await matching.select((eb) => eb.fn.countAll().as('n')).execute()
    const rows = await matching
      .select(NODE_COLUMNS)
      .orderBy('sort_order')
      .orderBy('id')
      .limit(take)
      .offset(skip)
      .execute()
    return { total: Number(totals[0]?.n ?? 0), items: rows.map(mapNode) }
  }

  /** Children of several object types at once: a settings tree with folders first, then by name. */
  async childrenOf(
    parentId: number,
    objectTypes: readonly string[],
    skip: number,
    take: number,
  ): Promise<Page<NodeRow>> {
    if (objectTypes.length === 0) return { total: 0, items: [] }
    const matching = this.#db.q
      .selectFrom('node')
      .where('parent_id', '=', parentId)
      .where('node_object_type', 'in', objectTypes)
      .where('trashed', '=', this.#db.dialect.boolValue(false))
    const totals = await matching.select((eb) => eb.fn.countAll().as('n')).execute()
    const rows = await matching
      .select(NODE_COLUMNS)
      .orderBy((eb) =>
        eb
          .case()
          .when('node_object_type', '=', objectTypes[0] as string)
          .then(0)
          .else(1)
          .end(),
      )
      .orderBy('text')
      .orderBy('id')
      .limit(take)
      .offset(skip)
      .execute()
    return { total: Number(totals[0]?.n ?? 0), items: rows.map(mapNode) }
  }

  /** Re-parents a node and its descendants, keeping levels and paths true. */
  async move(id: number, newParentId: number): Promise<void> {
    const node = await this.byId(id)
    if (!node) return
    const parent = newParentId === SystemNodes.Root ? undefined : await this.byId(newParentId)
    const newPath = parent ? `${parent.path},${node.id}` : `${SystemNodes.Root},${node.id}`
    const newLevel = parent ? parent.level + 1 : 1
    const delta = newLevel - node.level
    const oldPath = node.path
    await this.#db.q
      .updateTable('node')
      .set({ parent_id: newParentId, level: newLevel, path: newPath })
      .where('id', '=', node.id)
      .execute()
    const descendants = await this.#db.q
      .selectFrom('node')
      .select(['id', 'path', 'level'])
      .where('path', 'like', `${oldPath},%`)
      .execute()
    for (const d of descendants) {
      await this.#db.q
        .updateTable('node')
        .set({
          path: `${newPath}${String(d.path).slice(oldPath.length)}`,
          level: Number(d.level) + delta,
        })
        .where('id', '=', Number(d.id))
        .execute()
    }
  }

  /** A window of a node's siblings around it: `before` above, `after` below, the node itself included. */
  async siblings(
    key: string,
    objectType: string | readonly string[],
    before: number,
    after: number,
  ): Promise<{ items: NodeRow[]; totalBefore: number; totalAfter: number } | undefined> {
    const target = await this.byKey(key)
    if (!target) return undefined
    const types = typeof objectType === 'string' ? [objectType] : [...objectType]
    const all = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('parent_id', '=', target.parentId)
      .where('node_object_type', 'in', types)
      .where('trashed', '=', this.#db.dialect.boolValue(target.trashed))
      .$if(types.length > 1, (q) =>
        q
          .orderBy((eb) =>
            eb
              .case()
              .when('node_object_type', '=', types[0] as string)
              .then(0)
              .else(1)
              .end(),
          )
          .orderBy('text'),
      )
      .$if(types.length <= 1, (q) => q.orderBy('sort_order'))
      .orderBy('id')
      .execute()
    const rows = all.map(mapNode)
    const index = rows.findIndex((row) => row.id === target.id)
    const start = Math.max(0, index - before)
    const end = Math.min(rows.length, index + after + 1)
    return { items: rows.slice(start, end), totalBefore: start, totalAfter: rows.length - end }
  }

  /**
   * Name search, case-insensitive, optionally under a parent. With `fullText`,
   * an item also matches when the search index holds every word of the query by
   * prefix; items whose name matches come first, then the best index matches.
   */
  async search(
    objectType: string,
    query: string,
    options: {
      trashed?: boolean
      parentId?: number
      fullText?: boolean
      skip: number
      take: number
    },
  ): Promise<Page<NodeRow>> {
    const like = `%${query.toLowerCase().replaceAll('%', '').replaceAll('_', '')}%`
    const terms = options.fullText ? searchTerms(query) : []
    const indexed = terms.length > 0
    const dialect = this.#db.dialect
    const hitNode = sql.ref<number | null>('h.node_id')
    const hitScore = sql.ref<number | null>('h.score')
    const { parentId } = options
    const matching = this.#db.q
      .selectFrom('node')
      .$if(
        indexed,
        (q) =>
          q.leftJoin(
            dialect.fullTextMatches(dialect.fullTextQuery(terms)).as('h'),
            'h.node_id',
            'node.id',
          ) as unknown as typeof q,
      )
      .where('node_object_type', '=', objectType)
      .where('trashed', '=', dialect.boolValue(options.trashed ?? false))
      .where((eb) => {
        const named = eb(eb.fn('lower', ['text']), 'like', like)
        return indexed ? eb.or([named, eb(hitNode, 'is not', null)]) : named
      })
      .$if(parentId !== undefined, (q) => q.where('parent_id', '=', parentId as number))
    const totals = await matching.select((eb) => eb.fn.countAll().as('n')).execute()
    const rows = await matching
      .select(NODE_COLUMNS)
      .$if(indexed, (q) =>
        q
          .orderBy((eb) =>
            eb
              .case()
              .when(eb(eb.fn('lower', ['text']), 'like', like))
              .then(0)
              .else(1)
              .end(),
          )
          .orderBy(sql`coalesce(${hitScore}, 0)`, 'desc'),
      )
      .orderBy('text')
      .orderBy('id')
      .limit(options.take)
      .offset(options.skip)
      .execute()
    return { total: Number(totals[0]?.n ?? 0), items: rows.map(mapNode) }
  }

  /** The nodes with these ids, in no particular order; one query. */
  async byIds(ids: readonly number[]): Promise<NodeRow[]> {
    if (ids.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('id', 'in', [...ids])
      .execute()
    return rows.map(mapNode)
  }

  /** Ancestors of a node, root first, excluding the node itself. */
  async ancestors(key: string): Promise<NodeRow[]> {
    const node = await this.byKey(key)
    if (!node) return []
    const ids = node.path
      .split(',')
      .map((part) => Number(part))
      .filter((id) => id > 0 && id !== node.id)
    if (ids.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('id', 'in', ids)
      .orderBy('level')
      .execute()
    return rows.map(mapNode)
  }

  /**
   * Every descendant of a node, parents before children. The materialised
   * `path` makes this one prefix query rather than a walk — the same trick
   * `move` uses to re-parent a branch.
   *
   * Trashed nodes are excluded: a bundle of a subtree should not carry what
   * somebody deleted out of it.
   */
  async descendants(node: NodeRow, objectTypes: readonly string[]): Promise<NodeRow[]> {
    if (objectTypes.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('path', 'like', `${node.path},%`)
      .where('node_object_type', 'in', objectTypes)
      .where('trashed', '=', this.#db.dialect.boolValue(false))
      .orderBy('level')
      .orderBy('sort_order')
      .orderBy('id')
      .execute()
    return rows.map(mapNode)
  }

  /** The children of a node with a given name, for resolving a content path a segment at a time. */
  async childrenNamed(
    parentId: number,
    objectTypes: readonly string[],
    name: string,
  ): Promise<NodeRow[]> {
    if (objectTypes.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('parent_id', '=', parentId)
      .where('node_object_type', 'in', objectTypes)
      .where('trashed', '=', this.#db.dialect.boolValue(false))
      .where((eb) => eb(eb.fn('lower', ['text']), '=', eb.fn('lower', [eb.val(name)])))
      .orderBy('sort_order')
      .orderBy('id')
      .execute()
    return rows.map(mapNode)
  }

  /** The names under a node, so a failed path resolution can say what was there. */
  async childNames(parentId: number, objectTypes: readonly string[]): Promise<string[]> {
    if (objectTypes.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('node')
      .select('text')
      .where('parent_id', '=', parentId)
      .where('node_object_type', 'in', objectTypes)
      .where('trashed', '=', this.#db.dialect.boolValue(false))
      .orderBy('sort_order')
      .orderBy('id')
      .execute()
    return rows.flatMap((row) => (row.text ? [String(row.text)] : []))
  }

  async hasChildren(id: number, objectType: string): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('node')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('parent_id', '=', id)
      .where('node_object_type', '=', objectType)
      .execute()
    return Number(rows[0]?.n ?? 0) > 0
  }

  /** Bulk `hasChildren`, so a tree page costs one query instead of one per row. */
  async childCounts(ids: readonly number[], objectType: string): Promise<Map<number, number>> {
    if (ids.length === 0) return new Map()
    const rows = await this.#db.q
      .selectFrom('node')
      .select((eb) => ['parent_id', eb.fn.countAll().as('n')])
      .where('parent_id', 'in', [...ids])
      .where('node_object_type', '=', objectType)
      .groupBy('parent_id')
      .execute()
    return new Map(rows.map((row) => [Number(row.parent_id), Number(row.n)]))
  }

  async #nextSortOrder(parentId: number, objectType: string): Promise<number> {
    // One maximum per `trashed`, so each is read off the end of `ix_node_parent_sort`
    // rather than across every child: a folder may hold a million files (story 197).
    const max = (trashed: boolean) =>
      this.#db.q
        .selectFrom('node')
        .select((eb) => eb.fn.max('sort_order').as('m'))
        .where('parent_id', '=', parentId)
        .where('node_object_type', '=', objectType)
        .where('trashed', '=', this.#db.dialect.boolValue(trashed))
    const rows = await this.#db.q
      .selectFrom(max(false).unionAll(max(true)).as('maxima'))
      .select((eb) => eb.fn.max('m').as('next'))
      .execute()
    const current = rows[0]?.next
    return current === null || current === undefined ? 0 : Number(current) + 1
  }
}

export { ObjectTypes, SystemNodes }
