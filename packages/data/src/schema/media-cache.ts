/**
 * Migration 051 — indexes for media read a page at a time (story 197).
 *
 * The Delivery API's media listing pages a folder's children in the database,
 * ordered by sort order then id, so a folder of a million files is read ten at
 * a time rather than sorted in full. A server that missed changes reads the
 * cache instructions after its checkpoint, by checkpoint.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_MEDIA_ACCESS } from './media-access.ts'

export const STATE_MEDIA_CACHE = '{8d3f1a62-0051-4c7e-b9a4-2f6e1d8c5b51}'

export const mediaCacheMigration: Migration = {
  from: STATE_MEDIA_ACCESS,
  to: STATE_MEDIA_CACHE,
  name: 'AddMediaPagingIndexes',
  kind: 'expand',
  release: '0.35.0',
  async up(db: Db) {
    await db.exec(
      'CREATE INDEX ix_node_parent_sort ON node (parent_id, node_object_type, trashed, sort_order, id)',
    )
    await db.exec('CREATE INDEX ix_cache_instruction_checkpoint ON cache_instruction (checkpoint)')
  },
}
