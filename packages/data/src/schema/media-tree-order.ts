/**
 * Migration 062: the Media tree, folders first (story 246). `node.tree_group` is
 * 0 for a media folder and 1 for everything else, and an index pages a folder's
 * children in that order, then by sort order, so a folder of a million files
 * lists its sub-folders before them without sorting the folder in full.
 */
import { ObjectTypes, SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { schemaOps } from '../schema-ops.ts'
import { STATE_REMOTE_TRUST } from './remote-trust.ts'

export const STATE_MEDIA_TREE_ORDER = '{c3e7a512-0062-4f0b-9d61-a8b2c4e60062}'

/** A media folder's `tree_group`: it comes before the files beside it. */
export const TREE_GROUP_FOLDER = 0
/** Everything else's. */
export const TREE_GROUP_ITEM = 1

export const mediaTreeOrderMigration: Migration = {
  from: STATE_REMOTE_TRUST,
  to: STATE_MEDIA_TREE_ORDER,
  name: 'AddMediaTreeOrder',
  kind: 'expand',
  release: '0.46.0',
  async up(db: Db) {
    await schemaOps(db).addColumn(
      'node',
      'tree_group',
      `${db.dialect.types.integer} NOT NULL DEFAULT ${TREE_GROUP_ITEM}`,
    )
    const folderType = db.q
      .selectFrom('node')
      .select('id')
      .where('unique_id', '=', SYSTEM_MEDIA_TYPE_KEYS.Folder)
    await db.q
      .updateTable('node')
      .set({ tree_group: TREE_GROUP_FOLDER })
      .where('node_object_type', '=', ObjectTypes.Media)
      .where(
        'id',
        'in',
        db.q.selectFrom('content').select('node_id').where('content_type_id', 'in', folderType),
      )
      .execute()
    await schemaOps(db).addIndex('ix_node_parent_tree', 'node', [
      'parent_id',
      'node_object_type',
      'trashed',
      'tree_group',
      'sort_order',
      'id',
    ])
  },
}
