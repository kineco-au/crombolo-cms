/**
 * Backoffice users and user groups: accounts, membership, sections, languages,
 * start nodes and permission verbs. Password hashing and the rules about who
 * may change what live with the callers; this is storage.
 */
import { type GroupGrant, normaliseUuid, type StartNodePath } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { mapNode, type NodeRow } from './nodes.ts'

export type UserKind = 'Default' | 'Api'
export type StartNodeTree = 'document' | 'media' | 'element'

/** Umbraco's `UserStartNodeDto.StartNodeTypeValue`. */
const START_NODE_TYPE: Record<StartNodeTree, number> = { document: 1, media: 2, element: 3 }
const ROOT_ID = -1

/** A user's own start nodes in one tree: root access, and/or specific nodes by key. */
export interface StartNodeSelection {
  root: boolean
  keys: string[]
}

/** A group's start node in one tree: the root, one node, or none. */
export interface GroupStartNode {
  root: boolean
  key: string | null
}

export interface UserRecord {
  id: number
  key: string
  name: string
  userName: string
  email: string
  languageIsoCode: string | null
  avatar: string | null
  kind: UserKind
  isApproved: boolean
  isLockedOut: boolean
  failedLoginAttempts: number
  lastLoginDate: Date | undefined
  lastLockoutDate: Date | undefined
  lastPasswordChangeDate: Date | undefined
  invitedDate: Date | undefined
  createDate: Date
  updateDate: Date
  groupKeys: string[]
  startNodes: Record<StartNodeTree, StartNodeSelection>
}

export type UserState = 'Active' | 'Disabled' | 'LockedOut' | 'Invited' | 'Inactive'

/** Umbraco's `User.UserState`. */
export function userState(user: UserRecord): UserState {
  if (!user.lastLoginDate && !user.isApproved && user.invitedDate) return 'Invited'
  if (user.isLockedOut) return 'LockedOut'
  if (!user.isApproved) return 'Disabled'
  if (!user.lastLoginDate) return 'Inactive'
  return 'Active'
}

export interface GranularPermission {
  /** The node (or property type) the verb applies to; null for a context-only verb. */
  key: string | null
  permission: string
  context: string
}

export interface UserGroupRecord {
  id: number
  key: string
  alias: string
  name: string
  description: string | null
  icon: string | null
  /** Stored application aliases (`content`), or a package section's alias as given. */
  sections: string[]
  languages: string[]
  hasAccessToAllLanguages: boolean
  startNodes: Record<StartNodeTree, GroupStartNode>
  permissions: string[]
  granular: GranularPermission[]
}

export interface UserGroupInput {
  key: string
  alias: string
  name: string
  description: string | null
  icon: string | null
  sections: string[]
  languages: string[]
  hasAccessToAllLanguages: boolean
  startNodes: Record<StartNodeTree, GroupStartNode>
  permissions: string[]
  granular: GranularPermission[]
}

export interface UserInput {
  key: string
  name: string
  userName: string
  email: string
  kind: UserKind
  groupKeys: string[]
  languageIsoCode: string | null
  /** Invited users are created unapproved, with an invitation date. */
  invited?: boolean
}

export interface UserUpdate {
  name: string
  userName: string
  email: string
  languageIsoCode: string | null
  groupKeys: string[]
  startNodes: Record<StartNodeTree, StartNodeSelection>
}

/** What access checks need about a user: their groups' grants and every start node's position. */
export interface UserAccessData {
  groups: GroupGrant[]
  languages: string[]
  hasAccessToAllLanguages: boolean
  groupStartNodes: Record<StartNodeTree, StartNodePath[]>
  userStartNodes: Record<StartNodeTree, StartNodePath[]>
}

const USER_COLUMNS = [
  'id',
  'key',
  'user_name',
  'login',
  'email',
  'language',
  'avatar',
  'kind',
  'is_approved',
  'is_locked_out',
  'failed_login_attempts',
  'last_login_date',
  'last_lockout_date',
  'last_password_change_date',
  'invited_date',
  'create_date',
  'update_date',
] as const

const NODE_COLUMNS = [
  'id',
  'unique_id',
  'parent_id',
  'level',
  'path',
  'sort_order',
  'trashed',
  'text',
  'node_object_type',
  'create_date',
] as const

const TREES: StartNodeTree[] = ['document', 'media', 'element']

const users = (db: Db) => db.q.selectFrom('user_account').select(USER_COLUMNS)

export class UserRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async #nodeKeys(ids: readonly number[]): Promise<Map<number, NodeRow>> {
    const wanted = [...new Set(ids.filter((id) => id > 0))]
    if (wanted.length === 0) return new Map()
    const rows = await this.#db.q
      .selectFrom('node')
      .select(NODE_COLUMNS)
      .where('id', 'in', wanted)
      .execute()
    return new Map(rows.map((row) => [Number(row.id), mapNode(row)]))
  }

  /** Node ids for keys; undefined when any key is not a node. */
  async nodeIds(keys: readonly string[]): Promise<Map<string, number> | undefined> {
    if (keys.length === 0) return new Map()
    const wanted = keys.map(normaliseUuid)
    const rows = await this.#db.q
      .selectFrom('node')
      .select(['id', 'unique_id'])
      .where('unique_id', 'in', wanted)
      .execute()
    const map = new Map(rows.map((r) => [normaliseUuid(String(r.unique_id)), Number(r.id)]))
    return wanted.every((k) => map.has(k)) ? map : undefined
  }

  async #hydrate(rows: Record<string, unknown>[]): Promise<UserRecord[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => Number(r.id))
    const memberships = await this.#db.q
      .selectFrom('user_group_member as m')
      .innerJoin('user_group as g', 'g.id', 'm.user_group_id')
      .select(['m.user_id', 'g.key'])
      .where('m.user_id', 'in', ids)
      .orderBy('g.id')
      .execute()
    const starts = await this.#db.q
      .selectFrom('user_start_node')
      .select(['user_id', 'start_node', 'start_node_type'])
      .where('user_id', 'in', ids)
      .execute()
    const nodes = await this.#nodeKeys(starts.map((s) => Number(s.start_node)))
    return rows.map((row) => {
      const id = Number(row.id)
      const startNodes = Object.fromEntries(
        TREES.map((tree) => {
          const mine = starts.filter(
            (s) => Number(s.user_id) === id && Number(s.start_node_type) === START_NODE_TYPE[tree],
          )
          return [
            tree,
            {
              root: mine.some((s) => Number(s.start_node) === ROOT_ID),
              keys: mine.flatMap((s) => {
                const node = nodes.get(Number(s.start_node))
                return node ? [node.key] : []
              }),
            },
          ]
        }),
      ) as Record<StartNodeTree, StartNodeSelection>
      return {
        id,
        key: normaliseUuid(String(row.key)),
        name: String(row.user_name),
        userName: String(row.login),
        email: String(row.email),
        languageIsoCode: (row.language as string | null) ?? null,
        avatar: (row.avatar as string | null) ?? null,
        kind: Number(row.kind) === 1 ? 'Api' : 'Default',
        isApproved: fromDbBool(row.is_approved),
        isLockedOut: fromDbBool(row.is_locked_out),
        failedLoginAttempts: Number(row.failed_login_attempts ?? 0),
        lastLoginDate: DbDate.fromDb(row.last_login_date),
        lastLockoutDate: DbDate.fromDb(row.last_lockout_date),
        lastPasswordChangeDate: DbDate.fromDb(row.last_password_change_date),
        invitedDate: DbDate.fromDb(row.invited_date),
        createDate: DbDate.fromDb(row.create_date) ?? new Date(0),
        updateDate: DbDate.fromDb(row.update_date) ?? new Date(0),
        groupKeys: memberships
          .filter((m) => Number(m.user_id) === id)
          .map((m) => normaliseUuid(String(m.key))),
        startNodes,
      }
    })
  }

  async all(): Promise<UserRecord[]> {
    return this.#hydrate(await users(this.#db).orderBy('id').execute())
  }

  async byKeys(keys: readonly string[]): Promise<UserRecord[]> {
    const wanted = keys.filter((k) => /^[0-9a-f-]{32,36}$/i.test(k)).map(normaliseUuid)
    if (wanted.length === 0) return []
    return this.#hydrate(await users(this.#db).where('key', 'in', wanted).orderBy('id').execute())
  }

  async byKey(key: string): Promise<UserRecord | undefined> {
    return (await this.byKeys([key]))[0]
  }

  async byId(id: number): Promise<UserRecord | undefined> {
    return (await this.#hydrate(await users(this.#db).where('id', '=', id).execute()))[0]
  }

  async byUserName(userName: string): Promise<UserRecord | undefined> {
    return (await this.#hydrate(await users(this.#db).where('login', '=', userName).execute()))[0]
  }

  async byEmail(email: string): Promise<UserRecord | undefined> {
    return (await this.#hydrate(await users(this.#db).where('email', '=', email).execute()))[0]
  }

  async #groupIds(keys: readonly string[]): Promise<number[] | undefined> {
    if (keys.length === 0) return []
    const wanted = keys.map(normaliseUuid)
    const rows = await this.#db.q
      .selectFrom('user_group')
      .select('id')
      .where('key', 'in', wanted)
      .execute()
    return rows.length === new Set(wanted).size ? rows.map((r) => Number(r.id)) : undefined
  }

  async #setGroups(userId: number, groupIds: readonly number[]): Promise<void> {
    await this.#db.q.deleteFrom('user_group_member').where('user_id', '=', userId).execute()
    for (const groupId of new Set(groupIds))
      await this.#db.q
        .insertInto('user_group_member')
        .values({ user_id: userId, user_group_id: groupId })
        .execute()
  }

  /** Creates the user; undefined when a group does not exist. */
  async create(input: UserInput): Promise<UserRecord | undefined> {
    return this.#db.transaction(async (tx) => {
      const repo = new UserRepository(tx)
      const groupIds = await repo.#groupIds(input.groupKeys)
      if (!groupIds) return undefined
      const now = DbDate.toDb(new Date())
      const bool = (v: boolean) => tx.dialect.boolValue(v) as boolean | number
      await tx.q
        .insertInto('user_account')
        .values({
          key: normaliseUuid(input.key),
          user_name: input.name,
          login: input.userName,
          email: input.email,
          security_stamp: crypto.randomUUID(),
          language: input.languageIsoCode,
          kind: input.kind === 'Api' ? 1 : 0,
          is_locked_out: bool(false),
          is_approved: bool(!input.invited),
          failed_login_attempts: 0,
          invited_date: input.invited ? now : null,
          create_date: now,
          update_date: now,
        })
        .execute()
      const created = await repo.byKey(input.key)
      if (!created) return undefined
      await repo.#setGroups(created.id, groupIds)
      return repo.byKey(input.key)
    })
  }

  /** 'missing-group' or 'missing-node' when a reference does not resolve. */
  async update(
    key: string,
    change: UserUpdate,
  ): Promise<'updated' | 'not-found' | 'missing-group' | Exclude<StartNodeTree, never>> {
    return this.#db.transaction(async (tx) => {
      const repo = new UserRepository(tx)
      const user = await repo.byKey(key)
      if (!user) return 'not-found'
      const groupIds = await repo.#groupIds(change.groupKeys)
      if (!groupIds) return 'missing-group'
      const nodeIds: Array<{ tree: StartNodeTree; id: number }> = []
      for (const tree of TREES) {
        const selection = change.startNodes[tree]
        if (selection.root) nodeIds.push({ tree, id: ROOT_ID })
        const ids = await repo.nodeIds(selection.keys)
        if (!ids) return tree
        for (const id of ids.values()) nodeIds.push({ tree, id })
      }
      await tx.q
        .updateTable('user_account')
        .set({
          user_name: change.name,
          login: change.userName,
          email: change.email,
          language: change.languageIsoCode,
          update_date: DbDate.toDb(new Date()),
        })
        .where('id', '=', user.id)
        .execute()
      await repo.#setGroups(user.id, groupIds)
      await tx.q.deleteFrom('user_start_node').where('user_id', '=', user.id).execute()
      for (const { tree, id } of nodeIds)
        await tx.q
          .insertInto('user_start_node')
          .values({ user_id: user.id, start_node: id, start_node_type: START_NODE_TYPE[tree] })
          .execute()
      return 'updated'
    })
  }

  async setGroups(userKeys: readonly string[], groupKeys: readonly string[]): Promise<boolean> {
    return this.#db.transaction(async (tx) => {
      const repo = new UserRepository(tx)
      const groupIds = await repo.#groupIds(groupKeys)
      if (!groupIds) return false
      for (const user of await repo.byKeys(userKeys)) await repo.#setGroups(user.id, groupIds)
      return true
    })
  }

  async addToGroup(groupKey: string, userKeys: readonly string[]): Promise<void> {
    const [groupId] = (await this.#groupIds([groupKey])) ?? []
    if (groupId === undefined) return
    for (const user of await this.byKeys(userKeys))
      if (!(await this.#groupIds(user.groupKeys))?.includes(groupId))
        await this.#db.q
          .insertInto('user_group_member')
          .values({ user_id: user.id, user_group_id: groupId })
          .execute()
  }

  async removeFromGroup(groupKey: string, userKeys: readonly string[]): Promise<void> {
    const [groupId] = (await this.#groupIds([groupKey])) ?? []
    if (groupId === undefined) return
    for (const user of await this.byKeys(userKeys))
      await this.#db.q
        .deleteFrom('user_group_member')
        .where('user_id', '=', user.id)
        .where('user_group_id', '=', groupId)
        .execute()
  }

  async setApproved(keys: readonly string[], approved: boolean): Promise<void> {
    for (const user of await this.byKeys(keys))
      await this.#db.q
        .updateTable('user_account')
        .set({
          is_approved: this.#db.dialect.boolValue(approved) as boolean | number,
          update_date: DbDate.toDb(new Date()),
        })
        .where('id', '=', user.id)
        .execute()
  }

  async unlock(keys: readonly string[]): Promise<void> {
    for (const user of await this.byKeys(keys))
      await this.#db.q
        .updateTable('user_account')
        .set({
          is_locked_out: this.#db.dialect.boolValue(false) as boolean | number,
          failed_login_attempts: 0,
          update_date: DbDate.toDb(new Date()),
        })
        .where('id', '=', user.id)
        .execute()
  }

  async setLanguage(key: string, isoCode: string): Promise<void> {
    await this.#db.q
      .updateTable('user_account')
      .set({ language: isoCode, update_date: DbDate.toDb(new Date()) })
      .where('key', '=', normaliseUuid(key))
      .execute()
  }

  async setAvatar(key: string, avatar: string | null): Promise<void> {
    await this.#db.q
      .updateTable('user_account')
      .set({ avatar, update_date: DbDate.toDb(new Date()) })
      .where('key', '=', normaliseUuid(key))
      .execute()
  }

  async passwordHash(key: string): Promise<string | null> {
    const row = await this.#db.q
      .selectFrom('user_account')
      .select('password_hash')
      .where('key', '=', normaliseUuid(key))
      .executeTakeFirst()
    return row?.password_hash ?? null
  }

  /** An accepted invitation: the user becomes approved and gets their password. */
  async approve(key: string): Promise<void> {
    await this.setApproved([key], true)
  }

  /** Deletes the user and everything that is only theirs. */
  async delete(key: string): Promise<void> {
    const user = await this.byKey(key)
    if (!user) return
    await this.#db.transaction(async (tx) => {
      for (const table of [
        'user_group_member',
        'user_start_node',
        'user_data',
        'user_token',
        'user_client_credential',
        'user_notification',
        'auth_code',
        'auth_token',
        'user_login_session',
      ] as const)
        await tx.q.deleteFrom(table).where('user_id', '=', user.id).execute()
      // Their provider accounts too, which are keyed by the user rather than the row.
      await tx.q
        .deleteFrom('external_login_token')
        .where('external_login_id', 'in', (eb) =>
          eb.selectFrom('external_login').select('id').where('user_or_member_key', '=', user.key),
        )
        .execute()
      await tx.q.deleteFrom('external_login').where('user_or_member_key', '=', user.key).execute()
      await tx.q.deleteFrom('two_factor_login').where('owner_key', '=', user.key).execute()
      await tx.q.deleteFrom('two_factor_recovery_code').where('owner_key', '=', user.key).execute()
      await tx.q.deleteFrom('user_account').where('id', '=', user.id).execute()
    })
  }

  /** Stores a single-use token's hash for `purpose`, replacing any earlier one. */
  async saveToken(
    userId: number,
    purpose: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.#db.q
      .deleteFrom('user_token')
      .where('user_id', '=', userId)
      .where('purpose', '=', purpose)
      .execute()
    await this.#db.q
      .insertInto('user_token')
      .values({
        token_hash: tokenHash,
        user_id: userId,
        purpose,
        expires_at: DbDate.toDb(expiresAt),
      })
      .execute()
  }

  /** Whether the token is the user's live one for `purpose`; consuming removes it. */
  async checkToken(
    userId: number,
    purpose: string,
    tokenHash: string,
    consume: boolean,
    now = new Date(),
  ): Promise<boolean> {
    const row = await this.#db.q
      .selectFrom('user_token')
      .select('expires_at')
      .where('token_hash', '=', tokenHash)
      .where('user_id', '=', userId)
      .where('purpose', '=', purpose)
      .executeTakeFirst()
    const expires = DbDate.fromDb(row?.expires_at)
    if (!expires || expires.getTime() < now.getTime()) return false
    if (consume)
      await this.#db.q.deleteFrom('user_token').where('token_hash', '=', tokenHash).execute()
    return true
  }

  async clientCredentials(userId: number): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('user_client_credential')
      .select('client_id')
      .where('user_id', '=', userId)
      .orderBy('client_id')
      .execute()
    return rows.map((r) => String(r.client_id))
  }

  async clientCredentialOwner(
    clientId: string,
  ): Promise<{ userId: number; secretHash: string } | undefined> {
    const row = await this.#db.q
      .selectFrom('user_client_credential')
      .select(['user_id', 'secret_hash'])
      .where('client_id', '=', clientId)
      .executeTakeFirst()
    return row ? { userId: Number(row.user_id), secretHash: String(row.secret_hash) } : undefined
  }

  async addClientCredential(
    userId: number,
    clientId: string,
    secretHash: string,
  ): Promise<boolean> {
    if (await this.clientCredentialOwner(clientId)) return false
    await this.#db.q
      .insertInto('user_client_credential')
      .values({
        client_id: clientId,
        user_id: userId,
        secret_hash: secretHash,
        create_date: DbDate.toDb(new Date()),
      })
      .execute()
    return true
  }

  async removeClientCredential(userId: number, clientId: string): Promise<void> {
    await this.#db.q
      .deleteFrom('user_client_credential')
      .where('user_id', '=', userId)
      .where('client_id', '=', clientId)
      .execute()
  }

  /** The user's groups' grants, languages and start node positions, for access checks. */
  async access(userId: number): Promise<UserAccessData> {
    const user = await this.byId(userId)
    const groups = user ? await new UserGroupRepository(this.#db).byKeys(user.groupKeys) : []
    const nodeIds: Record<string, number> = {}
    for (const group of groups)
      for (const tree of TREES) {
        const key = group.startNodes[tree].key
        if (key) nodeIds[key] = 0
      }
    for (const tree of TREES) for (const key of user?.startNodes[tree].keys ?? []) nodeIds[key] = 0
    const keys = Object.keys(nodeIds)
    const rows =
      keys.length > 0
        ? await this.#db.q
            .selectFrom('node')
            .select(NODE_COLUMNS)
            .where('unique_id', 'in', keys)
            .execute()
        : []
    const byKey = new Map(rows.map((r) => [normaliseUuid(String(r.unique_id)), mapNode(r)]))
    const chains = await this.#chains([...byKey.values()])
    const pathOf = (key: string): StartNodePath | undefined => {
      const node = byKey.get(key)
      return node && !node.trashed ? chains.get(node.id) : undefined
    }
    const positions = (selection: { root: boolean; keys: readonly string[] }): StartNodePath[] => [
      ...(selection.root ? [[] as StartNodePath] : []),
      ...selection.keys.flatMap((key) => {
        const path = pathOf(key)
        return path ? [path] : []
      }),
    ]
    const languageRows =
      groups.length > 0
        ? await this.#db.q
            .selectFrom('user_group_language as gl')
            .innerJoin('language as l', 'l.id', 'gl.language_id')
            .select('l.iso_code')
            .distinct()
            .where(
              'gl.user_group_id',
              'in',
              groups.map((g) => g.id),
            )
            .execute()
        : []
    return {
      groups: groups.map((group) => {
        const granular = new Map<string, string[]>()
        const properties = new Map<string, string[]>()
        for (const row of group.granular)
          if (row.context === 'Document' && row.key) {
            const verbs = granular.get(row.key) ?? []
            if (row.permission) verbs.push(row.permission)
            granular.set(row.key, verbs)
          } else if (row.context === 'DocumentTypeProperty' && row.key) {
            // `<property type key>|<verb>`; an empty verb is an explicit "nothing"
            const [propertyType, verb = ''] = row.permission.split('|')
            if (!propertyType) continue
            const key = propertyType.toLowerCase()
            const verbs = properties.get(key) ?? []
            if (verb) verbs.push(verb)
            properties.set(key, verbs)
          }
        return {
          key: group.key,
          alias: group.alias,
          defaults: group.permissions,
          granular,
          properties,
        }
      }),
      languages: languageRows.map((l) => String(l.iso_code)),
      hasAccessToAllLanguages: groups.some((g) => g.hasAccessToAllLanguages),
      groupStartNodes: Object.fromEntries(
        TREES.map((tree) => [
          tree,
          groups.flatMap((g) =>
            positions({
              root: g.startNodes[tree].root,
              keys: g.startNodes[tree].key ? [g.startNodes[tree].key as string] : [],
            }),
          ),
        ]),
      ) as Record<StartNodeTree, StartNodePath[]>,
      userStartNodes: Object.fromEntries(
        TREES.map((tree) => [tree, user ? positions(user.startNodes[tree]) : []]),
      ) as Record<StartNodeTree, StartNodePath[]>,
    }
  }

  /** Each node's ancestor keys then its own, root first. */
  async #chains(nodes: readonly NodeRow[]): Promise<Map<number, string[]>> {
    const ancestorIds = nodes.flatMap((n) =>
      n.path
        .split(',')
        .map(Number)
        .filter((id) => id > 0),
    )
    const all = await this.#nodeKeys(ancestorIds)
    return new Map(
      nodes.map((n) => [
        n.id,
        n.path
          .split(',')
          .map(Number)
          .filter((id) => id > 0)
          .flatMap((id) => {
            const node = all.get(id)
            return node ? [node.key] : []
          }),
      ]),
    )
  }
}

const GROUP_COLUMNS = [
  'id',
  'key',
  'alias',
  'name',
  'description',
  'icon',
  'has_access_to_all_languages',
  'start_content_id',
  'start_media_id',
  'start_element_id',
] as const

const GROUP_START_COLUMN: Record<StartNodeTree, string> = {
  document: 'start_content_id',
  media: 'start_media_id',
  element: 'start_element_id',
}

const groups = (db: Db) => db.q.selectFrom('user_group').select(GROUP_COLUMNS)

export class UserGroupRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async #hydrate(rows: Record<string, unknown>[]): Promise<UserGroupRecord[]> {
    if (rows.length === 0) return []
    const ids = rows.map((r) => Number(r.id))
    const keys = rows.map((r) => normaliseUuid(String(r.key)))
    const sections = await this.#db.q
      .selectFrom('user_group_section')
      .select(['user_group_id', 'app_alias'])
      .where('user_group_id', 'in', ids)
      .execute()
    const languages = await this.#db.q
      .selectFrom('user_group_language as gl')
      .innerJoin('language as l', 'l.id', 'gl.language_id')
      .select(['gl.user_group_id', 'l.iso_code'])
      .where('gl.user_group_id', 'in', ids)
      .orderBy('l.iso_code')
      .execute()
    const permissions = await this.#db.q
      .selectFrom('user_group_permission')
      .select(['user_group_key', 'permission'])
      .where('user_group_key', 'in', keys)
      .orderBy('id')
      .execute()
    const granular = await this.#db.q
      .selectFrom('user_group_granular_permission')
      .select(['user_group_key', 'unique_id', 'permission', 'context'])
      .where('user_group_key', 'in', keys)
      .orderBy('id')
      .execute()
    const startIds = rows.flatMap((r) =>
      TREES.map((tree) => Number(r[GROUP_START_COLUMN[tree]] ?? 0)),
    )
    const nodes = new Map<number, string>()
    const positive = [...new Set(startIds.filter((id) => id > 0))]
    if (positive.length > 0)
      for (const row of await this.#db.q
        .selectFrom('node')
        .select(['id', 'unique_id'])
        .where('id', 'in', positive)
        .execute())
        nodes.set(Number(row.id), normaliseUuid(String(row.unique_id)))

    return rows.map((row) => {
      const id = Number(row.id)
      const key = normaliseUuid(String(row.key))
      const start = (tree: StartNodeTree): GroupStartNode => {
        const value = row[GROUP_START_COLUMN[tree]]
        if (value === null || value === undefined) return { root: false, key: null }
        const nodeId = Number(value)
        if (nodeId === ROOT_ID) return { root: true, key: null }
        return { root: false, key: nodes.get(nodeId) ?? null }
      }
      return {
        id,
        key,
        alias: String(row.alias),
        name: String(row.name),
        description: (row.description as string | null) ?? null,
        icon: (row.icon as string | null) ?? null,
        sections: sections
          .filter((s) => Number(s.user_group_id) === id)
          .map((s) => String(s.app_alias)),
        languages: languages
          .filter((l) => Number(l.user_group_id) === id)
          .map((l) => String(l.iso_code)),
        hasAccessToAllLanguages: fromDbBool(row.has_access_to_all_languages),
        startNodes: {
          document: start('document'),
          media: start('media'),
          element: start('element'),
        },
        permissions: permissions
          .filter((p) => normaliseUuid(String(p.user_group_key)) === key)
          .map((p) => String(p.permission)),
        granular: granular
          .filter((g) => normaliseUuid(String(g.user_group_key)) === key)
          .map((g) => ({
            key: g.unique_id ? normaliseUuid(String(g.unique_id)) : null,
            permission: String(g.permission),
            context: String(g.context),
          })),
      }
    })
  }

  async all(): Promise<UserGroupRecord[]> {
    return this.#hydrate(await groups(this.#db).orderBy('name').execute())
  }

  async byKeys(keys: readonly string[]): Promise<UserGroupRecord[]> {
    const wanted = keys.filter((k) => /^[0-9a-f-]{32,36}$/i.test(k)).map(normaliseUuid)
    if (wanted.length === 0) return []
    return this.#hydrate(
      await groups(this.#db).where('key', 'in', wanted).orderBy('name').execute(),
    )
  }

  async byKey(key: string): Promise<UserGroupRecord | undefined> {
    return (await this.byKeys([key]))[0]
  }

  async byAlias(alias: string): Promise<UserGroupRecord | undefined> {
    return (await this.#hydrate(await groups(this.#db).where('alias', '=', alias).execute()))[0]
  }

  /** How many users each group has, by group key. */
  async memberCounts(): Promise<Map<string, number>> {
    const rows = await this.#db.q
      .selectFrom('user_group as g')
      .leftJoin('user_group_member as m', 'm.user_group_id', 'g.id')
      .select((eb) => ['g.key', eb.fn.count<number>('m.user_id').as('n')])
      .groupBy('g.key')
      .execute()
    return new Map(rows.map((r) => [normaliseUuid(String(r.key)), Number(r.n)]))
  }

  /**
   * Creates or replaces the group. 'missing-node' names the tree whose start
   * node does not exist; 'missing-language' a language that does not.
   */
  async save(
    input: UserGroupInput,
  ): Promise<'saved' | 'missing-language' | { missingNode: StartNodeTree }> {
    return this.#db.transaction(async (tx) => {
      const users = new UserRepository(tx)
      const starts: Record<StartNodeTree, number | null> = {
        document: null,
        media: null,
        element: null,
      }
      for (const tree of TREES) {
        const start = input.startNodes[tree]
        if (start.root) starts[tree] = ROOT_ID
        else if (start.key) {
          const ids = await users.nodeIds([start.key])
          if (!ids) return { missingNode: tree }
          starts[tree] = ids.get(normaliseUuid(start.key)) ?? null
        }
      }
      const languageIds: number[] = []
      if (input.languages.length > 0) {
        const rows = await tx.q
          .selectFrom('language')
          .select(['id', 'iso_code'])
          .where('iso_code', 'in', input.languages)
          .execute()
        if (rows.length !== new Set(input.languages).size) return 'missing-language'
        languageIds.push(...rows.map((r) => Number(r.id)))
      }
      const key = normaliseUuid(input.key)
      const now = DbDate.toDb(new Date())
      const values = {
        alias: input.alias,
        name: input.name,
        description: input.description,
        icon: input.icon,
        has_access_to_all_languages: tx.dialect.boolValue(input.hasAccessToAllLanguages) as
          | boolean
          | number,
        start_content_id: starts.document,
        start_media_id: starts.media,
        start_element_id: starts.element,
      }
      const existing = await new UserGroupRepository(tx).byKey(key)
      if (existing)
        await tx.q
          .updateTable('user_group')
          .set({ ...values, update_date: now })
          .where('id', '=', existing.id)
          .execute()
      else
        await tx.q
          .insertInto('user_group')
          .values({ key, ...values, create_date: now, update_date: now })
          .execute()
      const id = Number(
        (await tx.q.selectFrom('user_group').select('id').where('key', '=', key).executeTakeFirst())
          ?.id,
      )
      await tx.q.deleteFrom('user_group_section').where('user_group_id', '=', id).execute()
      for (const section of new Set(input.sections))
        await tx.q
          .insertInto('user_group_section')
          .values({ user_group_id: id, app_alias: section })
          .execute()
      await tx.q.deleteFrom('user_group_language').where('user_group_id', '=', id).execute()
      for (const languageId of languageIds)
        await tx.q
          .insertInto('user_group_language')
          .values({ user_group_id: id, language_id: languageId })
          .execute()
      await tx.q.deleteFrom('user_group_permission').where('user_group_key', '=', key).execute()
      for (const permission of new Set(input.permissions))
        await tx.q
          .insertInto('user_group_permission')
          .values({ user_group_key: key, permission })
          .execute()
      await tx.q
        .deleteFrom('user_group_granular_permission')
        .where('user_group_key', '=', key)
        .execute()
      for (const row of input.granular)
        await tx.q
          .insertInto('user_group_granular_permission')
          .values({
            user_group_key: key,
            unique_id: row.key ? normaliseUuid(row.key) : null,
            permission: row.permission,
            context: row.context,
          })
          .execute()
      return 'saved'
    })
  }

  async delete(key: string): Promise<void> {
    const group = await this.byKey(key)
    if (!group) return
    await this.#db.transaction(async (tx) => {
      await tx.q.deleteFrom('user_group_member').where('user_group_id', '=', group.id).execute()
      await tx.q.deleteFrom('user_group_section').where('user_group_id', '=', group.id).execute()
      await tx.q.deleteFrom('user_group_language').where('user_group_id', '=', group.id).execute()
      await tx.q
        .deleteFrom('user_group_permission')
        .where('user_group_key', '=', group.key)
        .execute()
      await tx.q
        .deleteFrom('user_group_granular_permission')
        .where('user_group_key', '=', group.key)
        .execute()
      await tx.q.deleteFrom('user_group').where('id', '=', group.id).execute()
    })
  }
}
