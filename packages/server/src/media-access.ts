/**
 * Who may read a media file, and the back office's permissions for media
 * (story 196). docs/media.md, "Protected media".
 *
 * `/media/…` asks `mayRead` of a protected file: a member by their site
 * cookie or a Delivery API member token, or a back-office user with the Media
 * section within their start nodes. The back office's "Permissions" action
 * reads and sets rules through `handle`, under
 * `<backoffice>/crombolo/api/media-access/{key}`, which is not in the contract.
 */
import { hasSection, type Principal } from '@crombolo/api-management'
import {
  fallbackPermissions,
  hasPathAccess,
  isProtectedMedia,
  MEDIA_POLICIES,
  MEMBER_FILE_TYPES,
  type MediaMember,
  MediaPermissions,
  type MediaPolicy,
  memberMay,
  NEW_MEDIA_READ,
  NEW_MEDIA_WRITE,
  type NewMediaRead,
  type NewMediaWrite,
  normaliseUuid,
  ObjectTypes,
} from '@crombolo/core'
import {
  appendCacheInstruction,
  type Db,
  type MediaAccessEntry,
  type MediaAccessGroup,
  MediaAccessRepository,
  type MediaByUrl,
  MemberRepository,
  NodeRepository,
  ruleOf,
} from '@crombolo/data'

export interface MediaAccessDeps {
  db: Db
  /** The member a request's site cookie carries. */
  member(request: Request): Promise<MediaMember | undefined>
  /** The member a Delivery API token names, when member tokens are on. */
  memberByToken?(token: string): Promise<MediaMember | undefined>
  /** The back-office user a request carries. */
  principal(request: Request): Promise<Principal | undefined>
  /** Told after a rule or an item's setting changes, with its key, for the media cache here. */
  onChange?(key: string): void | Promise<void>
  /** This server's name, on the cache instruction an item's change appends. */
  nodeId?: string
  /** The folders wired bundles declare (story 198), by bundle name and node path. */
  bundleFolders?(): ReadonlyArray<{ bundle: string; nodePath: string }>
}

const bearerOf = (request: Request): string | undefined => {
  const header = request.headers.get('authorization')
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** A rule as the back office sends and shows it. */
interface RuleBody {
  publicRead: boolean
  groups: MediaAccessGroup[]
  newRead: NewMediaRead | null
  newWrite: NewMediaWrite | null
  /** File types members may upload below (story 198); empty is none. */
  memberTypes: string[]
  /** The largest file a member may upload below, in bytes; null sets none. */
  memberMaxBytes: number | null
}

const ruleBody = (entry: MediaAccessEntry): RuleBody => ({
  publicRead: entry.publicRead,
  groups: entry.groups,
  newRead: entry.newRead,
  newWrite: entry.newWrite,
  memberTypes: entry.memberTypes,
  memberMaxBytes: entry.memberMaxBytes,
})

/** A rule from a request body; a string saying what is wrong otherwise. Pure. */
export function parseRuleBody(raw: unknown): RuleBody | string {
  if (!raw || typeof raw !== 'object') return 'Send the permissions to set.'
  const body = raw as Record<string, unknown>
  const groups = Array.isArray(body.groups) ? body.groups : []
  const parsed: MediaAccessGroup[] = []
  for (const group of groups) {
    const g = group as Record<string, unknown>
    if (!g || typeof g.name !== 'string' || g.name.trim() === '') return 'Each group needs a name.'
    parsed.push({ name: g.name.trim(), read: g.read === true, write: g.write === true })
  }
  const newRead = body.newRead ?? null
  if (newRead !== null && !NEW_MEDIA_READ.includes(newRead as NewMediaRead))
    return 'Choose who may see new files: everyone, the groups, or the member who added it.'
  const newWrite = body.newWrite ?? null
  if (newWrite !== null && !NEW_MEDIA_WRITE.includes(newWrite as NewMediaWrite))
    return 'Choose who may change new files: the groups, the member who added it, or no member.'
  const known = MEMBER_FILE_TYPES.map((type) => type.id)
  const memberTypes = body.memberTypes ?? []
  if (!Array.isArray(memberTypes) || memberTypes.some((t) => !known.includes(t as string)))
    return 'Choose the file types members may upload from the list.'
  const memberMaxBytes = body.memberMaxBytes ?? null
  if (
    memberMaxBytes !== null &&
    (typeof memberMaxBytes !== 'number' || !Number.isInteger(memberMaxBytes) || memberMaxBytes <= 0)
  )
    return 'The largest file members may upload must be a size above nothing, or left empty.'
  return {
    publicRead: body.publicRead === true,
    groups: parsed,
    newRead: newRead as NewMediaRead | null,
    newWrite: newWrite as NewMediaWrite | null,
    memberTypes: [...new Set(memberTypes as string[])],
    memberMaxBytes: memberMaxBytes as number | null,
  }
}

export function createMediaAccess(deps: MediaAccessDeps) {
  const { db } = deps
  const repo = new MediaAccessRepository(db)
  const nodes = new NodeRepository(db)

  /** A node's media ancestors' keys then its own, root first. */
  const chainOf = async (path: string): Promise<string[]> => {
    const ids = path
      .split(',')
      .map(Number)
      .filter((id) => id > 0)
    const byId = new Map((await nodes.byIds(ids)).map((row) => [row.id, row]))
    return ids.flatMap((id) => {
      const row = byId.get(id)
      return row && row.objectType === ObjectTypes.Media ? [row.key] : []
    })
  }

  const mayView = async (principal: Principal, path: string, trashed: boolean) =>
    hasSection(principal, 'media') &&
    hasPathAccess(principal.startNodes.media, await chainOf(path), trashed)

  /** The member a request carries: its site cookie, else a Delivery API member token. */
  const memberOf = async (request: Request): Promise<MediaMember | undefined> => {
    const fromCookie = await deps.member(request)
    if (fromCookie) return fromCookie
    const token = bearerOf(request)
    return token && deps.memberByToken ? deps.memberByToken(token) : undefined
  }

  /**
   * Whether this request may read a protected file. A file in the recycle bin
   * has left the folder that protected it, so only a back-office user may.
   */
  async function mayRead(request: Request, item: MediaByUrl): Promise<boolean> {
    if (!item.trashed) {
      const member = await memberOf(request)
      if (member && memberMay('read', item.access, item.rule, member)) return true
    }
    const principal = await deps.principal(request)
    return principal ? mayView(principal, item.path, item.trashed) : false
  }

  /** Whether a file is closed to someone who is not signed in. */
  const isProtected = (item: MediaByUrl) => item.trashed || isProtectedMedia(item.access, item.rule)

  const memberGroups = async (): Promise<string[]> => {
    const rows = await db.query<{ text: string | null }>(
      'SELECT text FROM node WHERE node_object_type = ? ORDER BY text',
      [ObjectTypes.MemberGroup],
    )
    return rows.flatMap((row) => (row.text ? [String(row.text)] : []))
  }

  /**
   * The bundles that use a folder: those declaring it, or one below it, so a
   * rename, move or delete of it would break their path. Sorted, each once.
   */
  const usedBy = (id: number): string[] =>
    [
      ...new Set(
        (deps.bundleFolders?.() ?? [])
          .filter((folder) => `,${folder.nodePath},`.includes(`,${id},`))
          .map((folder) => folder.bundle),
      ),
    ].sort()

  /** Every folder a bundle's path runs through, with the bundles that use it. */
  async function usedFolders(): Promise<Array<{ key: string; name: string; bundles: string[] }>> {
    const ids = new Set<number>()
    for (const folder of deps.bundleFolders?.() ?? [])
      for (const id of folder.nodePath.split(',').map(Number)) if (id > 0) ids.add(id)
    const rows = await nodes.byIds([...ids])
    return rows
      .filter((row) => row.objectType === ObjectTypes.Media)
      .map((row) => ({ key: row.key, name: row.text ?? '', bundles: usedBy(row.id) }))
  }

  /** What the Permissions dialog shows for a folder or item. */
  async function describe(key: string) {
    const node = await nodes.byKey(key)
    if (!node || node.objectType !== ObjectTypes.Media) return undefined
    const own = await repo.byNodeKey(key)
    const inherited = await repo.ruleFor(key, { above: true })
    const item = (await repo.itemAccess(key)) ?? {
      readPolicy: 'inherit' as const,
      writePolicy: 'inherit' as const,
      creatorMemberKey: null,
    }
    const fileRows = await db.query<{ file_url: string | null }>(
      'SELECT file_url FROM content WHERE node_id = ?',
      [node.id],
    )
    const from = inherited ? await nodes.byKey(inherited.nodeKey) : undefined
    const creator = item.creatorMemberKey
      ? await new MemberRepository(db).byKey(item.creatorMemberKey)
      : undefined
    const effective = own ?? inherited
    return {
      key: node.key,
      name: node.text ?? '',
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
          ? { key: item.creatorMemberKey, name: creator?.name ?? null }
          : null,
      },
      protected: node.trashed || isProtectedMedia(item, effective ? ruleOf(effective) : undefined),
      memberGroups: await memberGroups(),
      memberFileTypes: MEMBER_FILE_TYPES.map((type) => ({ id: type.id, label: type.label })),
      usedBy: usedBy(node.id),
    }
  }

  /**
   * `GET|PUT|DELETE /{key}`. A PUT sends `rule` (null takes the folder's or
   * item's own rule off) and, for a file, `item` with its own policies.
   */
  async function handle(
    request: Request,
    subpath: string,
    principal: Principal,
  ): Promise<Response | undefined> {
    const key = subpath.replace(/^\//, '')
    if (key === 'used') {
      if (!hasSection(principal, 'media')) return new Response('Forbidden', { status: 403 })
      if (request.method !== 'GET') return new Response('Method Not Allowed', { status: 405 })
      return Response.json(await usedFolders())
    }
    if (!isUuid(key)) return undefined
    if (!hasSection(principal, 'media')) return new Response('Forbidden', { status: 403 })
    const node = await nodes.byKey(key)
    if (!node || node.objectType !== ObjectTypes.Media)
      return new Response('Not Found', { status: 404 })
    if (!(await mayView(principal, node.path, node.trashed)))
      return new Response('Forbidden', { status: 403 })

    if (request.method === 'GET') return Response.json(await describe(key))
    if (request.method !== 'PUT' && request.method !== 'DELETE')
      return new Response('Method Not Allowed', { status: 405 })
    if (!fallbackPermissions(principal.groups).has(MediaPermissions.Update))
      return new Response('Forbidden', { status: 403 })

    if (request.method === 'DELETE') {
      await repo.remove(key)
    } else {
      const body = (await request.json().catch(() => undefined)) as
        | Record<string, unknown>
        | undefined
      if (!body) return Response.json({ reason: 'Send the permissions to set.' }, { status: 400 })
      let item: { readPolicy: MediaPolicy; writePolicy: MediaPolicy } | undefined
      if (body.item !== undefined) {
        const raw = (body.item ?? {}) as Record<string, unknown>
        const read = raw.readPolicy ?? 'inherit'
        const write = raw.writePolicy ?? 'inherit'
        if (!MEDIA_POLICIES.includes(read as MediaPolicy))
          return Response.json({ reason: 'Choose who may see this file.' }, { status: 400 })
        if (!MEDIA_POLICIES.includes(write as MediaPolicy) || write === 'public')
          return Response.json({ reason: 'Choose who may change this file.' }, { status: 400 })
        item = { readPolicy: read as MediaPolicy, writePolicy: write as MediaPolicy }
      }
      let rule: RuleBody | null | undefined
      if (body.rule === null) rule = null
      else if (body.rule !== undefined) {
        const parsed = parseRuleBody(body.rule)
        if (typeof parsed === 'string') return Response.json({ reason: parsed }, { status: 400 })
        rule = parsed
      }
      await db.transaction(async (tx) => {
        const writing = new MediaAccessRepository(tx)
        if (rule === null) await writing.remove(key)
        else if (rule) await writing.save({ nodeKey: key, ...rule })
        if (item) await writing.setItemAccess(key, item)
        // The item carries its own settings in every server's media cache (story 197).
        if (item)
          await appendCacheInstruction(tx, {
            kind: 'content',
            payload: { media: [normaliseUuid(key)] },
            by: deps.nodeId,
          })
      })
    }
    await deps.onChange?.(normaliseUuid(key))
    return Response.json(await describe(normaliseUuid(key)))
  }

  return { mayRead, isProtected, handle, describe }
}

export type MediaAccess = ReturnType<typeof createMediaAccess>
