/** Per-user key/value data the backoffice keeps between sessions (Umbraco's `umbracoUserData`). */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '../database.ts'
import { sql } from '../query.ts'

export interface UserDataEntry {
  key: string
  group: string
  identifier: string
  value: string
}

export type UserDataResult = 'Success' | 'NotFound' | 'AlreadyExists'

const map = (row: Record<string, unknown>): UserDataEntry => ({
  key: normaliseUuid(String(row.key)),
  group: String(row.data_group),
  identifier: String(row.identifier),
  value: String(row.value),
})

export class UserDataRepository {
  #db: Db

  constructor(db: Db) {
    this.#db = db
  }

  async list(
    userId: number,
    filter: { groups?: readonly string[]; identifiers?: readonly string[] },
    skip: number,
    take: number,
  ): Promise<{ total: number; items: UserDataEntry[] }> {
    const { groups, identifiers } = filter
    const rows = await this.#db.q
      .selectFrom('user_data')
      .select(['key', 'data_group', 'identifier', 'value'])
      .where('user_id', '=', userId)
      .$if(!!groups?.length, (q) => q.where('data_group', 'in', groups ?? []))
      .$if(!!identifiers?.length, (q) => q.where('identifier', 'in', identifiers ?? []))
      .orderBy('data_group')
      .orderBy('identifier')
      .execute()
    return { total: rows.length, items: rows.slice(skip, skip + take).map(map) }
  }

  async get(userId: number, key: string): Promise<UserDataEntry | undefined> {
    const row = await this.#db.q
      .selectFrom('user_data')
      .select(['key', 'data_group', 'identifier', 'value'])
      .where('user_id', '=', userId)
      .where('key', '=', normaliseUuid(key))
      .executeTakeFirst()
    return row ? map(row) : undefined
  }

  async create(userId: number, entry: UserDataEntry): Promise<UserDataResult> {
    const key = normaliseUuid(entry.key)
    const clash = await this.#db.q
      .selectFrom('user_data')
      .select(sql<number>`1`.as('one'))
      .where((eb) =>
        eb.or([
          eb('key', '=', key),
          eb.and([
            eb('user_id', '=', userId),
            eb('data_group', '=', entry.group),
            eb('identifier', '=', entry.identifier),
          ]),
        ]),
      )
      .execute()
    if (clash.length > 0) return 'AlreadyExists'
    await this.#db.q
      .insertInto('user_data')
      .values({
        key,
        user_id: userId,
        data_group: entry.group,
        identifier: entry.identifier,
        value: entry.value,
      })
      .execute()
    return 'Success'
  }

  async update(userId: number, entry: UserDataEntry): Promise<UserDataResult> {
    if (!(await this.get(userId, entry.key))) return 'NotFound'
    await this.#db.q
      .updateTable('user_data')
      .set({ data_group: entry.group, identifier: entry.identifier, value: entry.value })
      .where('user_id', '=', userId)
      .where('key', '=', normaliseUuid(entry.key))
      .execute()
    return 'Success'
  }

  async delete(userId: number, key: string): Promise<UserDataResult> {
    if (!(await this.get(userId, key))) return 'NotFound'
    await this.#db.q
      .deleteFrom('user_data')
      .where('user_id', '=', userId)
      .where('key', '=', normaliseUuid(key))
      .execute()
    return 'Success'
  }
}
