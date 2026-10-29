/**
 * Which pages are protected, and by what.
 *
 * An entry protects the page it names *and everything below it*, so the render
 * path asks "is anything on this node's ancestor path protected?" — which is
 * `entryFor`, resolved against `node.path` rather than by walking parents.
 *
 * Rules are names, not keys: a member group's name or a member's username, as
 * Umbraco stores them, because that is what a signed-in member carries.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'
import { NodeRepository } from './nodes.ts'

export const MEMBER_GROUP_RULE = 'MemberRole'
export const MEMBER_USERNAME_RULE = 'MemberUsername'

export interface PublicAccessEntry {
  key: string
  /** The protected page. */
  nodeKey: string
  loginNodeKey: string
  errorNodeKey: string
  memberGroupNames: string[]
  memberUserNames: string[]
}

export interface PublicAccessInput {
  nodeKey: string
  loginNodeKey: string
  errorNodeKey: string
  memberGroupNames: readonly string[]
  memberUserNames: readonly string[]
}

interface EntryRow {
  id: number
  key: string
  node_key: string
  login_key: string
  error_key: string
}

const entries = (db: Db) =>
  db.q
    .selectFrom('public_access as a')
    .innerJoin('node as n', 'n.id', 'a.node_id')
    .innerJoin('node as l', 'l.id', 'a.login_node_id')
    .innerJoin('node as e', 'e.id', 'a.error_node_id')
    .select([
      'a.id',
      'a.key',
      'n.unique_id as node_key',
      'l.unique_id as login_key',
      'e.unique_id as error_key',
    ])

export class PublicAccessRepository {
  #db: Db
  #nodes: NodeRepository

  constructor(db: Db) {
    this.#db = db
    this.#nodes = new NodeRepository(db)
  }

  async #rules(id: number): Promise<{ groups: string[]; users: string[] }> {
    const rows = await this.#db.q
      .selectFrom('public_access_rule')
      .select(['rule_type', 'rule_value'])
      .where('public_access_id', '=', id)
      .orderBy('rule_value')
      .execute()
    return {
      groups: rows
        .filter((r) => r.rule_type === MEMBER_GROUP_RULE)
        .map((r) => String(r.rule_value)),
      users: rows
        .filter((r) => r.rule_type === MEMBER_USERNAME_RULE)
        .map((r) => String(r.rule_value)),
    }
  }

  async #hydrate(row: EntryRow): Promise<PublicAccessEntry> {
    const { groups, users } = await this.#rules(Number(row.id))
    return {
      key: normaliseUuid(String(row.key)),
      nodeKey: normaliseUuid(String(row.node_key)),
      loginNodeKey: normaliseUuid(String(row.login_key)),
      errorNodeKey: normaliseUuid(String(row.error_key)),
      memberGroupNames: groups,
      memberUserNames: users,
    }
  }

  /**
   * Every protected node with who may see it, in two queries: what a request
   * checking many pages at once reads, rather than an entry per page.
   */
  async allRules(): Promise<
    Array<{ nodeId: number; memberGroupNames: string[]; memberUserNames: string[] }>
  > {
    const all = await this.#db.q.selectFrom('public_access').select(['id', 'node_id']).execute()
    if (all.length === 0) return []
    const rules = await this.#db.q
      .selectFrom('public_access_rule')
      .select(['public_access_id', 'rule_type', 'rule_value'])
      .execute()
    return all.map((entry) => {
      const own = rules.filter((r) => Number(r.public_access_id) === Number(entry.id))
      return {
        nodeId: Number(entry.node_id),
        memberGroupNames: own
          .filter((r) => r.rule_type === MEMBER_GROUP_RULE)
          .map((r) => r.rule_value),
        memberUserNames: own
          .filter((r) => r.rule_type === MEMBER_USERNAME_RULE)
          .map((r) => r.rule_value),
      }
    })
  }

  /** The entry protecting this page itself, if any. */
  async byNodeKey(nodeKey: string): Promise<PublicAccessEntry | undefined> {
    const row = await entries(this.#db)
      .where('n.unique_id', '=', normaliseUuid(nodeKey))
      .executeTakeFirst()
    return row ? this.#hydrate(row) : undefined
  }

  /**
   * The entry that governs a page: its own, else the nearest protected
   * ancestor's. `undefined` means the page is open to everyone.
   */
  async entryFor(nodeKey: string): Promise<PublicAccessEntry | undefined> {
    const node = await this.#nodes.byKey(nodeKey)
    if (!node) return undefined
    // `path` is "-1,1050,1063": the ids from the root down. The nearest
    // protected ancestor governs, so the deepest match wins.
    const ids = node.path
      .split(',')
      .map((part) => Number(part))
      .filter((id) => Number.isFinite(id))
    if (ids.length === 0) return undefined
    const row = await entries(this.#db)
      .where('a.node_id', 'in', ids)
      .orderBy('n.level', 'desc')
      .limit(1)
      .executeTakeFirst()
    return row ? this.#hydrate(row) : undefined
  }

  /** Whether an ancestor above this page is protected, which the editor shows. */
  async isProtectedByAncestor(nodeKey: string): Promise<boolean> {
    const entry = await this.entryFor(nodeKey)
    return entry !== undefined && entry.nodeKey !== normaliseUuid(nodeKey)
  }

  /**
   * Creates or replaces the entry for a page. `undefined` means one of the
   * three nodes could not be found.
   */
  async save(input: PublicAccessInput): Promise<PublicAccessEntry | undefined> {
    const node = await this.#nodes.byKey(input.nodeKey)
    const login = await this.#nodes.byKey(input.loginNodeKey)
    const error = await this.#nodes.byKey(input.errorNodeKey)
    if (!node || !login || !error) return undefined
    const now = DbDate.toDb(new Date())
    await this.#db.transaction(async (tx) => {
      const existing = await tx.q
        .selectFrom('public_access')
        .select('id')
        .where('node_id', '=', node.id)
        .executeTakeFirst()
      let id = existing ? Number(existing.id) : undefined
      if (id === undefined) {
        const key = crypto.randomUUID()
        await tx.q
          .insertInto('public_access')
          .values({
            key,
            node_id: node.id,
            login_node_id: login.id,
            error_node_id: error.id,
            create_date: now,
            update_date: now,
          })
          .execute()
        const created = await tx.q
          .selectFrom('public_access')
          .select('id')
          .where('node_id', '=', node.id)
          .executeTakeFirst()
        id = Number(created?.id)
      } else {
        await tx.q
          .updateTable('public_access')
          .set({ login_node_id: login.id, error_node_id: error.id, update_date: now })
          .where('id', '=', id)
          .execute()
        await tx.q.deleteFrom('public_access_rule').where('public_access_id', '=', id).execute()
      }
      for (const [type, names] of [
        [MEMBER_GROUP_RULE, input.memberGroupNames],
        [MEMBER_USERNAME_RULE, input.memberUserNames],
      ] as const) {
        for (const name of new Set(names.filter((value) => value.trim() !== ''))) {
          await tx.q
            .insertInto('public_access_rule')
            .values({ public_access_id: id, rule_type: type, rule_value: name, create_date: now })
            .execute()
        }
      }
    })
    return this.byNodeKey(input.nodeKey)
  }

  async remove(nodeKey: string): Promise<boolean> {
    const node = await this.#nodes.byKey(nodeKey)
    if (!node) return false
    const row = await this.#db.q
      .selectFrom('public_access')
      .select('id')
      .where('node_id', '=', node.id)
      .executeTakeFirst()
    const id = row?.id
    if (id === undefined) return false
    await this.#db.q.deleteFrom('public_access_rule').where('public_access_id', '=', id).execute()
    await this.#db.q.deleteFrom('public_access').where('id', '=', id).execute()
    return true
  }
}
