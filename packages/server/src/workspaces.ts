/**
 * Workspaces in the server (story 375). A Management API request names its
 * workspace with the `Crombolo-Workspace` header; the router asks `scope` once
 * the request is authorised, and the handler runs with the workspace held for
 * it. Only the document port and operations read what is held, and pass it on
 * to the repository explicitly: nothing below them reads it. Opening, listing,
 * sharing and discarding are crombolo's own routes, at `<plugin>/api/workspaces`,
 * as is merging one into Shared (story 380).
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  hasCultureAccess,
  hasSection,
  mayDocumentAt,
  type Principal,
  WORKSPACE_OPERATIONS,
  WORKSPACE_REFUSALS,
} from '@crombolo/api-management/domain'
import { fieldWords, type MergePlan, type OnlyKind } from '@crombolo/content'
import {
  DocumentPermissions as D,
  normaliseUuid,
  ObjectTypes,
  problemDetails,
  problemResponse,
  SystemNodes,
  WorkspacePermissions,
} from '@crombolo/core'
import {
  type Db,
  DocumentRepository,
  NodeRepository,
  type NodeSchemaState,
  UserRepository,
  type Workspace,
  WorkspaceFileRepository,
  WorkspaceRefusedError,
  WorkspaceRepository,
} from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import type { WorkspaceMerging } from './node-operations.ts'
import { originOf } from './seo.ts'
import { pageVerdict, type WorkspaceChecks, type WorkspaceRendered } from './workspace-checks.ts'
import { workspaceMarks } from './workspace-marks.ts'
import type { WorkspaceSchema } from './workspace-schema.ts'

export const WORKSPACE_HEADER = 'crombolo-workspace'

const held = new AsyncLocalStorage<Workspace>()

/** The workspace the request being answered works in; undefined for Shared. */
export const currentWorkspace = (): Workspace | undefined => held.getStore()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether someone may work in a workspace: its owner or one of its members. */
export const mayUse = (workspace: Workspace, principal: Principal): boolean => {
  const me = normaliseUuid(principal.id)
  return workspace.ownerKey === me || workspace.memberKeys.includes(me)
}

const problem = (status: number, title: string, detail?: string) =>
  problemResponse(problemDetails({ title, status, ...(detail ? { detail } : {}) }))

/** What an administrator may read of a workspace they are not in, when they ask to (story 401). */
/**
 * What may be read of a workspace by someone not in it (stories 401, 416): an
 * administrator who asks, and an editor it is shown to, alike. Each a GET, but `check`
 * and `open`, which change nothing.
 */
const WORKSPACE_READS = new Set([
  'changes',
  'merge',
  'conflicts',
  'diff',
  'errors',
  'pages',
  'files',
  'render',
  'members',
])
const POSTED_READS = new Set(['check', 'open'])

/** The header's word for a person's own unnamed workspace (story 380). */
export const OWN_WORKSPACE = 'mine'

/**
 * What merges a person's own page at once, by what it does: a publish (story 380), and an
 * unpublish, a move, a reorder and a delete, which no publish follows (story 411).
 */
const MERGED_AT_ONCE = new Map<string, OnlyKind>([
  ['PutDocumentByIdPublish', 'publish'],
  ['PutDocumentByIdUpdateAndPublish', 'publish'],
  ['PutDocumentByIdUnpublish', 'unpublish'],
  ['PutDocumentByIdMove', 'move'],
  ['PutDocumentByIdMoveToRecycleBin', 'delete'],
  ['DeleteDocumentById', 'delete'],
  ['PutDocumentSort', 'reorder'],
  ['PutDocumentByIdSortChildren', 'reorder'],
  ['PutDocumentRootSortChildren', 'reorder'],
])
const PAGE_IN_PATH = /\/document\/([0-9a-f-]{36})(?:\/|$)/i

/** The settings a scope reads, each request. */
export interface WorkspaceScopeOptions {
  enabled: () => boolean
  /** Shared takes no direct edit of a page; a person edits in a workspace (story 380). */
  required?: () => boolean
  /** Story 388: the site takes its content only by a change. */
  locked?: () => boolean
  /** Where a locked site's content is edited, to name in its refusals (story 412). */
  editedAt?: () => string | null
  /** The merge a publish in a person's own workspace makes, of that page alone. */
  merge?: () => WorkspaceMerging
  /** The workspace's copy of the schema files, taken as it opens (story 376). */
  schema?: () => WorkspaceSchema | undefined
}

/**
 * The router's scope for a request: undefined without the header, or for an
 * operation the workspace does not change; a refusal where workspaces are off,
 * the workspace is not the caller's, or it cannot hold what the operation does.
 * `mine` names the caller's own workspace, opened at their first change; where a
 * workspace is required, a page changed with none named is refused.
 */
export function createWorkspaceScope(db: Db, settings: WorkspaceScopeOptions | (() => boolean)) {
  const options: WorkspaceScopeOptions =
    typeof settings === 'function' ? { enabled: settings } : settings
  const workspaces = new WorkspaceRepository(db)
  return async (
    request: Request,
    principal: Principal | undefined,
    operation: { operationId: string },
  ) => {
    const key = request.headers.get(WORKSPACE_HEADER)?.trim()
    const pages = WORKSPACE_OPERATIONS.has(operation.operationId)
    if (options.locked?.() && pages && request.method !== 'GET')
      return lockedRefusal(options.editedAt?.())
    if (!key) {
      if (options.enabled() && options.required?.() && pages && request.method !== 'GET')
        return problem(
          409,
          'This site takes changes in a workspace',
          `Name one with the ${WORKSPACE_HEADER} header, or "${OWN_WORKSPACE}" for your own.`,
        )
      return undefined
    }
    if (!options.enabled())
      return problem(400, 'Workspaces are not turned on for this site.', 'Leave out the workspace.')
    const refusal = WORKSPACE_REFUSALS.get(operation.operationId)
    if (!pages && !refusal) return undefined
    const own = key.toLowerCase() === OWN_WORKSPACE
    // A person's own workspace holds their pages; what it cannot hold yet goes to Shared.
    if (own && (refusal || !principal)) return undefined
    let found: Workspace | undefined
    if (own && principal) {
      found = await workspaces.ownOf(principal.id)
      if (!found && request.method === 'GET') return undefined
      if (!found) {
        found = await workspaces.open({
          name: `Changes by ${principal.name}`,
          ownerKey: principal.id,
          personal: true,
        })
        await options.schema?.()?.snapshot(found.id)
      }
    } else found = principal && UUID.test(key) ? await workspaces.byKey(key) : undefined
    // Someone else's workspace answers as one that is not there, so none is revealed.
    if (!found || !principal || !mayUse(found, principal))
      return problem(404, 'There is no such workspace.')
    if (found.state === 'merged')
      return problem(409, 'This workspace was merged', 'Open another to go on working.')
    if (refusal) return problem(409, 'Not in a workspace', refusal)
    // Story 383: a staged change is looked at and applied, never edited where it is staged.
    if (found.stagedReadOnly && request.method !== 'GET')
      return problem(
        409,
        'This workspace holds a staged change',
        'A staged change is not edited here: change it where it was made and stage it again.',
      )
    const workspace = found
    const kind = MERGED_AT_ONCE.get(operation.operationId)
    const inPath = new URL(request.url).pathname.match(PAGE_IN_PATH)?.[1]
    // A reorder names its parent: in the path, in the body, or the top level.
    const sortParent =
      operation.operationId === 'PutDocumentSort'
        ? await request
            .clone()
            .json()
            .then((b: { parent?: { id?: string } | null }) => b?.parent?.id ?? null)
            .catch(() => null)
        : (inPath ?? null)
    return {
      run: async <T>(fn: () => Promise<T>): Promise<T> => {
        const answered = await held.run(workspace, fn)
        const merging = options.merge?.()
        if (!workspace.personal || !kind || !merging || !(answered instanceof Response))
          return answered
        if (answered.status < 200 || answered.status >= 300) return answered
        const what =
          kind === 'reorder'
            ? { kind, parentKey: sortParent }
            : inPath
              ? { kind, page: inPath }
              : undefined
        if (!what) return answered
        return (await mergeOwnPage(db, merging, workspace, principal, what)) ?? answered
      },
    }
  }
}

const DONE_WORDS: Record<OnlyKind, string> = {
  publish: 'Published',
  unpublish: 'Unpublished',
  move: 'Moved',
  reorder: 'Reordered',
  delete: 'Deleted',
}

/**
 * A publish in a person's own workspace is the merge of that page alone, at once
 * (story 380); so are an unpublish, a move, a reorder and a delete of a page Shared has
 * (story 411). A page made in the workspace and never merged has nothing in Shared to
 * change, so nothing goes. Where it cannot go, it stays there, and why is said.
 */
async function mergeOwnPage<T>(
  db: Db,
  merging: WorkspaceMerging,
  workspace: Workspace,
  principal: Principal,
  what: { kind: OnlyKind; page?: string; parentKey?: string | null },
): Promise<T | undefined> {
  const plan = await merging.preview(workspace)
  let keys: string[]
  if (what.kind === 'reorder') {
    const parentId = what.parentKey
      ? (await new NodeRepository(db).byKey(what.parentKey))?.id
      : SystemNodes.Root
    keys = plan.pending
      .filter((p) => p.pending.kind === 'sort' && p.pending.baseParentId === parentId)
      .flatMap((p) => (p.pending.key ? [p.pending.key] : []))
  } else keys = what.page ? [normaliseUuid(what.page)] : []
  const only = new Set(keys)
  const pages = plan.pages.filter((p) => only.has(p.page.key))
  if (what.kind !== 'publish' && pages.some((p) => p.page.made)) return undefined
  const one: MergePlan = {
    pages,
    pending:
      what.kind === 'publish'
        ? []
        : plan.pending.filter((p) => p.pending.key !== null && only.has(p.pending.key)),
    conflicts: plan.conflicts.filter((c) => c.key !== null && only.has(c.key)),
    findings: plan.findings.filter((f) => f.key !== null && only.has(f.key)),
  }
  // Story 414: a schedule set there goes too, though nothing else did.
  const scheduled =
    what.kind === 'publish' &&
    (await new WorkspaceRepository(db).scheduled(workspace.id)).some((r) => only.has(r.key))
  if (one.pages.length === 0 && one.pending.length === 0 && !scheduled) return undefined
  const refusals = await mergeRefusals(db, principal, one)
  const outcome =
    refusals.length > 0
      ? undefined
      : await merging.run(workspace, principal, {
          only: what.kind === 'publish' ? (keys[0] as string) : keys,
          ...(what.kind === 'publish' ? {} : { onlyKind: what.kind }),
          // Deleting it is what the person asked: they need not accept it again.
          ...(what.kind === 'delete' ? { accepted: ['page-deleted'] } : {}),
          ...(await userIdOf(db, principal)),
        })
  if (outcome?.ok) return undefined
  return problem(
    409,
    `${DONE_WORDS[what.kind]} in your own changes, not yet for everyone`,
    [...refusals, ...(outcome?.blockers ?? [])].join(' '),
  ) as T
}

const userIdOf = async (db: Db, principal: Principal): Promise<{ userId?: number }> => {
  const user = await db.q
    .selectFrom('user_account')
    .select('id')
    .where('key', '=', normaliseUuid(principal.id))
    .execute()
  return user[0] ? { userId: Number(user[0].id) } : {}
}

/**
 * An object whose every call goes to the workspace's own when the request
 * holds one: the document port and operations, so a handler written for Shared
 * works in a workspace unchanged.
 */
export function inWorkspaces<T extends object>(shared: T, make: (workspace: Workspace) => T): T {
  return new Proxy(shared, {
    get(target, prop, receiver) {
      const workspace = currentWorkspace()
      const actual = workspace ? make(workspace) : target
      const value = Reflect.get(actual, prop, workspace ? actual : receiver)
      return typeof value === 'function' ? value.bind(actual) : value
    },
  })
}

/** A workspace as its routes answer it. */
export interface WorkspaceView {
  key: string
  name: string
  visibility: 'members' | 'editors'
  /** What it is for, in its owner's words. */
  description: string | null
  /** Whether the person asking is in it, and may change it. */
  member: boolean
  ownerKey: string
  memberKeys: string[]
  mine: boolean
  /** Story 398: a person's own unnamed workspace, rather than a named one. */
  personal: boolean
  /** Story 407: whether it is in conflict with Shared, and over how many items, as last found. */
  conflicted: boolean
  conflicts: number
  /** Story 416: a change from another site, staged to be looked at and applied. */
  staged: boolean
  state: 'open' | 'merged'
  mergedAt: string | null
  createdAt: string
  updatedAt: string
}

/** What a request asks of who sees a workspace (story 384). */
function privacyOf(asked: Record<string, unknown>): { visibility?: 'members' | 'editors' } {
  return asked.visibility === 'members' || asked.visibility === 'editors'
    ? { visibility: asked.visibility }
    : {}
}

/** What a request says a workspace is for: undefined when it says nothing, null to clear it. */
function descriptionOf(asked: Record<string, unknown>): string | null | undefined {
  if (asked.description === null) return null
  if (typeof asked.description !== 'string') return undefined
  return asked.description.trim().slice(0, 1000) || null
}

const viewOf = (workspace: Workspace, principal: Principal, conflicts = 0): WorkspaceView => ({
  key: workspace.key,
  visibility: workspace.visibility,
  description: workspace.description,
  member: mayUse(workspace, principal),
  name: workspace.name,
  ownerKey: workspace.ownerKey,
  memberKeys: workspace.memberKeys,
  mine: workspace.ownerKey === normaliseUuid(principal.id),
  personal: workspace.personal,
  conflicted: conflicts > 0,
  conflicts,
  staged: workspace.stagedReadOnly === true,
  state: workspace.state,
  mergedAt: workspace.mergedAt?.toISOString() ?? null,
  createdAt: workspace.createdAt.toISOString(),
  updatedAt: workspace.updatedAt.toISOString(),
})

type Client = { ipAddress: string | null; forwardedFor: string | null }

const json = (body: unknown, status = 200) => Response.json(body, { status })
const refused = (message: string, status: number) => json({ message }, status)

/** What a locked site says of a write it refuses (story 388), in the API and the back office. */
/**
 * Story 410: whether a path names a place on a workspace's own site and nothing else:
 * exactly one leading `/`, no backslash and no control character, so no parser can read
 * a scheme or a host into it. Pure.
 */
export const isSitePath = (path: unknown): path is string =>
  typeof path === 'string' &&
  path.startsWith('/') &&
  !path.startsWith('//') &&
  !path.includes('\\') &&
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
  !/[\u0000-\u001f\u007f]/.test(path)

/**
 * A path on a site, as an address on that origin, or undefined when the path is not one
 * or the address made from it is anywhere else. Pure.
 */
export function onOrigin(path: string, origin: URL | string): URL | undefined {
  if (!isSitePath(path)) return undefined
  const base = new URL(origin)
  const url = new URL(path, base)
  return url.origin === base.origin ? url : undefined
}

/** A page's address as a path on a workspace's site: its path alone, or `/`. Pure. */
export function pageSitePath(url: string | null | undefined): string {
  if (!url) return '/'
  let path = url
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
    try {
      const at = new URL(url, 'http://localhost')
      path = `${at.pathname}${at.search}`
    } catch {
      return '/'
    }
  }
  return isSitePath(path) ? path : '/'
}

/**
 * Where a workspace's site is (story 415): on the address the request came to, forwarded
 * host and scheme followed, or with none, the site's application address; never the SEO
 * public address, which may be an app that serves no workspace. Its own host where
 * workspaces have them. Pure.
 */
export function workspaceOriginOf(
  key: string,
  request: Request | undefined,
  config: { applicationUrl: string },
  hosts?: { hostFor(key: string, host: string): string },
): URL {
  const origin = new URL(
    request ? originOf(request, config) : config.applicationUrl.replace(/\/$/, ''),
  )
  if (hosts) origin.host = hosts.hostFor(key, origin.host)
  return origin
}

export const CONTENT_LOCKED = {
  title: 'This site takes its content by change',
  detail:
    'Its pages, media, types and code are changed where they are made, and arrive here when that change is applied.',
}

/** What a locked site's refusal says where it knows where content is edited (story 412). Pure. */
export const editedAtDetail = (editedAt: string) =>
  `This site's content is edited at ${editedAt}. Changes reach it from there.`

/**
 * A locked site's refusal of a write (story 412): naming where content is edited, and
 * carrying it as `editedAt`, when the site knows it; today's words when it does not.
 */
export function lockedRefusal(editedAt: string | null | undefined, status = 409): Response {
  const at = editedAt?.trim() || undefined
  return problemResponse({
    ...problemDetails({
      title: CONTENT_LOCKED.title,
      status,
      detail: at ? editedAtDetail(at) : CONTENT_LOCKED.detail,
    }),
    ...(at ? { editedAt: at } : {}),
  } as ReturnType<typeof problemDetails>)
}

/** One open workspace as an administrator sees it among them all (story 383). */
export interface PendingWorkspace {
  key: string
  name: string
  ownerKey: string
  ownerName: string | null
  createdAt: string
  /** When anything was last written in it. */
  lastActivity: string
  ageDays: number
  /** The changes from another site it holds, if it was staged with them. */
  staged: Array<{ key: string; name: string | null }> | null
}

/** Every workspace still open, the least recently touched first. */
async function pendingWorkspaces(db: Db): Promise<PendingWorkspace[]> {
  const open = (await new WorkspaceRepository(db).all()).filter((w) => w.state === 'open')
  if (open.length === 0) return []
  const latest = await db.q
    .selectFrom('content_version')
    .select(['workspace_id', (eb) => eb.fn.max('version_date').as('at')])
    .where(
      'workspace_id',
      'in',
      open.map((w) => w.id),
    )
    .groupBy('workspace_id')
    .execute()
  const owners = await new UserRepository(db).byKeys([...new Set(open.map((w) => w.ownerKey))])
  const now = Date.now()
  return open
    .map((w) => {
      const written = latest.find((r) => Number(r.workspace_id) === w.id)?.at
      const at = Math.max(w.updatedAt.getTime(), written ? new Date(String(written)).getTime() : 0)
      return {
        key: w.key,
        name: w.name,
        ownerKey: w.ownerKey,
        ownerName: owners.find((u) => normaliseUuid(u.key) === w.ownerKey)?.name ?? null,
        createdAt: w.createdAt.toISOString(),
        lastActivity: new Date(at).toISOString(),
        ageDays: Math.floor((now - w.createdAt.getTime()) / 86_400_000),
        staged: w.stagedChanges,
      }
    })
    .sort((a, b) => a.lastActivity.localeCompare(b.lastActivity))
}

/** The media files a workspace's own values name (story 390). */
async function filesNamedBy(db: Db, workspaceId: number): Promise<string[]> {
  const rows = await db.q
    .selectFrom('property_value')
    .select(['varchar_value', 'text_value'])
    .where('workspace_id', '=', workspaceId)
    .execute()
  const found = new Set<string>()
  for (const row of rows)
    for (const text of [row.varchar_value, row.text_value])
      for (const match of String(text ?? '').matchAll(/\/media\/[^"'\s?#]+/g)) found.add(match[0])
  return [...found]
}

/** Whether someone may merge workspaces at all: the permission of its own, which an administrator holds. */
export const mayMerge = (principal: Principal): boolean =>
  principal.isAdmin || principal.permissions.includes(WorkspacePermissions.Merge)

/**
 * What someone not in a workspace may read of it (story 416): the pages they may read in
 * Shared, and the files of the sections they have.
 */
function readsOf(db: Db, principal: Principal) {
  const known = new Map<string, boolean>()
  const page = async (key: string): Promise<boolean> => {
    const k = normaliseUuid(key)
    const seen = known.get(k)
    if (seen !== undefined) return seen
    const node = await new NodeRepository(db).byKey(k)
    const document =
      node &&
      (node.objectType === ObjectTypes.Document ||
        node.objectType === ObjectTypes.WorkspaceDocument)
    const allowed = document ? mayDocumentAt(principal, await chainOf(db, node.id), [D.Read]) : true
    known.set(k, allowed)
    return allowed
  }
  const item = async (value: unknown): Promise<boolean> => {
    if (!value || typeof value !== 'object') return true
    const o = value as Record<string, unknown>
    if (typeof o.key === 'string' && UUID.test(o.key) && !(await page(o.key))) return false
    if (typeof o.path === 'string' && fileRefusals(principal, { [o.path]: true }).length > 0)
      return false
    return true
  }
  async function hold(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) {
      const out = []
      for (const v of value) if (await item(v)) out.push(await hold(v))
      return out
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) out[k] = await hold(v)
      return out
    }
    return value
  }
  return {
    hold,
    /** Whether the page at a path on the workspace's site is one they may read. */
    async path(
      workspace: { id: number; key: string },
      path: string,
      pageAt?: (
        workspace: { id: number; key: string },
        path: string,
      ) => Promise<string | undefined>,
    ): Promise<boolean> {
      const key = pageAt ? await pageAt(workspace, path) : undefined
      return key ? page(key) : true
    },
  }
}

/** A page's place as permissions read it: its ancestors' keys, then its own. */
async function chainOf(db: Db, nodeId: number): Promise<string[]> {
  const node = await db.q.selectFrom('node').select('path').where('id', '=', nodeId).execute()
  const ids = String(node[0]?.path ?? '')
    .split(',')
    .map(Number)
    .filter((id) => id > 0)
  if (ids.length === 0) return []
  const keys = new Map(
    (
      await db.q.selectFrom('node').select(['id', 'unique_id']).where('id', 'in', ids).execute()
    ).map((row) => [Number(row.id), normaliseUuid(String(row.unique_id))]),
  )
  return ids.flatMap((id) => (keys.has(id) ? [keys.get(id) as string] : []))
}

/**
 * What a merge would do that the person could not do directly (story 380): each
 * change needs its own verbs, languages and start nodes at its place.
 */
export async function mergeRefusals(
  db: Db,
  principal: Principal,
  plan: MergePlan,
): Promise<string[]> {
  const out: string[] = []
  for (const { page, name, take, publish, unpublish } of plan.pages) {
    const verbs: string[] = []
    if (page.made || take.length > 0) verbs.push(page.made ? D.Create : D.Update)
    if (publish) verbs.push(D.Publish)
    if (unpublish) verbs.push(D.Unpublish)
    if (verbs.length > 0 && !mayDocumentAt(principal, await chainOf(db, page.nodeId), verbs))
      out.push(`You may not make these changes to "${name}".`)
    const cultures = new Set<string>([
      ...take.flatMap((f) => (f.value?.culture ? [f.value.culture] : [])),
      ...take.flatMap((f) => (f.field.startsWith('@name:') ? [f.field.slice(6)] : [])),
      ...(publish?.cultures ?? []),
      ...(unpublish?.cultures ?? []),
    ])
    if (!hasCultureAccess(principal, [...cultures]))
      out.push(`"${name}" changes a language you do not work in.`)
  }
  const VERB = { move: D.Move, sort: D.Sort, trash: D.Delete, delete: D.Delete } as const
  for (const { pending } of plan.pending) {
    if (pending.kind === 'gone' || pending.kind === 'orphaned' || pending.key === null) continue
    const verbs = [VERB[pending.kind]]
    const chain = await chainOf(db, pending.nodeId)
    let allowed = mayDocumentAt(principal, chain, verbs)
    if (allowed && pending.kind === 'move' && pending.targetParentId !== null)
      allowed = mayDocumentAt(principal, await chainOf(db, pending.targetParentId), [D.Create])
    if (!allowed)
      out.push(
        `You may not ${pending.kind === 'sort' ? 'reorder' : pending.kind} "${pending.name}".`,
      )
  }
  return out
}

/**
 * What a workspace's files ask of the person merging them (stories 376, 377):
 * Structure for definitions, Code for templates, stylesheets and scripts, and an
 * administrator for the files the site reads only as it starts.
 */
export function fileRefusals(principal: Principal, writes: Record<string, unknown>): string[] {
  const keys = Object.keys(writes)
  const out: string[] = []
  if (keys.some((k) => k.startsWith('schema/')) && !hasSection(principal, 'structure'))
    out.push('You may not change the site’s definitions.')
  if (
    keys.some((k) => /^(components|stylesheets|scripts)\//.test(k)) &&
    !hasSection(principal, 'components')
  )
    out.push('You may not change the site’s templates, stylesheets or scripts.')
  if (keys.some((k) => k.startsWith('site/')) && !principal.isAdmin)
    out.push('Only an administrator merges a change to the site’s own code.')
  return out
}

/** A merge's plan as its routes answer it. */
const planView = (plan: MergePlan) => ({
  pages: plan.pages.map((p) => ({
    key: p.page.key,
    name: p.name,
    made: p.page.made,
    changes: p.take.map((f) => fieldWords(f.field)),
    publish: p.publish,
    unpublish: p.unpublish,
  })),
  pending: plan.pending.map((p) => ({
    key: p.pending.key,
    id: p.pending.nodeId,
    name: p.pending.name,
    kind: p.pending.kind,
    ...(p.conflict ? { conflict: p.conflict } : {}),
  })),
  conflicts: plan.conflicts.map((c) => ({ ...c, words: fieldWords(c.field) })),
  findings: plan.findings,
})

/**
 * The workspace routes, under `<plugin>/api/workspaces`: `GET /` lists yours,
 * or every one for an administrator with `?all=true`; `POST / { name }` opens
 * one; `GET`, `PATCH { name }` and `DELETE /{key}`; `POST /{key}/members
 * { userKey }` and `DELETE /{key}/members/{userKey}`; `GET /{key}/changes`.
 * Merging (story 380): `GET /{key}/merge` says what it would do; `POST /{key}/merge
 * { accept, rehearse }` does it; `POST /{key}/conflicts { page, answers }` answers
 * a page's conflicts in the workspace; `DELETE /{key}/pending/{id}` drops a move,
 * reorder or delete, or a marker, so it does not go; `POST /merge { workspaces }`
 * merges several as one; `GET /mine` says whether a workspace is required, and
 * the caller's own.
 */
export function createWorkspacesApi(
  db: Db,
  options: {
    enabled: () => boolean
    merge?: () => WorkspaceMerging
    nodeState?: NodeSchemaState
    required?: () => boolean
    /** Story 388: the site takes its content only by a change; where it is edited. */
    locked?: () => boolean
    /** Story 386: the diff, conflicts and checks a command line asks for. */
    checks?: () => WorkspaceChecks
    editedAt?: () => string | null
    schema?: () => WorkspaceSchema | undefined
    /** Renders one page with the workspace's views (story 377). */
    render?: (workspace: { id: number; key: string }, path: string) => Promise<unknown>
    /** Story 416: the page at a path on a workspace's site, to hold a reader to their access. */
    pageAt?: (workspace: { id: number; key: string }, path: string) => Promise<string | undefined>
    /** Told when a workspace is merged or discarded, for what is held for it. */
    onClosed?: (key: string) => void
    /** The files a discarded workspace's values named, for those nothing else does to go (story 390). */
    onDiscardedFiles?: (urls: string[]) => void
    /** A member's way into the workspace's site (story 379): a link with a single-use token. */
    open?: (
      workspace: { key: string },
      principal: Principal,
      path: string,
      request: Request,
      /** Story 401: an administrator who is not in it, reading it because they asked to. */
      asAdministrator?: boolean,
    ) => Promise<string | undefined>
    /** Links for someone else to look at the workspace's site (story 379). */
    links?: () => {
      maxDays(): number
      make(
        workspace: { id: number; key: string },
        principal: Principal,
        days: number,
        request?: Request,
      ): Promise<{ id: number; url: string; expiresAt: string }>
      list(workspaceId: number): Promise<
        Array<{
          id: number
          madeBy: string
          expiresAt: Date
          withdrawnAt: Date | null
          createdAt: Date
        }>
      >
      withdraw(workspaceId: number, id: number): Promise<boolean>
    }
  },
) {
  const workspaces = new WorkspaceRepository(db)

  const audit = (
    by: Principal,
    action: string,
    workspace: Workspace,
    detail: string,
    client: Client,
  ) =>
    recordAudit(db, {
      category: 'content',
      action,
      source: 'request',
      userKey: by.id,
      userName: by.name,
      entityType: 'Workspace',
      entityKey: workspace.key,
      entityName: workspace.name,
      detail,
      ipAddress: client.ipAddress,
      forwardedFor: client.forwardedFor,
    })

  const nameOf = (body: Record<string, unknown>): string | undefined => {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    return name.length > 0 && name.length <= 255 ? name : undefined
  }

  /** Merges one workspace or several as one, as `principal`, auditing each. */
  const mergeNow = async (
    merging: WorkspaceMerging,
    chosen: readonly Workspace[],
    principal: Principal,
    asked: Record<string, unknown>,
    client: Client,
  ): Promise<Response> => {
    if (!mayMerge(principal)) return refused('You may not merge workspaces.', 403)
    const accepted = Array.isArray(asked.accept)
      ? asked.accept.filter((a): a is string => typeof a === 'string')
      : []
    const refusals: string[] = []
    const schema = options.schema?.()
    for (const one of chosen) {
      const own = await mergeRefusals(db, principal, await merging.preview(one))
      // Its files need what saving them directly would (stories 376, 377).
      if (schema) own.push(...fileRefusals(principal, (await schema.plan(one.id)).writes))
      for (const refusal of own)
        refusals.push(chosen.length > 1 ? `In "${one.name}": ${refusal}` : refusal)
    }
    if (refusals.length > 0)
      return json({ message: 'You may not make every change it holds.', refusals }, 403)
    // Story 383: the changes from other sites it holds are applied by it, each recorded once.
    const appliedChanges = chosen.flatMap((one) => one.stagedChanges ?? [])
    const outcome = await merging.run(chosen, principal, {
      accepted,
      rehearse: asked.rehearse === true,
      ...(await userIdOf(db, principal)),
      ...(appliedChanges.length > 0 ? { appliedChanges } : {}),
      ...(appliedChanges.length === 1 && chosen.length === 1
        ? { changeKey: appliedChanges[0]?.key }
        : {}),
    })
    if (!outcome.ok)
      return json(
        {
          message: 'It cannot be merged as it is.',
          blockers: outcome.blockers,
          ...planView(outcome.plan),
        },
        409,
      )
    if (!outcome.rehearsed) {
      for (const one of chosen) options.onClosed?.(one.key)
      const together =
        chosen.length > 1 ? ` with ${chosen.map((w) => `"${w.name}"`).join(', ')}` : ''
      for (const one of chosen)
        await audit(
          principal,
          'Merge',
          one,
          `Merged "${one.name}"${together}: ${outcome.merged.length} page(s), ${outcome.done.length} move(s) or delete(s)${outcome.forApproval.length > 0 ? `, ${outcome.forApproval.length} sent for approval` : ''}`,
          client,
        )
    }
    return json(outcome)
  }

  /** A workspace as its routes answer it, with what it has in conflict (story 407). */
  const viewed = async (workspace: Workspace, principal: Principal) =>
    viewOf(
      workspace,
      principal,
      (await workspaces.conflictCounts([workspace.id])).get(workspace.id) ?? 0,
    )

  return {
    async handle(
      request: Request,
      principal: Principal,
      rest: string,
      client: Client,
    ): Promise<Response> {
      // What the back office asks at sign-in (story 380): must it work in the person's own?
      // Answered for everyone, so a site without workspaces says no rather than refusing.
      if (rest.replace(/^\/+|\/+$/g, '') === OWN_WORKSPACE && request.method === 'GET') {
        const on = options.enabled() && hasSection(principal, 'content')
        const own = on ? await workspaces.ownOf(principal.id) : undefined
        const locked = options.locked?.() === true
        return json({
          required: on && !locked && options.required?.() === true,
          workspace: own ? await viewed(own, principal) : null,
          // Story 384: whether the switch shows at all, and whether Merge is offered.
          enabled: on,
          mayMerge: on && mayMerge(principal),
          // Story 388: what the back office shows each item as, and where it links.
          contentLocked: locked,
          editedAt: locked ? (options.editedAt?.() ?? null) : null,
        })
      }
      if (!options.enabled()) return refused('Workspaces are not turned on for this site.', 404)
      if (!hasSection(principal, 'content'))
        return refused('Workspaces are for people who look after content.', 403)
      const body = async () =>
        ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
      const parts = rest.split('/').filter(Boolean).map(decodeURIComponent)

      if (parts.length === 0) {
        if (request.method === 'GET') {
          const all = new URL(request.url).searchParams.get('all') === 'true'
          if (all && !principal.isAdmin)
            return refused('Only an administrator lists them all.', 403)
          const mine = all ? await workspaces.all() : await workspaces.forUser(principal.id)
          // Story 384: and those their owners show to every editor.
          const shown = all
            ? []
            : (await workspaces.all()).filter(
                (w) => w.visibility === 'editors' && w.state === 'open' && !mayUse(w, principal),
              )
          const listed = [...mine, ...shown]
          const counts = await workspaces.conflictCounts(listed.map((w) => w.id))
          return json({ items: listed.map((w) => viewOf(w, principal, counts.get(w.id) ?? 0)) })
        }
        if (request.method === 'POST') {
          if (options.locked?.()) {
            const at = options.editedAt?.()?.trim()
            return at
              ? json({ message: editedAtDetail(at), editedAt: at }, 409)
              : refused(
                  `${CONTENT_LOCKED.title}: a workspace is opened where its content is made.`,
                  409,
                )
          }
          const asked = await body()
          const name = nameOf(asked)
          if (!name) return refused('A workspace needs a name of up to 255 characters.', 400)
          const opened = await workspaces.open({
            name,
            ownerKey: principal.id,
            ...privacyOf(asked),
            description: descriptionOf(asked) ?? null,
          })
          // Its copy of the schema files, the base its changes to them merge from (story 376).
          await options.schema?.()?.snapshot(opened.id)
          await audit(principal, 'Open', opened, `Opened "${name}"`, client)
          return json(await viewed(opened, principal), 201)
        }
        return new Response(null, { status: 405 })
      }

      // Several merged as one (story 380): `POST /merge { workspaces: [key], accept }`.
      if (parts.length === 1 && parts[0] === 'merge' && request.method === 'POST') {
        const merging = options.merge?.()
        if (!merging) return refused('Merging is not available here.', 404)
        const asked = await body()
        const keys = Array.isArray(asked.workspaces)
          ? asked.workspaces.filter((k): k is string => typeof k === 'string' && UUID.test(k))
          : []
        const chosen: Workspace[] = []
        for (const k of new Set(keys.map(normaliseUuid))) {
          const one = await workspaces.byKey(k)
          if (!one || !mayUse(one, principal)) return refused('There is no such workspace.', 404)
          if (one.state === 'merged') return refused(`"${one.name}" was merged already.`, 409)
          chosen.push(one)
        }
        if (chosen.length === 0) return refused('Name the workspaces to merge.', 400)
        return mergeNow(merging, chosen, principal, asked, client)
      }

      // Story 384: which other people's workspaces changed a page, by whose, never what.
      if (parts[0] === 'touched' && parts[1] && UUID.test(parts[1]) && request.method === 'GET') {
        const node = await db.q
          .selectFrom('node')
          .select('id')
          .where('unique_id', '=', normaliseUuid(parts[1]))
          .where('workspace_id', 'is', null)
          .executeTakeFirst()
        const touching = node ? await workspaces.touching(Number(node.id), principal.id) : []
        const owners = await new UserRepository(db).byKeys(touching.map((w) => w.ownerKey))
        return json({
          items: touching.map((w) => ({
            owner: owners.find((u) => normaliseUuid(u.key) === w.ownerKey)?.name ?? 'someone',
            ...(w.visibility === 'editors' ? { workspace: { key: w.key, name: w.name } } : {}),
          })),
        })
      }

      // Story 383: every workspace still open, staged changes included, and those idle too long cleared.
      if (parts[0] === 'pending' && parts.length <= 2) {
        if (!principal.isAdmin) return refused('Only an administrator looks after them all.', 403)
        const open = await pendingWorkspaces(db)
        if (parts.length === 1 && request.method === 'GET') return json({ items: open })
        if (parts[1] === 'discard' && request.method === 'POST') {
          const days = Number((await body()).olderThanDays)
          if (!Number.isFinite(days) || days < 0)
            return refused('Say how many days old, as olderThanDays.', 400)
          const before = Date.now() - days * 86_400_000
          const discarded: string[] = []
          for (const one of open) {
            if (new Date(one.lastActivity).getTime() >= before) continue
            const found = await workspaces.byKey(one.key)
            if (found?.state !== 'open') continue
            const files = await filesNamedBy(db, found.id)
            await workspaces.discard(found.id, principal.id)
            options.onClosed?.(found.key)
            options.onDiscardedFiles?.(files)
            await audit(
              principal,
              'Discard',
              found,
              `Discarded "${found.name}", idle since ${one.lastActivity}`,
              client,
            )
            discarded.push(found.key)
          }
          return json({ discarded })
        }
        return new Response(null, { status: 405 })
      }

      const [key, sub, member] = parts as [string, string | undefined, string | undefined]
      const found = UUID.test(key) ? await workspaces.byKey(key) : undefined
      // An administrator may list and discard any, to clear one left behind, and read one
      // only when they ask to (story 401).
      const usable = found && mayUse(found, principal)
      const discardable = found && (usable || principal.isAdmin)
      const aRead =
        (request.method === 'GET' &&
          (sub === undefined || WORKSPACE_READS.has(sub)) &&
          (sub !== 'changes' || !member)) ||
        (request.method === 'POST' && !member && sub !== undefined && POSTED_READS.has(sub))
      const adminRead =
        !usable &&
        principal.isAdmin &&
        new URL(request.url).searchParams.get('includePrivate') === 'true' &&
        aRead
      // Story 384: one its owner shows to every editor is read by them, and changed by its
      // members; story 416: every read, by someone with the Content section.
      const readable = found?.visibility === 'editors' && hasSection(principal, 'content') && aRead
      // Story 416: an editor not in it sees only the pages and files they may in Shared.
      const heldToAccess = !usable && !adminRead && readable
      const mayRead = readsOf(db, principal)
      const answer = async (value: unknown, status = 200) =>
        json(heldToAccess ? await mayRead.hold(value) : value, status)
      if (
        !found ||
        (!usable &&
          !readable &&
          !adminRead &&
          !(discardable && request.method === 'DELETE' && !sub))
      )
        return refused('There is no such workspace.', 404)
      const owner = found.ownerKey === normaliseUuid(principal.id)

      if (!sub) {
        if (request.method === 'GET') return json(await viewed(found, principal))
        if (request.method === 'PATCH') {
          if (!owner) return refused('Only its owner changes a workspace.', 403)
          const asked = await body()
          // Story 384: who sees it, changed by its owner.
          const privacy = privacyOf(asked)
          await workspaces.setPrivacy(found.id, privacy)
          const description = descriptionOf(asked)
          if (description !== undefined) {
            await workspaces.setDescription(found.id, description)
            await audit(
              principal,
              'Describe',
              found,
              `Description of "${found.name}" changed`,
              client,
            )
          }
          if (Object.keys(privacy).length > 0)
            await audit(principal, 'Privacy', found, `Privacy of "${found.name}" changed`, client)
          if (
            asked.name === undefined &&
            (Object.keys(privacy).length > 0 || description !== undefined)
          )
            return json(await viewed((await workspaces.byKey(found.key)) as Workspace, principal))
          const name = nameOf(asked)
          if (!name) return refused('A workspace needs a name of up to 255 characters.', 400)
          await workspaces.rename(found.id, name)
          await audit(principal, 'Rename', found, `Renamed "${found.name}" to "${name}"`, client)
          return json(await viewed((await workspaces.byKey(found.key)) as Workspace, principal))
        }
        if (request.method === 'DELETE') {
          if (!owner && !principal.isAdmin)
            return refused('Only its owner discards a workspace.', 403)
          const files = await filesNamedBy(db, found.id)
          await workspaces.discard(found.id, principal.id)
          options.onClosed?.(found.key)
          options.onDiscardedFiles?.(files)
          await audit(principal, 'Discard', found, `Discarded "${found.name}"`, client)
          return new Response(null, { status: 204 })
        }
        return new Response(null, { status: 405 })
      }

      if (sub === 'changes' && !member && request.method === 'GET')
        return answer({ items: await workspaces.changes(found.id) })
      // What it holds, by the name each tree knows an item by, for the trees to mark.
      if (sub === 'marks' && !member && request.method === 'GET')
        return answer(await workspaceMarks(db, found.id))
      // Story 384: "Drop this change": the page goes back to Shared's, here.
      if (sub === 'changes' && member && UUID.test(member) && request.method === 'DELETE') {
        if (!usable) return refused('Only its members change a workspace.', 403)
        const node = await db.q
          .selectFrom('node')
          .select('id')
          .where('unique_id', '=', normaliseUuid(member))
          .executeTakeFirst()
        if (!node) return refused('There is no such page.', 404)
        await workspaces.dropPage(found.id, Number(node.id))
        return new Response(null, { status: 204 })
      }

      // Story 386: what a command line asks before merging.
      const checks = options.checks?.()
      if (checks && !member) {
        const query = new URL(request.url).searchParams
        if (sub === 'diff' && request.method === 'GET') {
          const against = query.get('against') === 'base' ? 'base' : 'shared'
          return answer(await checks.diff(found, against))
        }
        if (sub === 'conflicts' && request.method === 'GET')
          return answer({ items: await checks.conflicts(found) })
        if (sub === 'check' && request.method === 'POST') {
          const asked = await body()
          const checked = await checks.check(found, asked.all === true)
          if (!heldToAccess) return json(checked)
          // Its failures and pages not checked go with the pages left out.
          const shown = (await mayRead.hold(checked.pages)) as typeof checked.pages
          const hidden = new Set(
            checked.pages.filter((p) => !shown.includes(p)).flatMap((p) => [p.url, p.key]),
          )
          return json({
            ...checked,
            pages: shown,
            failures: checked.failures.filter((f) => !hidden.has(f.item)),
            notChecked: checked.notChecked.filter((n) => !hidden.has(n.item)),
          })
        }
        if (sub === 'pages' && request.method === 'GET') {
          const pages = await checks.pages(found, query.get('all') === 'true')
          return answer({
            items: query.get('failing') === 'true' ? pages.filter((p) => !p.ok) : pages,
          })
        }
        if (sub === 'errors' && request.method === 'GET') {
          const since = query.get('since') ? new Date(query.get('since') as string) : undefined
          const items = await checks.errors(
            found,
            since && !Number.isNaN(since.getTime()) ? since : undefined,
          )
          if (!heldToAccess) return json({ items })
          const kept = []
          for (const item of items)
            if (await mayRead.path(found, item.page, options.pageAt)) kept.push(item)
          return json({ items: kept })
        }
      }

      // Story 376: its definition files, brought up to Shared's, and a file's conflict answered.
      const schema = options.schema?.()
      if (schema && sub === 'files' && !member && request.method === 'GET') {
        const planned = await schema.plan(found.id)
        return json({
          changes: (await new WorkspaceFileRepository(db).changes(found.id))
            .filter(
              (c) => !heldToAccess || fileRefusals(principal, { [c.path]: true }).length === 0,
            )
            .map((c) => ({
              path: schema.shown(c.path),
              class: c.class ?? 'none',
              added: c.base === null,
              removed: c.now === null,
              // Read only as the site starts (story 377): it takes effect when merged.
              ...(c.path.startsWith('site/') ? { takesEffect: 'at merge' } : {}),
            })),
          conflicts: planned.conflicts,
          problems: planned.problems,
        })
      }
      // Story 377: a file the site reads only as it starts, carried to the merge.
      if (schema && sub === 'site-files' && !member && request.method === 'PUT') {
        if (!principal.isAdmin)
          return refused('Only an administrator changes the site’s own code.', 403)
        if (found.state === 'merged') return refused('This workspace was merged already.', 409)
        const asked = await body()
        const path = typeof asked.path === 'string' ? asked.path : ''
        const text =
          typeof asked.text === 'string' ? asked.text : asked.text === null ? null : undefined
        if (text === undefined || !(await schema.carry(found.id, path, text)))
          return refused(
            'Name the package, the config, or a route, job or middleware file, with its text or null.',
            400,
          )
        return json({ path, takesEffect: 'at merge' })
      }
      // Story 379: a member opens the workspace's site; links let someone else look.
      if (sub === 'open' && !member && request.method === 'POST' && options.open) {
        if (found.state === 'merged') return refused('This workspace was merged already.', 409)
        const asked = await body()
        const path = asked.path === undefined || asked.path === null ? '/' : asked.path
        if (!isSitePath(path))
          return refused("Give a path on the workspace's site, such as /about.", 400)
        if (heldToAccess && !(await mayRead.path(found, path, options.pageAt)))
          return refused('There is no such page.', 404)
        const url = await options.open(found, principal, path, request, adminRead || heldToAccess)
        return url ? json({ url }) : refused('You may not open it.', 403)
      }
      if (sub === 'links' && options.links) {
        const links = options.links()
        if (!member && request.method === 'GET')
          return json({
            items: (await links.list(found.id)).map((l) => ({
              id: l.id,
              madeBy: l.madeBy,
              createdAt: l.createdAt.toISOString(),
              expiresAt: l.expiresAt.toISOString(),
              withdrawn: l.withdrawnAt !== null,
            })),
          })
        if (!member && request.method === 'POST') {
          if (found.state === 'merged') return refused('This workspace was merged already.', 409)
          const most = links.maxDays()
          if (most <= 0) return refused('This site does not make links to a workspace.', 403)
          const asked = await body()
          const days = typeof asked.days === 'number' ? asked.days : most
          if (!(days > 0) || days > most)
            return refused(`A link lasts at most ${most} day(s) here.`, 400)
          const made = await links.make(found, principal, days, request)
          await audit(
            principal,
            'Link',
            found,
            `A link to "${found.name}" for ${days} day(s)`,
            client,
          )
          return json(made, 201)
        }
        if (member && request.method === 'DELETE') {
          if (!(await links.withdraw(found.id, Number(member))))
            return refused('There is no such link.', 404)
          await audit(principal, 'Unlink', found, `Withdrew a link to "${found.name}"`, client)
          return new Response(null, { status: 204 })
        }
      }
      // Story 377: one page as the workspace's views render it, before it has an address (379).
      if (sub === 'render' && !member && request.method === 'GET' && options.render) {
        const path = new URL(request.url).searchParams.get('path') ?? '/'
        if (heldToAccess && !(await mayRead.path(found, path, options.pageAt)))
          return refused('There is no such page.', 404)
        const rendered = await options.render({ id: found.id, key: found.key }, path)
        // Story 408: a page that fails when asked for is one of the workspace's errors;
        // story 418: by the checks' own rule, so a page with nothing to render is none.
        const verdict = pageVerdict((rendered ?? { status: 'error' }) as WorkspaceRendered)
        if (!verdict.ok) await options.checks?.().note(found, path, verdict.says)
        return json(rendered)
      }
      if (schema && sub === 'update' && !member && request.method === 'POST') {
        if (found.state === 'merged') return refused('This workspace was merged already.', 409)
        const updated = await schema.updateFromShared({ id: found.id, key: found.key })
        // Story 400: what Shared's changes settled is raised again if it conflicts later.
        await workspaces.settled(found.id, {
          files: { keep: updated.conflicts.map((c) => c.path) },
        })
        return json(updated)
      }
      if (schema && sub === 'files' && member === 'resolve' && request.method === 'POST') {
        const asked = await body()
        const path = typeof asked.path === 'string' ? asked.path : ''
        const answer: { text: string } | { side: 'mine' | 'theirs' } | undefined =
          typeof asked.text === 'string'
            ? { text: asked.text }
            : asked.side === 'mine' || asked.side === 'theirs'
              ? { side: asked.side }
              : undefined
        if (!path || !answer)
          return refused('Name the file, and keep "mine", "theirs" or a text.', 400)
        if (!(await schema.resolve({ id: found.id, key: found.key }, path, answer)))
          return refused('The text still holds conflict markers.', 400)
        const still = (await schema.plan(found.id)).conflicts.map((c) => c.path)
        await workspaces.settled(found.id, { files: { keep: still } })
        return json({ ok: true })
      }

      if (sub === 'merge' || sub === 'conflicts' || sub === 'pending') {
        const merging = options.merge?.()
        if (!merging) return refused('Merging is not available here.', 404)
        if (found.state === 'merged') return refused('This workspace was merged already.', 409)
        if (sub === 'merge' && !member && request.method === 'GET') {
          const plan = await merging.preview(found)
          const files = schema ? await schema.plan(found.id) : undefined
          return answer({
            ...planView(plan),
            files: files
              ? {
                  writes: Object.keys(files.writes).map((key) => schema?.shown(key) ?? key),
                  conflicts: files.conflicts,
                  problems: files.problems,
                  class: files.change,
                  // Story 382: each item, its class, and whether it must be accepted.
                  items: files.items,
                }
              : { writes: [], conflicts: [], problems: [], class: 'none', items: [] },
            mayMerge: mayMerge(principal),
            refusals: [
              ...(await mergeRefusals(db, principal, plan)),
              ...(files ? fileRefusals(principal, files.writes) : []),
            ],
          })
        }
        if (sub === 'merge' && !member && request.method === 'POST')
          return mergeNow(merging, [found], principal, await body(), client)
        if (sub === 'conflicts' && !member && request.method === 'POST') {
          const asked = await body()
          const page = typeof asked.page === 'string' ? asked.page : ''
          const answers: Record<string, 'mine' | 'theirs'> = {}
          if (asked.answers && typeof asked.answers === 'object')
            for (const [field, side] of Object.entries(asked.answers as Record<string, unknown>))
              if (side === 'mine' || side === 'theirs') answers[field] = side
          const docs = new DocumentRepository(db, { nodeState: options.nodeState }).inWorkspace(
            found.id,
          )
          try {
            if (!UUID.test(page) || !(await docs.rebaseWorkspacePage(page, answers)))
              return refused('The workspace has not changed that page.', 404)
          } catch (error) {
            if (error instanceof WorkspaceRefusedError) return refused(error.message, 409)
            throw error
          }
          await workspaces.settled(found.id, { key: page })
          return json(planView(await merging.preview(found)))
        }
        if (sub === 'pending' && member && request.method === 'DELETE') {
          const id = Number(member)
          if (!Number.isInteger(id)) return refused('There is nothing here.', 404)
          await workspaces.dropPending(found.id, id)
          return new Response(null, { status: 204 })
        }
      }

      if (sub === 'members') {
        // Who is in it (story 386), for anyone in it.
        if (!member && request.method === 'GET') {
          const people = await new UserRepository(db).byKeys([found.ownerKey, ...found.memberKeys])
          return json({
            items: people.map((u) => ({
              key: normaliseUuid(u.key),
              name: u.name,
              email: u.email,
              owner: normaliseUuid(u.key) === found.ownerKey,
            })),
          })
        }
        if (!owner) return refused('Only its owner shares a workspace.', 403)
        if (!member && request.method === 'POST') {
          const asked = await body()
          // By their key, or (story 386, from the command line) by their email.
          const email = typeof asked.email === 'string' ? asked.email.trim().toLowerCase() : ''
          const byEmail = email
            ? await db.q
                .selectFrom('user_account')
                .select('key')
                .where('email', '=', email)
                .executeTakeFirst()
            : undefined
          const userKey = byEmail
            ? String(byEmail.key)
            : typeof asked.userKey === 'string'
              ? asked.userKey
              : ''
          if (email && !byEmail) return refused(`Nobody here has the email ${email}.`, 404)
          if (!UUID.test(userKey)) return refused('Name the person by their key or email.', 400)
          const known = await db.q
            .selectFrom('user_account')
            .select('key')
            .where('key', '=', normaliseUuid(userKey))
            .execute()
          if (known.length === 0) return refused('There is no such person.', 404)
          if (normaliseUuid(userKey) === found.ownerKey)
            return refused('Its owner is in it already.', 400)
          if (await workspaces.addMember(found.id, userKey))
            await audit(principal, 'Share', found, `Shared with ${normaliseUuid(userKey)}`, client)
          return json(await viewed((await workspaces.byKey(found.key)) as Workspace, principal))
        }
        if (member && request.method === 'DELETE') {
          if (!(await workspaces.removeMember(found.id, member)))
            return refused('They are not a member.', 404)
          await audit(
            principal,
            'Unshare',
            found,
            `No longer shared with ${normaliseUuid(member)}`,
            client,
          )
          return new Response(null, { status: 204 })
        }
      }
      return refused('There is nothing here.', 404)
    },
  }
}
