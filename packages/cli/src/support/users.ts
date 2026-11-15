/**
 * Back-office users, their sign-ins and where a group starts, from the command
 * line (story 356): on this site's database through the core the remote
 * protocol uses, or, with --profile, on a hosted site through those routes.
 * Both act as the person signed in; with nobody signed in, as the command line.
 */
import { AuthStore } from '@crombolo/auth'
import {
  changeUser,
  endSignIn,
  findUser,
  type GroupPlaceChange,
  type GroupPlaced,
  placeGroup,
  removeUser,
  type SignIn,
  type StartAt,
  signIns,
  UserAdminError,
  type UserChange,
  type UserChanged,
  type UserSummary,
} from '@crombolo/server'
import { setting } from '@crombolo/server/settings'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../base.ts'
import { CliError } from '../errors.ts'
import { type HostedSite, hostedOrHere, type ProfileFlagValues } from '../profiles/choose.ts'
import { readSiteSignIn } from './local-sign-in.ts'
import { actingPrincipal, cliRefusal, openPeople } from './people.ts'
import { connectSite, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'
import { editSpec } from './type-edit.ts'
import { ago } from './undo.ts'

export type { GroupPlaceChange, GroupPlaced, SignIn, StartAt, UserSummary }

export interface UserSite {
  /** Whether it is a hosted site, which audits each change itself. */
  hosted: boolean
  find(who: string): Promise<UserSummary>
  change(key: string, change: UserChange): Promise<UserChanged>
  remove(key: string): Promise<UserSummary>
  /** A user's open sign-ins, by key; the caller's own when left out. */
  signIns(user?: string): Promise<SignIn[]>
  endSignIn(id: string): Promise<SignIn>
  placeGroup(alias: string, change: GroupPlaceChange, dryRun: boolean): Promise<GroupPlaced>
}

/** The session this command line's sign-in to the site is, when it has one and uses it. */
async function thisTerminal(
  people: Awaited<ReturnType<typeof openPeople>>,
): Promise<string | undefined> {
  if (setting('CROMBOLO_TOKEN')?.trim()) return undefined
  const stored = await readSiteSignIn(people.config)
  if (!stored) return undefined
  return (await new AuthStore(people.db).findToken(stored.accessToken, 'access'))?.sessionId
}

/** Runs `work` on the site chosen: this one, a folder profile's, or a hosted one. */
export async function withUsers<T>(
  flags: ProfileFlagValues,
  work: (site: UserSite) => Promise<T>,
): Promise<T> {
  const hosted = hostedOrHere(flags)
  try {
    if (hosted) return await work(await hostedUsers(hosted))
    const people = await openPeople(await siteConfig())
    try {
      const ports = { db: people.db, users: people.users, groups: people.groups }
      const current = await thisTerminal(people)
      return await work({
        hosted: false,
        find: (who) => findUser(ports, actingPrincipal(), who),
        change: (key, change) => changeUser(ports, actingPrincipal(), key, change),
        remove: (key) => removeUser(ports, actingPrincipal(), key),
        signIns: (user) => signIns(people.db, actingPrincipal(), { user, current }),
        endSignIn: (id) => endSignIn(people.db, actingPrincipal(), id, { current }),
        placeGroup: (alias, change, dryRun) =>
          placeGroup(ports, actingPrincipal(), alias, change, { dryRun }),
      })
    } finally {
      await people.db.close()
    }
  } catch (error) {
    throw error instanceof UserAdminError ? cliRefusal(error) : error
  }
}

async function hostedUsers(site: HostedSite): Promise<UserSite> {
  const { discovery, client, environment } = await connectSite(site)
  if (!discovery.capabilities?.includes('users'))
    throw new CliError('refused', 'This site needs a newer crombolo to change its users.', {
      hint: `${discovery.name} has to be upgraded first.`,
    })
  const env = `environments/${needEnvironment(environment, discovery)}`
  const send = <R>(path: string, method: string, body?: unknown): Promise<R> =>
    client.json<R>(`${env}/${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  return {
    hosted: true,
    find: (who) => send(`users?find=${encodeURIComponent(who)}`, 'GET'),
    change: (key, change) => send(`users/${key}`, 'PATCH', change),
    remove: (key) => send(`users/${key}`, 'DELETE'),
    signIns: async (user) =>
      (
        await send<{ items: SignIn[] }>(
          `sign-ins${user ? `?user=${encodeURIComponent(user)}` : ''}`,
          'GET',
        )
      ).items,
    endSignIn: (id) => send(`sign-ins/${encodeURIComponent(id)}`, 'DELETE'),
    placeGroup: (alias, change, dryRun) =>
      send(
        `user-groups/${encodeURIComponent(alias)}${dryRun ? '?dryRun=true' : ''}`,
        'PATCH',
        change,
      ),
  }
}

/** A command that changes one user, audited by their key. */
export abstract class UserCommand extends BaseCommand {
  /** The audit entry this command writes: by key, here; none when a hosted site wrote its own. */
  protected noted(site: UserSite, key: string, changed = true): void {
    this.auditKey = key
    if (site.hosted) this.auditedElsewhere = true
    this.changedNothing = !changed
  }
}

/** What a sign-in is: "a browser", "a terminal (Ada's laptop)". */
export const signInKind = (signIn: SignIn): string =>
  signIn.kind === 'terminal'
    ? `a terminal${signIn.device ? ` (${signIn.device})` : ''}`
    : 'a browser'

/** "abcd1234  a browser  signed in 3 days ago  last used 1 hour ago  from 10.0.0.1". */
export function describeSignIn(signIn: SignIn, now = Date.now()): string {
  return [
    `  ${signIn.id.slice(0, 8)}  ${signInKind(signIn)}`,
    `signed in ${ago(signIn.signedIn, now)}`,
    `last used ${ago(signIn.lastUsed, now)}`,
    ...(signIn.address ? [`from ${signIn.address}`] : []),
    ...(signIn.current ? ['(this terminal)'] : []),
  ].join('  ')
}

/** "Ana Lee <ana@example.com>". */
export const describeUser = (user: Pick<UserSummary, 'name' | 'email' | 'userName'>): string =>
  `${user.name} <${user.email || user.userName}>`

export const userSummaryFields = [
  { name: 'key', type: 'string' },
  { name: 'name', type: 'string' },
  { name: 'email', type: 'string' },
  { name: 'userName', type: 'string' },
  { name: 'state', type: 'string' },
  { name: 'groups', type: 'array', items: { type: 'string' }, description: 'by alias' },
  { name: 'uiLanguage', type: 'string', nullable: true },
  { name: 'lastSignIn', type: 'string', nullable: true },
] as const

export const signInFields = [
  { name: 'id', type: 'string' },
  {
    name: 'user',
    type: 'object',
    fields: [
      { name: 'key', type: 'string' },
      { name: 'name', type: 'string' },
    ],
  },
  { name: 'kind', type: 'string', enum: ['browser', 'terminal'] },
  { name: 'device', type: 'string', nullable: true, description: "a terminal's name" },
  { name: 'signedIn', type: 'string' },
  { name: 'lastUsed', type: 'string', nullable: true },
  { name: 'address', type: 'string', nullable: true },
  { name: 'current', type: 'boolean', description: 'the sign-in this command line is using' },
] as const

const startAtField = (name: string) =>
  ({
    name,
    type: 'object',
    fields: [
      { name: 'at', type: 'string', enum: ['root', 'none', 'node'] },
      { name: 'key', type: 'string', nullable: true },
      { name: 'path', type: 'string', nullable: true },
    ],
  }) as const

export const groupPlaceFields = [
  { name: 'key', type: 'string' },
  { name: 'alias', type: 'string' },
  { name: 'name', type: 'string' },
  startAtField('content'),
  startAtField('media'),
  startAtField('library'),
  { name: 'owners', type: 'array', items: { type: 'string' }, description: 'by alias' },
] as const

const TREE_WORDS = { content: 'content', media: 'media', library: 'the Library' } as const

/** Where a group starts in a tree, in words: "/Home", "all of it", "none of it". */
export function describeStart(start: StartAt): string {
  if (start.at === 'root') return 'all of it'
  if (start.at === 'none') return 'none of it'
  return start.path ?? start.key ?? '?'
}

/** The lines a start node or owner change says, from the flags that ask for it. */
export function placeLines(change: GroupPlaceChange): string[] {
  const place = (ref: string) =>
    ref.toLowerCase() === 'root' ? 'all of it' : ref.toLowerCase() === 'none' ? 'none of it' : ref
  return [
    ...(['content', 'media', 'library'] as const).flatMap((tree) =>
      change[tree] === undefined
        ? []
        : [`  starts in ${TREE_WORDS[tree]} at ${place(change[tree] as string)}`],
    ),
    ...(change.addOwners ?? []).map((g) => `  owned by ${g}`),
    ...(change.removeOwners ?? []).map((g) => `  no longer owned by ${g}`),
  ]
}

/** The place flags `users groups new|update` take. */
export function placeChangeOf(flags: {
  'start-at'?: string
  'media-start-at'?: string
  'library-start-at'?: string
  owner?: string[]
  'remove-owner'?: string[]
}): GroupPlaceChange {
  return {
    ...(flags['start-at'] !== undefined ? { content: flags['start-at'] } : {}),
    ...(flags['media-start-at'] !== undefined ? { media: flags['media-start-at'] } : {}),
    ...(flags['library-start-at'] !== undefined ? { library: flags['library-start-at'] } : {}),
    ...(flags.owner?.length ? { addOwners: flags.owner } : {}),
    ...(flags['remove-owner']?.length ? { removeOwners: flags['remove-owner'] } : {}),
  }
}

/** The start node and owner flags `users groups new|update` take. */
export const placeFlags = {
  'start-at': Flags.string({
    summary: 'where in content it starts: a page, root for all of it, or none',
    helpValue: '<page|root|none>',
  }),
  'media-start-at': Flags.string({
    summary: 'where in media it starts: a folder, root for all of it, or none',
    helpValue: '<folder|root|none>',
  }),
  'library-start-at': Flags.string({
    summary: 'where in the Library it starts: a folder, root for all of it, or none',
    helpValue: '<folder|root|none>',
  }),
  owner: Flags.string({
    summary: 'a group whose people choose who is in this one',
    helpValue: '<alias>',
    multiple: true,
  }),
  'remove-owner': Flags.string({
    summary: 'a group that no longer owns this one',
    helpValue: '<alias>',
    multiple: true,
  }),
}

/** What `users groups new|update` answer: the file's change, and where the group starts now. */
export const groupEditSpec = {
  ...editSpec,
  outputFields: [
    ...editSpec.outputFields,
    {
      name: 'placed',
      type: 'object',
      nullable: true,
      description: 'where it starts and who owns it, when those were changed',
      fields: groupPlaceFields,
    },
  ],
  errors: ['not_found', 'usage', 'refused', 'conflict', 'unavailable'],
} as const

/** Refuses start node and owner flags with --no-apply: they are kept with a group that is not there yet. */
export function refuseUnapplied(change: GroupPlaceChange, flags: { 'no-apply'?: boolean }): void {
  if (placesAnything(change) && flags['no-apply'])
    throw new CliError(
      'usage',
      "Where a group starts and who owns it are kept with the site's database, so they need the change applied.",
      { hint: 'Leave out --no-apply, or set them once `crombolo types sync` has applied it.' },
    )
}

export const placesAnything = (change: GroupPlaceChange): boolean => Object.keys(change).length > 0
