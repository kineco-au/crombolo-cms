/**
 * Migration 052 — what members may upload into a media folder (story 198).
 *
 * A rule on a folder names the file types a member may upload below it, as a
 * comma-separated list of type names (`jpeg,png,webp`; null or empty is none),
 * and an optional size limit in bytes. Both follow the rule: inherited
 * downwards, and replaced by a nearer one.
 */
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_MEDIA_CACHE } from './media-cache.ts'

export const STATE_MEDIA_MEMBER_UPLOADS = '{4e9a2c17-0052-4b6d-8f3e-7a1c5d9b2e52}'

export const mediaMemberUploadsMigration: Migration = {
  from: STATE_MEDIA_CACHE,
  to: STATE_MEDIA_MEMBER_UPLOADS,
  name: 'AddMediaMemberUploads',
  kind: 'expand',
  release: '0.35.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.exec(`ALTER TABLE media_access ADD COLUMN member_types ${t.text}`)
    await db.exec(`ALTER TABLE media_access ADD COLUMN member_max_bytes ${t.bigint}`)
  },
}
