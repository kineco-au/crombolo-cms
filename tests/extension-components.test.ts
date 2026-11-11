/**
 * Story 312: an extension's components render in its own process. The page, its
 * layouts and the site's components render in the CMS; a component the extension
 * owns, as a page's template, a block or an `<Extension use>` embed, renders in
 * the extension and its HTML goes in its place.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { type CromboloConfig, componentsWritten, RUN_BACKUP_DIR } from '@crombolo/server'
import { siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

/** A brochure page template that reads its page over the channel, and a card to embed. */
const EXTENSION = {
  'index.js': `import * as brochure from './components/brochure.jsx'
import Card from './components/card.jsx'
import Broken from './components/broken.jsx'
import Hostile from './components/hostile.jsx'

export function brochures() {
  return {
    id: 'brochures',
    section: 'content',
    capabilities: [],
    components: { brochure, card: Card, broken: Broken, hostile: Hostile },
  }
}
`,
  'components/broken.jsx': `export default function Broken() {
  throw new Error('it broke')
}
`,
  'components/brochure.jsx': `export const layout = 'shared/layout'

export default async function Brochure({ model, nav }) {
  const children = await nav.children(model)
  return (
    <article class="brochure">
      <h1>{model.text('title')}</h1>
      <p class="pid">{String(typeof Deno !== 'undefined')}</p>
      <span class="children">{children.length}</span>
      <em>{model.hasValue('title') ? model.value('title').toUpperCase() : 'untitled'}</em>
    </article>
  )
}
`,
  'components/hostile.jsx': `export default function Hostile() {
  return (
    <section class="hostile" style="color: red">
      <script>{'window.stolen = document.cookie'}</script>
      <button onclick="steal()">Press</button>
      <a href="javascript:steal()">Go</a>
      <img src="/x.png" onerror="steal()" alt="x" />
      <iframe src="https://evil.example"></iframe>
      <svg><script>{'steal()'}</script><a href="javascript:steal()">s</a></svg>
    </section>
  )
}
`,
  'components/card.jsx': `export default function Card({ heading, children }) {
  return <aside class="card"><b>{heading}</b>{children}</aside>
}
`,
}

const BROCHURE_TOML = `[content-type]
alias = "brochure"
name = "Brochure"
allow-at-root = true
components = ["brochures/brochure"]
default-component = "brochures/brochure"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

const LAYOUT = `export default function Layout({ children }) {
  return <html><body><header>The site</header>{children}</body></html>
}
`

const PAGE = `import { Extension } from '@crombolo/crombolo'

export const layout = 'shared/layout'

export default function Page() {
  return (
    <main>
      <button onclick="site()">The sites own</button>
      <Extension use="brochures/hostile" />
      <Extension use="brochures/card" heading="Hello"><i>inside</i></Extension>
      <Extension use="brochures/broken" />
    </main>
  )
}
`

const PLAIN = `export default function Plain({ children }) {
  return <html><body><header>Plain</header>{children}</body></html>
}
`

async function brochureSite(grant: string[] = ['templates'], entry: Record<string, unknown> = {}) {
  const dir = siteDeclaring('extension-components', {
    '@acme/brochures': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'brochures',
          name: 'Brochures',
          server: 'brochures',
          permissions: { templates: 'Renders brochure pages and cards' },
          settings: {
            layout: {
              label: 'The layout its pages sit in',
              type: 'layout',
              default: 'shared/layout',
            },
          },
        },
      },
      files: EXTENSION,
    },
  })
  mkdirSync(join(dir, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(dir, 'components', 'shared'), { recursive: true })
  writeFileSync(join(dir, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(dir, 'schema', 'content-types', 'brochure.toml'), BROCHURE_TOML)
  writeFileSync(join(dir, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(dir, 'components', 'shared', 'layout.tsx'), LAYOUT)
  writeFileSync(join(dir, 'components', 'shared', 'plain.tsx'), PLAIN)
  writeFileSync(join(dir, 'components', 'page.tsx'), PAGE)
  const h = await signedInServer({
    config: {
      siteDir: dir,
      schemaDir: join(dir, 'schema'),
      componentsDir: join(dir, 'components'),
      extensions: { brochures: { grant, ...entry } },
    },
  })
  open.push(h)
  const publish = async (type: string, component: string, name: string, title?: string) => {
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias(type))?.key as string
    const componentKey = (await new ComponentRepository(h.server.db).byAlias(component))
      ?.key as string
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      parent: null,
      template: { id: componentKey },
      values: title ? [{ alias: 'title', culture: null, segment: null, value: title }] : [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (created.status !== 201) throw new Error(`create ${created.status}: ${await created.text()}`)
    const key = created.headers.get('umb-generated-resource') as string
    const published = await h.put(`${V1}/document/${key}/publish`, {
      publishSchedules: [{ culture: null }],
    })
    if (published.status !== 200) throw new Error(`publish ${published.status}`)
    return key
  }
  return { h, publish }
}

describe('an extension’s components', () => {
  test('a page template renders in its process, inside the site’s layout', async () => {
    const { h, publish } = await brochureSite()
    await publish('brochure', 'brochures/brochure', 'Spring', 'Spring range')
    const html = await (await h.call('/')).text()
    expect(html).toContain('<header>The site</header>')
    expect(html).toContain('<h1>Spring range</h1>')
    // It ran under Deno, not here.
    expect(html).toContain('<p class="pid">true</p>')
    expect(html).toContain('<span class="children">0</span>')
    // Its values came with it, so it reads them as a site component does.
    expect(html).toContain('<em>SPRING RANGE</em>')
  }, 60_000)

  test('an embed renders its HTML in a site component, children and all', async () => {
    const { h, publish } = await brochureSite()
    await publish('page', 'page', 'About')
    const html = await (await h.call('/')).text()
    expect(html).toContain('<aside class="card"><b>Hello</b><i>inside</i></aside>')
  }, 60_000)

  test('one that throws renders nothing in its place, and the page renders', async () => {
    const { h, publish } = await brochureSite()
    await publish('page', 'page', 'About')
    const response = await h.call('/')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('</aside></main>')
  }, 60_000)

  test('its page templates sit in the layout its setting names', async () => {
    const { h, publish } = await brochureSite(['templates'], {
      settings: { layout: 'shared/plain' },
    })
    await publish('brochure', 'brochures/brochure', 'Spring', 'Spring range')
    const html = await (await h.call('/')).text()
    expect(html).toContain('<header>Plain</header>')
    expect(html).toContain('<h1>Spring range</h1>')
  }, 60_000)

  test('its layout setting offers the site’s layouts, and refuses one the site has not got', async () => {
    const { h } = await brochureSite()
    const listed = await h.json<{
      items: { id: string; settings?: { key: string; values?: string[]; value: unknown }[] }[]
    }>(`${BACKOFFICE}/crombolo/api/bundles/installed`)
    const setting = listed.items
      .find((item) => item.id === 'brochures')
      ?.settings?.find((candidate) => candidate.key === 'layout')
    expect(setting?.values).toEqual(['page', 'shared/layout', 'shared/plain'])
    expect(setting?.value).toBe('shared/layout')
    const refused = await h.post(`${BACKOFFICE}/crombolo/api/bundles/settings`, {
      id: 'brochures',
      values: { layout: 'shared/nowhere' },
    })
    expect(refused.status).toBe(400)
    const saved = await h.post(`${BACKOFFICE}/crombolo/api/bundles/settings`, {
      id: 'brochures',
      values: { layout: 'shared/plain' },
    })
    expect(saved.status).toBe(200)
  }, 60_000)

  test('without templates, it renders nothing, and the page still does', async () => {
    const { h, publish } = await brochureSite([])
    await publish('page', 'page', 'About')
    const response = await h.call('/')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('<main><button onclick="site()">The sites own</button></main>')
  }, 60_000)

  test('the template picker lists them under the extension’s name', async () => {
    const { h } = await brochureSite()
    const listed = await h.json<{ items: { alias: string; extension?: string }[] }>(
      `${BACKOFFICE}/crombolo/api/templates`,
    )
    expect(listed.items).toContainEqual(
      expect.objectContaining({ alias: 'brochures/card', extension: 'Brochures' }),
    )
  }, 60_000)
})

describe('an extension’s components cannot', () => {
  test('carry script into the page: the Sanitizer API’s safe baseline takes it out (story 330)', async () => {
    const { h, publish } = await brochureSite()
    await publish('page', 'page', 'About')
    const html = await (await h.call('/')).text()
    const hostile = html.slice(
      html.indexOf('<section class="hostile"'),
      html.indexOf('</section>') + 10,
    )
    expect(hostile).toContain('<section class="hostile" style="color: red">')
    expect(hostile).toContain('<button>Press</button>')
    expect(hostile).toContain('<a>Go</a>')
    expect(hostile).toContain('<img src="/x.png" alt="x"')
    expect(hostile).not.toMatch(/<script|onclick|onerror|javascript:|<iframe/i)
    // The site's own components are the site's code, and untouched.
    expect(html).toContain('<button onclick="site()">The sites own</button>')
  }, 60_000)

  test('carry browser code: one that does is left off, saying why', async () => {
    const dir = siteDeclaring('extension-components-client', {
      '@acme/islands': {
        json: {
          exports: './index.js',
          crombolo: {
            id: 'islands',
            name: 'Islands',
            server: 'islands',
            permissions: { templates: 'Renders a counter' },
          },
        },
        files: {
          'index.js': `import Counter from './counter.jsx'\nexport function islands() { return { id: 'islands', section: 'content', capabilities: [], components: { counter: Counter } } }\n`,
          'counter.jsx': `'use client'\nexport default function Counter() { return <button>0</button> }\n`,
        },
      },
    })
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        extensions: { islands: { grant: ['templates'] } },
      },
    })
    open.push(h)
    const listed = await h.json<{ items: { id: string; couldNotStart?: string }[] }>(
      `${BACKOFFICE}/crombolo/api/bundles/installed`,
    )
    expect(listed.items.find((item) => item.id === 'islands')?.couldNotStart).toContain(
      'browser code',
    )
  }, 60_000)
})

describe('components an earlier install copied', () => {
  test('are named from the run that wrote them, to review', () => {
    const dir = siteDeclaring('extension-components-copied', {})
    const run = join(dir, RUN_BACKUP_DIR, 'run-1')
    mkdirSync(run, { recursive: true })
    writeFileSync(
      join(run, 'files.json'),
      JSON.stringify([
        { path: 'components/brochure.tsx', action: 'create' },
        { path: 'components/shared/card.tsx', action: 'overwrite' },
        { path: 'components/same.tsx', action: 'unchanged' },
        { path: 'styles/brochure.css', action: 'create' },
      ]),
    )
    const config = { siteDir: dir } as CromboloConfig
    expect(componentsWritten(config, 'run-1')).toEqual([
      'components/brochure.tsx',
      'components/shared/card.tsx',
    ])
    expect(componentsWritten(config, 'none')).toEqual([])
  })
})
