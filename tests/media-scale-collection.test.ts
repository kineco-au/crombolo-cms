/**
 * Story 246, the Media section's folder view at scale: a library generated in
 * SQL (20,000 items unless CROMBOLO_MEDIA_SCALE_ITEMS says otherwise), paged,
 * filtered and sorted in the database. Held to the query planner, as story 197's
 * `tests/media-scale.test.ts` is, so it cannot slide back into reading the folder.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { MediaListingRepository, type MediaSortField } from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'
import { type GeneratedLibrary, generateMediaLibrary } from './support/media-library.ts'
import { fullScans, statementsOf } from './support/query-plans.ts'

const ITEMS = Number(Bun.env.CROMBOLO_MEDIA_SCALE_ITEMS ?? 20_000)

let h: Harness
let root: string
let library: GeneratedLibrary

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'media-scale-collection-'))
  h = await signedInServer({ config: { mediaDir: join(root, 'media') } })
  library = await generateMediaLibrary(h.server.db, ITEMS, { nodeState: h.server.schema.nodeState })
}, 300_000)

afterAll(async () => {
  await h?.db.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

type Page = { total: number; items: Array<{ variants: Array<{ name: string }> }> }

/** The folder view's answer, and how long it took. */
async function view(query: string): Promise<{ page: Page; ms: number }> {
  const started = performance.now()
  const page = await h.json<Page>(`${V1}/collection/media?id=${library.folder.key}&${query}`)
  return { page, ms: performance.now() - started }
}

/** The listing's statements for one page, each held to no whole-table scan. */
async function scansFor(query: {
  names?: string[]
  sort?: { field: MediaSortField; ascending: boolean }
  skip: number
}) {
  const statements = await statementsOf(h.server.db, (db) =>
    new MediaListingRepository(db).children({
      parentId: library.folder.id,
      parentPath: library.folder.path,
      take: 50,
      ...query,
    }),
  )
  expect(statements.length).toBeGreaterThan(0)
  const scans: string[] = []
  for (const statement of statements)
    scans.push(
      ...(await fullScans(h.server.db, statement.sql, statement.params, { indexable: true })),
    )
  return scans
}

describe(`the folder view of ${ITEMS.toLocaleString('en')} media items (${dialectUnderTest})`, () => {
  test('its first page, by indexed queries', async () => {
    const { page, ms } = await view('skip=0&take=50')
    expect(page.total).toBe(ITEMS)
    expect(page.items).toHaveLength(50)
    expect(page.items[0]?.variants[0]?.name).toBe('photo-0')
    console.log(`  first page: ${ms.toFixed(1)} ms`)
    expect(await scansFor({ skip: 0 })).toEqual([])
  })

  test('a page near the end, by indexed queries', async () => {
    const skip = ITEMS - 20
    const { page, ms } = await view(`skip=${skip}&take=20`)
    expect(page.total).toBe(ITEMS)
    expect(page.items.map((i) => i.variants[0]?.name)).toEqual(
      Array.from({ length: 20 }, (_, i) => `photo-${skip + i}`),
    )
    console.log(`  page near the end: ${ms.toFixed(1)} ms`)
    expect(await scansFor({ skip })).toEqual([])
  })

  test('a filter, counted and paged in the database', async () => {
    const { page, ms } = await view('filter=photo-1999&orderBy=name&skip=0&take=50')
    // photo-1999 and photo-19990…19999 where the library is large enough.
    const expected = ITEMS > 19_999 ? 11 : ITEMS > 1_999 ? 1 : 0
    expect(page.total).toBe(expected)
    console.log(`  filter: ${ms.toFixed(1)} ms`)
    expect(await scansFor({ names: ['photo-1999'], skip: 0 })).toEqual([])
  })

  test('a sort by name, in the database', async () => {
    const { page, ms } = await view('orderBy=name&orderDirection=Descending&skip=0&take=50')
    expect(page.total).toBe(ITEMS)
    const names = page.items.map((i) => i.variants[0]?.name ?? '')
    expect(names).toEqual([...names].sort().reverse())
    console.log(`  sort by name: ${ms.toFixed(1)} ms`)
    expect(await scansFor({ sort: { field: 'name', ascending: false }, skip: 0 })).toEqual([])
  })
})
