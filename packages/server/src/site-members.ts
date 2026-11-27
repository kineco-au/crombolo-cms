/**
 * `site().members` (story 207): members read and changed by the site's own code,
 * acting as whoever is asking. A member reaches their own record, as far as their
 * member type lets them; a job or an event handler acts as the API user the
 * config's `members.actAs` names; a back-office user has their Members permissions.
 * docs/rendering.md, "Members".
 */
import type { Principal } from '@crombolo/api-management'
import {
  type DocumentValue,
  dateFromText,
  type FieldError,
  hasAccessToSensitiveData,
  normaliseUuid,
  ObjectTypes,
  Outcome,
  ok,
  type PropertyTypeModel,
  sectionKey,
} from '@crombolo/core'
import {
  ContentTypeRepository,
  DataTypeRepository,
  type Db,
  type DocumentRepositoryOptions,
  type MemberCredentials,
  MemberRepository,
  StaleRevisionError,
  WriteRejectedError,
} from '@crombolo/data'
import { markPersonal, type SiteMember, type SiteMembers } from '@crombolo/render'
import { recordAudit } from './adapters/audit.ts'
import { MANAGED_MEMBER, mayChange } from './managed-members.ts'
import { apiUserPrincipal, siteWriteScope } from './site-content.ts'

export interface SiteMembersDeps {
  db: Db
  nodeState?: DocumentRepositoryOptions['nodeState']
  nodeId?: string
  /** The API user jobs and event handlers act as, from `members.actAs`. */
  actAs?: string
  groups?: { selfService?: readonly string[]; managed?: readonly string[] }
}

/** Who is asking, as `site.members` acts for them. */
export type MembersCaller =
  | { kind: 'member'; key: string; name: string; email: string; username: string }
  | { kind: 'user'; principal: Principal }

type Asking = MembersCaller | undefined

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+$/
const MAX_PAGE = 500

const lower = (text: string) => text.trim().toLowerCase()
const includes = (list: readonly string[], name: string) =>
  list.some((entry) => lower(entry) === lower(name))

const mayUseMembers = (principal: Principal) =>
  (principal.allowedSections ?? []).some((s) => sectionKey(s) === sectionKey('members'))

/** Why a value cannot be a property of this storage; undefined when it can. Pure. */
export function shapeProblem(value: unknown, storage: string): string | undefined {
  if (value === null || value === undefined) return undefined
  switch (storage) {
    case 'Integer':
      return typeof value === 'boolean' || Number.isInteger(value)
        ? undefined
        : 'must be a whole number, or true or false'
    case 'Decimal':
      return typeof value === 'number' && Number.isFinite(value) ? undefined : 'must be a number'
    case 'Date':
      return value instanceof Date || (typeof value === 'string' && dateFromText(value))
        ? undefined
        : 'must be a date'
    case 'Nvarchar':
      return typeof value === 'string' || Array.isArray(value) ? undefined : 'must be text'
    default:
      return typeof value === 'string' || typeof value === 'object' ? undefined : 'must be text'
  }
}

/** Groups the config lists that do not exist, which the boot refuses. */
export async function unknownMemberGroups(
  db: Db,
  groups: SiteMembersDeps['groups'],
): Promise<string[]> {
  const listed = [...(groups?.selfService ?? []), ...(groups?.managed ?? [])]
  if (listed.length === 0) return []
  const known = await groupKeysByName(db)
  return [...new Set(listed.filter((name) => !known.has(lower(name))))]
}

async function groupKeysByName(db: Db): Promise<Map<string, string>> {
  const rows = await db.q
    .selectFrom('node')
    .select(['unique_id', 'text'])
    .where('node_object_type', '=', ObjectTypes.MemberGroup)
    .execute()
  return new Map(rows.map((row) => [lower(row.text ?? ''), normaliseUuid(String(row.unique_id))]))
}

/** Builds `site().members` for a caller, looked up when asked. */
export function createSiteMembers(deps: SiteMembersDeps) {
  const { db } = deps
  const members = new MemberRepository(db, { nodeState: deps.nodeState, nodeId: deps.nodeId })
  const types = new ContentTypeRepository(db, { kind: 'member' })
  const dataTypes = new DataTypeRepository(db)
  const selfService = deps.groups?.selfService ?? []
  const managed = deps.groups?.managed ?? []

  return (askingFor: () => Promise<Asking>): SiteMembers => {
    /** A job or an event handler is the API user, whoever queued it; anything else is who asked. */
    const caller = async (): Promise<MembersCaller | Outcome<403>> => {
      if (siteWriteScope()?.source === 'job') {
        const principal = deps.actAs
          ? await apiUserPrincipal(db, deps.actAs, { used: true })
          : undefined
        if (!principal)
          return Outcome.forbidden(
            "This site's jobs cannot reach members: name an API user in the config's members.actAs.",
          )
        return allowedUser(principal)
      }
      markPersonal()
      const asking = await askingFor()
      if (!asking) return Outcome.forbidden('Nobody is signed in.')
      return asking.kind === 'user' ? allowedUser(asking.principal) : asking
    }
    const allowedUser = (principal: Principal): MembersCaller | Outcome<403> =>
      mayUseMembers(principal)
        ? { kind: 'user', principal }
        : Outcome.forbidden('This user may not use Members.')

    const notTheirs = () => Outcome.forbidden('A member reaches their own record only.')
    const isSelf = (who: MembersCaller, key: string) =>
      who.kind === 'member' && normaliseUuid(who.key) === normaliseUuid(key)
    /** Story 445: a member a directory keeps is changed only by a request its client signed. */
    const keptOutside = (who: MembersCaller, member: MemberCredentials) =>
      !mayChange(member, who.kind === 'user' ? who.principal : undefined)

    /** A write's caller: only in a route, an action, a job, an event or a back-office screen. */
    const writer = async (): Promise<MembersCaller | Outcome<403>> => {
      const who = await caller()
      if (who instanceof Outcome) return who
      if (who.kind === 'member' && !siteWriteScope())
        return Outcome.forbidden(
          'A page render reads members and never changes them: write from an action, a route, a job or an event.',
        )
      return who
    }

    const mayRead = (who: MembersCaller, p: PropertyTypeModel) =>
      who.kind === 'member'
        ? p.memberCanView === true
        : p.isSensitive !== true || hasAccessToSensitiveData(who.principal.groups ?? [])
    const mayWrite = (who: MembersCaller, p: PropertyTypeModel) =>
      who.kind === 'member' ? p.memberCanEdit === true : mayRead(who, p)

    const shown = async (who: MembersCaller, member: MemberCredentials): Promise<SiteMember> => {
      const readable = new Set(
        (await types.resolveProperties(member.contentTypeKey))
          .filter((p) => mayRead(who, p))
          .map((p) => p.alias),
      )
      const stored = readable.size > 0 ? await members.content.byKey(member.key) : undefined
      return {
        key: member.key,
        type: member.contentTypeAlias,
        name: member.name,
        username: member.username,
        email: member.email,
        groups: member.roles,
        approved: member.isApproved,
        properties: Object.fromEntries(
          (stored?.values ?? [])
            .filter((v) => readable.has(v.alias) && !v.culture && !v.segment && !v.environment)
            .map((v) => [v.alias, v.value]),
        ),
      }
    }

    const audit = async (
      who: MembersCaller,
      action: string,
      member: { key: string; name: string },
      what: string,
    ) => {
      const scope = siteWriteScope()
      const through = scope ? `, through ${scope.via}` : ''
      await recordAudit(db, {
        category: 'member',
        action,
        source: scope?.source ?? 'request',
        userKey: who.kind === 'user' ? who.principal.id : null,
        userName: who.kind === 'user' ? who.principal.name : who.name,
        entityType: 'Member',
        entityKey: member.key,
        entityName: member.name,
        detail: `${who.kind === 'member' ? 'As the member: ' : ''}${what}${through}`,
      })
    }

    const find = async (
      allowed: (who: MembersCaller) => boolean,
      look: () => Promise<MemberCredentials | undefined>,
    ) => {
      const who = await caller()
      if (who instanceof Outcome) return who
      if (!allowed(who)) return notTheirs()
      const member = await look()
      return member ? ok(await shown(who, member)) : Outcome.notFound('There is no such member.')
    }

    const regroup = async (key: string, names: readonly string[], joining: boolean) => {
      const who = await writer()
      if (who instanceof Outcome) return who
      if (who.kind === 'member' && !isSelf(who, key)) return notTheirs()
      const open = who.kind === 'member' ? selfService : [...selfService, ...managed]
      const closed = names.filter((name) => !includes(open, name))
      if (closed.length > 0)
        return Outcome.forbidden(
          `This site's code may not change who is in ${closed.map((n) => `"${n}"`).join(', ')}.`,
        )
      const member = UUID.test(key) ? await members.byKey(key) : undefined
      if (!member) return Outcome.notFound('There is no such member.')
      if (keptOutside(who, member)) return Outcome.forbidden(MANAGED_MEMBER)
      const keys = await groupKeysByName(db)
      const wanted = names.map((name) => keys.get(lower(name)))
      if (wanted.some((k) => k === undefined))
        return Outcome.notFound('One of those groups no longer exists.')
      const before = (await members.groupKeys(member.key)).map(normaliseUuid)
      const after = joining
        ? [...new Set([...before, ...(wanted as string[])])]
        : before.filter((k) => !wanted.includes(k))
      if (after.length !== before.length) {
        await members.setGroups(member.key, after)
        await audit(who, joining ? 'JoinGroup' : 'LeaveGroup', member, names.join(', '))
      }
      return ok({ key: member.key })
    }

    return {
      async me() {
        const who = await caller()
        if (who instanceof Outcome) return who
        if (who.kind !== 'member') return Outcome.forbidden('No member is signed in.')
        const member = await members.byKey(who.key)
        return member ? ok(await shown(who, member)) : Outcome.forbidden('No member is signed in.')
      },

      get: (key) =>
        find(
          (who) => who.kind === 'user' || isSelf(who, key),
          async () => (UUID.test(key) ? members.byKey(key) : undefined),
        ),
      byEmail: (email) =>
        find(
          (who) => who.kind === 'user' || lower(who.email) === lower(email),
          () => members.byEmail(email.trim()),
        ),
      byUsername: (username) =>
        find(
          (who) => who.kind === 'user' || lower(who.username) === lower(username),
          () => members.byUsername(username.trim()),
        ),

      async list(options = {}) {
        const who = await caller()
        if (who instanceof Outcome) return who
        if (who.kind === 'member') return notTheirs()
        const after = options.after === undefined ? 0 : Number(options.after)
        if (!Number.isSafeInteger(after) || after < 0)
          return Outcome.badRequest('That is not a place in the list: pass `next` as it was given.')
        const take = Math.trunc(Math.min(Math.max(options.take ?? 100, 1), MAX_PAGE))
        const page = await members.after({
          group: options.group,
          type: options.type,
          approved: options.approved,
          text: options.text,
          since: options.since,
          after,
          take,
        })
        const items: SiteMember[] = []
        for (const member of page.items) items.push(await shown(who, member))
        return ok({ items, next: page.next === undefined ? null : String(page.next) })
      },

      async update(key, change) {
        const who = await writer()
        if (who instanceof Outcome) return who
        if (who.kind === 'member' && !isSelf(who, key)) return notTheirs()
        const member = UUID.test(key) ? await members.byKey(key) : undefined
        const stored = member ? await members.content.byKey(member.key) : undefined
        if (!member || !stored) return Outcome.notFound('There is no such member.')
        if (keptOutside(who, member)) return Outcome.forbidden(MANAGED_MEMBER)

        const errors: FieldError[] = []
        const email = change.email?.trim()
        if (email !== undefined && email !== member.email) {
          if (who.kind === 'member')
            errors.push({ field: 'email', message: 'You cannot change your e-mail address here.' })
          else if (!EMAIL.test(email))
            errors.push({ field: 'email', message: 'That is not an e-mail address.' })
          else if (await members.taken('email', email, member.key))
            errors.push({ field: 'email', message: 'Another member has that e-mail address.' })
        }
        const name = change.name?.trim()
        if (name === '') errors.push({ field: 'name', message: 'A name is needed.' })

        const byAlias = new Map(
          (await types.resolveProperties(member.contentTypeKey)).map((p) => [p.alias, p]),
        )
        const set = new Map<string, unknown>()
        for (const [alias, value] of Object.entries(change.properties ?? {})) {
          const property = byAlias.get(alias)
          if (!property) {
            errors.push({ field: alias, message: `A member has no "${alias}".` })
            continue
          }
          if (!mayWrite(who, property))
            return Outcome.forbidden(`"${alias}" may not be changed here.`)
          const storage = (await dataTypes.byKey(property.dataTypeKey))?.dbType ?? 'Ntext'
          const problem = shapeProblem(value, storage)
          if (problem) errors.push({ field: alias, message: `${property.name} ${problem}.` })
          else set.set(alias, value)
        }
        const values: DocumentValue[] = [
          ...stored.values.filter(
            (v) => !(set.has(v.alias) && !v.culture && !v.segment && !v.environment),
          ),
          ...[...set]
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([alias, value]) => ({ alias, culture: null, segment: null, value })),
        ]
        const content = {
          key: member.key,
          contentTypeKey: member.contentTypeKey,
          componentKey: null,
          parentKey: null,
          values,
          variants: [{ culture: null, segment: null, name: name || member.name }],
        }
        for (const error of await members.content.validate(content, null))
          for (const message of error.messages) errors.push({ field: error.alias, message })
        if (errors.length > 0)
          return Outcome.unprocessableContent(errors, 'Some of this could not be saved.')
        try {
          const saved = await members.update(
            member.key,
            { ...content, expectedRevision: stored.revision },
            {
              email: email ?? member.email,
              username: member.username,
              isApproved: member.isApproved,
              isLockedOut: member.isLockedOut,
            },
          )
          if (!saved) return Outcome.notFound('There is no such member.')
        } catch (error) {
          if (error instanceof StaleRevisionError || error instanceof WriteRejectedError)
            return Outcome.badRequest('This could not be saved just now. Try again.')
          throw error
        }
        const changed = [
          ...(name !== undefined ? ['name'] : []),
          ...(email !== undefined ? ['email'] : []),
          ...set.keys(),
        ]
        await audit(who, 'Save', member, changed.join(', ') || 'nothing')
        return ok({ key: member.key })
      },

      addToGroups: (key, groups) => regroup(key, groups, true),
      removeFromGroups: (key, groups) => regroup(key, groups, false),

      async delete(key) {
        const who = await writer()
        if (who instanceof Outcome) return who
        if (who.kind === 'member')
          return Outcome.forbidden('A member cannot delete their account: queue a job that does.')
        const member = UUID.test(key) ? await members.byKey(key) : undefined
        if (member && keptOutside(who, member)) return Outcome.forbidden(MANAGED_MEMBER)
        if (!member || !(await members.delete(member.key)))
          return Outcome.notFound('There is no such member.')
        await audit(who, 'Delete', member, 'deleted')
        return ok({ key: member.key })
      },
    }
  }
}
