/**
 * Migration 082 — workspaces (story 375): pages changed apart from Shared. A
 * workspace is a row with its owner and members; a page it changes keeps the
 * Shared event it started from, and its own events and values sit in the same
 * tables as Shared's, carrying `workspace_id` (null for Shared). A page made in
 * one has a node carrying it. Moves, reorders and deletes wait as pending rows
 * until the workspace is merged (story 380).
 *
 * The added columns have no foreign key: SQLite will not drop a column one
 * names, and every test rewind drops them.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_SINGLE_USE_TOKEN } from './single-use-token.ts'

export const STATE_WORKSPACES = '{8d2f4c1a-0082-4e7b-9c3d-5a6e0f2b0082}'

/** The tables the migration adds, children first, so a rewind drops them in order. */
export const WORKSPACE_TABLES = [
  'workspace_pending',
  'workspace_document_culture',
  'workspace_document',
  'workspace_member',
  'workspace',
] as const

/** The tables that gain `workspace_id`, with the index each is given. */
export const WORKSPACE_COLUMNS = [
  { table: 'node', index: 'ix_node_workspace', columns: ['workspace_id'] },
  {
    table: 'content_version',
    index: 'ix_content_version_workspace',
    columns: ['workspace_id', 'node_id'],
  },
  {
    table: 'property_value',
    index: 'ix_property_value_workspace',
    columns: ['workspace_id', 'node_id'],
  },
  { table: 'content_schedule', index: 'ix_content_schedule_workspace', columns: ['workspace_id'] },
] as const

export const workspacesMigration: Migration = {
  from: STATE_SINGLE_USE_TOKEN,
  to: STATE_WORKSPACES,
  name: 'AddWorkspaces',
  kind: 'expand',
  release: '0.70.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('workspace')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('key', sql.raw(t.uuid), (c) => c.notNull().unique())
      .addColumn('name', sql.raw(t.varchar(255)), (c) => c.notNull())
      .addColumn('owner_key', sql.raw(t.uuid), (c) => c.notNull())
      .addColumn('created_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addColumn('updated_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_owner')
      .on('workspace')
      .column('owner_key')
      .execute()

    await db.q.schema
      .createTable('workspace_member')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull().references('workspace.id'))
      .addColumn('user_key', sql.raw(t.uuid), (c) => c.notNull())
      .addColumn('added_at', sql.raw(t.timestamp), (c) => c.notNull())
      .addPrimaryKeyConstraint('pk_workspace_member', ['workspace_id', 'user_key'])
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_member_user')
      .on('workspace_member')
      .column('user_key')
      .execute()

    // One row per page the workspace has touched: its base, and where it stands there.
    await db.q.schema
      .createTable('workspace_document')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull().references('workspace.id'))
      .addColumn('node_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('base_event_id', sql.raw(t.integer))
      .addColumn('created', sql.raw(t.boolean), (c) => c.notNull())
      .addColumn('published', sql.raw(t.boolean), (c) => c.notNull())
      .addColumn('published_event_id', sql.raw(t.integer))
      .addColumn('edited', sql.raw(t.boolean), (c) => c.notNull())
      .addPrimaryKeyConstraint('pk_workspace_document', ['workspace_id', 'node_id'])
      .execute()

    // Each language of such a page, as `document_culture_variation` holds it for Shared.
    await db.q.schema
      .createTable('workspace_document_culture')
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull().references('workspace.id'))
      .addColumn('node_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('language_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('name', sql.raw(t.varchar(255)))
      .addColumn('available', sql.raw(t.boolean), (c) => c.notNull())
      .addColumn('published', sql.raw(t.boolean), (c) => c.notNull())
      .addColumn('edited', sql.raw(t.boolean), (c) => c.notNull())
      .addColumn('published_event_id', sql.raw(t.integer))
      .addColumn('published_name', sql.raw(t.varchar(255)))
      .addPrimaryKeyConstraint('pk_workspace_document_culture', [
        'workspace_id',
        'node_id',
        'language_id',
      ])
      .execute()

    await db.q.schema
      .createTable('workspace_pending')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('workspace_id', sql.raw(t.integer), (c) => c.notNull().references('workspace.id'))
      .addColumn('node_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('kind', sql.raw(t.varchar(16)), (c) => c.notNull())
      .addColumn('target_parent_id', sql.raw(t.integer))
      .addColumn('sort_order', sql.raw(t.integer))
      .addColumn('user_id', sql.raw(t.integer))
      .addColumn('recorded_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
    await db.q.schema
      .createIndex('ix_workspace_pending_workspace')
      .on('workspace_pending')
      .columns(['workspace_id', 'node_id'])
      .execute()

    for (const { table, index, columns } of WORKSPACE_COLUMNS) {
      await db.q.schema.alterTable(table).addColumn('workspace_id', sql.raw(t.integer)).execute()
      await db.q.schema
        .createIndex(index)
        .on(table)
        .columns([...columns])
        .execute()
    }
  },
}
