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
  ENVIRONMENT_VARIATION,
  isFileFolderType,
  isFileTreeType,
  isFileType,
  normaliseUuid,
  ObjectTypes,
  type PropertyGroupModel,
  PropertyGroupType,
  type PropertyTypeModel,
  type SeoMapping,
  type SiteSearchLevel,
  SystemNodes,
  variationFlags,
  variesByCulture,
  variesByEnvironment,
  variesBySegment,
} from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { pendingUntil } from '../pending.ts'
import type { NodeSchemaState } from '../schema-state.ts'
import { queueContentTypesForSearch, queueEverythingForSearch } from '../search.ts'
import { type WorkspaceScope, workspaceRowKey } from '../workspace-keys.ts'
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
/** A type's search and sharing values as stored: JSON, or null when it sets none. */
function seoColumn(mapping: SeoMapping | null): string | null {
  const set = Object.entries(mapping ?? {}).filter(
    ([, value]) => typeof value === 'string' && value !== '',
  )
  return set.length > 0 ? JSON.stringify(Object.fromEntries(set)) : null
}

function seoFromColumn(value: unknown): SeoMapping | null {
  if (typeof value !== 'string' || value === '') return null
  try {
    return JSON.parse(value) as SeoMapping
  } catch {
    return null
  }
}

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

/** The object type a workspace's copy of each kind carries (story 376). */
export const WORKSPACE_TYPE_OBJECT_TYPES: Record<ContentTypeKind, string> = {
  document: ObjectTypes.WorkspaceDocumentType,
  media: ObjectTypes.WorkspaceMediaType,
  member: ObjectTypes.WorkspaceMemberType,
}

export interface ContentTypeRepositoryOptions {
  /** The state this node runs at; elements newer than it are marked pending. */
  nodeState?: NodeSchemaState
  /** Which kind of type this repository reads and writes. Default document. */
  kind?: ContentTypeKind
  /**
   * A workspace's view (story 376): its copies of types where it has them, and
   * Shared's otherwise, each under the key it stands for.
   */
  workspace?: WorkspaceScope
  /** Internal: rows written as this workspace's copies, under their stored keys. */
  copiesOf?: number
}

/** A type's row as a workspace's listing merges it over Shared's. */
interface ListedType {
  key: string
  alias: string
  name: string
  allowAtRoot: boolean
  isElement: boolean
  allowInLibrary: boolean
  siteSettings: boolean
  seo: unknown
}

export class ContentTypeRepository {
  #db: Db
  #nodes: NodeRepository
  #nodeState: NodeSchemaState | undefined
  #objectType: string
  #kind: ContentTypeKind
  #workspace: WorkspaceScope | undefined
  #copiesOf: number | undefined

  constructor(db: Db, options: ContentTypeRepositoryOptions = {}) {
    this.#db = db
    this.#nodes = new NodeRepository(db)
    this.#nodeState = options.nodeState
    this.#kind = options.kind ?? 'document'
    this.#workspace = options.workspace
    this.#copiesOf = options.copiesOf
    this.#objectType =
      this.#copiesOf === undefined
        ? CONTENT_TYPE_OBJECT_TYPES[this.#kind].item
        : WORKSPACE_TYPE_OBJECT_TYPES[this.#kind]
  }

  /** The same repository in a workspace's view (undefined: Shared's). */
  inWorkspace(workspace: WorkspaceScope | undefined): ContentTypeRepository {
    return new ContentTypeRepository(this.#db, {
      nodeState: this.#nodeState,
      kind: this.#kind,
      ...(workspace ? { workspace } : {}),
    })
  }

  // ---------------------------------------------------------------- workspaces (story 376)

  #shared(db: Db = this.#db): ContentTypeRepository {
    return new ContentTypeRepository(db, { nodeState: this.#nodeState, kind: this.#kind })
  }

  #copies(db: Db = this.#db): ContentTypeRepository {
    return new ContentTypeRepository(db, {
      nodeState: this.#nodeState,
      kind: this.#kind,
      copiesOf: (this.#workspace as WorkspaceScope).id,
    })
  }

  #stored(key: string): string {
    return workspaceRowKey((this.#workspace as WorkspaceScope).key, normaliseUuid(key))
  }

  /** The workspace's copy of a type, live or retired, by the key it stands for. */
  async #copyOf(key: string): Promise<{ nodeId: number; retired: boolean } | undefined> {
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select(['ct.node_id', 'ct.retired_at'])
      .where('n.unique_id', '=', this.#stored(key))
      .where('ct.workspace_id', '=', (this.#workspace as WorkspaceScope).id)
      .execute()
    const row = rows[0]
    return row ? { nodeId: Number(row.node_id), retired: row.retired_at !== null } : undefined
  }

  /**
   * The node a type is read from in the workspace: its copy where it has one, or
   * Shared's. Takes a node id, which a page's `content_type_id` is.
   */
  async readNodeId(nodeId: number): Promise<number> {
    if (!this.#workspace) return nodeId
    const node = await this.#nodes.byId(nodeId)
    if (!node || node.objectType !== CONTENT_TYPE_OBJECT_TYPES[this.#kind].item) return nodeId
    return (await this.#copyOf(node.key))?.nodeId ?? nodeId
  }

  /** Every type the workspace sees: its live copies over Shared's, each by the key it stands for. */
  async #listed(): Promise<ListedType[]> {
    const workspace = this.#workspace as WorkspaceScope
    const columns = [
      'ct.alias',
      'n.text',
      'ct.allow_at_root',
      'ct.is_element',
      'ct.allow_in_library',
      'ct.site_settings',
      'ct.seo',
      'ct.retired_at',
    ] as const
    const toListed = (key: string, row: Record<string, unknown>): ListedType => ({
      key: normaliseUuid(key),
      alias: String(row.alias),
      name: String(row.text ?? ''),
      allowAtRoot: fromDbBool(row.allow_at_root),
      isElement: fromDbBool(row.is_element),
      allowInLibrary: fromDbBool(row.allow_in_library),
      siteSettings: fromDbBool(row.site_settings),
      seo: row.seo,
    })
    const copies = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select([...columns, 'ct.origin_key'])
      .where('ct.workspace_id', '=', workspace.id)
      .where('n.node_object_type', '=', WORKSPACE_TYPE_OBJECT_TYPES[this.#kind])
      .execute()
    const copied = new Set(copies.map((row) => normaliseUuid(String(row.origin_key))))
    const shared = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select([...columns, 'n.unique_id'])
      .where('ct.retired_at', 'is', null)
      .where('n.node_object_type', '=', CONTENT_TYPE_OBJECT_TYPES[this.#kind].item)
      .execute()
    return [
      ...copies
        .filter((row) => row.retired_at === null)
        .map((row) => toListed(String(row.origin_key), row)),
      ...shared
        .filter((row) => !copied.has(normaliseUuid(String(row.unique_id))))
        .map((row) => toListed(String(row.unique_id), row)),
    ].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Keys as stored, back to the keys they stand for. */
  async #origins(keys: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const wanted = [...new Set(keys.map(normaliseUuid))]
    if (wanted.length === 0) return out
    const typeRows = await this.#db.q
      .selectFrom('content_type as t')
      .innerJoin('node as n', 'n.id', 't.node_id')
      .select(['n.unique_id', 't.origin_key'])
      .where('n.unique_id', 'in', wanted)
      .where('t.origin_key', 'is not', null)
      .execute()
    const dataTypeRows = await this.#db.q
      .selectFrom('data_type as t')
      .innerJoin('node as n', 'n.id', 't.node_id')
      .select(['n.unique_id', 't.origin_key'])
      .where('n.unique_id', 'in', wanted)
      .where('t.origin_key', 'is not', null)
      .execute()
    for (const row of [...typeRows, ...dataTypeRows])
      out.set(normaliseUuid(String(row.unique_id)), normaliseUuid(String(row.origin_key)))
    for (const table of ['property_type', 'property_type_group'] as const)
      for (const row of await this.#db.q
        .selectFrom(table)
        .select(['unique_id', 'origin_key'])
        .where('unique_id', 'in', wanted)
        .where('origin_key', 'is not', null)
        .execute())
        out.set(normaliseUuid(String(row.unique_id)), normaliseUuid(String(row.origin_key)))
    return out
  }

  /** A copy as the workspace reads it: every key the one it stands for. */
  async #asRead(stored: ContentTypeAggregate): Promise<ContentTypeAggregate> {
    const origins = await this.#origins([
      stored.key,
      ...stored.containers.flatMap((c) => [c.key, ...(c.parentKey ? [c.parentKey] : [])]),
      ...stored.properties.flatMap((p) => [p.key, p.dataTypeKey]),
      ...stored.compositions.map((c) => c.contentTypeKey),
      ...stored.allowedContentTypes.map((c) => c.contentTypeKey),
    ])
    const back = (key: string) => origins.get(normaliseUuid(key)) ?? key
    return {
      ...stored,
      key: back(stored.key),
      containers: stored.containers.map((c) => ({
        ...c,
        key: back(c.key),
        parentKey: c.parentKey ? back(c.parentKey) : null,
      })),
      properties: stored.properties.map((p) => ({
        ...p,
        key: back(p.key),
        dataTypeKey: back(p.dataTypeKey),
        containerKey: p.containerKey ? back(p.containerKey) : null,
      })),
      compositions: stored.compositions.map((c) => ({
        ...c,
        contentTypeKey: back(c.contentTypeKey),
      })),
      allowedContentTypes: stored.allowedContentTypes.map((c) => ({
        ...c,
        contentTypeKey: back(c.contentTypeKey),
      })),
    }
  }

  /** A type as the workspace saves it: its own keys stored, references to what it copied too. */
  async #asStored(db: Db, aggregate: ContentTypeAggregate): Promise<ContentTypeAggregate> {
    const workspace = this.#workspace as WorkspaceScope
    const copied = async (table: 'content_type' | 'data_type', key: string) => {
      const stored = this.#stored(key)
      const rows =
        table === 'content_type'
          ? await db.q
              .selectFrom('content_type as t')
              .innerJoin('node as n', 'n.id', 't.node_id')
              .select('t.node_id')
              .where('n.unique_id', '=', stored)
              .where('t.workspace_id', '=', workspace.id)
              .execute()
          : await db.q
              .selectFrom('data_type as t')
              .innerJoin('node as n', 'n.id', 't.node_id')
              .select('t.node_id')
              .where('n.unique_id', '=', stored)
              .where('t.workspace_id', '=', workspace.id)
              .execute()
      return rows.length > 0 ? stored : key
    }
    const own = (key: string) => this.#stored(key)
    const properties: PropertyTypeModel[] = []
    for (const p of aggregate.properties)
      properties.push({
        ...p,
        key: own(p.key),
        dataTypeKey: await copied('data_type', p.dataTypeKey),
        containerKey: p.containerKey ? own(p.containerKey) : null,
      })
    const compositions = []
    for (const c of aggregate.compositions)
      compositions.push({ ...c, contentTypeKey: await copied('content_type', c.contentTypeKey) })
    const allowedContentTypes = []
    for (const c of aggregate.allowedContentTypes)
      allowedContentTypes.push({
        ...c,
        contentTypeKey: await copied('content_type', c.contentTypeKey),
      })
    return {
      ...aggregate,
      key: own(aggregate.key),
      containers: aggregate.containers.map((c) => ({
        ...c,
        key: own(c.key),
        parentKey: c.parentKey ? own(c.parentKey) : null,
      })),
      properties,
      compositions,
      allowedContentTypes,
    }
  }

  /** Saves the workspace's copy of a type, marking each row with the key it stands for. */
  async #saveCopy(
    aggregate: ContentTypeAggregate,
    options: SaveContentTypeOptions,
  ): Promise<ContentTypeAggregate> {
    return this.#db.transaction(async (tx) => {
      const stored = await this.#asStored(tx, aggregate)
      await this.#copies(tx).save(stored, options)
      const node = await new NodeRepository(tx).byKey(stored.key)
      if (!node) throw new Error(`The copy of "${aggregate.alias}" was not saved.`)
      await tx.q
        .updateTable('content_type')
        .set({ origin_key: normaliseUuid(aggregate.key) })
        .where('node_id', '=', node.id)
        .execute()
      for (const p of aggregate.properties)
        await tx.q
          .updateTable('property_type')
          .set({ origin_key: normaliseUuid(p.key) })
          .where('unique_id', '=', this.#stored(p.key))
          .execute()
      for (const c of aggregate.containers)
        await tx.q
          .updateTable('property_type_group')
          .set({ origin_key: normaliseUuid(c.key) })
          .where('unique_id', '=', this.#stored(c.key))
          .execute()
      return (await this.inWorkspace(this.#workspace)
        .#within(tx)
        .byKey(aggregate.key)) as ContentTypeAggregate
    })
  }

  #within(db: Db): ContentTypeRepository {
    return new ContentTypeRepository(db, {
      nodeState: this.#nodeState,
      kind: this.#kind,
      ...(this.#workspace ? { workspace: this.#workspace } : {}),
      ...(this.#copiesOf === undefined ? {} : { copiesOf: this.#copiesOf }),
    })
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
    if (this.#workspace) {
      const copy = await this.#copyOf(key)
      if (copy?.retired) return undefined
      if (copy) {
        const stored = await this.#copies().byKey(this.#stored(key))
        return stored ? this.#asRead(stored) : undefined
      }
      return this.#shared().byKey(key)
    }
    const node = await this.#nodes.byKey(key)
    if (!node || node.objectType !== this.#objectType) return undefined
    return this.#load(node.id, node.key, node.text ?? '', node.parentId)
  }

  /** Retired types are hidden unless asked for: schema sync revives them by alias. */
  async byAlias(
    alias: string,
    options: { includeRetired?: boolean } = {},
  ): Promise<ContentTypeAggregate | undefined> {
    if (this.#workspace) {
      const found = (await this.#listed()).find((t) => t.alias === alias)
      if (found) return this.byKey(found.key)
      // A retired copy comes back by alias, as Shared's retired types do.
      if (!options.includeRetired) return undefined
      const retired = await this.#db.q
        .selectFrom('content_type')
        .select('origin_key')
        .where('workspace_id', '=', this.#workspace.id)
        .where('alias', '=', alias)
        .execute()
      if (!retired[0]) return undefined
      const stored = await this.#copies().byKey(this.#stored(String(retired[0].origin_key)))
      return stored ? this.#asRead(stored) : undefined
    }
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
    if (this.#workspace) {
      const except = exceptKey ? normaliseUuid(exceptKey) : undefined
      const kinds: ContentTypeKind[] = ['document', 'media', 'member']
      for (const kind of kinds) {
        const listed = await new ContentTypeRepository(this.#db, {
          kind,
          workspace: this.#workspace,
        }).#listed()
        if (listed.some((t) => t.alias === alias && t.key !== except)) return true
      }
      return false
    }
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('ct.alias', '=', alias)
      .where('ct.workspace_id', 'is', null)
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
    if (this.#workspace) return this.#listedPage((t) => t.allowAtRoot, skip, take)
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
    if (this.#workspace) return this.#listedPage((t) => t.isElement && t.allowInLibrary, skip, take)
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

  /** A page of the workspace's listed types that pass `keep`, loaded. */
  async #listedPage(
    keep: (t: ListedType) => boolean,
    skip: number,
    take: number,
  ): Promise<{ total: number; items: ContentTypeAggregate[] }> {
    const items: ContentTypeAggregate[] = []
    for (const t of (await this.#listed()).filter(keep)) {
      const aggregate = await this.byKey(t.key)
      if (aggregate && !aggregate.pending) items.push(aggregate)
    }
    return { total: items.length, items: items.slice(skip, skip + take) }
  }

  /**
   * Why an item of type `typeKey` may not sit under `parentKey` (null: the top
   * level), as its parent's type allows children; nothing when it may.
   */
  async placementRefusal(typeKey: string, parentKey: string | null): Promise<string | undefined> {
    // Story 450: a File or a Folder may go anywhere, and only those go inside one.
    if (isFileTreeType(typeKey)) return undefined
    const holder = parentKey === null ? undefined : await this.#fileTreeItem(parentKey)
    if (holder) return `Only a File or a Folder can go inside a ${holder}.`
    if (this.#workspace) {
      const type = await this.byKey(typeKey)
      if (!type) return undefined
      if (parentKey === null)
        return type.allowedAsRoot ? undefined : `"${type.name}" isn't allowed at the top level.`
      const parents = await this.#db.q
        .selectFrom('node as n')
        .innerJoin('content as c', 'c.node_id', 'n.id')
        .innerJoin('node as tn', 'tn.id', 'c.content_type_id')
        .leftJoin('content_type as tct', 'tct.node_id', 'tn.id')
        .select(['n.text', 'tn.unique_id', 'tct.origin_key'])
        .where('n.unique_id', '=', normaliseUuid(parentKey))
        .execute()
      const parent = parents[0]
      if (!parent) return undefined
      const parentType = await this.byKey(String(parent.origin_key ?? parent.unique_id))
      return parentType?.allowedContentTypes.some(
        (c) => normaliseUuid(c.contentTypeKey) === normaliseUuid(typeKey),
      )
        ? undefined
        : `"${type.name}" isn't allowed under "${parent.text ?? parentKey}".`
    }
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

  /** Which of File or Folder the item with this key is, if either. */
  async #fileTreeItem(key: string): Promise<'File' | 'Folder' | undefined> {
    const rows = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('node as tn', 'tn.id', 'c.content_type_id')
      .leftJoin('content_type as tct', 'tct.node_id', 'tn.id')
      .select(['tn.unique_id', 'tct.origin_key'])
      .where('n.unique_id', '=', normaliseUuid(key))
      .execute()
    const types = rows.map((row) => String(row.origin_key ?? row.unique_id))
    if (types.some(isFileType)) return 'File'
    if (types.some(isFileFolderType)) return 'Folder'
    return undefined
  }

  async allowedChildren(
    key: string,
    skip: number,
    take: number,
  ): Promise<{ total: number; items: ContentTypeAggregate[] }> {
    if (this.#workspace) {
      const items: ContentTypeAggregate[] = []
      for (const child of (await this.byKey(key))?.allowedContentTypes ?? []) {
        const aggregate = await this.byKey(child.contentTypeKey)
        if (aggregate && !aggregate.pending) items.push(aggregate)
      }
      return { total: items.length, items: items.slice(skip, skip + take) }
    }
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
    if (this.#workspace) return this.#saveCopy(aggregate, options)
    return this.#db.transaction(async (tx) => {
      const repo = this.#within(tx)
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
            workspace_id: this.#copiesOf ?? null,
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
      if (aggregate.seo !== undefined)
        await tx.q
          .updateTable('content_type')
          .set({ seo: seoColumn(aggregate.seo) })
          .where('node_id', '=', nodeId)
          .execute()
      if (aggregate.siteSettings !== undefined)
        await tx.q
          .updateTable('content_type')
          .set({ site_settings: bool(aggregate.siteSettings) })
          .where('node_id', '=', nodeId)
          .execute()
      if (aggregate.formKey !== undefined)
        await tx.q
          .updateTable('content_type')
          .set({ form_key: aggregate.formKey })
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
          variations:
            variationFlags(property.variesByCulture, property.variesBySegment) |
            (property.variesByEnvironment ? ENVIRONMENT_VARIATION : 0),
          since_version: property.sinceVersion ?? null,
        }
        const found = await tx.q
          .selectFrom('property_type')
          .select(['id', 'variations'])
          .where('unique_id', '=', key)
          .execute()
        // Only a schema sync says whether it varies by environment; a backoffice save keeps it.
        if (property.variesByEnvironment === undefined && found[0])
          columns.variations |= Number(found[0].variations) & ENVIRONMENT_VARIATION
        if (found[0]) {
          const id = Number(found[0].id)
          await tx.q
            .updateTable('property_type')
            .set({ ...columns, retired_at: null })
            .where('id', '=', id)
            .execute()
          // Story 387: turned off, each environment's own value goes; the shared one stays.
          if (
            property.variesByEnvironment === false &&
            (Number(found[0].variations) & ENVIRONMENT_VARIATION) !== 0
          )
            await tx.q
              .deleteFrom('property_value')
              .where('property_type_id', '=', id)
              .where('environment', 'is not', null)
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
      // A workspace's copies are its own, and go when it does (story 376).
      .where('ct.workspace_id', 'is', null)
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
    if (this.#workspace) return this.byKeys((await this.#listed()).map((t) => t.key))
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

  /** Each live type's search and sharing values, by alias, for the types that set any (story 317). */
  async seoMappings(): Promise<Record<string, SeoMapping>> {
    const rows = await this.#db.q
      .selectFrom('content_type as ct')
      .innerJoin('node as n', 'n.id', 'ct.node_id')
      .select(['ct.alias', 'ct.seo'])
      .where('ct.retired_at', 'is', null)
      .where('ct.seo', 'is not', null)
      .where('n.node_object_type', '=', this.#objectType)
      .execute()
    const out: Record<string, SeoMapping> = {}
    for (const row of rows) {
      const mapping = seoFromColumn(row.seo)
      if (mapping) out[String(row.alias)] = mapping
    }
    return out
  }

  /** Every live type's alias by its key, without loading the types themselves. */
  async aliasesByKey(): Promise<Map<string, string>> {
    if (this.#workspace) return new Map((await this.#listed()).map((t) => [t.key, t.alias]))
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
    if (this.#workspace)
      return (await this.#listed()).filter((t) => t.siteSettings).map((t) => t.alias)
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

  /** Sets a type's search and sharing values alone (story 317); null clears them. */
  async setSeo(typeKey: string, mapping: SeoMapping | null): Promise<void> {
    const node = await this.#nodes.byKey(typeKey)
    if (!node || node.objectType !== this.#objectType) return
    await this.#db.q
      .updateTable('content_type')
      .set({ seo: seoColumn(mapping) })
      .where('node_id', '=', node.id)
      .execute()
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
    if (this.#workspace) {
      const copy = await this.#copyOf(key)
      if (copy?.retired) return false
      const shared =
        (await this.#nodes.byKey(key))?.objectType === CONTENT_TYPE_OBJECT_TYPES[this.#kind].item
      // A Shared type removed in the workspace is a retired copy, which hides Shared's.
      if (shared) {
        if (!copy) {
          const type = await this.#shared().byKey(key)
          if (!type) return false
          await this.#saveCopy(type, {})
        }
        await this.#db.q
          .updateTable('content_type')
          .set({ retired_at: DbDate.toDb(new Date()) })
          .where('workspace_id', '=', this.#workspace.id)
          .where('origin_key', '=', normaliseUuid(key))
          .execute()
        return true
      }
      return copy ? this.#copies().delete(this.#stored(key)) : false
    }
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
        'ct.seo',
        'ct.form_key',
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
      ...(variesByEnvironment(Number(row.variations)) ? { variesByEnvironment: true } : {}),
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
      seo: seoFromColumn(type.seo),
      formKey: (type.form_key as string | null) ?? null,
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
