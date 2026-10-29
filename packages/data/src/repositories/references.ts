/**
 * What refers to what, derived from the values themselves.
 *
 * Umbraco keeps a `umbracoRelation` row per reference, written when content is
 * saved. Deriving the answer from the current property values instead cannot go
 * stale — a relation table is only as good as the last save that maintained it —
 * and needs no migration. The cost is a scan of `property_value`, which is
 * acceptable for an editor asking "what breaks if I delete this?".
 *
 * A picker stores its target as `umb://document/<hex>` or a bare uuid, so both
 * spellings are matched.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { RelationRepository } from '../relations.ts'

export interface ReferencingNode {
  key: string
  name: string | null
  objectType: string | null
  published: boolean | null
  contentTypeKey: string | null
  contentTypeAlias: string | null
  contentTypeIcon: string | null
}

/** The two spellings a key appears in inside a stored value. */
function patterns(key: string): [string, string] {
  const dashed = normaliseUuid(key)
  return [`%${dashed}%`, `%${dashed.replaceAll('-', '')}%`]
}

export class ReferenceRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  /** Node ids whose current values mention any of `keys`, excluding `keys` themselves. */
  async #referencingIds(keys: readonly string[]): Promise<Map<string, number[]>> {
    const found = new Map<string, number[]>()
    for (const key of keys) {
      const [dashed, plain] = patterns(key)
      const rows = await this.#db.q
        .selectFrom('property_value as pv')
        .select('pv.node_id as id')
        .distinct()
        .where('pv.is_current', '=', this.#db.dialect.boolValue(true))
        .where((eb) => {
          const varchar = eb.fn<string>('lower', ['pv.varchar_value'])
          const text = eb.fn<string>('lower', ['pv.text_value'])
          return eb.or([
            eb(varchar, 'like', dashed),
            eb(text, 'like', dashed),
            eb(varchar, 'like', plain),
            eb(text, 'like', plain),
          ])
        })
        .execute()
      found.set(
        normaliseUuid(key),
        rows.map((row) => Number(row.id)),
      )
    }
    return found
  }

  async #describe(ids: readonly number[]): Promise<ReferencingNode[]> {
    if (ids.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('node as n')
      .leftJoin('content as c', 'c.node_id', 'n.id')
      .leftJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .leftJoin('node as tn', 'tn.id', 'ct.node_id')
      .leftJoin('document as d', 'd.node_id', 'n.id')
      .select([
        'n.unique_id',
        'n.text',
        'n.node_object_type',
        'd.published as published',
        'tn.unique_id as type_key',
        'ct.alias as type_alias',
        'ct.icon as type_icon',
      ])
      .where('n.id', 'in', [...ids])
      .orderBy('n.text')
      .execute()
    return rows.map((row) => ({
      key: String(row.unique_id),
      name: row.text,
      objectType: row.node_object_type,
      published: row.published === null || row.published === undefined ? null : !!row.published,
      contentTypeKey: row.type_key ? String(row.type_key) : null,
      contentTypeAlias: row.type_alias,
      contentTypeIcon: row.type_icon,
    }))
  }

  /** What refers to this one, newest name order, paged. */
  async referencedBy(
    key: string,
    skip: number,
    take: number,
  ): Promise<{ total: number; items: ReferencingNode[] }> {
    const self = await this.#db.q
      .selectFrom('node')
      .select('id')
      .where('unique_id', '=', normaliseUuid(key))
      .execute()
    const selfId = self[0]?.id
    const ids = (await this.#referencingIds([key])).get(normaliseUuid(key)) ?? []
    const others = ids.filter((id) => id !== Number(selfId))
    return { total: others.length, items: await this.#describe(others.slice(skip, skip + take)) }
  }

  /**
   * Descendants of this node that something else refers to — what an editor
   * needs before deleting a branch.
   */
  async referencedDescendants(
    key: string,
    skip: number,
    take: number,
  ): Promise<{ total: number; items: string[] }> {
    const self = await this.#db.q
      .selectFrom('node')
      .select(['id', 'path'])
      .where('unique_id', '=', normaliseUuid(key))
      .execute()
    const node = self[0]
    if (!node) return { total: 0, items: [] }
    const descendants = await this.#db.q
      .selectFrom('node')
      .select(['id', 'unique_id'])
      .where('path', 'like', `${node.path},%`)
      .where('id', '<>', node.id)
      .execute()
    const referenced: string[] = []
    for (const descendant of descendants) {
      const ids = (await this.#referencingIds([String(descendant.unique_id)])).values().next()
        .value as number[] | undefined
      // A reference from inside the branch being deleted does not count.
      const outside = (ids ?? []).filter(
        (id) => !descendants.some((d) => Number(d.id) === id) && id !== Number(node.id),
      )
      if (outside.length > 0) referenced.push(String(descendant.unique_id))
    }
    return { total: referenced.length, items: referenced.slice(skip, skip + take) }
  }

  /** Of these keys, the ones something refers to. */
  async areReferenced(
    keys: readonly string[],
    skip: number,
    take: number,
  ): Promise<{ total: number; items: string[] }> {
    const wanted = keys.map(normaliseUuid)
    const found = await this.#referencingIds(wanted)
    const selfIds = new Map<string, number>()
    for (const key of wanted) {
      const rows = await this.#db.q
        .selectFrom('node')
        .select('id')
        .where('unique_id', '=', key)
        .execute()
      if (rows[0]) selfIds.set(key, Number(rows[0].id))
    }
    const referenced = wanted.filter((key) =>
      (found.get(key) ?? []).some((id) => id !== selfIds.get(key)),
    )
    return { total: referenced.length, items: referenced.slice(skip, skip + take) }
  }

  /**
   * What refers to anything of `objectType` in the recycle bin — what the
   * "empty the bin" dialog warns about — in name order, paged.
   */
  async referencingRecycleBin(
    objectType: string,
    skip: number,
    take: number,
  ): Promise<{ total: number; items: ReferencingNode[] }> {
    const ids = await new RelationRepository(this.#db).referencingRecycleBin(objectType)
    const described = await this.#describe(ids)
    return { total: described.length, items: described.slice(skip, skip + take) }
  }
}
