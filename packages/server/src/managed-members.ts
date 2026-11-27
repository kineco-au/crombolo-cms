/**
 * Story 445: a member a directory provisioned is changed only by that directory. A
 * member created by an API client `members.managedBy` names remembers it as their
 * manager; anyone else's change to their name, e-mail, username, approval, groups,
 * properties or existence is refused, administrators included. Their password,
 * two-factor and lockout stay the member's and the site's. docs/configuration.md,
 * "Members managed from outside".
 */
import {
  hasSection,
  type MemberManager,
  type MemberPort,
  type MemberResponse,
  type PortFailure,
  type Principal,
  type SaveMember,
} from '@crombolo/api-management/domain'
import { normaliseUuid } from '@crombolo/core'
import { type Db, MemberRepository } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'

/** What a refused change says, wherever it was asked. */
export const MANAGED_MEMBER =
  'This member comes from a directory outside the site: change them there.'

/** Whether the principal may change the member: theirs is no manager, or the principal is it. */
export const mayChange = (
  member: { managedBy: string | null | undefined },
  principal: Pick<Principal, 'viaClient'> | undefined,
): boolean => !member.managedBy || principal?.viaClient === member.managedBy

export const managedOutside = (): PortFailure => ({
  ok: false,
  reason: MANAGED_MEMBER,
  status: 403,
  operationStatus: 'ManagedOutside',
})

/** A value's text with its keys in order, so two equal values compare equal. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  )

const at = (v: { alias?: string; culture?: string | null; segment?: string | null }) =>
  `${v.alias ?? ''}|${v.culture ?? ''}|${v.segment ?? ''}`

const valuesOf = (
  values: ReadonlyArray<{
    alias: string
    culture?: string | null
    segment?: string | null
    value?: unknown
  }>,
) =>
  new Map(
    values
      .filter((v) => v.value !== null && v.value !== undefined && v.value !== '')
      .map((v) => [at(v), canonical(v.value)]),
  )

/**
 * Whether a save leaves alone everything the directory sends: only the password, a
 * second factor turned off, or an unlock differ. Pure.
 */
export function changesOnlyTheSites(before: MemberResponse, input: SaveMember): boolean {
  if (input.email !== before.email || input.username !== before.username) return false
  if (input.isApproved !== before.isApproved) return false
  if (input.isLockedOut && !before.isLockedOut) return false
  if (input.groupKeys !== undefined) {
    const was = new Set(before.groups.map(normaliseUuid))
    const now = new Set(input.groupKeys.map(normaliseUuid))
    if (was.size !== now.size || [...now].some((key) => !was.has(key))) return false
  }
  const names = new Map(before.variants.map((v) => [at(v), v.name]))
  const sent =
    input.variants.length > 0
      ? input.variants
      : [{ culture: null, segment: null, name: input.username }]
  if (sent.some((v) => names.get(at(v)) !== v.name)) return false
  const was = valuesOf(before.values)
  const now = valuesOf(input.values)
  return was.size === now.size && [...now].every(([place, value]) => was.get(place) === value)
}

/** The member port, with each member a directory keeps changed only by it. */
export function managedMemberPort(
  db: Db,
  port: MemberPort,
  managedBy: readonly string[],
): MemberPort {
  const clients = new Set(managedBy)
  const repository = new MemberRepository(db)
  const managerOf = async (key: string) => (await repository.byKey(key))?.managedBy ?? null
  return {
    ...port,
    create(input, principal) {
      const via = principal.viaClient
      return port.create(
        { ...input, managedBy: via !== undefined && clients.has(via) ? via : null },
        principal,
      )
    },
    async update(key, input, principal) {
      const { managedBy: _ignored, ...rest } = input
      const manager = await managerOf(key)
      if (!mayChange({ managedBy: manager }, principal)) {
        const before = await port.byKey(key, principal)
        if (before && !changesOnlyTheSites(before, rest)) return managedOutside()
      }
      return port.update(key, rest, principal)
    },
    async remove(key, principal) {
      if (!mayChange({ managedBy: await managerOf(key) }, principal)) return managedOutside()
      return port.remove(key, principal)
    },
  }
}

/** The client that keeps a member, by the name of the API user it signs in as. */
export async function memberManager(
  db: Db,
  clientId: string | null,
): Promise<MemberManager | null> {
  if (!clientId) return null
  const row = await db.q
    .selectFrom('user_client_credential as c')
    .innerJoin('user_account as u', 'u.id', 'c.user_id')
    .select('u.user_name')
    .where('c.client_id', '=', clientId)
    .executeTakeFirst()
  return { clientId, name: row?.user_name || clientId }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `{pluginPath}/api/members/{key}/manager`: who keeps a member, to whoever holds
 * Members; `DELETE` hands the member back to the site, by their manager alone.
 */
export function createMemberManagerApi(db: Db) {
  const members = new MemberRepository(db)
  const refused = (status: number, message: string) => Response.json({ message }, { status })
  return {
    async handle(request: Request, principal: Principal, key: string): Promise<Response> {
      if (!UUID.test(key)) return refused(404, 'There is no such member.')
      const member = await members.byKey(key)
      if (!member) return refused(404, 'There is no such member.')
      if (request.method === 'GET') {
        const isManager = member.managedBy !== null && mayChange(member, principal)
        if (!hasSection(principal, 'members') && !isManager)
          return refused(403, 'This user may not use Members.')
        return Response.json(
          { managedBy: await memberManager(db, member.managedBy) },
          { headers: { 'cache-control': 'no-store' } },
        )
      }
      if (request.method !== 'DELETE') return new Response(null, { status: 405 })
      if (!member.managedBy) return new Response(null, { status: 204 })
      if (!mayChange(member, principal))
        return Response.json(
          { message: MANAGED_MEMBER, operationStatus: 'ManagedOutside' },
          { status: 403 },
        )
      await members.clearManager(member.key)
      await recordAudit(db, {
        category: 'member',
        action: 'HandBack',
        source: 'request',
        userKey: principal.id,
        userName: principal.name,
        entityType: 'Member',
        entityKey: member.key,
        entityName: member.name,
        detail: `Handed back to the site by ${member.managedBy}`,
        ipAddress: null,
        forwardedFor: null,
      })
      return new Response(null, { status: 204 })
    },
  }
}
