/**
 * Members, member groups and who may see a page from the command line (story
 * 354): on this site's database through the core the remote protocol uses, or,
 * with --profile, on a hosted site through those routes. Both act as the person
 * signed in; with nobody signed in, as the command line, which sees every value.
 */
import type { Principal } from '@crombolo/api-management/domain'
import { ObjectTypes } from '@crombolo/core'
import { type Db, describeRefFailure, looksLikeKey, resolveNodeRef } from '@crombolo/data'
import {
  type AccessInput,
  bootstrapDatabase,
  changeMember,
  clearPageAccess,
  createMemberResetLinks,
  groupsOf,
  listMembers,
  MemberAdminError,
  type MemberChange,
  type MemberChanged,
  type MemberDetail,
  type MemberGroupInfo,
  type MemberQuery,
  type MemberSummary,
  type NewMember,
  newGroup,
  newMember,
  type PageAccess,
  pageAccess,
  removeGroup,
  removeMember,
  setPageAccess,
  showMember,
  siteDocumentOperations,
  siteEmail,
  siteMemberPorts,
} from '@crombolo/server'
import { BaseCommand } from '../base.ts'
import { CliError } from '../errors.ts'
import { type HostedSite, hostedOrHere, type ProfileFlagValues } from '../profiles/choose.ts'
import { commandActor, signedInPerson } from './acting.ts'
import { OPERATOR } from './people.ts'
import { connectSite, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'

export type { MemberDetail, MemberGroupInfo, MemberSummary, PageAccess }

const group = (alias: string) => ({ key: alias, alias, defaults: [], granular: new Map() })

/** The command line with nobody signed in: it sees and changes every value, sensitive ones too. */
const COMMAND_LINE = {
  ...OPERATOR,
  groups: [group('admin'), group('sensitiveData')],
} as unknown as Principal

export interface MemberSite {
  /** Whether it is a hosted site, which audits each change itself. */
  hosted: boolean
  list(query: MemberQuery): Promise<{ items: MemberSummary[]; total: number }>
  show(ref: string): Promise<MemberDetail>
  create(input: NewMember): Promise<MemberDetail>
  change(ref: string, change: MemberChange): Promise<MemberChanged>
  remove(ref: string): Promise<MemberDetail>
  /** Story 282: a reset link sent where the site sends mail; the link itself when it cannot. */
  resetLink(ref: string): Promise<{ key: string; sent: boolean; link?: string }>
  groups(): Promise<MemberGroupInfo[]>
  newGroup(name: string): Promise<{ key: string; name: string }>
  removeGroup(name: string, confirmed: boolean): Promise<MemberGroupInfo>
  /** The key of the page a path or key names; a key on a hosted site. */
  page(ref: string): Promise<string>
  access(page: string): Promise<PageAccess>
  setAccess(page: string, input: AccessInput): Promise<PageAccess>
  clearAccess(page: string): Promise<{ access: PageAccess; changed: boolean }>
}

/** What each part needs of a hosted site, in the words its refusal uses. */
const CAPABILITIES = {
  members: 'look after its members',
  'public-access': 'set who may see a page',
} as const

const cliError = (error: unknown): unknown =>
  error instanceof MemberAdminError
    ? new CliError(
        error.kind === 'invalid' ? 'refused' : error.kind,
        error.message,
        error.details.length > 0 ? { details: error.details } : undefined,
      )
    : error

async function pageKey(db: Db, ref: string): Promise<string> {
  const resolved = await resolveNodeRef(db, [ObjectTypes.Document], ref)
  if (!resolved.ok) throw new CliError('not_found', describeRefFailure(ref, resolved))
  if (resolved.node.objectType !== ObjectTypes.Document)
    throw new CliError('not_found', `"${ref}" is not a page.`)
  return resolved.node.key
}

/** Runs `work` on the site chosen: this one, a folder profile's, or a hosted one. */
export async function withMembers<T>(
  flags: ProfileFlagValues,
  needs: keyof typeof CAPABILITIES,
  work: (site: MemberSite) => Promise<T>,
): Promise<T> {
  const hosted = hostedOrHere(flags)
  try {
    if (hosted) return await work(await hostedMembers(hosted, needs))
    const config = await siteConfig()
    const { db } = await bootstrapDatabase(config)
    try {
      const ports = await siteMemberPorts(db, config)
      const me = () => signedInPerson() ?? COMMAND_LINE
      const operations = async () => (await siteDocumentOperations(db, config)).operations
      return await work({
        hosted: false,
        list: (query) => listMembers(ports, me(), query),
        show: (ref) => showMember(ports, me(), ref),
        create: (input) => newMember(ports, me(), input),
        change: (ref, change) => changeMember(ports, me(), ref, change),
        remove: (ref) => removeMember(ports, me(), ref),
        async resetLink(ref) {
          const member = await showMember(ports, me(), ref)
          const port = await siteEmail(db, config)
          const outcome = await createMemberResetLinks(db, config, () => port).sendResetLink({
            key: member.key,
            name: member.name,
            email: member.email,
            username: member.login,
          })
          if ('refused' in outcome) throw resetRefusal(outcome.refused)
          return {
            key: member.key,
            sent: outcome.sent,
            ...(outcome.sent ? {} : { link: outcome.link }),
          }
        },
        groups: () => groupsOf(ports),
        newGroup: (name) => newGroup(ports, name),
        removeGroup: (name, confirmed) => removeGroup(ports, name, confirmed),
        page: (ref) => pageKey(db, ref),
        access: (page) => pageAccess(db, page),
        setAccess: async (page, input) =>
          setPageAccess(ports, await operations(), commandActor(), page, input),
        clearAccess: async (page) => clearPageAccess(db, await operations(), commandActor(), page),
      })
    } finally {
      await db.close()
    }
  } catch (error) {
    throw cliError(error)
  }
}

async function hostedMembers(
  site: HostedSite,
  needs: keyof typeof CAPABILITIES,
): Promise<MemberSite> {
  const { discovery, client, environment } = await connectSite(site)
  if (!discovery.capabilities?.includes(needs))
    throw new CliError(
      'refused',
      `This site needs a newer crombolo to ${CAPABILITIES[needs]} from the command line.`,
      { hint: `${discovery.name} has to be upgraded first.` },
    )
  const env = `environments/${needEnvironment(environment, discovery)}`
  const send = <R>(path: string, method: string, body?: unknown): Promise<R> =>
    client.json<R>(`${env}/${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  const member = (ref: string) => send<MemberDetail>(`members/${encodeURIComponent(ref)}`, 'GET')
  return {
    hosted: true,
    list(query) {
      const asked = new URLSearchParams()
      if (query.group) asked.set('group', query.group)
      if (query.type) asked.set('type', query.type)
      if (query.find) asked.set('find', query.find)
      if (query.skip !== undefined) asked.set('skip', String(query.skip))
      if (query.take !== undefined) asked.set('take', String(query.take))
      return send(`members${asked.size > 0 ? `?${asked}` : ''}`, 'GET')
    },
    show: member,
    create: (input) => send('members', 'POST', input),
    async change(ref, change) {
      return send(`members/${(await member(ref)).key}`, 'PATCH', change)
    },
    async remove(ref) {
      return send(`members/${(await member(ref)).key}`, 'DELETE')
    },
    async resetLink(ref) {
      const key = (await member(ref)).key
      return {
        key,
        ...(await send<{ sent: boolean; link?: string }>(`members/${key}/reset-link`, 'POST', {})),
      }
    },
    groups: async () => (await send<{ groups: MemberGroupInfo[] }>('member-groups', 'GET')).groups,
    newGroup: (name) => send('member-groups', 'POST', { name }),
    removeGroup: (name, confirmed) =>
      send(
        `member-groups/${encodeURIComponent(name)}${confirmed ? '?confirmed=true' : ''}`,
        'DELETE',
      ),
    async page(ref) {
      if (!looksLikeKey(ref.trim()))
        throw new CliError('usage', 'On a hosted site, name a page by its uuid.', {
          hint: '`crombolo content find --profile <name>` gives each page’s.',
        })
      return ref.trim().toLowerCase()
    },
    access: (page) => send(`content/${page}/access`, 'GET'),
    setAccess: (page, input) => send(`content/${page}/access`, 'PUT', input),
    clearAccess: (page) => send(`content/${page}/access`, 'DELETE'),
  }
}

/** Why no link was made (story 282), as the command says it. */
const resetRefusal = (why: 'provider' | 'unavailable') =>
  why === 'provider'
    ? new CliError(
        'refused',
        'They sign in only through an identity provider, so have no password to reset.',
        { hint: 'To give them one all the same, pass --password.' },
      )
    : new CliError('unavailable', 'This site has no page for setting a password.', {
        hint: 'Name one in members.resetPasswordPage in crombolo.config.ts, or pass --password.',
      })

/** "Ana Lee <ana@example.com>". */
export const describeMember = (member: Pick<MemberSummary, 'name' | 'email'>): string =>
  `${member.name} <${member.email}>`

/** A member's state in words, where it is not the usual: "not approved", "locked". */
export function memberState(member: MemberSummary): string[] {
  return [
    ...(member.approved ? [] : ['not approved']),
    ...(member.locked ? ['locked'] : []),
    ...(member.signsIn === 'provider' ? ['signs in through a provider'] : []),
  ]
}

export const memberSummaryFields = [
  { name: 'key', type: 'string' },
  { name: 'login', type: 'string' },
  { name: 'email', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'type', type: 'string', description: "the member type's alias" },
  { name: 'groups', type: 'array', items: { type: 'string' } },
  { name: 'approved', type: 'boolean' },
  { name: 'locked', type: 'boolean' },
  {
    name: 'signsIn',
    type: 'string',
    enum: ['password', 'provider', 'api'],
    description: 'provider: only through an identity provider; api: a Delivery API client',
  },
  { name: 'lastSignIn', type: 'string', nullable: true },
] as const

export const memberDetailFields = [
  ...memberSummaryFields,
  { name: 'twoFactor', type: 'boolean' },
  { name: 'failedSignIns', type: 'integer' },
  { name: 'lastLockout', type: 'string', nullable: true },
  { name: 'lastPasswordChange', type: 'string', nullable: true },
  { name: 'created', type: 'string', nullable: true },
  { name: 'updated', type: 'string', nullable: true },
] as const

const placeFields = [
  { name: 'key', type: 'string' },
  { name: 'path', type: 'string' },
] as const

export const accessFields = [
  { name: 'page', type: 'object', fields: placeFields },
  {
    name: 'rule',
    type: 'string',
    enum: ['own', 'ancestor', 'none'],
    description: "none: open to everyone; ancestor: an ancestor's rule applies",
  },
  { name: 'protectedBy', type: 'object', nullable: true, fields: placeFields },
  { name: 'groups', type: 'array', items: { type: 'string' } },
  { name: 'members', type: 'array', items: { type: 'string' }, description: 'their logins' },
  { name: 'loginPage', type: 'object', nullable: true, fields: placeFields },
  { name: 'noAccessPage', type: 'object', nullable: true, fields: placeFields },
] as const

/** What a change command answers with: the member, and whether anything changed. */
export const changedFields = [...memberSummaryFields, { name: 'changed', type: 'boolean' }] as const

/** The summary of a member, as `members list` gives one. */
export const summaryOf = (member: MemberSummary): MemberSummary => ({
  key: member.key,
  login: member.login,
  email: member.email,
  name: member.name,
  type: member.type,
  groups: member.groups,
  approved: member.approved,
  locked: member.locked,
  signsIn: member.signsIn,
  lastSignIn: member.lastSignIn,
})

/** A command that changes one member, audited by their key and nothing else. */
export abstract class MemberCommand extends BaseCommand {
  /** Changes a member and says what came of it: `done` when it changed, `same` when it was so already. */
  protected changeOne(
    flags: ProfileFlagValues,
    ref: string,
    change: MemberChange,
    words: { done: (who: string) => string; same: (who: string) => string },
  ): Promise<MemberSummary & { changed: boolean }> {
    return withMembers(flags, 'members', async (site) => {
      const done = await site.change(ref, change)
      this.noted(site, done.member.key, done.changed)
      const who = describeMember(done.member)
      this.say(`  ${done.changed ? words.done(who) : words.same(who)}`)
      return { ...summaryOf(done.member), changed: done.changed }
    })
  }

  /** The audit entry this command writes: by key, here; none when a hosted site wrote its own. */
  protected noted(site: MemberSite, key: string, changed = true): void {
    this.auditKey = key
    if (site.hosted) this.auditedElsewhere = true
    if (!changed) this.changedNothing = true
  }
}

/** "Subscribers and Staff", or the members' logins. */
export function whoFor(access: PageAccess): string {
  const names = access.groups.length > 0 ? access.groups : access.members
  return names.length <= 1
    ? (names[0] ?? 'no one')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Who may see a page, in the lines `content access show` says. */
export function describeAccess(access: PageAccess): string[] {
  if (access.rule === 'none') return [`${access.page.path} is open to everyone`]
  return [
    access.rule === 'ancestor'
      ? `${access.page.path} is protected by ${access.protectedBy?.path}'s rule, for ${whoFor(access)}`
      : `${access.page.path} is for ${whoFor(access)}`,
    `  sign-in page    ${access.loginPage?.path ?? '?'}`,
    `  no-access page  ${access.noAccessPage?.path ?? '?'}`,
  ]
}
