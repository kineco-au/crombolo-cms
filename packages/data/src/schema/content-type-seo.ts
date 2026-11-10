/**
 * Migration 070 — where a content type's search and sharing values come from
 * (story 317): its `[seo]` table, kept as JSON beside the type.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_TRUSTED_SIGNERS } from './trusted-signers.ts'

export const STATE_CONTENT_TYPE_SEO = '{7c3e15d2-0070-4a96-b2e8-5f1d0c9a7070}'

export const contentTypeSeoMigration: Migration = {
  from: STATE_TRUSTED_SIGNERS,
  to: STATE_CONTENT_TYPE_SEO,
  name: 'AddContentTypeSeo',
  kind: 'expand',
  release: '0.58.0',
  async up(db: Db) {
    await schemaOps(db).addColumn('content_type', 'seo', db.dialect.types.text)
  },
}
