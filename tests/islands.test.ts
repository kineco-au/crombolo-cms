/**
 * Story 209: interactive islands. A `'use client'` view is a stub on the server
 * that renders a placeholder with its props; its browser code is built with the
 * generation and served immutable; the loader mounts each island when its
 * condition is met; `<Island>` mounts other frameworks; and a client module
 * importing server code is refused with both files named.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import {
  type IslandElement,
  type IslandManifest,
  IslandPropsError,
  isClientModule,
  islandLoader,
  islandStub,
  islandTransform,
  serializeProps,
  withIslandTags,
} from '@crombolo/render'
import { buildIslands, type CromboloConfig, checkComponents } from '@crombolo/server'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

describe('a client module', () => {
  test("is one whose first statement is 'use client', comments allowed before it", () => {
    expect(isClientModule("'use client'\nexport default () => null")).toBe(true)
    expect(isClientModule('"use client";\nexport const A = 1')).toBe(true)
    expect(isClientModule("// a counter\n/** @jsxImportSource react */\n'use client'\n")).toBe(true)
    expect(isClientModule("import x from 'y'\n'use client'\n")).toBe(false)
    expect(isClientModule("const s = 'use client'\n")).toBe(false)
    expect(isClientModule("'use clientele'\n")).toBe(false)
  })

  test('is written as a stub whose every export renders the island', () => {
    const stub = islandStub(
      'shared/counter.tsx',
      "'use client'\nexport default function Counter() {}\nexport const Badge = () => null\nexport type T = string\n",
    )
    expect(stub).toContain(
      'export default (props) => globalThis[Symbol.for("crombolo.island")]("shared/counter.tsx", "default", props)',
    )
    expect(stub).toContain('export const Badge = (props) =>')
    expect(stub).not.toContain('import')
    expect(
      islandTransform('pages/home.tsx', new TextEncoder().encode('export default () => null')),
    ).toBeUndefined()
    expect(islandTransform('styles.css', new TextEncoder().encode("'use client'"))).toBeUndefined()
  })
})

describe('island props', () => {
  test('are JSON that cannot close the script or read as markup', () => {
    const json = serializeProps(
      { note: '</script><script>alert(1)</script>', amp: 'a & b', line: 'x y' },
      'x',
    )
    expect(json).not.toContain('</script>')
    expect(json).not.toContain('<')
    expect(json).not.toContain('&')
    expect(json).not.toContain(' ')
    expect(JSON.parse(json)).toEqual({
      note: '</script><script>alert(1)</script>',
      amp: 'a & b',
      line: 'x y',
    })
  })

  test('refuse what JSON cannot carry, naming the prop', () => {
    const refused = (props: Record<string, unknown>) => {
      try {
        serializeProps(props, 'shared/counter.tsx')
      } catch (error) {
        expect(error).toBeInstanceOf(IslandPropsError)
        return (error as Error).message
      }
      return 'accepted'
    }
    expect(refused({ items: [1, { onPick: () => 1 }] })).toContain(
      'props.items[1].onPick is a function',
    )
    expect(refused({ when: new Date() })).toContain('props.when is a Date')
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(refused({ cycle })).toContain('props.cycle.self refers back to itself')
    expect(refused({ n: Number.NaN })).toContain('props.n is NaN')
    expect(refused({ fine: [1, 'a', null, { b: true }], skipped: undefined })).toBe('accepted')
  })
})

test('the island tags go before </body>, or at the end without one', () => {
  expect(withIslandTags('<html><body><p>x</p></body></html>', '/m.json')).toBe(
    '<html><body><p>x</p><meta name="crombolo-islands" content="/m.json"><script type="module" src="/crombolo/islands.js"></script></body></html>',
  )
  expect(withIslandTags('<p>x</p>', '/m.json')).toEndWith('src="/crombolo/islands.js"></script>')
})

/** A stand-in island element, as much of one as the loader touches. */
function fakeIsland(dataset: Record<string, string>, props: unknown, inner = '<p>shown</p>') {
  const element = {
    dataset: { ...dataset } as Record<string, string | undefined>,
    cleared: false,
    querySelector: (selector: string) =>
      selector.includes('application/json')
        ? { textContent: JSON.stringify(props), innerHTML: '' }
        : selector.includes('template') && dataset.children === 'template'
          ? { textContent: '', innerHTML: '<b>carried</b>' }
          : null,
    cloneNode: () => ({ querySelectorAll: () => [], innerHTML: inner }),
    replaceChildren() {
      element.cleared = true
    },
  }
  return element
}

describe('the loader', () => {
  test('mounts each island when its condition is met, loading a shared module once', async () => {
    const mounted: unknown[] = []
    const imported: string[] = []
    const observed: unknown[] = []
    let intersect:
      | ((entries: Array<{ isIntersecting: boolean; target: unknown }>) => void)
      | undefined
    let idle: (() => void) | undefined
    const now = fakeIsland(
      { kind: 'react', module: 'a.tsx', export: 'default', load: 'load', children: 'inline' },
      { n: 1 },
    )
    const later = fakeIsland(
      { kind: 'react', module: 'a.tsx', export: 'Other', load: 'idle', children: 'template' },
      { n: 2 },
    )
    const seen = fakeIsland(
      { kind: 'mount', module: 'client/map', export: 'default', load: 'visible', children: 'none' },
      { z: 3 },
    )
    const manifest: IslandManifest = {
      react: '/react.js',
      modules: { 'a.tsx': '/a.js', 'client/map': '/map.js' },
    }
    const A = () => null
    const Other = () => null
    islandLoader({
      document: {
        querySelector: () => ({ getAttribute: () => '/manifest.json' }),
        querySelectorAll: () => [now, later, seen] as unknown as IslandElement[],
      },
      importModule: async (url) => {
        imported.push(url)
        if (url === '/react.js')
          return {
            mount: (c: unknown, _e: unknown, p: unknown, h: unknown) => mounted.push({ c, p, h }),
          }
        if (url === '/map.js')
          return { default: (_e: unknown, p: unknown) => mounted.push({ mount: p }) }
        return { default: A, Other }
      },
      fetchJson: async () => manifest,
      IntersectionObserver: class {
        constructor(callback: typeof intersect) {
          intersect = callback
        }
        observe(target: unknown) {
          observed.push(target)
        }
        unobserve() {}
      },
      requestIdleCallback: (callback) => {
        idle = callback
      },
      setTimeout: () => 0,
      console: { error: () => {} },
    })
    await Bun.sleep(5)
    expect(mounted).toEqual([{ c: A, p: { n: 1 }, h: '<p>shown</p>' }])
    expect(observed).toEqual([seen])
    idle?.()
    await Bun.sleep(5)
    expect(mounted[1]).toEqual({ c: Other, p: { n: 2 }, h: '<b>carried</b>' })
    intersect?.([{ isIntersecting: true, target: seen }])
    await Bun.sleep(5)
    expect(mounted[2]).toEqual({ mount: { z: 3 } })
    expect(seen.cleared).toBe(true)
    expect(imported.filter((url) => url === '/a.js')).toHaveLength(1)
  })

  test('an island whose code is missing keeps its fallback and says why, alone', async () => {
    const errors: unknown[][] = []
    const broken = fakeIsland(
      { kind: 'react', module: 'gone.tsx', export: 'default', load: 'load', children: 'none' },
      {},
    )
    islandLoader({
      document: {
        querySelector: () => ({ getAttribute: () => '/manifest.json' }),
        querySelectorAll: () => [broken] as unknown as IslandElement[],
      },
      importModule: async () => ({}),
      fetchJson: async () => ({ modules: {} }),
      setTimeout: () => 0,
      console: { error: (...values) => errors.push(values) },
    })
    await Bun.sleep(5)
    expect(broken.cleared).toBe(false)
    expect(String(errors[0]?.[0])).toContain('The island gone.tsx could not load')
  })
})

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const COUNTER = `/** @jsxImportSource react */
'use client'
import { useState } from 'react'

export default function Counter({ start, children }: { start: number; children?: unknown }) {
  const [count, setCount] = useState(start)
  return <button type="button" onClick={() => setCount(count + 1)}>{count}{children as never}</button>
}

export const Tally = ({ n }: { n: number }) => <span>{n}</span>
`

const PAGE = `import Counter, { Tally } from './shared/counter.tsx'
import { Island } from '@crombolo/crombolo'

function Nested() {
  return <Tally n={7} load="load" fallback={<em>counting</em>} />
}

export default function Page({ model }) {
  return (
    <html>
      <body>
        <main>
          <Counter start={2} load="idle"><p>server child</p></Counter>
          <Nested />
          <Island name="map" props={{ zoom: 3 }} fallback={<p>Loading the map</p>} />
        </main>
      </body>
    </html>
  )
}
`

const MAP = `export default function mount(element: HTMLElement, props: { zoom: number }) {
  element.textContent = 'zoom ' + props.zoom
  return () => { element.textContent = '' }
}
`

const sites: Array<{ h: Harness; root: string }> = []
afterAll(async () => {
  for (const { h, root } of sites) {
    await h.db.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

async function site(files: Record<string, string>, config: Partial<CromboloConfig> = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'islands-'))
  for (const dir of ['schema/content-types', 'components/shared', 'components/client'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  for (const [path, text] of Object.entries(files))
    writeFileSync(join(root, 'components', path), text)
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      siteDir: root,
      ...config,
    },
  })
  sites.push({ h, root })
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const doc = await docs.create({
    key: crypto.randomUUID(),
    contentTypeKey: (await new ContentTypeRepository(db).byAlias('page'))?.key as string,
    componentKey: (await new ComponentRepository(db).byAlias('page'))?.key as string,
    parentKey: null,
    variants: [{ culture: null, segment: null, name: 'Home' }],
    values: [{ alias: 'title', culture: null, segment: null, value: 'Home' }],
  })
  await docs.publish(doc.key, null)
  h.server.cache.invalidate()
  const visit = (path: string) => h.server.fetch(new Request(`${ORIGIN}${path}`))
  return { h, root, visit }
}

describe('islands on a page', () => {
  test('render placeholders with their props, and the page links the loader once', async () => {
    const { visit } = await site({
      'page.tsx': PAGE,
      'shared/counter.tsx': COUNTER,
      'client/map.ts': MAP,
    })
    const html = await (await visit('/')).text()
    expect(html).toContain(
      '<crombolo-island data-kind="react" data-module="shared/counter.tsx" data-export="default" data-load="idle" data-children="inline"><script type="application/json">{"start":2}</script><p>server child</p></crombolo-island>',
    )
    expect(html).toContain(
      'data-module="shared/counter.tsx" data-export="Tally" data-load="load" data-children="none"><script type="application/json">{"n":7}</script><em>counting</em></crombolo-island>',
    )
    expect(html).toContain(
      '<crombolo-island data-kind="mount" data-module="client/map" data-export="default" data-load="visible" data-children="none"><script type="application/json">{"zoom":3}</script><p>Loading the map</p></crombolo-island>',
    )
    expect(html.match(/src="\/crombolo\/islands\.js"/g)).toHaveLength(1)
    expect(html).toMatch(
      /<meta name="crombolo-islands" content="\/crombolo\/islands\/[0-9a-f]{16}\/manifest\.json"><script type="module" src="\/crombolo\/islands\.js"><\/script><\/body>/,
    )
    // Nothing Crombolo writes runs inline: every script is data, or a file.
    for (const [tag] of html.matchAll(/<script[^>]*>/g))
      expect(tag.includes('type="application/json"') || tag.includes(' src=')).toBe(true)
  })

  test('their browser code is built with the generation and served for good', async () => {
    const { visit } = await site({
      'page.tsx': PAGE,
      'shared/counter.tsx': COUNTER,
      'client/map.ts': MAP,
    })
    const html = await (await visit('/')).text()
    const manifestUrl = /content="(\/crombolo\/islands\/[0-9a-f]{16}\/manifest\.json)"/.exec(
      html,
    )?.[1] as string
    const response = await visit(manifestUrl)
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const manifest = (await response.json()) as IslandManifest
    expect(Object.keys(manifest.modules).sort()).toEqual(['client/map', 'shared/counter.tsx'])
    const counter = await visit(manifest.modules['shared/counter.tsx'] as string)
    expect(counter.status).toBe(200)
    expect(counter.headers.get('content-type')).toContain('javascript')
    expect(await counter.text()).not.toContain('crombolo.island')
    expect((await visit(manifest.react as string)).status).toBe(200)
    expect((await visit(manifest.modules['client/map'] as string)).status).toBe(200)
    const loader = await visit('/crombolo/islands.js')
    expect(await loader.text()).toContain('crombolo-island')
    expect((await visit(manifestUrl.replace('manifest.json', '../../etc/passwd'))).status).toBe(404)
  })

  test('a function as a prop is a template error naming it', async () => {
    const { visit } = await site({
      'page.tsx': `import Counter from './shared/counter.tsx'\nexport default () => <Counter start={1} onDone={() => 1} />\n`,
      'shared/counter.tsx': COUNTER,
    })
    const response = await visit('/')
    expect(response.status).toBe(500)
    expect(await response.text()).toContain('props.onDone is a function')
  })
})

const BAD = `'use client'
import { headers } from '@crombolo/crombolo/headers'
export default function Bad() { return null }
`

describe('the boundary', () => {
  test('a client module importing server code fails the build, naming both, and the page still renders', async () => {
    const { visit } = await site({
      'page.tsx': `import Bad from './shared/bad.tsx'\nexport default () => <main><Bad fallback={<p>later</p>} /></main>\n`,
      'shared/bad.tsx': BAD,
    })
    const response = await visit('/')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<p>later</p>')
    const manifestUrl = /content="([^"]+)"/.exec(html)?.[1] as string
    expect((await visit(manifestUrl)).status).toBe(404)
  })

  test('the build’s refusal names the component and what it imported', async () => {
    const dir = mkdtempSync(join(process.cwd(), 'output', 'islands-build-'))
    try {
      mkdirSync(join(dir, 'shared'), { recursive: true })
      mkdirSync(join(dir, '.islands', 'src', 'shared'), { recursive: true })
      writeFileSync(join(dir, 'shared', 'bad.tsx'), islandStub('shared/bad.tsx', BAD))
      writeFileSync(join(dir, '.islands', 'src', 'shared', 'bad.tsx'), BAD)
      const failed = await buildIslands({
        dir,
        hash: '0123456789abcdef',
        transformed: ['shared/bad.tsx'],
        development: true,
      }).catch((error: Error) => error.message)
      expect(failed).toBe(
        "components/shared/bad.tsx imports @crombolo/crombolo/headers, which only runs on the server. A 'use client' component cannot use it.",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('components check names the import, and never imports browser code', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'islands-check-'))
    try {
      mkdirSync(join(root, 'components', 'shared'), { recursive: true })
      mkdirSync(join(root, 'components', 'client'), { recursive: true })
      writeFileSync(join(root, 'components', 'shared', 'bad.tsx'), BAD)
      writeFileSync(
        join(root, 'components', 'client', 'map.ts'),
        `import 'a-package-nobody-installed'\n${MAP}`,
      )
      const report = await checkComponents({
        componentsDir: join(root, 'components'),
        siteDir: root,
      })
      expect(report.problems).toEqual([
        {
          file: 'components/shared/bad.tsx',
          message:
            'imports @crombolo/crombolo/headers, which only runs on the server. Code that runs in the browser cannot use it.',
        },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('a Vite build', () => {
  test('is served in place of Crombolo’s, its manifest made over by source path', async () => {
    const files = { 'page.tsx': PAGE, 'shared/counter.tsx': COUNTER, 'client/map.ts': MAP }
    const { visit, root } = await site(files, { islands: { manifest: 'dist/.vite/manifest.json' } })
    mkdirSync(join(root, 'dist', '.vite'), { recursive: true })
    mkdirSync(join(root, 'dist', 'assets'), { recursive: true })
    writeFileSync(
      join(root, 'dist', '.vite', 'manifest.json'),
      JSON.stringify({
        'components/shared/counter.tsx': {
          file: 'assets/counter-1a.js',
          src: 'components/shared/counter.tsx',
          isEntry: true,
        },
        'components/client/map.ts': {
          file: 'assets/map-2b.js',
          src: 'components/client/map.ts',
          isEntry: true,
        },
        'node_modules/@crombolo/crombolo/src/islands-react.ts': {
          file: 'assets/islands-react-3c.js',
          isEntry: true,
        },
      }),
    )
    writeFileSync(join(root, 'dist', 'assets', 'counter-1a.js'), 'export default () => null')
    const html = await (await visit('/')).text()
    expect(html).toContain('content="/crombolo/islands/vite/manifest.json"')
    expect(await (await visit('/crombolo/islands/vite/manifest.json')).json()).toEqual({
      react: '/crombolo/islands/vite/assets/islands-react-3c.js',
      modules: {
        'shared/counter.tsx': '/crombolo/islands/vite/assets/counter-1a.js',
        'client/map': '/crombolo/islands/vite/assets/map-2b.js',
      },
    })
    const asset = await visit('/crombolo/islands/vite/assets/counter-1a.js')
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect((await visit('/crombolo/islands/vite/../package.json')).status).toBe(404)
  })
})

describe("Harbourstone's comparison page", () => {
  test('the island and harbourstone-next’s Next.js copy offer the same rows', () => {
    const labels = (path: string) => {
      const source = readFileSync(join(import.meta.dir, '..', path), 'utf8')
      const start = source.indexOf('= [', source.indexOf('const FACTS'))
      const facts = source.slice(start, source.indexOf('\n]', start))
      return {
        facts: [...facts.matchAll(/label: '([^']+)'/g)].map((m) => m[1]),
        most: /export const MOST = (\d+)/.exec(source)?.[1],
        aspects: /const ASPECT_ORDER = (\[[^\]]*\])/.exec(source)?.[1],
      }
    }
    const island = labels('sites/harbourstone/components/shared/compare.tsx')
    expect(island.facts).toEqual(['Kind', 'Product type', 'ABV', 'Age', 'Batch', 'Summary'])
    expect(island.most).toBe('4')
    expect(labels('sites/harbourstone-next/web/components/compare.tsx')).toEqual(island)
    expect(
      isClientModule(
        readFileSync(
          join(import.meta.dir, '..', 'sites/harbourstone/components/shared/compare.tsx'),
          'utf8',
        ),
      ),
    ).toBe(true)
  })
})
