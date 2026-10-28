/**
 * Story 197 at scale, small enough for every run: a library generated in SQL
 * (20,000 items unless CROMBOLO_MEDIA_SCALE_ITEMS says otherwise) behind one
 * page. The page snapshot does not grow with it, media is read by indexed
 * queries — held to that by the query planner rather than a stopwatch — the
 * media cache stays within its budget, and the Delivery API pages it in the
 * database. `tests/load/media-library.bench.ts` runs the million-item version.
 * docs/testing.md, "Media at scale".
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ObjectTypes } from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  type Db,
  MediaListingRepository,
} from '@crombolo/data'
import { PublishedCache } from '@crombolo/render'
import { createMediaSource, createPublishedContentSource } from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'
import {
  type GeneratedLibrary,
  generatedKey,
  generatedUrl,
  generateMediaLibrary,
} from './support/media-library.ts'

const ITEMS = Number(Bun.env.CROMBOLO_MEDIA_SCALE_ITEMS ?? 20_000)

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "photos"
name = "Photos"
type = "multipleMediaPicker"
`

const VIEW = `export default async function Page({ model }) {
  const photos = await model.media('photos')
  return <main>{photos.map((p) => <img src={p.url} alt={p.name} />)}</main>
}
`

let h: Harness
let root: string
let library: GeneratedLibrary

/** Every statement `run` makes, with its parameters. */
async function statementsOf(db: Db, run: (db: Db) => Promise<unknown>) {
  const seen: Array<{ sql: string; params: unknown[] }> = []
  const watched: Db = {
    ...db,
    query: (sql, params) => {
      seen.push({ sql, params: params ?? [] })
      return db.query(sql, params)
    },
    exec: (sql, params) => db.exec(sql, params),
    transaction: (fn) => db.transaction(fn),
    readSnapshot: (fn) => db.readSnapshot(fn),
  }
  await run(watched)
  return seen
}

/** What the planner would do: a whole-table scan of a large table is the failure. */
async function fullScans(db: Db, sql: string, params: unknown[]): Promise<string[]> {
  if (db.dialect.name === 'postgres') {
    const plan = await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${sql}`, params)
    return plan
      .map((row) => String(Object.values(row)[0]))
      .filter((line) => /Seq Scan on (node|content|content_version|property_value)\b/.test(line))
  }
  const plan = await db.query<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, params)
  return plan
    .map((row) => String(row.detail))
    .filter((detail) =>
      /^SCAN (n|c|head|cv|pv|v|node|content|content_version|property_value)\b/.test(detail),
    )
}

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'media-scale-'))
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  mkdirSync(join(root, 'media', 'generated'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      mediaCacheMegabytes: 1,
      deliveryApi: { enabled: true, media: { enabled: true } },
    },
  })
  library = await generateMediaLibrary(h.server.db, ITEMS, { nodeState: h.server.schema.nodeState })
  for (const sample of library.samples) writeFileSync(join(root, sample.url.slice(1)), 'jpeg bytes')
}, 300_000)

afterAll(async () => {
  await h?.db.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

describe(`a library of ${ITEMS.toLocaleString('en')} media items (${dialectUnderTest})`, () => {
  test('the page snapshot reads none of it', async () => {
    const statements = await statementsOf(h.server.db, async (db) => {
      const snapshot = await new PublishedCache(createPublishedContentSource(db)).snapshot()
      expect('media' in snapshot).toBe(false)
    })
    const media = statements.filter(
      (s) => /FROM node/.test(s.sql) && s.params.includes(ObjectTypes.Media),
    )
    expect(media).toEqual([])
  })

  test('media is read by key and by address through indexes', async () => {
    const source = (db: Db) => createMediaSource(db, { nodeState: h.server.schema.nodeState })
    const reads = await statementsOf(h.server.db, async (db) => {
      expect((await source(db).loadMediaByKeys([generatedKey(7)]))[0]?.name).toBe('photo-7')
      expect((await source(db).loadMediaByUrls([generatedUrl(9)]))[0]?.key).toBe(generatedKey(9))
    })
    for (const read of reads)
      expect([read.sql, await fullScans(h.server.db, read.sql, read.params)]).toEqual([
        read.sql,
        [],
      ])
  })

  test('a page renders the items it picks, and a file is served, by indexed lookups', async () => {
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
    const picked = library.samples.slice(0, 3)
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [
        {
          alias: 'photos',
          culture: null,
          segment: null,
          value: picked.map((s) => ({ key: crypto.randomUUID(), mediaKey: s.key })),
        },
      ],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    const key = created.headers.get('umb-generated-resource') as string
    await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
    const html = await (await h.call('/')).text()
    for (const sample of picked) expect(html).toContain(`src="${sample.url}"`)
    const file = await h.call(library.samples[0]?.url as string)
    expect(file.status).toBe(200)
    expect(await file.text()).toBe('jpeg bytes')
  })

  test('the media cache stays within its budget however much is read', async () => {
    const media = h.server.cache.media
    for (let n = 0; n < Math.min(ITEMS, 6_000); n += 500)
      await media?.byKeys(Array.from({ length: 500 }, (_, i) => generatedKey(n + i)))
    const stats = media?.stats()
    expect(stats?.budgetBytes).toBe(1024 * 1024)
    expect(stats?.bytes).toBeLessThanOrEqual(1024 * 1024)
    expect(stats?.evictions).toBeGreaterThan(0)
  })

  test('the Delivery API pages it in the database, by indexed queries', async () => {
    const skip = ITEMS - 15
    const response = await h.call(
      `/umbraco/delivery/api/v2/media?fetch=children:/observations&skip=${skip}&take=10`,
    )
    expect(response.status).toBe(200)
    const page = (await response.json()) as { total: number; items: Array<{ name: string }> }
    expect(page.total).toBe(ITEMS)
    expect(page.items.map((m) => m.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `photo-${skip + i}`),
    )
    const listing = await statementsOf(h.server.db, async (db) => {
      await new MediaListingRepository(db).children({
        parentId: library.folder.id,
        parentPath: library.folder.path,
        skip: 100,
        take: 10,
        readable: { rules: new Map(), member: undefined },
      })
    })
    const pageQuery = listing.find((s) => s.sql.includes('LIMIT'))
    expect(pageQuery).toBeDefined()
    expect(await fullScans(h.server.db, pageQuery?.sql ?? '', pageQuery?.params ?? [])).toEqual([])
  })
})
