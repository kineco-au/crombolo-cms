/**
 * A media library of any size, made in SQL (story 197): one image is created
 * through the repository, as a real one is, and copied a batch at a time with
 * its node, content, version and file value. A million items take seconds
 * rather than the hours making each through the API would.
 */
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { type Db, DbDate, DocumentRepository, type NodeSchemaState } from '@crombolo/data'

export interface GeneratedLibrary {
  /** The folder every item sits in. */
  folder: { id: number; key: string; path: string }
  /** Keys and file addresses of a few items spread across the library. */
  samples: Array<{ key: string; url: string }>
  count: number
}

const BATCH = 50_000

/** The key of the `n`th generated item: stable, so a sample can be named without a query. */
export const generatedKey = (n: number) =>
  `7e000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
export const generatedUrl = (n: number) => `/media/generated/${n}.jpg`

export async function generateMediaLibrary(
  db: Db,
  count: number,
  options: { nodeState?: NodeSchemaState; name?: string } = {},
): Promise<GeneratedLibrary> {
  const media = new DocumentRepository(db, { kind: 'media', nodeState: options.nodeState })
  const folder = await media.create({
    key: crypto.randomUUID(),
    contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
    componentKey: null,
    parentKey: null,
    variants: [{ culture: null, segment: null, name: options.name ?? 'Observations' }],
    values: [],
  })
  const template = await media.create({
    key: crypto.randomUUID(),
    contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Image,
    componentKey: null,
    parentKey: folder.key,
    variants: [{ culture: null, segment: null, name: 'template' }],
    values: [],
  })
  const ids = await db.query<{ id: number; path: string; parent: number }>(
    'SELECT n.id, n.path, p.id AS parent FROM node n JOIN node p ON p.id = n.parent_id WHERE n.unique_id = ?',
    [template.key],
  )
  const templateId = Number(ids[0]?.id)
  const folderId = Number(ids[0]?.parent)
  const folderPath = String(ids[0]?.path).split(',').slice(0, -1).join(',')
  const type = await db.query<{ content_type_id: number }>(
    'SELECT content_type_id FROM content WHERE node_id = ?',
    [templateId],
  )
  const file = await db.query<{ id: number; schema_state_id: number | null }>(
    `SELECT pt.id, (SELECT MAX(id) FROM schema_state) AS schema_state_id
       FROM property_type pt WHERE pt.content_type_id = ? AND pt.alias = 'umbracoFile'`,
    [Number(type[0]?.content_type_id)],
  )
  // The template only lent its shape: it goes, and the library is the copies.
  await media.delete(template.key)

  const postgres = db.dialect.name === 'postgres'
  const t = db.dialect.boolValue(true)
  const f = db.dialect.boolValue(false)
  const now = DbDate.toDb(new Date())
  const hex = (column: string) =>
    postgres ? `lpad(to_hex(${column}), 12, '0')` : `printf('%012x', ${column})`
  const concat = (...parts: string[]) => parts.join(' || ')
  for (let from = 0; from < count; from += BATCH) {
    const to = Math.min(count, from + BATCH)
    const series = postgres
      ? `(SELECT generate_series(${from}, ${to - 1}) AS n) seq`
      : `(WITH RECURSIVE s(n) AS (SELECT ${from} UNION ALL SELECT n + 1 FROM s WHERE n < ${to - 1}) SELECT n FROM s) seq`
    await db.transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO node (unique_id, parent_id, level, path, sort_order, trashed, node_user, text, node_object_type, create_date)
         SELECT ${postgres ? `CAST(${concat("'7e000000-0000-4000-8000-'", hex('seq.n'))} AS uuid)` : concat("'7e000000-0000-4000-8000-'", hex('seq.n'))},
                ?, 2, '', seq.n, ?, NULL, ${concat("'photo-'", 'CAST(seq.n AS VARCHAR(12))')}, n0.node_object_type, ?
           FROM ${series}, node n0 WHERE n0.id = ?`,
        [folderId, f, now, folderId],
      )
      await tx.exec(
        `UPDATE node SET path = ${concat('?', "','", 'CAST(id AS VARCHAR(12))')}
          WHERE parent_id = ? AND path = ''`,
        [folderPath, folderId],
      )
      const fresh = `SELECT id, text, sort_order FROM node WHERE parent_id = ? AND sort_order >= ? AND sort_order < ?`
      await tx.exec(
        `INSERT INTO content (node_id, content_type_id, file_url)
         SELECT f.id, ?, ${concat("'/media/generated/'", 'CAST(f.sort_order AS VARCHAR(12))', "'.jpg'")} FROM (${fresh}) f`,
        [Number(type[0]?.content_type_id), folderId, from, to],
      )
      await tx.exec(
        `INSERT INTO document (node_id, published, edited) SELECT f.id, ?, ? FROM (${fresh}) f`,
        [f, t, folderId, from, to],
      )
      await tx.exec(
        `INSERT INTO content_version (node_id, kind, version_date, user_id, current, text, prevent_cleanup)
         SELECT f.id, 'save', ?, NULL, ?, f.text, ? FROM (${fresh}) f`,
        [now, t, f, folderId, from, to],
      )
      await tx.exec(
        `INSERT INTO document_version (id, template_id, published)
         SELECT cv.id, NULL, ? FROM content_version cv JOIN (${fresh}) f ON f.id = cv.node_id`,
        [f, folderId, from, to],
      )
      await tx.exec(
        `INSERT INTO property_value (node_id, property_type_id, language_id, segment, event_id, schema_state_id, is_current, text_value, sortable_value)
         SELECT cv.node_id, ?, NULL, NULL, cv.id, ?, ?,
                ${concat(`'{"src":"/media/generated/'`, 'CAST(f.sort_order AS VARCHAR(12))', `'.jpg","crops":[],"focalPoint":null}'`)}, NULL
           FROM content_version cv JOIN (${fresh}) f ON f.id = cv.node_id`,
        [Number(file[0]?.id), file[0]?.schema_state_id ?? null, t, folderId, from, to],
      )
    })
  }
  await db.exec('ANALYZE')
  const picks = [0, Math.floor(count / 3), Math.floor(count / 2), count - 1].filter((n) => n >= 0)
  return {
    folder: { id: folderId, key: folder.key, path: folderPath },
    samples: [...new Set(picks)].map((n) => ({ key: generatedKey(n), url: generatedUrl(n) })),
    count,
  }
}
