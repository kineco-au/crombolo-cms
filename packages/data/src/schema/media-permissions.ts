/**
 * Migration 045 — the media verbs, `Crombolo.Media.Read` and
 * `Crombolo.Media.Update` (story 088). docs/backoffice-hosting.md, "Authorization".
 *
 * Before them the Media section alone let a group change every item in it, so
 * every group that has the section — built-in or made on the site — is given
 * both, and keeps exactly the access it had. The built-in groups are also given
 * whatever else the seed grants that they lack, element verbs included.
 * Idempotent, and it never takes a verb away.
 */
import { MediaPermissions } from '@crombolo/core'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_APPROVAL_SCHEDULES } from './approval-schedules.ts'
import { grantBuiltInPermissions } from './seed.ts'

export const STATE_MEDIA_PERMISSIONS = '{8d4f2b61-0045-4c3e-9a17-5e2b7c9d1f45}'

export const mediaPermissionsMigration: Migration = {
  from: STATE_APPROVAL_SCHEDULES,
  to: STATE_MEDIA_PERMISSIONS,
  name: 'GrantMediaPermissions',
  kind: 'expand',
  release: '0.21.0',
  async up(db: Db) {
    await grantBuiltInPermissions(db)
    for (const permission of Object.values(MediaPermissions))
      await db.exec(
        `INSERT INTO user_group_permission (user_group_key, permission)
         SELECT g.key, ? FROM user_group g
         WHERE EXISTS (
           SELECT 1 FROM user_group_section s
           WHERE s.user_group_id = g.id AND LOWER(s.app_alias) IN ('media', 'umb.section.media')
         ) AND NOT EXISTS (
           SELECT 1 FROM user_group_permission p WHERE p.user_group_key = g.key AND p.permission = ?
         )`,
        [permission, permission],
      )
  },
}
