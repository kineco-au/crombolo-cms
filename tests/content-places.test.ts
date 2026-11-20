/**
 * Story 385, migration 083: every stored group keeps what it could open once the
 * places under Content are grants of their own. Content brings Pages, Settings
 * brings Structure and Code, and a place held without Content brings Content,
 * with Pages left off.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { hashPassword, passwordConfigJson } from '@crombolo/auth'
import { contentPlacesMigration, type Db, seedIdentity } from '@crombolo/data'
import { dialectUnderTest, migratedDb } from './support/db.ts'

const dbs: Db[] = []
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()?.close()
})

/** A migrated database with the built-in groups seeded, as a new site has them. */
async function seeded(): Promise<Db> {
  const db = await migratedDb()
  dbs.push(db)
  await seedIdentity(db, {
    admin: { name: 'A', login: 'a@b.c', email: 'a@b.c', password: 'x' },
    hashPassword,
    passwordConfig: passwordConfigJson(),
  })
  return db
}

const sectionsOf = async (db: Db, id: number) =>
  (
    await db.q
      .selectFrom('user_group_section')
      .select('app_alias')
      .where('user_group_id', '=', id)
      .execute()
  )
    .map((row) => String(row.app_alias))
    .sort()

const setSections = async (db: Db, id: number, sections: string[]) => {
  await db.q.deleteFrom('user_group_section').where('user_group_id', '=', id).execute()
  for (const alias of sections)
    await db.q
      .insertInto('user_group_section')
      .values({ user_group_id: id, app_alias: alias })
      .execute()
}

describe(`migration 083, the places under Content (${dialectUnderTest})`, () => {
  test('keeps what every group could open', async () => {
    const db = await seeded()
    // Three seeded groups, given what a group held before the migration.
    await setSections(db, 2, ['content', 'library', 'workflow'])
    await setSections(db, 4, ['settings', 'users'])
    await setSections(db, 5, ['media', 'forms'])
    await contentPlacesMigration.up(db)
    expect(await sectionsOf(db, 2)).toEqual(['content', 'library', 'pages', 'workflow'])
    expect(await sectionsOf(db, 4)).toEqual(['components', 'settings', 'structure', 'users'])
    expect(await sectionsOf(db, 5)).toEqual(['content', 'forms', 'media'])
  })

  test('a new site seeds its groups with the places already', async () => {
    const db = await seeded()
    expect(await sectionsOf(db, 1)).toEqual(
      expect.arrayContaining(['content', 'pages', 'structure', 'components', 'settings']),
    )
    expect(await sectionsOf(db, 2)).toContain('pages')
  })
})
