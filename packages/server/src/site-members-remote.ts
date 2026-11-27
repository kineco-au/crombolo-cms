/**
 * Story 444: `site().members` on a site whose members another site holds. Reads and
 * writes go to that site through the same client the Members section uses, each write
 * naming who it is for: the back-office user, or the code or job that wrote. A job
 * acts through this site's service account there, so `members.actAs` is not needed.
 */
import type { MemberResponse, SaveMember } from '@crombolo/api-management/domain'
import {
  type DocumentValue,
  type FieldError,
  hasAccessToSensitiveData,
  normaliseUuid,
  Outcome,
  ok,
  type PropertyTypeModel,
  sectionKey,
} from '@crombolo/core'
import { ContentTypeRepository, DataTypeRepository, type Db } from '@crombolo/data'
import { markPersonal, type SiteMember, type SiteMembers } from '@crombolo/render'
import { MANAGED_MEMBER } from './managed-members.ts'
import { type ActingFor, type MembersSource, MembersSourceError } from './members-remote.ts'
import { siteWriteScope } from './site-content.ts'
import { type MembersCaller, type SiteMembersDeps, shapeProblem } from './site-members.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+$/
const MAX_PAGE = 500

const lower = (text: string) => text.trim().toLowerCase()
const includes = (list: readonly string[], name: string) =>
  list.some((entry) => lower(entry) === lower(name))

type Caller = MembersCaller | { kind: 'job'; via: string }

/** A failure from the other site, as `site().members` answers one: refused, in its words. */
function answered(error: unknown): Outcome<403> {
  if (error instanceof MembersSourceError) return Outcome.forbidden(error.message)
  throw error
}

export function createRemoteSiteMembers(
  deps: Pick<SiteMembersDeps, 'db' | 'groups'> & { db: Db; source: MembersSource },
) {
  const { db, source } = deps
  const remote = source.members
  const types = new ContentTypeRepository(db, { kind: 'member' })
  const dataTypes = new DataTypeRepository(db)
  const selfService = deps.groups?.selfService ?? []
  const managed = deps.groups?.managed ?? []

  return (askingFor: () => Promise<MembersCaller | undefined>): SiteMembers => {
    const caller = async (): Promise<Caller | Outcome<403>> => {
      const scope = siteWriteScope()
      if (scope?.source === 'job') return { kind: 'job', via: scope.via }
      markPersonal()
      const asking = await askingFor()
      if (!asking) return Outcome.forbidden('Nobody is signed in.')
      if (
        asking.kind === 'user' &&
        !(asking.principal.allowedSections ?? []).some(
          (s) => sectionKey(s) === sectionKey('members'),
        )
      )
        return Outcome.forbidden('This user may not use Members.')
      return asking
    }

    /** Who a write is for, as the other site's audit names them. */
    const actingFor = (who: Caller): ActingFor => {
      const via = siteWriteScope()?.via
      if (who.kind === 'job') return { id: who.via, name: who.via }
      if (who.kind === 'user')
        return {
          id: who.principal.id,
          name: via ? `${who.principal.name}, ${via}` : who.principal.name,
        }
      return { id: who.key, name: via ? `${who.name}, ${via}` : who.name }
    }

    const writer = async (): Promise<Caller | Outcome<403>> => {
      const who = await caller()
      if (who instanceof Outcome) return who
      if (who.kind === 'member' && !siteWriteScope())
        return Outcome.forbidden(
          'A page render reads members and never changes them: write from an action, a route, a job or an event.',
        )
      return who
    }

    const notTheirs = () => Outcome.forbidden('A member reaches their own record only.')
    const isSelf = (who: Caller, key: string) =>
      who.kind === 'member' && normaliseUuid(who.key) === normaliseUuid(key)

    const mayRead = (who: Caller, p: PropertyTypeModel) =>
      who.kind === 'member'
        ? p.memberCanView === true
        : who.kind === 'job' ||
          p.isSensitive !== true ||
          hasAccessToSensitiveData(who.principal.groups ?? [])
    const mayWrite = (who: Caller, p: PropertyTypeModel) =>
      who.kind === 'member' ? p.memberCanEdit === true : mayRead(who, p)

    const groupNames = async (keys: readonly string[]) => {
      const byKey = new Map((await source.groups()).map((g) => [g.key, g.name]))
      const missing = keys.some((key) => !byKey.has(normaliseUuid(key)))
      if (missing) source.forgetGroups()
      const fresh = missing ? new Map((await source.groups()).map((g) => [g.key, g.name])) : byKey
      return keys.flatMap((key) => fresh.get(normaliseUuid(key)) ?? [])
    }

    const typeAlias = async (key: string) => (await types.byKey(key))?.alias ?? ''

    const shown = async (who: Caller, member: MemberResponse): Promise<SiteMember> => {
      const readable = new Set(
        (await types.resolveProperties(member.memberType.id))
          .filter((p) => mayRead(who, p))
          .map((p) => p.alias),
      )
      return {
        key: normaliseUuid(member.id),
        type: await typeAlias(member.memberType.id),
        name: member.variants[0]?.name ?? member.username,
        username: member.username,
        email: member.email,
        groups: await groupNames(member.groups),
        approved: member.isApproved,
        properties: Object.fromEntries(
          member.values
            .filter((v) => readable.has(v.alias) && !v.culture && !v.segment)
            .map((v) => [v.alias, v.value]),
        ),
      }
    }

    /** What a save of the member as they are sends, with `change` on top. */
    const saveOf = (member: MemberResponse, change: Partial<SaveMember>): SaveMember => ({
      key: member.id,
      memberTypeKey: member.memberType.id,
      email: member.email,
      username: member.username,
      isApproved: member.isApproved,
      isLockedOut: member.isLockedOut,
      isTwoFactorEnabled: member.isTwoFactorEnabled,
      groupKeys: member.groups,
      values: member.values.map((v) => ({
        alias: v.alias,
        culture: v.culture ?? null,
        segment: v.segment ?? null,
        value: v.value,
      })),
      variants: member.variants.map((v) => ({
        culture: v.culture ?? null,
        segment: v.segment ?? null,
        name: v.name,
      })),
      ...change,
    })

    const refusal = (failure: { reason: string; status?: number; operationStatus?: string }) =>
      failure.operationStatus === 'ManagedOutside'
        ? Outcome.forbidden(MANAGED_MEMBER)
        : failure.status === 404
          ? Outcome.notFound('There is no such member.')
          : Outcome.forbidden(failure.reason)

    const find = async (
      allowed: (who: Caller) => boolean,
      look: () => Promise<MemberResponse | undefined>,
    ) => {
      const who = await caller()
      if (who instanceof Outcome) return who
      if (!allowed(who)) return notTheirs()
      try {
        const member = await look()
        return member ? ok(await shown(who, member)) : Outcome.notFound('There is no such member.')
      } catch (error) {
        return answered(error)
      }
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
      try {
        const member = UUID.test(key) ? await remote.byKey(key) : undefined
        if (!member) return Outcome.notFound('There is no such member.')
        const byName = new Map((await source.groups()).map((g) => [lower(g.name), g.key]))
        const wanted = names.map((name) => byName.get(lower(name)))
        if (wanted.some((k) => k === undefined))
          return Outcome.notFound('One of those groups no longer exists.')
        const before = member.groups.map(normaliseUuid)
        const after = joining
          ? [...new Set([...before, ...(wanted as string[])])]
          : before.filter((k) => !wanted.includes(k))
        if (after.length !== before.length) {
          const saved = await remote.update(
            member.id,
            saveOf(member, { groupKeys: after }),
            actingFor(who),
          )
          if (!saved.ok) return refusal(saved)
        }
        return ok({ key: normaliseUuid(member.id) })
      } catch (error) {
        return answered(error)
      }
    }

    return {
      async me() {
        const who = await caller()
        if (who instanceof Outcome) return who
        if (who.kind !== 'member') return Outcome.forbidden('No member is signed in.')
        try {
          const member = UUID.test(who.key) ? await remote.byKey(who.key) : undefined
          return member
            ? ok(await shown(who, member))
            : Outcome.forbidden('No member is signed in.')
        } catch (error) {
          return answered(error)
        }
      },

      get: (key) =>
        find(
          (who) => who.kind !== 'member' || isSelf(who, key),
          async () => (UUID.test(key) ? remote.byKey(key) : undefined),
        ),
      byEmail: (email) =>
        find(
          (who) => who.kind !== 'member' || lower(who.email) === lower(email),
          () => remote.byEmail(email.trim()),
        ),
      byUsername: (username) =>
        find(
          (who) => who.kind !== 'member' || lower(who.username) === lower(username),
          () => remote.byUsername(username.trim()),
        ),

      async list(options = {}) {
        const who = await caller()
        if (who instanceof Outcome) return who
        if (who.kind === 'member') return notTheirs()
        const after = options.after === undefined ? 0 : Number(options.after)
        if (!Number.isSafeInteger(after) || after < 0)
          return Outcome.badRequest('That is not a place in the list: pass `next` as it was given.')
        const take = Math.trunc(Math.min(Math.max(options.take ?? 100, 1), MAX_PAGE))
        try {
          const typeKey = options.type
            ? (await types.all()).find((t) => lower(t.alias) === lower(options.type as string))?.key
            : undefined
          if (options.type && !typeKey) return ok({ items: [], next: null })
          const page = await remote.filter({
            skip: after,
            take,
            memberTypeId: typeKey,
            memberGroupName: options.group,
            isApproved: options.approved,
            filter: options.text,
          })
          const since = options.since?.getTime()
          const items: SiteMember[] = []
          for (const member of page.items) {
            const saved = Math.max(
              ...member.variants.map((v) => Date.parse(v.updateDate ?? v.createDate ?? '') || 0),
            )
            if (since === undefined || saved >= since) items.push(await shown(who, member))
          }
          const next = after + page.items.length
          return ok({ items, next: next < page.total ? String(next) : null })
        } catch (error) {
          return answered(error)
        }
      },

      async update(key, change) {
        const who = await writer()
        if (who instanceof Outcome) return who
        if (who.kind === 'member' && !isSelf(who, key)) return notTheirs()
        try {
          const member = UUID.test(key) ? await remote.byKey(key) : undefined
          if (!member) return Outcome.notFound('There is no such member.')
          const errors: FieldError[] = []
          const email = change.email?.trim()
          if (email !== undefined && email !== member.email) {
            if (who.kind === 'member')
              errors.push({
                field: 'email',
                message: 'You cannot change your e-mail address here.',
              })
            else if (!EMAIL.test(email))
              errors.push({ field: 'email', message: 'That is not an e-mail address.' })
          }
          const name = change.name?.trim()
          if (name === '') errors.push({ field: 'name', message: 'A name is needed.' })
          const byAlias = new Map(
            (await types.resolveProperties(member.memberType.id)).map((p) => [p.alias, p]),
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
          if (errors.length > 0)
            return Outcome.unprocessableContent(errors, 'Some of this could not be saved.')
          const current = saveOf(member, {})
          const values: DocumentValue[] = [
            ...current.values.filter((v) => !(set.has(v.alias) && !v.culture && !v.segment)),
            ...[...set]
              .filter(([, value]) => value !== null && value !== undefined)
              .map(([alias, value]) => ({ alias, culture: null, segment: null, value })),
          ]
          const saved = await remote.update(
            member.id,
            saveOf(member, {
              email: email ?? member.email,
              values,
              variants: [
                {
                  culture: null,
                  segment: null,
                  name: name || (member.variants[0]?.name ?? member.username),
                },
              ],
            }),
            actingFor(who),
          )
          if (!saved.ok)
            return saved.status === 400 ? Outcome.badRequest(saved.reason) : refusal(saved)
          return ok({ key: normaliseUuid(member.id) })
        } catch (error) {
          return answered(error)
        }
      },

      addToGroups: (key, groups) => regroup(key, groups, true),
      removeFromGroups: (key, groups) => regroup(key, groups, false),

      async delete(key) {
        const who = await writer()
        if (who instanceof Outcome) return who
        if (who.kind === 'member')
          return Outcome.forbidden('A member cannot delete their account: queue a job that does.')
        try {
          if (!UUID.test(key)) return Outcome.notFound('There is no such member.')
          const removed = await remote.remove(key, actingFor(who))
          if (removed === false) return Outcome.notFound('There is no such member.')
          if (removed !== true) return refusal(removed)
          return ok({ key: normaliseUuid(key) })
        } catch (error) {
          return answered(error)
        }
      },
    }
  }
}
