import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_MEDIA_MEMBER_UPLOADS } from './media-member-uploads.ts'

export const STATE_MEDIA_MEMBER_GRANTS = '{4b198f00-0053-4ca8-bc39-97d92fca0053}'

export const mediaMemberGrantsMigration: Migration = {
  from: STATE_MEDIA_MEMBER_UPLOADS,
  to: STATE_MEDIA_MEMBER_GRANTS,
  name: 'AddMediaMemberGrants',
  kind: 'expand',
  release: '0.36.0',
  async up(db: Db) {
    const t = db.dialect.types
    await db.exec(`CREATE TABLE media_access_member (
      media_access_id ${t.integer} NOT NULL REFERENCES media_access (id) ON DELETE CASCADE,
      member_key ${t.uuid} NOT NULL,
      can_read ${t.boolean} NOT NULL,
      can_write ${t.boolean} NOT NULL,
      PRIMARY KEY (media_access_id, member_key)
    )`)
  },
}
