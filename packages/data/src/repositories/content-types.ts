/**
 * The content-type aggregate repository.
 *
 * A content type is saved as one document by the editor, so it is loaded and
 * written as one aggregate here: the type row, its groups, its properties, its
 * compositions, allowed children and templates.
 *
 * Groups and properties are upserted by key and never deleted-and-reinserted:
 * values reference property-type ids, so a delete would orphan every value ever
 * written. A property absent from the aggregate is **retired** — kept, hidden,
 * values intact — and one that reappears is **revived**.
 */
import {
  type ContentTypeAggregate,
  ContentVariation,
  normaliseUuid,
  ObjectTypes,
  type PropertyGroupModel,
  PropertyGroupType,
  type PropertyTypeModel,
  type SiteSearchLevel,
  SystemNodes,
  variationFlags,
  variesByCulture,
  variesBySegment,
} from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { pendingUntil } from '../pending.ts'
import type { NodeSchemaState } from '../schema-state.ts'
import { queueContentTypesForSearch, queueEverythingForSearch } from '../search.ts'
import { NodeRepository } from './nodes.ts'

const GROUP_TYPE_NAMES = ['Group', 'Tab'] as const

/**
 * The live properties of a type, by alias, variation, storage and search
 * settings, and whether the type is in site search: what its items are indexed by.
 */
async function propertySignature(db: Db, contentTypeNodeId: number): Promise<string> {
  const rows = await db.q
    .selectFrom('property_type as p')
    .select(['p.id', 'p.alias', 'p.variations', 'p.data_type_id', 'p.searchable', 'p.site_search'])
    .where('p.content_type_id', '=', contentTypeNodeId)
    .where('p.retired_at', 'is', null)
    .orderBy('p.id')
    .execute()
  const [type] = await db.q
    .selectFrom('content_type')
    .select(['site_search', 'site_settings'])
    .where('node_id', '=', contentTypeNodeId)
    .execute()
  return [
    // A site's settings page is never searched (story 058).
    `site:${type ? fromDbBool(type.site_search) && !fromDbBool(type.site_settings) : true}`,
    ...rows.map(
      (row) =>
        `${row.id}:${row.alias}:${row.variations}:${row.data_type_id}:${fromDbBool(row.searchable)}:${row.site_search}`,
    ),
  ].join('|')
}

/** How a property's site-search setting is stored: its level, or `off`. */
function siteSearchColumn(value: SiteSearchLevel | false | undefined): string {
  return value === false ? 'off' : (value ?? 'normal')
}

function siteSearchFromColumn(value: unknown): SiteSearchLevel | false {
  return value === 'off' ? false : value === 'high' || value === 'low' ? value : 'normal'
}

export interface SaveContentTypeOptions {
  userId?: number
  /** The schema state that introduced anything created by this save. */
  sinceStateId?: number
}

/** A property removed from its type and kept, with its values, for revival. */
export interface RetiredProperty {
  key: string
  alias: string
  retiredAt: Date
}

/** Content types and media types share one table, told apart by node object type. */
export type ContentTypeKind = 'document' | 'media' | 'member'

export const CONTENT_TYPE_OBJECT_TYPES: Record<
  ContentTypeKind,
  { item: string; container: string }
> = {
  document: { item: ObjectTypes.DocumentType, container: ObjectTypes.DocumentTypeContainer },
  media: { item: ObjectTypes.MediaType, container: ObjectTypes.MediaTypeContainer },
  member: { item: ObjectTypes.MemberType, container: ObjectTypes.MemberTypeContainer },
}

export interface ContentTypeRepositoryOptions {
  /** The state this node runs at; elements newer than it are marked pending. */
  nodeState?: NodeSchemaState
  /** Which kind of type this repository reads and writes. Default document. */
  kind?: ContentTypeKind
}

export class ContentTypeRepository {
  #db: Db
  #nodes: NodeRepository
  #nodeState: NodeSchemaState | undefined
  #objectType: string
  #kind: ContentTypeKind

  constructor(db: Db, options: ContentTypeRepositoryOptions = {}) {
    this.#db = db
    this.#nodes = new NodeRepository(db)
    this.#nodeState = options.nodeState
    this.#kind = options.kind ?? 'document'
    this.#objectType = CONTENT_TYPE_OBJECT_TYPES[this.#kind].item
  }

  /** The node object type this repository's types carry. */
  get objectType(): string {
    return this.#objectType
  }

  #pending(row: Record<string, unknown>): NodeSchemaState | null {
    if (!this.#nodeState) return null
    return pendingUntil(
      {
        since: row.since_v
          ? { version: String(row.since_v), revision: String(row.since_r ?? '0') }
          : null,
        sinceVersion: (row.since_version as string | null) ?? null,
      },
      this.#nodeState,
    )
  }

  get nodes(): NodeRepository {
    return this.#nodes
  }

  async byKey(key: string): Promise<ContentTypeAggregate | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node || node.objectType !== this.#objectType) return undefined
    return this.#load(node.id, node.key, node.text ?? '', node.parentId)
  }

  /** Retired types are hidden unless asked for: schema sync revives them by alias. */
  async byAlias(
    alias: string,
    options: { includeRetired?: boolean } = {},
  ): Promise<ContentTypeAggregate | undefined> {
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select('n.unique_id')
      .where('ct.alias', '=', alias)
      .where('n.node_object_type', '=', this.#objectType)
      .$if(!options.includeRetired, (q) => q.where('ct.retired_at', 'is', null))
      .execute()
    return rows[0] ? this.byKey(String(rows[0].unique_id)) : undefined
  }

  async aliasExists(alias: string, exceptKey?: string): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('ct.alias', '=', alias)
      .$if(Boolean(exceptKey), (q) =>
        q.where('n.unique_id', '<>', normaliseUuid(exceptKey as string)),
      )
      .execute()
    return Number(rows[0]?.n ?? 0) > 0
  }

  /** Content types permitted at the root of the content tree. */
  async allowedAtRoot(
    skip: number,
    take: number,
  ): Promise<{ total: number; items: ContentTypeAggregate[] }> {
    const matching = this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .where('ct.allow_at_root', '=', this.#db.dialect.boolValue(true))
      .where('ct.retired_at', 'is', null)
      .where('n.node_object_type', '=', this.#objectType)
    const totals = await matching.select((eb) => eb.fn.countAll().as('n')).execute()
    const rows = await matching
      .select('n.unique_id')
      .orderBy('n.text')
      .limit(take)
      .offset(skip)
      .execute()
    const items: ContentTypeAggregate[] = []
    let hidden = 0
    for (const row of rows) {
      const aggregate = await this.byKey(String(row.unique_id))
      if (!aggregate) continue
      // A pending type is not offered for creation until it is live here.
      if (aggregate.pending) hidden += 1
      else items.push(aggregate)
    }
    return { total: Number(totals[0]?.n ?? 0) - hidden, items }
  }

  /**
   * Content types offered in the library, which Umbraco reads as element types
   * carrying the flag — a non-element type is never offered, whatever it holds.
   */
  async allowedInLibrary(
    skip: number,
    take: number,
  ): Promise<{ total: number; items: ContentTypeAggregate[] }> {
    const matching = this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .where('ct.is_element', '=', this.#db.dialect.boolValue(true))
      .where('ct.allow_in_library', '=', this.#db.dialect.boolValue(true))
      .where('ct.retired_at', 'is', null)
      .where('n.node_object_type', '=', this.#objectType)
    const totals = await matching.select((eb) => eb.fn.countAll().as('n')).execute()
    const rows = await matching
      .select('n.unique_id')
      .orderBy('n.text')
      .limit(take)
      .offset(skip)
      .execute()
    const items: ContentTypeAggregate[] = []
    let hidden = 0
    for (const row of rows) {
      const aggregate = await this.byKey(String(row.unique_id))
      if (!aggregate) continue
      if (aggregate.pending) hidden += 1
      else items.push(aggregate)
    }
    return { total: Number(totals[0]?.n ?? 0) - hidden, items }
  }

  /**
   * Why an item of type `typeKey` may not sit under `parentKey` (null: the top
   * level), as its parent's type allows children; nothing when it may.
   */
  async placementRefusal(typeKey: string, parentKey: string | null): Promise<string | undefined> {
    const types = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('content_type as ct', 'ct.node_id', 'n.id')
      .select(['n.id', 'n.text', 'ct.allow_at_root'])
      .where('n.unique_id', '=', normaliseUuid(typeKey))
      .execute()
    const type = types[0]
    if (!type) return undefined
    const typeName = String(type.text ?? typeKey)
    if (parentKey === null)
      return fromDbBool(type.allow_at_root)
        ? undefined
        : `"${typeName}" isn't allowed at the top level.`
    const parents = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .select(['n.text', 'c.content_type_id'])
      .where('n.unique_id', '=', normaliseUuid(parentKey))
      .execute()
    const parent = parents[0]
    if (!parent) return undefined
    const allowed = await this.#db.q
      .selectFrom('content_type_allowed_child')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('content_type_id', '=', parent.content_type_id)
      .where('allowed_content_type_id', '=', type.id)
      .execute()
    return Number(allowed[0]?.n ?? 0) > 0
      ? undefined
      : `"${typeName}" isn't allowed under "${parent.text ?? parentKey}".`
  }

  async allowedChildren(
    key: string,
    skip: number,
    take: number,
  ): Promise<{ total: number; items: ContentTypeAggregate[] }> {
    const node = await this.#nodes.byKey(key)
    if (!node) return { total: 0, items: [] }
    const rows = await this.#db.q
      .selectFrom('content_type_allowed_child as ac')
      .innerJoin('node as child', 'child.id', 'ac.allowed_content_type_id')
      .select('child.unique_id')
      .where('ac.content_type_id', '=', node.id)
      .orderBy('ac.sort_order')
      .execute()
    const items: ContentTypeAggregate[] = []
    for (const row of rows.slice(skip, skip + take)) {
      const aggregate = await this.byKey(String(row.unique_id))
      if (aggregate && !aggregate.pending) items.push(aggregate)
    }
    return { total: rows.length, items }
  }

  /** Creates or updates a content type. See the class comment for retirement. */
  async save(
    aggregate: ContentTypeAggregate,
    options: SaveContentTypeOptions = {},
  ): Promise<ContentTypeAggregate> {
    return this.#db.transaction(async (tx) => {
      const repo = new ContentTypeRepository(tx, { nodeState: this.#nodeState, kind: this.#kind })
      const bool = (value: boolean) => tx.dialect.boolValue(value)
      const now = DbDate.toDb(new Date())
      const existing = await repo.nodes.byKey(aggregate.key)
      const parentId = aggregate.parentKey
        ? ((await repo.nodes.byKey(aggregate.parentKey))?.id ?? SystemNodes.Root)
        : SystemNodes.Root

      // What the search index holds depends on which properties are live and what
      // they are called, so a change to either has the type's items re-indexed.
      const propertiesBefore = existing ? await propertySignature(tx, existing.id) : ''
      let nodeId: number
      if (existing) {
        nodeId = existing.id
        await repo.nodes.rename(nodeId, aggregate.name)
      } else {
        nodeId = (
          await repo.nodes.create({
            key: aggregate.key,
            parentId,
            objectType: this.#objectType,
            text: aggregate.name,
            userId: options.userId,
          })
        ).id
      }

      const variations = variationFlags(aggregate.variesByCulture, aggregate.variesBySegment)
      const typeValues = {
        alias: aggregate.alias,
        icon: aggregate.icon ?? null,
        description: aggregate.description ?? null,
        list_view: aggregate.collectionKey ?? null,
        is_element: bool(aggregate.isElement),
        allow_in_library: bool(aggregate.allowedInLibrary),
        allow_at_root: bool(aggregate.allowedAsRoot),
        variations,
        prevent_cleanup: bool(aggregate.cleanup.preventCleanup),
        keep_all_versions_newer_than_days: aggregate.cleanup.keepAllVersionsNewerThanDays ?? null,
        keep_latest_version_per_day_for_days:
          aggregate.cleanup.keepLatestVersionPerDayForDays ?? null,
        since_version: aggregate.sinceVersion ?? null,
      }
      if (existing) {
        await tx.q
          .updateTable('content_type')
          .set({ ...typeValues, retired_at: null })
          .where('node_id', '=', nodeId)
          .execute()
      } else {
        await tx.q
          .insertInto('content_type')
          .values({
            node_id: nodeId,
            ...typeValues,
            thumbnail: 'folder.png',
            since_state_id: options.sinceStateId ?? null,
          })
          .execute()
      }
      // As for a property's flags: only a schema sync says.
      if (aggregate.siteSearch !== undefined)
        await tx.q
          .updateTable('content_type')
          .set({ site_search: bool(aggregate.siteSearch) })
          .where('node_id', '=', nodeId)
          .execute()
      if (aggregate.siteSettings !== undefined)
        await tx.q
          .updateTable('content_type')
          .set({ site_settings: bool(aggregate.siteSettings) })
          .where('node_id', '=', nodeId)
          .execute()

      // ---- groups: upsert by key
      const groupIdByKey = new Map<string, number>()
      for (const container of aggregate.containers) {
        const type = container.type === 'Tab' ? PropertyGroupType.Tab : PropertyGroupType.Group
        const groupId = () =>
          tx.q
            .selectFrom('property_type_group')
            .select('id')
            .where('unique_id', '=', container.key)
            .execute()
        const found = await groupId()
        if (found[0]) {
          await tx.q
            .updateTable('property_type_group')
            .set({
              type,
              text: container.name ?? null,
              alias: container.alias ?? null,
              sort_order: container.sortOrder,
            })
            .where('id', '=', Number(found[0].id))
            .execute()
          groupIdByKey.set(container.key, Number(found[0].id))
        } else {
          await tx.q
            .insertInto('property_type_group')
            .values({
              unique_id: container.key,
              content_type_node_id: nodeId,
              type,
              text: container.name ?? null,
              alias: container.alias ?? null,
              sort_order: container.sortOrder,
            })
            .execute()
          const created = await groupId()
          groupIdByKey.set(container.key, Number(created[0]?.id))
        }
      }
      for (const container of aggregate.containers) {
        const parent = container.parentKey ? groupIdByKey.get(container.parentKey) : undefined
        await tx.q
          .updateTable('property_type_group')
          .set({ parent_id: parent ?? null })
          .where('unique_id', '=', container.key)
          .execute()
      }

      // ---- properties: upsert by key; retire the absent; revive the returning
      const kept = new Set<string>()
      for (const property of aggregate.properties) {
        const dataTypeNode = await repo.nodes.byKey(property.dataTypeKey)
        if (!dataTypeNode)
          throw new Error(
            `Unknown data type '${property.dataTypeKey}' on property '${property.alias}'.`,
          )
        // A key the type has never had, but an alias it has (live or retired), is
        // that property coming back: reuse the row, so its values return with it.
        let key = normaliseUuid(property.key)
        const byKey = await tx.q
          .selectFrom('property_type')
          .select('id')
          .where('unique_id', '=', key)
          .execute()
        if (byKey.length === 0) {
          const sameAlias = await tx.q
            .selectFrom('property_type')
            .select('unique_id')
            .where('content_type_id', '=', nodeId)
            .where('alias', '=', property.alias)
            .execute()
          if (sameAlias[0]) key = normaliseUuid(String(sameAlias[0].unique_id))
        }
        kept.add(key)
        const groupId = property.containerKey
          ? (groupIdByKey.get(property.containerKey) ?? null)
          : null
        const columns = {
          data_type_id: dataTypeNode.id,
          property_type_group_id: groupId,
          alias: property.alias,
          name: property.name,
          description: property.description ?? null,
          sort_order: property.sortOrder,
          mandatory: bool(property.mandatory),
          mandatory_message: property.mandatoryMessage ?? null,
          validation_reg_exp: property.regEx ?? null,
          validation_reg_exp_message: property.regExMessage ?? null,
          label_on_top: bool(property.labelOnTop),
          variations: variationFlags(property.variesByCulture, property.variesBySegment),
          since_version: property.sinceVersion ?? null,
        }
        const found = await tx.q
          .selectFrom('property_type')
          .select('id')
          .where('unique_id', '=', key)
          .execute()
        if (found[0]) {
          const id = Number(found[0].id)
          await tx.q
            .updateTable('property_type')
            .set({ ...columns, retired_at: null })
            .where('id', '=', id)
            .execute()
          // Only a schema sync says; a backoffice save leaves it as it was.
          if (property.searchable !== undefined)
            await tx.q
              .updateTable('property_type')
              .set({ searchable: bool(property.searchable) })
              .where('id', '=', id)
              .execute()
          if (property.siteSearch !== undefined)
            await tx.q
              .updateTable('property_type')
              .set({ site_search: siteSearchColumn(property.siteSearch) })
              .where('id', '=', id)
              .execute()
        } else {
          await tx.q
            .insertInto('property_type')
            .values({
              unique_id: key,
              content_type_id: nodeId,
              ...columns,
              since_state_id: options.sinceStateId ?? null,
              searchable: bool(property.searchable !== false),
              site_search: siteSearchColumn(property.siteSearch),
            })
            .execute()
        }
      }
      if (this.#kind === 'member') {
        const bool = (v: boolean) => tx.dialect.boolValue(v)
        for (const property of aggregate.properties) {
          // By alias: the row may have been reused under its old key above.
          const row = await tx.q
            .selectFrom('property_type')
            .select('id')
            .where('content_type_id', '=', nodeId)
            .where('alias', '=', property.alias)
            .execute()
          const id = Number(row[0]?.id)
          if (!id) continue
          await tx.q.deleteFrom('member_property_type').where('property_type_id', '=', id).execute()
          await tx.q
            .insertInto('member_property_type')
            .values({
              property_type_id: id,
              member_can_edit: bool(property.memberCanEdit === true),
              member_can_view: bool(property.memberCanView === true),
              is_sensitive: bool(property.isSensitive === true),
            })
            .execute()
        }
      }
      const present = await tx.q
        .selectFrom('property_type')
        .select(['id', 'unique_id', 'retired_at'])
        .where('content_type_id', '=', nodeId)
        .execute()
      for (const row of present) {
        if (kept.has(normaliseUuid(String(row.unique_id)))) continue
        if (row.retired_at !== null && row.retired_at !== undefined) continue
        // Retired: hidden and detached from its group; every value stays.
        await tx.q
          .updateTable('property_type')
          .set({ retired_at: now, property_type_group_id: null })
          .where('id', '=', Number(row.id))
          .execute()
      }
      const containerKeys = new Set(aggregate.containers.map((c) => c.key))
      for (const group of await tx.q
        .selectFrom('property_type_group')
        .select(['id', 'unique_id'])
        .where('content_type_node_id', '=', nodeId)
        .execute()) {
        if (containerKeys.has(String(group.unique_id))) continue
        const inUse = await tx.q
          .selectFrom('property_type')
          .select((eb) => eb.fn.countAll().as('n'))
          .where('property_type_group_id', '=', Number(group.id))
          .execute()
        if (Number(inUse[0]?.n ?? 0) === 0)
          await tx.q.deleteFrom('property_type_group').where('id', '=', Number(group.id)).execute()
      }

      // ---- relations: replaced wholesale; nothing references these rows
      await tx.q
        .deleteFrom('content_type_composition')
        .where('child_content_type_id', '=', nodeId)
        .execute()
      for (const composition of aggregate.compositions) {
        const parent = await repo.nodes.byKey(composition.contentTypeKey)
        if (parent)
          await tx.q
            .insertInto('content_type_composition')
            .values({ parent_content_type_id: parent.id, child_content_type_id: nodeId })
            .execute()
      }
      await tx.q
        .deleteFrom('content_type_allowed_child')
        .where('content_type_id', '=', nodeId)
        .execute()
      for (const allowed of aggregate.allowedContentTypes) {
        const child = await repo.nodes.byKey(allowed.contentTypeKey)
        if (child)
          await tx.q
            .insertInto('content_type_allowed_child')
            .values({
              content_type_id: nodeId,
              allowed_content_type_id: child.id,
              sort_order: allowed.sortOrder,
            })
            .execute()
      }
      await tx.q
        .deleteFrom('content_type_template')
        .where('content_type_node_id', '=', nodeId)
        .execute()
      for (const componentKey of aggregate.allowedComponentKeys) {
        const template = await repo.nodes.byKey(componentKey)
        if (template)
          await tx.q
            .insertInto('content_type_template')
            .values({
              content_type_node_id: nodeId,
              template_node_id: template.id,
              is_default: bool(componentKey === aggregate.defaultComponentKey),
            })
            .execute()
      }

      if (existing && propertiesBefore !== (await propertySignature(tx, nodeId))) {
        if (aggregate.isElement) await queueEverythingForSearch(tx)
        else await queueContentTypesForSearch(tx, [nodeId])
      }

      const saved = await repo.byKey(aggregate.key)
      if (!saved) throw new Error('Content type could not be read back after saving.')
      return saved
    })
  }

  async retiredProperties(typeKey: string): Promise<RetiredProperty[]> {
    const node = await this.#nodes.byKey(typeKey)
    if (!node) return []
    const rows = await this.#db.q
      .selectFrom('property_type')
      .select(['unique_id', 'alias', 'retired_at'])
      .where('content_type_id', '=', node.id)
      .where('retired_at', 'is not', null)
      .execute()
    return rows.map((row) => ({
      key: normaliseUuid(String(row.unique_id)),
      alias: String(row.alias),
      retiredAt: DbDate.fromDb(row.retired_at) ?? new Date(0),
    }))
  }

  /** Whether any document of this type exists, trashed or not — the deletion-safety check. */
  /**
   * Deletes property types retired before `olderThan`, with every value they
   * ever held. The contract step; nothing else in the system deletes values.
   */
  async purgeRetired(olderThan: Date): Promise<Array<{ type: string; alias: string }>> {
    const rows = await this.#db.q
      .selectFrom('property_type as p')
      .innerJoin('content_type as ct', 'ct.node_id', 'p.content_type_id')
      .select(['p.id', 'p.alias', 'ct.alias as type_alias'])
      .where('p.retired_at', 'is not', null)
      .where('p.retired_at', '<', DbDate.toDb(olderThan))
      .execute()
    const purged: Array<{ type: string; alias: string }> = []
    await this.#db.transaction(async (tx) => {
      for (const row of rows) {
        const id = Number(row.id)
        await tx.q.deleteFrom('property_value').where('property_type_id', '=', id).execute()
        await tx.q.deleteFrom('member_property_type').where('property_type_id', '=', id).execute()
        await tx.q.deleteFrom('property_type').where('id', '=', id).execute()
        purged.push({ type: String(row.type_alias), alias: String(row.alias) })
      }
    })
    return purged
  }

  /** Several aggregates at once, for the batch endpoint and pickers. */
  async byKeys(keys: readonly string[]): Promise<ContentTypeAggregate[]> {
    const out: ContentTypeAggregate[] = []
    for (const key of keys) {
      const found = await this.byKey(key)
      if (found) out.push(found)
    }
    return out
  }

  /** Every live type, cheap enough while types number in the dozens. */
  async all(): Promise<ContentTypeAggregate[]> {
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select('n.unique_id')
      .where('ct.retired_at', 'is', null)
      .where('n.node_object_type', '=', this.#objectType)
      .orderBy('n.text')
      .execute()
    return this.byKeys(rows.map((r) => String(r.unique_id)))
  }

  /** Every live type's alias by its key, without loading the types themselves. */
  async aliasesByKey(): Promise<Map<string, string>> {
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select(['n.unique_id', 'ct.alias'])
      .where('ct.retired_at', 'is', null)
      .where('n.node_object_type', '=', this.#objectType)
      .execute()
    return new Map(rows.map((r) => [normaliseUuid(String(r.unique_id)), String(r.alias)]))
  }

  /** The aliases of the types that are a site's settings (story 058). */
  async siteSettingsAliases(): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select('ct.alias')
      .where('ct.retired_at', 'is', null)
      .where('ct.site_settings', '=', this.#db.dialect.boolValue(true) as boolean)
      .where('n.node_object_type', '=', this.#objectType)
      .execute()
    return rows.map((row) => String(row.alias))
  }

  async move(key: string, parentKey: string | null): Promise<boolean> {
    const node = await this.#nodes.byKey(key)
    if (!node || node.objectType !== this.#objectType) return false
    const parentId = parentKey ? (await this.#nodes.byKey(parentKey))?.id : SystemNodes.Root
    if (parentId === undefined) return false
    await this.#nodes.move(node.id, parentId)
    return true
  }

  /** A copy with fresh keys everywhere, named "(copy)" with a unique alias. */
  async copy(key: string, parentKey: string | null): Promise<ContentTypeAggregate | undefined> {
    const source = await this.byKey(key)
    if (!source) return undefined
    let alias = `${source.alias}Copy`
    for (let i = 2; await this.aliasExists(alias); i++) alias = `${source.alias}Copy${i}`
    const containerKeys = new Map(source.containers.map((c) => [c.key, crypto.randomUUID()]))
    const copy: ContentTypeAggregate = {
      ...source,
      key: crypto.randomUUID(),
      alias,
      name: `${source.name} (copy)`,
      parentKey,
      containers: source.containers.map((c) => ({
        ...c,
        key: containerKeys.get(c.key) as string,
        parentKey: c.parentKey ? (containerKeys.get(c.parentKey) ?? null) : null,
      })),
      properties: source.properties.map((p) => ({
        ...p,
        key: crypto.randomUUID(),
        containerKey: p.containerKey ? (containerKeys.get(p.containerKey) ?? null) : null,
      })),
    }
    return this.save(copy)
  }

  async search(
    query: string,
    options: { isElement?: boolean; skip: number; take: number },
  ): Promise<{ total: number; items: ContentTypeAggregate[] }> {
    const page = await this.#nodes.search(this.#objectType, query, {
      skip: 0,
      take: 10_000,
    })
    const aggregates = (await this.byKeys(page.items.map((n) => n.key))).filter(
      (a) => options.isElement === undefined || a.isElement === options.isElement,
    )
    return {
      total: aggregates.length,
      items: aggregates.slice(options.skip, options.skip + options.take),
    }
  }

  /** Types that compose this one, directly. */
  async compositionReferences(key: string): Promise<ContentTypeAggregate[]> {
    const node = await this.#nodes.byKey(key)
    if (!node) return []
    const rows = await this.#db.q
      .selectFrom('content_type_composition as c')
      .innerJoin('node as child', 'child.id', 'c.child_content_type_id')
      .select('child.unique_id')
      .where('c.parent_content_type_id', '=', node.id)
      .execute()
    return this.byKeys(rows.map((r) => String(r.unique_id)))
  }

  /** Types that allow this one as a child. */
  async allowedParents(key: string): Promise<string[]> {
    const node = await this.#nodes.byKey(key)
    if (!node) return []
    const rows = await this.#db.q
      .selectFrom('content_type_allowed_child as ac')
      .innerJoin('node as parent', 'parent.id', 'ac.content_type_id')
      .select('parent.unique_id')
      .where('ac.allowed_content_type_id', '=', node.id)
      .execute()
    return rows.map((r) => normaliseUuid(String(r.unique_id)))
  }

  /**
   * What a type may compose, and whether each candidate clashes. The rules are
   * Umbraco's: never itself, never a type that already uses it (no cycles), never
   * a type that has compositions of its own, element types compose only element
   * types; a candidate is incompatible when it brings a property alias the type
   * already has.
   */
  async availableCompositions(request: {
    key: string | null
    isElement: boolean
    currentPropertyAliases: readonly string[]
    currentCompositeKeys: readonly string[]
  }): Promise<Array<{ type: ContentTypeAggregate; isCompatible: boolean }>> {
    const all = await this.all()
    const self = request.key ? all.find((t) => t.key === request.key) : undefined
    const usesSelf = new Set<string>()
    if (self) {
      const walk = (typeKey: string) => {
        for (const t of all) {
          if (t.compositions.some((c) => c.contentTypeKey === typeKey) && !usesSelf.has(t.key)) {
            usesSelf.add(t.key)
            walk(t.key)
          }
        }
      }
      walk(self.key)
    }
    const taken = new Set(request.currentPropertyAliases)
    const selected = new Set(request.currentCompositeKeys)
    const out: Array<{ type: ContentTypeAggregate; isCompatible: boolean }> = []
    for (const candidate of all) {
      if (self && candidate.key === self.key) continue
      if (usesSelf.has(candidate.key)) continue
      if (candidate.compositions.length > 0) continue
      if (request.isElement && !candidate.isElement) continue
      const clash =
        !selected.has(candidate.key) && candidate.properties.some((p) => taken.has(p.alias))
      out.push({ type: candidate, isCompatible: !clash })
    }
    return out
  }

  async contentCount(typeKey: string): Promise<number> {
    const node = await this.#nodes.byKey(typeKey)
    if (!node) return 0
    const rows = await this.#db.q
      .selectFrom('content')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('content_type_id', '=', node.id)
      .execute()
    return Number(rows[0]?.n ?? 0)
  }

  async delete(key: string): Promise<boolean> {
    const node = await this.#nodes.byKey(key)
    if (!node || node.objectType !== this.#objectType) return false
    return this.#db.transaction(async (tx) => {
      const ownProperties = () =>
        tx.q.selectFrom('property_type').select('id').where('content_type_id', '=', node.id)
      await tx.q
        .deleteFrom('property_value')
        .where('property_type_id', 'in', ownProperties())
        .execute()
      await tx.q
        .deleteFrom('member_property_type')
        .where('property_type_id', 'in', ownProperties())
        .execute()
      await tx.q.deleteFrom('property_type').where('content_type_id', '=', node.id).execute()
      await tx.q
        .deleteFrom('property_type_group')
        .where('content_type_node_id', '=', node.id)
        .execute()
      await tx.q
        .deleteFrom('content_type_composition')
        .where((eb) =>
          eb.or([
            eb('child_content_type_id', '=', node.id),
            eb('parent_content_type_id', '=', node.id),
          ]),
        )
        .execute()
      await tx.q
        .deleteFrom('content_type_allowed_child')
        .where((eb) =>
          eb.or([eb('content_type_id', '=', node.id), eb('allowed_content_type_id', '=', node.id)]),
        )
        .execute()
      await tx.q
        .deleteFrom('content_type_template')
        .where('content_type_node_id', '=', node.id)
        .execute()
      await tx.q.deleteFrom('content_type').where('node_id', '=', node.id).execute()
      await tx.q.deleteFrom('node').where('id', '=', node.id).execute()
      return true
    })
  }

  /** The full property set, unioning the type's own with every composition ancestor's. */
  async resolveProperties(key: string): Promise<PropertyTypeModel[]> {
    const visited = new Set<string>()
    const collected: PropertyTypeModel[] = []
    const walk = async (currentKey: string): Promise<void> => {
      if (visited.has(currentKey)) return
      visited.add(currentKey)
      const aggregate = await this.byKey(currentKey)
      if (!aggregate) return
      for (const composition of aggregate.compositions) await walk(composition.contentTypeKey)
      for (const property of aggregate.properties)
        if (!collected.some((p) => p.alias === property.alias)) collected.push(property)
    }
    await walk(key)
    return collected
  }

  async #load(
    nodeId: number,
    key: string,
    name: string,
    parentId: number,
  ): Promise<ContentTypeAggregate | undefined> {
    const typeRows = await this.#db.q
      .selectFrom('content_type as ct')
      .leftJoin('schema_state as ss', 'ss.id', 'ct.since_state_id')
      .select([
        'ct.alias',
        'ct.icon',
        'ct.description',
        'ct.list_view',
        'ct.is_element',
        'ct.allow_in_library',
        'ct.allow_at_root',
        'ct.variations',
        'ct.prevent_cleanup',
        'ct.keep_all_versions_newer_than_days',
        'ct.keep_latest_version_per_day_for_days',
        'ct.since_version',
        'ct.site_search',
        'ct.site_settings',
        'ss.version as since_v',
        'ss.revision as since_r',
      ])
      .where('ct.node_id', '=', nodeId)
      .execute()
    const type = typeRows[0]
    if (!type) return undefined

    const groupRows = await this.#db.q
      .selectFrom('property_type_group as g')
      .leftJoin('property_type_group as parent', 'parent.id', 'g.parent_id')
      .select([
        'g.unique_id',
        'g.text',
        'g.alias',
        'g.type',
        'g.sort_order',
        'parent.unique_id as parent_key',
      ])
      .where('g.content_type_node_id', '=', nodeId)
      .orderBy('g.sort_order')
      .orderBy('g.id')
      .execute()
    const containers: PropertyGroupModel[] = groupRows.map((row) => ({
      key: normaliseUuid(String(row.unique_id)),
      name: (row.text as string | null) ?? null,
      alias: (row.alias as string | null) ?? null,
      type: GROUP_TYPE_NAMES[Number(row.type)] ?? 'Group',
      sortOrder: Number(row.sort_order),
      parentKey: row.parent_key ? normaliseUuid(String(row.parent_key)) : null,
    }))

    // Retired properties are hidden here; `retiredProperties()` lists them.
    const propertyRows = await this.#db.q
      .selectFrom('property_type as p')
      .innerJoin('node as dtn', 'dtn.id', 'p.data_type_id')
      .leftJoin('property_type_group as g', 'g.id', 'p.property_type_group_id')
      .leftJoin('schema_state as ss', 'ss.id', 'p.since_state_id')
      .leftJoin('member_property_type as m', 'm.property_type_id', 'p.id')
      .select([
        'p.unique_id',
        'p.alias',
        'p.name',
        'p.description',
        'p.sort_order',
        'p.mandatory',
        'p.mandatory_message',
        'p.validation_reg_exp',
        'p.validation_reg_exp_message',
        'p.label_on_top',
        'p.variations',
        'dtn.unique_id as data_type_key',
        'g.unique_id as container_key',
        'p.since_version',
        'ss.version as since_v',
        'ss.revision as since_r',
        'm.member_can_edit',
        'm.member_can_view',
        'm.is_sensitive',
        'p.searchable',
        'p.site_search',
      ])
      .where('p.content_type_id', '=', nodeId)
      .where('p.retired_at', 'is', null)
      .orderBy('p.sort_order')
      .orderBy('p.id')
      .execute()
    const properties: PropertyTypeModel[] = propertyRows.map((row) => ({
      key: normaliseUuid(String(row.unique_id)),
      alias: String(row.alias),
      name: String(row.name),
      description: (row.description as string | null) ?? null,
      dataTypeKey: normaliseUuid(String(row.data_type_key)),
      containerKey: row.container_key ? normaliseUuid(String(row.container_key)) : null,
      sortOrder: Number(row.sort_order),
      variesByCulture: variesByCulture(Number(row.variations)),
      variesBySegment: variesBySegment(Number(row.variations)),
      mandatory: fromDbBool(row.mandatory),
      mandatoryMessage: (row.mandatory_message as string | null) ?? null,
      regEx: (row.validation_reg_exp as string | null) ?? null,
      regExMessage: (row.validation_reg_exp_message as string | null) ?? null,
      labelOnTop: fromDbBool(row.label_on_top),
      sinceVersion: (row.since_version as string | null) ?? null,
      pending: this.#pending(row),
      ...(fromDbBool(row.searchable) ? {} : { searchable: false }),
      siteSearch: siteSearchFromColumn(row.site_search),
      ...(this.#kind === 'member'
        ? {
            memberCanEdit: fromDbBool(row.member_can_edit),
            memberCanView: fromDbBool(row.member_can_view),
            isSensitive: fromDbBool(row.is_sensitive),
          }
        : {}),
    }))

    const compositionRows = await this.#db.q
      .selectFrom('content_type_composition as c')
      .innerJoin('node as parent', 'parent.id', 'c.parent_content_type_id')
      .select('parent.unique_id')
      .where('c.child_content_type_id', '=', nodeId)
      .execute()
    const allowedRows = await this.#db.q
      .selectFrom('content_type_allowed_child as ac')
      .innerJoin('node as child', 'child.id', 'ac.allowed_content_type_id')
      .select(['child.unique_id', 'ac.sort_order'])
      .where('ac.content_type_id', '=', nodeId)
      .orderBy('ac.sort_order')
      .execute()
    const templateRows = await this.#db.q
      .selectFrom('content_type_template as ctt')
      .innerJoin('node as tn', 'tn.id', 'ctt.template_node_id')
      .select(['tn.unique_id', 'ctt.is_default'])
      .where('ctt.content_type_node_id', '=', nodeId)
      .execute()
    const parentNode = parentId > 0 ? await this.#nodes.byId(parentId) : undefined
    const flags = Number(type.variations ?? ContentVariation.Nothing)
    const num = (value: unknown) => (value === null || value === undefined ? null : Number(value))

    return {
      key,
      name,
      alias: String(type.alias),
      description: (type.description as string | null) ?? null,
      icon: (type.icon as string | null) ?? 'icon-document',
      allowedAsRoot: fromDbBool(type.allow_at_root),
      variesByCulture: variesByCulture(flags),
      variesBySegment: variesBySegment(flags),
      isElement: fromDbBool(type.is_element),
      allowedInLibrary: fromDbBool(type.allow_in_library),
      siteSearch: fromDbBool(type.site_search),
      siteSettings: fromDbBool(type.site_settings),
      collectionKey: type.list_view ? normaliseUuid(String(type.list_view)) : null,
      cleanup: {
        preventCleanup: fromDbBool(type.prevent_cleanup),
        keepAllVersionsNewerThanDays: num(type.keep_all_versions_newer_than_days),
        keepLatestVersionPerDayForDays: num(type.keep_latest_version_per_day_for_days),
      },
      properties,
      containers,
      sinceVersion: (type.since_version as string | null) ?? null,
      pending: this.#pending(type),
      compositions: compositionRows.map((row) => ({
        contentTypeKey: normaliseUuid(String(row.unique_id)),
        compositionType: 'Composition' as const,
      })),
      allowedContentTypes: allowedRows.map((row) => ({
        contentTypeKey: normaliseUuid(String(row.unique_id)),
        sortOrder: Number(row.sort_order),
      })),
      allowedComponentKeys: templateRows.map((row) => normaliseUuid(String(row.unique_id))),
      defaultComponentKey:
        templateRows
          .filter((row) => fromDbBool(row.is_default))
          .map((row) => normaliseUuid(String(row.unique_id)))[0] ?? null,
      parentKey: parentNode?.key ?? null,
    }
  }
}
