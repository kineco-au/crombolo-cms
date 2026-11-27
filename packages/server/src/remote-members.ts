/**
 * The remote protocol's routes for members and who may see a page (story 354):
 * members found, listed, made, changed and removed, member groups, and a page's
 * public access. Each answers as the signed-in person through the core the
 * command line uses; CI is refused, since these act for a person. A write is
 * audited by the member's key, never their name, e-mail or values.
 */
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import { type DocumentOperations, userActor } from '@crombolo/content'
import type { Db } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import {
  type AccessInput,
  changeMember,
  clearPageAccess,
  groupsOf,
  listMembers,
  type MemberAdminError,
  type MemberChange,
  type MemberPorts,
  memberAdminErrorOf,
  memberChangeAction,
  newGroup,
  newMember,
  pageAccess,
  removeGroup,
  removeMember,
  sendMemberResetLink,
  setPageAccess,
  showMember,
} from './member-admin.ts'

interface Problem {
  code: string
  title: string
  detail?: string
  items?: string[]
}

export interface MemberRouteOptions {
  db: Db
  ports: () => Promise<MemberPorts>
  /** Absent, a page's access is not offered. */
  operations?: DocumentOperations
  problem(status: number, body: Problem): Response
  /** A refusal when the site's remote access level takes no changes. */
  levelRefusal(): Response | undefined
}

const KEY = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

const STATUS: Record<MemberAdminError['kind'], [number, string]> = {
  not_found: [404, 'not-found'],
  refused: [403, 'forbidden'],
  usage: [400, 'bad-request'],
  conflict: [409, 'conflict'],
  invalid: [400, 'invalid'],
  unavailable: [503, 'unavailable'],
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const read = await request.json().catch(() => ({}))
  return read && typeof read === 'object' ? (read as Record<string, unknown>) : {}
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
const pairs = (value: unknown): Array<[string, string]> =>
  Array.isArray(value)
    ? value
        .filter(
          (p): p is [string, string] =>
            Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string',
        )
        .map(([a, b]) => [a, b])
    : []
const flag = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

/** A change as a request names it: only the fields it gives. */
function changeOf(asked: Record<string, unknown>): MemberChange {
  const change: MemberChange = {}
  if (text(asked.email) !== undefined) change.email = text(asked.email)
  if (text(asked.login) !== undefined) change.login = text(asked.login)
  if (text(asked.name) !== undefined) change.name = text(asked.name)
  if (Array.isArray(asked.sets)) change.sets = pairs(asked.sets)
  if (Array.isArray(asked.unset)) change.unset = texts(asked.unset)
  if (Array.isArray(asked.addGroups)) change.addGroups = texts(asked.addGroups)
  if (Array.isArray(asked.removeGroups)) change.removeGroups = texts(asked.removeGroups)
  if (flag(asked.approved) !== undefined) change.approved = flag(asked.approved)
  if (flag(asked.locked) !== undefined) change.locked = flag(asked.locked)
  if (text(asked.password)) change.password = text(asked.password)
  if (asked.generatePassword === true) change.generatePassword = true
  if (asked.twoFactor === false) change.twoFactor = false
  return change
}

export function createMemberRoutes(options: MemberRouteOptions) {
  const { db, problem } = options
  const noSection = (what: string) =>
    problem(403, { code: 'forbidden', title: `You may not ${what} here` })
  const refused = (thrown: unknown): Response => {
    const error = memberAdminErrorOf(thrown)
    if (!error) throw thrown
    const [status, code] = STATUS[error.kind]
    return problem(status, {
      code,
      title: error.message,
      ...(error.details.length > 0 ? { items: error.details } : {}),
    })
  }
  const audited = (
    principal: Principal,
    request: Request,
    action: string,
    entityType: 'Member' | 'MemberGroup',
    entityKey: string,
  ) =>
    recordAudit(db, {
      category: 'member',
      action,
      source: 'request',
      userKey: principal.id,
      userName: principal.name,
      entityType,
      entityKey,
      forwardedFor: request.headers.get('x-forwarded-for'),
      detail: 'Through the remote protocol',
    })

  async function members(request: Request, url: URL, principal: Principal, ref?: string) {
    const ports = await options.ports()
    const method = request.method
    if (method === 'GET' && !ref) {
      const number = (name: string) => {
        const value = url.searchParams.get(name)
        return value !== null && /^\d+$/.test(value) ? Number(value) : undefined
      }
      return Response.json(
        await listMembers(ports, principal, {
          group: url.searchParams.get('group') ?? undefined,
          type: url.searchParams.get('type') ?? undefined,
          find: url.searchParams.get('find') ?? undefined,
          skip: number('skip'),
          take: number('take'),
        }),
      )
    }
    if (method === 'GET' && ref) return Response.json(await showMember(ports, principal, ref))
    const level = options.levelRefusal()
    if (level) return level
    if (method === 'POST' && !ref) {
      const asked = await body(request)
      const made = await newMember(ports, principal, {
        email: text(asked.email) ?? '',
        type: text(asked.type) ?? '',
        login: text(asked.login),
        name: text(asked.name),
        groups: texts(asked.groups),
        sets: pairs(asked.sets),
        password: text(asked.password),
      })
      await audited(principal, request, 'Create', 'Member', made.key)
      return Response.json(made, { status: 201 })
    }
    if ((method === 'PATCH' || method === 'DELETE') && !new RegExp(`^${KEY}$`).test(ref ?? ''))
      return problem(400, { code: 'bad-key', title: 'A member is changed by their key' })
    if (method === 'PATCH' && ref) {
      const change = changeOf(await body(request))
      const done = await changeMember(ports, principal, ref, change)
      if (done.changed)
        await audited(principal, request, memberChangeAction(change), 'Member', done.member.key)
      return Response.json(done)
    }
    if (method === 'DELETE' && ref) {
      const gone = await removeMember(ports, principal, ref)
      await audited(principal, request, 'Delete', 'Member', gone.key)
      return Response.json(gone)
    }
    return new Response(null, { status: 405 })
  }

  async function groups(request: Request, url: URL, principal: Principal, name?: string) {
    const ports = await options.ports()
    const method = request.method
    if (method === 'GET' && !name) return Response.json({ groups: await groupsOf(ports) })
    const level = options.levelRefusal()
    if (level) return level
    if (method === 'POST' && !name) {
      const made = await newGroup(ports, text((await body(request)).name) ?? '', principal)
      await audited(principal, request, 'Create', 'MemberGroup', made.key)
      return Response.json(made, { status: 201 })
    }
    if (method === 'DELETE' && name) {
      const gone = await removeGroup(
        ports,
        name,
        url.searchParams.get('confirmed') === 'true',
        principal,
      )
      await audited(principal, request, 'Delete', 'MemberGroup', gone.key)
      return Response.json(gone)
    }
    return new Response(null, { status: 405 })
  }

  async function access(
    request: Request,
    principal: Principal,
    operations: DocumentOperations,
    key: string,
  ) {
    const method = request.method
    const ports = await options.ports()
    if (method === 'GET') return Response.json(await pageAccess(ports, key))
    const level = options.levelRefusal()
    if (level) return level
    const actor = userActor(principal, {
      source: 'request',
      forwardedFor: request.headers.get('x-forwarded-for'),
    })
    if (method === 'PUT') {
      const asked = await body(request)
      const input: AccessInput = {
        groups: texts(asked.groups),
        members: texts(asked.members),
        ...(text(asked.loginPage) ? { loginPage: text(asked.loginPage) } : {}),
        ...(text(asked.noAccessPage) ? { noAccessPage: text(asked.noAccessPage) } : {}),
      }
      return Response.json(await setPageAccess(ports, operations, actor, key, input))
    }
    if (method === 'DELETE')
      return Response.json(await clearPageAccess(ports, operations, actor, key))
    return new Response(null, { status: 405 })
  }

  return {
    /** The capabilities these routes add to discovery. */
    capabilities: ['members', ...(options.operations ? ['public-access'] : [])],

    /** Answers one of these routes, or undefined when `what` is none of them. */
    async handle(
      request: Request,
      url: URL,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const reset = /^members\/([^/]+)\/reset-link$/.exec(what)
      if (reset) {
        if (principal.ci)
          return problem(403, {
            code: 'ci-cannot-change-people',
            title: 'Members need a person',
            detail: 'Sign in as yourself: CI cannot do this.',
          })
        if (!hasSection(principal, 'members')) return noSection('look after members')
        if (request.method !== 'POST') return new Response(null, { status: 405 })
        const level = options.levelRefusal()
        if (level) return level
        try {
          const { member: found, outcome } = await sendMemberResetLink(
            await options.ports(),
            principal,
            decodeURIComponent(reset[1] as string),
            url.origin,
          )
          if ('refused' in outcome)
            return problem(outcome.refused === 'provider' ? 403 : 503, {
              code: outcome.refused === 'provider' ? 'signs-in-through-provider' : 'unavailable',
              title:
                outcome.refused === 'provider'
                  ? 'They sign in through an identity provider, so have no password to reset'
                  : 'This site has no page for setting a password: set members.resetPasswordPage',
            })
          await audited(principal, request, 'SendPasswordReset', 'Member', found.key)
          // A link is handed back only when it could not be sent.
          return Response.json(outcome)
        } catch (error) {
          return refused(error)
        }
      }
      const member = /^members(?:\/([^/]+))?$/.exec(what)
      const group = /^member-groups(?:\/([^/]+))?$/.exec(what)
      const page = options.operations ? new RegExp(`^content/(${KEY})/access$`).exec(what) : null
      if (!member && !group && !page) return undefined
      if (principal.ci)
        return problem(403, {
          code: 'ci-cannot-change-people',
          title: 'Members need a person',
          detail: 'Sign in as yourself: CI cannot do this.',
        })
      try {
        if (page) {
          if (!hasSection(principal, 'content')) return noSection('change who may see pages')
          return await access(
            request,
            principal,
            options.operations as DocumentOperations,
            page[1] as string,
          )
        }
        if (!hasSection(principal, 'members')) return noSection('look after members')
        const named = (member ?? group)?.[1]
        const decoded = named === undefined ? undefined : decodeURIComponent(named)
        return member
          ? await members(request, url, principal, decoded)
          : await groups(request, url, principal, decoded)
      } catch (error) {
        return refused(error)
      }
    },
  }
}
