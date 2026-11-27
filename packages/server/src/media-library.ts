/**
 * The media library as the command line and the remote protocol read and change
 * it (story 355): a page of items, one item with its file and who may see it,
 * what uses it, its details and file changed, folders made, and its permissions
 * read and set with the Permissions dialog's own rules. Each call is made for an
 * actor; a person sees and changes only what their start nodes and permissions
 * allow, as in the back office. Writes go through the media operations.
 */
import type { Principal } from '@crombolo/api-management/domain'
import { hasSection } from '@crombolo/api-management/domain'
import {
  formFor,
  inheritedForm,
  requestFor,
  summarise,
} from '@crombolo/backoffice-host/media-access-rules'
import type { Actor, MediaOperations } from '@crombolo/content'
import {
  type DocumentValue,
  fallbackPermissions,
  hasPathAccess,
  IMAGE_CROPPER_EDITOR_ALIAS,
  isProtectedMedia,
  MEMBER_FILE_TYPES,
  MediaPermissions,
  type MediaPolicy,
  mediaFileOf,
  normaliseUuid,
  ObjectTypes,
  SystemNodes,
} from '@crombolo/core'
import {
  appendCacheInstruction,
  ContentTypeRepository,
  currentSchemaState,
  DataTypeRepository,
  type Db,
  DocumentRepository,
  describeRefFailure,
  IMAGE_ALT_TEXT_ALIAS,
  type MediaAccessEntry,
  type MediaAccessGroup,
  type MediaAccessMember,
  MediaAccessRepository,
  MemberRepository,
  NodeRepository,
  type NodeRow,
  ReferenceRepository,
  resolveNodeRef,
  ruleOf,
} from '@crombolo/data'
import { createMediaPort } from './adapters/media.ts'
import type { MediaFileStore } from './media-files.ts'
import { namedPath } from './undo.ts'

export type MediaLibraryErrorKind = 'not_found' | 'usage' | 'refused' | 'forbidden'

/** Why a media item could not be read or changed, in words for a person. */
export class MediaLibraryError extends Error {
  constructor(
    readonly kind: MediaLibraryErrorKind,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}

/** The editors an item's alternative text can be written to. */
const TEXT_EDITORS = new Set(['Umbraco.TextBox', 'Umbraco.TextArea'])

/** The most a page holds. */
export const MEDIA_PAGE_MAX = 100

export interface FocalPoint {
  left: number
  top: number
}

/** `x,y`, each from 0 to 1, as `--focal` takes it; undefined when it is not. Pure. */
export function parseFocalPoint(value: string): FocalPoint | undefined {
  const parts = value.split(',')
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return undefined
  const [left, top] = parts.map(Number) as [number, number]
  return left >= 0 && left <= 1 && top >= 0 && top <= 1 ? { left, top } : undefined
}

const principalOf = (actor: Actor): Principal | undefined =>
  actor.kind === 'user' ? (actor.principal as Principal) : undefined

/** A media node's ancestors' keys then its own, root first. */
export async function mediaChain(db: Db, path: string): Promise<string[]> {
  const ids = path
    .split(',')
    .map(Number)
    .filter((id) => id > 0)
  const byId = new Map((await new NodeRepository(db).byIds(ids)).map((row) => [row.id, row]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    return row && row.objectType === ObjectTypes.Media ? [row.key] : []
  })
}

/** Whether a person may see a media node: the Media section, within their start nodes. */
export async function maySeeMedia(db: Db, principal: Principal, node: NodeRow): Promise<boolean> {
  return (
    hasSection(principal, 'media') &&
    hasPathAccess(principal.startNodes.media, await mediaChain(db, node.path), node.trashed)
  )
}

/** The media item or folder a path or key names, which the actor may see. */
export async function mediaNode(db: Db, actor: Actor, ref: string): Promise<NodeRow> {
  const resolved = await resolveNodeRef(db, [ObjectTypes.Media], ref)
  if (!resolved.ok) throw new MediaLibraryError('not_found', describeRefFailure(ref, resolved))
  const node = resolved.node
  if (node.objectType !== ObjectTypes.Media)
    throw new MediaLibraryError('not_found', `"${ref}" is not a media item.`)
  if (node.trashed)
    throw new MediaLibraryError(
      'not_found',
      `"${ref}" is in the recycle bin.`,
      '`crombolo recycle-bin restore` brings it back.',
    )
  const principal = principalOf(actor)
  if (principal && !(await maySeeMedia(db, principal, node)))
    throw new MediaLibraryError('forbidden', `You may not see "${ref}".`)
  return node
}

/** Its place by name, `/Gallery/hero.jpg`. */
const pathOf = async (db: Db, key: string) => `/${(await namedPath(db, key, 'media')) ?? ''}`

async function mediaDocuments(db: Db) {
  const state = await currentSchemaState(db)
  return new DocumentRepository(db, {
    kind: 'media',
    nodeState: { version: state.version, revision: state.revision },
  })
}

const propertyValue = (values: readonly DocumentValue[], alias: string) =>
  values.find((v) => v.alias === alias && v.segment === null)?.value

const numberOf = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const focalOf = (file: unknown): FocalPoint | null => {
  const focal = (file as { focalPoint?: FocalPoint | null } | null)?.focalPoint
  return focal && typeof focal.left === 'number' && typeof focal.top === 'number'
    ? { left: focal.left, top: focal.top }
    : null
}

/** One item of a page: what the list shows. */
export interface MediaListItem {
  key: string
  name: string
  path: string
  /** The media type's alias. */
  type: string
  folder: boolean
  /** In bytes; null for a folder, or a file whose size is not known. */
  size: number | null
}

export interface MediaPage {
  total: number
  items: MediaListItem[]
}

export interface MediaQuery {
  /** The folder whose items `list` gives, and below which `find` looks; the top when absent. */
  under?: string
  /** A media type, by alias. */
  type?: string
  /** Text the name holds, for `find`. */
  name?: string
  skip?: number
  take?: number
}

/** The paging a request or a flag asks for: 25 by default, at most 100. Pure. */
export const mediaPaging = (skip?: number, take?: number) => ({
  skip: Math.max(0, Math.floor(Number(skip) || 0)),
  take: Math.min(MEDIA_PAGE_MAX, Math.max(1, Math.floor(Number(take) || 25))),
})

/** The media types that hold a file; the others are folders. */
async function fileTypeIds(db: Db): Promise<Set<number>> {
  const rows = await db.q
    .selectFrom('property_type')
    .select('content_type_id')
    .where('alias', '=', 'umbracoFile')
    .execute()
  return new Set(rows.map((row) => Number(row.content_type_id)))
}

async function pageOf(
  db: Db,
  actor: Actor,
  query: MediaQuery,
  below: 'children' | 'descendants',
): Promise<MediaPage> {
  const { skip, take } = mediaPaging(query.skip, query.take)
  const folder = query.under ? await mediaNode(db, actor, query.under) : undefined
  const principal = principalOf(actor)
  const start = principal?.startNodes.media
  let startIds: number[] | undefined
  if (start && !start.root) {
    const nodes = new NodeRepository(db)
    startIds = (await Promise.all(start.keys.map((key) => nodes.byKey(key)))).flatMap((row) =>
      row ? [row.id] : [],
    )
    if (startIds.length === 0) return { total: 0, items: [] }
  }
  const name = query.name?.trim().toLowerCase()
  let q = db.q
    .selectFrom('node as n')
    .innerJoin('content as c', 'c.node_id', 'n.id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .where('n.node_object_type', '=', ObjectTypes.Media)
    .where('n.trashed', '=', db.dialect.boolValue(false))
  if (below === 'children') q = q.where('n.parent_id', '=', folder?.id ?? SystemNodes.Root)
  else if (folder) q = q.where('n.path', 'like', `${folder.path},%`)
  if (query.type) q = q.where('ct.alias', '=', query.type)
  if (name) q = q.where((eb) => eb(eb.fn<string>('lower', ['n.text']), 'like', `%${name}%`))
  if (startIds) {
    const ids = startIds
    q = q.where((eb) =>
      eb.or(
        ids.flatMap((id) => [eb('n.path', 'like', `%,${id},%`), eb('n.path', 'like', `%,${id}`)]),
      ),
    )
  }
  const counted = await q.select((eb) => eb.fn.countAll().as('n')).execute()
  const rows = await q
    .select(['n.unique_id', 'n.text', 'n.path', 'ct.alias', 'c.content_type_id'])
    .orderBy('n.text')
    .orderBy('n.id')
    .offset(skip)
    .limit(take)
    .execute()
  const withFile = await fileTypeIds(db)
  const repo = await mediaDocuments(db)
  const items: MediaListItem[] = []
  for (const row of rows) {
    const key = normaliseUuid(String(row.unique_id))
    const folderType = !withFile.has(Number(row.content_type_id))
    const doc = folderType ? undefined : await repo.byKey(key)
    items.push({
      key,
      name: row.text ?? '',
      path: await pathOf(db, key),
      type: row.alias,
      folder: folderType,
      size: doc ? numberOf(propertyValue(doc.values, 'umbracoBytes')) : null,
    })
  }
  return { total: Number(counted[0]?.n ?? 0), items }
}

/** The items in a folder, or at the top, by name, a page at a time. */
export const listMedia = (db: Db, actor: Actor, query: MediaQuery = {}) =>
  pageOf(db, actor, query, 'children')

/** The items whose names hold `name`, anywhere below `under`, a page at a time. */
export async function findMedia(db: Db, actor: Actor, query: MediaQuery & { name: string }) {
  if (!query.name.trim()) throw new MediaLibraryError('usage', 'Give some of the name to find.')
  return pageOf(db, actor, query, 'descendants')
}

/** What uses a page or media item: its name, what it is, where and of which type. */
export interface Reference {
  key: string
  name: string
  kind: 'page' | 'media' | 'library' | 'member' | 'other'
  path: string | null
  type: string | null
}

export interface ReferencePage {
  total: number
  items: Reference[]
}

const KINDS: Record<string, Reference['kind']> = {
  [ObjectTypes.Document]: 'page',
  [ObjectTypes.Media]: 'media',
  [ObjectTypes.Element]: 'library',
  [ObjectTypes.Member]: 'member',
}

/**
 * What uses a page or media item, from the values as they are now: pickers,
 * links and images in rich text, as the back office's "Used by" finds them.
 */
export async function referencesTo(
  db: Db,
  key: string,
  paging: { skip?: number; take?: number } = {},
): Promise<ReferencePage> {
  const { skip, take } = mediaPaging(paging.skip, paging.take)
  const found = await new ReferenceRepository(db).referencedBy(key, skip, take)
  const items: Reference[] = []
  for (const ref of found.items) {
    const kind = (ref.objectType && KINDS[ref.objectType]) || 'other'
    const named =
      kind === 'page'
        ? await namedPath(db, ref.key, 'content')
        : kind === 'media' || kind === 'library'
          ? await namedPath(db, ref.key, kind)
          : undefined
    items.push({
      key: normaliseUuid(ref.key),
      name: ref.name ?? '',
      kind,
      path: named === undefined ? null : kind === 'library' ? `library:/${named}` : `/${named}`,
      type: ref.contentTypeAlias,
    })
  }
  return { total: found.total, items }
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

const listed = (parts: string[]) =>
  parts.length <= 1
    ? (parts[0] ?? '')
    : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) as string}`

/** "Used by 3 pages and 1 media item", or "Nothing uses it." when nothing does. Pure. */
export function usedByWords(references: ReferencePage): string {
  if (references.total === 0) return 'Nothing uses it.'
  if (references.items.length < references.total)
    return `Used by ${plural(references.total, 'item')}.`
  const count = (kind: Reference['kind']) => references.items.filter((r) => r.kind === kind).length
  const parts = [
    count('page') ? plural(count('page'), 'page') : '',
    count('media') ? plural(count('media'), 'media item') : '',
    count('library') ? plural(count('library'), 'Library item') : '',
    count('member') ? plural(count('member'), 'member') : '',
    count('other') ? plural(count('other'), 'other item') : '',
  ].filter(Boolean)
  return `Used by ${listed(parts)}.`
}

/** One media item as `media show` gives it. */
export interface MediaItem {
  key: string
  name: string
  path: string
  type: { alias: string; name: string }
  folder: boolean
  /** The folder it is in; null at the top. */
  parent: { key: string; name: string; path: string } | null
  /** The address its file is served at; null for a folder or an item with no file. */
  file: string | null
  size: number | null
  width: number | null
  height: number | null
  extension: string | null
  /** Its alternative text; null where its type has none, or none is set. */
  alt: string | null
  focal: FocalPoint | null
  /** Who may see it and change it, in the dialog's words. */
  access: string
  protected: boolean
  references?: ReferencePage
}

/** One item: its type, folder, file, size, alternative text, focal point and who may see it. */
export async function showMedia(
  db: Db,
  actor: Actor,
  ref: string,
  options: { references?: boolean; skip?: number; take?: number } = {},
): Promise<MediaItem> {
  const node = await mediaNode(db, actor, ref)
  const doc = await (await mediaDocuments(db)).byKey(node.key)
  if (!doc) throw new MediaLibraryError('not_found', `"${ref}" is not a media item.`)
  const type = await new ContentTypeRepository(db, { kind: 'media' }).byKey(doc.contentTypeKey)
  const folder = !type?.properties.some((p) => p.alias === 'umbracoFile')
  const parent = node.parentId > 0 ? await new NodeRepository(db).byId(node.parentId) : undefined
  const file = propertyValue(doc.values, 'umbracoFile')
  const alt = propertyValue(doc.values, IMAGE_ALT_TEXT_ALIAS)
  const state = await describeMediaAccess({ db }, node.key)
  return {
    key: node.key,
    name: node.text ?? '',
    path: await pathOf(db, node.key),
    type: { alias: doc.contentTypeAlias, name: type?.name ?? doc.contentTypeAlias },
    folder,
    parent:
      parent && parent.objectType === ObjectTypes.Media
        ? { key: parent.key, name: parent.text ?? '', path: await pathOf(db, parent.key) }
        : null,
    file: mediaFileOf(doc),
    size: numberOf(propertyValue(doc.values, 'umbracoBytes')),
    width: numberOf(propertyValue(doc.values, 'umbracoWidth')),
    height: numberOf(propertyValue(doc.values, 'umbracoHeight')),
    extension: (propertyValue(doc.values, 'umbracoExtension') as string | undefined) || null,
    alt: typeof alt === 'string' && alt !== '' ? alt : null,
    focal: focalOf(file),
    access: state ? summarise(state) : '',
    protected: state?.protected ?? false,
    ...(options.references ? { references: await referencesTo(db, node.key, options) } : {}),
  }
}

/** What `media update` changes; each absent part is left as it is. */
export interface MediaChange {
  name?: string
  alt?: string
  focal?: FocalPoint
  file?: File
}

/** What the media operations and the file store are, for a change. */
export interface MediaWriter {
  db: Db
  media: MediaOperations
  files: MediaFileStore
}

export interface MediaUpdated {
  key: string
  name: string
  path: string
  /** What changed, of name, alt, focal and file; empty when nothing did. */
  changed: Array<'name' | 'alt' | 'focal' | 'file'>
  /** With a new file: what uses the item, which keeps working since its key is kept. */
  references?: ReferencePage
}

/** The editor each property of a media type uses, by alias. */
async function editorsOf(db: Db, typeKey: string): Promise<Map<string, string>> {
  const properties = (await new ContentTypeRepository(db, { kind: 'media' }).byKey(typeKey))
    ?.properties
  const dataTypes = new DataTypeRepository(db)
  const out = new Map<string, string>()
  for (const p of properties ?? [])
    out.set(p.alias, (await dataTypes.byKey(p.dataTypeKey))?.editorAlias ?? '')
  return out
}

/**
 * Refuses alternative text or a focal point a media type cannot hold, naming
 * the item and its type, as `media import` and `media update` both check.
 */
export async function checkMediaDetails(
  db: Db,
  type: { key: string; name: string },
  shown: string,
  details: { alt?: string; focal?: FocalPoint },
  would = false,
): Promise<void> {
  const editors = await editorsOf(db, type.key)
  const is = would ? 'would be' : 'is'
  if (details.alt !== undefined && !TEXT_EDITORS.has(editors.get(IMAGE_ALT_TEXT_ALIAS) ?? ''))
    throw new MediaLibraryError(
      'refused',
      `${shown} ${is} a ${type.name}, which has no text field for its alternative text.`,
    )
  if (details.focal && editors.get('umbracoFile') !== IMAGE_CROPPER_EDITOR_ALIAS)
    throw new MediaLibraryError(
      'refused',
      `${shown} ${is} a ${type.name}, which has no focal point.`,
    )
}

/**
 * Changes an item's name, alternative text, focal point or file, through the
 * media operations, audited as the actor. A new file keeps the item's key, so
 * pickers, links and images that name it show the new file; the old file goes.
 */
export async function updateMedia(
  writer: MediaWriter,
  actor: Actor,
  ref: string,
  change: MediaChange,
  options: { dryRun?: boolean } = {},
): Promise<MediaUpdated> {
  const { db } = writer
  const node = await mediaNode(db, actor, ref)
  const doc = await (await mediaDocuments(db)).byKey(node.key)
  if (!doc) throw new MediaLibraryError('not_found', `"${ref}" is not a media item.`)
  const type = await new ContentTypeRepository(db, { kind: 'media' }).byKey(doc.contentTypeKey)
  const typeName = type?.name ?? doc.contentTypeAlias
  const shown = node.text ?? ref
  await checkMediaDetails(db, { key: doc.contentTypeKey, name: typeName }, shown, change)
  if (change.name !== undefined && change.name.trim() === '')
    throw new MediaLibraryError('usage', 'A media item needs a name.')
  if (change.file) {
    const extension = change.file.name.split('.').pop()?.toLowerCase() ?? ''
    const types = await createMediaPort(db).typesForExtension(
      change.file.name.includes('.') ? extension : '',
    )
    if (!types.some((t) => normaliseUuid(t.key) === normaliseUuid(doc.contentTypeKey))) {
      const takers = types.map((t) => t.name)
      throw new MediaLibraryError(
        'refused',
        `${shown} is a ${typeName}, which does not take a .${extension} file.`,
        takers.length > 0
          ? `A ${listed(takers)} would: import it as a new item instead.`
          : 'No media type on this site takes it.',
      )
    }
  }

  const changed: MediaUpdated['changed'] = []
  let values = doc.values
  const name = node.text ?? ''
  if (change.name !== undefined && change.name !== name) changed.push('name')
  if (change.alt !== undefined && propertyValue(values, IMAGE_ALT_TEXT_ALIAS) !== change.alt) {
    values = [
      ...values.filter((v) => v.alias !== IMAGE_ALT_TEXT_ALIAS),
      { alias: IMAGE_ALT_TEXT_ALIAS, culture: null, segment: null, value: change.alt },
    ]
    changed.push('alt')
  }
  const fileValue = values.find((v) => v.alias === 'umbracoFile' && v.segment === null)
  const focalWas = focalOf(fileValue?.value)
  const focal = change.focal ?? focalWas
  if (change.focal && (focalWas?.left !== change.focal.left || focalWas?.top !== change.focal.top))
    changed.push('focal')
  if (change.file) changed.push('file')
  const references = change.file
    ? await referencesTo(db, node.key, { take: MEDIA_PAGE_MAX })
    : undefined
  const done = async (): Promise<MediaUpdated> => ({
    key: node.key,
    name: change.name ?? name,
    path: await pathOf(db, node.key),
    changed,
    ...(references ? { references } : {}),
  })
  if (changed.length === 0 || options.dryRun) return done()

  const editors = await editorsOf(db, doc.contentTypeKey)
  const cropper = editors.get('umbracoFile') === IMAGE_CROPPER_EDITOR_ALIAS
  let upload: string | undefined
  if (change.file) {
    upload = crypto.randomUUID()
    await writer.files.saveTemporary(upload, change.file)
  }
  if (upload || changed.includes('focal')) {
    const was = (fileValue?.value ?? {}) as Record<string, unknown>
    const next = upload
      ? cropper
        ? {
            temporaryFileId: upload,
            crops: Array.isArray(was.crops) ? was.crops : [],
            focalPoint: focal,
          }
        : { temporaryFileId: upload }
      : { ...was, focalPoint: focal }
    values = [
      ...values.filter((v) => !(v.alias === 'umbracoFile' && v.segment === null)),
      { alias: 'umbracoFile', culture: null, segment: null, value: next },
    ]
  }
  const saved = await writer.media.save(actor, node.key, {
    contentTypeKey: doc.contentTypeKey,
    parentKey: doc.parentKey,
    values,
    variants: doc.variants.map((v) => ({
      culture: v.culture,
      segment: v.segment,
      name: change.name ?? v.name,
    })),
  })
  if (!saved.ok)
    throw new MediaLibraryError(
      saved.kind === 'notFound'
        ? 'not_found'
        : saved.kind === 'forbidden'
          ? 'forbidden'
          : 'refused',
      saved.reason,
    )
  return done()
}

export interface FoldersMade {
  /** The folder the path names. */
  key: string
  path: string
  /** The folders made, top first; empty when they were all there. */
  made: string[]
}

/** Each folder along `path` that is missing, through the media operations; none already there. */
export async function makeFolders(
  writer: Pick<MediaWriter, 'db' | 'media'>,
  actor: Actor,
  path: string,
): Promise<FoldersMade> {
  const { db } = writer
  const names = path
    .split('/')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.length === 0)
    throw new MediaLibraryError('usage', 'Name the folder to make, as /Gallery/2026.')
  const nodes = new NodeRepository(db)
  const folderTypes = await createMediaPort(db).folderTypes()
  const folderType = folderTypes.find((t) => t.name === 'Folder') ?? folderTypes[0]
  const withFile = await fileTypeIds(db)
  const made: string[] = []
  let parent: NodeRow | undefined
  for (const [at, name] of names.entries()) {
    const shown = `/${names.slice(0, at + 1).join('/')}`
    const there = await nodes.childrenNamed(
      parent?.id ?? SystemNodes.Root,
      [ObjectTypes.Media],
      name,
    )
    if (there.length > 1)
      throw new MediaLibraryError('refused', `More than one item is named ${shown}.`)
    const found = there[0]
    if (found) {
      const typeId = await db.q
        .selectFrom('content')
        .select('content_type_id')
        .where('node_id', '=', found.id)
        .executeTakeFirst()
      if (typeId && withFile.has(Number(typeId.content_type_id)))
        throw new MediaLibraryError('refused', `${shown} is a file, not a folder.`)
      parent = found
      continue
    }
    if (!folderType)
      throw new MediaLibraryError('refused', 'This site has no media folder type to make one with.')
    const key = crypto.randomUUID()
    const created = await writer.media.create(actor, {
      key,
      contentTypeKey: folderType.key,
      parentKey: parent?.key ?? null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (!created.ok)
      throw new MediaLibraryError(
        created.kind === 'forbidden' ? 'forbidden' : 'refused',
        `${shown} was not made: ${created.reason}`,
      )
    parent = (await nodes.byKey(created.key)) ?? undefined
    made.push(shown)
  }
  return { key: (parent as NodeRow).key, path: `/${names.join('/')}`, made }
}

/** What reading or setting media permissions needs beyond the database. */
export interface MediaAccessContext {
  db: Db
  /** The folders wired bundles declare (story 198), by bundle name and node path. */
  bundleFolders?(): ReadonlyArray<{ bundle: string; nodePath: string }>
  /** Told after a change, with the item's key, for the media cache here. */
  onChange?(key: string): void | Promise<void>
  /** This server's name, on the cache instruction an item's change appends. */
  nodeId?: string
  /** Story 444: the member groups by name, and a creator's name, when another site holds the members. */
  memberGroups?(): Promise<string[]>
  memberName?(key: string): Promise<string | undefined>
}

/** A rule as the back office sends and shows it. */
export interface RuleBody {
  publicRead: boolean
  groups: MediaAccessGroup[]
  members?: MediaAccessMember[]
  newRead: MediaAccessEntry['newRead']
  newWrite: MediaAccessEntry['newWrite']
  /** File types members may upload below (story 198); empty is none. */
  memberTypes: string[]
  /** The largest file a member may upload below, in bytes; null sets none. */
  memberMaxBytes: number | null
}

const ruleBody = (entry: MediaAccessEntry): RuleBody => ({
  publicRead: entry.publicRead,
  groups: entry.groups,
  ...(entry.members?.length ? { members: [...entry.members] } : {}),
  newRead: entry.newRead,
  newWrite: entry.newWrite,
  memberTypes: entry.memberTypes,
  memberMaxBytes: entry.memberMaxBytes,
})

/** The site's member groups, by name. */
export async function memberGroupNames(db: Db): Promise<string[]> {
  const rows = await db.q
    .selectFrom('node')
    .select('text')
    .where('node_object_type', '=', ObjectTypes.MemberGroup)
    .orderBy('text')
    .execute()
  return rows.flatMap((row) => (row.text ? [String(row.text)] : []))
}

/** The bundles that use a folder: those declaring it, or one below it. Sorted, each once. */
export const bundlesUsing = (context: MediaAccessContext, id: number): string[] =>
  [
    ...new Set(
      (context.bundleFolders?.() ?? [])
        .filter((folder) => `,${folder.nodePath},`.includes(`,${id},`))
        .map((folder) => folder.bundle),
    ),
  ].sort()

/** What the Permissions dialog shows for a folder or item. */
export async function describeMediaAccess(context: MediaAccessContext, key: string) {
  const { db } = context
  const nodes = new NodeRepository(db)
  const repo = new MediaAccessRepository(db)
  const node = await nodes.byKey(key)
  if (!node || node.objectType !== ObjectTypes.Media) return undefined
  const own = await repo.byNodeKey(key)
  const inherited = await repo.ruleFor(key, { above: true })
  const item = (await repo.itemAccess(key)) ?? {
    readPolicy: 'inherit' as const,
    writePolicy: 'inherit' as const,
    creatorMemberKey: null,
  }
  const fileRows = await db.q
    .selectFrom('content')
    .select('file_url')
    .where('node_id', '=', node.id)
    .execute()
  const from = inherited ? await nodes.byKey(inherited.nodeKey) : undefined
  const creatorName = !item.creatorMemberKey
    ? undefined
    : context.memberName
      ? await context.memberName(item.creatorMemberKey).catch(() => undefined)
      : (await new MemberRepository(db).byKey(item.creatorMemberKey))?.name
  const effective = own ?? inherited
  return {
    key: node.key,
    name: node.text ?? '',
    hasParent: node.parentId > 0,
    hasFile: Boolean(fileRows[0]?.file_url),
    own: own ? ruleBody(own) : null,
    inherited:
      inherited && from
        ? { from: { key: from.key, name: from.text ?? '' }, ...ruleBody(inherited) }
        : null,
    item: {
      readPolicy: item.readPolicy,
      writePolicy: item.writePolicy,
      creator: item.creatorMemberKey
        ? { key: item.creatorMemberKey, name: creatorName ?? null }
        : null,
    },
    protected: node.trashed || isProtectedMedia(item, effective ? ruleOf(effective) : undefined),
    memberGroups: context.memberGroups
      ? await context.memberGroups().catch(() => [])
      : await memberGroupNames(db),
    memberFileTypes: MEMBER_FILE_TYPES.map((type) => ({ id: type.id, label: type.label })),
    usedBy: bundlesUsing(context, node.id),
  }
}

export type MediaAccessState = NonNullable<Awaited<ReturnType<typeof describeMediaAccess>>>

/** What may be refused of a person reading or changing a node's permissions; undefined when allowed. */
export async function mediaAccessRefusal(
  db: Db,
  principal: Principal,
  node: NodeRow,
  change: boolean,
): Promise<'section' | 'forbidden' | undefined> {
  if (!hasSection(principal, 'media')) return 'section'
  if (!(await maySeeMedia(db, principal, node))) return 'forbidden'
  if (change && !fallbackPermissions(principal.groups).has(MediaPermissions.Update))
    return 'forbidden'
  return undefined
}

/** A rule and an item's own policies saved as the dialog saves them; `rule` null takes the rule off. */
export async function saveMediaAccess(
  context: MediaAccessContext,
  key: string,
  body: {
    rule?: RuleBody | null
    item?: { readPolicy: MediaPolicy; writePolicy: MediaPolicy }
  },
): Promise<void> {
  const { rule, item } = body
  await context.db.transaction(async (tx) => {
    const writing = new MediaAccessRepository(tx)
    if (rule === null) await writing.remove(key)
    else if (rule) await writing.save({ nodeKey: key, ...rule })
    if (item) await writing.setItemAccess(key, item)
    // The item carries its own settings in every server's media cache (story 197).
    if (item)
      await appendCacheInstruction(tx, {
        kind: 'content',
        payload: { media: [normaliseUuid(key)] },
        by: context.nodeId,
      })
  })
  await context.onChange?.(normaliseUuid(key))
}

/** A folder's or item's permissions as `media access show` gives them. */
export interface MediaAccessView {
  key: string
  name: string
  path: string
  /** The dialog's one-line summary. */
  summary: string
  /** The dialog's form: who may see and change it, and whether it follows the folder above. */
  form: ReturnType<typeof formFor>
  /** Everything the dialog reads, including what `set` does not change. */
  state: MediaAccessState
}

async function accessView(context: MediaAccessContext, node: NodeRow): Promise<MediaAccessView> {
  const state = await describeMediaAccess(context, node.key)
  if (!state) throw new MediaLibraryError('not_found', 'The media item could not be found.')
  return {
    key: node.key,
    name: node.text ?? '',
    path: await pathOf(context.db, node.key),
    summary: summarise(state),
    form: formFor(state),
    state,
  }
}

const accessRefused = async (
  context: MediaAccessContext,
  actor: Actor,
  node: NodeRow,
  change: boolean,
) => {
  const principal = principalOf(actor)
  const refused = principal && (await mediaAccessRefusal(context.db, principal, node, change))
  if (refused === 'section')
    throw new MediaLibraryError('forbidden', 'Media permissions need the Media section.')
  if (refused)
    throw new MediaLibraryError(
      'forbidden',
      change
        ? 'You do not have permission to change who can see this.'
        : `You may not see "${node.text ?? node.key}".`,
    )
}

/** Who may see and change a folder or item. */
export async function mediaAccess(
  context: MediaAccessContext,
  actor: Actor,
  ref: string,
): Promise<MediaAccessView> {
  const node = await mediaNode(context.db, actor, ref)
  await accessRefused(context, actor, node, false)
  return accessView(context, node)
}

/** What `media access set` changes; each absent part is kept as it is. */
export interface MediaAccessChange {
  /** Who may see it: anyone with the link, or back-office users only. */
  see?: 'anyone' | 'back-office'
  /** Member groups, by name, given `level`. */
  groups?: string[]
  /** `read`: they may see it; `change`: see and change it; `none`: neither. */
  level?: 'read' | 'change' | 'none'
  /** True: follow the folder above again. False: its own settings, starting from the folder above's. */
  inherit?: boolean
}

/**
 * The dialog's form with a change made, refused when it names a group the site
 * does not have. Pure: the dialog's own rules turn the form into what is saved.
 */
export function changedForm(state: MediaAccessState, change: MediaAccessChange) {
  if (change.inherit === true) return { ...inheritedForm(state), inherit: true }
  const form = { ...formFor(state), inherit: false }
  form.groups = form.groups.map((g) => ({ ...g }))
  if (change.see) {
    form.read = change.see === 'anyone' ? 'public' : 'private'
    form.allMembers = false
  }
  for (const wanted of change.groups ?? []) {
    const row = form.groups.find((g) => g.name.toLowerCase() === wanted.trim().toLowerCase())
    if (!row || !state.memberGroups.some((name) => name.toLowerCase() === row.name.toLowerCase()))
      throw new MediaLibraryError(
        'not_found',
        `There is no member group "${wanted}".`,
        state.memberGroups.length > 0
          ? `The site's member groups are ${listed(state.memberGroups)}.`
          : 'This site has no member groups yet.',
      )
    const level = change.level ?? 'read'
    row.read = level !== 'none'
    row.write = level === 'change'
    if (level === 'read') {
      form.read = 'custom'
      form.allMembers = false
    }
    if (level === 'change') form.write = 'custom'
  }
  return form
}

/**
 * Sets who may see and change a folder or item, as the Permissions dialog sets
 * them; what the change does not name (chosen members, member uploads and the
 * defaults for new files) is kept.
 */
export async function setMediaAccess(
  context: MediaAccessContext,
  actor: Actor,
  ref: string,
  change: MediaAccessChange,
): Promise<MediaAccessView> {
  const node = await mediaNode(context.db, actor, ref)
  await accessRefused(context, actor, node, true)
  const state = await describeMediaAccess(context, node.key)
  if (!state) throw new MediaLibraryError('not_found', 'The media item could not be found.')
  const request = requestFor(changedForm(state, change), state.item)
  await saveMediaAccess(context, node.key, {
    rule: request.rule as RuleBody | null,
    item: request.item as { readPolicy: MediaPolicy; writePolicy: MediaPolicy },
  })
  return accessView(context, node)
}

/** A change to permissions as a request body gives it; a sentence when it is not one. Pure. */
export function readAccessChange(raw: unknown): MediaAccessChange | string {
  if (!raw || typeof raw !== 'object') return 'Send the change to make.'
  const body = raw as Record<string, unknown>
  const out: MediaAccessChange = {}
  if (body.see !== undefined) {
    if (body.see !== 'anyone' && body.see !== 'back-office') return 'see is anyone or back-office.'
    out.see = body.see
  }
  if (body.groups !== undefined) {
    if (!Array.isArray(body.groups) || body.groups.some((g) => typeof g !== 'string' || !g.trim()))
      return 'groups is a list of member group names.'
    out.groups = body.groups as string[]
  }
  if (body.level !== undefined) {
    if (body.level !== 'read' && body.level !== 'change' && body.level !== 'none')
      return 'level is read, change or none.'
    out.level = body.level
  }
  if (body.inherit !== undefined) {
    if (typeof body.inherit !== 'boolean') return 'inherit is true or false.'
    out.inherit = body.inherit
  }
  if (out.inherit === true && (out.see || out.groups))
    return 'Following the folder above takes no other change.'
  return out
}
