/**
 * Members: content nodes with a sign-in facet.
 *
 * A member is stored exactly as a document is — `node` + `content` +
 * `content_version` + values — so member types, properties and versioning are
 * machinery that already exists. What makes it a member is the `member` row
 * beside it: e-mail, username, password hash, approval and lockout. Group
 * membership is `member_group_member`, and the rules that protect a page name a
 * group by its **name**, so `roles` reads names rather than keys.
 *
 * Passwords arrive already hashed. Hashing belongs to `@crombolo/auth`, and
 * `data` depends on nothing but types.
 */
import { normaliseUuid, ObjectTypes } from '@crombolo/core'
import type { SqlBool } from 'kysely'
import type { Db } from '../database.ts'
import { DbDate, fromDbBool } from '../dialect.ts'
import { type Expression, sql } from '../query.ts'
import { queueForSearch } from '../search.ts'
import { searchTerms } from '../search-text.ts'
import {
  DocumentRepository,
  type DocumentRepositoryOptions,
  type SaveDocumentInput,
} from './documents.ts'
import { NodeRepository } from './nodes.ts'

/** The sign-in facet beside a member's content. */
export interface MemberIdentity {
  email: string
  username: string
  isApproved: boolean
  isLockedOut: boolean
  failedPasswordAttempts: number
  lastLoginDate: Date | undefined
  lastLockoutDate: Date | undefined
  lastPasswordChangeDate: Date | undefined
  emailConfirmedDate: Date | undefined
  /** Rotated whenever a credential changes; a session carrying a stale one is over. */
  securityStamp: string | null
}

export interface MemberRecord extends MemberIdentity {
  key: string
  name: string
  /** Member group names, which is the currency public-access rules deal in. */
  roles: string[]
  contentTypeKey: string
  contentTypeAlias: string
  contentTypeIcon: string | null
}

export interface MemberCredentials extends MemberRecord {
  passwordHash: string | null
  passwordConfig: string | null
}

/** What a create or an update writes to the facet; omitted fields are left alone. */
export interface MemberIdentityInput {
  email: string
  username: string
  isApproved: boolean
  isLockedOut: boolean
  passwordHash?: string | null
  passwordConfig?: string | null
  /** Group **keys**; the membership table stores node ids. */
  groupKeys?: readonly string[]
}

export interface MemberFilter {
  memberTypeKey?: string | null
  memberGroupName?: string | null
  isApproved?: boolean
  isLockedOut?: boolean
  /** Matched against e-mail, username and name. */
  filter?: string
  orderBy?: string
  orderDirection?: 'Ascending' | 'Descending'
  skip: number
  take: number
}

/** Umbraco's `MemberFilterRepository` order columns; anything else is username. */
const ORDER_COLUMNS = {
  email: 'm.email',
  name: 'n.text',
  username: 'm.login_name',
  isapproved: 'm.is_approved',
  islockedout: 'm.is_locked_out',
  lastlogindate: 'm.last_login_date',
} as const

type OrderColumn = (typeof ORDER_COLUMNS)[keyof typeof ORDER_COLUMNS]

interface MemberRow {
  unique_id: string
  text: string | null
  email: string
  login_name: string
  password: string | null
  password_config: string | null
  security_stamp_token: string | null
  email_confirmed_date: unknown
  failed_password_attempts: number
  is_locked_out: unknown
  is_approved: unknown
  last_login_date: unknown
  last_lockout_date: unknown
  last_password_change_date: unknown
  type_key: string
  type_alias: string
  type_icon: string | null
}

const joined = (db: Db) =>
  db.q
    .selectFrom('member as m')
    .innerJoin('node as n', 'n.id', 'm.node_id')
    .innerJoin('content as c', 'c.node_id', 'm.node_id')
    .innerJoin('content_type as ct', 'ct.node_id', 'c.content_type_id')
    .innerJoin('node as tn', 'tn.id', 'ct.node_id')

const memberColumns = (query: ReturnType<typeof joined>) =>
  query
    .select(['n.unique_id', 'n.text'])
    .selectAll('m')
    .select(['tn.unique_id as type_key', 'ct.alias as type_alias', 'ct.icon as type_icon'])

export class MemberRepository {
  #db: Db
  #nodes: NodeRepository
  readonly content: DocumentRepository

  constructor(db: Db, options: DocumentRepositoryOptions = {}) {
    this.#db = db
    this.#nodes = new NodeRepository(db)
    this.content = new DocumentRepository(db, { ...options, kind: 'member' })
  }

  async #rolesOf(nodeId: number): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('member_group_member as mg')
      .innerJoin('node as g', 'g.id', 'mg.member_group_id')
      .select('g.text')
      .where('mg.member_id', '=', nodeId)
      .orderBy('g.text')
      .execute()
    return rows.map((row) => String(row.text ?? '')).filter(Boolean)
  }

  async #groupKeysOf(nodeId: number): Promise<string[]> {
    const rows = await this.#db.q
      .selectFrom('member_group_member as mg')
      .innerJoin('node as g', 'g.id', 'mg.member_group_id')
      .select('g.unique_id')
      .where('mg.member_id', '=', nodeId)
      .orderBy('g.text')
      .execute()
    return rows.map((row) => normaliseUuid(String(row.unique_id)))
  }

  async #hydrate(row: MemberRow): Promise<MemberCredentials> {
    const node = await this.#nodes.byKey(normaliseUuid(String(row.unique_id)))
    return {
      key: normaliseUuid(String(row.unique_id)),
      name: row.text ?? '',
      email: row.email,
      username: row.login_name,
      passwordHash: row.password,
      passwordConfig: row.password_config,
      securityStamp: row.security_stamp_token,
      isApproved: fromDbBool(row.is_approved),
      isLockedOut: fromDbBool(row.is_locked_out),
      failedPasswordAttempts: Number(row.failed_password_attempts ?? 0),
      lastLoginDate: DbDate.fromDb(row.last_login_date),
      lastLockoutDate: DbDate.fromDb(row.last_lockout_date),
      lastPasswordChangeDate: DbDate.fromDb(row.last_password_change_date),
      emailConfirmedDate: DbDate.fromDb(row.email_confirmed_date),
      roles: node ? await this.#rolesOf(node.id) : [],
      contentTypeKey: normaliseUuid(String(row.type_key)),
      contentTypeAlias: String(row.type_alias),
      contentTypeIcon: row.type_icon,
    }
  }

  async #one(
    column: 'n.unique_id' | 'm.login_name' | 'm.email',
    value: string,
  ): Promise<MemberCredentials | undefined> {
    const rows = await memberColumns(joined(this.#db)).where(column, '=', value).execute()
    return rows[0] ? this.#hydrate(rows[0]) : undefined
  }

  byKey(key: string): Promise<MemberCredentials | undefined> {
    return this.#one('n.unique_id', normaliseUuid(key))
  }

  byUsername(username: string): Promise<MemberCredentials | undefined> {
    return this.#one('m.login_name', username)
  }

  byEmail(email: string): Promise<MemberCredentials | undefined> {
    return this.#one('m.email', email)
  }

  /** The group keys a member belongs to, for the editor's Groups picker. */
  async groupKeys(key: string): Promise<string[]> {
    const node = await this.#nodes.byKey(key)
    return node ? this.#groupKeysOf(node.id) : []
  }

  /** Whether a username or an e-mail is taken by anyone other than `exceptKey`. */
  async taken(field: 'username' | 'email', value: string, exceptKey?: string): Promise<boolean> {
    const column = field === 'username' ? 'm.login_name' : 'm.email'
    const rows = await this.#db.q
      .selectFrom('member as m')
      .innerJoin('node as n', 'n.id', 'm.node_id')
      .select('n.unique_id')
      .where(column, '=', value)
      .execute()
    return rows.some(
      (row) => !exceptKey || normaliseUuid(String(row.unique_id)) !== normaliseUuid(exceptKey),
    )
  }

  /** Replaces a member's groups, by group key; what an identity provider's group sync writes. */
  async setGroups(key: string, groupKeys: readonly string[]): Promise<void> {
    const node = await this.#nodes.byKey(key)
    if (!node || node.objectType !== ObjectTypes.Member) return
    await this.#db.transaction(() => this.#writeGroups(node.id, groupKeys))
  }

  async #writeGroups(nodeId: number, groupKeys: readonly string[]): Promise<void> {
    await this.#db.q.deleteFrom('member_group_member').where('member_id', '=', nodeId).execute()
    for (const key of groupKeys) {
      const group = await this.#nodes.byKey(key)
      if (!group || group.objectType !== ObjectTypes.MemberGroup) continue
      await this.#db.q
        .insertInto('member_group_member')
        .values({ member_id: nodeId, member_group_id: group.id })
        .execute()
    }
  }

  async create(
    content: SaveDocumentInput,
    identity: MemberIdentityInput,
  ): Promise<MemberCredentials> {
    // Members never nest: the parent is always the tree root.
    const created = await this.content.create({ ...content, parentKey: null, componentKey: null })
    const node = await this.#nodes.byKey(created.key)
    if (!node) throw new Error(`the member node ${created.key} vanished while being created`)
    const now = new Date()
    await this.#db.q
      .insertInto('member')
      .values({
        node_id: node.id,
        email: identity.email,
        login_name: identity.username,
        password: identity.passwordHash ?? null,
        password_config: identity.passwordConfig ?? null,
        security_stamp_token: crypto.randomUUID(),
        failed_password_attempts: 0,
        is_locked_out: this.#db.dialect.boolValue(identity.isLockedOut) as boolean | number,
        is_approved: this.#db.dialect.boolValue(identity.isApproved) as boolean | number,
        last_password_change_date: identity.passwordHash ? DbDate.toDb(now) : null,
      })
      .execute()
    await this.#writeGroups(node.id, identity.groupKeys ?? [])
    // Again, now the e-mail and username it is found by are written.
    await queueForSearch(this.#db, [node.id])
    const member = await this.byKey(created.key)
    if (!member) throw new Error(`the member ${created.key} could not be read back`)
    return member
  }

  /**
   * Saves content and facet together. A new password rotates the security
   * stamp, which ends every session the member had.
   */
  async update(
    key: string,
    content: SaveDocumentInput,
    identity: MemberIdentityInput,
  ): Promise<MemberCredentials | undefined> {
    const node = await this.#nodes.byKey(key)
    if (!node || node.objectType !== ObjectTypes.Member) return undefined
    const updated = await this.content.update({ ...content, key, componentKey: null })
    if (!updated) return undefined
    const now = new Date()
    await this.#db.q
      .updateTable('member')
      .set({
        email: identity.email,
        login_name: identity.username,
        is_approved: this.#db.dialect.boolValue(identity.isApproved) as boolean | number,
        is_locked_out: this.#db.dialect.boolValue(identity.isLockedOut) as boolean | number,
        ...(identity.isLockedOut ? {} : { failed_password_attempts: 0 }),
        ...(identity.passwordHash
          ? {
              password: identity.passwordHash,
              password_config: identity.passwordConfig ?? null,
              last_password_change_date: DbDate.toDb(now),
              security_stamp_token: crypto.randomUUID(),
            }
          : {}),
      })
      .where('node_id', '=', node.id)
      .execute()
    await queueForSearch(this.#db, [node.id])
    if (identity.groupKeys) await this.#writeGroups(node.id, identity.groupKeys)
    return this.byKey(key)
  }

  /** Records a successful sign-in, clearing whatever failures came before it. */
  /**
   * Replaces an imported hash with argon2id after a successful sign-in. The
   * password is the same, so the security stamp and change date stand.
   */
  async rehashPassword(key: string, passwordHash: string, passwordConfig: string): Promise<void> {
    await this.#db.q
      .updateTable('member')
      .set({ password: passwordHash, password_config: passwordConfig })
      .where('node_id', '=', (eb) =>
        eb.selectFrom('node').select('id').where('unique_id', '=', normaliseUuid(key)),
      )
      .execute()
  }

  async recordLogin(key: string): Promise<void> {
    const node = await this.#nodes.byKey(key)
    if (!node) return
    await this.#db.q
      .updateTable('member')
      .set({ last_login_date: DbDate.toDb(new Date()), failed_password_attempts: 0 })
      .where('node_id', '=', node.id)
      .execute()
  }

  /**
   * Records a failed sign-in and locks the account out once `maxAttempts` is
   * reached, as Umbraco's lockout does.
   */
  async recordFailedLogin(key: string, maxAttempts: number): Promise<{ lockedOut: boolean }> {
    const node = await this.#nodes.byKey(key)
    if (!node) return { lockedOut: false }
    const row = await this.#db.q
      .selectFrom('member')
      .select('failed_password_attempts')
      .where('node_id', '=', node.id)
      .executeTakeFirst()
    const attempts = Number(row?.failed_password_attempts ?? 0) + 1
    const lockedOut = maxAttempts > 0 && attempts >= maxAttempts
    await this.#db.q
      .updateTable('member')
      .set({
        failed_password_attempts: attempts,
        is_locked_out: this.#db.dialect.boolValue(lockedOut) as boolean | number,
        ...(lockedOut ? { last_lockout_date: DbDate.toDb(new Date()) } : {}),
      })
      .where('node_id', '=', node.id)
      .execute()
    return { lockedOut }
  }

  async delete(key: string): Promise<boolean> {
    const node = await this.#nodes.byKey(key)
    if (!node || node.objectType !== ObjectTypes.Member) return false
    const q = this.#db.q
    await q.deleteFrom('member_group_member').where('member_id', '=', node.id).execute()
    await q
      .deleteFrom('external_login_token')
      .where('external_login_id', 'in', (eb) =>
        eb.selectFrom('external_login').select('id').where('user_or_member_key', '=', node.key),
      )
      .execute()
    await q.deleteFrom('external_login').where('user_or_member_key', '=', node.key).execute()
    await q.deleteFrom('two_factor_login').where('owner_key', '=', node.key).execute()
    await q.deleteFrom('two_factor_recovery_code').where('owner_key', '=', node.key).execute()
    await q.deleteFrom('member').where('node_id', '=', node.id).execute()
    return this.content.delete(key)
  }

  /** The Members collection: Umbraco's member filter, with the same columns and defaults. */
  async filter(criteria: MemberFilter): Promise<{ total: number; items: MemberCredentials[] }> {
    const db = this.#db
    const text = criteria.filter?.trim()
    const terms = text ? searchTerms(text) : []
    const base = joined(db).where((eb) => {
      const all: Expression<SqlBool>[] = []
      if (criteria.memberTypeKey)
        all.push(eb('tn.unique_id', '=', normaliseUuid(criteria.memberTypeKey)))
      if (criteria.isApproved !== undefined)
        all.push(
          eb('m.is_approved', '=', db.dialect.boolValue(criteria.isApproved) as boolean | number),
        )
      if (criteria.isLockedOut !== undefined)
        all.push(
          eb(
            'm.is_locked_out',
            '=',
            db.dialect.boolValue(criteria.isLockedOut) as boolean | number,
          ),
        )
      if (criteria.memberGroupName)
        all.push(
          eb.exists(
            eb
              .selectFrom('member_group_member as mg')
              .innerJoin('node as g', 'g.id', 'mg.member_group_id')
              .select(sql<number>`1`.as('one'))
              .whereRef('mg.member_id', '=', 'm.node_id')
              .where('g.text', '=', criteria.memberGroupName),
          ),
        )
      if (text) {
        const like = `%${text.toLowerCase()}%`
        const any: Expression<SqlBool>[] = [
          eb(eb.fn('lower', ['m.email']), 'like', like),
          eb(eb.fn('lower', ['m.login_name']), 'like', like),
          eb(eb.fn('lower', ['n.text']), 'like', like),
        ]
        // The index adds what a member's properties say to the name, username and e-mail.
        if (terms.length > 0)
          any.push(
            eb(
              'm.node_id',
              'in',
              eb
                .selectFrom(db.dialect.fullTextMatches(db.dialect.fullTextQuery(terms)).as('h'))
                .select(sql<number>`node_id`.as('node_id')),
            ),
          )
        all.push(eb.or(any))
      }
      return eb.and(all)
    })
    const order: OrderColumn =
      ORDER_COLUMNS[(criteria.orderBy ?? '').toLowerCase() as keyof typeof ORDER_COLUMNS] ??
      ORDER_COLUMNS.username
    const direction = criteria.orderDirection === 'Descending' ? 'desc' : 'asc'

    const counted = await base.select(sql<number>`count(*)`.as('total')).executeTakeFirst()
    const rows = await memberColumns(base)
      .orderBy(order, direction)
      .orderBy('n.id')
      .limit(criteria.take)
      .offset(criteria.skip)
      .execute()
    const items = []
    for (const row of rows) items.push(await this.#hydrate(row))
    return { total: Number(counted?.total ?? 0), items }
  }

  /** The member picker's search: name, username or e-mail, within the types allowed. */
  async search(
    query: string,
    options: { allowedMemberTypeKeys?: readonly string[]; skip: number; take: number },
  ): Promise<{ total: number; items: MemberCredentials[] }> {
    const allowed = options.allowedMemberTypeKeys ?? []
    const page = await this.filter({
      filter: query,
      skip: 0,
      take: Number.MAX_SAFE_INTEGER,
      orderBy: 'name',
    })
    const items =
      allowed.length === 0
        ? page.items
        : page.items.filter((member) =>
            allowed.map(normaliseUuid).includes(normaliseUuid(member.contentTypeKey)),
          )
    return {
      total: items.length,
      items: items.slice(options.skip, options.skip + options.take),
    }
  }

  /** Several members by key, in the order asked, for the item lookup. */
  async items(keys: readonly string[]): Promise<MemberCredentials[]> {
    const found = []
    for (const key of keys) {
      const member = await this.byKey(key)
      if (member) found.push(member)
    }
    return found
  }
}
