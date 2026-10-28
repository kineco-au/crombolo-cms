/**
 * Migration 050 — who may read and change media (story 196).
 *
 * `media_access` is a rule on a media folder or item, one per node, with the
 * defaults a folder gives files created below it; `media_access_rule` names a
 * member group and whether it may read and write. Each media item's own
 * settings are columns on `content`, so millions of files cost no rule rows:
 * the member who created it, its read and write policies, and `file_url`, the
 * `/media/…` path its file is served at, indexed so a request finds its item.
 * Existing items get their `file_url` here, and keep following the rules.
 *
 * `node_file` lists the files anything else's upload values name — a page's
 * attachment — so that `/media/…` serves only files something owns.
 */
import { ObjectTypes } from '@crombolo/core'
import type { Db } from '../database.ts'
import type { Migration } from '../migrations.ts'
import { STATE_CONTENT_APPLIED } from './content-applied.ts'

export const STATE_MEDIA_ACCESS = '{2b7e9c41-0050-4d8a-a3f6-1e5c8b9d7a50}'

export const mediaAccessMigration: Migration = {
  from: STATE_CONTENT_APPLIED,
  to: STATE_MEDIA_ACCESS,
  name: 'AddMediaAccess',
  kind: 'expand',
  release: '0.35.0',
  async up(db: Db) {
    const t = db.dialect.types

    await db.exec(
      `CREATE TABLE media_access (
         id ${t.identity},
         node_id ${t.integer} NOT NULL REFERENCES node (id),
         public_read ${t.boolean} NOT NULL,
         new_read ${t.varchar(10)},
         new_write ${t.varchar(10)},
         create_date ${t.timestamp} NOT NULL,
         update_date ${t.timestamp} NOT NULL
       )`,
    )
    await db.exec('CREATE UNIQUE INDEX ux_media_access_node ON media_access (node_id)')
    await db.exec(
      `CREATE TABLE media_access_rule (
         id ${t.identity},
         media_access_id ${t.integer} NOT NULL REFERENCES media_access (id),
         member_group ${t.textCi} NOT NULL,
         can_read ${t.boolean} NOT NULL,
         can_write ${t.boolean} NOT NULL
       )`,
    )
    await db.exec(
      'CREATE UNIQUE INDEX ux_media_access_rule ON media_access_rule (media_access_id, member_group)',
    )

    await db.exec(`ALTER TABLE content ADD COLUMN file_url ${t.text}`)
    await db.exec(`ALTER TABLE content ADD COLUMN creator_member_key ${t.uuid}`)
    await db.exec(`ALTER TABLE content ADD COLUMN read_policy ${t.varchar(10)}`)
    await db.exec(`ALTER TABLE content ADD COLUMN write_policy ${t.varchar(10)}`)
    await db.exec('CREATE INDEX ix_content_file_url ON content (file_url)')

    // Each item's file from its current `umbracoFile` value: a cropper's JSON
    // `src`, or an upload's path. In SQL, so the step stays plannable.
    const src =
      db.dialect.name === 'postgres'
        ? `CASE WHEN v.text_value LIKE '{%'
             THEN substring(v.text_value from '"src"\\s*:\\s*"([^"]*)"')
             ELSE COALESCE(v.text_value, v.varchar_value) END`
        : `CASE WHEN json_valid(v.text_value) AND json_type(v.text_value) = 'object'
             THEN json_extract(v.text_value, '$.src')
             ELSE COALESCE(v.text_value, v.varchar_value) END`
    await db.exec(
      `UPDATE content SET file_url = (
         SELECT NULLIF(${src}, '')
           FROM property_value v JOIN property_type p ON p.id = v.property_type_id
          WHERE v.node_id = content.node_id AND p.alias = 'umbracoFile' AND v.is_current = ?
          ORDER BY v.id DESC LIMIT 1)
       WHERE node_id IN (SELECT id FROM node WHERE node_object_type = ?)`,
      [db.dialect.boolValue(true), ObjectTypes.Media],
    )

    // The files anything else's upload values name — a page's attachment —
    // which are served as before.
    await db.exec(
      `CREATE TABLE node_file (
         node_id ${t.integer} NOT NULL REFERENCES node (id),
         url ${t.text} NOT NULL
       )`,
    )
    await db.exec('CREATE INDEX ix_node_file_url ON node_file (url)')
    await db.exec('CREATE INDEX ix_node_file_node ON node_file (node_id)')
    await db.exec(
      `INSERT INTO node_file (node_id, url)
       SELECT DISTINCT node_id, url FROM (
         SELECT v.node_id, NULLIF(${src}, '') AS url
           FROM property_value v
           JOIN property_type p ON p.id = v.property_type_id
           JOIN data_type d ON d.node_id = p.data_type_id
           JOIN node n ON n.id = v.node_id
          WHERE d.editor_alias IN ('Umbraco.UploadField', 'Umbraco.ImageCropper')
            AND v.is_current = ? AND n.node_object_type <> ?) files
       WHERE url IS NOT NULL`,
      [db.dialect.boolValue(true), ObjectTypes.Media],
    )
  },
}
