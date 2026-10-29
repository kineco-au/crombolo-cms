/**
 * Story 206: pages with the site's own logic. Outcomes thrown at depth answer
 * their status through the configured status pages or a generic one; the
 * request is read through `searchParams`, `cookies()` and `headers()`, which
 * make the page personal; route segment config, folder templates, metadata and
 * preview.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import type { CromboloConfig } from '@crombolo/server'
import { listComponents, unresolvedStatusPages } from '@crombolo/server'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

const COMPONENTS = [
  'page',
  'status',
  'broken',
  'static',
  'dynamic',
  'hourly',
  'forever',
  'meta',
  'folder',
]

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = [${COMPONENTS.map((c) => `"${c}"`).join(', ')}]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const VIEWS: Record<string, string> = {
  'page.tsx': `import { cookies, headers } from '@crombolo/crombolo/headers'
import * as nav from '@crombolo/crombolo/navigation'
import { site } from '@crombolo/crombolo/server'
import { usePage } from '@crombolo/crombolo'

async function Deep({ command }) {
  await new Promise((resolve) => setTimeout(resolve, 1))
  const [verb, arg = ''] = command.split('|')
  switch (verb) {
    case 'unprocessableContent':
      return nav.unprocessableContent([{ field: 'species', message: 'Choose a species' }], arg)
    case 'badRequest':
    case 'forbidden':
    case 'unauthorized':
    case 'notFound':
    case 'gone':
    case 'redirect':
    case 'permanentRedirect':
    case 'foundAt':
    case 'movedPermanentlyTo':
    case 'seeOther':
      return nav[verb](arg || undefined)
    case 'throw':
      throw new Error(arg)
    case 'rethrown':
      try {
        nav.notFound('caught and passed on')
      } catch (error) {
        nav.rethrow(error)
        return 'swallowed'
      }
      return 'unreachable'
    case 'kept':
      try {
        throw new Error('mine')
      } catch (error) {
        nav.rethrow(error)
        return 'kept going'
      }
    case 'query':
      return JSON.stringify(await usePage().searchParams)
    case 'cookies':
      return (await cookies()).get('flavour')?.value ?? 'none'
    case 'headers':
      return (await headers()).get('x-test') ?? 'none'
    case 'media':
      return (await site().media.get(arg)).match({ ok: (m) => m.name, 404: () => 'no media' })
    case 'sql':
      return (await site().sql.records('x')).unwrap()
    default:
      return command
  }
}

export default function Page({ model }) {
  return <main><Deep command={model.text('title')} /></main>
}
`,
  'status.tsx': `import { usePage } from '@crombolo/crombolo'
export default function Status({ model }) {
  const { outcome } = usePage()
  return (
    <main>
      <h1>{model.name}</h1>
      <p class="status">{outcome?.status}</p>
      <p class="name">{outcome?.name}</p>
      <p class="message">{outcome?.message ?? ''}</p>
      <ul>{(outcome?.errors ?? []).map((e) => <li>{e.field}: {e.message}</li>)}</ul>
      <p class="reference">{outcome?.reference ?? ''}</p>
      <p class="details">{outcome?.details?.message ?? ''}</p>
    </main>
  )
}
`,
  'broken.tsx': `import { notFound } from '@crombolo/crombolo/navigation'
export default function Broken({ model }) {
  if (model.text('title') === 'outcome') notFound('from the status page')
  throw new Error('the status page itself failed')
}
`,
  'static.tsx': `import { cookies } from '@crombolo/crombolo/headers'
import { usePage } from '@crombolo/crombolo'
export const dynamic = 'force-static'
export default async function Static({ member }) {
  const flavour = (await cookies()).get('flavour')?.value ?? 'none'
  const query = JSON.stringify(await usePage().searchParams)
  return <main>{flavour} {query} {member ? 'member' : 'nobody'}</main>
}
`,
  'dynamic.tsx': `export const dynamic = 'force-dynamic'
export default () => <main>always fresh</main>
`,
  'hourly.tsx': `export const revalidate = 120
export default () => <main>two minutes</main>
`,
  'forever.tsx': `export const revalidate = false
export default () => <main>until it changes</main>
`,
  'meta.tsx': `import { SeoHead } from '@crombolo/crombolo'
export async function generateMetadata({ searchParams }) {
  const { species } = await searchParams
  return {
    title: \`My records: \${species}\`,
    description: 'Records by species',
    alternates: { canonical: '/records' },
    robots: { index: false },
  }
}
export default (props) => <html><head><SeoHead {...props} /></head><body>meta</body></html>
`,
  'folder/page.tsx': `import { Part } from './part.tsx'
export default () => <main><Part /></main>
`,
  'folder/part.tsx': `export const Part = () => <b>from the folder</b>
`,
}

interface Site {
  h: Harness
  root: string
  make: (name: string, title: string, component?: string) => Promise<string>
  visit: (path: string, headers?: Record<string, string>) => Promise<Response>
}

const sites: Site[] = []

async function boot(config: Partial<CromboloConfig> = {}): Promise<Site> {
  const root = mkdtempSync(join(process.cwd(), 'output', 'page-logic-'))
  for (const dir of ['schema/content-types', 'components/folder'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  for (const [file, source] of Object.entries(VIEWS))
    writeFileSync(join(root, 'components', file), source)
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      cache: { maxAge: 60 },
      ...config,
    },
  })
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const components = new ComponentRepository(db)
  let home: string | null = null
  const make = async (name: string, title: string, component = 'page') => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: typeKey,
      componentKey: (await components.byAlias(component))?.key as string,
      parentKey: home,
      variants: [{ culture: null, segment: null, name }],
      values: [{ alias: 'title', culture: null, segment: null, value: title }],
    })
    await docs.publish(doc.key, null)
    h.server.cache.invalidate()
    home ??= doc.key
    return doc.key
  }
  await make('Home', 'home')
  const visit = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${path}`, { headers, redirect: 'manual' }))
  const site = { h, root, make, visit }
  sites.push(site)
  return site
}

afterAll(async () => {
  for (const { h, root } of sites) {
    await h.db.close().catch(() => {})
    rmSync(root, { recursive: true, force: true })
  }
})

const control = (response: Response) => response.headers.get('cache-control')

describe('with status pages configured', () => {
  let s: Site
  beforeAll(async () => {
    s = await boot({
      pages: { notFound: '/not-found', unauthorized: '/sign-in', error: '/oops' },
      errors: { showDetails: false },
    })
    await s.make('Not found', 'nf', 'status')
    await s.make('Sign in', 'si', 'status')
    await s.make('Oops', 'oops', 'status')
  })

  test('each redirect thrown deep in a component answers its status and location', async () => {
    const cases: Array<[string, number]> = [
      ['redirect', 307],
      ['permanentRedirect', 308],
      ['foundAt', 302],
      ['movedPermanentlyTo', 301],
      ['seeOther', 303],
    ]
    for (const [verb, status] of cases) {
      await s.make(`to-${verb}`, `${verb}|/sign-in?from=${verb}`)
      const response = await s.visit(`/to-${verb.toLowerCase()}`)
      expect([verb, response.status]).toEqual([verb, status])
      expect(response.headers.get('location')).toBe(`/sign-in?from=${verb}`)
    }
  })

  test('a refusal renders its status page at the address asked for, with the outcome', async () => {
    await s.make('Missing', 'notFound|No records for that species')
    const missing = await s.visit('/missing')
    expect(missing.status).toBe(404)
    const html = await missing.text()
    expect(html).toContain('<h1>Not found</h1>')
    expect(html).toContain('<p class="message">No records for that species</p>')
    expect(html).toContain('<p class="name">notFound</p>')

    await s.make('Members', 'unauthorized|Sign in to see your records')
    const members = await s.visit('/members')
    expect(members.status).toBe(401)
    expect(await members.text()).toContain('<h1>Sign in</h1>')

    for (const [verb, status] of [
      ['forbidden', 403],
      ['badRequest', 400],
      ['gone', 410],
    ] as const) {
      await s.make(`refuse-${verb}`, `${verb}|Said by ${verb}`)
      const response = await s.visit(`/refuse-${verb.toLowerCase()}`)
      expect([verb, response.status]).toEqual([verb, status])
      const body = await response.text()
      expect(body).toContain('<h1>Oops</h1>')
      expect(body).toContain(`Said by ${verb}`)
    }

    await s.make('Invalid', 'unprocessableContent|Check the form')
    const invalid = await s.visit('/invalid')
    expect(invalid.status).toBe(422)
    expect(await invalid.text()).toContain('<li>species: Choose a species</li>')
  })

  test('an address nothing answers renders pages.notFound', async () => {
    const response = await s.visit('/no-such-page')
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('<h1>Not found</h1>')
  })

  test('rethrow passes an outcome through and lets other errors be handled', async () => {
    await s.make('Rethrown', 'rethrown')
    const rethrown = await s.visit('/rethrown')
    expect(rethrown.status).toBe(404)
    expect(await rethrown.text()).toContain('caught and passed on')
    await s.make('Kept', 'kept')
    expect(await (await s.visit('/kept')).text()).toContain('kept going')
  })

  test('an unsafe redirect is a template error, not a redirect', async () => {
    await s.make('Unsafe', 'redirect|//evil.example')
    const response = await s.visit('/unsafe')
    expect(response.status).toBe(500)
    expect(response.headers.get('location')).toBeNull()
  })

  test('a server error renders the error page with a reference and no details', async () => {
    await s.make('Broken page', 'throw|database password is hunter2')
    const response = await s.visit('/broken-page')
    expect(response.status).toBe(500)
    expect(control(response)).toBe('private, no-store')
    const html = await response.text()
    expect(html).toContain('<h1>Oops</h1>')
    expect(html).toContain('<p class="status">500</p>')
    expect(html).toMatch(/<p class="reference">[0-9A-F]{10}<\/p>/)
    expect(html).not.toContain('hunter2')
  })

  test('site().sql is a slot that answers notFound until it is filled', async () => {
    await s.make('Sql', 'sql')
    const response = await s.visit('/sql')
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('is not available on this site')
  })

  test('site().media answers notFound for media that does not exist', async () => {
    await s.make('Media', `media|${crypto.randomUUID()}`)
    expect(await (await s.visit('/media')).text()).toContain('no media')
  })
})

describe('without status pages', () => {
  let s: Site
  beforeAll(async () => {
    s = await boot({ errors: { showDetails: true } })
  })

  test('an outcome falls back to a generic page for its status', async () => {
    await s.make('Gone', 'gone|This survey has closed')
    const response = await s.visit('/gone')
    expect(response.status).toBe(410)
    const html = await response.text()
    expect(html).toContain('This page is no longer available')
    expect(html).toContain('This survey has closed')
  })

  test('an address nothing answers keeps the plain 404', async () => {
    const response = await s.visit('/no-such-page')
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not Found')
  })

  test('with details shown, a server error names its message and template line', async () => {
    await s.make('Broken', 'throw|kaboom')
    const response = await s.visit('/broken')
    expect(response.status).toBe(500)
    const html = await response.text()
    expect(html).toContain('Something went wrong')
    expect(html).toContain('kaboom')
    expect(html).toMatch(/components\/page\.tsx:\d+/)
    expect(html).toContain('Reference:')
  })
})

describe('status pages that cannot answer', () => {
  test('a path that resolves to nothing falls back to the generic page, and the boot can say so', async () => {
    const s = await boot({ pages: { notFound: '/nowhere', error: '/failing' } })
    await s.make('Failing', 'fails', 'broken')
    expect(await unresolvedStatusPages(s.h.server.cache, s.h.server.config.pages)).toEqual([
      { kind: 'notFound', path: '/nowhere' },
    ])
    await s.make('Missing', 'notFound|Nothing here')
    const missing = await s.visit('/missing')
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('Page not found')
    // The error page itself throws: the generic page answers, once.
    await s.make('Forbidden', 'forbidden|Not yours')
    const forbidden = await s.visit('/forbidden')
    expect(forbidden.status).toBe(403)
    expect(await forbidden.text()).toContain('You do not have access to this page')
  })

  test('a status page that throws an outcome does not loop', async () => {
    const s = await boot({ pages: { notFound: '/loop' } })
    await s.make('Loop', 'outcome', 'broken')
    const response = await s.visit('/no-such-page')
    expect(response.status).toBe(404)
    expect(await response.text()).toContain('Page not found')
  })

  test('rules pick a page per hostname, the most specific winning', async () => {
    const s = await boot({
      pages: {
        notFound: [
          { path: '/general' },
          { path: '/for-this-host', host: 'localhost' },
          { path: '/for-another', host: 'example.com' },
        ],
      },
    })
    await s.make('General', 'g', 'status')
    await s.make('For this host', 'h', 'status')
    await s.make('For another', 'a', 'status')
    expect(await (await s.visit('/nothing')).text()).toContain('<h1>For this host</h1>')
  })
})

describe('caching', () => {
  let s: Site
  beforeAll(async () => {
    s = await boot()
  })

  test('a page that reads nothing personal is kept as configured', async () => {
    await s.make('Plain', 'plain')
    expect(control(await s.visit('/plain'))).toBe('public, max-age=60')
  })

  test('awaiting searchParams, cookies() or headers() makes it personal', async () => {
    await s.make('Query', 'query')
    const query = await s.visit('/query?species=oak&tag=a&tag=b')
    expect(control(query)).toBe('private, no-store')
    expect(await query.text()).toContain(
      JSON.stringify({ species: 'oak', tag: ['a', 'b'] }).replaceAll('"', '&quot;'),
    )
    await s.make('Cookies', 'cookies')
    const cookies = await s.visit('/cookies', { cookie: 'flavour=oat%20milk; other=1' })
    expect(control(cookies)).toBe('private, no-store')
    expect(await cookies.text()).toContain('oat milk')
    await s.make('Headers', 'headers')
    const headers = await s.visit('/headers', { 'x-test': 'from the request' })
    expect(control(headers)).toBe('private, no-store')
    expect(await headers.text()).toContain('from the request')
  })

  test("force-static empties the request's values and keeps the page shareable", async () => {
    await s.make('Static', 'x', 'static')
    const response = await s.visit('/static?species=oak', { cookie: 'flavour=oat' })
    expect(control(response)).toBe('public, max-age=60')
    expect(await response.text()).toContain('none {} nobody')
  })

  test('force-dynamic is always personal; revalidate sets the lifetime', async () => {
    await s.make('Dynamic', 'x', 'dynamic')
    expect(control(await s.visit('/dynamic'))).toBe('private, no-store')
    await s.make('Hourly', 'x', 'hourly')
    expect(control(await s.visit('/hourly'))).toBe('public, max-age=120')
    await s.make('Forever', 'x', 'forever')
    expect(control(await s.visit('/forever'))).toBe('public, max-age=31536000')
  })

  test('a member is personal, and force-static renders without one', async () => {
    const renderer = s.h.server.renderer
    const member = {
      key: crypto.randomUUID(),
      name: 'Ann',
      username: 'ann',
      email: 'a@b.c',
      roles: [],
    }
    const plain = await renderer.render('/plain', 'localhost', { member })
    expect(plain.status === 'ok' && plain.personal).toBe(true)
    const shared = await renderer.render('/static', 'localhost', { member })
    expect(shared.status === 'ok' && shared.personal).toBe(false)
    expect(shared.status === 'ok' && shared.html).toContain('nobody')
  })
})

describe('templates', () => {
  let s: Site
  beforeAll(async () => {
    s = await boot()
  })

  test('a folder with page.tsx is found under the folder alias, partials beside it', async () => {
    await s.make('Folder', 'x', 'folder')
    expect(await (await s.visit('/folder')).text()).toContain('<b>from the folder</b>')
    const aliases = listComponents(join(s.root, 'components')).map((c) => c.alias)
    expect(aliases).toContain('folder')
    expect(aliases).toContain('folder/part')
    expect(aliases).not.toContain('folder/page')
  })

  test('generateMetadata is laid over the page in <SeoHead>', async () => {
    await s.make('Meta', 'x', 'meta')
    const html = await (await s.visit('/meta?species=oak')).text()
    expect(html).toContain('<title>My records: oak</title>')
    expect(html).toContain('<meta name="description" content="Records by species" />')
    expect(html).toContain('<link rel="canonical" href="http://localhost/records" />')
    expect(html).toContain('<meta name="robots" content="noindex" />')
  })

  test('cookies() outside a page render throws naming itself', async () => {
    const { cookies } = await import('@crombolo/crombolo/headers')
    expect(cookies()).rejects.toThrow('cookies() can only be called while a page is rendering')
  })
})

describe('preview', () => {
  test('a redirect shows the editor a notice instead of navigating the frame', async () => {
    const s = await boot()
    const key = await s.make('Moving', 'foundAt|/elsewhere')
    const response = await s.visit(`/${key}`, { cookie: `${s.h.cookie()}; UMB_PREVIEW=preview` })
    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    const html = await response.text()
    expect(html).toContain('This page redirects')
    expect(html).toContain('/elsewhere')
    expect(html).toContain('302 Found')
  })
})
