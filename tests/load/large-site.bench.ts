/**
 * Stories 086 and 175's benchmark: a generated site at one of three sizes, then
 * the backoffice tree, published-cache rebuilds and their memory and queries,
 * page renders warm, cold and while a rebuild runs, and sustained and burst
 * publishing, each against its budget.
 *
 * The site is made through the repository, as a real one is: create, then
 * publish, every page in every culture. Not collected by `bun test`, nor by
 * `test:load`: `bun run test:bench` runs it, and the release pipeline runs it on
 * both dialects. A run fails only past
 * CROMBOLO_BENCH_MARGIN times a budget, so a noisy runner does not block a
 * release. CROMBOLO_BENCH_SIZE picks small, medium (the default) or large;
 * CROMBOLO_BENCH_PAGES, _MEDIA, _WIDE, _SAMPLES and _SUSTAIN_SECONDS override
 * it. docs/testing.md, "Large-site budgets".
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import { dialectUnderTest } from '../support/db.ts'
import { type Harness, ORIGIN, signedInServer, V1 } from '../support/harness.ts'

/** Story 175, decision 1: the three sizes, and what each is held to. */
const SIZES = {
  small: { pages: 1_000, cultures: 1, media: 200, wide: 200, rebuild: 1_000, memory: 100 },
  medium: { pages: 25_000, cultures: 3, media: 1_000, wide: 2_000, rebuild: 5_000, memory: 300 },
  large: {
    pages: 100_000,
    cultures: 3,
    media: 10_000,
    wide: 5_000,
    rebuild: 20_000,
    memory: 1_024,
  },
} as const
const SIZE_NAME = (Bun.env.CROMBOLO_BENCH_SIZE ?? 'medium') as keyof typeof SIZES
const SIZE = SIZES[SIZE_NAME] ?? SIZES.medium
const PAGES = Number(Bun.env.CROMBOLO_BENCH_PAGES ?? SIZE.pages)
const MEDIA = Number(Bun.env.CROMBOLO_BENCH_MEDIA ?? SIZE.media)
const WIDE = Math.min(Number(Bun.env.CROMBOLO_BENCH_WIDE ?? SIZE.wide), Math.max(PAGES - 2, 1))
const SAMPLES = Number(Bun.env.CROMBOLO_BENCH_SAMPLES ?? 50)
const MARGIN = Number(Bun.env.CROMBOLO_BENCH_MARGIN ?? 2)
/** One publish every 10 seconds, for this long: ten minutes at Large, two below it. */
const SUSTAIN_SECONDS = Number(
  Bun.env.CROMBOLO_BENCH_SUSTAIN_SECONDS ?? (SIZE_NAME === 'large' ? 600 : 120),
)
const BURST = Math.min(1_000, Math.max(1, PAGES - 2))
const CULTURES = ['en-US', 'da-DK', 'de-DE'].slice(0, SIZE.cultures)
const DEPTH = 5
const FAN_OUT = 8

/**
 * What each measurement is held to: milliseconds at the 95th percentile, MB, or
 * a count. docs/testing.md holds the same table.
 */
const BUDGETS = {
  'tree root': 100,
  'tree children': 100,
  'tree siblings': 100,
  'cache rebuild': SIZE.rebuild,
  'page render': 20,
  'render during rebuild': 20,
  'cold render after publish': SIZE.rebuild + 50,
  'cold render after unpublish': SIZE.rebuild + 50,
  'cold render after move': SIZE.rebuild + 50,
  'cache memory (MB)': SIZE.memory,
  'rebuild peak (MB)': SIZE.memory * 2,
  'rebuild queries per slice': 12,
  'renders while publishing': 20,
  'renders in a burst': 20,
} as const

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"
varies-by-culture = true

[[property]]
alias = "title"
name = "Title"
type = "textstring"
varies-by-culture = true

[[property]]
alias = "summary"
name = "Summary"
type = "textarea"
varies-by-culture = true

[[property]]
alias = "code"
name = "Code"
type = "textstring"
`

const VIEW = `export default function Page({ model, nav }) {
  return (
    <main>
      <h1>{model.text('title')}</h1>
      <p>{model.text('summary')}</p>
      <ul>{nav.children(model).slice(0, 20).map((c) => <li><a href={c.url}>{c.name}</a></li>)}</ul>
    </main>
  )
}
`

interface Made {
  key: string
  parent: string | null
  route: string
}

const p95 = (samples: number[]) =>
  [...samples].sort((a, b) => a - b)[
    Math.min(samples.length - 1, Math.floor(samples.length * 0.95))
  ] ?? 0

async function time(times: number, run: (n: number) => Promise<unknown>): Promise<number> {
  const samples: number[] = []
  for (let n = 0; n < times; n++) {
    const started = performance.now()
    await run(n)
    samples.push(performance.now() - started)
  }
  return p95(samples)
}

const results: Array<{ name: keyof typeof BUDGETS; ms: number; note?: string }> = []
const record = (name: keyof typeof BUDGETS, ms: number, note?: string) => {
  results.push({ name, ms, ...(note ? { note } : {}) })
  expect(ms, `${name}: ${ms.toFixed(1)} against a budget of ${BUDGETS[name]}`).toBeLessThan(
    BUDGETS[name] * MARGIN,
  )
}

/** The heap after a full collection, in MB. */
const heapMb = () => {
  Bun.gc(true)
  return process.memoryUsage().heapUsed / 1_048_576
}

let h: Harness
let root: string
const made: Made[] = []
let home: Made
let wide: Made
let deep: Made

/** Each page's sections, breadth first: a wide archive under home, then a fan-out to DEPTH. */
async function generate(): Promise<void> {
  const db = h.server.db
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const docs = new DocumentRepository(db, {
    nodeState: h.server.schema.nodeState,
    nodeId: h.server.config.nodeId,
  })
  const make = async (parent: Made | null, n: number): Promise<Made> => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: typeKey,
      componentKey,
      parentKey: parent?.key ?? null,
      variants: CULTURES.map((culture, i) => ({
        culture,
        segment: null,
        name: i === 0 ? `p-${n}` : `p-${n}-${culture.slice(0, 2)}`,
      })),
      values: [
        ...CULTURES.flatMap((culture) => [
          { alias: 'title', culture, segment: null, value: `Page ${n} (${culture})` },
          { alias: 'summary', culture, segment: null, value: `About page ${n}. `.repeat(8) },
        ]),
        { alias: 'code', culture: null, segment: null, value: `P${n}` },
      ],
    })
    await docs.publish(doc.key, [...CULTURES])
    const page = {
      key: doc.key,
      parent: parent?.key ?? null,
      // The first root is the site's home: its children sit at the top of the path.
      route: parent === null ? '/' : `${parent.route}p-${n}/`,
    }
    made.push(page)
    if (made.length % 2_500 === 0) console.log(`  ${made.length} pages`)
    return page
  }

  home = await make(null, 0)
  wide = await make(home, 1)
  for (let n = 0; n < WIDE && made.length < PAGES; n++) await make(wide, made.length)
  let level: Made[] = [home]
  for (let depth = 1; depth < DEPTH && made.length < PAGES; depth++) {
    const next: Made[] = []
    for (const parent of level)
      for (let n = 0; n < FAN_OUT && made.length < PAGES; n++)
        next.push(await make(parent, made.length))
    level = next.length > 0 ? next : level
  }
  // What is left goes under the deepest level, spread evenly.
  for (let n = 0; made.length < PAGES; n++) await make(level[n % level.length] as Made, made.length)
  deep = level[0] as Made

  const media = new DocumentRepository(db, { kind: 'media', nodeState: h.server.schema.nodeState })
  for (let n = 0; n < MEDIA; n++)
    await media.create({
      key: crypto.randomUUID(),
      contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Image,
      componentKey: null,
      parentKey: null,
      variants: [{ culture: null, segment: null, name: `m-${n}` }],
      values: [],
    })
}

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'large-site-'))
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      // A file, as a site has: in memory, SQLite reads the snapshot on the one
      // connection, so every render would wait for a rebuild.
      sqliteFile: join(root, 'site.sqlite'),
    },
  })
  for (const iso of CULTURES.slice(1))
    expect(
      (
        await h.post(`${V1}/language`, {
          isoCode: iso,
          name: iso,
          isDefault: false,
          isMandatory: false,
          fallbackIsoCode: null,
        })
      ).status,
    ).toBe(201)
  const started = performance.now()
  await generate()
  console.log(
    `  generated ${made.length} pages in ${CULTURES.length} cultures and ${MEDIA} media on ${dialectUnderTest} in ${((performance.now() - started) / 1000).toFixed(0)} s`,
  )
}, 3_600_000)

afterAll(async () => {
  if (results.length > 0) {
    console.log(
      `\n  large-site budgets (${SIZE_NAME}: ${PAGES} pages × ${CULTURES.length}, ${dialectUnderTest}, p95 ms unless named, failing past ${MARGIN}x):`,
    )
    for (const { name, ms, note } of results)
      console.log(
        `  ${name.padEnd(28)} ${ms.toFixed(1).padStart(9)}  budget ${String(BUDGETS[name]).padStart(6)}  ${ms <= BUDGETS[name] ? 'ok' : ms < BUDGETS[name] * MARGIN ? 'over budget' : 'FAILED'}${note ? `  (${note})` : ''}`,
      )
  }
  await h?.db.close().catch(() => {})
  if (root) rmSync(root, { recursive: true, force: true })
})

describe(`a large site (${dialectUnderTest})`, () => {
  test('the tree root', async () => {
    record(
      'tree root',
      await time(SAMPLES, () => h.json(`${V1}/tree/document/root?skip=0&take=100`)),
    )
  })

  test('a page of children, from the wide section and a deep one', async () => {
    const pages = Math.max(1, Math.floor(WIDE / 100))
    record(
      'tree children',
      await time(SAMPLES, (n) =>
        h.json(
          n % 2 === 0
            ? `${V1}/tree/document/children?parentId=${wide.key}&skip=${(n % pages) * 100}&take=100`
            : `${V1}/tree/document/children?parentId=${deep.key}&skip=0&take=100`,
        ),
      ),
    )
  })

  test('the siblings around a page in the wide section', async () => {
    const archive = made.filter((page) => page.parent === wide.key)
    record(
      'tree siblings',
      await time(SAMPLES, (n) => {
        const target = archive[Math.floor((n / SAMPLES) * archive.length)] ?? archive[0]
        return h.json(`${V1}/tree/document/siblings?target=${target?.key}&before=50&after=50`)
      }),
    )
  })

  test("the published cache's memory, steady and at a rebuild's peak", async () => {
    // Nothing of the generated site is cached yet: the generation's publishes dropped it.
    const before = heapMb()
    await h.server.cache.snapshot()
    const steady = heapMb() - before
    // The old snapshot stays live while the new one builds, so the peak holds both.
    let peak = 0
    const sampler = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed / 1_048_576)
    }, 5)
    h.server.cache.invalidate()
    await h.server.cache.snapshot()
    clearInterval(sampler)
    const rss = process.memoryUsage().rss / 1_048_576
    record('cache memory (MB)', steady, `process resident ${rss.toFixed(0)} MB`)
    record('rebuild peak (MB)', Math.max(peak - before, steady))
  })

  test('a full rebuild of the published cache', async () => {
    const snapshot = await h.server.cache.snapshot()
    expect(snapshot).toBeDefined()
    record(
      'cache rebuild',
      await time(3, async () => {
        h.server.cache.invalidate()
        await h.server.cache.snapshot()
      }),
    )
  })

  test('a page render, once the cache is built', async () => {
    await h.server.cache.snapshot()
    const first = await h.server.fetch(new Request(`${ORIGIN}${made[made.length - 1]?.route}`))
    expect(first.status).toBe(200)
    record(
      'page render',
      await time(SAMPLES * 4, async (n) => {
        const page = made[(n * 7919) % made.length]
        const response = await h.server.fetch(new Request(`${ORIGIN}${page?.route ?? '/'}`))
        await response.text()
      }),
    )
  })

  test('a page render while the cache rebuilds', async () => {
    await h.server.cache.snapshot()
    // Warm, so the first render's compile is not counted as waiting on the rebuild.
    await (await h.server.fetch(new Request(`${ORIGIN}${made[0]?.route ?? '/'}`))).text()
    h.server.cache.invalidate()
    const building = h.server.cache.snapshot()
    let done = false
    void building.then(() => {
      done = true
    })
    const samples: number[] = []
    for (let n = 0; !done || samples.length < 3; n++) {
      const page = made[(n * 7919) % made.length]
      const started = performance.now()
      await (await h.server.fetch(new Request(`${ORIGIN}${page?.route ?? '/'}`))).text()
      samples.push(performance.now() - started)
      if (samples.length > 200) break
    }
    await building
    record('render during rebuild', p95(samples), `${samples.length} renders`)
  })

  test("a rebuild's queries grow with slices of 500, not with pages", async () => {
    await h.server.cache.snapshot()
    const db = h.server.db
    const original = db.readSnapshot.bind(db)
    let statements = 0
    const counting = (reader: typeof db): typeof db =>
      new Proxy(reader, {
        get(target, property, receiver) {
          if (property === 'query' || property === 'exec')
            return (...args: unknown[]) => {
              statements++
              return (target[property] as (...a: unknown[]) => unknown)(...args)
            }
          if (property === 'transaction')
            return (fn: (tx: typeof db) => unknown) =>
              target.transaction((tx) => fn(counting(tx)) as Promise<unknown>)
          return Reflect.get(target, property, receiver)
        },
      })
    db.readSnapshot = ((fn: (reader: typeof db) => Promise<unknown>) =>
      original((reader) => fn(counting(reader)))) as typeof db.readSnapshot
    try {
      h.server.cache.invalidate()
      await h.server.cache.snapshot()
    } finally {
      db.readSnapshot = original
    }
    const slices = Math.ceil((PAGES + MEDIA) / 500)
    record('rebuild queries per slice', statements / slices, `${statements} statements`)
  })

  const publishBody = { publishSchedules: CULTURES.map((culture) => ({ culture })) }
  /** The first render after a change, which waits for whatever the change dropped to be rebuilt. */
  const coldRender = async (change: (page: Made) => Promise<unknown>) => {
    const samples: number[] = []
    for (let n = 0; n < 5; n++) {
      await h.server.cache.snapshot()
      const page = made[made.length - 1 - n] as Made
      await change(page)
      const other = made[(n * 104_729) % (made.length - 10)] ?? home
      const started = performance.now()
      await (await h.server.fetch(new Request(`${ORIGIN}${other.route}`))).text()
      samples.push(performance.now() - started)
    }
    return p95(samples)
  }

  test('the first render after a publish, an unpublish and a move', async () => {
    record(
      'cold render after publish',
      await coldRender((page) => h.put(`${V1}/document/${page.key}/publish`, publishBody)),
    )
    record(
      'cold render after unpublish',
      await coldRender(async (page) => {
        await h.put(`${V1}/document/${page.key}/unpublish`, { cultures: null })
        await h.put(`${V1}/document/${page.key}/publish`, publishBody)
      }),
    )
    record(
      'cold render after move',
      await coldRender((page) =>
        h.put(`${V1}/document/${page.key}/move`, { target: { id: deep.key } }),
      ),
    )
  })

  /**
   * Visitors' renders while `publish` runs: each a random page, one after
   * another, so a render that waits on a rebuild shows in the tail.
   */
  const readingWhile = async (publish: () => Promise<void>) => {
    const samples: number[] = []
    let publishing = true
    const reading = (async () => {
      for (let n = 0; publishing; n++) {
        const page = made[(n * 7919) % made.length]
        const started = performance.now()
        await (await h.server.fetch(new Request(`${ORIGIN}${page?.route ?? '/'}`))).text()
        samples.push(performance.now() - started)
        // A visitor's request arrives over the network. Called directly, a warm
        // render resolves in microtasks alone, and the editor's timers never fire.
        await new Promise((resolve) => setImmediate(resolve))
      }
    })()
    const started = performance.now()
    await publish()
    const seconds = (performance.now() - started) / 1000
    publishing = false
    await reading
    const max = Math.max(...samples)
    return { p95: p95(samples), max, count: samples.length, seconds }
  }

  test(
    'renders while an editor publishes every ten seconds',
    async () => {
      const result = await readingWhile(async () => {
        const publishes = Math.max(1, Math.floor(SUSTAIN_SECONDS / 10))
        for (let n = 0; n < publishes; n++) {
          const page = made[(n * 31) % made.length] as Made
          await h.put(`${V1}/document/${page.key}/publish`, publishBody)
          await Bun.sleep(10_000)
        }
      })
      record(
        'renders while publishing',
        result.p95,
        `${result.count} renders over ${result.seconds.toFixed(0)} s, slowest ${result.max.toFixed(0)} ms`,
      )
    },
    (SUSTAIN_SECONDS + 600) * 1000,
  )

  test(`renders during a burst of ${BURST} publishes`, async () => {
    const result = await readingWhile(async () => {
      const pending: Promise<unknown>[] = []
      for (let n = 0; n < BURST; n++) {
        const page = made[2 + ((n * 13) % (made.length - 2))] as Made
        pending.push(h.put(`${V1}/document/${page.key}/publish`, publishBody))
        // About seventeen a second: a thousand in a minute.
        if (pending.length >= 17) {
          await Promise.all(pending.splice(0))
          await Bun.sleep(1_000)
        }
      }
      await Promise.all(pending)
    })
    record(
      'renders in a burst',
      result.p95,
      `${result.count} renders over ${result.seconds.toFixed(0)} s, slowest ${result.max.toFixed(0)} ms`,
    )
  }, 3_600_000)
})
