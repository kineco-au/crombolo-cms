/**
 * Kysely as the query layer (story 221): it compiles, the `Db` runs, so its
 * statements join the `Db`'s transactions and reach a recording `Db` as any
 * other statement does.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RemotePermissions } from '@crombolo/core'
import {
  type Db,
  INITIAL_STATE,
  MigrationPlan,
  planUpgrade,
  queryFor,
  RemoteTrustRepository,
  sql,
  TransactionRefused,
  TrustedSignerRepository,
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

// Story 426: a statement that changes rows says how many.
describe('how many rows a statement changed', () => {
  const row = (n: number) => ({
    key: `${KEY}:${n}`,
    value: 'one',
    update_date: new Date().toISOString(),
  })
  const counts = async (handle: Db) => {
    const inserted = await handle.q
      .insertInto('key_value')
      .values([row(1), row(2), row(3)])
      .executeTakeFirst()
    const updated = await handle.q
      .updateTable('key_value')
      .set({ value: 'two' })
      .where('key', 'in', [row(1).key, row(2).key])
      .executeTakeFirst()
    const none = await handle.q
      .updateTable('key_value')
      .set({ value: 'three' })
      .where('key', '=', `${KEY}:absent`)
      .executeTakeFirst()
    const deleted = await handle.q
      .deleteFrom('key_value')
      .where('key', 'like', `${KEY}:%`)
      .executeTakeFirst()
    return [
      Number(inserted.numInsertedOrUpdatedRows),
      Number(updated.numUpdatedRows),
      Number(none.numUpdatedRows),
      Number(deleted.numDeletedRows),
    ]
  }

  test('an insert, an update and a delete report theirs, inside a transaction and out', async () => {
    expect(await counts(db)).toEqual([3, 2, 0, 3])
    expect(await db.transaction((tx) => counts(tx))).toEqual([3, 2, 0, 3])
    expect(await db.run('DELETE FROM key_value WHERE key = ?', [`${KEY}:absent`])).toBe(0)
  })

  test('a trusted signer and a trust rule say whether one was there to change', async () => {
    const signers = new TrustedSignerRepository(db)
    const signer = await signers.add({
      kind: 'user',
      name: 'Ours',
      publicKey: 'key',
      fingerprint: 'print',
      source: null,
      addedBy: 'test',
    })
    expect(await signers.rename(signer.id, 'Theirs')).toBe(true)
    expect(await signers.rename(crypto.randomUUID(), 'Nobody')).toBe(false)
    expect(await signers.remove(signer.id)).toBe(true)
    expect(await signers.remove(signer.id)).toBe(false)

    const rules = new RemoteTrustRepository(db)
    const rule = await rules.create(
      {
        name: 'Deploys',
        issuer: 'https://token.actions.githubusercontent.com',
        repository: 'acme/site',
        refKind: 'branch',
        refValue: 'main',
        permissions: [RemotePermissions.Pull],
      },
      'test',
    )
    expect(await rules.remove(rule.key)).toBe(true)
    expect(await rules.remove(rule.key)).toBe(false)
  })
})

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
