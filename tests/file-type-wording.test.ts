/**
 * Migration 108: a site that installed 0.84.0 has the File type's first wording,
 * which no longer matches the built-in type (story 450).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { FILE_BODY_PROPERTY_KEY, SYSTEM_CONTENT_TYPE_KEYS } from '@crombolo/core'
import {
  type Db,
  ensureBuiltInDataTypes,
  ensureSystemContentTypes,
  fileTypeWordingMigration,
} from '@crombolo/data'
import { dialectUnderTest, migratedDb } from './support/db.ts'

const dbs: Db[] = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.close()
})

const wording = async (db: Db) => {
  const type = await db.q
    .selectFrom('content_type as ct')
    .innerJoin('node as n', 'n.id', 'ct.node_id')
    .select('ct.description')
    .where('n.unique_id', '=', SYSTEM_CONTENT_TYPE_KEYS.File)
    .executeTakeFirstOrThrow()
  const body = await db.q
    .selectFrom('property_type')
    .select('description')
    .where('unique_id', '=', FILE_BODY_PROPERTY_KEY)
    .executeTakeFirstOrThrow()
  return { type: type.description, body: body.description }
}

describe(`the File type's wording (${dialectUnderTest}, migration 108)`, () => {
  test("0.84.0's wording becomes the wording the type ships with", async () => {
    const db = await migratedDb()
    dbs.push(db)
    await ensureBuiltInDataTypes(db)
    await ensureSystemContentTypes(db)
    expect(await wording(db)).toEqual({ type: 'A content file', body: null })
    await db.q
      .updateTable('content_type')
      .set({
        description: 'A file such as llms.txt, served at its name exactly, extension included.',
      })
      .where('alias', '=', 'fileItem')
      .execute()
    await db.q
      .updateTable('property_type')
      .set({
        description:
          "What is served at the File's address: text written here, or an uploaded file.",
      })
      .where('unique_id', '=', FILE_BODY_PROPERTY_KEY)
      .execute()
    await fileTypeWordingMigration.up(db)
    expect(await wording(db)).toEqual({ type: 'A content file', body: null })
    expect(fileTypeWordingMigration).toMatchObject({ kind: 'expand', release: '0.85.0' })
  })
})
