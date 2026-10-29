/**
 * Kysely as the query layer (story 221): it compiles, the `Db` runs, so its
 * statements join the `Db`'s transactions and reach a recording `Db` as any
 * other statement does.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  type Db,
  INITIAL_STATE,
  MigrationPlan,
  planUpgrade,
  queryFor,
  sql,
  TransactionRefused,
} from '@crombolo/data'
import { migratedDb } from './support/db.ts'

let db: Db

beforeEach(async () => {
  db = await migratedDb()
})

afterEach(async () => {
  await db.close()
})

const KEY = 'query-layer:test'

async function storedValue(handle: Db): Promise<string | undefined> {
  const row = await handle.q
    .selectFrom('key_value')
    .select('value')
    .where('key', '=', KEY)
    .executeTakeFirst()
  return row?.value ?? undefined
}

describe('db.q', () => {
  test('inserts, updates with RETURNING and reads back on the dialect under test', async () => {
    await db.q
      .insertInto('key_value')
      .values({ key: KEY, value: 'one', update_date: new Date().toISOString() })
      .execute()
    const updated = await db.q
      .updateTable('key_value')
      .set({ value: 'two' })
      .where('key', '=', KEY)
      .returning('key')
      .execute()
    expect(updated).toEqual([{ key: KEY }])
    expect(await storedValue(db)).toBe('two')
  })

  test('parameters may hold a question mark without upsetting the placeholders', async () => {
    await db.q
      .insertInto('key_value')
      .values({ key: KEY, value: 'why? because?', update_date: new Date().toISOString() })
      .execute()
    expect(await storedValue(db)).toBe('why? because?')
  })

  test('is made once per handle', () => {
    expect(db.q).toBe(db.q)
    expect(queryFor(db)).toBe(db.q)
  })

  test("tx.q belongs to the transaction: a rollback takes Kysely's writes with it", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.q
          .insertInto('key_value')
          .values({ key: KEY, value: 'gone', update_date: new Date().toISOString() })
          .execute()
        expect(await storedValue(tx)).toBe('gone')
        throw new Error('roll back')
      }),
    ).rejects.toThrow('roll back')
    expect(await storedValue(db)).toBeUndefined()
  })

  test("Kysely's own transactions are refused, pointing at db.transaction", async () => {
    await expect(db.q.transaction().execute(async () => undefined)).rejects.toBeInstanceOf(
      TransactionRefused,
    )
  })

  test('raw sql runs through the same handle', async () => {
    const { rows } = await sql<{ one: number }>`SELECT 1 AS one`.execute(db.q)
    expect(Number(rows[0]?.one)).toBe(1)
  })
})

describe('the upgrade plan', () => {
  test("records a migration's Kysely DDL, and a read makes it unplannable", async () => {
    const plan = new MigrationPlan(
      [
        {
          from: INITIAL_STATE,
          to: 'one',
          name: 'creates',
          up: async (tx) => {
            await tx.q.schema
              .createTable('query_layer_probe')
              .addColumn('id', 'integer', (c) => c.primaryKey())
              .execute()
          },
        },
        {
          from: 'one',
          to: 'two',
          name: 'reads',
          up: async (tx) => {
            await tx.q.selectFrom('key_value').select('key').execute()
          },
        },
      ],
      { stateKey: 'query-layer:plan' },
    )
    const [creates, reads] = await planUpgrade(db, plan)
    expect(creates?.statements?.join('\n')).toContain('create table "query_layer_probe"')
    expect(reads?.statements).toBeUndefined()
    expect(reads?.unplannable).toContain('select "key" from "key_value"')
  })
})
