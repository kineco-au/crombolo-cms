/**
 * Migration 059: forms in the Library (story 239). A content type made from a
 * form names it, and an entry names the Library form it came through.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_BUNDLE_SCHEMA_PICKS } from './bundle-schema-picks.ts'

export const STATE_FORM_LIBRARY = '{4b198f00-0059-4ca8-bc39-97d92fca0059}'

export const formLibraryMigration: Migration = {
  from: STATE_BUNDLE_SCHEMA_PICKS,
  to: STATE_FORM_LIBRARY,
  name: 'AddFormLibrary',
  kind: 'expand',
  release: '0.44.0',
  async up(db: Db) {
    const ops = schemaOps(db)
    const text = db.dialect.types.text
    await ops.addColumn('content_type', 'form_key', text)
    await ops.addColumn('form_entry', 'library_key', text)
    await ops.addIndex('ix_form_entry_library', 'form_entry', ['form_key', 'library_key'])
  },
}
