/**
 * Back-office users, their sign-ins and where a group starts (story 356), the
 * same for the command line on the site's own database and for the remote
 * protocol. Each change goes through the user ports the Users section uses, so
 * its rules — who may act on an administrator, which groups a person may hand
 * out, that the site keeps an administrator — are the back office's.
 */
import type {
  Principal,
  UserGroupInput,
  UserGroupPort,
  UserGroupStatus,
  UserPort,
  UserStatus,
} from '@crombolo/api-management/domain'
import { AuthStore } from '@crombolo/auth'
import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import {
  type Db,
  DbDate,
  describeRefFailure,
  NodeRepository,
  resolveNodeRef,
  type UserGroupRecord,
  UserGroupRepository,
  type UserRecord,
  UserRepository,
  userState,
} from '@crombolo/data'

export type UserAdminKind = 'not_found' | 'refused' | 'usage' | 'conflict'

/** Why a change to a user, a sign-in or a group was refused, in words for a person. */
export class UserAdminError extends Error {
  constructor(
    readonly kind: UserAdminKind,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}

export interface UserPorts {
  db: Db
  users: UserPort
  groups: UserGroupPort
}

export interface UserSummary {
  key: string
  name: string
  email: string
  userName: string
  state: string
  /** Their groups, by alias. */
  groups: string[]
  uiLanguage: string | null
  lastSignIn: string | null
}

const REFUSALS: Partial<Record<UserStatus | UserGroupStatus, [UserAdminKind, string]>> = {
  UserNotFound: ['not_found', 'There is no such user.'],
  NotFound: ['not_found', 'There is no such user group.'],
  MissingUserGroup: ['not_found', 'There is no group with that alias.'],
  DuplicateUserName: ['conflict', 'Another user has that username.'],
  DuplicateEmail: ['conflict', 'Another user has that e-mail address.'],
  InvalidEmail: ['usage', 'That is not an e-mail address.'],
  InvalidUserName: ['usage', 'A user needs a username.'],
  UserNameIsNotEmail: ['usage', "This site's usernames are e-mail addresses."],
  InvalidPassword: ['usage', "That password does not meet this site's password rules."],
  NoUserGroup: ['usage', 'A user needs at least one group.'],
  InvalidIsoCode: ['usage', 'That is not a language code, such as en-US.'],
  CannotDisableInvitedUser: [
    'refused',
    'An invited user cannot be disabled; delete the invitation instead.',
  ],
  CannotInvite: ['refused', 'The invitation could not be made.'],
  SelfOldPasswordRequired: [
    'refused',
    'Your own password is changed in your profile in the back office, which asks for the old one.',
  ],
  Forbidden: ['refused', "Only an administrator can change an administrator's account."],
  NotGroupOwner: ['refused', 'You can only add people to, or take them out of, groups you own.'],
  AdminGroupCannotBeEmpty: ['refused', 'That would leave the site with no administrator.'],
  CannotDeleteSelf: ['refused', "You can't remove yourself."],
  CannotDisableSelf: ['refused', "You can't disable yourself."],
  CannotDelete: ['refused', "The site's built-in administrator can't be removed."],
  AdministratorsOnly: ['refused', 'Only an administrator can change a group.'],
  DeclaredInFiles: [
    'refused',
    "That is kept in the group's file: change it in the site's files and deploy it.",
  ],
  CannotBeOwned: [
    'refused',
    "The administrators group, and a group that can move sites or install code, can't have owners.",
  ],
  OwnerNotFound: ['not_found', 'One of the owner groups could not be found.'],
  DocumentStartNodeKeyNotFound: ['not_found', 'There is no such page to start at.'],
  MediaStartNodeKeyNotFound: ['not_found', 'There is no such media folder to start at.'],
  ElementStartNodeKeyNotFound: ['not_found', 'There is no such Library folder to start at.'],
  LanguageNotFound: ['not_found', 'One of its languages could not be found.'],
}

/** A user or group port status other than `Success`, as a refusal. */
export function userRefusal(
  status: UserStatus | UserGroupStatus,
  who?: string,
): UserAdminError | undefined {
  if (status === 'Success') return undefined
  if (status === 'CannotDeleteUserWithLoginHistory')
    return new UserAdminError(
      'refused',
      `${who ?? 'They'} ${who ? 'has' : 'have'} signed in before, so they can be disabled but not removed.`,
      `\`crombolo users disable${who ? ` ${who}` : ''}\` stops them signing in.`,
    )
  const [kind, message] = REFUSALS[status] ?? ['refused', status]
  return new UserAdminError(kind, message)
}

const check = (status: UserStatus | UserGroupStatus, who?: string): void => {
  const refusal = userRefusal(status, who)
  if (refusal) throw refusal
}

const iso = (date: Date | undefined) => date?.toISOString() ?? null

async function groupAliases(db: Db): Promise<Map<string, string>> {
  return new Map((await new UserGroupRepository(db).all()).map((g) => [g.key, g.alias]))
}

function summaryOf(user: UserRecord, aliases: Map<string, string>): UserSummary {
  return {
    key: user.key,
    name: user.name,
    email: user.email,
    userName: user.userName,
    state: userState(user),
    groups: user.groupKeys.map((k) => aliases.get(k) ?? k),
    uiLanguage: user.languageIsoCode,
    lastSignIn: iso(user.lastLoginDate),
  }
}

async function userRecord(db: Db, who: string): Promise<UserRecord | undefined> {
  const wanted = who.trim().toLowerCase()
  // Postgres keeps the key as a uuid, which neither lower() nor a non-uuid comparison takes.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(wanted)
  const row = await db.q
    .selectFrom('user_account')
    .select('key')
    .where((eb) =>
      uuid
        ? eb('key', '=', normaliseUuid(wanted))
        : eb.or([
            eb(eb.fn('lower', ['email']), '=', wanted),
            eb(eb.fn('lower', ['login']), '=', wanted),
          ]),
    )
    .executeTakeFirst()
  return row ? new UserRepository(db).byKey(String(row.key)) : undefined
}

/** A user by key, e-mail or username, whatever the casing, as the caller may see them. */
export async function findUser(
  ports: UserPorts,
  principal: Principal,
  who: string,
): Promise<UserSummary> {
  const user = await userRecord(ports.db, who)
  if (!user)
    throw new UserAdminError('not_found', `No user "${who}".`, '`crombolo users list` lists them.')
  const seen = await ports.users.get(principal, user.key)
  check(seen.status)
  return summaryOf(user, await groupAliases(ports.db))
}

/** A change to a user: only what it names. */
export interface UserChange {
  name?: string
  email?: string
  addGroups?: string[]
  removeGroups?: string[]
  uiLanguage?: string
}

export type UserField = 'name' | 'email' | 'userName' | 'groups' | 'uiLanguage'

export interface UserChanged {
  user: UserSummary
  /** What changed; none when it was so already. */
  changed: UserField[]
}

async function groupKeyOf(db: Db, alias: string): Promise<string> {
  const wanted = alias.trim().toLowerCase()
  const group = (await new UserGroupRepository(db).all()).find(
    (g) => g.alias.toLowerCase() === wanted,
  )
  if (!group)
    throw new UserAdminError(
      'not_found',
      `There is no user group "${alias}".`,
      '`crombolo users groups list` lists them.',
    )
  return group.key
}

/**
 * Changes a user through the port's whole-user update, keeping what the change
 * does not name. A username that was their e-mail follows a new one where the
 * site's usernames are e-mail addresses.
 */
export async function changeUser(
  ports: UserPorts,
  principal: Principal,
  key: string,
  change: UserChange,
): Promise<UserChanged> {
  const users = new UserRepository(ports.db)
  const user = await users.byKey(key)
  if (!user) throw new UserAdminError('not_found', 'There is no such user.')
  const seen = await ports.users.get(principal, user.key)
  check(seen.status)
  const adding = await Promise.all((change.addGroups ?? []).map((a) => groupKeyOf(ports.db, a)))
  const removing = new Set(
    await Promise.all((change.removeGroups ?? []).map((a) => groupKeyOf(ports.db, a))),
  )
  const groupKeys = [
    ...user.groupKeys.filter((k) => !removing.has(k)),
    ...adding.filter((k) => !user.groupKeys.includes(k) && !removing.has(k)),
  ]
  const email = change.email ?? user.email
  const follows =
    ports.users.configuration().usernameIsEmail &&
    change.email !== undefined &&
    user.userName.toLowerCase() === user.email.toLowerCase()
  const next = {
    name: change.name ?? user.name,
    email,
    userName: follows ? email : user.userName,
    uiLanguage: change.uiLanguage ?? user.languageIsoCode,
  }
  const changed: UserField[] = [
    ...(next.name !== user.name ? (['name'] as const) : []),
    ...(next.email !== user.email ? (['email'] as const) : []),
    ...(next.userName !== user.userName ? (['userName'] as const) : []),
    ...(groupKeys.length !== user.groupKeys.length ||
    groupKeys.some((k) => !user.groupKeys.includes(k))
      ? (['groups'] as const)
      : []),
    ...((next.uiLanguage ?? null) !== (user.languageIsoCode ?? null)
      ? (['uiLanguage'] as const)
      : []),
  ]
  const aliases = await groupAliases(ports.db)
  if (changed.length === 0) return { user: summaryOf(user, aliases), changed }
  check(
    await ports.users.update(principal, user.key, {
      name: next.name,
      email: next.email,
      userName: next.userName,
      languageIsoCode: next.uiLanguage ?? '',
      groupKeys,
      documentStartNodeKeys: [],
      hasDocumentRootAccess: false,
      mediaStartNodeKeys: [],
      hasMediaRootAccess: false,
      elementStartNodeKeys: [],
      hasElementRootAccess: false,
    }),
  )
  const after = (await users.byKey(user.key)) ?? user
  return { user: summaryOf(after, aliases), changed }
}

/** Removes a user who has never signed in, as the Users section deletes one. */
export async function removeUser(
  ports: UserPorts,
  principal: Principal,
  key: string,
): Promise<UserSummary> {
  const user = await new UserRepository(ports.db).byKey(key)
  if (!user) throw new UserAdminError('not_found', 'There is no such user.')
  const summary = summaryOf(user, await groupAliases(ports.db))
  check(await ports.users.delete(principal, [user.key]), user.email || user.userName)
  return summary
}

/** An open sign-in: a browser, or a terminal by the name its device gave. */
export interface SignIn {
  id: string
  user: { key: string; name: string }
  kind: 'browser' | 'terminal'
  /** The name a terminal's device gave; null for a browser. */
  device: string | null
  signedIn: string
  lastUsed: string | null
  address: string | null
  /** The sign-in this request, or this command line, is using. */
  current: boolean
}

const OTHERS = 'Only an administrator can see or end someone else’s sign-ins.'

/** Every open sign-in: one whose session is not ended and still has a refresh token to renew. */
async function openSignIns(
  db: Db,
  userId: number | undefined,
  current: string | undefined,
): Promise<SignIn[]> {
  const now = DbDate.toDb(new Date())
  let query = db.q
    .selectFrom('user_login_session as s')
    .innerJoin('user_account as u', 'u.id', 's.user_id')
    .leftJoin('device_authorization as d', (join) =>
      join.onRef('d.session_id', '=', 's.session_id').on('d.status', '=', 'issued'),
    )
    .select([
      's.session_id',
      's.logged_in_utc',
      's.last_validated_utc',
      's.ip_address',
      'u.key',
      'u.user_name',
      'd.id as device_id',
      'd.client_name',
    ])
    .select((eb) =>
      eb
        .selectFrom('auth_token as t')
        .select((t) => t.fn.max('t.create_date').as('used'))
        .whereRef('t.session_id', '=', 's.session_id')
        .as('last_token'),
    )
    .where('s.logged_out_utc', 'is', null)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('auth_token as r')
          .select('r.id')
          .whereRef('r.session_id', '=', 's.session_id')
          .where('r.token_type', '=', 'refresh')
          .where('r.revoked_at', 'is', null)
          .where('r.expires_at', '>', now),
      ),
    )
  if (userId !== undefined) query = query.where('s.user_id', '=', userId)
  const rows = await query.orderBy('s.logged_in_utc', 'desc').execute()
  return rows.map((row) => {
    const signedIn = DbDate.fromDb(row.logged_in_utc) ?? new Date(0)
    const used = DbDate.fromDb(row.last_token) ?? DbDate.fromDb(row.last_validated_utc)
    const id = String(row.session_id)
    return {
      id,
      user: { key: normaliseUuid(String(row.key)), name: String(row.user_name) },
      kind: row.device_id === null ? 'browser' : 'terminal',
      device: row.client_name === null ? null : String(row.client_name),
      signedIn: signedIn.toISOString(),
      lastUsed: iso(used),
      address: row.ip_address === null ? null : String(row.ip_address),
      current: current !== undefined && normaliseUuid(id) === normaliseUuid(current),
    }
  })
}

const isSelf = (principal: Principal, key: string) =>
  normaliseUuid(principal.id) === normaliseUuid(key)

/**
 * A user's open sign-ins: the caller's own when `user` is left out, and anyone's
 * for an administrator. `current` is the session the caller is using.
 */
export async function signIns(
  db: Db,
  principal: Principal,
  options: { user?: string; current?: string } = {},
): Promise<SignIn[]> {
  const key = options.user ?? principal.id
  if (!isSelf(principal, key) && !principal.isAdmin) throw new UserAdminError('refused', OTHERS)
  const user = await new UserRepository(db).byKey(key)
  if (!user) throw new UserAdminError('not_found', 'There is no such user.')
  return openSignIns(db, user.id, options.current)
}

/** Ends one open sign-in, named by its id or the start of it: the caller's own, or anyone's for an administrator. */
export async function endSignIn(
  db: Db,
  principal: Principal,
  id: string,
  options: { current?: string } = {},
): Promise<SignIn> {
  const wanted = id.trim().toLowerCase()
  if (wanted.length < 8)
    throw new UserAdminError('usage', 'Name a sign-in by at least the eight characters listed.')
  const open = await openSignIns(db, undefined, options.current)
  const matches = open.filter((s) => s.id.toLowerCase().startsWith(wanted))
  const mine = matches.filter((s) => isSelf(principal, s.user.key))
  if (matches.length > 0 && mine.length === 0 && !principal.isAdmin)
    throw new UserAdminError('refused', OTHERS)
  const found = principal.isAdmin ? matches : mine
  if (found.length === 0)
    throw new UserAdminError(
      'not_found',
      `There is no open sign-in "${id}".`,
      '`crombolo users sessions` lists them.',
    )
  if (found.length > 1)
    throw new UserAdminError(
      'usage',
      `"${id}" is the start of more than one sign-in: give more of it.`,
    )
  const signIn = found[0] as SignIn
  await new AuthStore(db).endSession(signIn.id)
  return signIn
}

/** Where a group starts in one tree: all of it, none of it, or a place in it. */
export interface StartAt {
  at: 'root' | 'none' | 'node'
  key: string | null
  path: string | null
}

export interface GroupPlace {
  key: string
  alias: string
  name: string
  content: StartAt
  media: StartAt
  library: StartAt
  /** The groups that own it, by alias. */
  owners: string[]
}

/** What `placeGroup` changes: a place is a path, a key, `root` or `none`. */
export interface GroupPlaceChange {
  content?: string
  media?: string
  library?: string
  addOwners?: string[]
  removeOwners?: string[]
}

export type PlaceField = 'content' | 'media' | 'library' | 'owners'

export interface GroupPlaced {
  group: GroupPlace
  changed: PlaceField[]
}

const TREES = {
  content: { tree: 'document', types: [ObjectTypes.Document], what: 'page' },
  media: { tree: 'media', types: [ObjectTypes.Media], what: 'media folder' },
  library: {
    tree: 'element',
    types: [ObjectTypes.ElementContainer, ObjectTypes.Element],
    what: 'Library folder',
  },
} as const

type Tree = keyof typeof TREES

async function pathOf(db: Db, key: string): Promise<string | null> {
  const nodes = new NodeRepository(db)
  const node = await nodes.byKey(normaliseUuid(key))
  if (!node) return null
  const names: string[] = []
  for (const id of node.path
    .split(',')
    .map(Number)
    .filter((n) => n > 0)) {
    const row = await nodes.byId(id)
    if (!row) return null
    names.push(row.text ?? row.key)
  }
  return `/${names.join('/')}`
}

async function startAt(db: Db, start: { root: boolean; key: string | null }): Promise<StartAt> {
  if (start.root) return { at: 'root', key: null, path: null }
  if (!start.key) return { at: 'none', key: null, path: null }
  return { at: 'node', key: start.key, path: await pathOf(db, start.key) }
}

/** Where a group starts in each tree, and who owns it, as the database keeps them. */
export async function groupPlaceOf(db: Db, group: UserGroupRecord): Promise<GroupPlace> {
  const aliases = await groupAliases(db)
  return {
    key: group.key,
    alias: group.alias,
    name: group.name,
    content: await startAt(db, group.startNodes.document),
    media: await startAt(db, group.startNodes.media),
    library: await startAt(db, group.startNodes.element),
    owners: group.owners.map((k) => aliases.get(normaliseUuid(k)) ?? k),
  }
}

async function groupNamed(db: Db, alias: string): Promise<UserGroupRecord> {
  return (await new UserGroupRepository(db).byKey(await groupKeyOf(db, alias))) as UserGroupRecord
}

async function placeFor(
  db: Db,
  tree: Tree,
  ref: string,
): Promise<{ root: boolean; key: string | null }> {
  const plain = ref.trim()
  if (plain.toLowerCase() === 'root') return { root: true, key: null }
  if (plain.toLowerCase() === 'none') return { root: false, key: null }
  const { types, what } = TREES[tree]
  const resolved = await resolveNodeRef(db, types, plain)
  if (!resolved.ok) throw new UserAdminError('not_found', describeRefFailure(plain, resolved))
  if (!(types as readonly string[]).includes(resolved.node.objectType ?? ''))
    throw new UserAdminError('not_found', `"${ref}" is not a ${what}.`)
  return { root: false, key: resolved.node.key }
}

/**
 * Changes where a group starts and who owns it, through the port's whole-group
 * update, so its rules — an administrator's change, owners kept in a file that
 * names them — are the group screen's. A dry run says what would change.
 */
export async function placeGroup(
  ports: UserPorts,
  principal: Principal,
  alias: string,
  change: GroupPlaceChange,
  options: { dryRun?: boolean } = {},
): Promise<GroupPlaced> {
  const group = await groupNamed(ports.db, alias)
  if (!principal.isAdmin) check('AdministratorsOnly')
  const starts = { ...group.startNodes }
  const changed: PlaceField[] = []
  for (const tree of Object.keys(TREES) as Tree[]) {
    const ref = change[tree]
    if (ref === undefined) continue
    const next = await placeFor(ports.db, tree, ref)
    const was = group.startNodes[TREES[tree].tree]
    if (next.root !== was.root || (next.key ?? null) !== (was.key ?? null)) changed.push(tree)
    starts[TREES[tree].tree] = next
  }
  const adding = await Promise.all((change.addOwners ?? []).map((a) => groupKeyOf(ports.db, a)))
  const removing = new Set(
    await Promise.all((change.removeOwners ?? []).map((a) => groupKeyOf(ports.db, a))),
  )
  const had = group.owners.map(normaliseUuid)
  const owners = [
    ...had.filter((k) => !removing.has(k)),
    ...[...new Set(adding)].filter((k) => !had.includes(k) && !removing.has(k)),
  ]
  if (owners.length !== had.length || owners.some((k) => !had.includes(k))) changed.push('owners')
  const projected = { ...group, startNodes: starts, owners }
  if (changed.length === 0 || options.dryRun)
    return { group: await groupPlaceOf(ports.db, projected), changed }
  const current = await ports.groups.get(principal, group.key)
  if (typeof current === 'string') check(current)
  const shown = current as Exclude<typeof current, string>
  const input: UserGroupInput = {
    key: group.key,
    name: shown.name,
    alias: shown.alias,
    description: shown.description ?? null,
    icon: shown.icon ?? null,
    sections: shown.sections,
    languages: shown.languages,
    hasAccessToAllLanguages: shown.hasAccessToAllLanguages,
    documentStartNode: starts.document.key,
    documentRootAccess: starts.document.root,
    mediaStartNode: starts.media.key,
    mediaRootAccess: starts.media.root,
    elementStartNode: starts.element.key,
    elementRootAccess: starts.element.root,
    fallbackPermissions: shown.fallbackPermissions,
    permissions: shown.permissions,
    ...(changed.includes('owners') ? { owners } : {}),
  }
  check(await ports.groups.update(principal, group.key, input))
  return { group: await groupPlaceOf(ports.db, await groupNamed(ports.db, group.alias)), changed }
}
