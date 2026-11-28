/**
 * Migration 108 — the File type's wording (story 450): "A content file", and no
 * description on its body, as the type now ships. A site that installed 0.84.0 has
 * the first wording, which no longer matches the built-in type.
 */
import { FILE_BODY_PROPERTY_KEY, SYSTEM_CONTENT_TYPE_KEYS } from '@crombolo/core'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_WORKSPACE_GROUPS } from './workspace-groups.ts'

export const STATE_FILE_TYPE_WORDING = '{6c1f2a94-0108-4d37-9e5b-1a7c3e8f0108}'

export const fileTypeWordingMigration: Migration = {
  from: STATE_WORKSPACE_GROUPS,
  to: STATE_FILE_TYPE_WORDING,
  name: 'FileTypeWording',
  kind: 'expand',
  release: '0.85.0',
  async up(db: Db) {
    // Every copy of the type, Shared's and a workspace's: the wording is the same.
    await db.q
      .updateTable('content_type')
      .set({ description: 'A content file' })
      .where('node_id', 'in', (eb) =>
        eb.selectFrom('node').select('id').where('unique_id', '=', SYSTEM_CONTENT_TYPE_KEYS.File),
      )
      .execute()
    await db.q
      .updateTable('property_type')
      .set({ description: null })
      .where('unique_id', '=', FILE_BODY_PROPERTY_KEY)
      .execute()
  },
}
