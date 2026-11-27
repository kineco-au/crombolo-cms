/**
 * Members, their groups and who may see a page (story 354), the same for the
 * command line on the site's own database and for the remote protocol. Members
 * are saved through the member port the Members section uses, and a page's
 * public access through the content operations, so the rules are the back
 * office's. A change is fields, not flags: story 155's import builds on it.
 */
import { resolveDeliveryApiSettings } from '@crombolo/api-delivery'
import {
  type MemberGroupPort,
  type MemberPort,
  type MemberResponse,
  type Principal,
  type PublicAccessRuleBreak,
  publicAccessRuleBreak,
  type SaveMember,
} from '@crombolo/api-management/domain'
import { generatePassword } from '@crombolo/auth'
import type { Actor, DocumentOperations } from '@crombolo/content'
import {
  type ContentTypeAggregate,
  type DocumentValue,
  hasAccessToSensitiveData,
  normaliseUuid,
  ObjectTypes,
} from '@crombolo/core'
import {
  ContentTypeRepository,
  currentSchemaState,
  type Db,
  ExternalLoginRepository,
  externalLoginProvider,
  looksLikeKey,
  MemberRepository,
  NodeRepository,
  PublicAccessRepository,
} from '@crombolo/data'
import { createMemberGroupPort } from './adapters/member-groups.ts'
import { createMemberPort, type MemberPortOptions } from './adapters/members.ts'
import type { CromboloConfig } from './config.ts'
import type { EmailPort } from './email.ts'
import { siteEmail } from './email-settings.ts'
import { managedMemberPort } from './managed-members.ts'
import { createMemberResetLinks } from './member-reset.ts'
import {
  actingForPrincipal,
  createRemoteMemberGroupPort,
  createRemoteMemberPort,
  type MemberSignIn,
  type MembersSource,
  MembersSourceError,
  membersSourceFor,
} from './members-remote.ts'
import {
  type SchemaLookup,
  schemaLookup,
  siteValueRefs,
  typedValue,
  valueWriter,
} from './seed/index.ts'
import { namedPath, pageReader, type ShownValue } from './undo.ts'

export type MemberAdminKind =
  | 'not_found'
  | 'refused'
  | 'usage'
  | 'conflict'
  | 'invalid'
  | 'unavailable'

/** Why a member, group or page access change was refused, in words for a person. */
export class MemberAdminError extends Error {
  constructor(
    readonly kind: MemberAdminKind,
    message: string,
    readonly details: string[] = [],
  ) {
    super(message)
  }
}

export interface MemberPorts {
  db: Db
  members: MemberPort
  groups: MemberGroupPort
  /** Story 448: the reads of members beside the ports, wherever the members are kept. */
  memberLookup: MemberLookup
  lookup: SchemaLookup
  writer: ReturnType<typeof valueWriter>
}

export type { MemberSignIn }

/** What a reset link came to: sent, handed back where it couldn't be, or refused. */
export type MemberResetLink =
  | { sent: boolean; link?: string }
  | { refused: 'provider' | 'unavailable' }

/**
 * Story 448: what is read of members beside the member and group ports, over this
 * site's database or the site that holds its members (story 444).
 */
export interface MemberLookup {
  /** The key of the member a key, an e-mail address or a login names, whatever the casing. */
  find(ref: string): Promise<string | undefined>
  /** A member's login, by key. */
  loginOf(key: string): Promise<string | undefined>
  /** The identity providers a member signs in with; their id there is filtered by the caller. */
  signIns(key: string): Promise<MemberSignIn[]>
  /** How many members each group has, by the group's key. */
  counts(groups: ReadonlyArray<{ key: string; name: string }>): Promise<Map<string, number>>
  /** The names of every member group. */
  groupNames(): Promise<Set<string>>
  /** Those of `logins` a member has. */
  logins(logins: readonly string[]): Promise<string[]>
  /** A reset link for a member, sent or handed back, the write named for `principal`. */
  resetLink(
    member: { key: string; name: string; email: string; username: string },
    principal: Principal,
    origin?: string,
  ): Promise<MemberResetLink>
}

export interface SiteMemberPortOptions {
  /** A running server's own schema state, so a node behind the database refuses the write. */
  nodeState?: MemberPortOptions['nodeState']
  /** The site's e-mail, for a reset link; the site's settings when left out. */
  email?: () => EmailPort | undefined | Promise<EmailPort | undefined>
  /** The server's client for the site that holds the members; made from the config when left out. */
  source?: MembersSource
}

/**
 * The member ports over a site's database, as its server makes them. A running
 * server passes its own schema state, so a node behind the database refuses the
 * write as its own ports do; the command line reads the database's. With
 * `members.source` set (story 444), they reach the site that holds the members.
 */
export async function siteMemberPorts(
  db: Db,
  config: CromboloConfig,
  options: SiteMemberPortOptions = {},
): Promise<MemberPorts> {
  const lookup = schemaLookup(db)
  const nodeState = options.nodeState ?? (await currentSchemaState(db))
  const own = createMemberPort(db, {
    nodeState: { version: nodeState.version, revision: nodeState.revision },
    nodeId: config.nodeId,
    apiMemberUserNames: resolveDeliveryApiSettings(
      config.deliveryApi,
    ).memberAuthorization.clientCredentialsFlow.associatedMembers.map((m) => m.userName),
  })
  const shared = { db, lookup, writer: valueWriter(lookup, siteValueRefs(db)) }
  const source = options.source ?? membersSourceFor(config)
  if (source)
    return {
      ...shared,
      members: createRemoteMemberPort(source.client, { validate: own.validate }),
      groups: createRemoteMemberGroupPort(source.client, {
        onChange: () => source.forgetGroups(),
      }),
      memberLookup: remoteMemberLookup(source),
    }
  return {
    ...shared,
    members: managedMemberPort(db, own, config.members?.managedBy ?? []),
    groups: createMemberGroupPort(db),
    memberLookup: localMemberLookup(db, config, options.email ?? (() => siteEmail(db, config))),
  }
}

/** The reads over this site's own database. */
export function localMemberLookup(
  db: Db,
  config: CromboloConfig,
  email: () => EmailPort | undefined | Promise<EmailPort | undefined>,
): MemberLookup {
  const members = new MemberRepository(db)
  return {
    async find(ref) {
      const wanted = ref.trim()
      const lower = wanted.toLowerCase()
      const rows = await db.q
        .selectFrom('member as m')
        .innerJoin('node as n', 'n.id', 'm.node_id')
        .select(['n.unique_id', 'm.email', 'm.login_name'])
        .where((eb) =>
          eb.or([
            ...(looksLikeKey(wanted) ? [eb('n.unique_id', '=', normaliseUuid(wanted))] : []),
            eb(eb.fn('lower', ['m.email']), '=', lower),
            eb(eb.fn('lower', ['m.login_name']), '=', lower),
          ]),
        )
        .execute()
      const found =
        rows.find((r) => normaliseUuid(String(r.unique_id)) === lower) ??
        rows.find((r) => String(r.email).toLowerCase() === lower) ??
        rows[0]
      return found ? normaliseUuid(String(found.unique_id)) : undefined
    },
    async loginOf(key) {
      return (await members.byKey(key))?.username
    },
    async signIns(key) {
      const memberLogins = externalLoginProvider('member', '')
      const providers = new Map(config.memberIdentityProviders.map((p) => [p.oidc.id, p.oidc.name]))
      return (await new ExternalLoginRepository(db).forOwner(key))
        .filter((login) => login.loginProvider.startsWith(memberLogins))
        .map((login) => {
          const id = login.loginProvider.slice(memberLogins.length)
          return {
            provider: id,
            name: providers.get(id) ?? id,
            declared: providers.has(id),
            subject: login.providerKey,
          }
        })
    },
    async counts() {
      const counts = await db.q
        .selectFrom('member_group_member as mg')
        .innerJoin('node as g', 'g.id', 'mg.member_group_id')
        .select(['g.unique_id', (eb) => eb.fn.countAll<number>().as('members')])
        .groupBy('g.unique_id')
        .execute()
      return new Map(counts.map((c) => [normaliseUuid(String(c.unique_id)), Number(c.members)]))
    },
    async groupNames() {
      return new Set(
        (
          await new NodeRepository(db).roots(ObjectTypes.MemberGroup, 0, Number.MAX_SAFE_INTEGER)
        ).items.map((g) => g.text ?? ''),
      )
    },
    async logins(logins) {
      const found: string[] = []
      for (const login of logins) if (await members.byUsername(login)) found.push(login)
      return found
    },
    async resetLink(member, _principal, origin) {
      const port = await email()
      const outcome = await createMemberResetLinks(db, config, () => port).sendResetLink(
        member,
        origin ? { origin } : {},
      )
      if ('refused' in outcome) return outcome
      return { sent: outcome.sent, ...(outcome.sent ? {} : { link: outcome.link }) }
    },
  }
}

/** The reads over the site that holds the members: its Management API, and its own routes beside it. */
export function remoteMemberLookup(source: MembersSource): MemberLookup {
  const remote = source.members
  const exactly = async (wanted: string) => {
    const lower = wanted.toLowerCase()
    const page = await remote.filter({ filter: wanted, skip: 0, take: 100 })
    return (
      page.items.find((m) => m.email.toLowerCase() === lower) ??
      page.items.find((m) => m.username.toLowerCase() === lower)
    )
  }
  return {
    async find(ref) {
      const wanted = ref.trim()
      if (looksLikeKey(wanted)) {
        const member = await remote.byKey(normaliseUuid(wanted))
        if (member) return normaliseUuid(member.id)
      }
      const member = wanted ? await exactly(wanted) : undefined
      return member ? normaliseUuid(member.id) : undefined
    },
    async loginOf(key) {
      return (await remote.byKey(key))?.username
    },
    signIns: (key) => remote.signIns(key),
    async counts(groups) {
      const counts = new Map<string, number>()
      for (const group of groups)
        counts.set(
          group.key,
          (await remote.filter({ memberGroupName: group.name, skip: 0, take: 0 })).total,
        )
      return counts
    },
    async groupNames() {
      return new Set((await source.groups()).map((g) => g.name))
    },
    async logins(logins) {
      const found: string[] = []
      for (const login of logins) if (await remote.byUsername(login)) found.push(login)
      return found
    },
    async resetLink(member, principal) {
      try {
        return await remote.resetLink(member.key, actingForPrincipal(principal))
      } catch (error) {
        if (error instanceof MembersSourceError && error.kind === 'refused')
          throw new MemberAdminError('refused', error.message)
        throw error
      }
    },
  }
}

/**
 * A refusal as a person reads it: the site's own, or the site that holds the members not
 * answering or refusing (story 444); undefined for anything else.
 */
export function memberAdminErrorOf(error: unknown): MemberAdminError | undefined {
  if (error instanceof MemberAdminError) return error
  if (error instanceof MembersSourceError)
    return new MemberAdminError(
      error.kind === 'unreachable' ? 'unavailable' : 'refused',
      error.message,
    )
  return undefined
}

/** How a member signs in: a password, only through an identity provider, or as a Delivery API client. */
export type SignsIn = 'password' | 'provider' | 'api'

export interface MemberSummary {
  key: string
  login: string
  email: string
  name: string
  type: string
  groups: string[]
  approved: boolean
  locked: boolean
  signsIn: SignsIn
  lastSignIn: string | null
}

export interface MemberDetail extends MemberSummary {
  twoFactor: boolean
  failedSignIns: number
  lastLockout: string | null
  lastPasswordChange: string | null
  created: string | null
  updated: string | null
  values: ShownValue[]
  /**
   * Story 432: the identity providers they sign in with, by the provider's id here; the
   * provider's id for them only to the Sensitive data group.
   */
  signsInWith: Array<{ provider: string; subject?: string }>
}

const SIGNS_IN: Record<string, SignsIn> = {
  Api: 'api',
  ExternalOnly: 'provider',
  Default: 'password',
}

/** Group names and member type aliases by key, read once for a list. */
async function namesOf(ports: MemberPorts) {
  const groups = await allGroups(ports)
  const types = await new ContentTypeRepository(ports.db, { kind: 'member' }).all()
  return {
    groups: new Map(groups.map((g) => [normaliseUuid(g.key), g.name])),
    types: new Map(types.map((t) => [normaliseUuid(t.key), t.alias])),
  }
}

function summaryOf(
  member: MemberResponse,
  names: Awaited<ReturnType<typeof namesOf>>,
): MemberSummary {
  return {
    key: member.id,
    login: member.username,
    email: member.email,
    name: member.variants[0]?.name ?? member.username,
    type: names.types.get(normaliseUuid(member.memberType.id)) ?? member.memberType.id,
    groups: member.groups
      .map((key) => names.groups.get(normaliseUuid(key)))
      .filter((name): name is string => name !== undefined)
      .sort((a, b) => a.localeCompare(b)),
    approved: member.isApproved,
    locked: member.isLockedOut,
    signsIn: SIGNS_IN[member.kind] ?? 'password',
    lastSignIn: member.lastLoginDate ?? null,
  }
}

async function detailOf(
  ports: MemberPorts,
  member: MemberResponse,
  viewer?: Principal,
): Promise<MemberDetail> {
  const sensitive = viewer ? hasAccessToSensitiveData(viewer.groups ?? []) : false
  const signsInWith = (await ports.memberLookup.signIns(member.id)).map((login) => ({
    provider: login.provider,
    ...(sensitive && login.subject !== undefined ? { subject: login.subject } : {}),
  }))
  const type = await ports.lookup.typeByKey('member', member.memberType.id)
  const editors = type ? await ports.lookup.editorsOf('member', type) : new Map()
  const reader = pageReader(ports.db, ports.lookup)
  const values: ShownValue[] = []
  for (const v of member.values) {
    if (v.segment) continue
    values.push({
      property: v.alias,
      culture: v.culture ?? null,
      value: await reader.shorthand(editors.get(v.alias)?.editor ?? '', v.value),
    })
  }
  const variant = member.variants[0]
  return {
    ...summaryOf(member, await namesOf(ports)),
    twoFactor: member.isTwoFactorEnabled,
    failedSignIns: member.failedPasswordAttempts,
    lastLockout: member.lastLockoutDate ?? null,
    lastPasswordChange: member.lastPasswordChangeDate ?? null,
    created: variant?.createDate ?? null,
    updated: variant?.updateDate ?? null,
    values,
    signsInWith,
  }
}

/** The member a key, an e-mail address or a login names, whatever the casing. */
export async function findMember(ports: MemberPorts, ref: string): Promise<string> {
  const found = await ports.memberLookup.find(ref)
  if (!found) throw new MemberAdminError('not_found', `There is no member "${ref.trim()}".`)
  return found
}

async function stored(ports: MemberPorts, key: string, viewer: Principal) {
  const member = await ports.members.byKey(key, viewer)
  if (!member) throw new MemberAdminError('not_found', 'The member could not be found.')
  return member
}

/** A member, with what the Members section shows of them; values as the viewer may see them. */
export async function showMember(
  ports: MemberPorts,
  viewer: Principal,
  ref: string,
): Promise<MemberDetail> {
  return detailOf(ports, await stored(ports, await findMember(ports, ref), viewer), viewer)
}

export interface MemberQuery {
  group?: string
  type?: string
  find?: string
  skip?: number
  take?: number
}

/** Members, by login, through the Members section's filter. */
export async function listMembers(
  ports: MemberPorts,
  viewer: Principal,
  query: MemberQuery = {},
): Promise<{ items: MemberSummary[]; total: number }> {
  const type = query.type ? await memberType(ports, query.type) : undefined
  const group = query.group ? await groupNamed(ports, query.group) : undefined
  const page = await ports.members.filter(
    {
      skip: query.skip ?? 0,
      take: query.take ?? 50,
      memberTypeKey: type?.key ?? null,
      memberGroupName: group?.name ?? null,
      ...(query.find ? { filter: query.find } : {}),
    },
    viewer,
  )
  const names = await namesOf(ports)
  return { total: page.total, items: page.items.map((m) => summaryOf(m, names)) }
}

async function memberType(ports: MemberPorts, alias: string): Promise<ContentTypeAggregate> {
  const type = await ports.lookup.typeOf('member', alias)
  if (!type) throw new MemberAdminError('not_found', `There is no member type "${alias}".`)
  return type
}

/** Values set and unset on a member's own, each converted by its property's editor. */
async function withSets(
  ports: MemberPorts,
  principal: Principal,
  member: { key: string; typeKey: string },
  values: readonly DocumentValue[],
  sets: ReadonlyArray<readonly [string, string]>,
  unset: readonly string[],
): Promise<DocumentValue[]> {
  if (sets.length === 0 && unset.length === 0) return [...values]
  const type = await ports.lookup.typeByKey('member', member.typeKey)
  if (!type) throw new MemberAdminError('not_found', 'The member type could not be found.')
  const editors = await ports.lookup.editorsOf('member', type)
  const properties = await ports.lookup.repos.member.resolveProperties(type.key)
  const sensitive = new Set(properties.filter((p) => p.isSensitive === true).map((p) => p.alias))
  const mayChangeSensitive = hasAccessToSensitiveData(principal.groups ?? [])
  const editorOf = (alias: string) => {
    const editor = editors.get(alias)
    if (!editor)
      throw new MemberAdminError(
        'refused',
        `Nothing was changed: "${type.alias}" has no property "${alias}".`,
      )
    if (sensitive.has(alias) && !mayChangeSensitive)
      throw new MemberAdminError('refused', `Only the Sensitive data group can change ${alias}.`)
    return editor
  }
  const out = values.map(({ alias, culture, segment, value }) => ({
    alias,
    culture,
    segment,
    value,
  }))
  const at = (alias: string) =>
    out.findIndex((v) => v.alias === alias && v.culture === null && v.segment === null)
  for (const [alias, text] of sets) {
    const { editor } = editorOf(alias)
    const converted = await ports.writer.convert(
      editor,
      typedValue(editor, text),
      member.key,
      alias,
    )
    if (!converted.ok)
      throw new MemberAdminError('refused', `Nothing was changed: ${alias}: ${converted.message}.`)
    const value = { alias, culture: null, segment: null, value: converted.value }
    const index = at(alias)
    if (index >= 0) out[index] = value
    else out.push(value)
  }
  for (const alias of unset) {
    editorOf(alias)
    const index = at(alias)
    if (index >= 0) out.splice(index, 1)
  }
  return out
}

async function groupKeysOf(ports: MemberPorts, names: readonly string[]): Promise<string[]> {
  const keys: string[] = []
  for (const name of names) keys.push((await groupNamed(ports, name)).key)
  return keys
}

const failure = (reason: string, status = 400): MemberAdminError =>
  new MemberAdminError(
    status === 404 ? 'not_found' : /already uses/.test(reason) ? 'conflict' : 'refused',
    `Nothing was changed: ${reason}`,
  )

async function checked(ports: MemberPorts, input: SaveMember): Promise<void> {
  const errors = await ports.members.validate(input)
  if (errors.length > 0)
    throw new MemberAdminError(
      'invalid',
      'Nothing was changed: the member is not valid.',
      errors.map((e) => `${e.alias}: ${e.messages.join('; ')}`),
    )
}

const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+$/.test(email)

export interface NewMember {
  email: string
  /** Their username; the e-mail address when left out. */
  login?: string
  name?: string
  type: string
  groups?: readonly string[]
  sets?: ReadonlyArray<readonly [string, string]>
  /** None: they sign in only through an identity provider. */
  password?: string
}

/** A new member, approved, as the Members section's Create makes one. */
export async function newMember(
  ports: MemberPorts,
  principal: Principal,
  input: NewMember,
): Promise<MemberDetail> {
  const email = input.email.trim()
  if (!looksLikeEmail(email))
    throw new MemberAdminError('usage', `"${input.email}" is not an e-mail address.`)
  const login = input.login?.trim() || email
  const type = await memberType(ports, input.type)
  const key = crypto.randomUUID()
  const save: SaveMember = {
    key,
    memberTypeKey: type.key,
    email,
    username: login,
    password: input.password || null,
    isApproved: true,
    isLockedOut: false,
    isTwoFactorEnabled: false,
    groupKeys: await groupKeysOf(ports, input.groups ?? []),
    values: await withSets(ports, principal, { key, typeKey: type.key }, [], input.sets ?? [], []),
    variants: [{ culture: null, segment: null, name: input.name?.trim() || login }],
  }
  await checked(ports, save)
  const created = await ports.members.create(save, principal)
  if (!created.ok) throw failure(created.reason, created.status)
  return detailOf(ports, await stored(ports, created.key, principal))
}

export interface MemberChange {
  email?: string
  login?: string
  name?: string
  sets?: ReadonlyArray<readonly [string, string]>
  unset?: readonly string[]
  addGroups?: readonly string[]
  removeGroups?: readonly string[]
  approved?: boolean
  locked?: boolean
  /** A new password, given. */
  password?: string
  /** A new password, made here and answered once. */
  generatePassword?: boolean
  /** False removes their second factor. */
  twoFactor?: false
}

export interface MemberChanged {
  member: MemberDetail
  changed: boolean
  /** The password made for them, when one was. */
  password: string | null
}

/**
 * A member changed, the rest of them as stored: each field not named is kept,
 * and a change to nothing saves nothing.
 */
export async function changeMember(
  ports: MemberPorts,
  principal: Principal,
  ref: string,
  change: MemberChange,
): Promise<MemberChanged> {
  const key = await findMember(ports, ref)
  const before = await stored(ports, key, principal)
  if (change.generatePassword && before.kind === 'ExternalOnly')
    throw new MemberAdminError(
      'refused',
      `${before.username} signs in only through an identity provider, so has no password to reset.`,
    )
  const email = change.email?.trim() ?? before.email
  if (!looksLikeEmail(email))
    throw new MemberAdminError('usage', `"${change.email}" is not an e-mail address.`)
  const login = change.login?.trim() || before.username
  const name = change.name?.trim() || before.variants[0]?.name || login
  const removing = new Set(await groupKeysOf(ports, change.removeGroups ?? []))
  const groupKeys = [
    ...new Set([
      ...before.groups.map(normaliseUuid).filter((k) => !removing.has(k)),
      ...(await groupKeysOf(ports, change.addGroups ?? [])),
    ]),
  ]
  const password = change.generatePassword ? generatePassword() : change.password || null
  const approved = change.approved ?? before.isApproved
  const locked = change.locked ?? before.isLockedOut
  const values = await withSets(
    ports,
    principal,
    { key, typeKey: before.memberType.id },
    before.values.map(({ alias, culture, segment, value }) => ({
      alias,
      culture: culture ?? null,
      segment: segment ?? null,
      value,
    })),
    change.sets ?? [],
    change.unset ?? [],
  )
  const sameGroups =
    groupKeys.length === before.groups.length &&
    before.groups.every((k) => groupKeys.includes(normaliseUuid(k)))
  const changed =
    email !== before.email ||
    login !== before.username ||
    name !== (before.variants[0]?.name ?? login) ||
    !sameGroups ||
    approved !== before.isApproved ||
    locked !== before.isLockedOut ||
    (change.locked === false && before.failedPasswordAttempts > 0) ||
    password !== null ||
    (change.twoFactor === false && before.isTwoFactorEnabled) ||
    (change.sets?.length ?? 0) > 0 ||
    (change.unset ?? []).some((alias) => before.values.some((v) => v.alias === alias))
  if (!changed) return { member: await detailOf(ports, before), changed: false, password: null }
  const save: SaveMember = {
    key,
    memberTypeKey: before.memberType.id,
    email,
    username: login,
    password,
    isApproved: approved,
    isLockedOut: locked,
    isTwoFactorEnabled: change.twoFactor !== false,
    groupKeys,
    values,
    variants: [{ culture: null, segment: null, name }],
  }
  await checked(ports, save)
  const updated = await ports.members.update(key, save, principal)
  if (!updated.ok) throw failure(updated.reason, updated.status)
  return {
    member: await detailOf(ports, await stored(ports, key, principal)),
    changed: true,
    password: change.generatePassword ? password : null,
  }
}

/** A member removed, with the groups they were in. */
export async function removeMember(
  ports: MemberPorts,
  viewer: Principal,
  ref: string,
): Promise<MemberDetail> {
  const key = await findMember(ports, ref)
  const member = await detailOf(ports, await stored(ports, key, viewer))
  const removed = await ports.members.remove(key, viewer)
  if (typeof removed === 'object') throw failure(removed.reason, removed.status)
  if (!removed) throw new MemberAdminError('not_found', 'The member could not be found.')
  return member
}

/** What a change did, as the audit log names it. */
export function memberChangeAction(change: MemberChange): string {
  if (change.generatePassword || change.password) return 'ResetPassword'
  if (change.twoFactor === false) return 'ResetTwoFactor'
  if (change.locked === true) return 'Lock'
  if (change.locked === false) return 'Unlock'
  if (change.approved === true) return 'Approve'
  if (change.addGroups?.length && !change.removeGroups?.length) return 'JoinGroup'
  if (change.removeGroups?.length && !change.addGroups?.length) return 'LeaveGroup'
  return 'Save'
}

export interface Place {
  key: string
  path: string
}

export interface MemberGroupInfo {
  key: string
  name: string
  members: number
  /** The pages whose access names the group. */
  pages: Place[]
}

async function placeOf(db: Db, key: string): Promise<Place> {
  return { key, path: `/${(await namedPath(db, key, 'content')) ?? key}` }
}

async function allGroups(ports: MemberPorts): Promise<Array<{ key: string; name: string }>> {
  const page = await ports.groups.list({ skip: 0, take: Number.MAX_SAFE_INTEGER })
  return page.items.map((g) => ({ key: normaliseUuid(g.id), name: g.name }))
}

/** A member group by its name, whatever the casing. */
export async function groupNamed(
  ports: MemberPorts,
  name: string,
): Promise<{ key: string; name: string }> {
  const wanted = name.trim().toLowerCase()
  const group = (await allGroups(ports)).find((g) => g.name.toLowerCase() === wanted)
  if (!group) throw new MemberAdminError('not_found', `There is no member group "${name.trim()}".`)
  return group
}

/** The pages whose access names a group, which a removed group drops out of. */
export async function pagesNaming(db: Db, group: string): Promise<Place[]> {
  const rules = await new PublicAccessRepository(db).allRules()
  const nodes = new NodeRepository(db)
  const pages: Place[] = []
  for (const rule of rules.filter((r) => r.memberGroupNames.includes(group))) {
    const node = await nodes.byId(rule.nodeId)
    if (node) pages.push(await placeOf(db, node.key))
  }
  return pages.sort((a, b) => a.path.localeCompare(b.path))
}

/** Every member group, with how many members it has and the pages that name it. */
export async function groupsOf(ports: MemberPorts): Promise<MemberGroupInfo[]> {
  const groups = await allGroups(ports)
  const byKey = await ports.memberLookup.counts(groups)
  const out: MemberGroupInfo[] = []
  for (const group of groups)
    out.push({
      ...group,
      members: byKey.get(group.key) ?? 0,
      pages: await pagesNaming(ports.db, group.name),
    })
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function newGroup(
  ports: MemberPorts,
  name: string,
  principal?: Principal,
): Promise<{ key: string; name: string }> {
  const wanted = name.trim()
  if (!wanted) throw new MemberAdminError('usage', 'A member group needs a name.')
  const taken = (await allGroups(ports)).some((g) => g.name.toLowerCase() === wanted.toLowerCase())
  const made = taken ? undefined : await ports.groups.create({ name: wanted }, principal)
  if (!made || made.status === 'duplicate-name' || !made.key)
    throw new MemberAdminError('conflict', `There is already a member group called "${wanted}".`)
  return { key: normaliseUuid(made.key), name: wanted }
}

/**
 * A group removed, its members left out of it. A page whose access names it
 * would lose it, so that needs `confirmed`.
 */
export async function removeGroup(
  ports: MemberPorts,
  name: string,
  confirmed: boolean,
  principal?: Principal,
): Promise<MemberGroupInfo> {
  const group = (await groupsOf(ports)).find(
    (g) => g.name.toLowerCase() === name.trim().toLowerCase(),
  )
  if (!group) throw new MemberAdminError('not_found', `There is no member group "${name.trim()}".`)
  if (group.pages.length > 0 && !confirmed)
    throw new MemberAdminError(
      'conflict',
      `Who may see ${group.pages.length === 1 ? 'a page' : `${group.pages.length} pages`} names ${group.name}, and would no longer.`,
      group.pages.map((p) => p.path),
    )
  const removed = await ports.groups.remove(group.key, principal)
  if (removed === 'not-found')
    throw new MemberAdminError('not_found', `There is no member group "${group.name}".`)
  return group
}

export interface PageAccess {
  page: Place
  /** Whose rule applies: this page's own, an ancestor's, or none, when it is open to everyone. */
  rule: 'own' | 'ancestor' | 'none'
  protectedBy: Place | null
  groups: string[]
  members: string[]
  loginPage: Place | null
  noAccessPage: Place | null
}

async function pageKeyOf(db: Db, key: string): Promise<string> {
  const node = await new NodeRepository(db).byKey(normaliseUuid(key))
  if (!node || node.objectType !== ObjectTypes.Document || node.trashed)
    throw new MemberAdminError('not_found', 'There is no such page.')
  return node.key
}

/** Who may see a page, by its own rule or the nearest ancestor's. */
export async function pageAccess(ports: MemberPorts, key: string): Promise<PageAccess> {
  const { db } = ports
  const page = await pageKeyOf(db, key)
  const entry = await new PublicAccessRepository(db).entryFor(page)
  const place = await placeOf(db, page)
  if (!entry)
    return {
      page: place,
      rule: 'none',
      protectedBy: null,
      groups: [],
      members: [],
      loginPage: null,
      noAccessPage: null,
    }
  // A rule names groups and members by name, so a removed or renamed one drops out, as in the back office.
  const groups = await ports.memberLookup.groupNames()
  return {
    page: place,
    rule: entry.nodeKey === page ? 'own' : 'ancestor',
    protectedBy: await placeOf(db, entry.nodeKey),
    groups: entry.memberGroupNames.filter((name) => groups.has(name)),
    members: await ports.memberLookup.logins(entry.memberUserNames),
    loginPage: await placeOf(db, entry.loginNodeKey),
    noAccessPage: await placeOf(db, entry.errorNodeKey),
  }
}

export interface AccessInput {
  groups?: readonly string[]
  members?: readonly string[]
  loginPage?: string
  noAccessPage?: string
}

const RULE_BREAKS: Record<PublicAccessRuleBreak, [MemberAdminKind, string]> = {
  'no-login-page': ['usage', 'A page for members needs a sign-in page.'],
  'no-error-page': ['usage', 'A page for members needs a no-access page.'],
  'no-one': ['usage', 'Name the member groups, or the members, the page is for.'],
  ambiguous: ['usage', 'A page is for member groups or for members, not both.'],
}

/**
 * A page made for some member groups or members. A page that has its own rule
 * keeps the sign-in or no-access page a change leaves out.
 */
export async function setPageAccess(
  ports: MemberPorts,
  operations: DocumentOperations,
  actor: Actor,
  key: string,
  input: AccessInput,
): Promise<PageAccess> {
  const page = await pageKeyOf(ports.db, key)
  const own = await new PublicAccessRepository(ports.db).byNodeKey(page)
  const groups: string[] = []
  for (const name of input.groups ?? []) groups.push((await groupNamed(ports, name)).name)
  const members: string[] = []
  for (const ref of input.members ?? []) {
    const login = await ports.memberLookup.loginOf(await findMember(ports, ref))
    if (login) members.push(login)
  }
  const login = input.loginPage ? await pageKeyOf(ports.db, input.loginPage) : own?.loginNodeKey
  const error = input.noAccessPage
    ? await pageKeyOf(ports.db, input.noAccessPage)
    : own?.errorNodeKey
  const broken = publicAccessRuleBreak({
    loginDocumentKey: login,
    errorDocumentKey: error,
    memberGroupNames: groups,
    memberUserNames: members,
  })
  if (broken) {
    const [kind, message] = RULE_BREAKS[broken]
    throw new MemberAdminError(kind, message)
  }
  const status = await operations.setPublicAccess(
    actor,
    page,
    {
      loginDocumentKey: login as string,
      errorDocumentKey: error as string,
      memberGroupNames: groups,
      memberUserNames: members,
    },
    own ? 'set' : 'added',
  )
  accessStatus(status, page)
  return pageAccess(ports, page)
}

function accessStatus(status: string, page: string): void {
  if (status === 'ok' || status === 'entry-not-found') return
  if (status === 'forbidden')
    throw new MemberAdminError('refused', 'You may not change who may see this page.')
  throw new MemberAdminError(
    'not_found',
    status === 'login-node-not-found'
      ? 'There is no such sign-in page.'
      : status === 'error-node-not-found'
        ? 'There is no such no-access page.'
        : `There is no page ${page}.`,
  )
}

/** A page's own rule removed, so it is open as its ancestors are. */
export async function clearPageAccess(
  ports: MemberPorts,
  operations: DocumentOperations,
  actor: Actor,
  key: string,
): Promise<{ access: PageAccess; changed: boolean }> {
  const page = await pageKeyOf(ports.db, key)
  const status = await operations.removePublicAccess(actor, page)
  accessStatus(status, page)
  return { access: await pageAccess(ports, page), changed: status === 'ok' }
}

/**
 * Story 282: a member's reset link, sent where the site that holds them sends mail, or
 * handed back where it can't (story 448: by that site, when it is another).
 */
export async function sendMemberResetLink(
  ports: MemberPorts,
  principal: Principal,
  ref: string,
  origin?: string,
): Promise<{ member: MemberDetail; outcome: MemberResetLink }> {
  const member = await showMember(ports, principal, ref)
  const outcome = await ports.memberLookup.resetLink(
    { key: member.key, name: member.name, email: member.email, username: member.login },
    principal,
    origin,
  )
  return { member, outcome }
}
