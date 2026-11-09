/**
 * Migration 065 — a transfer run records what kind of bundle it applied (story
 * 306): a site package, which `site revert` puts back, or an extension's
 * content, which uninstalling it does. Nullable: a run before this one was
 * never asked.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_IMAGE_ALT_TEXT } from './image-alt-text.ts'

export const STATE_TRANSFER_RUN_BUNDLE_TYPE = '{c3e7a512-0065-4f0b-9d61-a8b2c4e60065}'

export const transferRunBundleTypeMigration: Migration = {
  from: STATE_IMAGE_ALT_TEXT,
  to: STATE_TRANSFER_RUN_BUNDLE_TYPE,
  name: 'AddTransferRunBundleType',
  kind: 'expand',
  release: '0.57.0',
  async up(db: Db) {
    await schemaOps(db).addColumn(
      'content_transfer_run',
      'bundle_type',
      db.dialect.types.varchar(16),
    )
  },
}
