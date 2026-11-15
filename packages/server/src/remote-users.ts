/**
 * The remote protocol's routes for back-office users (story 356): a user found,
 * changed and removed, open sign-ins listed and ended, and where a group starts
 * and who owns it. Each answers as the signed-in person through the core the
 * command line uses; CI is refused, since these act for a person. A write is
 * audited as the Management API audits the same change, by key.
 */
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import { AuthStore } from '@crombolo/auth'
import type { Db } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import {
  changeUser,
  endSignIn,
  findUser,
  type GroupPlaceChange,
  placeGroup,
  removeUser,
  signIns,
  UserAdminError,
  type UserChange,
  type UserPorts,
} from './user-admin.ts'

interface Problem {
  code: string
  title: string
  detail?: string
  items?: string[]
}

export interface UserRouteOptions {
  db: Db
  ports: () => Promise<UserPorts> | UserPorts
  problem(status: number, body: Problem): Response
  /** A refusal when the site's remote access level takes no changes. */
  levelRefusal(): Response | undefined
}

const KEY = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

const STATUS: Record<UserAdminError['kind'], [number, string]> = {
  not_found: [404, 'not-found'],
  refused: [403, 'forbidden'],
  usage: [400, 'bad-request'],
  conflict: [409, 'conflict'],
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const read = await request.json().catch(() => ({}))
  return read && typeof read === 'object' ? (read as Record<string, unknown>) : {}
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/** A user change as a request names it: only the fields it gives. */
function userChangeOf(asked: Record<string, unknown>): UserChange {
  const change: UserChange = {}
  if (text(asked.name) !== undefined) change.name = text(asked.name)
  if (text(asked.email) !== undefined) change.email = text(asked.email)
  if (text(asked.uiLanguage) !== undefined) change.uiLanguage = text(asked.uiLanguage)
  if (Array.isArray(asked.addGroups)) change.addGroups = texts(asked.addGroups)
  if (Array.isArray(asked.removeGroups)) change.removeGroups = texts(asked.removeGroups)
  return change
}

function placeChangeOf(asked: Record<string, unknown>): GroupPlaceChange {
  const change: GroupPlaceChange = {}
  for (const tree of ['content', 'media', 'library'] as const)
    if (text(asked[tree]) !== undefined) change[tree] = text(asked[tree])
  if (Array.isArray(asked.addOwners)) change.addOwners = texts(asked.addOwners)
  if (Array.isArray(asked.removeOwners)) change.removeOwners = texts(asked.removeOwners)
  return change
}

/** The session a request's bearer token belongs to, so its own sign-in is marked. */
async function sessionOf(db: Db, request: Request): Promise<string | undefined> {
  const header = request.headers.get('authorization')
  if (!header?.toLowerCase().startsWith('bearer ')) return undefined
  return (await new AuthStore(db).findToken(header.slice(7).trim(), 'access'))?.sessionId
}

export function createUserRoutes(options: UserRouteOptions) {
  const { db, problem } = options
  const refused = (error: unknown): Response => {
    if (!(error instanceof UserAdminError)) throw error
    const [status, code] = STATUS[error.kind]
    return problem(status, {
      code,
      title: error.message,
      ...(error.hint ? { detail: error.hint } : {}),
    })
  }
  const audited = (
    principal: Principal,
    request: Request,
    entry: { category: 'user' | 'permission'; action: string; entityType: string; key: string },
  ) =>
    recordAudit(db, {
      category: entry.category,
      action: entry.action,
      source: 'request',
      userKey: principal.id,
      userName: principal.name,
      entityType: entry.entityType,
      entityKey: entry.key,
      forwardedFor: request.headers.get('x-forwarded-for'),
      detail: 'Through the remote protocol',
    })

  async function users(request: Request, url: URL, principal: Principal, key?: string) {
    const ports = await options.ports()
    const method = request.method
    if (method === 'GET') {
      const find = key ?? url.searchParams.get('find')
      if (!find) return problem(400, { code: 'bad-request', title: 'Name the user with ?find=' })
      return Response.json(await findUser(ports, principal, find))
    }
    if (!key || !KEY.test(key))
      return problem(400, { code: 'bad-key', title: 'A user is changed by their key' })
    const level = options.levelRefusal()
    if (level) return level
    if (method === 'PATCH') {
      const done = await changeUser(ports, principal, key, userChangeOf(await body(request)))
      if (done.changed.length > 0)
        await audited(principal, request, {
          category: 'user',
          action: 'Save',
          entityType: 'User',
          key: done.user.key,
        })
      return Response.json(done)
    }
    if (method === 'DELETE') {
      const gone = await removeUser(ports, principal, key)
      await audited(principal, request, {
        category: 'user',
        action: 'Delete',
        entityType: 'User',
        key: gone.key,
      })
      return Response.json(gone)
    }
    return new Response(null, { status: 405 })
  }

  async function sessions(request: Request, url: URL, principal: Principal, id?: string) {
    const current = await sessionOf(db, request)
    if (request.method === 'GET' && !id) {
      const user = url.searchParams.get('user') ?? undefined
      return Response.json({ items: await signIns(db, principal, { user, current }) })
    }
    if (request.method === 'DELETE' && id) {
      const level = options.levelRefusal()
      if (level) return level
      const ended = await endSignIn(db, principal, id, { current })
      await audited(principal, request, {
        category: 'user',
        action: 'EndSession',
        entityType: 'User',
        key: ended.user.key,
      })
      return Response.json(ended)
    }
    return new Response(null, { status: 405 })
  }

  async function group(request: Request, url: URL, principal: Principal, alias: string) {
    if (request.method !== 'PATCH') return new Response(null, { status: 405 })
    const dryRun = url.searchParams.get('dryRun') === 'true'
    if (!dryRun) {
      const level = options.levelRefusal()
      if (level) return level
    }
    const placed = await placeGroup(
      await options.ports(),
      principal,
      alias,
      placeChangeOf(await body(request)),
      { dryRun },
    )
    if (!dryRun && placed.changed.length > 0)
      await audited(principal, request, {
        category: 'permission',
        action: 'Save',
        entityType: 'UserGroup',
        key: placed.group.key,
      })
    return Response.json(placed)
  }

  return {
    /** The capability these routes add to discovery. */
    capabilities: ['users'],

    /** Answers one of these routes, or undefined when `what` is none of them. */
    async handle(
      request: Request,
      url: URL,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const user = /^users(?:\/([^/]+))?$/.exec(what)
      const signIn = /^sign-ins(?:\/([^/]+))?$/.exec(what)
      const userGroup = /^user-groups\/([^/]+)$/.exec(what)
      if (!user && !signIn && !userGroup) return undefined
      if (principal.ci)
        return problem(403, {
          code: 'ci-cannot-change-people',
          title: 'Changing people needs a person',
          detail: 'Sign in as yourself: CI cannot do this.',
        })
      const named = (user ?? signIn ?? userGroup)?.[1]
      const decoded = named === undefined ? undefined : decodeURIComponent(named)
      try {
        if (signIn) return await sessions(request, url, principal, decoded)
        if (!hasSection(principal, 'users'))
          return problem(403, { code: 'forbidden', title: 'You may not look after users here' })
        return user
          ? await users(request, url, principal, decoded)
          : await group(request, url, principal, decoded as string)
      } catch (error) {
        return refused(error)
      }
    },
  }
}
