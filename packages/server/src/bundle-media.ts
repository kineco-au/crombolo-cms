/**
 * The `media` capability (story 198): a server bundle creating and changing
 * media items as the member its route was given, under the media permissions
 * (story 196). `docs/bundles.md`, Part 3.
 *
 * A bundle declares the folders it uses by path; the boot resolves them to
 * keys and refuses a path that does not exist. Every call is confined to those
 * folders and the subfolders below them. A member needs write permission on
 * the folder to create, on the item to change or delete it, and read
 * permission to see it; a back-office route acts as its user; a public route
 * may not use media at all.
 *
 * An upload is checked before anything is stored: the folder, the permission,
 * the file's type by its first bytes and its extension against the folder's
 * list, and its size, counted as it is read. An image is turned upright and
 * stored without its metadata, and what that metadata said is returned.
 */
import { hasSection } from '@crombolo/api-management'
import { type MediaActor, type MediaOperations, memberActor, userActor } from '@crombolo/content'
import {
  checkMemberUpload,
  DEFAULT_UPLOAD_SETTINGS,
  extensionOf,
  hasPathAccess,
  MEMBER_FILE_TYPES,
  type MediaMember,
  type MediaRule,
  mediaFileOf,
  memberMay,
  nearestMediaRule,
  normaliseUuid,
  ObjectTypes,
  OPEN_MEDIA,
  SYSTEM_MEDIA_TYPE_KEYS,
  type UploadSettings,
} from '@crombolo/core'
import {
  ContentTypeRepository,
  type Db,
  MediaAccessRepository,
  MediaListingRepository,
  NodeRepository,
} from '@crombolo/data'
import type { CropRequest, MediaCache, PublishedMedia } from '@crombolo/render'
import { createMediaPort } from './adapters/media.ts'
import type { BundleCaller, ServerBundle } from './bundles.ts'
import { ImageRefusedError, type MemberImageFacts, prepareMemberImage } from './imaging.ts'
import type { MediaFileStore } from './media-files.ts'

/** What a bundle declares to use media: the folders, and what it accepts. */
export interface BundleMediaDeclaration {
  /**
   * Media folders by path from the top of the library, such as
   * `/Observations/Photos`. The bundle writes only into these and the
   * subfolders below them; a path that does not exist refuses the boot.
   */
  folders: readonly string[]
  /**
   * The file types it accepts, such as `['jpeg', 'png']`: narrows what each
   * folder allows members, never widens it. Every type the folder allows when
   * absent.
   */
  types?: readonly string[]
  /** The largest upload, in bytes; a folder's own limit, if smaller, wins. */
  maxBytes: number
}

/** What an image said about itself before it was stripped; nothing for other files. */
export type BundleMediaMetadata = Partial<MemberImageFacts>

/** Why a call was refused: the status to answer with and words to show the member. */
export interface BundleMediaRefusal {
  ok: false
  status: 400 | 401 | 403 | 404 | 409 | 413 | 415
  message: string
}

/** A media item as a bundle sees it. */
export interface BundleMediaItem {
  key: string
  name: string
  /** The media type's alias: `Image`, `File`… */
  mediaType: string
  /** Where its file is served, which only those who may read it can open; null with no file. */
  url: string | null
  /** The named crops its image defines, with their sizes. */
  crops: Array<{ alias: string; width: number; height: number }>
  /** The member who created it, by key. */
  creator: string | null
  createdAt: Date
  updatedAt: Date
}

export interface BundleMediaCreate {
  /** A declared folder's path, or a subfolder's below one; a missing subfolder is created. */
  folder: string
  /** The media item's name. */
  name: string
  /** The upload: a `File`, or a request whose body is the file. */
  file: Blob | Request
  /** The file's name, for its extension; a `File`'s own name, else `name`, when absent. */
  fileName?: string
  /** The media type's alias; chosen from the extension, as the back office chooses, when absent. */
  mediaType?: string
}

export interface BundleMediaUpdate {
  name?: string
  file?: Blob | Request
  fileName?: string
}

/** Media as the member, or user, a route was given (story 198). */
export interface BundleMedia {
  create(
    input: BundleMediaCreate,
  ): Promise<
    | { ok: true; key: string; url: string | null; metadata: BundleMediaMetadata }
    | BundleMediaRefusal
  >
  /** The item, when it is in the bundle's folders and the caller may read it. */
  get(key: string): Promise<BundleMediaItem | undefined>
  update(
    key: string,
    input: BundleMediaUpdate,
  ): Promise<{ ok: true; url: string | null; metadata: BundleMediaMetadata } | BundleMediaRefusal>
  /** Moves the item to the recycle bin. */
  delete(key: string): Promise<{ ok: true } | BundleMediaRefusal>
  /** A page of a folder's items the caller may read. */
  list(
    folder: string,
    paging?: { skip?: number; take?: number },
  ): Promise<{ ok: true; total: number; items: BundleMediaItem[] } | BundleMediaRefusal>
  /**
   * The item's file, or an image's named crop or size, as a response to send
   * on: never kept by a shared cache. 404 when it may not be read.
   */
  crop(key: string, request?: CropRequest): Promise<Response>
}

/** A declared folder as the boot found it. */
export interface ResolvedMediaFolder {
  /** As declared. */
  path: string
  key: string
  id: number
  /** Its node path of ids, root first. */
  nodePath: string
}

export interface BundleMediaDeps {
  db: Db
  /** Writes through the same rules, audit and events as the back office's. */
  operations: MediaOperations
  files: MediaFileStore
  cache: MediaCache
  uploadSettings?: UploadSettings
  /** Each bundle's declared folders, resolved at boot. */
  folders(bundleId: string): readonly ResolvedMediaFolder[]
  /** The bundle's name, for the audit log. */
  bundleName(bundleId: string): string
  /** Streams a file, or a variant of an image, never to be kept by a shared cache. */
  stream(src: string, search: URLSearchParams): Promise<Response>
}

const refuse = (status: BundleMediaRefusal['status'], message: string): BundleMediaRefusal => ({
  ok: false,
  status,
  message,
})

const segmentsOf = (path: string) =>
  path
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
const lower = (value: string) => value.toLowerCase()

/**
 * The bytes of an upload, read only while they fit: undefined as soon as they
 * pass `max`, so an oversized upload stops being read there.
 */
export async function readWithin(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array | undefined> {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      return undefined
    }
    parts.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.byteLength
  }
  return out
}

const sizeWords = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** Resolves each declared path to its folder; the problems name the bundle and the path. */
export async function resolveBundleMediaFolders(
  db: Db,
  bundles: readonly ServerBundle[],
  names: (id: string) => string = (id) => id,
): Promise<{ folders: Map<string, ResolvedMediaFolder[]>; problems: string[] }> {
  const listing = new MediaListingRepository(db)
  const folders = new Map<string, ResolvedMediaFolder[]>()
  const problems: string[] = []
  for (const bundle of bundles) {
    if (!bundle.capabilities.includes('media') || !bundle.media) continue
    const found: ResolvedMediaFolder[] = []
    for (const path of bundle.media.folders) {
      const node = await listing.byPath(path)
      if (!node)
        problems.push(
          `Bundle "${names(bundle.id)}" uses the media folder "${path}", which does not exist. Create it in Media, or take the bundle out of crombolo.config.ts until it does.`,
        )
      else found.push({ path, key: node.key, id: node.id, nodePath: node.path })
    }
    folders.set(bundle.id, found)
  }
  return { folders, problems }
}

/** The media capability, built per request for whoever the route was given. */
export function createBundleMedia(deps: BundleMediaDeps) {
  const { db } = deps
  const nodes = new NodeRepository(db)
  const access = new MediaAccessRepository(db)
  const listing = new MediaListingRepository(db)
  const types = new ContentTypeRepository(db, { kind: 'media' })
  const port = createMediaPort(db)
  const settings = deps.uploadSettings ?? DEFAULT_UPLOAD_SETTINGS

  return (caller: BundleCaller, bundle: ServerBundle): BundleMedia => {
    const declared = bundle.media as BundleMediaDeclaration
    const folders = deps.folders(bundle.id)
    const member: MediaMember | undefined =
      caller.kind === 'member'
        ? { key: caller.member.key, groups: caller.member.groups }
        : undefined
    const actor: MediaActor | undefined =
      caller.kind === 'member'
        ? memberActor(caller.member, { via: deps.bundleName(bundle.id) })
        : caller.kind === 'backoffice'
          ? userActor(caller.principal)
          : undefined
    const nobody = refuse(401, 'Sign in to do that.')

    /** Whether a node path lies in one of the declared folders, the folder itself included. */
    const within = (nodePath: string) =>
      folders.some((folder) => `,${nodePath},`.includes(`,${folder.id},`))

    /** The rule governing a node path, from every rule there is: few, one per protected folder. */
    const ruleAt = async (nodePath: string): Promise<MediaRule | undefined> =>
      nearestMediaRule(nodePath, new Map((await access.allRules()).map((r) => [r.nodeId, r])))

    /** A back-office user's view of the path: the Media section, within their start nodes. */
    const userMayView = async (nodePath: string, trashed = false) => {
      if (caller.kind !== 'backoffice') return false
      if (!hasSection(caller.principal, 'media')) return false
      const ids = nodePath
        .split(',')
        .map(Number)
        .filter((id) => id > 0)
      const chain = (await nodes.byIds(ids))
        .filter((row) => row.objectType === ObjectTypes.Media)
        .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
        .map((row) => row.key)
      return hasPathAccess(caller.principal.startNodes.media, chain, trashed)
    }

    const mayRead = async (item: PublishedMedia) =>
      caller.kind === 'member'
        ? memberMay('read', item.access, await ruleAt(item.path), member)
        : userMayView(item.path)

    /**
     * Where a folder path leads: the declared folder it starts with, the
     * deepest folder that exists along it, and the names still to be made.
     */
    const locate = async (path: string) => {
      const wanted = segmentsOf(path).map(lower)
      const root = folders
        .filter((folder) => {
          const own = segmentsOf(folder.path).map(lower)
          return own.length <= wanted.length && own.every((s, i) => s === wanted[i])
        })
        .sort((a, b) => segmentsOf(b.path).length - segmentsOf(a.path).length)[0]
      if (!root) return undefined
      let at = { key: root.key, id: root.id, path: root.nodePath }
      const original = segmentsOf(path)
      const rest = original.slice(segmentsOf(root.path).length)
      for (const [index, name] of rest.entries()) {
        const child = await childFolder(at.id, name)
        if (!child) return { at, missing: rest.slice(index) }
        at = child
      }
      return { at, missing: [] as string[] }
    }
    const childFolder = async (parentId: number, name: string) => {
      const siblings = () =>
        db.q
          .selectFrom('node')
          .select(['id', 'unique_id', 'path', 'text'])
          .where('parent_id', '=', parentId)
          .where('node_object_type', '=', ObjectTypes.Media)
          .where('trashed', '=', db.dialect.boolValue(false) as boolean)
      const rows = await siblings()
        .where((eb) => eb(eb.fn('lower', ['text']), '=', lower(name)))
        .execute()
      const row =
        rows[0] ??
        // SQLite lowers only ASCII.
        (/[^ -~]/.test(name)
          ? (await siblings().execute()).find((r) => lower(String(r.text)) === lower(name))
          : undefined)
      return row
        ? { id: Number(row.id), key: normaliseUuid(String(row.unique_id)), path: String(row.path) }
        : undefined
    }

    /** Whether the caller may write into a folder, or a new subfolder that will follow its rule. */
    const mayWriteInto = async (folderKey: string, path: string, creating: boolean) => {
      if (caller.kind === 'backoffice') return true // the operations check the user's permissions
      const rule = await ruleAt(path)
      const own = (await access.itemAccess(folderKey)) ?? OPEN_MEDIA
      return (
        memberMay('write', own, rule, member) &&
        (!creating || memberMay('write', OPEN_MEDIA, rule, member))
      )
    }

    /** The types and size an upload below `path` must keep to. */
    const limitsAt = async (path: string) => {
      const rule = caller.kind === 'member' ? await ruleAt(path) : undefined
      const all = MEMBER_FILE_TYPES.map((t) => t.id)
      const folderTypes = caller.kind === 'member' ? (rule?.memberTypes ?? []) : all
      const bundleTypes = declared.types ?? all
      const allowed = folderTypes.filter((t) => bundleTypes.includes(t))
      const max = Math.min(
        declared.maxBytes,
        rule?.memberMaxBytes ?? Number.POSITIVE_INFINITY,
        settings.maxFileSize ?? Number.POSITIVE_INFINITY,
      )
      return { allowed, max }
    }

    /** The upload's bytes and type, checked; or why not. */
    const receive = async (
      file: Blob | Request,
      fileName: string,
      limits: { allowed: readonly string[]; max: number },
    ) => {
      if (limits.allowed.length === 0) return refuse(415, 'Files cannot be uploaded here.')
      const tooBig = refuse(
        413,
        `The file is too large. The most that can be uploaded here is ${sizeWords(limits.max)}.`,
      )
      const declaredSize =
        file instanceof Request
          ? Number(file.headers.get('content-length') ?? Number.NaN)
          : file.size
      if (Number.isFinite(declaredSize) && declaredSize > limits.max) return tooBig
      const bytes = await readWithin(
        file instanceof Request ? file.body : file.stream(),
        limits.max,
      )
      if (!bytes) return tooBig
      if (bytes.byteLength === 0) return refuse(400, 'The file is empty.')
      const checked = checkMemberUpload(fileName, bytes.subarray(0, 64), limits.allowed, settings)
      if (!checked.ok) return refuse(checked.status, checked.reason)
      if (!checked.type.image) return { bytes, metadata: {} as BundleMediaMetadata }
      try {
        const prepared = await prepareMemberImage(bytes, checked.type.id)
        return { bytes: prepared.bytes, metadata: prepared.facts as BundleMediaMetadata }
      } catch (error) {
        if (error instanceof ImageRefusedError) return refuse(415, error.message)
        throw error
      }
    }

    const fileNameOf = (file: Blob | Request, given: string | undefined, fallback: string) =>
      given ?? (file instanceof File && file.name ? file.name : fallback)

    /** Stages the bytes as a temporary upload, for the value a media item's file is made from. */
    const stage = async (bytes: Uint8Array, fileName: string) => {
      const id = crypto.randomUUID()
      await deps.files.saveTemporary(id, new File([bytes as BlobPart], fileName))
      return id
    }

    const fileValue = (temporaryFileId: string) => ({
      alias: 'umbracoFile',
      culture: null,
      segment: null,
      value: { temporaryFileId },
    })

    const urlOf = async (key: string) => {
      const doc = await deps.operations.repository.byKey(key)
      return doc ? mediaFileOf(doc) : null
    }

    const describe = (item: PublishedMedia): BundleMediaItem => ({
      key: item.key,
      name: item.name,
      mediaType: item.mediaType.alias,
      url: item.url || null,
      crops: item.image.crops.map((c) => ({ alias: c.alias, width: c.width, height: c.height })),
      creator: item.access.creatorMemberKey,
      createdAt: item.createDate,
      updatedAt: item.updateDate,
    })

    /** The item, when it is media in the bundle's folders and not in the bin. */
    const inFolders = async (key: string) => {
      const node = await nodes.byKey(key)
      return node && node.objectType === ObjectTypes.Media && !node.trashed && within(node.path)
        ? node
        : undefined
    }

    const readable = async (key: string) => {
      if (!(await inFolders(key))) return undefined
      const item = await deps.cache.byKey(key)
      return item && (await mayRead(item)) ? item : undefined
    }

    const operationRefusal = (result: { status: number; reason: string }): BundleMediaRefusal =>
      refuse(
        ([400, 403, 404, 409].includes(result.status) ? result.status : 400) as 400,
        result.reason,
      )

    return Object.freeze({
      async create(input) {
        if (!actor) return nobody
        const name = input.name?.trim()
        if (!name) return refuse(400, 'Give the file a name.')
        const place = await locate(input.folder ?? '')
        if (!place) return refuse(403, `This site feature cannot add files to "${input.folder}".`)
        const creating = place.missing.length > 0
        if (!(await mayWriteInto(place.at.key, place.at.path, creating)))
          return refuse(403, 'You do not have permission to add files here.')
        const fileName = fileNameOf(input.file, input.fileName, name)
        const received = await receive(input.file, fileName, await limitsAt(place.at.path))
        if ('ok' in received) return received

        const extension = extensionOf(fileName)
        let typeKey: string | undefined
        if (input.mediaType) {
          typeKey = (await types.byAlias(input.mediaType))?.key
          if (!typeKey) return refuse(400, `There is no media type "${input.mediaType}".`)
        } else {
          const choices = await port.typesForExtension(extension)
          typeKey = (choices.find((c) => c.matched) ?? choices[0])?.key
          if (!typeKey)
            return refuse(415, `This site has no kind of media for .${extension} files.`)
        }

        let parent = place.at.key
        for (const folderName of place.missing) {
          const made = await deps.operations.create(actor, {
            key: crypto.randomUUID(),
            contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
            parentKey: parent,
            values: [],
            variants: [{ culture: null, segment: null, name: folderName }],
            stamp: false,
          })
          if (!made.ok) return operationRefusal(made)
          parent = made.key
        }

        const temporary = await stage(received.bytes, fileName)
        const created = await deps.operations.create(actor, {
          key: crypto.randomUUID(),
          contentTypeKey: typeKey,
          parentKey: parent,
          values: [fileValue(temporary)],
          variants: [{ culture: null, segment: null, name }],
        })
        if (!created.ok) {
          await deps.files.deleteTemporary(temporary)
          return operationRefusal(created)
        }
        return {
          ok: true,
          key: created.key,
          url: await urlOf(created.key),
          metadata: received.metadata,
        }
      },

      async get(key) {
        if (!actor) return undefined
        const item = await readable(key)
        return item ? describe(item) : undefined
      },

      async update(key, input) {
        if (!actor) return nobody
        const node = await inFolders(key)
        if (!node) return refuse(404, 'The file could not be found.')
        const before = await deps.operations.repository.byKey(key)
        if (!before) return refuse(404, 'The file could not be found.')
        if (caller.kind === 'member') {
          const own = (await access.itemAccess(key)) ?? OPEN_MEDIA
          if (!memberMay('write', own, await ruleAt(node.path), member))
            return refuse(403, 'You do not have permission to change this file.')
        }
        let values = before.values
        let metadata: BundleMediaMetadata = {}
        let temporary: string | undefined
        if (input.file) {
          const fileName = fileNameOf(input.file, input.fileName, input.name ?? node.text ?? 'file')
          const parentPath = node.path.split(',').slice(0, -1).join(',')
          const received = await receive(input.file, fileName, await limitsAt(parentPath))
          if ('ok' in received) return received
          const choices = await port.typesForExtension(extensionOf(fileName))
          if (!choices.some((c) => c.key === before.contentTypeKey))
            return refuse(415, 'The new file must be the same kind of file as the one it replaces.')
          temporary = await stage(received.bytes, fileName)
          values = [...values.filter((v) => v.alias !== 'umbracoFile'), fileValue(temporary)]
          metadata = received.metadata
        }
        const name = input.name?.trim()
        const saved = await deps.operations.save(actor, key, {
          contentTypeKey: before.contentTypeKey,
          parentKey: before.parentKey,
          values,
          variants: name
            ? before.variants.map((v) => ({ culture: v.culture, segment: v.segment, name }))
            : before.variants.map((v) => ({
                culture: v.culture,
                segment: v.segment,
                name: v.name,
              })),
        })
        if (!saved.ok) {
          if (temporary) await deps.files.deleteTemporary(temporary)
          return operationRefusal(saved)
        }
        return { ok: true, url: await urlOf(key), metadata }
      },

      async delete(key) {
        if (!actor) return nobody
        const node = await inFolders(key)
        if (!node) return refuse(404, 'The file could not be found.')
        const trashed = await deps.operations.trash(actor, key)
        if (!trashed.ok)
          return trashed.status === 403
            ? refuse(403, 'You do not have permission to delete this file.')
            : operationRefusal(trashed)
        return { ok: true }
      },

      async list(folder, paging = {}) {
        if (!actor) return nobody
        const place = await locate(folder)
        if (!place) return refuse(403, `This site feature cannot read "${folder}".`)
        if (place.missing.length > 0) return { ok: true, total: 0, items: [] }
        if (caller.kind === 'backoffice' && !(await userMayView(place.at.path)))
          return refuse(403, 'You do not have permission to see this folder.')
        const rules = new Map((await access.allRules()).map((r) => [r.nodeId, r]))
        const page = await listing.children({
          parentId: place.at.id,
          parentPath: place.at.path,
          skip: Math.max(0, Math.floor(paging.skip ?? 0)),
          take: Math.min(100, Math.max(0, Math.floor(paging.take ?? 20))),
          readable: caller.kind === 'member' ? { rules, member } : undefined,
        })
        const found = await deps.cache.byKeys(page.keys)
        const items = page.keys.flatMap((key) => {
          const item = found.get(key.toLowerCase())
          return item ? [describe(item)] : []
        })
        return { ok: true, total: page.total, items }
      },

      async crop(key, request) {
        const notFound = new Response('Not Found', {
          status: 404,
          headers: { 'cache-control': 'private, no-store' },
        })
        if (!actor) return notFound
        const item = await readable(key)
        if (!item?.url) return notFound
        const target = request === undefined ? item.url : item.image.cropUrl(request)
        if (!target) return notFound
        return deps.stream(item.url, new URL(target, 'http://local').searchParams)
      },
    } satisfies BundleMedia)
  }
}

export type BundleMediaFactory = ReturnType<typeof createBundleMedia>
