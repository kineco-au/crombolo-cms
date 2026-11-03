/**
 * Story 197's benchmark: a media library of a million items, made in SQL, then
 * a server boots on it, renders a page using some of it, serves a file, pages
 * the Delivery API's media, and takes 10,000 uploads while pages are served,
 * none of which rebuilds the page snapshot. Timed against the budgets in
 * docs/testing.md, "Media at scale".
 *
 * Collected only by `bun run test:bench`, as `large-site.bench.ts` is.
 * CROMBOLO_BENCH_LIBRARY and CROMBOLO_BENCH_UPLOADS scale it: locally, run it
 * small. A run fails only past CROMBOLO_BENCH_MARGIN times a budget.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { dialectUnderTest } from '../support/db.ts'
import { type Harness, signedInServer, V1 } from '../support/harness.ts'
import {
  type GeneratedLibrary,
  generatedKey,
  generateMediaLibrary,
} from '../support/media-library.ts'

const LIBRARY = Number(Bun.env.CROMBOLO_BENCH_LIBRARY ?? 1_000_000)
const UPLOADS = Number(Bun.env.CROMBOLO_BENCH_UPLOADS ?? 10_000)
const MARGIN = Number(Bun.env.CROMBOLO_BENCH_MARGIN ?? 2)

/** Milliseconds; memory in megabytes. docs/testing.md holds the same table. */
const BUDGETS = {
  'snapshot build': 1_000,
  'first page render': 500,
  'page render': 50,
  'file served': 50,
  'media page, near the end': dialectUnderTest === 'postgres' ? 2_000 : 1_000,
  'heap growth while serving (MB)': 200,
  // The Media section (story 246).
  'tree, first page': 200,
  'tree, last page': dialectUnderTest === 'postgres' ? 2_000 : 1_000,
  'tree opened at a file near the end': 500,
  'folder view, first page': 500,
  'folder view, last page': dialectUnderTest === 'postgres' ? 2_000 : 1_000,
  'folder view, filtered': 1_500,
  'folder view, sorted by name': 3_000,
  search: 1_500,
  'move a 100,000-item folder': dialectUnderTest === 'postgres' ? 3_000 : 1_000,
  'trash a 100,000-item folder, answered': 1_000,
  'trash a 100,000-item folder, done': dialectUnderTest === 'postgres' ? 15_000 : 5_000,
  'empty the bin of it, done': dialectUnderTest === 'postgres' ? 60_000 : 10_000,
} as const

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

const record = (name: keyof typeof BUDGETS, value: number) => {
  console.log(`  ${name.padEnd(34)} ${value.toFixed(1).padStart(9)}  budget ${BUDGETS[name]}`)
  expect(value, `${name}: ${value.toFixed(1)} against ${BUDGETS[name]}`).toBeLessThan(
    BUDGETS[name] * MARGIN,
  )
}

const timed = async (run: () => Promise<unknown>) => {
  const started = performance.now()
  await run()
  return performance.now() - started
}

const heapMb = () => {
  Bun.gc(true)
  return process.memoryUsage().heapUsed / 1024 / 1024
}

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'media-library-'))
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
      deliveryApi: { enabled: true, media: { enabled: true } },
    },
  })
  const started = performance.now()
  library = await generateMediaLibrary(h.server.db, LIBRARY, {
    nodeState: h.server.schema.nodeState,
  })
  console.log(
    `  generated ${LIBRARY.toLocaleString('en')} items in ${((performance.now() - started) / 1000).toFixed(1)} s (${dialectUnderTest})`,
  )
  for (const sample of library.samples) writeFileSync(join(root, sample.url.slice(1)), 'jpeg')
}, 3_600_000)

afterAll(async () => {
  await h?.db.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

describe(`a library of ${LIBRARY.toLocaleString('en')} media items (${dialectUnderTest})`, () => {
  test('boots, renders, serves a file and pages the Delivery API within budget', async () => {
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [
        {
          alias: 'photos',
          culture: null,
          segment: null,
          value: library.samples.map((s) => ({ key: crypto.randomUUID(), mediaKey: s.key })),
        },
      ],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    const key = created.headers.get('umb-generated-resource') as string
    await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })

    const heapBefore = heapMb()
    h.server.cache.invalidate()
    record('snapshot build', await timed(() => h.server.cache.fresh()))
    h.server.cache.media?.clear()
    record('first page render', await timed(() => h.call('/').then((r) => r.text())))
    const html = await (await h.call('/')).text()
    for (const sample of library.samples) expect(html).toContain(sample.url)
    const renders: number[] = []
    for (let n = 0; n < 20; n++) renders.push(await timed(() => h.call('/').then((r) => r.text())))
    record('page render', renders.sort((a, b) => a - b)[18] ?? 0)
    record(
      'file served',
      await timed(async () =>
        expect((await h.call(library.samples[1]?.url as string)).status).toBe(200),
      ),
    )
    record(
      'media page, near the end',
      await timed(async () => {
        const response = await h.call(
          `/umbraco/delivery/api/v2/media?fetch=children:/observations&skip=${LIBRARY - 10}&take=10`,
        )
        const page = (await response.json()) as { total: number; items: unknown[] }
        expect(page.total).toBe(LIBRARY)
        expect(page.items).toHaveLength(10)
      }),
    )
    record('heap growth while serving (MB)', heapMb() - heapBefore)
  }, 600_000)

  test('the Media section answers within budget (story 246)', async () => {
    const folder = library.folder.key
    const tree = (skip: number) =>
      h.json<{ total: number; items: unknown[] }>(
        `${V1}/tree/media/children?parentId=${folder}&skip=${skip}&take=100`,
      )
    record(
      'tree, first page',
      await timed(async () => expect((await tree(0)).items).toHaveLength(100)),
    )
    const lastSkip = Math.floor((LIBRARY - 1) / 100) * 100
    record(
      'tree, last page',
      await timed(async () => expect((await tree(lastSkip)).items.length).toBeGreaterThan(0)),
    )
    record(
      'tree opened at a file near the end',
      await timed(async () => {
        const response = await h.call(
          `${V1}/tree/media/siblings?target=${generatedKey(LIBRARY - 10)}&before=50&after=50`,
        )
        expect(response.status).toBe(200)
      }),
    )
    const view = (query: string) =>
      h.json<{ total: number; items: unknown[] }>(`${V1}/collection/media?id=${folder}&${query}`)
    record(
      'folder view, first page',
      await timed(async () => expect((await view('skip=0&take=50')).items).toHaveLength(50)),
    )
    const viewLast = Math.floor((LIBRARY - 1) / 50) * 50
    record(
      'folder view, last page',
      await timed(async () =>
        expect((await view(`skip=${viewLast}&take=50`)).items.length).toBeGreaterThan(0),
      ),
    )
    record(
      'folder view, filtered',
      await timed(async () =>
        expect((await view(`filter=photo-${LIBRARY - 7}&skip=0&take=50`)).total).toBeGreaterThan(0),
      ),
    )
    record(
      'folder view, sorted by name',
      await timed(async () =>
        expect(
          (await view('orderBy=name&orderDirection=Descending&skip=0&take=50')).items,
        ).toHaveLength(50),
      ),
    )
    record(
      'search',
      await timed(async () => {
        const response = await h.call(
          `${V1}/item/media/search?query=photo-${LIBRARY - 123}&skip=0&take=20`,
        )
        expect(response.status).toBe(200)
      }),
    )
  }, 600_000)

  test('a 100,000-item folder moves, and is trashed and emptied in the background (story 246)', async () => {
    const big = await generateMediaLibrary(h.server.db, 100_000, {
      nodeState: h.server.schema.nodeState,
      name: 'Imports',
      keyOffset: 10_000_000,
    })
    const target = await generateMediaLibrary(h.server.db, 1, {
      nodeState: h.server.schema.nodeState,
      name: 'Archive',
      keyOffset: 20_000_000,
    })
    record(
      'move a 100,000-item folder',
      await timed(async () => {
        const moved = await h.put(`${V1}/media/${big.folder.key}/move`, {
          target: { id: target.folder.key },
        })
        expect(moved.status).toBe(200)
        while ((await h.server.backgroundJobs.runDue()) > 0) {}
      }),
    )
    let job: string | null = null
    record(
      'trash a 100,000-item folder, answered',
      await timed(async () => {
        const trashed = await h.put(`${V1}/media/${big.folder.key}/move-to-recycle-bin`, {})
        expect(trashed.status).toBe(200)
        job = trashed.headers.get('crombolo-job')
      }),
    )
    expect(job).toBeTruthy()
    record(
      'trash a 100,000-item folder, done',
      await timed(async () => {
        while ((await h.server.backgroundJobs.runDue()) > 0) {}
      }),
    )
    record(
      'empty the bin of it, done',
      await timed(async () => {
        expect((await h.del(`${V1}/recycle-bin/media`)).status).toBe(200)
        while ((await h.server.backgroundJobs.runDue()) > 0) {}
      }),
    )
  }, 1_800_000)

  test(`${UPLOADS.toLocaleString('en')} uploads while pages are served rebuild no page snapshot`, async () => {
    await h.call('/')
    const built = h.server.cache.served()?.builtAt
    let serving = true
    const pages = (async () => {
      let rendered = 0
      while (serving) {
        expect((await h.call('/')).status).toBe(200)
        rendered += 1
        // A render from the cache never leaves the microtask queue: yield, so the uploads run.
        await Bun.sleep(1)
      }
      return rendered
    })()
    const png = await Bun.file(join(import.meta.dir, '..', 'fixtures', 'pixel.png')).bytes()
    const started = performance.now()
    for (let n = 0; n < UPLOADS; n++) {
      const id = crypto.randomUUID()
      const form = new FormData()
      form.set('Id', id)
      form.set('File', new File([png], `upload-${n}.png`))
      await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })
      const made = await h.post(`${V1}/media`, {
        mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Image },
        parent: { id: library.folder.key },
        values: [
          {
            alias: 'umbracoFile',
            culture: null,
            segment: null,
            value: { src: '', temporaryFileId: id, crops: [], focalPoint: null },
          },
        ],
        variants: [{ culture: null, segment: null, name: `upload-${n}` }],
      })
      expect(made.status).toBe(201)
      if (n % 1_000 === 999) await h.server.poll()
    }
    serving = false
    const rendered = await pages
    await h.server.poll()
    console.log(
      `  ${UPLOADS} uploads in ${((performance.now() - started) / 1000).toFixed(1)} s, ${rendered} pages served meanwhile`,
    )
    expect(h.server.cache.served()?.builtAt).toBe(built)
    const stats = h.server.cache.media?.stats()
    if (stats && stats.items > 0)
      console.log(
        `  media cache: ${stats.items} item(s), ${(stats.bytes / 1024 / 1024).toFixed(1)} MB, about ${Math.round(stats.bytes / stats.items)} bytes each`,
      )
  }, 3_600_000)
})
