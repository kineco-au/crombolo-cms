/**
 * Migration 063: what a search provider must forget (story 273). Deleting a
 * page, media item or member for good takes its database index rows with it,
 * but a provider that is not the database has to be told. A row is written in
 * the delete's own transaction and taken by the indexer once every provider
 * has removed the item. docs/search.md, "Providers".
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { sql } from '../query.ts'
import { STATE_MEDIA_TREE_ORDER } from './media-tree-order.ts'

export const STATE_SEARCH_REMOVALS = '{c3e7a512-0063-4f0b-9d61-a8b2c4e60063}'

export const searchRemovalsMigration: Migration = {
  from: STATE_MEDIA_TREE_ORDER,
  to: STATE_SEARCH_REMOVALS,
  name: 'AddSearchRemovals',
  kind: 'expand',
  release: '0.48.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.q.schema
      .createTable('search_removal')
      .addColumn('id', sql.raw(t.identity))
      .addColumn('node_id', sql.raw(t.integer), (c) => c.notNull())
      .addColumn('node_key', sql.raw(t.text), (c) => c.notNull())
      .addColumn('kind', sql.raw(t.text), (c) => c.notNull())
      .addColumn('removed_at', sql.raw(t.timestamp), (c) => c.notNull())
      .execute()
  },
}
