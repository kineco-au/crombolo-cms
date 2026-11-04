/**
 * Story 260: the site's stylesheets and scripts, and the scripts the server
 * generates, at addresses that change with their content: kept for a year at
 * the hashed address, asked again each time at the plain one, and nothing at a
 * hash that is no longer the file's.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import {
  contentHash,
  FORM_SCRIPT,
  FORM_SCRIPT_PATH,
  hashedAddress,
  ISLAND_LOADER_ADDRESS,
  splitHashedAddress,
} from '@crombolo/render'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

const PAGE = `import { asset } from '@crombolo/crombolo'
export default () => (
  <html><head>
    <link rel="stylesheet" href={asset('/css/site.css')} />
    <script type="module" src={asset('/crombolo/forms.js')}></script>
    <link rel="preload" href={asset('/css/missing.css')} />
  </head><body><h1>Home</h1></body></html>
)
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'hashed-assets-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components', 'css/parts', 'scripts'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), PAGE)
  writeFileSync(join(root, 'css', 'site.css'), 'body { color: red }\n')
  writeFileSync(join(root, 'css', 'parts', 'nav.css'), 'nav { color: blue }\n')
  writeFileSync(join(root, 'scripts', 'site.js'), 'console.log(1)\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
    },
  })
  open.push(h)
  const visit = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${path}`, { headers }))
  return { h, root, visit }
}

async function publishHome(h: Harness) {
  const created = await h.post(`${V1}/document`, {
    documentType: { id: (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key },
    template: { id: (await new ComponentRepository(h.server.db).byAlias('page'))?.key },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  const key = created.headers.get('umb-generated-resource') as string
  expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(200)
}

const control = (response: Response) => response.headers.get('cache-control')

describe('the site’s stylesheets and scripts', () => {
  test('are kept for a year at the address that names their content', async () => {
    const { visit } = await site()
    const hash = contentHash('body { color: red }\n')
    const kept = await visit(`/css/site.${hash}.css`)
    expect(kept.status).toBe(200)
    expect(control(kept)).toBe('public, max-age=31536000, immutable')
    expect(await kept.text()).toBe('body { color: red }\n')
    const nested = await visit(`/css/parts/nav.${contentHash('nav { color: blue }\n')}.css`)
    expect(nested.status).toBe(200)
    const script = await visit(`/scripts/site.${contentHash('console.log(1)\n')}.js`)
    expect(control(script)).toBe('public, max-age=31536000, immutable')
  })

  test('answer nothing, kept by nobody, at a hash that is not the file’s', async () => {
    const { visit } = await site()
    const stale = await visit('/css/site.00000000.css')
    expect(stale.status).toBe(404)
    expect(control(stale)).toBe('no-store')
  })

  test('are asked for again at the plain address, with an ETag', async () => {
    const { visit } = await site()
    const plain = await visit('/css/site.css')
    expect(control(plain)).toBe('no-cache')
    const etag = plain.headers.get('etag') as string
    expect(etag).toStartWith('W/"')
    const again = await visit('/css/site.css', { 'if-none-match': etag })
    expect(again.status).toBe(304)
  })

  test('a template links them by asset(), whose address follows a changed file', async () => {
    const { h, root, visit } = await site()
    await publishHome(h)
    const first = await (await visit('/')).text()
    const before = hashedAddress('/css/site.css', contentHash('body { color: red }\n'))
    expect(first).toContain(`<link rel="stylesheet" href="${before}" />`)
    expect(first).toContain(`src="${hashedAddress(FORM_SCRIPT_PATH, contentHash(FORM_SCRIPT))}"`)
    // A file the site does not have keeps its plain address.
    expect(first).toContain('href="/css/missing.css"')

    writeFileSync(join(root, 'css', 'site.css'), 'body { color: green }\n')
    const after = hashedAddress('/css/site.css', contentHash('body { color: green }\n'))
    for (let tries = 0; tries < 50; tries++) {
      if ((await (await visit('/')).text()).includes(after)) break
      await Bun.sleep(20)
    }
    expect(await (await visit('/')).text()).toContain(after)
    expect((await visit(before)).status).toBe(404)
    expect((await visit(after)).status).toBe(200)
  })
})

describe('the scripts the server generates', () => {
  test('are kept for a year at their hashed address, and asked for again at the plain one', async () => {
    const { visit } = await site()
    const kept = await visit(ISLAND_LOADER_ADDRESS)
    expect(kept.status).toBe(200)
    expect(control(kept)).toBe('public, max-age=31536000, immutable')
    expect(control(await visit('/crombolo/islands.js'))).toBe('no-cache')
    const forms = await visit(hashedAddress(FORM_SCRIPT_PATH, contentHash(FORM_SCRIPT)))
    expect(await forms.text()).toBe(FORM_SCRIPT)
    const stale = await visit('/crombolo/forms.00000000.js')
    expect(stale.status).toBe(404)
    expect(control(stale)).toBe('no-store')
  })
})

describe('a hashed address', () => {
  test('puts the hash before the extension, and reads back', () => {
    expect(hashedAddress('/css/site.css', 'abcdef12')).toBe('/css/site.abcdef12.css')
    expect(hashedAddress('/css/a.b/site', 'abcdef12')).toBe('/css/a.b/site.abcdef12')
    expect(splitHashedAddress('/css/site.abcdef12.css')).toEqual({
      path: '/css/site.css',
      hash: 'abcdef12',
    })
    expect(splitHashedAddress('/css/site.css')).toBeUndefined()
    expect(contentHash('x')).toHaveLength(8)
  })
})
