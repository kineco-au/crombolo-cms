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
import { hasSection, type Principal } from '@crombolo/api-management/domain'
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
  type Db,
  type MediaAccessGroup,
  type MediaAccessMember,
  MediaAccessRepository,
  type MediaByUrl,
  NodeRepository,
  type NodeRow,
} from '@crombolo/data'
import {
  bundlesUsing,
  describeMediaAccess,
  type MediaAccessContext,
  mediaAccessRefusal,
  mediaChain,
  type RuleBody,
  saveMediaAccess,
} from './media-library.ts'

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
  /** Story 444: member groups and names from the site that holds the members. */
  memberGroups?(): Promise<string[]>
  memberName?(key: string): Promise<string | undefined>
}

const bearerOf = (request: Request): string | undefined => {
  const header = request.headers.get('authorization')
  return header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
}

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

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
  if (body.members !== undefined && !Array.isArray(body.members))
    return 'Choose members from the member picker.'
  const members: MediaAccessMember[] = []
  for (const rawMember of (body.members ?? []) as unknown[]) {
    const m = rawMember as Record<string, unknown> | null
    if (!m || typeof m.key !== 'string' || !isUuid(m.key))
      return 'Choose members from the member picker.'
    members.push({ key: normaliseUuid(m.key), read: m.read === true, write: m.write === true })
  }
  if (newRead !== null && !NEW_MEDIA_READ.includes(newRead as NewMediaRead))
    return 'Choose who may see new files.'
  const newWrite = body.newWrite ?? null
  if (newWrite !== null && !NEW_MEDIA_WRITE.includes(newWrite as NewMediaWrite))
    return 'Choose who may change new files.'
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
    ...(members.length ? { members } : {}),
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
  const context: MediaAccessContext = {
    db,
    bundleFolders: deps.bundleFolders,
    onChange: deps.onChange,
    nodeId: deps.nodeId,
    memberGroups: deps.memberGroups,
    memberName: deps.memberName,
  }

  const mayView = async (principal: Principal, node: NodeRow) =>
    !(await mediaAccessRefusal(db, principal, node, false))

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
    return principal
      ? hasSection(principal, 'media') &&
          hasPathAccess(principal.startNodes.media, await mediaChain(db, item.path), item.trashed)
      : false
  }

  /** Whether a file is closed to someone who is not signed in. */
  const isProtected = (item: MediaByUrl) => item.trashed || isProtectedMedia(item.access, item.rule)

  /** Every folder a bundle's path runs through, with the bundles that use it. */
  async function usedFolders(): Promise<Array<{ key: string; name: string; bundles: string[] }>> {
    const ids = new Set<number>()
    for (const folder of deps.bundleFolders?.() ?? [])
      for (const id of folder.nodePath.split(',').map(Number)) if (id > 0) ids.add(id)
    const rows = await nodes.byIds([...ids])
    return rows
      .filter((row) => row.objectType === ObjectTypes.Media)
      .map((row) => ({
        key: row.key,
        name: row.text ?? '',
        bundles: bundlesUsing(context, row.id),
      }))
  }

  /** What the Permissions dialog shows for a folder or item. */
  const describe = (key: string) => describeMediaAccess(context, key)

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
    if (!(await mayView(principal, node))) return new Response('Forbidden', { status: 403 })

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
        if (
          !MEDIA_POLICIES.includes(write as MediaPolicy) ||
          write === 'public' ||
          write === 'members'
        )
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
      await saveMediaAccess(context, key, { rule, item })
      return Response.json(await describe(normaliseUuid(key)))
    }
    await deps.onChange?.(normaliseUuid(key))
    return Response.json(await describe(normaliseUuid(key)))
  }

  return { mayRead, isProtected, handle, describe }
}

export type MediaAccess = ReturnType<typeof createMediaAccess>
