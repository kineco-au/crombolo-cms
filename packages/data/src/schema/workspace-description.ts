/**
 * Migration 099 — what a workspace is for: a description, said when it is
 * opened and changed by its owner, beside its name.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_WORKSPACE_PLACES } from './workspace-places.ts'

export const STATE_WORKSPACE_DESCRIPTION = '{7d2c5a18-0099-4f3b-8e61-9a4b0c7d0099}'

export const workspaceDescriptionMigration: Migration = {
  from: STATE_WORKSPACE_PLACES,
  to: STATE_WORKSPACE_DESCRIPTION,
  name: 'AddWorkspaceDescription',
  kind: 'expand',
  release: '0.80.0',
  async up(db: Db) {
    await db.q.schema
      .alterTable('workspace')
      .addColumn('description', sql.raw(db.dialect.types.varchar(1000)))
      .execute()
  },
}
