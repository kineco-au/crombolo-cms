/**
 * Documents, versions and publishing on the append-only value model.
 *
 * A value never changes in place: every change appends a `property_value` row
 * tagged with the event that wrote it and the schema state the writer was at.
 * `content_version` rows are events (save | publish | rollback | migrate).
 * Publish is an event and a pointer, not a copy; rollback appends the old
 * values under a new event. See docs/data-model.md.
 */
import {
  type DocumentAggregate,
  type DocumentTreeItem,
  type DocumentValidationError,
  type DocumentValue,
  type DocumentVariant,
  type DocumentVersionSummary,
  dateFromText,
  variesByCulture as flagVariesByCulture,
  type MediaItemAccess,
  normaliseUuid,
  ObjectTypes,
  type Page,
  parseMediaPolicy,
  STORAGE_COLUMN,
  SYSTEM_MEDIA_TYPE_KEYS,
  SystemNodes,
  toEditorValue,
  type ValueStorageTypeName,
  type VariantState,
} from '@crombolo/core'
import { appendCacheInstruction } from '../cluster.ts'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { type LockId, Locks } from '../locks.ts'
import { isPending } from '../pending.ts'
import { type Insertable, sql } from '../query.ts'
import { TREE_GROUP_FOLDER, TREE_GROUP_ITEM } from '../schema/media-tree-order.ts'
import {
  assertNodeMayWrite,
  BASELINE_NODE_STATE,
  type NodeSchemaState,
  type SchemaStateRow,
  visibleStateIdFor,
} from '../schema-state.ts'
import { queueForSearch } from '../search.ts'
import { recordSearchRemovals, searchesOutsideDatabase } from '../search-providers.ts'
import type { CoreTables } from '../tables.gen.ts'
import { recordFiles } from './media-access.ts'
import { NodeRepository, type NodeRow } from './nodes.ts'

export type EventKind = 'save' | 'publish' | 'rollback' | 'migrate'

interface PropertyTypeRow {
  id: number
  alias: string
  name: string
  variesByCulture: boolean
  storage: ValueStorageTypeName
  editorAlias: string
  /** The data type's configuration, for converters that depend on it. */
  config: Record<string, unknown>
  mandatory: boolean
  mandatoryMessage: string | null
  regEx: string | null
  regExMessage: string | null
  /** Not yet live on this node: editable, never validated, never rendered. */
  pending: boolean
}

interface LanguageRow {
  id: number
  isoCode: string
  isDefault: boolean
  isMandatory: boolean
}

export interface CurrentValue {
  rowId: number
  eventId: number
  schemaStateId: number
  alias: string
  culture: string | null
  segment: string | null
  /** The environment it overrides the shared value for (story 387). */
  environment?: string | null
  value: unknown
}

export interface MigratedValue {
  alias: string
  culture: string | null
  segment: string | null
  environment?: string | null
  value: unknown
  /** The event to file the value under; defaults to the row it supersedes. */
  eventId?: number
  /** The storage column to write, when the value is in a new editor's format ahead of the cut-over. */
  storage?: ValueStorageTypeName
}

interface PublishedCulture {
  languageId: number
  isoCode: string
  eventId: number
  name: string
}

interface ValueRow {
  eventId: number
  id: number
  propertyTypeId: number
  languageId: number | null
  segment: string | null
  /** The environment it overrides the shared value for, or null for the shared value (story 387). */
  environment: string | null
  raw: unknown
}

export interface SaveDocumentInput {
  key: string
  contentTypeKey: string
  componentKey: string | null
  parentKey: string | null
  values: DocumentValue[]
  variants: Array<{ culture: string | null; segment: string | null; name: string }>
  userId?: number
  /** The revision the values were based on; a different one refuses the save (story 172). */
  expectedRevision?: string
}

/** A published document plus the values of its published version. */
export interface PublishedNodeRow {
  id: number
  key: string
  parentId: number
  level: number
  path: string
  sortOrder: number
  name: string
  contentTypeAlias: string
  componentAlias: string | null
  createDate: Date
  updateDate: Date
  cultures: string[]
  /** Each published culture's name, as it was published. */
  names: Record<string, string>
  values: DocumentValue[]
}

/**
 * What a repository holds. Media, members and blueprints are stored exactly as
 * documents are (node, content, versions, values); they differ in object type,
 * recycle bin, and in never being published.
 */
export type ContentKind = 'document' | 'media' | 'member' | 'blueprint' | 'element'

const KINDS: Record<
  ContentKind,
  {
    objectType: string
    recycleBin: number | undefined
    container: string | undefined
    lock: LockId
    /** What an item of this kind made in a workspace is (stories 375, 390); none, never made in one. */
    workspaceObjectType?: string
  }
> = {
  document: {
    objectType: ObjectTypes.Document,
    recycleBin: SystemNodes.ContentRecycleBin,
    container: undefined,
    lock: Locks.ContentTree,
    workspaceObjectType: ObjectTypes.WorkspaceDocument,
  },
  media: {
    objectType: ObjectTypes.Media,
    recycleBin: SystemNodes.MediaRecycleBin,
    container: undefined,
    lock: Locks.MediaTree,
    workspaceObjectType: ObjectTypes.WorkspaceMedia,
  },
  // Members are a flat list at the tree root: no bin to trash them into, and
  // no folders to gather them in.
  member: {
    objectType: ObjectTypes.Member,
    recycleBin: undefined,
    container: undefined,
    lock: Locks.MemberTree,
  },
  blueprint: {
    objectType: ObjectTypes.DocumentBlueprint,
    recycleBin: undefined,
    container: ObjectTypes.DocumentBlueprintContainer,
    lock: Locks.ContentTree,
    workspaceObjectType: ObjectTypes.WorkspaceDocumentBlueprint,
  },
  // Umbraco 18's Elements: publishable content with no URL, gathered in folders
  // and trashed into a bin of its own at -22, as its Constants.System says.
  element: {
    objectType: ObjectTypes.Element,
    recycleBin: SystemNodes.ElementRecycleBin,
    container: ObjectTypes.ElementContainer,
    lock: Locks.ContentTree,
    workspaceObjectType: ObjectTypes.WorkspaceElement,
  },
}

/**
 * A step every save runs on its values before they are stored, knowing each
 * property's editor: where uploaded files are placed and file facts filled in.
 */
export type ValueIntake = (
  values: readonly DocumentValue[],
  propertyTypes: ReadonlyArray<{ alias: string; editorAlias: string }>,
) => Promise<DocumentValue[]>

export interface DocumentRepositoryOptions {
  /** The environment whose own values rendering shows (story 387); the repository keeps every one. */
  environment?: string
  /** The schema state this process runs at; writes are refused if the database is ahead. */
  nodeState?: NodeSchemaState
  /** Stamped on the cache instructions this repository appends. */
  nodeId?: string
  kind?: ContentKind
  valueIntake?: ValueIntake
  /**
   * Set when the caller already holds the content-tree lock, so the writes
   * below must not take it again.
   *
   * Neither lock manager survives re-entry: the SQLite one is a promise queue
   * that would wait on itself for ever, and the Postgres one acquires inside
   * its own `transaction`. Transactions *do* nest — both implementations join
   * an enclosing one — so this flag is only ever about the lock.
   *
   * It exists for an operation that spans many documents and has to be atomic
   * across all of them, like importing a content bundle: one lock and one
   * transaction for the run, rather than one of each per node.
   */
  inTreeLock?: boolean
  /** The workspace it reads and writes in (story 375); absent, Shared. */
  workspace?: number
}

/** Thrown when a publish is refused by a business rule rather than failing. */
export class PublishBlockedError extends Error {
  /** The properties that stopped it, when it was their values (story 298). */
  readonly errors: DocumentValidationError[]

  constructor(message: string, errors: DocumentValidationError[] = []) {
    super(message)
    this.errors = errors
  }
}

/** The parent named for a new item is gone, or in the recycle bin. */
export class InvalidParentError extends Error {}

/**
 * One field of a page as a merge compares it (story 380): a value by
 * `alias|culture|segment`, `@name` or `@name:<iso>`, or `@template` (a key).
 * `undefined` is "not there".
 */
export interface MergeField {
  field: string
  base: unknown
  mine: unknown
  theirs: unknown
  /** Which value it is, when the field is a value. */
  value?: {
    alias: string
    culture: string | null
    segment: string | null
    environment?: string | null
  }
}

/** A page a workspace changed or made, as its merge reads it. */
export interface WorkspacePageMerge {
  /** Pages, media or Library items (story 390). */
  kind: ContentKind
  key: string
  nodeId: number
  made: boolean
  level: number
  contentTypeKey: string
  parentKey: string | null
  /** Shared's latest event now, and the one the workspace began from. */
  sharedHead: number | null
  baseEvent: number | null
  fields: MergeField[]
  /**
   * Published state for the page, and per language: as begun, in the workspace, in
   * Shared now. `here` says the workspace published its own version, which a merge
   * publishes; `sharedEdited` says Shared has changes it has not published.
   */
  published: {
    base: boolean | null
    mine: boolean
    theirs: boolean
    here: boolean
    sharedEdited: boolean
  }
  cultures: Array<{ iso: string; base: boolean | null; mine: boolean; theirs: boolean }>
}

/** Something a workspace cannot hold yet (story 375), said in the editor's words. */
export class WorkspaceRefusedError extends Error {}

/** A page a workspace has touched: where it started from, and where it stands there. */
interface WorkspaceDocumentRow {
  baseEventId: number | null
  created: boolean
  published: boolean
  publishedEventId: number | null
  edited: boolean
}

/** The draft changed after the revision a write was based on (story 172). */
export class StaleRevisionError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super('The page changed after this copy of it was read.')
  }
}

const revisionString = (head: unknown, value: unknown): string =>
  `${Number(head ?? 0)}.${Number(value ?? 0)}`

const isEmpty = (value: unknown) =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '')

/**
 * Mandatory and pattern rules over a set of values. Invariant properties are
 * checked once; culture-varying ones once per culture given. Pending
 * properties are never checked.
 */
function validateValues(
  propertyTypes: readonly PropertyTypeRow[],
  values: readonly DocumentValue[],
  cultures: readonly string[],
): DocumentValidationError[] {
  const errors: DocumentValidationError[] = []
  for (const type of propertyTypes) {
    if (type.pending) continue
    const targets: Array<string | null> = type.variesByCulture ? [...cultures] : [null]
    if (type.variesByCulture && targets.length === 0) continue
    for (const culture of targets) {
      const value = values.find(
        (v) =>
          v.alias === type.alias &&
          (type.variesByCulture ? v.culture === culture : true) &&
          (v.segment ?? null) === null,
      )
      const messages: string[] = []
      if (type.mandatory && (!value || isEmpty(value.value)))
        messages.push(type.mandatoryMessage || 'Value cannot be empty')
      if (type.regEx && value && !isEmpty(value.value) && typeof value.value === 'string') {
        let matches = true
        try {
          matches = new RegExp(type.regEx).test(value.value)
        } catch {
          matches = true
        }
        if (!matches)
          messages.push(
            type.regExMessage || 'Value is invalid, it does not match the correct pattern',
          )
      }
      if (messages.length > 0) errors.push({ alias: type.alias, culture, segment: null, messages })
    }
  }
  return errors
}

const keyOf = (
  propertyTypeId: number,
  languageId: number | null,
  segment: string | null,
  environment: string | null = null,
) => `${propertyTypeId}|${languageId ?? ''}|${segment ?? ''}|${environment ?? ''}`

/**
 * The value rows a published node shows, from its history in id order:
 * invariant values as of its latest publish, each culture's as of its own.
 * A culture that is not published contributes nothing. Pure.
 */
export function publishedValueRows<
  R extends {
    eventId: number
    propertyTypeId: number
    languageId: number | null
    segment: string | null
    environment?: string | null
  },
>(
  history: readonly R[],
  invariantEventId: number,
  cultures: ReadonlyArray<{ languageId: number; eventId: number }>,
): R[] {
  const cutoff = new Map(cultures.map((c) => [c.languageId, c.eventId]))
  const chosen = new Map<string, R>()
  for (const row of history) {
    const limit = row.languageId === null ? invariantEventId : cutoff.get(row.languageId)
    if (limit === undefined || row.eventId > limit) continue
    chosen.set(keyOf(row.propertyTypeId, row.languageId, row.segment, row.environment ?? null), row)
  }
  return [...chosen.values()]
}

/** Which nodes `loadCurrent` reads: by key, by id, or by the file address a media item serves. */
export type CurrentFilter =
  | { keys: readonly string[]; ids?: undefined; urls?: undefined }
  | { ids: readonly number[]; keys?: undefined; urls?: undefined }
  | { urls: readonly string[]; keys?: undefined; ids?: undefined }

/** A node as an editor sees it now. */
export interface CurrentNodeRow {
  id: number
  key: string
  name: string
  contentTypeAlias: string
  values: DocumentValue[]
  parentId: number
  path: string
  sortOrder: number
  createDate: Date
  updateDate: Date
  /** A media item's own read and write settings (story 196); `inherit` for anything else. */
  access: MediaItemAccess
}

/** Ids in slices small enough for either dialect's parameter limit. */
/** A turn for whatever else is waiting: a request, while a long read runs. */
const giveWay = () => new Promise<void>((resolve) => setImmediate(resolve))

const slices = <T>(items: readonly T[], size = 500): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, n) =>
    items.slice(n * size, (n + 1) * size),
  )

export class DocumentRepository {
  #db: Db
  #nodes: NodeRepository
  #nodeState: NodeSchemaState
  #nodeId: string | undefined
  readonly kind: ContentKind
  readonly objectType: string
  #recycleBin: number | undefined
  #intake: ValueIntake | undefined
  #inTreeLock: boolean
  #workspace: number | undefined

  constructor(db: Db, options: DocumentRepositoryOptions = {}) {
    this.#db = db
    this.#nodes = new NodeRepository(db)
    this.#nodeState = options.nodeState ?? BASELINE_NODE_STATE
    this.#nodeId = options.nodeId
    this.kind = options.kind ?? 'document'
    this.objectType = KINDS[this.kind].objectType
    this.#recycleBin = KINDS[this.kind].recycleBin
    this.#intake = options.valueIntake
    this.#inTreeLock = options.inTreeLock ?? false
    this.#workspace = options.workspace
  }

  /** The workspace it reads and writes in (story 375); undefined for Shared. */
  get workspace(): number | undefined {
    return this.#workspace
  }

  /** The same repository, in a workspace (undefined: Shared). */
  inWorkspace(workspace: number | undefined): DocumentRepository {
    return new DocumentRepository(this.#db, {
      nodeState: this.#nodeState,
      nodeId: this.#nodeId,
      kind: this.kind,
      valueIntake: this.#intake,
      inTreeLock: this.#inTreeLock,
      workspace,
    })
  }

  get nodes(): NodeRepository {
    return this.#nodes
  }

  /**
   * The tree's lock, unless the caller already holds it. Every write goes
   * through here, as every Umbraco content service write takes its tree's write
   * lock: two saves, or a save and a move, never interleave. The node a write
   * acts on is read inside, so it acts on where the node is now.
   */
  #withTree<T>(fn: () => Promise<T>): Promise<T> {
    return this.#inTreeLock ? fn() : this.#db.locks.withLock(KINDS[this.kind].lock, fn)
  }

  /**
   * Runs `fn` under the tree lock in one transaction, with a repository bound to
   * it, so several writes commit together or not at all (story 170).
   */
  async atomically<T>(fn: (repo: DocumentRepository, tx: Db) => Promise<T>): Promise<T> {
    return this.#withTree(() => this.#db.transaction((tx) => fn(this.#child(tx), tx)))
  }

  /** The same repository, on the same handle and inside the same lock, for another kind (story 390). */
  ofKind(kind: ContentKind): DocumentRepository {
    return new DocumentRepository(this.#db, {
      nodeState: this.#nodeState,
      nodeId: this.#nodeId,
      kind,
      valueIntake: this.#intake,
      inTreeLock: this.#inTreeLock,
      workspace: this.#workspace,
    })
  }

  #child(tx: Db): DocumentRepository {
    return new DocumentRepository(tx, {
      nodeState: this.#nodeState,
      nodeId: this.#nodeId,
      kind: this.kind,
      valueIntake: this.#intake,
      // A child runs inside whatever its parent took.
      inTreeLock: true,
      workspace: this.#workspace,
    })
  }

  // ---------------------------------------------------------------- workspaces (story 375)

  /** Whether a node is one this repository may see: Shared's, or its workspace's own. */
  sees(node: NodeRow): boolean {
    if (node.objectType === this.objectType) return true
    return (
      this.#workspace !== undefined &&
      node.objectType === KINDS[this.kind].workspaceObjectType &&
      node.workspaceId === this.#workspace
    )
  }

  async #workspaceDocument(nodeId: number): Promise<WorkspaceDocumentRow | undefined> {
    if (this.#workspace === undefined) return undefined
    const rows = await this.#db.q
      .selectFrom('workspace_document')
      .selectAll()
      .where('workspace_id', '=', this.#workspace)
      .where('node_id', '=', nodeId)
      .execute()
    const row = rows[0]
    if (!row) return undefined
    return {
      baseEventId: row.base_event_id === null ? null : Number(row.base_event_id),
      created: fromDbBool(row.created),
      published: fromDbBool(row.published),
      publishedEventId: row.published_event_id === null ? null : Number(row.published_event_id),
      edited: fromDbBool(row.edited),
    }
  }

  /**
   * The workspace's row for a Shared page, made the first time it writes one:
   * the event it starts from, and Shared's published state and languages as
   * they stand, which it then keeps apart.
   */
  async #touch(node: NodeRow): Promise<WorkspaceDocumentRow> {
    const workspace = this.#workspace as number
    const existing = await this.#workspaceDocument(node.id)
    if (existing) return existing
    const head = await this.#headEvent(node.id)
    const document = (
      await this.#db.q
        .selectFrom('document')
        .select(['published', 'edited'])
        .where('node_id', '=', node.id)
        .execute()
    )[0]
    const row: WorkspaceDocumentRow = {
      baseEventId: head?.id ?? null,
      created: false,
      published: fromDbBool(document?.published),
      publishedEventId: (await this.#publishedEventId(node.id)) ?? null,
      edited: fromDbBool(document?.edited),
    }
    await this.#db.q
      .insertInto('workspace_document')
      .values({
        workspace_id: workspace,
        node_id: node.id,
        base_event_id: row.baseEventId,
        created: this.#db.dialect.boolValue(false) as boolean,
        published: this.#db.dialect.boolValue(row.published) as boolean,
        published_event_id: row.publishedEventId,
        edited: this.#db.dialect.boolValue(row.edited) as boolean,
        // What Shared had published when the workspace began, for the merge (story 380).
        base_published: this.#db.dialect.boolValue(row.published) as boolean,
      })
      .execute()
    await this.#db.q
      .insertInto('workspace_document_culture')
      .columns([
        'workspace_id',
        'node_id',
        'language_id',
        'name',
        'available',
        'published',
        'edited',
        'published_event_id',
        'published_name',
        'base_published',
        'base_published_event_id',
      ])
      .expression((eb) =>
        eb
          .selectFrom('document_culture_variation')
          .select([
            eb.val(workspace).as('workspace_id'),
            'node_id',
            'language_id',
            'name',
            'available',
            'published',
            'edited',
            'published_event_id',
            'published_name',
            'published as base_published',
            'published_event_id as base_published_event_id',
          ])
          .where('node_id', '=', node.id),
      )
      .execute()
    return row
  }

  async #setWorkspaceDocument(
    nodeId: number,
    change: Partial<Pick<WorkspaceDocumentRow, 'published' | 'publishedEventId' | 'edited'>>,
  ): Promise<void> {
    const b = (value: boolean) => this.#db.dialect.boolValue(value) as boolean
    await this.#db.q
      .updateTable('workspace_document')
      .set({
        ...(change.published === undefined ? {} : { published: b(change.published) }),
        ...(change.publishedEventId === undefined
          ? {}
          : { published_event_id: change.publishedEventId }),
        ...(change.edited === undefined ? {} : { edited: b(change.edited) }),
      })
      .where('workspace_id', '=', this.#workspace as number)
      .where('node_id', '=', nodeId)
      .execute()
  }

  /** An event of the workspace's: never current, never Shared's head. */
  async #insertWorkspaceEvent(
    nodeId: number,
    kind: EventKind,
    name: string,
    userId: number | undefined,
    templateId: number | null,
  ): Promise<number> {
    const workspace = this.#workspace as number
    await this.#db.q
      .insertInto('content_version')
      .values({
        node_id: nodeId,
        kind,
        version_date: DbDate.toDb(new Date()),
        user_id: userId ?? null,
        current: this.#db.dialect.boolValue(false) as boolean,
        text: name,
        prevent_cleanup: this.#db.dialect.boolValue(false) as boolean,
        workspace_id: workspace,
      })
      .execute()
    const rows = await this.#db.q
      .selectFrom('content_version')
      .select((eb) => eb.fn.max('id').as('id'))
      .where('node_id', '=', nodeId)
      .where('workspace_id', '=', workspace)
      .execute()
    const eventId = Number(rows[0]?.id)
    await this.#db.q
      .insertInto('document_version')
      .values({
        id: eventId,
        template_id: templateId,
        published: this.#db.dialect.boolValue(false) as boolean,
      })
      .execute()
    return eventId
  }

  /** The workspace's latest event for a page, with its name, template and date. */
  /** A version as a page's head reads it (story 411): for a workspace page with none of its own. */
  async #versionHead(versionId: number | null) {
    if (versionId === null) return undefined
    const rows = await this.#db.q
      .selectFrom('content_version as cv')
      .innerJoin('document_version as dv', 'dv.id', 'cv.id')
      .leftJoin('node as tn', 'tn.id', 'dv.template_id')
      .select([
        'cv.id',
        'cv.text',
        'cv.version_date',
        'dv.template_id',
        'tn.unique_id as template_key',
      ])
      .where('cv.id', '=', versionId)
      .execute()
    return rows[0]
  }

  async #workspaceHead(nodeId: number) {
    const rows = await this.#db.q
      .selectFrom('content_version as cv')
      .innerJoin('document_version as dv', 'dv.id', 'cv.id')
      .leftJoin('node as tn', 'tn.id', 'dv.template_id')
      .select([
        'cv.id',
        'cv.text',
        'cv.version_date',
        'dv.template_id',
        'tn.unique_id as template_key',
      ])
      .where('cv.node_id', '=', nodeId)
      .where('cv.workspace_id', '=', this.#workspace as number)
      .orderBy('cv.id', 'desc')
      .limit(1)
      .execute()
    return rows[0]
  }

  /**
   * The page as the workspace sees it: Shared's values as of the event it
   * started from, newest per key, with the workspace's own laid over them. The
   * workspace's row wins whatever its id, since an upgrade can append a Shared
   * twin under an old event after the workspace wrote.
   */
  async #workspaceView(
    nodeId: number,
    wd: WorkspaceDocumentRow,
    /** Only the workspace's own rows up to this event: what it published (story 379). */
    upTo?: number,
  ): Promise<ValueRow[]> {
    const workspace = this.#workspace as number
    const rows = await this.#db.q
      .selectFrom('property_value')
      .select([
        'id',
        'event_id',
        'property_type_id',
        'language_id',
        'segment',
        'environment',
        'int_value',
        'decimal_value',
        'date_value',
        'varchar_value',
        'text_value',
        'workspace_id',
      ])
      .where('node_id', '=', nodeId)
      .where((eb) =>
        wd.baseEventId === null
          ? eb('workspace_id', '=', workspace)
          : eb.or([
              eb.and([eb('workspace_id', 'is', null), eb('event_id', '<=', wd.baseEventId)]),
              eb('workspace_id', '=', workspace),
            ]),
      )
      .orderBy('id')
      .execute()
    const shared = new Map<string, ValueRow>()
    const mine = new Map<string, ValueRow>()
    for (const row of rows) {
      const value = this.#toValueRow(row)
      if (upTo !== undefined && row.workspace_id !== null && value.eventId > upTo) continue
      const key = keyOf(value.propertyTypeId, value.languageId, value.segment, value.environment)
      ;(row.workspace_id === null ? shared : mine).set(key, value)
    }
    return [...new Map([...shared, ...mine]).values()]
  }

  /** A page the workspace has touched, as an editor in it sees it. */
  async #loadInWorkspace(
    node: NodeRow,
    wd: WorkspaceDocumentRow,
  ): Promise<DocumentAggregate | undefined> {
    const workspace = this.#workspace as number
    const rows = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .innerJoin('node as ctn', 'ctn.id', 'ct.node_id')
      .select([
        'c.content_type_id',
        'ct.alias as content_type_alias',
        'ct.icon as content_type_icon',
        'ct.list_view as content_type_collection',
        'ctn.unique_id as content_type_key',
        'ct.origin_key as content_type_origin_key',
      ])
      .where('c.node_id', '=', node.id)
      .execute()
    const row = rows[0]
    // Unpublished there and not saved there, it has no version of its own: Shared's it began from.
    const head =
      (await this.#workspaceHead(node.id)) ?? (await this.#versionHead(wd.baseEventId ?? null))
    if (!row || !head) return undefined
    const propertyTypes = await this.#propertyTypes(Number(row.content_type_id))
    const languages = await this.#languages()
    const values = this.#valuesFromRows(
      await this.#workspaceView(node.id, wd),
      propertyTypes,
      languages,
    )
    const createDate = node.createDate ?? new Date()
    const updateDate = DbDate.fromDb(head.version_date) ?? createDate
    const cultureRows = await this.#db.q
      .selectFrom('workspace_document_culture as wdc')
      .innerJoin('language as l', 'l.id', 'wdc.language_id')
      .select(['wdc.name', 'wdc.published', 'wdc.edited', 'wdc.available', 'l.iso_code'])
      .where('wdc.workspace_id', '=', workspace)
      .where('wdc.node_id', '=', node.id)
      .execute()
    const variants: DocumentVariant[] =
      cultureRows.length === 0
        ? [
            {
              culture: null,
              segment: null,
              name: String(head.text ?? node.text ?? ''),
              state: stateFor(wd.published, wd.edited, node.trashed),
              createDate,
              updateDate,
              publishDate: null,
            },
          ]
        : cultureRows.map((culture) => ({
            culture: String(culture.iso_code),
            segment: null,
            name: String(culture.name ?? ''),
            state: stateFor(
              fromDbBool(culture.published),
              fromDbBool(culture.edited),
              node.trashed,
              fromDbBool(culture.available),
            ),
            createDate,
            updateDate,
            publishDate: null,
          }))
    const parent = node.parentId > 0 ? await this.#nodes.byId(node.parentId) : undefined
    return {
      key: node.key,
      // A type made in the workspace is stored under a key of its own (story 376).
      contentTypeKey: normaliseUuid(String(row.content_type_origin_key ?? row.content_type_key)),
      contentTypeAlias: String(row.content_type_alias),
      contentTypeIcon: String(row.content_type_icon ?? 'icon-document'),
      contentTypeCollectionKey: row.content_type_collection
        ? normaliseUuid(String(row.content_type_collection))
        : null,
      componentKey: head.template_key ? normaliseUuid(String(head.template_key)) : null,
      parentKey: parent && parent.id !== SystemNodes.Root ? parent.key : null,
      sortOrder: node.sortOrder,
      isTrashed: node.trashed,
      published: wd.published,
      edited: wd.edited,
      values,
      variants,
      revision: await this.#revision(node.id),
    }
  }

  /** Names and languages a workspace save gives a page, kept apart from Shared's. */
  async #writeWorkspaceCultures(
    nodeId: number,
    eventId: number,
    variants: ReadonlyArray<{ culture: string | null; name: string }>,
  ): Promise<void> {
    const workspace = this.#workspace as number
    const cultured = variants.filter((variant) => variant.culture !== null)
    if (cultured.length === 0) return
    const languages = await this.#languages()
    const idByIso = new Map(languages.map((l) => [l.isoCode.toLowerCase(), l.id]))
    const t = this.#db.dialect.boolValue(true) as boolean
    const f = this.#db.dialect.boolValue(false) as boolean
    for (const variant of cultured) {
      const languageId = idByIso.get(String(variant.culture).toLowerCase())
      if (!languageId) continue
      await this.#db.q
        .insertInto('content_version_culture_variation')
        .values({
          version_id: eventId,
          language_id: languageId,
          name: variant.name,
          date: DbDate.toDb(new Date()),
        })
        .execute()
      const held = await this.#db.q
        .selectFrom('workspace_document_culture')
        .select('language_id')
        .where('workspace_id', '=', workspace)
        .where('node_id', '=', nodeId)
        .where('language_id', '=', languageId)
        .execute()
      if (held.length > 0)
        await this.#db.q
          .updateTable('workspace_document_culture')
          .set({ name: variant.name, available: t, edited: t })
          .where('workspace_id', '=', workspace)
          .where('node_id', '=', nodeId)
          .where('language_id', '=', languageId)
          .execute()
      else
        await this.#db.q
          .insertInto('workspace_document_culture')
          .values({
            workspace_id: workspace,
            node_id: nodeId,
            language_id: languageId,
            name: variant.name,
            available: t,
            published: f,
            edited: t,
            published_event_id: null,
            published_name: null,
          })
          .execute()
    }
  }

  /** The languages of a page in the workspace: those it has, or those published there. */
  async #workspaceCultures(nodeId: number, which: 'available' | 'published'): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('workspace_document_culture as wdc')
      .innerJoin('language as l', 'l.id', 'wdc.language_id')
      .select('l.iso_code')
      .where('wdc.workspace_id', '=', this.#workspace as number)
      .where('wdc.node_id', '=', nodeId)
      .where(`wdc.${which}`, '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    return rows.map((row) => String(row.iso_code))
  }

  /** Whether every ancestor is published as the workspace sees it. */
  async #ancestorsPublishedInWorkspace(node: NodeRow): Promise<boolean> {
    const ids = node.path
      .split(',')
      .map(Number)
      .filter((id) => id > 0 && id !== node.id)
    for (const id of ids) {
      const mine = await this.#workspaceDocument(id)
      if (mine) {
        if (!mine.published) return false
        continue
      }
      const shared = await this.#db.q
        .selectFrom('document')
        .select('published')
        .where('node_id', '=', id)
        .execute()
      if (!fromDbBool(shared[0]?.published)) return false
    }
    return true
  }

  /**
   * Publishes a page in the workspace only (story 375): Shared's published
   * page, its flags and the published cache are untouched, and the usual rules
   * are checked against what the workspace sees.
   */
  async #publishInWorkspace(
    node: NodeRow,
    cultures: readonly string[] | null,
  ): Promise<DocumentAggregate | undefined> {
    if (node.trashed) throw new PublishBlockedError('The document is in the recycle bin.')
    if (!(await this.#ancestorsPublishedInWorkspace(node)))
      throw new PublishBlockedError('An ancestor is not published.')
    await this.#touch(node)
    const variant = await this.#variesByCulture(node.id)
    const available = variant ? await this.#workspaceCultures(node.id, 'available') : []
    const targets = variant ? (cultures && cultures.length > 0 ? [...cultures] : available) : null
    if (targets) {
      const missing = targets.filter(
        (c) => !available.some((a) => a.toLowerCase() === c.toLowerCase()),
      )
      if (missing.length > 0)
        throw new PublishBlockedError(
          `The document has no ${missing.join(', ')} variant to publish.`,
        )
      const published = await this.#workspaceCultures(node.id, 'published')
      const settled = new Set([...targets, ...published].map((c) => c.toLowerCase()))
      const mandatory = (await this.#languages()).filter(
        (l) => l.isMandatory && !settled.has(l.isoCode.toLowerCase()),
      )
      if (mandatory.length > 0)
        throw new PublishBlockedError(
          `The mandatory ${mandatory.map((l) => l.isoCode).join(', ')} must be published too.`,
        )
    }
    await this.#assertMandatoryFilled(node, targets)
    const head = (await this.#workspaceHead(node.id)) ?? undefined
    const shared = head ? undefined : await this.#headEvent(node.id)
    const eventId = await this.#insertWorkspaceEvent(
      node.id,
      'publish',
      String(head?.text ?? shared?.name ?? node.text ?? ''),
      undefined,
      head
        ? head.template_id === null
          ? null
          : Number(head.template_id)
        : (shared?.templateId ?? null),
    )
    await this.#setWorkspaceDocument(node.id, {
      published: true,
      publishedEventId: eventId,
      edited: false,
    })
    const languages = await this.#languages()
    for (const iso of targets ?? []) {
      const languageId = languages.find((l) => l.isoCode.toLowerCase() === iso.toLowerCase())?.id
      if (!languageId) continue
      await this.#db.q
        .updateTable('workspace_document_culture')
        .set((eb) => ({
          published: this.#db.dialect.boolValue(true) as boolean,
          edited: this.#db.dialect.boolValue(false) as boolean,
          published_event_id: eventId,
          published_name: eb.ref('name'),
        }))
        .where('workspace_id', '=', this.#workspace as number)
        .where('node_id', '=', node.id)
        .where('language_id', '=', languageId)
        .execute()
    }
    return this.#load(node)
  }

  /** Unpublishes a page in the workspace only, or the languages named. */
  async #unpublishInWorkspace(
    node: NodeRow,
    cultures: readonly string[] | null,
  ): Promise<DocumentAggregate | undefined> {
    await this.#touch(node)
    const languages = await this.#languages()
    const mandatory = new Set(
      languages.filter((l) => l.isMandatory).map((l) => l.isoCode.toLowerCase()),
    )
    const everything =
      !cultures || cultures.length === 0 || cultures.some((c) => mandatory.has(c.toLowerCase()))
    const isoCodes = everything ? await this.#workspaceCultures(node.id, 'available') : cultures
    for (const iso of isoCodes) {
      const languageId = languages.find((l) => l.isoCode.toLowerCase() === iso.toLowerCase())?.id
      if (!languageId) continue
      await this.#db.q
        .updateTable('workspace_document_culture')
        .set({
          published: this.#db.dialect.boolValue(false) as boolean,
          edited: this.#db.dialect.boolValue(true) as boolean,
        })
        .where('workspace_id', '=', this.#workspace as number)
        .where('node_id', '=', node.id)
        .where('language_id', '=', languageId)
        .execute()
    }
    if (everything || (await this.#workspaceCultures(node.id, 'published')).length === 0)
      await this.#setWorkspaceDocument(node.id, { published: false, edited: true })
    return this.#load(node)
  }

  // ---------------------------------------------------------------- merging (story 380)

  /** Each page the workspace changed or made, with every field as begun, in it, and in Shared now. */
  async workspaceMergePages(): Promise<WorkspacePageMerge[]> {
    const workspace = this.#workspace
    if (workspace === undefined) return []
    const rows = await this.#db.q
      .selectFrom('workspace_document as wd')
      .innerJoin('node as n', 'n.id', 'wd.node_id')
      .select(['wd.node_id', 'n.level'])
      .where('wd.workspace_id', '=', workspace)
      // This kind's only: pages, media or Library items (story 390).
      .where('n.node_object_type', 'in', [
        this.objectType,
        KINDS[this.kind].workspaceObjectType ?? this.objectType,
      ])
      .orderBy('n.level')
      .orderBy('n.id')
      .execute()
    const out: WorkspacePageMerge[] = []
    for (const row of rows) {
      const node = await this.#nodes.byId(Number(row.node_id))
      const wd = node ? await this.#workspaceDocument(node.id) : undefined
      if (node && wd) out.push(await this.#mergePage(node, wd))
    }
    return out
  }

  async #mergePage(node: NodeRow, wd: WorkspaceDocumentRow): Promise<WorkspacePageMerge> {
    const workspace = this.#workspace as number
    const contentTypeNodeId = (await this.#contentTypeNodeId(node.id)) as number
    const propertyTypes = await this.#propertyTypes(contentTypeNodeId)
    const languages = await this.#languages()
    const isoById = new Map(languages.map((l) => [l.id, l.isoCode]))
    type Held = {
      value: unknown
      alias: string
      culture: string | null
      segment: string | null
      environment?: string | null
    }
    const asValues = (rows: readonly ValueRow[]) => {
      const map = new Map<string, Held>()
      // A field's id names its environment only when it has one: shared ids are as before.
      for (const v of this.#valuesFromRows(rows, propertyTypes, languages))
        map.set(
          `${v.alias}|${v.culture ?? ''}|${v.segment ?? ''}${v.environment ? `|${v.environment}` : ''}`,
          {
            value: v.value,
            alias: v.alias,
            culture: v.culture,
            segment: v.segment,
            ...(v.environment ? { environment: v.environment } : {}),
          },
        )
      return map
    }
    const base =
      wd.baseEventId === null
        ? new Map<string, Held>()
        : asValues(await this.#valueRowsAsOf(node.id, { eventId: wd.baseEventId }))
    const mine = asValues(await this.#workspaceView(node.id, wd))
    const theirs = wd.created
      ? new Map<string, Held>()
      : asValues(await this.#currentValueRows(node.id))
    const fields: MergeField[] = []
    for (const field of new Set([...base.keys(), ...mine.keys(), ...theirs.keys()])) {
      const known = mine.get(field) ?? theirs.get(field) ?? base.get(field)
      fields.push({
        field,
        base: wd.created ? undefined : (base.get(field)?.value ?? null),
        mine: mine.get(field)?.value ?? null,
        theirs: wd.created ? undefined : (theirs.get(field)?.value ?? null),
        ...(known
          ? {
              value: {
                alias: known.alias,
                culture: known.culture,
                segment: known.segment,
                ...(known.environment ? { environment: known.environment } : {}),
              },
            }
          : {}),
      })
    }

    // Names and the template: as begun, in the workspace, and in Shared now.
    const eventFacts = async (eventId: number | null | undefined) => {
      if (eventId === null || eventId === undefined) return undefined
      const found = await this.#db.q
        .selectFrom('content_version as cv')
        .innerJoin('document_version as dv', 'dv.id', 'cv.id')
        .leftJoin('node as tn', 'tn.id', 'dv.template_id')
        .select(['cv.text', 'tn.unique_id as template_key'])
        .where('cv.id', '=', eventId)
        .execute()
      const cultureNames = await this.#db.q
        .selectFrom('content_version_culture_variation')
        .select(['language_id', 'name'])
        .where('version_id', '=', eventId)
        .execute()
      return {
        name: String(found[0]?.text ?? ''),
        template: found[0]?.template_key ? normaliseUuid(String(found[0].template_key)) : null,
        cultures: new Map(
          cultureNames.map((c) => [isoById.get(Number(c.language_id)) ?? '', String(c.name ?? '')]),
        ),
      }
    }
    const head = await this.#workspaceHead(node.id)
    const baseFacts = await eventFacts(wd.baseEventId)
    const mineFacts = await eventFacts(head ? Number(head.id) : null)
    const sharedHead = wd.created ? undefined : await this.#headEvent(node.id)
    const theirsFacts = await eventFacts(sharedHead?.id)
    fields.push(
      { field: '@name', base: baseFacts?.name, mine: mineFacts?.name, theirs: theirsFacts?.name },
      {
        field: '@template',
        base: baseFacts?.template,
        mine: mineFacts?.template ?? null,
        theirs: theirsFacts?.template,
      },
    )

    // Per language: names and published state.
    const mineCultures = await this.#db.q
      .selectFrom('workspace_document_culture as wdc')
      .innerJoin('language as l', 'l.id', 'wdc.language_id')
      .select(['l.iso_code', 'wdc.name', 'wdc.published', 'wdc.base_published'])
      .where('wdc.workspace_id', '=', workspace)
      .where('wdc.node_id', '=', node.id)
      .execute()
    const theirsCultures = new Map(
      (
        await this.#db.q
          .selectFrom('document_culture_variation as dcv')
          .innerJoin('language as l', 'l.id', 'dcv.language_id')
          .select(['l.iso_code', 'dcv.name', 'dcv.published'])
          .where('dcv.node_id', '=', node.id)
          .execute()
      ).map((c) => [String(c.iso_code), c]),
    )
    const cultures: WorkspacePageMerge['cultures'] = []
    for (const c of mineCultures) {
      const iso = String(c.iso_code)
      const theirsCulture = theirsCultures.get(iso)
      fields.push({
        field: `@name:${iso}`,
        base: wd.created ? undefined : (baseFacts?.cultures.get(iso) ?? null),
        mine: String(c.name ?? ''),
        theirs: wd.created ? undefined : theirsCulture ? String(theirsCulture.name ?? '') : null,
      })
      cultures.push({
        iso,
        base: c.base_published === null ? null : fromDbBool(c.base_published),
        mine: fromDbBool(c.published),
        theirs: fromDbBool(theirsCulture?.published),
      })
    }
    const document = (
      await this.#db.q
        .selectFrom('document')
        .select(['published', 'edited'])
        .where('node_id', '=', node.id)
        .execute()
    )[0]
    const publishedHere =
      wd.published &&
      wd.publishedEventId !== null &&
      (
        await this.#db.q
          .selectFrom('content_version')
          .select('id')
          .where('id', '=', wd.publishedEventId)
          .where('workspace_id', '=', workspace)
          .execute()
      ).length > 0
    const based = (
      await this.#db.q
        .selectFrom('workspace_document')
        .select('base_published')
        .where('workspace_id', '=', workspace)
        .where('node_id', '=', node.id)
        .execute()
    )[0]
    const parent = node.parentId > 0 ? await this.#nodes.byId(node.parentId) : undefined
    const typeRow = (
      await this.#db.q
        .selectFrom('node')
        .select('unique_id')
        .where('id', '=', contentTypeNodeId)
        .execute()
    )[0]
    return {
      kind: this.kind,
      key: node.key,
      nodeId: node.id,
      made: wd.created,
      level: node.level,
      contentTypeKey: normaliseUuid(String(typeRow?.unique_id)),
      parentKey: parent && parent.id !== SystemNodes.Root ? parent.key : null,
      sharedHead: sharedHead?.id ?? null,
      baseEvent: wd.baseEventId,
      fields,
      published: {
        base:
          based === undefined || based.base_published === null
            ? null
            : fromDbBool(based.base_published),
        mine: wd.published,
        theirs: wd.created ? false : fromDbBool(document?.published),
        here: publishedHere,
        sharedEdited: wd.created ? false : fromDbBool(document?.edited),
      },
      cultures,
    }
  }

  /** Shared's latest event for a page, which a pending change is checked against (story 380). */
  async sharedHeadEvent(nodeId: number): Promise<number | null> {
    return (await this.#headEvent(nodeId))?.id ?? null
  }

  /**
   * Answers a page's conflicts in the workspace (story 380): it begins again from
   * Shared's latest, keeping its own value where the answer is `mine` and taking
   * Shared's where it is `theirs`, so a merge then finds nothing to ask.
   */
  async rebaseWorkspacePage(
    key: string,
    answers: Readonly<Record<string, 'mine' | 'theirs'>>,
  ): Promise<boolean> {
    const workspace = this.#workspace
    if (workspace === undefined) throw new WorkspaceRefusedError('Only a workspace rebases a page.')
    return this.#withTree(() =>
      this.#db.transaction(async (tx) => {
        const repo = this.#child(tx)
        const node = await repo.nodes.byKey(key)
        const wd = node ? await repo.#workspaceDocument(node.id) : undefined
        if (!node || !wd || wd.created) return false
        const merge = await repo.#mergePage(node, wd)
        const head = await repo.#headEvent(node.id)
        await tx.q
          .updateTable('workspace_document')
          .set({ base_event_id: head?.id ?? null })
          .where('workspace_id', '=', workspace)
          .where('node_id', '=', node.id)
          .execute()
        const types = new Map(
          (await repo.#propertyTypes((await repo.#contentTypeNodeId(node.id)) as number)).map(
            (p) => [p.alias, p],
          ),
        )
        const languages = await repo.#languages()
        for (const field of merge.fields) {
          const value = field.value
          if (answers[field.field] !== 'theirs' || !value) continue
          // Taking Shared's: the workspace's own rows for the field go, so it reads Shared's.
          const type = types.get(value.alias)
          if (!type) continue
          const languageId = value.culture
            ? (languages.find((l) => l.isoCode.toLowerCase() === value.culture?.toLowerCase())
                ?.id ?? null)
            : null
          await tx.q
            .deleteFrom('property_value')
            .where('workspace_id', '=', workspace)
            .where('node_id', '=', node.id)
            .where('property_type_id', '=', type.id)
            .where('language_id', languageId === null ? 'is' : '=', languageId)
            .where('segment', value.segment === null ? 'is' : '=', value.segment)
            .where(
              'environment',
              value.environment ? '=' : 'is',
              (value.environment ?? null) as string,
            )
            .execute()
        }
        // A language's name taken from Shared is the workspace's for that language now.
        for (const field of merge.fields) {
          if (!field.field.startsWith('@name:') || answers[field.field] !== 'theirs') continue
          const language = languages.find(
            (l) => l.isoCode.toLowerCase() === field.field.slice(6).toLowerCase(),
          )
          if (!language) continue
          await tx.q
            .updateTable('workspace_document_culture')
            .set({ name: String(field.theirs ?? '') })
            .where('workspace_id', '=', workspace)
            .where('node_id', '=', node.id)
            .where('language_id', '=', language.id)
            .execute()
        }
        const name = answers['@name'] === 'theirs'
        const template = answers['@template'] === 'theirs'
        if ((name || template) && head) {
          const mineHead = await repo.#workspaceHead(node.id)
          await repo.#insertWorkspaceEvent(
            node.id,
            'save',
            name ? head.name : String(mineHead?.text ?? head.name),
            undefined,
            template
              ? head.templateId
              : mineHead?.template_id === null || mineHead?.template_id === undefined
                ? null
                : Number(mineHead.template_id),
          )
        }
        return true
      }),
    )
  }

  /**
   * A page made in a workspace becomes Shared's (story 380): its node is a
   * document of the site's again, and the workspace's own rows for it go, the
   * merge writing it as a Shared save next. Called inside the merge.
   */
  /** Whether a page is of a type only its workspace has (story 376). */
  async madeOfWorkspaceType(nodeId: number): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .select('ct.workspace_id')
      .where('c.node_id', '=', nodeId)
      .execute()
    return rows[0]?.workspace_id !== null && rows[0]?.workspace_id !== undefined
  }

  async adoptWorkspacePage(nodeId: number): Promise<void> {
    // A page of a type made in the workspace takes Shared's type of that key, which
    // the merge's files have just made (story 376).
    const type = (
      await this.#db.q
        .selectFrom('content as c')
        .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
        .select('ct.origin_key')
        .where('c.node_id', '=', nodeId)
        .where('ct.workspace_id', 'is not', null)
        .execute()
    )[0]
    if (type?.origin_key) {
      const shared = await this.#nodes.byKey(String(type.origin_key))
      if (shared)
        await this.#db.q
          .updateTable('content')
          .set({ content_type_id: shared.id })
          .where('node_id', '=', nodeId)
          .execute()
    }
    const versions = () =>
      this.#db.q
        .selectFrom('content_version')
        .select('id')
        .where('node_id', '=', nodeId)
        .where('workspace_id', 'is not', null)
    await this.#db.q
      .deleteFrom('property_value')
      .where('node_id', '=', nodeId)
      .where('workspace_id', 'is not', null)
      .execute()
    await this.#db.q
      .deleteFrom('content_version_culture_variation')
      .where('version_id', 'in', versions())
      .execute()
    await this.#db.q.deleteFrom('document_version').where('id', 'in', versions()).execute()
    await this.#db.q
      .deleteFrom('content_version')
      .where('node_id', '=', nodeId)
      .where('workspace_id', 'is not', null)
      .execute()
    for (const table of ['workspace_document_culture', 'workspace_document'] as const)
      await this.#db.q.deleteFrom(table).where('node_id', '=', nodeId).execute()
    await this.#db.q
      .updateTable('node')
      .set({ node_object_type: this.objectType, workspace_id: null })
      .where('id', '=', nodeId)
      .execute()
  }

  /**
   * Records a move, reorder or delete of a Shared page, to be done at merge, with
   * where the page stood then, so the merge can tell what Shared did since (story
   * 380). The latest of a kind stands for the page.
   */
  async #recordPending(
    node: NodeRow,
    kind: 'move' | 'sort' | 'trash' | 'delete',
    change: { targetParentId?: number | null; sortOrder?: number | null; userId?: number } = {},
  ): Promise<void> {
    const workspace = this.#workspace as number
    await this.#db.q
      .deleteFrom('workspace_pending')
      .where('workspace_id', '=', workspace)
      .where('node_id', '=', node.id)
      .where('kind', '=', kind)
      .execute()
    await this.#db.q
      .insertInto('workspace_pending')
      .values({
        workspace_id: workspace,
        node_id: node.id,
        kind,
        target_parent_id: change.targetParentId ?? null,
        sort_order: change.sortOrder ?? null,
        user_id: change.userId ?? null,
        recorded_at: DbDate.toDb(new Date()),
        base_parent_id: node.parentId,
        base_sort_order: node.sortOrder,
        base_event_id: (await this.#headEvent(node.id))?.id ?? null,
        name: node.text,
      })
      .execute()
  }

  // ---------------------------------------------------------------- reads

  async byKey(key: string): Promise<DocumentAggregate | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node || !this.sees(node)) return undefined
    return this.#load(node)
  }

  async load(node: NodeRow): Promise<DocumentAggregate | undefined> {
    return this.#load(node)
  }

  /** A page of children, leaving out `excludeKeys` from the page and the total alike. */
  async children(
    parentKey: string | null,
    skip: number,
    take: number,
    excludeKeys: readonly string[] = [],
  ): Promise<Page<NodeRow>> {
    const parentId = parentKey ? (await this.#nodes.byKey(parentKey))?.id : SystemNodes.Root
    if (parentId === undefined) return { total: 0, items: [] }
    return this.#nodes.children(
      parentId,
      this.objectType,
      skip,
      take,
      false,
      excludeKeys,
      this.#workspace,
    )
  }

  /** The recycle bin's tree: trashed documents, top level being what was trashed directly. */
  async trashed(parentKey: string | null, skip: number, take: number): Promise<Page<NodeRow>> {
    const parentId = parentKey ? (await this.#nodes.byKey(parentKey))?.id : this.#recycleBin
    if (parentId === undefined) return { total: 0, items: [] }
    return this.#nodes.children(parentId, this.objectType, skip, take, true)
  }

  siblings(key: string, before: number, after: number) {
    return this.#nodes.siblings(key, this.objectType, before, after)
  }

  async search(
    query: string,
    options: { trashed?: boolean; parentKey?: string | null; skip: number; take: number },
  ): Promise<Page<NodeRow>> {
    const parentId = options.parentKey
      ? (await this.#nodes.byKey(options.parentKey))?.id
      : undefined
    if (options.parentKey && parentId === undefined) return { total: 0, items: [] }
    return this.#nodes.search(this.objectType, query, {
      ...options,
      parentId,
      fullText: this.kind === 'document' || this.kind === 'media',
    })
  }

  async versions(key: string): Promise<DocumentVersionSummary[]> {
    const node = await this.#nodes.byKey(key)
    if (!node) return []
    const rows = await this.#db.q
      .selectFrom('content_version as cv')
      .innerJoin('document_version as dv', 'dv.id', 'cv.id')
      .leftJoin('user_account as u', 'u.id', 'cv.user_id')
      .select([
        'cv.id',
        'cv.kind',
        'cv.version_date',
        'cv.current',
        'cv.prevent_cleanup',
        'dv.published',
        'u.key as user_key',
      ])
      .where('cv.node_id', '=', node.id)
      .where('cv.workspace_id', 'is', null)
      .orderBy('cv.id', 'desc')
      .execute()
    return rows.map((row) => ({
      id: String(row.id),
      documentKey: node.key,
      versionDate: DbDate.fromDb(row.version_date) ?? new Date(0),
      isCurrentDraft: fromDbBool(row.current),
      isCurrentPublished: fromDbBool(row.published),
      preventCleanup: fromDbBool(row.prevent_cleanup),
      userKey: row.user_key ? normaliseUuid(String(row.user_key)) : null,
      culture: null,
      kind: String(row.kind) as EventKind,
    }))
  }

  /**
   * Every published document with the values of its published version, for the
   * published cache. A node reads as-of its own schema state, so a conversion
   * appended by a newer deployment is invisible to it.
   */
  /** Every published node of this kind, for the published cache. Elements too. */
  async loadPublished(asOfSchemaStateId?: number): Promise<PublishedNodeRow[]> {
    if (this.#workspace !== undefined) return this.#workspacePublished(asOfSchemaStateId)
    const t = this.#db.dialect.boolValue(true) as boolean
    const f = this.#db.dialect.boolValue(false) as boolean
    const rows = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .innerJoin('document as d', 'd.node_id', 'n.id')
      .innerJoin('content_version as cv', 'cv.node_id', 'n.id')
      .innerJoin('document_version as dv', (join) =>
        join.onRef('dv.id', '=', 'cv.id').on('dv.published', '=', t),
      )
      .leftJoin('template as tpl', 'tpl.node_id', 'dv.template_id')
      .select([
        'n.id',
        'n.unique_id',
        'n.parent_id',
        'n.level',
        'n.path',
        'n.sort_order',
        'n.create_date',
        'cv.id as event_id',
        'cv.text as name',
        'cv.version_date',
        'ct.alias as content_type_alias',
        'c.content_type_id',
        'tpl.alias as template_alias',
      ])
      .where('d.published', '=', t)
      .where('n.trashed', '=', f)
      .where('n.node_object_type', '=', this.objectType)
      .orderBy('n.level')
      .orderBy('n.sort_order')
      .orderBy('n.id')
      .execute()
    const languages = await this.#languages()
    // Read in slices rather than per node: a large site is tens of thousands
    // of nodes, and a query each is most of a rebuild's time.
    const typesById = new Map<number, PropertyTypeRow[]>()
    const culturesById = new Map<number, PublishedCulture[]>()
    const historyById = new Map<number, ValueRow[]>()
    for (const slice of slices(rows.map((row) => Number(row.id)))) {
      // SQLite reads without giving the thread up: let waiting requests in.
      await giveWay()
      for (const [id, cultures] of await this.#publishedCultureEventsFor(slice))
        culturesById.set(id, cultures)
      for (const [id, history] of await this.#valueHistoryFor(slice, asOfSchemaStateId))
        historyById.set(id, history)
    }
    const published: PublishedNodeRow[] = []
    for (const [index, row] of rows.entries()) {
      if (index % 250 === 0) await giveWay()
      const typeId = Number(row.content_type_id)
      if (!typesById.has(typeId))
        // A pending property is never rendered, even if a template asks for it.
        typesById.set(
          typeId,
          (await this.#propertyTypes(typeId)).filter((p) => !p.pending),
        )
      const propertyTypes = typesById.get(typeId) as PropertyTypeRow[]
      const cultures = culturesById.get(Number(row.id)) ?? []
      const latest = Math.max(Number(row.event_id), ...cultures.map((c) => c.eventId))
      const history = (historyById.get(Number(row.id)) ?? []).filter((v) => v.eventId <= latest)
      const values = this.#valuesFromRows(
        publishedValueRows(history, Number(row.event_id), cultures),
        propertyTypes,
        languages,
      )
      published.push({
        id: Number(row.id),
        key: normaliseUuid(String(row.unique_id)),
        parentId: Number(row.parent_id),
        level: Number(row.level),
        path: String(row.path),
        sortOrder: Number(row.sort_order),
        name: String(row.name ?? ''),
        contentTypeAlias: String(row.content_type_alias),
        componentAlias: (row.template_alias as string | null) ?? null,
        createDate: DbDate.fromDb(row.create_date) ?? new Date(),
        updateDate: DbDate.fromDb(row.version_date) ?? new Date(),
        cultures: cultures.map((c) => c.isoCode),
        names: Object.fromEntries(cultures.map((c) => [c.isoCode, c.name])),
        values,
      })
    }
    return published
  }

  /**
   * The site as a workspace has it published (story 379): Shared's published
   * pages, with each page the workspace changed as it has it. One it published is
   * its own published version; one it changed but did not publish is as Shared
   * had it published when the workspace first changed it; one it took down, or
   * that was not published when it began, is not there; and one it made and
   * published is added. Its moves and deletes wait for the merge.
   */
  async #workspacePublished(asOfSchemaStateId?: number): Promise<PublishedNodeRow[]> {
    const workspace = this.#workspace as number
    const shared = await this.inWorkspace(undefined).loadPublished(asOfSchemaStateId)
    const byId = new Map(shared.map((row) => [row.id, row]))
    const touched = await this.#db.q
      .selectFrom('workspace_document')
      .select('node_id')
      .where('workspace_id', '=', workspace)
      .execute()
    for (const { node_id } of touched) {
      const node = await this.#nodes.byId(Number(node_id))
      const wd = node ? await this.#workspaceDocument(node.id) : undefined
      if (!node || !wd || node.trashed) continue
      const row = wd.published ? await this.#workspacePublishedRow(node, wd) : undefined
      if (row) byId.set(node.id, row)
      else byId.delete(node.id)
    }
    return [...byId.values()].sort(
      (a, b) => a.level - b.level || a.sortOrder - b.sortOrder || a.id - b.id,
    )
  }

  /** One page as the workspace has it published: its own version, or Shared's as it began. */
  async #workspacePublishedRow(
    node: NodeRow,
    wd: WorkspaceDocumentRow,
  ): Promise<PublishedNodeRow | undefined> {
    const workspace = this.#workspace as number
    const eventId = wd.publishedEventId
    if (eventId === null) return undefined
    const event = (
      await this.#db.q
        .selectFrom('content_version as cv')
        .innerJoin('document_version as dv', 'dv.id', 'cv.id')
        .leftJoin('template as tpl', 'tpl.node_id', 'dv.template_id')
        .select(['cv.text', 'cv.version_date', 'cv.workspace_id', 'tpl.alias as template_alias'])
        .where('cv.id', '=', eventId)
        .execute()
    )[0]
    if (!event) return undefined
    const own = event.workspace_id !== null && Number(event.workspace_id) === workspace
    const contentTypeNodeId = (await this.#contentTypeNodeId(node.id)) as number
    const propertyTypes = (await this.#propertyTypes(contentTypeNodeId)).filter((p) => !p.pending)
    const languages = await this.#languages()
    const rows = own
      ? await this.#workspaceView(node.id, wd, eventId)
      : await this.#valueRowsAsOf(node.id, { eventId })
    const typeRows = await this.#db.q
      .selectFrom('content_type')
      .select('alias')
      .where('node_id', '=', await this.#readTypeNodeId(contentTypeNodeId))
      .execute()
    const cultures = await this.#db.q
      .selectFrom('workspace_document_culture as wdc')
      .innerJoin('language as l', 'l.id', 'wdc.language_id')
      .select(['l.iso_code', 'wdc.name', 'wdc.published'])
      .where('wdc.workspace_id', '=', workspace)
      .where('wdc.node_id', '=', node.id)
      .execute()
    const live = cultures.filter((c) => fromDbBool(c.published))
    return {
      id: node.id,
      key: node.key,
      parentId: node.parentId,
      level: node.level,
      path: node.path,
      sortOrder: node.sortOrder,
      name: String(event.text ?? node.text ?? ''),
      contentTypeAlias: String(typeRows[0]?.alias ?? ''),
      componentAlias: (event.template_alias as string | null) ?? null,
      createDate: node.createDate ?? new Date(),
      updateDate: DbDate.fromDb(event.version_date) ?? new Date(),
      cultures: live.map((c) => String(c.iso_code)),
      names: Object.fromEntries(live.map((c) => [String(c.iso_code), String(c.name ?? '')])),
      values: this.#valuesFromRows(rows, propertyTypes, languages),
    }
  }

  /**
   * The nodes of this kind not in the bin, with the values an editor sees now:
   * what media is read as, having no publish. Without a filter every one, read
   * in slices like `loadPublished`; with one, only the nodes it names — by key,
   * id or (media) file address — through indexed lookups, in the order asked.
   */
  async loadCurrent(filter?: CurrentFilter): Promise<CurrentNodeRow[]> {
    const t = this.#db.dialect.boolValue(true) as boolean
    const select = this.#db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .innerJoin('content_version as head', (join) =>
        join.onRef('head.node_id', '=', 'n.id').on('head.current', '=', t),
      )
      .select([
        'n.id',
        'n.unique_id',
        'n.text',
        'n.parent_id',
        'n.path',
        'n.sort_order',
        'n.create_date',
        'head.text as draft_name',
        'head.version_date',
        'ct.alias as content_type_alias',
        'c.content_type_id',
        'c.read_policy',
        'c.write_policy',
        'c.creator_member_key',
        'c.file_url',
      ])
      .where('n.node_object_type', '=', this.objectType)
      .where('n.trashed', '=', this.#db.dialect.boolValue(false) as boolean)
    let rows: Awaited<ReturnType<typeof select.execute>>
    if (!filter)
      rows = await select.orderBy('n.level').orderBy('n.sort_order').orderBy('n.id').execute()
    else {
      const [column, wanted] =
        filter.keys !== undefined
          ? ['n.unique_id', [...new Set(filter.keys.map(normaliseUuid))]]
          : filter.ids !== undefined
            ? ['n.id', [...new Set(filter.ids)]]
            : ['c.file_url', [...new Set(filter.urls ?? [])]]
      rows = []
      for (const slice of slices<string | number>(wanted))
        rows.push(...(await select.where(sql.ref(column), 'in', slice).execute()))
      const order = new Map(wanted.map((value, index) => [String(value), index]))
      const at = (row: (typeof rows)[number]) =>
        order.get(
          column === 'n.unique_id'
            ? normaliseUuid(String(row.unique_id))
            : column === 'n.id'
              ? String(Number(row.id))
              : String(row.file_url),
        ) ?? 0
      rows.sort((a, b) => at(a) - at(b) || Number(a.id) - Number(b.id))
    }
    const languages = await this.#languages()
    const typesById = new Map<number, PropertyTypeRow[]>()
    const rowsById = await this.#currentValueRowsFor(rows.map((row) => Number(row.id)))
    const out: CurrentNodeRow[] = []
    for (const row of rows) {
      const typeId = Number(row.content_type_id)
      if (!typesById.has(typeId)) typesById.set(typeId, await this.#propertyTypes(typeId))
      const propertyTypes = typesById.get(typeId) as PropertyTypeRow[]
      out.push({
        id: Number(row.id),
        key: normaliseUuid(String(row.unique_id)),
        name: String(row.draft_name ?? row.text ?? ''),
        contentTypeAlias: String(row.content_type_alias),
        parentId: Number(row.parent_id),
        path: String(row.path),
        sortOrder: Number(row.sort_order),
        createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
        updateDate:
          DbDate.fromDb(row.version_date) ?? DbDate.fromDb(row.create_date) ?? new Date(0),
        access: {
          readPolicy: parseMediaPolicy(row.read_policy),
          writePolicy: parseMediaPolicy(row.write_policy),
          creatorMemberKey: row.creator_member_key
            ? normaliseUuid(String(row.creator_member_key))
            : null,
        },
        values:
          propertyTypes.length === 0
            ? []
            : this.#valuesFromRows(rowsById.get(Number(row.id)) ?? [], propertyTypes, languages),
      })
    }
    return out
  }

  /**
   * The values an editor sees now, per node: the current ones, or, on a node
   * reading an older schema state, the latest at or before it. Read in slices.
   */
  async #currentValueRowsFor(ids: number[]): Promise<Map<number, ValueRow[]>> {
    const t = this.#db.dialect.boolValue(true) as boolean
    const stateId = await visibleStateIdFor(this.#db, this.#nodeState)
    const rowsById = new Map<number, ValueRow[]>()
    for (const slice of slices(ids)) {
      if (stateId === undefined) {
        const current = await this.#db.q
          .selectFrom('property_value')
          .select([
            'id',
            'node_id',
            'event_id',
            'property_type_id',
            'language_id',
            'segment',
            'environment',
            'int_value',
            'decimal_value',
            'date_value',
            'varchar_value',
            'text_value',
          ])
          .where('node_id', 'in', slice)
          .where('is_current', '=', t)
          .execute()
        for (const row of current) {
          const id = Number(row.node_id)
          rowsById.set(id, [...(rowsById.get(id) ?? []), this.#toValueRow(row)])
        }
      } else {
        // As of the state this node reads: the latest value per key at or before it.
        for (const [id, history] of await this.#valueHistoryFor(slice, stateId)) {
          const latest = new Map<string, ValueRow>()
          for (const row of history)
            latest.set(keyOf(row.propertyTypeId, row.languageId, row.segment, row.environment), row)
          rowsById.set(id, [...latest.values()])
        }
      }
    }
    return rowsById
  }

  /**
   * Every document not in the bin as an editor last saved it, published or not,
   * in the published cache's shape: the draft cache behind previewing in an app
   * (story 053). A culture is there once it has a name.
   */
  async loadDrafts(): Promise<PublishedNodeRow[]> {
    const t = this.#db.dialect.boolValue(true) as boolean
    const rows = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .innerJoin('content_version as head', (join) =>
        join.onRef('head.node_id', '=', 'n.id').on('head.current', '=', t),
      )
      .innerJoin('document_version as hv', 'hv.id', 'head.id')
      .leftJoin('template as tpl', 'tpl.node_id', 'hv.template_id')
      .select([
        'n.id',
        'n.unique_id',
        'n.parent_id',
        'n.level',
        'n.path',
        'n.sort_order',
        'n.create_date',
        'n.text',
        'head.text as draft_name',
        'head.version_date',
        'ct.alias as content_type_alias',
        'c.content_type_id',
        'tpl.alias as template_alias',
      ])
      .where('n.node_object_type', '=', this.objectType)
      .where('n.trashed', '=', this.#db.dialect.boolValue(false) as boolean)
      .orderBy('n.level')
      .orderBy('n.sort_order')
      .orderBy('n.id')
      .execute()
    const ids = rows.map((row) => Number(row.id))
    const languages = await this.#languages()
    const valuesById = await this.#currentValueRowsFor(ids)
    const culturesById = new Map<number, Array<{ isoCode: string; name: string }>>()
    for (const slice of slices(ids)) {
      const cultureRows = await this.#db.q
        .selectFrom('document_culture_variation as dcv')
        .innerJoin('language as l', 'l.id', 'dcv.language_id')
        .select(['dcv.node_id', 'dcv.name', 'l.iso_code'])
        .where('dcv.node_id', 'in', slice)
        .where('dcv.available', '=', t)
        .execute()
      for (const row of cultureRows) {
        const id = Number(row.node_id)
        culturesById.set(id, [
          ...(culturesById.get(id) ?? []),
          { isoCode: String(row.iso_code), name: String(row.name ?? '') },
        ])
      }
    }
    const typesById = new Map<number, PropertyTypeRow[]>()
    const drafts: PublishedNodeRow[] = []
    for (const row of rows) {
      const typeId = Number(row.content_type_id)
      if (!typesById.has(typeId))
        // A pending property is never rendered, in a preview no more than on the site.
        typesById.set(
          typeId,
          (await this.#propertyTypes(typeId)).filter((p) => !p.pending),
        )
      const cultures = culturesById.get(Number(row.id)) ?? []
      drafts.push({
        id: Number(row.id),
        key: normaliseUuid(String(row.unique_id)),
        parentId: Number(row.parent_id),
        level: Number(row.level),
        path: String(row.path),
        sortOrder: Number(row.sort_order),
        name: String(row.draft_name ?? row.text ?? ''),
        contentTypeAlias: String(row.content_type_alias),
        componentAlias: (row.template_alias as string | null) ?? null,
        createDate: DbDate.fromDb(row.create_date) ?? new Date(),
        updateDate: DbDate.fromDb(row.version_date) ?? DbDate.fromDb(row.create_date) ?? new Date(),
        cultures: cultures.map((c) => c.isoCode),
        names: Object.fromEntries(cultures.map((c) => [c.isoCode, c.name])),
        values: this.#valuesFromRows(
          valuesById.get(Number(row.id)) ?? [],
          typesById.get(typeId) as PropertyTypeRow[],
          languages,
        ),
      })
    }
    return drafts
  }

  // --------------------------------------------------------------- writes

  /** Creates a document with its first save event. Under the content-tree lock so sibling sort orders cannot race. */
  async create(input: SaveDocumentInput): Promise<DocumentAggregate> {
    return this.#withTree(async () =>
      this.#db.transaction(async (tx) => {
        const repo = this.#child(tx)
        const state = await assertNodeMayWrite(tx, this.#nodeState)
        const contentTypeNode =
          (await repo.nodes.byKey(input.contentTypeKey)) ??
          (await repo.#workspaceTypeNode(input.contentTypeKey))
        if (!contentTypeNode) throw new Error(`Unknown content type '${input.contentTypeKey}'.`)

        const parent = input.parentKey ? await repo.nodes.byKey(input.parentKey) : undefined
        if (input.parentKey && !parent)
          throw new InvalidParentError('The parent could not be found.')
        if (parent?.trashed) throw new InvalidParentError('The parent is in the recycle bin.')
        const workspace = this.#workspace
        if (workspace !== undefined && !KINDS[this.kind].workspaceObjectType)
          throw new WorkspaceRefusedError('This is made in Shared only.')
        if (parent && workspace !== undefined && !repo.sees(parent))
          throw new InvalidParentError('The parent could not be found.')
        const parentId = parent?.id ?? SystemNodes.Root
        const name = input.variants[0]?.name ?? ''
        const node = await repo.nodes.create({
          key: input.key,
          parentId,
          // A page made in a workspace is its own until it is merged (story 375).
          objectType:
            workspace === undefined
              ? this.objectType
              : (KINDS[this.kind].workspaceObjectType as string),
          ...(workspace === undefined ? {} : { workspaceId: workspace }),
          text: name,
          userId: input.userId,
          // A media folder comes before the files beside it in the tree (story 246).
          treeGroup:
            this.objectType === ObjectTypes.Media &&
            normaliseUuid(input.contentTypeKey) === SYSTEM_MEDIA_TYPE_KEYS.Folder
              ? TREE_GROUP_FOLDER
              : TREE_GROUP_ITEM,
        })

        await tx.q
          .insertInto('content')
          .values({ node_id: node.id, content_type_id: contentTypeNode.id })
          .execute()
        await tx.q
          .insertInto('document')
          .values({
            node_id: node.id,
            published: tx.dialect.boolValue(false) as boolean,
            edited: tx.dialect.boolValue(true) as boolean,
          })
          .execute()

        const templateId = input.componentKey
          ? ((await repo.nodes.byKey(input.componentKey))?.id ?? null)
          : null
        if (workspace !== undefined) {
          const f = tx.dialect.boolValue(false) as boolean
          await tx.q
            .insertInto('workspace_document')
            .values({
              workspace_id: workspace,
              node_id: node.id,
              base_event_id: null,
              created: tx.dialect.boolValue(true) as boolean,
              published: f,
              published_event_id: null,
              edited: tx.dialect.boolValue(true) as boolean,
            })
            .execute()
          const eventId = await repo.#insertWorkspaceEvent(
            node.id,
            'save',
            name,
            input.userId,
            templateId,
          )
          await repo.#appendValues(node.id, eventId, state, contentTypeNode.id, input.values)
          await repo.#writeWorkspaceCultures(node.id, eventId, input.variants)
          const made = await repo.#load({ ...node, text: name })
          if (!made) throw new Error('Document could not be read back after creation.')
          return made
        }
        const eventId = await repo.#insertEvent(
          node.id,
          'save',
          name,
          input.userId,
          templateId,
          false,
        )
        await repo.#appendValues(node.id, eventId, state, contentTypeNode.id, input.values)
        await repo.#writeCultureVariations(node.id, eventId, input.variants)

        const created = await repo.#load({ ...node, text: name })
        if (!created) throw new Error('Document could not be read back after creation.')
        await recordFiles(tx, this.kind, node.id, created)
        return created
      }),
    )
  }

  /** Documents of these types (by content type node id), trashed ones excluded. */
  async documentsOfTypes(contentTypeNodeIds: readonly number[]): Promise<
    Array<{
      key: string
      nodeId: number
      name: string
      contentTypeNodeId: number
      published: boolean
    }>
  > {
    if (contentTypeNodeIds.length === 0) return []
    const rows = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('node as n', 'n.id', 'c.node_id')
      .innerJoin('document as d', 'd.node_id', 'n.id')
      .select(['n.id', 'n.unique_id', 'n.text', 'c.content_type_id', 'd.published'])
      .where('c.content_type_id', 'in', contentTypeNodeIds)
      .where('n.trashed', '=', this.#db.dialect.boolValue(false) as boolean)
      .orderBy('n.path')
      .execute()
    return rows.map((row) => ({
      key: normaliseUuid(String(row.unique_id)),
      nodeId: Number(row.id),
      name: String(row.text ?? ''),
      contentTypeNodeId: Number(row.content_type_id),
      published: fromDbBool(row.published),
    }))
  }

  /**
   * Current values of the named properties, retired ones included: the check
   * and the fix read what the editor no longer shows. Each carries the state
   * that wrote it and the event it belongs to.
   */
  async currentValuesByAlias(nodeId: number, aliases: readonly string[]): Promise<CurrentValue[]> {
    if (aliases.length === 0) return []
    const languages = await this.#languages()
    const isoById = new Map(languages.map((l) => [l.id, l.isoCode]))
    const rows = await this.#db.q
      .selectFrom('property_value as pv')
      .innerJoin('property_type as p', 'p.id', 'pv.property_type_id')
      .innerJoin('data_type as d', 'd.node_id', 'p.data_type_id')
      .select([
        'pv.id',
        'pv.event_id',
        'pv.schema_state_id',
        'pv.language_id',
        'pv.segment',
        'pv.environment',
        'pv.int_value',
        'pv.decimal_value',
        'pv.date_value',
        'pv.varchar_value',
        'pv.text_value',
        'p.alias',
        'd.db_type',
      ])
      .where('pv.node_id', '=', nodeId)
      .where('pv.is_current', '=', this.#db.dialect.boolValue(true) as boolean)
      .where('p.alias', 'in', aliases)
      .execute()
    const out: CurrentValue[] = []
    for (const row of rows) {
      const storage = String(row.db_type) as ValueStorageTypeName
      const value = this.#fromStorage(
        (row as Record<string, unknown>)[STORAGE_COLUMN[storage]],
        storage,
      )
      out.push({
        rowId: Number(row.id),
        eventId: Number(row.event_id),
        schemaStateId: Number(row.schema_state_id),
        alias: String(row.alias),
        culture: row.language_id === null ? null : (isoById.get(Number(row.language_id)) ?? null),
        segment: (row.segment as string | null) ?? null,
        environment: (row.environment as string | null) ?? null,
        value,
      })
    }
    return out
  }

  /**
   * Appends values under an explicit schema state — the upgrade tool's write.
   * Each value joins the event of the row it converts (so a published version
   * keeps reading as one), or the document's published event, or its head.
   * Not gated: the tool runs from the newer artifact by definition.
   */
  async appendUnderState(
    key: string,
    values: readonly MigratedValue[],
    options: { schemaStateId: number; userId?: number },
  ): Promise<boolean> {
    return this.#withTree(() => this.#appendUnderState(key, values, options))
  }

  async #appendUnderState(
    key: string,
    values: readonly MigratedValue[],
    options: { schemaStateId: number; userId?: number },
  ): Promise<boolean> {
    return this.#db.transaction(async (tx) => {
      const repo = this.#child(tx)
      const node = await repo.nodes.byKey(key)
      if (!node) return false
      const contentTypeNodeId = await repo.#contentTypeNodeId(node.id)
      if (!contentTypeNodeId) return false
      const propertyTypes = await repo.#propertyTypes(contentTypeNodeId)
      const byAlias = new Map(propertyTypes.map((p) => [p.alias, p]))
      const languages = await repo.#languages()
      const idByIso = new Map(languages.map((l) => [l.isoCode.toLowerCase(), l.id]))
      const current = new Map(
        (await repo.#currentValueRows(node.id)).map((row) => [
          keyOf(row.propertyTypeId, row.languageId, row.segment, row.environment),
          row,
        ]),
      )
      const head = await repo.#headEvent(node.id)
      const published = await tx.q
        .selectFrom('content_version as cv')
        .innerJoin('document_version as dv', (join) =>
          join
            .onRef('dv.id', '=', 'cv.id')
            .on('dv.published', '=', tx.dialect.boolValue(true) as boolean),
        )
        .select('cv.id')
        .where('cv.node_id', '=', node.id)
        .orderBy('cv.id', 'desc')
        .limit(1)
        .execute()
      const fallbackEvent = Number(published[0]?.id ?? head?.id ?? 0)
      let written = false
      for (const value of values) {
        const propertyType = byAlias.get(value.alias)
        if (!propertyType) continue
        const culture = propertyType.variesByCulture ? value.culture : null
        const languageId = culture ? (idByIso.get(culture.toLowerCase()) ?? null) : null
        const existing = current.get(
          keyOf(propertyType.id, languageId, value.segment ?? null, value.environment ?? null),
        )
        const eventId = value.eventId ?? existing?.eventId ?? fallbackEvent
        await repo.#insertValue(
          node.id,
          eventId,
          options.schemaStateId,
          value.storage ? { ...propertyType, storage: value.storage } : propertyType,
          languageId,
          value.segment ?? null,
          value.environment ?? null,
          value.value,
          existing?.id,
        )
        written = true
      }
      if (written) {
        await repo.#recomputeEdited(node.id)
        await queueForSearch(tx, [node.id])
      }
      return written
    })
  }

  /** Saves the draft: one save event, and a new value version for each value that changed. */
  async update(input: SaveDocumentInput): Promise<DocumentAggregate | undefined> {
    return this.#withTree(() => this.#update(input))
  }

  async #update(input: SaveDocumentInput): Promise<DocumentAggregate | undefined> {
    return this.#db.transaction(async (tx) => {
      const repo = this.#child(tx)
      const state = await assertNodeMayWrite(tx, this.#nodeState)
      const node = await repo.nodes.byKey(input.key)
      if (!node || !repo.sees(node)) return undefined
      await repo.#assertRevision(node.id, input.expectedRevision)
      const contentTypeNodeId = await repo.#contentTypeNodeId(node.id)
      if (!contentTypeNodeId) return undefined

      const name = input.variants[0]?.name ?? node.text ?? ''
      const templateId = input.componentKey
        ? ((await repo.nodes.byKey(input.componentKey))?.id ?? null)
        : null
      if (repo.#workspace !== undefined) {
        // Shared's node, its tree name and its files are untouched until a merge.
        await repo.#touch(node)
        const eventId = await repo.#insertWorkspaceEvent(
          node.id,
          'save',
          name,
          input.userId,
          templateId,
        )
        await repo.#appendValues(node.id, eventId, state, contentTypeNodeId, input.values)
        await repo.#writeWorkspaceCultures(node.id, eventId, input.variants)
        await repo.#setWorkspaceDocument(node.id, { edited: true })
        return repo.#load(node)
      }
      await repo.nodes.rename(node.id, name)
      const eventId = await repo.#insertEvent(
        node.id,
        'save',
        name,
        input.userId,
        templateId,
        false,
      )

      await repo.#appendValues(node.id, eventId, state, contentTypeNodeId, input.values)
      await repo.#writeCultureVariations(node.id, eventId, input.variants)
      await repo.#recomputeEdited(node.id)
      const saved = await repo.#load({ ...node, text: name })
      if (saved) await recordFiles(tx, this.kind, node.id, saved)
      return saved
    })
  }

  /**
   * Publish is an event and a pointer; nothing is copied. For a document that
   * varies by culture, each culture published points at this event, and the
   * others keep pointing at the event they were last published with, so their
   * newer drafts stay unpublished. Every mandatory language must end up
   * published, as Umbraco requires.
   */
  async publish(
    key: string,
    cultures: readonly string[] | null,
    /**
     * `expectedHead` is the event an approval was given for: a publish of
     * anything later is refused, while an upgrade's value rewrite is not.
     */
    options: { expectedRevision?: string; expectedHead?: number } = {},
  ): Promise<DocumentAggregate | undefined> {
    return this.#withTree(async () =>
      this.#db.transaction(async (tx) => {
        const repo = this.#child(tx)
        await assertNodeMayWrite(tx, this.#nodeState)
        const node = await repo.nodes.byKey(key)
        if (!node || !repo.sees(node)) return undefined
        await repo.#assertRevision(node.id, options.expectedRevision)
        if (repo.#workspace !== undefined) return repo.#publishInWorkspace(node, cultures)
        if (options.expectedHead !== undefined) {
          const head = (await repo.#headEvent(node.id))?.id
          if (head !== options.expectedHead)
            throw new StaleRevisionError(String(options.expectedHead), String(head))
        }
        // The bin is not a document, so the ancestor check below passes for a
        // node trashed directly; Umbraco refuses it as FailedPublishIsTrashed.
        if (node.trashed) throw new PublishBlockedError('The document is in the recycle bin.')
        // An unpublished ancestor makes a published descendant unreachable, so
        // Umbraco refuses the publish rather than creating a dead route.
        if (!(await repo.#ancestorsPublished(node)))
          throw new PublishBlockedError('An ancestor is not published.')

        const variant = await repo.#variesByCulture(node.id)
        const available = variant ? await repo.#availableCultures(node.id) : []
        const targets = variant
          ? cultures && cultures.length > 0
            ? [...cultures]
            : available
          : null
        if (targets) {
          const missing = targets.filter(
            (c) => !available.some((a) => a.toLowerCase() === c.toLowerCase()),
          )
          if (missing.length > 0)
            throw new PublishBlockedError(
              `The document has no ${missing.join(', ')} variant to publish.`,
            )
          const published = await repo.#publishedCultures(node.id)
          const settled = new Set([...targets, ...published].map((c) => c.toLowerCase()))
          const mandatory = (await repo.#languages()).filter(
            (l) => l.isMandatory && !settled.has(l.isoCode.toLowerCase()),
          )
          if (mandatory.length > 0)
            throw new PublishBlockedError(
              `The mandatory ${mandatory.map((l) => l.isoCode).join(', ')} must be published too.`,
            )
        }
        await repo.#assertMandatoryFilled(node, targets)

        const head = await repo.#headEvent(node.id)
        const t = tx.dialect.boolValue(true) as boolean
        const f = tx.dialect.boolValue(false) as boolean
        await tx.q
          .updateTable('document_version')
          .set({ published: f })
          .where('id', 'in', (eb) =>
            eb
              .selectFrom('content_version')
              .select('id')
              .where('node_id', '=', node.id)
              .where('workspace_id', 'is', null),
          )
          .execute()
        const eventId = await repo.#insertEvent(
          node.id,
          'publish',
          head?.name ?? node.text ?? '',
          head?.userId,
          head?.templateId ?? null,
          true,
        )
        await tx.q
          .updateTable('document')
          .set({ published: t })
          .where('node_id', '=', node.id)
          .execute()
        for (const iso of targets ?? []) await repo.#setCulturePublished(node.id, iso, eventId)
        await repo.#recomputeEdited(node.id)
        await repo.#instructContent(node.key)
        return repo.#load(node)
      }),
    )
  }

  /**
   * Why publishing this document would be refused, without publishing it.
   *
   * `publish` throws on the first of these, which is right for one node and
   * wrong for a branch: a caller publishing a selection asks this first, so the
   * whole thing is refused rather than half of it landing. The checks and their
   * order are `publish`'s own.
   */
  async publishBlockers(
    key: string,
    cultures: readonly string[] | null,
    /**
     * Node ids this caller is publishing in the same run, parents first.
     * Without it, publishing a branch reports every child as blocked by the
     * root that the same command is about to publish.
     */
    alsoPublishing: ReadonlySet<number> = new Set(),
  ): Promise<string[]> {
    const node = await this.#nodes.byKey(key)
    if (!node) return ['there is no such document here']
    if (node.trashed) return ['it is in the recycle bin']
    const reasons: string[] = []
    if (!(await this.#ancestorsPublished(node, alsoPublishing)))
      reasons.push('an ancestor is not published')

    const variant = await this.#variesByCulture(node.id)
    const available = variant ? await this.#availableCultures(node.id) : []
    const targets = variant ? (cultures && cultures.length > 0 ? [...cultures] : available) : null
    if (targets) {
      const missing = targets.filter(
        (c) => !available.some((a) => a.toLowerCase() === c.toLowerCase()),
      )
      if (missing.length > 0) reasons.push(`there is no ${missing.join(', ')} variant to publish`)
      const published = await this.#publishedCultures(node.id)
      const settled = new Set([...targets, ...published].map((c) => c.toLowerCase()))
      const mandatory = (await this.#languages()).filter(
        (l) => l.isMandatory && !settled.has(l.isoCode.toLowerCase()),
      )
      if (mandatory.length > 0)
        reasons.push(
          `the mandatory ${mandatory.map((l) => l.isoCode).join(', ')} must be published too`,
        )
    }
    try {
      await this.#assertMandatoryFilled(node, targets)
    } catch (error) {
      reasons.push((error as Error).message)
    }
    return reasons
  }

  /**
   * Unpublishes the document, or only the cultures named. Taking a mandatory
   * culture offline takes the whole document offline, as in Umbraco.
   */
  async unpublish(
    key: string,
    cultures: readonly string[] | null,
  ): Promise<DocumentAggregate | undefined> {
    return this.#withTree(() => this.#unpublish(key, cultures))
  }

  async #unpublish(
    key: string,
    cultures: readonly string[] | null,
  ): Promise<DocumentAggregate | undefined> {
    return this.#db.transaction(async (tx) => {
      const repo = this.#child(tx)
      await assertNodeMayWrite(tx, this.#nodeState)
      const node = await repo.nodes.byKey(key)
      if (!node || !repo.sees(node)) return undefined
      if (repo.#workspace !== undefined) return repo.#unpublishInWorkspace(node, cultures)

      const mandatory = new Set(
        (await repo.#languages()).filter((l) => l.isMandatory).map((l) => l.isoCode.toLowerCase()),
      )
      const everything =
        !cultures || cultures.length === 0 || cultures.some((c) => mandatory.has(c.toLowerCase()))
      const isoCodes = everything ? await repo.#availableCultures(node.id) : cultures
      for (const iso of isoCodes) await repo.#setCulturePublished(node.id, iso, null)
      if (everything || !(await repo.#anyCulturePublished(node.id))) {
        // Events survive an unpublish; only the flags change.
        await tx.q
          .updateTable('document_version')
          .set({ published: tx.dialect.boolValue(false) as boolean })
          .where('id', 'in', (eb) =>
            eb
              .selectFrom('content_version')
              .select('id')
              .where('node_id', '=', node.id)
              .where('workspace_id', 'is', null),
          )
          .execute()
        await tx.q
          .updateTable('document')
          .set({
            published: tx.dialect.boolValue(false) as boolean,
            edited: tx.dialect.boolValue(true) as boolean,
          })
          .where('node_id', '=', node.id)
          .execute()
      }
      // Site search holds published values only; what this took offline leaves it.
      await queueForSearch(tx, [node.id])
      await repo.#instructContent(node.key)
      return repo.#load(node)
    })
  }

  /**
   * Where a node stands in its own history: its latest event, and the event it
   * is serving. Together these are "the state this node was in", which is what
   * a content import records before touching it so a revert can put it back.
   */
  async eventMarkers(
    key: string,
  ): Promise<{ head: number | undefined; published: number | undefined } | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node) return undefined
    return {
      head: (await this.#headEvent(node.id))?.id,
      published: await this.#publishedEventId(node.id),
    }
  }

  /** Rollback appends the target version's values under a new event. History is never rewritten. */
  async rollback(
    versionId: string,
    options: { expectedRevision?: string } = {},
  ): Promise<DocumentAggregate | undefined> {
    this.#refuseInWorkspace('An earlier version can be brought back in Shared only, for now.')
    return this.#withTree(() => this.#rollback(versionId, options.expectedRevision))
  }

  /**
   * Which state of the draft a node is in (story 172): its latest event and its
   * latest value row. The second moves when an upgrade rewrites values under the
   * same event, which an editor's copy must not silently undo.
   */
  async revisionOf(key: string): Promise<string | undefined> {
    const node = await this.#nodes.byKey(key)
    return node ? this.#revision(node.id) : undefined
  }

  async #revision(nodeId: number): Promise<string> {
    if (await this.#workspaceDocument(nodeId)) {
      const workspace = this.#workspace as number
      const mine = await this.#db.q
        .selectNoFrom((eb) => [
          eb
            .selectFrom('content_version')
            .select((e) => e.fn.max('id').as('id'))
            .where('node_id', '=', nodeId)
            .where('workspace_id', '=', workspace)
            .as('head'),
          eb
            .selectFrom('property_value')
            .select((e) => e.fn.max('id').as('id'))
            .where('node_id', '=', nodeId)
            .where('workspace_id', '=', workspace)
            .as('value'),
        ])
        .execute()
      return revisionString(mine[0]?.head, mine[0]?.value)
    }
    const rows = await this.#db.q
      .selectNoFrom((eb) => [
        eb
          .selectFrom('content_version')
          .select((e) => e.fn.max('id').as('id'))
          .where('node_id', '=', nodeId)
          .where('workspace_id', 'is', null)
          .as('head'),
        eb
          .selectFrom('property_value')
          .select((e) => e.fn.max('id').as('id'))
          .where('node_id', '=', nodeId)
          .where('workspace_id', 'is', null)
          .as('value'),
      ])
      .execute()
    return revisionString(rows[0]?.head, rows[0]?.value)
  }

  async #assertRevision(nodeId: number, expected: string | undefined): Promise<void> {
    if (expected === undefined) return
    const actual = await this.#revision(nodeId)
    if (actual !== expected) throw new StaleRevisionError(expected, actual)
  }

  async #rollback(
    versionId: string,
    expectedRevision?: string,
  ): Promise<DocumentAggregate | undefined> {
    return this.#db.transaction(async (tx) => {
      const repo = this.#child(tx)
      const state = await assertNodeMayWrite(tx, this.#nodeState)
      const targetId = Number(versionId)
      const rows = await tx.q
        .selectFrom('content_version')
        .select(['node_id', 'text', 'user_id'])
        .where('id', '=', targetId)
        .execute()
      const target = rows[0]
      if (!target) return undefined
      const node = await repo.nodes.byId(Number(target.node_id))
      if (!node) return undefined
      await repo.#assertRevision(node.id, expectedRevision)
      const contentTypeNodeId = await repo.#contentTypeNodeId(node.id)
      if (!contentTypeNodeId) return undefined

      const templateRows = await tx.q
        .selectFrom('document_version')
        .select('template_id')
        .where('id', '=', targetId)
        .execute()
      const name = String(target.text ?? node.text ?? '')
      const eventId = await repo.#insertEvent(
        node.id,
        'rollback',
        name,
        undefined,
        templateRows[0]?.template_id ?? null,
        false,
      )

      const snapshot = await repo.#valueRowsAsOf(node.id, { eventId: targetId })
      const current = await repo.#currentValueRows(node.id)
      await repo.#appendRows(node.id, eventId, state, snapshot, current)
      await repo.#copyCultureVariations(targetId, eventId)
      await repo.nodes.rename(node.id, name)
      await repo.#recomputeEdited(node.id)
      const restored = await repo.#load({ ...node, text: name })
      if (restored) await recordFiles(tx, this.kind, node.id, restored)
      return restored
    })
  }

  async setPreventCleanup(versionId: string, prevent: boolean): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('content_version')
      .select('id')
      .where('id', '=', Number(versionId))
      .execute()
    if (!rows[0]) return false
    await this.#db.q
      .updateTable('content_version')
      .set({ prevent_cleanup: this.#db.dialect.boolValue(prevent) as boolean })
      .where('id', '=', Number(versionId))
      .execute()
    return true
  }

  /**
   * Re-parents the branch under the bin, as Umbraco does: paths stay true, so a
   * later restore of an ancestor cannot reach into it. The branch root
   * remembers where it came from for the restore.
   */
  async moveToRecycleBin(key: string): Promise<boolean> {
    const bin = this.#recycleBin
    if (bin === undefined) return false
    if (this.#workspace !== undefined) return this.#removeInWorkspace(key, 'trash')
    return this.#withTree(() =>
      this.#db.transaction(async (tx) => {
        const repo = this.#child(tx)
        const node = await repo.nodes.byKey(key)
        if (!node) return false
        if (node.parentId === bin) return true
        // Read before the move, while the branch's paths are still under the node's own.
        const branch = (
          await tx.q
            .selectFrom('node')
            .select('id')
            .where((eb) => eb.or([eb('id', '=', node.id), eb('path', 'like', `${node.path},%`)]))
            .execute()
        ).map((row) => Number(row.id))
        const t = tx.dialect.boolValue(true) as boolean
        const f = tx.dialect.boolValue(false) as boolean
        await tx.q
          .updateTable('document')
          .set({
            original_parent_id: node.parentId === SystemNodes.Root ? null : node.parentId,
            trashed_date: DbDate.toDb(new Date()),
          })
          .where('node_id', '=', node.id)
          .execute()
        // The whole branch goes with it, and stays unpublished while trashed.
        await tx.q
          .updateTable('node')
          .set({ trashed: t })
          .where((eb) => eb.or([eb('id', '=', node.id), eb('path', 'like', `${node.path},%`)]))
          .execute()
        await tx.q
          .updateTable('document')
          .set({ published: f, edited: t })
          .where('node_id', 'in', (eb) =>
            eb
              .selectFrom('node')
              .select('id')
              .where((w) => w.or([w('id', '=', node.id), w('path', 'like', `${node.path},%`)])),
          )
          .execute()
        await repo.nodes.move(node.id, bin)
        await tx.q
          .updateTable('node')
          .set({ sort_order: await repo.#nextSortOrder(bin, node.id) })
          .where('id', '=', node.id)
          .execute()
        // The branch is no longer published: other nodes drop it, and so does site search.
        await queueForSearch(tx, branch)
        await repo.#instructContent(node.key)
        return true
      }),
    )
  }

  async delete(key: string): Promise<boolean> {
    if (this.#workspace !== undefined) return this.#removeInWorkspace(key, 'delete')
    return this.#withTree(() => this.#delete(key))
  }

  /**
   * A delete in a workspace: a page made there goes, with its branch; a Shared
   * page is recorded as going, and goes at merge (story 375).
   */
  async #removeInWorkspace(key: string, kind: 'trash' | 'delete'): Promise<boolean> {
    return this.#withTree(() =>
      this.#db.transaction(async (tx) => {
        const repo = this.#child(tx)
        const node = await repo.nodes.byKey(key)
        if (!node || !repo.sees(node)) return false
        if (node.workspaceId === this.#workspace) await deleteNodeRows(tx, { branch: node })
        else await repo.#recordPending(node, kind)
        return true
      }),
    )
  }

  #refuseInWorkspace(reason: string): void {
    if (this.#workspace !== undefined) throw new WorkspaceRefusedError(reason)
  }

  async #delete(key: string): Promise<boolean> {
    return this.#db.transaction(async (tx) => {
      const node = await new NodeRepository(tx).byKey(key)
      if (!node) return false
      await deleteNodeRows(tx, { branch: node })
      // A page deleted from the bin was never served, but an item deleted
      // directly may have been: every node is told (story 174).
      await this.#child(tx).#instructContent(node.key)
      return true
    })
  }

  /**
   * Deletes these nodes and their rows, and no others (story 246): a large branch
   * is deleted a chunk at a time, deepest first, so no transaction holds it all
   * and a parent always outlasts its children.
   */
  async deleteNodes(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return
    await this.#withTree(() => this.#db.transaction((tx) => deleteNodeRows(tx, { ids })))
  }

  /**
   * Re-parents a node and its branch under `targetKey` (null: the root), last
   * among its new siblings. Refused when the target is the node or below it.
   */
  async move(key: string, targetKey: string | null): Promise<'moved' | 'notFound' | 'invalid'> {
    return this.#withTree(async () =>
      this.#db.transaction(async (tx) => {
        const repo = this.#child(tx)
        await assertNodeMayWrite(tx, this.#nodeState)
        const node = await repo.nodes.byKey(key)
        if (!node || !repo.sees(node)) return 'notFound'
        if (this.#workspace !== undefined) {
          const target = targetKey ? await repo.nodes.byKey(targetKey) : undefined
          if (targetKey && (!target || !repo.sees(target))) return 'notFound'
          if (target && (target.id === node.id || target.path.startsWith(`${node.path},`)))
            return 'invalid'
          // A page made here moves; a Shared page's move waits for the merge.
          if (node.workspaceId === this.#workspace)
            await repo.nodes.move(node.id, target?.id ?? SystemNodes.Root)
          else
            await repo.#recordPending(node, 'move', {
              targetParentId: target?.id ?? SystemNodes.Root,
            })
          return 'moved'
        }
        const target = targetKey ? await repo.nodes.byKey(targetKey) : undefined
        const container = KINDS[this.kind].container
        if (
          targetKey &&
          (!target || (target.objectType !== this.objectType && target.objectType !== container))
        )
          return 'notFound'
        if (target && (target.id === node.id || `${target.path},`.startsWith(`${node.path},`)))
          return 'invalid'
        if (target?.trashed) return 'invalid'
        const parentId = target?.id ?? SystemNodes.Root
        // Out of the bin is a restore, as Umbraco's Move treats it.
        if (node.trashed) {
          await tx.q
            .updateTable('node')
            .set({ trashed: tx.dialect.boolValue(false) as boolean })
            .where((eb) => eb.or([eb('id', '=', node.id), eb('path', 'like', `${node.path},%`)]))
            .execute()
          await tx.q
            .updateTable('document')
            .set({ original_parent_id: null, trashed_date: null })
            .where('node_id', '=', node.id)
            .execute()
        }
        await repo.nodes.move(node.id, parentId)
        await tx.q
          .updateTable('node')
          .set({ sort_order: await repo.#nextSortOrder(parentId, node.id) })
          .where('id', '=', node.id)
          .execute()
        // A provider outside the database filters on the paths it was given (story 273).
        const placed = searchesOutsideDatabase(tx) ? await repo.nodes.byId(node.id) : undefined
        if (placed) {
          const moved = await tx.q
            .selectFrom('node')
            .select('id')
            .where((eb) =>
              eb.or([eb('id', '=', placed.id), eb('path', 'like', `${placed.path},%`)]),
            )
            .execute()
          await queueForSearch(
            tx,
            moved.map((row) => Number(row.id)),
          )
        }
        await repo.#instructContent(node.key)
        return 'moved'
      }),
    )
  }

  /**
   * Copies a node's current draft (and, optionally, its branch) under
   * `targetKey`. Copies are unpublished and take a free name among their new
   * siblings (`Home (1)`), as Umbraco names them.
   */
  async copy(
    key: string,
    targetKey: string | null,
    options: { includeDescendants: boolean; userId?: number },
  ): Promise<string | undefined> {
    this.#refuseInWorkspace('Copying a page is done in Shared only, for now.')
    const source = await this.byKey(key)
    if (!source) return undefined
    if (targetKey) {
      const target = await this.#nodes.byKey(targetKey)
      const container = KINDS[this.kind].container
      if (!target || (target.objectType !== this.objectType && target.objectType !== container))
        return undefined
    }
    const copyOne = async (from: DocumentAggregate, parentKey: string | null): Promise<string> => {
      const siblings = await this.#siblingNames(parentKey)
      const variants = from.variants.map((variant) => ({
        culture: variant.culture,
        segment: variant.segment,
        name: variant.culture === null ? uniqueName(variant.name, siblings) : variant.name,
      }))
      const created = await this.create({
        key: crypto.randomUUID(),
        contentTypeKey: from.contentTypeKey,
        componentKey: from.componentKey,
        parentKey,
        values: from.values,
        variants,
        userId: options.userId,
      })
      return created.key
    }
    const copyBranch = async (from: DocumentAggregate, parentKey: string | null) => {
      const newKey = await copyOne(from, parentKey)
      if (!options.includeDescendants) return newKey
      const children = await this.children(from.key, 0, Number.MAX_SAFE_INTEGER)
      for (const child of children.items) {
        const loaded = await this.#load(child)
        if (loaded) await copyBranch(loaded, newKey)
      }
      return newKey
    }
    return copyBranch(source, targetKey)
  }

  /** Sets the sort order of the given children of `parentKey` (null: the root). */
  async sort(
    parentKey: string | null,
    sorting: ReadonlyArray<{ key: string; sortOrder: number }>,
  ): Promise<'sorted' | 'notFound'> {
    return this.#withTree(async () =>
      this.#db.transaction(async (tx) => {
        await assertNodeMayWrite(tx, this.#nodeState)
        const parentId = parentKey
          ? (await new NodeRepository(tx).byKey(parentKey))?.id
          : SystemNodes.Root
        if (parentId === undefined) return 'notFound'
        const nodes = await new NodeRepository(tx).byKeys(sorting.map((s) => s.key))
        const byKey = new Map(nodes.map((n) => [n.key, n]))
        for (const item of sorting) {
          const node = byKey.get(normaliseUuid(item.key))
          if (!node || node.parentId !== parentId || !this.sees(node)) return 'notFound'
        }
        for (const item of sorting) {
          const node = byKey.get(normaliseUuid(item.key)) as NodeRow
          if (this.#workspace !== undefined && node.workspaceId !== this.#workspace) {
            // Shared's order is kept until the merge.
            await this.#child(tx).#recordPending(node, 'sort', { sortOrder: item.sortOrder })
            continue
          }
          await tx.q
            .updateTable('node')
            .set({ sort_order: item.sortOrder })
            .where('id', '=', node.id)
            .execute()
          if (this.#workspace === undefined) await this.#child(tx).#instructContent(node.key)
        }
        return 'sorted'
      }),
    )
  }

  /** Re-sorts every child of `parentKey` by name or date, as the "Sort children" dialog asks. */
  async sortChildrenBy(
    parentKey: string | null,
    field: 'Name' | 'CreateDate' | 'UpdateDate',
    direction: 'Ascending' | 'Descending',
  ): Promise<'sorted' | 'notFound'> {
    const children = await this.children(parentKey, 0, Number.MAX_SAFE_INTEGER)
    if (parentKey && !(await this.#nodes.byKey(parentKey))) return 'notFound'
    const loaded = await Promise.all(
      children.items.map(async (node) => ({ node, aggregate: await this.#load(node) })),
    )
    const sortKey = (entry: (typeof loaded)[number]): string | number => {
      const variant = entry.aggregate?.variants[0]
      if (field === 'Name') return (variant?.name ?? entry.node.text ?? '').toLowerCase()
      if (field === 'CreateDate') return (entry.node.createDate ?? new Date(0)).getTime()
      return (variant?.updateDate ?? entry.node.createDate ?? new Date(0)).getTime()
    }
    loaded.sort((a, b) => {
      const x = sortKey(a)
      const y = sortKey(b)
      const order = x < y ? -1 : x > y ? 1 : a.node.id - b.node.id
      return direction === 'Ascending' ? order : -order
    })
    return this.sort(
      parentKey,
      loaded.map((entry, index) => ({ key: entry.node.key, sortOrder: index })),
    )
  }

  /**
   * Takes a branch out of the recycle bin to `targetKey`, or back where it was
   * when no target is given. Restored content is unpublished.
   */
  async restore(
    key: string,
    targetKey: string | null | undefined,
  ): Promise<'restored' | 'notFound' | 'invalid'> {
    this.#refuseInWorkspace('The recycle bin is Shared’s: restore a page there.')
    return this.#withTree(async () =>
      this.#db.transaction(async (tx) => {
        const repo = this.#child(tx)
        const node = await repo.nodes.byKey(key)
        if (!node || node.objectType !== this.objectType || !node.trashed) return 'notFound'
        let parentKey: string | null
        if (targetKey !== undefined && targetKey !== null) parentKey = targetKey
        else if (targetKey === null) parentKey = null
        else parentKey = (await repo.originalParent(key)) ?? null
        const parent = parentKey ? await repo.nodes.byKey(parentKey) : undefined
        if (parentKey && (!parent || parent.trashed)) return 'invalid'
        await assertNodeMayWrite(tx, this.#nodeState)
        const parentId = parent?.id ?? SystemNodes.Root
        await tx.q
          .updateTable('node')
          .set({ trashed: tx.dialect.boolValue(false) as boolean })
          .where((eb) => eb.or([eb('id', '=', node.id), eb('path', 'like', `${node.path},%`)]))
          .execute()
        await repo.nodes.move(node.id, parentId)
        await tx.q
          .updateTable('node')
          .set({ sort_order: await repo.#nextSortOrder(parentId, node.id) })
          .where('id', '=', node.id)
          .execute()
        await tx.q
          .updateTable('document')
          .set({ original_parent_id: null, trashed_date: null })
          .where('node_id', '=', node.id)
          .execute()
        // Nothing published comes back, but a preview's drafts do.
        await repo.#instructContent(node.key)
        return 'restored' as const
      }),
    )
  }

  /**
   * Publishes a node, then its descendants shallowest first: those already
   * published, or every one when `includeUnpublished`. A descendant that cannot
   * publish (a missing mandatory value, an unpublished parent) is reported and
   * skipped, and so is its branch below.
   */
  async publishBranch(
    key: string,
    cultures: readonly string[] | null,
    includeUnpublished: boolean,
  ): Promise<{ published: string[]; failed: Array<{ key: string; reason: string }> } | undefined> {
    this.#refuseInWorkspace(
      'Publish each page in a workspace; a whole branch is published in Shared.',
    )
    return this.#withTree(() => this.#publishBranch(key, cultures, includeUnpublished))
  }

  async #publishBranch(
    key: string,
    cultures: readonly string[] | null,
    includeUnpublished: boolean,
  ): Promise<{ published: string[]; failed: Array<{ key: string; reason: string }> } | undefined> {
    const root = await this.#nodes.byKey(key)
    if (!root || root.objectType !== this.objectType || root.trashed) return undefined
    const published: string[] = []
    const failed: Array<{ key: string; reason: string }> = []
    try {
      await this.publish(root.key, cultures)
      published.push(root.key)
    } catch (error) {
      if (!(error instanceof PublishBlockedError)) throw error
      return { published, failed: [{ key: root.key, reason: error.message }] }
    }
    const rows = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('document as d', 'd.node_id', 'n.id')
      .select(['n.id', 'n.unique_id', 'n.path', 'd.published'])
      .where('n.path', 'like', `${root.path},%`)
      .where('n.node_object_type', '=', this.objectType)
      .where('n.trashed', '=', this.#db.dialect.boolValue(false) as boolean)
      .orderBy('n.level')
      .orderBy('n.sort_order')
      .orderBy('n.id')
      .execute()
    const skipped: string[] = []
    for (const row of rows) {
      const path = String(row.path)
      if (skipped.some((prefix) => path.startsWith(`${prefix},`))) continue
      const nodeKey = normaliseUuid(String(row.unique_id))
      if (!includeUnpublished && !fromDbBool(row.published)) {
        skipped.push(path)
        continue
      }
      try {
        await this.publish(nodeKey, cultures)
        published.push(nodeKey)
      } catch (error) {
        if (!(error instanceof PublishBlockedError)) throw error
        failed.push({ key: nodeKey, reason: error.message })
        skipped.push(path)
      }
    }
    return { published, failed }
  }

  /** A document as it stood at one of its versions: that version's name and values. */
  async atVersion(
    versionId: string,
  ): Promise<{ versionId: string; document: DocumentAggregate } | undefined> {
    const id = Number(versionId)
    if (!Number.isInteger(id)) return undefined
    const rows = await this.#db.q
      .selectFrom('content_version')
      .select(['node_id', 'text'])
      .where('id', '=', id)
      .execute()
    const row = rows[0]
    if (!row) return undefined
    const node = await this.#nodes.byId(Number(row.node_id))
    if (!node || node.objectType !== this.objectType) return undefined
    const current = await this.#load(node)
    const contentTypeNodeId = await this.#contentTypeNodeId(node.id)
    if (!current || !contentTypeNodeId) return undefined
    const propertyTypes = await this.#propertyTypes(contentTypeNodeId)
    const values = await this.#readValues(node.id, propertyTypes, await this.#languages(), {
      eventId: id,
    })
    const name = String(row.text ?? node.text ?? '')
    return {
      versionId: String(id),
      document: {
        ...current,
        values,
        variants: current.variants.map((v) => (v.culture === null ? { ...v, name } : v)),
      },
    }
  }

  /**
   * Replaces the scheduled publish and unpublish of each culture given (null:
   * the invariant variant). A time of null clears that half of the schedule.
   */
  async setSchedule(
    key: string,
    entries: ReadonlyArray<{
      culture: string | null
      publishTime: Date | null
      unpublishTime: Date | null
    }>,
  ): Promise<boolean> {
    return this.#withTree(() => this.#setSchedule(key, entries))
  }

  async #setSchedule(
    key: string,
    entries: ReadonlyArray<{
      culture: string | null
      publishTime: Date | null
      unpublishTime: Date | null
    }>,
  ): Promise<boolean> {
    const node = await this.#nodes.byKey(key)
    if (!node || !this.sees(node)) return false
    const languages = await this.#languages()
    const workspace = this.#workspace ?? null
    await this.#db.transaction(async (tx) => {
      // Story 414: the first time a workspace sets one, Shared's as it was then; a publish
      // that names no time, and finds none to clear, sets none.
      const timed = entries.some((e) => e.publishTime !== null || e.unpublishTime !== null)
      const clears =
        !timed &&
        workspace !== null &&
        ((await scheduleEntriesOf(tx, node.id, workspace)).length > 0 ||
          (await scheduleEntriesOf(tx, node.id, null)).length > 0)
      if (workspace !== null && (timed || clears)) {
        const held = await tx.q
          .selectFrom('workspace_schedule')
          .select('node_id')
          .where('workspace_id', '=', workspace)
          .where('node_id', '=', node.id)
          .execute()
        if (held.length === 0)
          await tx.q
            .insertInto('workspace_schedule')
            .values({
              workspace_id: workspace,
              node_id: node.id,
              base: JSON.stringify(await scheduleEntriesOf(tx, node.id, null)),
            })
            .execute()
      }
      for (const entry of entries) {
        const languageId = entry.culture
          ? (languages.find((l) => l.isoCode.toLowerCase() === entry.culture?.toLowerCase())?.id ??
            null)
          : null
        await tx.q
          .deleteFrom('content_schedule')
          .where('node_id', '=', node.id)
          .where('language_id', languageId === null ? 'is' : '=', languageId)
          .where('workspace_id', workspace === null ? 'is' : '=', workspace)
          .execute()
        const add = async (action: 'Release' | 'Expire', date: Date | null) => {
          if (!date) return
          await tx.q
            .insertInto('content_schedule')
            .values({
              node_id: node.id,
              language_id: languageId,
              action,
              date: DbDate.toDb(date),
              workspace_id: workspace,
            })
            .execute()
        }
        await add('Release', entry.publishTime)
        await add('Expire', entry.unpublishTime)
      }
    })
    return true
  }

  async schedules(
    key: string,
  ): Promise<
    Array<{ id: number; culture: string | null; action: 'Release' | 'Expire'; date: Date }>
  > {
    const node = await this.#nodes.byKey(key)
    if (!node) return []
    const rows = await this.#db.q
      .selectFrom('content_schedule as s')
      .leftJoin('language as l', 'l.id', 's.language_id')
      .select(['s.id', 's.action', 's.date', 'l.iso_code'])
      .where('s.node_id', '=', node.id)
      .$if(this.#workspace === undefined, (q) => q.where('s.workspace_id', 'is', null))
      .$if(this.#workspace !== undefined, (q) =>
        q.where('s.workspace_id', '=', this.#workspace as number),
      )
      .orderBy('s.date')
      .execute()
    return rows.map((row) => ({
      id: Number(row.id),
      culture: (row.iso_code as string | null) ?? null,
      action: String(row.action) as 'Release' | 'Expire',
      date: DbDate.fromDb(row.date) ?? new Date(0),
    }))
  }

  /**
   * A page's schedule as a change carries it (story 414): per language, when it goes live
   * and comes down, in this repository's view, Shared's or the workspace's.
   */
  async scheduleEntries(key: string): Promise<ScheduleEntryAt[]> {
    const node = await this.#nodes.byKey(key)
    if (!node) return []
    return scheduleEntriesOf(this.#db, node.id, this.#workspace ?? null)
  }

  /** Story 414: the change that set the page's schedule in Shared, named when it fires. */
  async scheduleSetBy(key: string, changeKey: string): Promise<void> {
    const node = await this.#nodes.byKey(key)
    if (!node) return
    await this.#db.q
      .updateTable('content_schedule')
      .set({ change_key: changeKey })
      .where('node_id', '=', node.id)
      .where('workspace_id', 'is', null)
      .execute()
  }

  /** Schedules whose time has come, oldest first. */
  async dueSchedules(now: Date): Promise<
    Array<{
      id: number
      key: string
      culture: string | null
      action: 'Release' | 'Expire'
      /** Story 414: the change that set it, when one did. */
      changeKey: string | null
    }>
  > {
    const rows = await this.#db.q
      .selectFrom('content_schedule as s')
      .innerJoin('node as n', 'n.id', 's.node_id')
      .leftJoin('language as l', 'l.id', 's.language_id')
      .select(['s.id', 's.action', 'n.unique_id', 'l.iso_code', 's.change_key'])
      .where('s.date', '<=', DbDate.toDb(now))
      .where('n.node_object_type', '=', this.objectType)
      // A workspace's schedules wait for it to be served (story 379).
      .where('s.workspace_id', 'is', null)
      .orderBy('s.date')
      .orderBy('s.id')
      .execute()
    return rows.map((row) => ({
      id: Number(row.id),
      key: normaliseUuid(String(row.unique_id)),
      culture: (row.iso_code as string | null) ?? null,
      action: String(row.action) as 'Release' | 'Expire',
      changeKey: (row.change_key as string | null) ?? null,
    }))
  }

  /** Takes a due schedule for this process; false when another node already did. */
  async claimSchedule(id: number): Promise<boolean> {
    const rows = await this.#db.q
      .deleteFrom('content_schedule')
      .where('id', '=', id)
      .returning('id')
      .execute()
    return rows.length > 0
  }

  /**
   * Prunes old versions under the cleanup policy: the content type's own, else
   * `global`. Kept always: the current draft, the published version, and any
   * version pinned with prevent-cleanup. Kept by age: everything newer than
   * keep-all days, then the latest version of each day for keep-latest days.
   *
   * Values are append-only, so a pruned version's value row may still be what a
   * kept version reads ("latest per key at or before it"). Such a row is
   * re-pointed at the earliest kept version after it rather than deleted, so
   * every kept version still reads exactly what it did.
   */
  async cleanupVersions(
    now: Date,
    global: { keepAllVersionsNewerThanDays: number; keepLatestVersionPerDayForDays: number },
  ): Promise<{ nodes: number; versionsDeleted: number }> {
    const types = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .innerJoin('node as n', 'n.id', 'c.node_id')
      .select([
        'c.node_id',
        'ct.prevent_cleanup',
        'ct.keep_all_versions_newer_than_days as keep_all',
        'ct.keep_latest_version_per_day_for_days as keep_latest',
      ])
      .where('n.node_object_type', '=', this.objectType)
      .execute()
    const day = 24 * 60 * 60 * 1000
    let nodes = 0
    let versionsDeleted = 0
    for (const type of types) {
      if (fromDbBool(type.prevent_cleanup)) continue
      const keepAll =
        type.keep_all === null ? global.keepAllVersionsNewerThanDays : Number(type.keep_all)
      const keepLatest =
        type.keep_latest === null ? global.keepLatestVersionPerDayForDays : Number(type.keep_latest)
      const deleted = await this.#withTree(() =>
        this.#db.transaction((tx) =>
          this.#child(tx).#cleanupNode(
            Number(type.node_id),
            now.getTime() - keepAll * day,
            now.getTime() - keepLatest * day,
          ),
        ),
      )
      if (deleted > 0) {
        nodes += 1
        versionsDeleted += deleted
      }
    }
    return { nodes, versionsDeleted }
  }

  async #cleanupNode(
    nodeId: number,
    keepAllAfter: number,
    keepLatestAfter: number,
  ): Promise<number> {
    const events = (
      await this.#db.q
        .selectFrom('content_version as cv')
        .innerJoin('document_version as dv', 'dv.id', 'cv.id')
        .select(['cv.id', 'cv.version_date', 'cv.current', 'cv.prevent_cleanup', 'dv.published'])
        .where('cv.node_id', '=', nodeId)
        .where('cv.workspace_id', 'is', null)
        .orderBy('cv.id')
        .execute()
    ).map((row) => ({
      id: Number(row.id),
      date: (DbDate.fromDb(row.version_date) ?? new Date(0)).getTime(),
      pinned:
        fromDbBool(row.current) || fromDbBool(row.published) || fromDbBool(row.prevent_cleanup),
    }))
    // A workspace reads Shared as of the event it started from, so that event stays (story 375).
    const bases = new Set(
      (
        await this.#db.q
          .selectFrom('workspace_document')
          .select('base_event_id')
          .where('node_id', '=', nodeId)
          .where('base_event_id', 'is not', null)
          .execute()
      ).map((row) => Number(row.base_event_id)),
    )
    for (const event of events) if (bases.has(event.id)) event.pinned = true
    const kept = new Set<number>()
    const latestPerDay = new Map<string, number>()
    for (const event of events) {
      if (event.pinned || event.date >= keepAllAfter) kept.add(event.id)
      else if (event.date >= keepLatestAfter) {
        // Ascending ids: the last one seen for a day is that day's latest.
        latestPerDay.set(new Date(event.date).toISOString().slice(0, 10), event.id)
      }
    }
    for (const id of latestPerDay.values()) kept.add(id)
    const pruned = events.filter((e) => !kept.has(e.id)).map((e) => e.id)
    if (pruned.length === 0) return 0
    const keptAscending = [...kept].sort((a, b) => a - b)
    const prunedSet = new Set(pruned)

    const rows = await this.#db.q
      .selectFrom('property_value')
      .select(['id', 'property_type_id', 'language_id', 'segment', 'environment', 'event_id'])
      .where('node_id', '=', nodeId)
      .where('workspace_id', 'is', null)
      .orderBy('event_id')
      .orderBy('id')
      .execute()
    // Per key, the distinct events that wrote it, ascending.
    const eventsByKey = new Map<string, number[]>()
    for (const row of rows) {
      const key = keyOf(
        Number(row.property_type_id),
        row.language_id === null ? null : Number(row.language_id),
        row.segment,
        row.environment,
      )
      const list = eventsByKey.get(key) ?? []
      if (list.at(-1) !== Number(row.event_id)) list.push(Number(row.event_id))
      eventsByKey.set(key, list)
    }
    for (const row of rows) {
      const eventId = Number(row.event_id)
      if (!prunedSet.has(eventId)) continue
      const key = keyOf(
        Number(row.property_type_id),
        row.language_id === null ? null : Number(row.language_id),
        row.segment,
        row.environment,
      )
      const written = eventsByKey.get(key) as number[]
      const next = written[written.indexOf(eventId) + 1] ?? Number.POSITIVE_INFINITY
      const reader = keptAscending.find((k) => k >= eventId)
      if (reader !== undefined && reader < next)
        await this.#db.q
          .updateTable('property_value')
          .set({ event_id: reader })
          .where('id', '=', Number(row.id))
          .execute()
      else await this.#db.q.deleteFrom('property_value').where('id', '=', Number(row.id)).execute()
    }
    await this.#db.q
      .deleteFrom('content_version_culture_variation')
      .where('version_id', 'in', pruned)
      .execute()
    await this.#db.q.deleteFrom('document_version').where('id', 'in', pruned).execute()
    await this.#db.q.deleteFrom('content_version').where('id', 'in', pruned).execute()
    return pruned.length
  }

  /** Every top-level item in this kind's recycle bin, for emptying it. */
  async trashedRoots(): Promise<NodeRow[]> {
    return (await this.trashed(null, 0, Number.MAX_SAFE_INTEGER)).items
  }

  /** When each item went into the recycle bin; absent for one trashed before that was recorded. */
  async trashedDates(nodeIds: readonly number[]): Promise<Map<number, Date>> {
    if (nodeIds.length === 0) return new Map()
    const rows = await this.#db.q
      .selectFrom('document')
      .select(['node_id', 'trashed_date'])
      .where('trashed_date', 'is not', null)
      .where('node_id', 'in', nodeIds)
      .execute()
    const out = new Map<number, Date>()
    for (const row of rows) {
      const date = DbDate.fromDb(row.trashed_date)
      if (date) out.set(Number(row.node_id), date)
    }
    return out
  }

  async #nextSortOrder(parentId: number, excludingId: number): Promise<number> {
    const rows = await this.#db.q
      .selectFrom('node')
      .select((eb) => eb.fn.max('sort_order').as('next'))
      .where('parent_id', '=', parentId)
      .where('node_object_type', '=', this.objectType)
      .where('id', '<>', excludingId)
      .execute()
    const current = rows[0]?.next
    return current === null || current === undefined ? 0 : Number(current) + 1
  }

  async #siblingNames(parentKey: string | null): Promise<Set<string>> {
    const siblings = await this.children(parentKey, 0, Number.MAX_SAFE_INTEGER)
    return new Set(siblings.items.map((node) => (node.text ?? '').toLowerCase()))
  }

  // ------------------------------------------------------------ internals

  async #load(node: NodeRow): Promise<DocumentAggregate | undefined> {
    const touched = await this.#workspaceDocument(node.id)
    if (touched) return this.#loadInWorkspace(node, touched)
    const t = this.#db.dialect.boolValue(true) as boolean
    const rows = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .innerJoin('node as ctn', 'ctn.id', 'ct.node_id')
      .innerJoin('document as d', 'd.node_id', 'n.id')
      .innerJoin('content_version as head', (join) =>
        join.onRef('head.node_id', '=', 'n.id').on('head.current', '=', t),
      )
      .innerJoin('document_version as hv', 'hv.id', 'head.id')
      .leftJoin('node as tn', 'tn.id', 'hv.template_id')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('content_version as pc')
            .innerJoin('document_version as pd', (join) =>
              join.onRef('pd.id', '=', 'pc.id').on('pd.published', '=', t),
            )
            .select(['pc.node_id', 'pc.version_date'])
            // This node's alone: unfiltered, a planner can build it from every
            // published version in the site before joining one (story 246).
            .where('pc.node_id', '=', node.id)
            .as('pub'),
        (join) => join.onRef('pub.node_id', '=', 'n.id'),
      )
      .select((eb) => [
        'c.content_type_id',
        'ct.alias as content_type_alias',
        'ct.icon as content_type_icon',
        'ct.list_view as content_type_collection',
        'ctn.unique_id as content_type_key',
        'd.published',
        'd.edited',
        'head.text as draft_name',
        'head.version_date as draft_date',
        'hv.template_id',
        'tn.unique_id as template_key',
        'pub.version_date as published_date',
        eb
          .selectFrom('content_version as cvm')
          .select((e) => e.fn.max('cvm.id').as('id'))
          .whereRef('cvm.node_id', '=', 'n.id')
          .where('cvm.workspace_id', 'is', null)
          .as('head_id'),
        eb
          .selectFrom('property_value as pvm')
          .select((e) => e.fn.max('pvm.id').as('id'))
          .whereRef('pvm.node_id', '=', 'n.id')
          .where('pvm.workspace_id', 'is', null)
          .as('last_value_id'),
      ])
      .where('n.id', '=', node.id)
      .execute()
    const row = rows[0]
    if (!row) return undefined

    const propertyTypes = await this.#propertyTypes(Number(row.content_type_id))
    const languages = await this.#languages()
    const values = await this.#readValues(node.id, propertyTypes, languages, {})
    const variants = await this.#readVariants(node, row)
    const parent = node.parentId > 0 ? await this.#nodes.byId(node.parentId) : undefined

    return {
      key: node.key,
      contentTypeKey: normaliseUuid(String(row.content_type_key)),
      contentTypeAlias: String(row.content_type_alias),
      contentTypeIcon: String(row.content_type_icon ?? 'icon-document'),
      contentTypeCollectionKey: row.content_type_collection
        ? normaliseUuid(String(row.content_type_collection))
        : null,
      componentKey: row.template_key ? normaliseUuid(String(row.template_key)) : null,
      parentKey: parent && parent.id !== SystemNodes.Root ? parent.key : null,
      sortOrder: node.sortOrder,
      isTrashed: node.trashed,
      published: fromDbBool(row.published),
      edited: fromDbBool(row.edited),
      values,
      variants,
      revision: revisionString(row.head_id as number | null, row.last_value_id as number | null),
    }
  }

  async #contentTypeNodeId(nodeId: number): Promise<number | undefined> {
    const rows = await this.#db.q
      .selectFrom('content')
      .select('content_type_id')
      .where('node_id', '=', nodeId)
      .execute()
    return rows[0] ? Number(rows[0].content_type_id) : undefined
  }

  async #languages(): Promise<LanguageRow[]> {
    const rows = await this.#db.q
      .selectFrom('language')
      .select(['id', 'iso_code', 'is_default', 'is_mandatory'])
      .execute()
    return rows.map((row) => ({
      id: Number(row.id),
      isoCode: String(row.iso_code),
      isDefault: fromDbBool(row.is_default),
      isMandatory: fromDbBool(row.is_mandatory),
    }))
  }

  /** The property aliases a document's type has, compositions included; undefined when there is no document. */
  async propertyAliases(key: string): Promise<string[] | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node) return undefined
    const contentTypeNodeId = await this.#contentTypeNodeId(node.id)
    if (!contentTypeNodeId) return undefined
    return (await this.#propertyTypes(contentTypeNodeId)).map((p) => p.alias)
  }

  /** A document's property types — alias, key and name — compositions included; undefined when there is no document. */
  async propertyTypeKeys(
    key: string,
  ): Promise<Array<{ alias: string; key: string; name: string }> | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node) return undefined
    const contentTypeNodeId = await this.#contentTypeNodeId(node.id)
    if (!contentTypeNodeId) return undefined
    const rows = await this.#withAncestry(contentTypeNodeId)
      .selectFrom('property_type as p')
      .select(['p.alias', 'p.unique_id', 'p.name'])
      .where('p.content_type_id', 'in', (eb) => eb.selectFrom('ancestry').select('id'))
      .where('p.retired_at', 'is', null)
      .execute()
    return rows.map((row) => ({
      alias: String(row.alias),
      key: normaliseUuid(String(row.unique_id)),
      name: String(row.name),
    }))
  }

  /** A content type and every type it composes, transitively, as the CTE `ancestry(id)`. */
  #withAncestry(contentTypeNodeId: number) {
    return this.#db.q.withRecursive('ancestry(id)', (db) =>
      db
        .selectNoFrom((eb) => eb.val(contentTypeNodeId).as('id'))
        .union(
          db
            .selectFrom('content_type_composition as c')
            .innerJoin('ancestry as a', 'a.id', 'c.child_content_type_id')
            .select('c.parent_content_type_id as id'),
        ),
    )
  }

  /** Property types of a content type, including everything it composes; retired ones excluded. */
  /** A type made in this workspace, by the key it stands for (story 376). */
  async #workspaceTypeNode(key: string): Promise<NodeRow | undefined> {
    if (this.#workspace === undefined) return undefined
    const rows = await this.#db.q
      .selectFrom('content_type')
      .select('node_id')
      .where('workspace_id', '=', this.#workspace)
      .where('origin_key', '=', normaliseUuid(key))
      .where('retired_at', 'is', null)
      .execute()
    return rows[0] ? this.#nodes.byId(Number(rows[0].node_id)) : undefined
  }

  /**
   * The type a page is read and written by: in a workspace, its copy of the
   * page's type where it has one (story 376), and the page's own otherwise.
   */
  async #readTypeNodeId(contentTypeNodeId: number): Promise<number> {
    if (this.#workspace === undefined) return contentTypeNodeId
    const key = (await this.#nodes.byId(contentTypeNodeId))?.key
    if (!key) return contentTypeNodeId
    const rows = await this.#db.q
      .selectFrom('content_type')
      .select('node_id')
      .where('workspace_id', '=', this.#workspace)
      .where('origin_key', '=', normaliseUuid(key))
      .where('retired_at', 'is', null)
      .execute()
    return rows[0] ? Number(rows[0].node_id) : contentTypeNodeId
  }

  async #propertyTypes(contentTypeNodeId: number): Promise<PropertyTypeRow[]> {
    const rows = await this.#withAncestry(await this.#readTypeNodeId(contentTypeNodeId))
      .selectFrom('property_type as p')
      .innerJoin('data_type as d', 'd.node_id', 'p.data_type_id')
      .leftJoin('schema_state as ss', 'ss.id', 'p.since_state_id')
      // A workspace's copy of a property reads and writes Shared's values while
      // they are stored the same way; a changed storage reads empty (story 376).
      .leftJoin('property_type as sp', 'sp.unique_id', 'p.origin_key')
      .leftJoin('data_type as sd', 'sd.node_id', 'sp.data_type_id')
      .select([
        'sp.id as shared_id',
        'sd.db_type as shared_db_type',
        'sp.variations as shared_variations',
        'p.id',
        'p.alias',
        'p.name',
        'p.variations',
        'p.mandatory',
        'p.mandatory_message',
        'p.validation_reg_exp',
        'p.validation_reg_exp_message',
        'd.db_type',
        'd.editor_alias',
        'd.config',
        'p.since_version',
        'ss.version as since_v',
        'ss.revision as since_r',
      ])
      .where('p.content_type_id', 'in', (eb) => eb.selectFrom('ancestry').select('id'))
      .where('p.retired_at', 'is', null)
      .orderBy('p.sort_order')
      .orderBy('p.id')
      .execute()
    return rows.map((row) => ({
      id:
        row.shared_id !== null &&
        row.shared_id !== undefined &&
        String(row.shared_db_type) === String(row.db_type) &&
        Number(row.shared_variations) === Number(row.variations)
          ? Number(row.shared_id)
          : Number(row.id),
      alias: String(row.alias),
      name: String(row.name),
      variesByCulture: flagVariesByCulture(Number(row.variations)),
      storage: String(row.db_type) as ValueStorageTypeName,
      editorAlias: String(row.editor_alias),
      config: parseConfig(row.config),
      mandatory: fromDbBool(row.mandatory),
      mandatoryMessage: (row.mandatory_message as string | null) ?? null,
      regEx: (row.validation_reg_exp as string | null) ?? null,
      regExMessage: (row.validation_reg_exp_message as string | null) ?? null,
      pending: isPending(
        {
          since: row.since_v
            ? { version: String(row.since_v), revision: String(row.since_r ?? '0') }
            : null,
          sinceVersion: (row.since_version as string | null) ?? null,
        },
        this.#nodeState,
      ),
    }))
  }

  /**
   * What a read on this node sees: the current rows, unless the database has
   * states newer than the node — then the latest row per key at the node's own
   * state, so an early conversion appended under a prepared state is invisible
   * to the editor on an old node as well as to its renderer.
   */
  async #visibleValueRows(nodeId: number): Promise<ValueRow[]> {
    const touched = await this.#workspaceDocument(nodeId)
    if (touched) return this.#workspaceView(nodeId, touched)
    const stateId = await visibleStateIdFor(this.#db, this.#nodeState)
    return stateId === undefined
      ? this.#currentValueRows(nodeId)
      : this.#valueRowsAsOf(nodeId, { schemaStateId: stateId })
  }

  async #currentValueRows(nodeId: number): Promise<ValueRow[]> {
    const rows = await this.#db.q
      .selectFrom('property_value')
      .select([
        'id',
        'event_id',
        'property_type_id',
        'language_id',
        'segment',
        'environment',
        'int_value',
        'decimal_value',
        'date_value',
        'varchar_value',
        'text_value',
      ])
      .where('node_id', '=', nodeId)
      .where('is_current', '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    return rows.map((row) => this.#toValueRow(row))
  }

  /** Latest value per key at or before an event and/or a schema state. */
  async #valueRowsAsOf(
    nodeId: number,
    asOf: { eventId?: number; schemaStateId?: number },
  ): Promise<ValueRow[]> {
    const { eventId, schemaStateId } = asOf
    const rows = await this.#db.q
      .selectFrom('property_value as pv')
      .innerJoin(
        (eb) =>
          eb
            .selectFrom('property_value')
            .select((e) => [
              'property_type_id',
              'language_id',
              'segment',
              'environment',
              e.fn.max('id').as('id'),
            ])
            .where('node_id', '=', nodeId)
            .where('workspace_id', 'is', null)
            .$if(eventId !== undefined, (q) => q.where('event_id', '<=', eventId as number))
            .$if(schemaStateId !== undefined, (q) =>
              q.where('schema_state_id', '<=', schemaStateId as number),
            )
            .groupBy(['property_type_id', 'language_id', 'segment', 'environment'])
            .as('latest'),
        (join) => join.onRef('latest.id', '=', 'pv.id'),
      )
      .select([
        'pv.id',
        'pv.event_id',
        'pv.property_type_id',
        'pv.language_id',
        'pv.segment',
        'pv.environment',
        'pv.int_value',
        'pv.decimal_value',
        'pv.date_value',
        'pv.varchar_value',
        'pv.text_value',
      ])
      .execute()
    return rows.map((row) => this.#toValueRow(row))
  }

  #toValueRow(row: Record<string, unknown>): ValueRow {
    return {
      id: Number(row.id),
      propertyTypeId: Number(row.property_type_id),
      languageId:
        row.language_id === null || row.language_id === undefined ? null : Number(row.language_id),
      segment: (row.segment as string | null) ?? null,
      environment: (row.environment as string | null) ?? null,
      eventId: Number(row.event_id),
      raw: row,
    }
  }

  async #readValues(
    nodeId: number,
    propertyTypes: readonly PropertyTypeRow[],
    languages: readonly LanguageRow[],
    asOf: { eventId?: number; schemaStateId?: number },
  ): Promise<DocumentValue[]> {
    if (propertyTypes.length === 0) return []
    const rows =
      asOf.eventId === undefined && asOf.schemaStateId === undefined
        ? await this.#visibleValueRows(nodeId)
        : await this.#valueRowsAsOf(nodeId, asOf)
    return this.#valuesFromRows(rows, propertyTypes, languages)
  }

  #valuesFromRows(
    rows: readonly ValueRow[],
    propertyTypes: readonly PropertyTypeRow[],
    languages: readonly LanguageRow[],
  ): DocumentValue[] {
    const byId = new Map(propertyTypes.map((p) => [p.id, p]))
    const isoById = new Map(languages.map((l) => [l.id, l.isoCode]))
    const values: DocumentValue[] = []
    for (const row of rows) {
      const propertyType = byId.get(row.propertyTypeId)
      if (!propertyType) continue
      const raw = (row.raw as Record<string, unknown>)[STORAGE_COLUMN[propertyType.storage]]
      const value = this.#fromStorage(raw, propertyType.storage)
      if (value === null) continue
      values.push({
        alias: propertyType.alias,
        culture: row.languageId === null ? null : (isoById.get(row.languageId) ?? null),
        segment: row.segment,
        ...(row.environment ? { environment: row.environment } : {}),
        value: toEditorValue(propertyType.editorAlias, value),
        editorAlias: propertyType.editorAlias,
        config: propertyType.config,
      })
    }
    return values
  }

  #fromStorage(raw: unknown, storage: ValueStorageTypeName): unknown {
    if (raw === null || raw === undefined) return null
    switch (storage) {
      case 'Integer':
      case 'Decimal':
        return Number(raw)
      case 'Date':
        return DbDate.fromDb(raw)?.toISOString() ?? null
      default:
        return raw
    }
  }

  #toStorage(value: unknown, storage: ValueStorageTypeName): unknown {
    if (value === null || value === undefined) return null
    switch (storage) {
      case 'Integer':
        return typeof value === 'boolean' ? (value ? 1 : 0) : Number(value)
      case 'Decimal':
        return String(Number(value))
      case 'Date': {
        if (value instanceof Date) return DbDate.toDb(value)
        // The date pickers send wall-clock time with no zone ("2026-01-02 03:04:05");
        // it is kept as that wall-clock time, not shifted by the server's zone.
        const date = dateFromText(String(value))
        return date ? DbDate.toDb(date) : null
      }
      default:
        return typeof value === 'string' ? value : JSON.stringify(value)
    }
  }

  /** Whether a stored cell already holds an incoming value, so an unchanged value appends nothing. */
  #storedEquals(raw: unknown, incoming: unknown, storage: ValueStorageTypeName): boolean {
    const a = this.#fromStorage(raw, storage)
    const b = this.#fromStorage(this.#toStorage(incoming, storage), storage)
    if (a === null || b === null) return a === b
    return String(a) === String(b)
  }

  /**
   * Appends a value version for every incoming value that differs from the
   * current one, and a cleared version for every current value that is absent.
   */
  async #appendValues(
    nodeId: number,
    eventId: number,
    state: SchemaStateRow,
    contentTypeNodeId: number,
    incoming: readonly DocumentValue[],
  ): Promise<void> {
    const propertyTypes = await this.#propertyTypes(contentTypeNodeId)
    const values = this.#intake ? await this.#intake(incoming, propertyTypes) : incoming
    const byAlias = new Map(propertyTypes.map((p) => [p.alias, p]))
    const byId = new Map(propertyTypes.map((p) => [p.id, p]))
    const languages = await this.#languages()
    const idByIso = new Map(languages.map((l) => [l.isoCode.toLowerCase(), l.id]))
    // Equality is judged against what this node sees, so re-saving an unchanged
    // value never overwrites a conversion appended under a newer state; the
    // row superseded is the true current one.
    const current = new Map(
      (await this.#visibleValueRows(nodeId)).map((row) => [
        keyOf(row.propertyTypeId, row.languageId, row.segment, row.environment),
        row,
      ]),
    )
    const trueCurrent = new Map(
      (this.#workspace !== undefined
        ? [...current.values()]
        : await this.#currentValueRows(nodeId)
      ).map((row) => [
        keyOf(row.propertyTypeId, row.languageId, row.segment, row.environment),
        row,
      ]),
    )

    const seen = new Set<string>()
    for (const value of values) {
      const propertyType = byAlias.get(value.alias)
      if (!propertyType) continue
      const culture = propertyType.variesByCulture ? value.culture : null
      const languageId = culture ? (idByIso.get(culture.toLowerCase()) ?? null) : null
      const key = keyOf(
        propertyType.id,
        languageId,
        value.segment ?? null,
        value.environment ?? null,
      )
      if (seen.has(key)) continue
      seen.add(key)
      const existing = current.get(key)
      const raw = existing
        ? (existing.raw as Record<string, unknown>)[STORAGE_COLUMN[propertyType.storage]]
        : null
      if (existing && this.#storedEquals(raw, value.value, propertyType.storage)) continue
      if (!existing && (value.value === null || value.value === undefined)) continue
      await this.#insertValue(
        nodeId,
        eventId,
        state.id,
        propertyType,
        languageId,
        value.segment ?? null,
        value.environment ?? null,
        value.value,
        trueCurrent.get(key)?.id ?? existing?.id,
      )
    }
    // A value that was current but is no longer sent is cleared, as a version. A
    // property's environment values stay unless the save sends some for it: the
    // editor sends only the shared value (story 387).
    const sendsEnvironment = new Set(values.filter((v) => v.environment).map((v) => v.alias))
    for (const [key, row] of current) {
      if (seen.has(key)) continue
      const propertyType = byId.get(row.propertyTypeId)
      if (!propertyType) continue
      if (row.environment && !sendsEnvironment.has(propertyType.alias)) continue
      const raw = (row.raw as Record<string, unknown>)[STORAGE_COLUMN[propertyType.storage]]
      if (raw === null || raw === undefined) continue
      await this.#insertValue(
        nodeId,
        eventId,
        state.id,
        propertyType,
        row.languageId,
        row.segment,
        row.environment,
        null,
        trueCurrent.get(key)?.id ?? row.id,
      )
    }
  }

  /** Makes `target` the current set: used by rollback. */
  async #appendRows(
    nodeId: number,
    eventId: number,
    state: SchemaStateRow,
    target: readonly ValueRow[],
    current: readonly ValueRow[],
  ): Promise<void> {
    const types = new Map<number, PropertyTypeRow>()
    for (const row of [...target, ...current]) {
      if (types.has(row.propertyTypeId)) continue
      const found = await this.#db.q
        .selectFrom('property_type as p')
        .innerJoin('data_type as d', 'd.node_id', 'p.data_type_id')
        .select(['p.id', 'p.alias', 'p.variations', 'd.db_type', 'd.editor_alias'])
        .where('p.id', '=', row.propertyTypeId)
        .execute()
      const r = found[0]
      if (r)
        types.set(row.propertyTypeId, {
          id: Number(r.id),
          alias: String(r.alias),
          name: String(r.alias),
          variesByCulture: flagVariesByCulture(Number(r.variations)),
          storage: String(r.db_type) as ValueStorageTypeName,
          editorAlias: String(r.editor_alias),
          config: {},
          // Only storage matters here: writes never validate or render.
          mandatory: false,
          mandatoryMessage: null,
          regEx: null,
          regExMessage: null,
          pending: false,
        })
    }
    const currentByKey = new Map(
      current.map((row) => [
        keyOf(row.propertyTypeId, row.languageId, row.segment, row.environment),
        row,
      ]),
    )
    const seen = new Set<string>()
    for (const row of target) {
      const propertyType = types.get(row.propertyTypeId)
      if (!propertyType) continue
      const key = keyOf(row.propertyTypeId, row.languageId, row.segment, row.environment)
      seen.add(key)
      const column = STORAGE_COLUMN[propertyType.storage]
      const wanted = this.#fromStorage(
        (row.raw as Record<string, unknown>)[column],
        propertyType.storage,
      )
      const existing = currentByKey.get(key)
      if (
        existing &&
        this.#storedEquals(
          (existing.raw as Record<string, unknown>)[column],
          wanted,
          propertyType.storage,
        )
      )
        continue
      await this.#insertValue(
        nodeId,
        eventId,
        state.id,
        propertyType,
        row.languageId,
        row.segment,
        row.environment,
        wanted,
        existing?.id,
      )
    }
    for (const [key, row] of currentByKey) {
      if (seen.has(key)) continue
      const propertyType = types.get(row.propertyTypeId)
      if (!propertyType) continue
      await this.#insertValue(
        nodeId,
        eventId,
        state.id,
        propertyType,
        row.languageId,
        row.segment,
        row.environment,
        null,
        row.id,
      )
    }
  }

  async #insertValue(
    nodeId: number,
    eventId: number,
    schemaStateId: number,
    propertyType: PropertyTypeRow,
    languageId: number | null,
    segment: string | null,
    environment: string | null,
    value: unknown,
    supersedes: number | undefined,
  ): Promise<void> {
    const column = STORAGE_COLUMN[propertyType.storage]
    // A workspace's value is never current: Shared's stays what everyone reads.
    const inWorkspace = this.#workspace !== undefined
    if (supersedes !== undefined && !inWorkspace) {
      await this.#db.q
        .updateTable('property_value')
        .set({ is_current: this.#db.dialect.boolValue(false) as boolean })
        .where('id', '=', supersedes)
        .execute()
    }
    await this.#db.q
      .insertInto('property_value')
      .values({
        node_id: nodeId,
        property_type_id: propertyType.id,
        language_id: languageId,
        segment,
        environment,
        event_id: eventId,
        schema_state_id: schemaStateId,
        is_current: this.#db.dialect.boolValue(!inWorkspace) as boolean,
        workspace_id: this.#workspace ?? null,
        [column]: this.#toStorage(value, propertyType.storage),
        sortable_value: typeof value === 'string' ? value.slice(0, 512) : null,
      } as Insertable<CoreTables['property_value']>)
      .execute()
  }

  /**
   * A mandatory property must have a current value before publishing. Pending
   * properties are exempt: a field created early for the next deploy never
   * blocks a publish on the live site.
   */
  async #assertMandatoryFilled(node: NodeRow, cultures: readonly string[] | null): Promise<void> {
    const contentTypeNodeId = await this.#contentTypeNodeId(node.id)
    if (!contentTypeNodeId) return
    const propertyTypes = await this.#propertyTypes(contentTypeNodeId)
    const languages = await this.#languages()
    const values = await this.#readValues(node.id, propertyTypes, languages, {})
    const errors = validateValues(
      propertyTypes,
      values,
      cultures ?? languages.map((l) => l.isoCode),
    )
    if (errors.length > 0) {
      const names = errors.map(
        (e) => `'${propertyTypes.find((p) => p.alias === e.alias)?.name ?? e.alias}'`,
      )
      throw new PublishBlockedError(
        `Required: ${[...new Set(names)].join(', ')} must have a value before publishing.`,
        errors,
      )
    }
  }

  /**
   * What the editor is told before a save: mandatory and pattern rules over the
   * values as sent, per culture the document has (or the cultures asked for).
   * Pending properties are exempt, as at publish.
   */
  async validate(
    input: {
      contentTypeKey?: string
      key?: string
      values: readonly DocumentValue[]
      variants: SaveDocumentInput['variants']
    },
    cultures: readonly string[] | null = null,
  ): Promise<DocumentValidationError[]> {
    let contentTypeNodeId: number | undefined
    if (input.contentTypeKey)
      contentTypeNodeId = (await this.#nodes.byKey(input.contentTypeKey))?.id
    else if (input.key) {
      const node = await this.#nodes.byKey(input.key)
      if (node) contentTypeNodeId = await this.#contentTypeNodeId(node.id)
    }
    if (!contentTypeNodeId) return []
    const propertyTypes = await this.#propertyTypes(contentTypeNodeId)
    const variantCultures = input.variants
      .map((v) => v.culture)
      .filter((c): c is string => typeof c === 'string')
    return validateValues(propertyTypes, input.values, cultures ?? variantCultures)
  }

  /** Creates and publishes in one go, or refuses before creating anything. */
  async createAndPublish(
    input: SaveDocumentInput,
    cultures: readonly string[] | null,
  ): Promise<
    { ok: true; document: DocumentAggregate } | { ok: false; errors: DocumentValidationError[] }
  > {
    const errors = await this.validate(input, cultures)
    if (errors.length > 0) return { ok: false, errors }
    if (input.parentKey) {
      const parent = await this.#nodes.byKey(input.parentKey)
      if (parent && !(await this.#ancestorsPublished({ ...parent, path: `${parent.path},0` })))
        throw new PublishBlockedError('An ancestor is not published.')
    }
    const created = await this.create(input)
    const published = await this.publish(created.key, cultures)
    return { ok: true, document: published ?? created }
  }

  async updateAndPublish(
    input: SaveDocumentInput,
    cultures: readonly string[] | null,
  ): Promise<
    | { ok: true; document: DocumentAggregate }
    | { ok: false; errors: DocumentValidationError[] }
    | undefined
  > {
    const errors = await this.validate(input, cultures)
    if (errors.length > 0) return { ok: false, errors }
    const updated = await this.update(input)
    if (!updated) return undefined
    const published = await this.publish(input.key, cultures)
    return { ok: true, document: published ?? updated }
  }

  /** The published version's values, or undefined when nothing is published. */
  async byKeyPublished(key: string): Promise<DocumentAggregate | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node) return undefined
    const draft = await this.#load(node)
    if (!draft?.published) return undefined
    const published = await this.#db.q
      .selectFrom('content_version as cv')
      .innerJoin('document_version as dv', (join) =>
        join
          .onRef('dv.id', '=', 'cv.id')
          .on('dv.published', '=', this.#db.dialect.boolValue(true) as boolean),
      )
      .select('cv.id')
      .where('cv.node_id', '=', node.id)
      .orderBy('cv.id', 'desc')
      .limit(1)
      .execute()
    const eventId = Number(published[0]?.id)
    const contentTypeNodeId = await this.#contentTypeNodeId(node.id)
    if (!contentTypeNodeId || !eventId) return undefined
    const propertyTypes = await this.#propertyTypes(contentTypeNodeId)
    const values = await this.#readPublishedValues(
      node.id,
      propertyTypes,
      await this.#languages(),
      eventId,
      await this.#publishedCultureEvents(node.id),
    )
    return { ...draft, values }
  }

  /**
   * Whether each page has public access rules of its own or from a page above
   * it, as Umbraco's `isProtected` means, in one read for them all.
   */
  async protectedKeys(rows: readonly NodeRow[]): Promise<Set<string>> {
    const pathIds = (row: NodeRow) =>
      row.path
        .split(',')
        .map(Number)
        .filter((id) => id > 0)
    const guarded = await this.#protectedIds([...new Set(rows.flatMap(pathIds))])
    return new Set(
      rows.filter((row) => pathIds(row).some((id) => guarded.has(id))).map((row) => row.key),
    )
  }

  async #protectedIds(ids: readonly number[]): Promise<Set<number>> {
    if (ids.length === 0 || this.objectType !== ObjectTypes.Document) return new Set()
    const rows = await this.#db.q
      .selectFrom('public_access')
      .select('node_id')
      .where('node_id', 'in', ids)
      .execute()
    return new Set(rows.map((row) => Number(row.node_id)))
  }

  /**
   * The content tree's view of documents: five queries a page, whatever its
   * size. Only what a tree item shows is read — not the values, nor the
   * schedules the editor needs.
   */
  async treeItems(rows: readonly NodeRow[]): Promise<DocumentTreeItem[]> {
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const counts = await this.#nodes.childCounts(ids, this.objectType)
    if (this.#workspace !== undefined)
      for (const row of await this.#db.q
        .selectFrom('node')
        .select((eb) => ['parent_id', eb.fn.countAll().as('n')])
        .where('parent_id', 'in', ids)
        .where('workspace_id', '=', this.#workspace)
        .groupBy('parent_id')
        .execute())
        counts.set(Number(row.parent_id), (counts.get(Number(row.parent_id)) ?? 0) + Number(row.n))
    const facts = await this.#db.q
      .selectFrom('node as n')
      .innerJoin('content as c', 'c.node_id', 'n.id')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .innerJoin('node as ctn', 'ctn.id', 'ct.node_id')
      .innerJoin('document as d', 'd.node_id', 'n.id')
      .innerJoin('content_version as head', (join) =>
        join
          .onRef('head.node_id', '=', 'n.id')
          .on('head.current', '=', this.#db.dialect.boolValue(true) as boolean),
      )
      .select([
        'n.id',
        'ctn.unique_id as content_type_key',
        'ct.icon as content_type_icon',
        'ct.list_view as content_type_collection',
        'd.published',
        'd.edited',
        'head.text as draft_name',
      ])
      .where('n.id', 'in', ids)
      .execute()
    const factsById = new Map(facts.map((row) => [Number(row.id), row]))
    const cultures = await this.#db.q
      .selectFrom('document_culture_variation as dcv')
      .innerJoin('language as l', 'l.id', 'dcv.language_id')
      .select([
        'dcv.node_id',
        'dcv.name',
        'dcv.published',
        'dcv.edited',
        'dcv.available',
        'l.iso_code',
      ])
      .where('dcv.node_id', 'in', ids)
      .execute()
    const culturesById = new Map<number, typeof cultures>()
    for (const row of cultures)
      culturesById.set(Number(row.node_id), [...(culturesById.get(Number(row.node_id)) ?? []), row])
    // Every ancestor the page's paths name, parents included, in one read.
    const pathIds = (row: NodeRow) =>
      row.path
        .split(',')
        .map(Number)
        .filter((id) => id > 0 && id !== row.id)
    const above = new Map(
      (await this.#nodes.byIds([...new Set(rows.flatMap(pathIds))])).map((n) => [n.id, n]),
    )
    // Public access on the pages or above them, and their publishes to come, in one read.
    const marks = await this.#db.q
      .selectFrom('public_access')
      .select((eb) => [
        'node_id',
        eb.val('protected').as('mark'),
        sql<string | null>`null`.as('iso_code'),
      ])
      .where(
        'node_id',
        'in',
        this.objectType === ObjectTypes.Document
          ? [...new Set([...ids, ...rows.flatMap(pathIds)])]
          : [-1],
      )
      .unionAll((eb) =>
        eb
          .selectFrom('content_schedule as s')
          .leftJoin('language as l', 'l.id', 's.language_id')
          .select((e) => ['s.node_id', e.val('release').as('mark'), 'l.iso_code'])
          .where('s.node_id', 'in', ids)
          .where('s.action', '=', 'Release'),
      )
      .execute()
    const guarded = new Set(
      marks.filter((m) => m.mark === 'protected').map((m) => Number(m.node_id)),
    )
    const releases = marks.filter((m) => m.mark === 'release')
    const scheduled = (id: number, culture: string | null) =>
      releases.some(
        (r) =>
          Number(r.node_id) === id &&
          ((r.iso_code as string | null) ?? null)?.toLowerCase() === culture?.toLowerCase(),
      )

    const items: DocumentTreeItem[] = []
    for (const row of rows) {
      // A page the workspace changed or made is named and stated as it is there.
      const touched = await this.#workspaceDocument(row.id)
      const mine = touched ? await this.#loadInWorkspace(row, touched) : undefined
      const fact = factsById.get(row.id)
      if (mine) {
        const parent = row.parentId > 0 ? above.get(row.parentId) : undefined
        items.push({
          workspaceChanged: true,
          key: row.key,
          name: mine.variants[0]?.name ?? row.text ?? '',
          hasChildren: (counts.get(row.id) ?? 0) > 0,
          parentKey: parent ? parent.key : null,
          contentTypeKey: mine.contentTypeKey,
          contentTypeCollectionKey: mine.contentTypeCollectionKey,
          icon: mine.contentTypeIcon,
          isTrashed: row.trashed,
          createDate: row.createDate ?? new Date(),
          ancestorKeys: pathIds(row)
            .map((id) => above.get(id))
            .filter((n): n is NodeRow => n !== undefined && this.sees(n))
            .map((a) => a.key),
          isProtected: guarded.has(row.id) || pathIds(row).some((id) => guarded.has(id)),
          variants: mine.variants.map((v) => ({
            culture: v.culture,
            name: v.name,
            state: v.state,
            scheduledForPublish: scheduled(row.id, v.culture),
          })),
        })
        continue
      }
      if (!fact) continue
      const ancestors = pathIds(row)
        .map((id) => above.get(id))
        .filter((n): n is NodeRow => n !== undefined)
      const parent = row.parentId > 0 ? above.get(row.parentId) : undefined
      const own = culturesById.get(row.id) ?? []
      items.push({
        key: row.key,
        name: row.text ?? '',
        hasChildren: (counts.get(row.id) ?? 0) > 0,
        parentKey: parent ? parent.key : null,
        contentTypeKey: normaliseUuid(String(fact.content_type_key)),
        contentTypeCollectionKey: fact.content_type_collection
          ? normaliseUuid(String(fact.content_type_collection))
          : null,
        icon: String(fact.content_type_icon ?? 'icon-document'),
        isTrashed: row.trashed,
        createDate: row.createDate ?? new Date(),
        ancestorKeys: ancestors.filter((a) => a.objectType === this.objectType).map((a) => a.key),
        isProtected: guarded.has(row.id) || pathIds(row).some((id) => guarded.has(id)),
        variants:
          own.length === 0
            ? [
                {
                  culture: null,
                  name: String(fact.draft_name ?? row.text ?? ''),
                  state: stateFor(fromDbBool(fact.published), fromDbBool(fact.edited), row.trashed),
                  scheduledForPublish: scheduled(row.id, null),
                },
              ]
            : own.map((c) => ({
                culture: String(c.iso_code),
                name: String(c.name ?? ''),
                scheduledForPublish: scheduled(row.id, String(c.iso_code)),
                state: stateFor(
                  fromDbBool(c.published),
                  fromDbBool(c.edited),
                  row.trashed,
                  fromDbBool(c.available),
                ),
              })),
      })
    }
    return items
  }

  /** Where a trashed document was before the bin, when it was not at the root. */
  async originalParent(key: string): Promise<string | null | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node) return undefined
    const rows = await this.#db.q
      .selectFrom('document')
      .select('original_parent_id')
      .where('node_id', '=', node.id)
      .execute()
    const parentId = rows[0]?.original_parent_id
    if (parentId === null || parentId === undefined) return null
    return (await this.#nodes.byId(Number(parentId)))?.key ?? null
  }

  /** Other nodes drop their published cache when they see this; media, only that item (story 197). */
  async #instructContent(key: string): Promise<void> {
    await appendCacheInstruction(this.#db, {
      kind: 'content',
      payload: this.objectType === ObjectTypes.Media ? { media: [key] } : { key },
      by: this.#nodeId,
    })
  }

  async #insertEvent(
    nodeId: number,
    kind: EventKind,
    name: string,
    userId: number | undefined,
    templateId: number | null,
    published: boolean,
  ): Promise<number> {
    const t = this.#db.dialect.boolValue(true) as boolean
    const f = this.#db.dialect.boolValue(false) as boolean
    await this.#db.q
      .updateTable('content_version')
      .set({ current: f })
      .where('node_id', '=', nodeId)
      .where('workspace_id', 'is', null)
      .execute()
    await this.#db.q
      .insertInto('content_version')
      .values({
        node_id: nodeId,
        kind,
        version_date: DbDate.toDb(new Date()),
        user_id: userId ?? null,
        current: t,
        text: name,
        prevent_cleanup: f,
      })
      .execute()
    const rows = await this.#db.q
      .selectFrom('content_version')
      .select((eb) => eb.fn.max('id').as('id'))
      .where('node_id', '=', nodeId)
      .where('workspace_id', 'is', null)
      .execute()
    const eventId = Number(rows[0]?.id)
    await this.#db.q
      .insertInto('document_version')
      .values({
        id: eventId,
        template_id: templateId,
        published: this.#db.dialect.boolValue(published) as boolean,
      })
      .execute()
    // Every change to what an item says is an event, so this is where the search index hears of it.
    await queueForSearch(this.#db, [nodeId])
    return eventId
  }

  async #headEvent(
    nodeId: number,
  ): Promise<
    { id: number; name: string; userId: number | undefined; templateId: number | null } | undefined
  > {
    const rows = await this.#db.q
      .selectFrom('content_version as cv')
      .innerJoin('document_version as dv', 'dv.id', 'cv.id')
      .select(['cv.id', 'cv.text', 'cv.user_id', 'dv.template_id'])
      .where('cv.node_id', '=', nodeId)
      .where('cv.workspace_id', 'is', null)
      .orderBy('cv.id', 'desc')
      .limit(1)
      .execute()
    const row = rows[0]
    if (!row) return undefined
    return {
      id: Number(row.id),
      name: String(row.text ?? ''),
      userId: row.user_id === null || row.user_id === undefined ? undefined : Number(row.user_id),
      templateId:
        row.template_id === null || row.template_id === undefined ? null : Number(row.template_id),
    }
  }

  async #publishedEventId(nodeId: number): Promise<number | undefined> {
    const rows = await this.#db.q
      .selectFrom('content_version as cv')
      .innerJoin('document_version as dv', 'dv.id', 'cv.id')
      .select('cv.id')
      .where('cv.node_id', '=', nodeId)
      .where('dv.published', '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    return rows[0] ? Number(rows[0].id) : undefined
  }

  /** `edited`: any value newer than the published event, or a changed name. */
  async #recomputeEdited(nodeId: number): Promise<void> {
    const publishedId = await this.#publishedEventId(nodeId)
    let edited = true
    if (publishedId !== undefined) {
      const newer = await this.#db.q
        .selectFrom('property_value')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('node_id', '=', nodeId)
        .where('workspace_id', 'is', null)
        .where('event_id', '>', publishedId)
        .execute()
      const names = await this.#db.q
        .selectNoFrom((eb) => [
          eb
            .selectFrom('content_version')
            .select('text')
            .where('node_id', '=', nodeId)
            .where('workspace_id', 'is', null)
            .orderBy('id', 'desc')
            .limit(1)
            .as('head'),
          eb.selectFrom('content_version').select('text').where('id', '=', publishedId).as('pub'),
        ])
        .execute()
      edited = Number(newer[0]?.n ?? 0) > 0 || (names[0]?.head ?? '') !== (names[0]?.pub ?? '')
    }
    await this.#db.q
      .updateTable('document')
      .set({ edited: this.#db.dialect.boolValue(edited) as boolean })
      .where('node_id', '=', nodeId)
      .execute()
    // A published culture is edited when its values, the invariant ones, or its name moved on
    for (const culture of await this.#publishedCultureEvents(nodeId)) {
      const newer = await this.#db.q
        .selectFrom('property_value')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('node_id', '=', nodeId)
        .where('workspace_id', 'is', null)
        .where('event_id', '>', culture.eventId)
        .where((eb) =>
          eb.or([eb('language_id', '=', culture.languageId), eb('language_id', 'is', null)]),
        )
        .execute()
      const names = await this.#db.q
        .selectFrom('document_culture_variation')
        .select(['name', 'published_name'])
        .where('node_id', '=', nodeId)
        .where('language_id', '=', culture.languageId)
        .execute()
      const cultureEdited =
        Number(newer[0]?.n ?? 0) > 0 || (names[0]?.name ?? '') !== (names[0]?.published_name ?? '')
      await this.#db.q
        .updateTable('document_culture_variation')
        .set({ edited: this.#db.dialect.boolValue(cultureEdited) as boolean })
        .where('node_id', '=', nodeId)
        .where('language_id', '=', culture.languageId)
        .execute()
    }
  }

  async #readVariants(node: NodeRow, row: Record<string, unknown>): Promise<DocumentVariant[]> {
    const variants = await this.#readVariantsUnscheduled(node, row)
    const schedules = await this.schedules(node.key)
    if (schedules.length === 0) return variants
    return variants.map((variant) => {
      const mine = schedules.filter(
        (s) => (s.culture ?? '').toLowerCase() === (variant.culture ?? '').toLowerCase(),
      )
      return {
        ...variant,
        scheduledPublishDate: mine.find((s) => s.action === 'Release')?.date ?? null,
        scheduledUnpublishDate: mine.find((s) => s.action === 'Expire')?.date ?? null,
      }
    })
  }

  async #readVariantsUnscheduled(
    node: NodeRow,
    row: Record<string, unknown>,
  ): Promise<DocumentVariant[]> {
    const published = fromDbBool(row.published)
    const edited = fromDbBool(row.edited)
    const createDate = node.createDate ?? new Date()
    const updateDate = DbDate.fromDb(row.draft_date) ?? createDate
    const publishDate = DbDate.fromDb(row.published_date) ?? null
    const cultureRows = await this.#db.q
      .selectFrom('document_culture_variation as dcv')
      .innerJoin('language as l', 'l.id', 'dcv.language_id')
      .select(['dcv.name', 'dcv.published', 'dcv.edited', 'dcv.available', 'l.iso_code'])
      .where('dcv.node_id', '=', node.id)
      .execute()
    if (cultureRows.length === 0) {
      return [
        {
          culture: null,
          segment: null,
          name: String(row.draft_name ?? node.text ?? ''),
          state: stateFor(published, edited, node.trashed),
          createDate,
          updateDate,
          publishDate,
        },
      ]
    }
    return cultureRows.map((cultureRow) => ({
      culture: String(cultureRow.iso_code),
      segment: null,
      name: String(cultureRow.name ?? ''),
      state: stateFor(
        fromDbBool(cultureRow.published),
        fromDbBool(cultureRow.edited),
        node.trashed,
        fromDbBool(cultureRow.available),
      ),
      createDate,
      updateDate,
      publishDate,
    }))
  }

  async #writeCultureVariations(
    nodeId: number,
    eventId: number,
    variants: ReadonlyArray<{ culture: string | null; name: string }>,
  ): Promise<void> {
    const cultured = variants.filter((variant) => variant.culture !== null)
    if (cultured.length === 0) return
    const languages = await this.#languages()
    const idByIso = new Map(languages.map((l) => [l.isoCode.toLowerCase(), l.id]))
    const now = DbDate.toDb(new Date())
    const t = this.#db.dialect.boolValue(true) as boolean
    const f = this.#db.dialect.boolValue(false) as boolean
    for (const variant of cultured) {
      const languageId = idByIso.get(String(variant.culture).toLowerCase())
      if (!languageId) continue
      await this.#db.q
        .insertInto('content_version_culture_variation')
        .values({ version_id: eventId, language_id: languageId, name: variant.name, date: now })
        .execute()
      const existing = await this.#db.q
        .selectFrom('document_culture_variation')
        .select('id')
        .where('node_id', '=', nodeId)
        .where('language_id', '=', languageId)
        .execute()
      if (existing[0]) {
        await this.#db.q
          .updateTable('document_culture_variation')
          .set({ name: variant.name, available: t, edited: t })
          .where('id', '=', Number(existing[0].id))
          .execute()
      } else {
        await this.#db.q
          .insertInto('document_culture_variation')
          .values({
            node_id: nodeId,
            language_id: languageId,
            edited: t,
            available: t,
            published: f,
            name: variant.name,
          })
          .execute()
      }
    }
  }

  async #copyCultureVariations(fromEventId: number, toEventId: number): Promise<void> {
    await this.#db.q
      .insertInto('content_version_culture_variation')
      .columns(['version_id', 'language_id', 'name', 'date', 'available_user_id'])
      .expression((eb) =>
        eb
          .selectFrom('content_version_culture_variation')
          .select([
            eb.val(toEventId).as('version_id'),
            'language_id',
            'name',
            'date',
            'available_user_id',
          ])
          .where('version_id', '=', fromEventId),
      )
      .execute()
  }

  async #availableCultures(nodeId: number): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('document_culture_variation as dcv')
      .innerJoin('language as l', 'l.id', 'dcv.language_id')
      .select('l.iso_code')
      .where('dcv.node_id', '=', nodeId)
      .where('dcv.available', '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    return rows.map((row) => String(row.iso_code))
  }

  async #publishedCultures(nodeId: number): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('document_culture_variation as dcv')
      .innerJoin('language as l', 'l.id', 'dcv.language_id')
      .select('l.iso_code')
      .where('dcv.node_id', '=', nodeId)
      .where('dcv.published', '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    return rows.map((row) => String(row.iso_code))
  }

  /** Publishes a culture at `eventId` with its current name, or unpublishes it (`null`). */
  async #setCulturePublished(nodeId: number, iso: string, eventId: number | null): Promise<void> {
    const languages = await this.#languages()
    const languageId = languages.find((l) => l.isoCode.toLowerCase() === iso.toLowerCase())?.id
    if (!languageId) return
    if (eventId === null)
      await this.#db.q
        .updateTable('document_culture_variation')
        .set({
          published: this.#db.dialect.boolValue(false) as boolean,
          edited: this.#db.dialect.boolValue(true) as boolean,
        })
        .where('node_id', '=', nodeId)
        .where('language_id', '=', languageId)
        .execute()
    else
      await this.#db.q
        .updateTable('document_culture_variation')
        .set((eb) => ({
          published: this.#db.dialect.boolValue(true) as boolean,
          edited: this.#db.dialect.boolValue(false) as boolean,
          published_event_id: eventId,
          published_name: eb.ref('name'),
        }))
        .where('node_id', '=', nodeId)
        .where('language_id', '=', languageId)
        .execute()
  }

  /** Each published culture: its language, the event it was published at, and its published name. */
  async #publishedCultureEventsFor(
    ids: readonly number[],
  ): Promise<Map<number, PublishedCulture[]>> {
    const out = new Map<number, PublishedCulture[]>()
    if (ids.length === 0) return out
    const rows = await this.#db.q
      .selectFrom('document_culture_variation as dcv')
      .innerJoin('language as l', 'l.id', 'dcv.language_id')
      .select([
        'dcv.node_id',
        'dcv.language_id',
        'l.iso_code',
        'dcv.published_event_id',
        'dcv.published_name',
        'dcv.name',
      ])
      .where('dcv.node_id', 'in', ids)
      .where('dcv.published', '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    for (const row of rows) {
      const id = Number(row.node_id)
      out.set(id, [
        ...(out.get(id) ?? []),
        {
          languageId: Number(row.language_id),
          isoCode: String(row.iso_code),
          eventId: Number(row.published_event_id ?? 0),
          name: String(row.published_name ?? row.name ?? ''),
        },
      ])
    }
    return out
  }

  /** Each node's value history, oldest first. */
  async #valueHistoryFor(
    ids: readonly number[],
    schemaStateId?: number,
  ): Promise<Map<number, ValueRow[]>> {
    const out = new Map<number, ValueRow[]>()
    if (ids.length === 0) return out
    const rows = await this.#db.q
      .selectFrom('property_value')
      .select([
        'id',
        'node_id',
        'event_id',
        'property_type_id',
        'language_id',
        'segment',
        'environment',
        'int_value',
        'decimal_value',
        'date_value',
        'varchar_value',
        'text_value',
      ])
      .where('node_id', 'in', ids)
      .where('workspace_id', 'is', null)
      .$if(schemaStateId !== undefined, (q) =>
        q.where('schema_state_id', '<=', schemaStateId as number),
      )
      .orderBy('node_id')
      .orderBy('id')
      .execute()
    for (const row of rows) {
      const id = Number(row.node_id)
      const list = out.get(id)
      if (list) list.push(this.#toValueRow(row))
      else out.set(id, [this.#toValueRow(row)])
    }
    return out
  }

  async #publishedCultureEvents(nodeId: number): Promise<PublishedCulture[]> {
    const rows = await this.#db.q
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
      .where('dcv.published', '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    return rows.map((row) => ({
      languageId: Number(row.language_id),
      isoCode: String(row.iso_code),
      eventId: Number(row.published_event_id ?? 0),
      name: String(row.published_name ?? row.name ?? ''),
    }))
  }

  async #variesByCulture(nodeId: number): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('content as c')
      .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
      .select('ct.variations')
      .where('c.node_id', '=', nodeId)
      .execute()
    return flagVariesByCulture(Number(rows[0]?.variations ?? 0))
  }

  /**
   * Published values: invariant ones as of the latest publish, each culture's
   * as of its own. A culture that is not published contributes nothing.
   */
  async #readPublishedValues(
    nodeId: number,
    propertyTypes: readonly PropertyTypeRow[],
    languages: readonly LanguageRow[],
    invariantEventId: number,
    cultures: ReadonlyArray<{ languageId: number; eventId: number }>,
    schemaStateId?: number,
  ): Promise<DocumentValue[]> {
    const latest = Math.max(invariantEventId, ...cultures.map((c) => c.eventId))
    const all = (
      await this.#db.q
        .selectFrom('property_value')
        .select([
          'id',
          'event_id',
          'property_type_id',
          'language_id',
          'segment',
          'environment',
          'int_value',
          'decimal_value',
          'date_value',
          'varchar_value',
          'text_value',
        ])
        .where('node_id', '=', nodeId)
        .where('workspace_id', 'is', null)
        .where('event_id', '<=', latest)
        .$if(schemaStateId !== undefined, (q) =>
          q.where('schema_state_id', '<=', schemaStateId as number),
        )
        .orderBy('id')
        .execute()
    ).map((row) => this.#toValueRow(row))
    return this.#valuesFromRows(
      publishedValueRows(all, invariantEventId, cultures),
      propertyTypes,
      languages,
    )
  }

  async #anyCulturePublished(nodeId: number): Promise<boolean> {
    const rows = await this.#db.q
      .selectFrom('document_culture_variation')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('node_id', '=', nodeId)
      .where('published', '=', this.#db.dialect.boolValue(true) as boolean)
      .execute()
    return Number(rows[0]?.n ?? 0) > 0
  }

  async #ancestorsPublished(
    node: NodeRow,
    alsoPublishing: ReadonlySet<number> = new Set(),
  ): Promise<boolean> {
    const ids = node.path
      .split(',')
      .map(Number)
      .filter((id) => id > 0 && id !== node.id && !alsoPublishing.has(id))
    if (ids.length === 0) return true
    const rows = await this.#db.q
      .selectFrom('document')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('node_id', 'in', ids)
      .where('published', '=', this.#db.dialect.boolValue(false) as boolean)
      .execute()
    return Number(rows[0]?.n ?? 0) === 0
  }
}

function stateFor(
  published: boolean,
  edited: boolean,
  trashed: boolean,
  available = true,
): VariantState {
  if (trashed) return 'Trashed'
  if (!available) return 'NotCreated'
  if (published) return edited ? 'PublishedPendingChanges' : 'Published'
  return 'Draft'
}

/** `name`, or the first of `name (1)`, `name (2)`… no sibling already has. */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name.toLowerCase())) return name
  for (let n = 1; ; n++) {
    const candidate = `${name} (${n})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

function parseConfig(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * The newest version id of anything, which moves on every save: how a node's
 * draft cache knows it is stale when the save happened on another node.
 */
export async function latestContentVersionId(db: Db): Promise<number> {
  const rows = await db.q
    .selectFrom('content_version')
    .select((eb) => eb.fn.max('id').as('n'))
    .where('workspace_id', 'is', null)
    .execute()
  return Number(rows[0]?.n ?? 0)
}

/** Each top-most workspace page beneath `branch`, moved to the top of the tree and marked orphaned. */
async function keepWorkspacePages(tx: Db, branch: Pick<NodeRow, 'id' | 'path'>): Promise<void> {
  const found = await tx.q
    .selectFrom('node')
    .select(['id', 'path', 'workspace_id'])
    .where('path', 'like', `${branch.path},%`)
    .where('workspace_id', 'is not', null)
    .orderBy('level')
    .execute()
  const nodes = new NodeRepository(tx)
  const moved: string[] = []
  for (const row of found) {
    const path = String(row.path)
    if (moved.some((top) => path.startsWith(`${top},`))) continue
    const id = Number(row.id)
    await nodes.move(id, SystemNodes.Root)
    moved.push(path)
    await tx.q
      .insertInto('workspace_pending')
      .values({
        workspace_id: Number(row.workspace_id),
        node_id: id,
        kind: 'orphaned',
        target_parent_id: null,
        sort_order: null,
        user_id: null,
        recorded_at: DbDate.toDb(new Date()),
      })
      .execute()
  }
}

/**
 * Every row a node owns, then the node, for a branch (`branch`: the node and all
 * below it, by path) or a set of nodes (`ids`), a statement per table over the
 * whole set rather than one per node (story 246).
 */
export async function deleteNodeRows(
  tx: Db,
  among: { branch: Pick<NodeRow, 'id' | 'path'> } | { ids: readonly number[] },
): Promise<void> {
  const nodes = () =>
    tx.q
      .selectFrom('node')
      .select('id')
      .where((eb) =>
        'ids' in among
          ? eb('id', 'in', [...among.ids])
          : eb.or([eb('id', '=', among.branch.id), eb('path', 'like', `${among.branch.path},%`)]),
      )
  // A page made in a workspace beneath a Shared page that goes is that workspace's
  // work: it moves to the top, marked for the merge to resolve (story 375).
  if (!('ids' in among)) await keepWorkspacePages(tx, among.branch)
  const versions = () =>
    tx.q.selectFrom('content_version').select('id').where('node_id', 'in', nodes())
  // A Shared page a workspace changed leaves a marker its merge must answer (story 380).
  const gone = await tx.q
    .selectFrom('workspace_document as wd')
    .innerJoin('node as n', 'n.id', 'wd.node_id')
    .select(['wd.workspace_id', 'n.id', 'n.text'])
    .where('n.id', 'in', nodes())
    .where('n.workspace_id', 'is', null)
    .execute()
  for (const table of [
    'workspace_pending',
    'workspace_document_culture',
    'workspace_document',
  ] as const)
    await tx.q.deleteFrom(table).where('node_id', 'in', nodes()).execute()
  for (const row of gone)
    await tx.q
      .insertInto('workspace_pending')
      .values({
        workspace_id: Number(row.workspace_id),
        node_id: Number(row.id),
        kind: 'gone',
        target_parent_id: null,
        sort_order: null,
        user_id: null,
        recorded_at: DbDate.toDb(new Date()),
        name: (row.text as string | null) ?? null,
      })
      .execute()
  // Search providers outside the database lose nothing by cascade, so they are told (story 273).
  await recordSearchRemovals(
    tx,
    (await nodes().execute()).map((row) => Number(row.id)),
  )
  await tx.q.deleteFrom('property_value').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('content_schedule').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('workspace_schedule').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('user_notification').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('domain').where('node_id', 'in', nodes()).execute()
  await tx.q
    .deleteFrom('media_access_rule')
    .where('media_access_id', 'in', (eb) =>
      eb.selectFrom('media_access').select('id').where('node_id', 'in', nodes()),
    )
    .execute()
  await tx.q.deleteFrom('media_access').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('node_file').where('node_id', 'in', nodes()).execute()
  await tx.q
    .deleteFrom('content_version_culture_variation')
    .where('version_id', 'in', versions())
    .execute()
  await tx.q.deleteFrom('document_culture_variation').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('document_version').where('id', 'in', versions()).execute()
  await tx.q.deleteFrom('content_version').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('document').where('node_id', 'in', nodes()).execute()
  await tx.q.deleteFrom('content').where('node_id', 'in', nodes()).execute()
  if ('ids' in among)
    await tx.q
      .deleteFrom('node')
      .where('id', 'in', [...among.ids])
      .execute()
  else
    await tx.q
      .deleteFrom('node')
      .where('id', 'in', (eb) =>
        eb
          .selectFrom('node as branch')
          .select('branch.id')
          .where((w) =>
            w.or([
              w('branch.id', '=', among.branch.id),
              w('branch.path', 'like', `${among.branch.path},%`),
            ]),
          ),
      )
      .execute()
}

/** A page's schedule per language, as a change carries it (story 414). */
export interface ScheduleEntryAt {
  culture: string | null
  publishTime: string | null
  unpublishTime: string | null
}

/** A page's schedule rows as entries, in Shared (`workspace` null) or a workspace, by language. */
async function scheduleEntriesOf(
  db: Db,
  nodeId: number,
  workspace: number | null,
): Promise<ScheduleEntryAt[]> {
  const rows = await db.q
    .selectFrom('content_schedule as s')
    .leftJoin('language as l', 'l.id', 's.language_id')
    .select(['s.action', 's.date', 'l.iso_code'])
    .where('s.node_id', '=', nodeId)
    .where('s.workspace_id', workspace === null ? 'is' : '=', workspace)
    .execute()
  const byCulture = new Map<string | null, ScheduleEntryAt>()
  for (const row of rows) {
    const culture = (row.iso_code as string | null) ?? null
    const entry = byCulture.get(culture) ?? { culture, publishTime: null, unpublishTime: null }
    const at = (DbDate.fromDb(row.date) ?? new Date(0)).toISOString()
    if (row.action === 'Release') entry.publishTime = at
    else entry.unpublishTime = at
    byCulture.set(culture, entry)
  }
  return [...byCulture.values()].sort((a, b) => (a.culture ?? '').localeCompare(b.culture ?? ''))
}
