/**
 * Migration 084 — what a merge needs that a workspace did not keep (story 380):
 * whether it is open or merged, and when and by whom; each page's published
 * state, and each language's, when the workspace first changed it; and where a
 * page stood when a move, reorder or delete of it was recorded, so a merge can
 * tell what Shared did since. A marker a Shared delete leaves keeps the page's
 * name, since its node is gone. A person's own workspace, which
 * `workspaces.required` opens for them, is marked as theirs.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_CONTENT_PLACES } from './content-places.ts'

export const STATE_WORKSPACE_MERGE = '{6b1d7e42-0084-4f9a-8c3e-2d5f0a7b0084}'

/** The columns the migration adds, by table, for a rewind to drop. */
export const WORKSPACE_MERGE_COLUMNS: ReadonlyArray<{ table: string; columns: readonly string[] }> =
  [
    { table: 'workspace', columns: ['state', 'merged_at', 'merged_by', 'personal'] },
    { table: 'workspace_document', columns: ['base_published'] },
    { table: 'workspace_document_culture', columns: ['base_published', 'base_published_event_id'] },
    {
      table: 'workspace_pending',
      columns: ['base_parent_id', 'base_sort_order', 'base_event_id', 'name'],
    },
  ]

export const workspaceMergeMigration: Migration = {
  from: STATE_CONTENT_PLACES,
  to: STATE_WORKSPACE_MERGE,
  name: 'AddWorkspaceMerge',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    const add = async (table: string, column: string, type: string, notNullDefault?: string) => {
      await db.q.schema
        .alterTable(table)
        .addColumn(column, sql.raw(type), (c) =>
          notNullDefault === undefined ? c : c.notNull().defaultTo(sql.raw(notNullDefault)),
        )
        .execute()
    }
    await add('workspace', 'state', t.varchar(16), "'open'")
    await add('workspace', 'merged_at', t.timestamp)
    await add('workspace', 'merged_by', t.uuid)
    // A person's own unnamed workspace, where `workspaces.required` puts their edits.
    await add('workspace', 'personal', t.boolean, db.dialect.name === 'postgres' ? 'false' : '0')
    await add('workspace_document', 'base_published', t.boolean)
    await add('workspace_document_culture', 'base_published', t.boolean)
    await add('workspace_document_culture', 'base_published_event_id', t.integer)
    await add('workspace_pending', 'base_parent_id', t.integer)
    await add('workspace_pending', 'base_sort_order', t.integer)
    await add('workspace_pending', 'base_event_id', t.integer)
    await add('workspace_pending', 'name', t.varchar(255))
  },
}
