/**
 * Migration 101 — a key once in Shared, and once in each workspace (story 436). An item's
 * key, `node.unique_id`, was unique across the site, so an open workspace making a page
 * held its key from every other. It is unique among Shared's items and within each
 * workspace now, by two partial indexes, with a plain one for reading by key. SQLite
 * cannot drop a column's `UNIQUE`, so `node` is rebuilt (`Db.rebuildTable`), with foreign
 * keys off for the step.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_USERS_IN_SETTINGS } from './users-in-settings.ts'

export const STATE_KEYS_PER_WORKSPACE = '{8d3a5f17-0101-4b2e-9c64-1e7f0a5b0101}'

/** The indexes that keep keys apart: one key in Shared, one per workspace, and reads by key. */
export async function addKeyIndexes(db: Db): Promise<void> {
  const schema = db.q.schema
  await schema
    .createIndex('ux_node_key_shared')
    .on('node')
    .column('unique_id')
    .unique()
    .where(sql.ref('workspace_id'), 'is', null)
    .execute()
  await schema
    .createIndex('ux_node_key_workspace')
    .on('node')
    .columns(['unique_id', 'workspace_id'])
    .unique()
    .where(sql.ref('workspace_id'), 'is not', null)
    .execute()
  await schema.createIndex('ix_node_unique_id').on('node').column('unique_id').execute()
}

/** `unique_id`'s definition in SQLite's `node`, made unique across the site or not. */
export const nodeKeyDefinition =
  (unique: boolean) =>
  (definition: string): string =>
    unique
      ? definition.replace(/(unique_id\s+\S+\s+NOT NULL)(?!\s+UNIQUE)/i, '$1 UNIQUE')
      : definition.replace(/(unique_id\s+\S+\s+NOT NULL)\s+UNIQUE/i, '$1')

export const keysPerWorkspaceMigration: Migration = {
  from: STATE_USERS_IN_SETTINGS,
  to: STATE_KEYS_PER_WORKSPACE,
  name: 'KeysPerWorkspace',
  kind: 'expand',
  release: '0.81.0',
  foreignKeysOff: true,
  async up(db: Db) {
    if (db.rebuildTable) await db.rebuildTable('node', nodeKeyDefinition(false))
    else
      await db.q.schema.alterTable('node').dropConstraint('node_unique_id_key').ifExists().execute()
    await addKeyIndexes(db)
  },
}
