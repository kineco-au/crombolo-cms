/**
 * Story 339: where a user may work comes only from their groups. A user's own
 * start nodes are gone, and the upgrade names everyone they had held.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { hashPassword } from '@crombolo/auth'
import { type Db, readReport, seedIdentity, userStartNodesDroppedMigration } from '@crombolo/data'
import { migratedDb } from './support/db.ts'

const dbs: Db[] = []
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()?.close()
})

describe("users' own start nodes (story 339)", () => {
  test('the upgrade names each user they held, audits it, and drops them', async () => {
    const db = await migratedDb()
    dbs.push(db)
    await seedIdentity(db, {
      admin: {
        name: 'Mia Okafor',
        login: 'mia@example.org',
        email: 'mia@example.org',
        password: 'x',
      },
      hashPassword,
      passwordConfig: '{}',
    })
    // The table as a release before 339 had it, holding Mia to all media.
    const t = db.dialect.types
    await db.exec(
      `CREATE TABLE user_start_node (
         id ${t.identity},
         user_id ${t.integer} NOT NULL REFERENCES user_account (id),
         start_node ${t.integer} NOT NULL,
         start_node_type ${t.integer} NOT NULL
       )`,
    )
    const mia = await db.q
      .selectFrom('user_account')
      .select(['id', 'key'])
      .executeTakeFirstOrThrow()
    await db.exec(
      'INSERT INTO user_start_node (user_id, start_node, start_node_type) VALUES (?, -1, 2)',
      [mia.id],
    )

    await userStartNodesDroppedMigration.up(db)

    const report = await readReport(db, { source: 'upgrade', scope: 'user-start-nodes' })
    expect(report).toHaveLength(1)
    expect(report[0]).toMatchObject({ code: 'user-start-nodes-dropped', subjectName: 'Mia Okafor' })
    expect(report[0]?.message).toContain('was held to all media')
    const audit = await db.q
      .selectFrom('audit_entry')
      .select(['action', 'detail'])
      .where('action', '=', 'StartNodesDropped')
      .execute()
    expect(audit[0]?.detail).toContain('all media')
    await expect(db.query('SELECT * FROM user_start_node')).rejects.toThrow()
  })

  test('with none held, nothing is reported', async () => {
    const db = await migratedDb()
    dbs.push(db)
    expect(await readReport(db, { source: 'upgrade', scope: 'user-start-nodes' })).toEqual([])
  })
})
