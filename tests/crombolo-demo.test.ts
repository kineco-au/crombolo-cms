/**
 * Story 290: the Crombolo demo, booted from `sites/crombolo-demo` with its seed
 * and its `domains.toml`. A home page of blocks, features filtered by category,
 * people from the Library, a paged and tagged blog, search, a contact form, and
 * all of it again in Spanish at `/es`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { FORM_RENDERED_FIELD, FORM_TOKEN_FIELD } from '@crombolo/core'
import {
  buildBundleFromDirectory,
  compileSeed,
  installBundleContent,
  syncDomainsFile,
} from '@crombolo/server'
import { writeSeedPackage } from '../packages/cli/src/support/seed.ts'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

const SITE = join(import.meta.dir, '..', 'sites', 'crombolo-demo')

let h: Harness
let root: string

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'crombolo-demo-'))
  for (const part of ['schema', 'components', 'css', 'content', 'package.json', 'domains.toml'])
    cpSync(join(SITE, part), join(root, part), { recursive: true })
  h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo'),
      stylesheetsDir: join(root, 'css'),
      mediaDir: join(root, 'media'),
      deliveryApi: { enabled: true },
    },
  })
  const build = await compileSeed(h.server.db, h.server.config)
  expect(build.findings).toEqual([])
  const dir = join(root, 'seed-package')
  writeSeedPackage(build, dir)
  await installBundleContent(h.server.db, h.server.config, {
    bundle: dir,
    withoutSchema: true,
    withoutFiles: true,
    backupTaken: true,
    publish: true,
  })
  expect((await syncDomainsFile(h.server.db, root)).problems).toEqual([])
  h.server.cache.invalidate()
  await h.server.cache.fresh()
  await h.server.jobs.runSearchIndexing()
}, 120_000)

afterAll(async () => {
  await h?.server.close().catch(() => {})
  if (root) rmSync(root, { recursive: true, force: true })
})

const page = async (path: string) => {
  const response = await h.server.fetch(new Request(`${ORIGIN}${path}`))
  return { status: response.status, html: await response.text() }
}

describe('the Crombolo demo, in English', () => {
  test('its home page is blocks: a hero, feature rows, a quote and a call to action', async () => {
    const { status, html } = await page('/')
    expect(status).toBe(200)
    expect(html).toContain('<html lang="en-US"')
    for (const part of [
      'class="hero',
      'class="feature-row',
      'class="quote',
      'class="call-to-action',
    ])
      expect(html).toContain(part)
    expect(html).toContain('Crombolo: the open source CMS for the agentic era')
    expect(html).toContain('href="/for-editors"')
    expect(html).toContain('href="/for-developers"')
  })

  test('its page for editors is blocks too, about the back office, with no dialog in its pictures', async () => {
    const { status, html } = await page('/for-editors')
    expect(status).toBe(200)
    expect(html).toContain('A back office that feels familiar')
    expect(html).toContain('Edit content and preview your changes')
    expect(html).toContain('Make changes safely in your own personal workspace')
    for (const dialog of [
      'workspace-share',
      'workspace-merge',
      'workspace-changes',
      'block-editor',
    ])
      expect(html).not.toContain(`/${dialog}.jpg`)
  })

  test('its page for developers is blocks too, about the command line', async () => {
    const { status, html } = await page('/for-developers')
    expect(status).toBe(200)
    expect(html).toContain('Crombolo: a CMS for agent-assisted development')
    // The logo is artwork, shown as it is, beside or below the text rather than behind it.
    expect(html).toContain('class="hero hero--artwork"')
    expect(html).toContain('Everything the back office does, from the command line')
    expect(html).toContain('class="feature-row')
    expect(html).toContain('<code>crombolo site deploy --profile production</code>')
  })

  test('its blocks have aliases, so a view can pick one out', async () => {
    const rows = await h.server.db.q
      .selectFrom('property_value')
      .select('text_value')
      .where('text_value', 'like', '%call-to-action%')
      .where('is_current', '=', h.server.db.dialect.boolValue(true))
      .execute()
    // The home page and the pages for editors and developers, each in two languages.
    expect(rows.length).toBe(6)
    for (const row of rows)
      for (const alias of ['hero', 'quote', 'call-to-action'])
        expect(row.text_value).toContain(`"alias":"${alias}"`)
    expect(rows.filter((row) => row.text_value?.includes('"alias":"workspace"')).length).toBe(2)
    expect(rows.filter((row) => row.text_value?.includes('"alias":"deploy"')).length).toBe(2)
  })

  test('its header comes from the menu, and leaves out what the menu does', async () => {
    const { html } = await page('/')
    for (const link of ['Features', 'For editors', 'For developers', 'Blog', 'About', 'Contact'])
      expect(html).toContain(`>${link}</a>`)
    expect(html).not.toContain('>Site Settings<')
    expect(html).not.toContain('>People</a>')
  })

  test('its footer comes from the site settings', async () => {
    const { html } = await page('/about')
    expect(html).toContain('A demonstration site. The people on it are invented.')
    expect(html).toContain('https://github.com/kineco-au/crombolo-cms')
  })

  test('its features filter by category, with a page for each', async () => {
    const all = await page('/features')
    expect(all.html).toContain('Workspaces')
    expect(all.html).toContain('From staging to live')
    const structure = await page('/features?category=structure')
    expect(structure.html).toContain('Forms and workflows')
    expect(structure.html).not.toContain('href="/features/from-staging-to-live"')
    const unknown = await page('/features?category=nonsense')
    expect(unknown.html).toContain('href="/features/from-staging-to-live"')
    const one = await page('/features/search')
    expect(one.status).toBe(200)
    expect(one.html).toContain('Site search works over published pages')
  })

  test('its blog pages four at a time, newest first', async () => {
    const first = await page('/blog')
    expect(first.html.indexOf('When two people change the same page')).toBeGreaterThan(-1)
    expect(first.html.indexOf('When two people change the same page')).toBeLessThan(
      first.html.indexOf('From staging to live, one change at a time'),
    )
    expect(first.html).not.toContain('A workspace for every piece of work')
    expect(first.html).toContain('href="/blog?page=2"')
    const second = await page('/blog?page=2')
    expect(second.html).toContain('A workspace for every piece of work')
    expect(second.html).not.toContain('When two people change the same page')
  })

  test('its blog filters by tag, and each post names its author and tags', async () => {
    const tagged = await page('/blog?tag=forms')
    expect(tagged.html).toContain('Forms, and the answers they collect')
    expect(tagged.html).not.toContain('Rehearse your upgrades')
    const post = await page('/blog/rehearse-your-upgrades')
    expect(post.status).toBe(200)
    expect(post.html).toContain('Tomás Vidal')
    expect(post.html).toContain('August 5, 2026')
    expect(post.html).toContain('href="/blog?tag=operations"')
  })

  test('its search finds pages', async () => {
    const { html } = await page('/search?q=staging')
    expect(html).toContain('href="/features/from-staging-to-live"')
  })

  test('its contact page draws the form', async () => {
    const { status, html } = await page('/contact')
    expect(status).toBe(200)
    expect(html).toContain('Send message')
    expect(html).toContain('<form')
  })
})

describe('the Crombolo demo, in Spanish at /es', () => {
  test('its home page is the same page, translated, with links that stay in Spanish', async () => {
    const { status, html } = await page('/es')
    expect(status).toBe(200)
    expect(html).toContain('<html lang="es-ES"')
    expect(html).toContain('Crombolo: el CMS de código abierto para la era de los agentes')
    expect(html).not.toContain('the open source CMS for the agentic era')
    expect(html).toContain('href="/es/para-editores"')
  })

  test('its menu, dictionary and site settings are translated', async () => {
    const { html } = await page('/es/acerca-de')
    expect(html).toContain('>Funciones</a>')
    expect(html).toContain('>Contacto</a>')
    expect(html).toContain('placeholder="Buscar"')
    expect(html).toContain('>Código fuente</a>')
    expect(html).toContain('Un sitio de demostración.')
  })

  test('its categories, people and dates are translated', async () => {
    const features = await page('/es/funciones?category=delivery')
    expect(features.html).toContain('>Entrega</a>')
    expect(features.html).toContain('Búsqueda')
    expect(features.html).not.toContain('Bloques')
    const post = await page('/es/blog/ensaya-tus-actualizaciones')
    expect(post.status).toBe(200)
    expect(post.html).toContain('5 de agosto de 2026')
  })

  test('its search stays in Spanish', async () => {
    const { html } = await page('/es/buscar?q=pruebas')
    expect(html).toContain('/es/funciones/de-pruebas-a-produccion')
    expect(html).not.toContain('href="/features/from-staging-to-live"')
  })

  test('its contact page draws the Spanish form', async () => {
    const { html } = await page('/es/contacto')
    expect(html).toContain('Enviar mensaje')
    expect(html).toContain('Correo electrónico')
    expect(html).not.toContain('Send message')
    expect(html).not.toContain('#contact')
  })

  test('a refused message says why in Spanish', async () => {
    const form = await h.server.fetch(new Request(`${ORIGIN}/es/contacto`))
    const html = await form.text()
    const field = (name: string) =>
      new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] as string
    const action = /action="(\/crombolo\/forms\/[^"]+)"/.exec(html)?.[1] as string
    const body = new FormData()
    body.set(FORM_TOKEN_FIELD, field(FORM_TOKEN_FIELD))
    body.set(FORM_RENDERED_FIELD, field(FORM_RENDERED_FIELD))
    const response = await h.server.fetch(
      new Request(`${ORIGIN}${action}`, {
        method: 'POST',
        body,
        headers: { referer: `${ORIGIN}/es/contacto`, accept: 'application/json' },
      }),
    )
    expect(await response.text()).toContain('Necesitamos un nombre para responder')
  })

  test('one contact form takes a message in Spanish, and saves its language', async () => {
    const form = await h.server.fetch(new Request(`${ORIGIN}/es/contacto`))
    const cookie = form.headers.get('set-cookie')?.split(';')[0] ?? ''
    const html = await form.text()
    const field = (name: string) =>
      new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] as string
    const action = /action="(\/crombolo\/forms\/[^"]+)"/.exec(html)?.[1] as string
    const body = new FormData()
    body.set('visitorName', 'Ana')
    body.set('visitorEmail', 'ana@example.com')
    body.set('message', 'Hola')
    body.set(FORM_TOKEN_FIELD, field(FORM_TOKEN_FIELD))
    body.set(FORM_RENDERED_FIELD, field(FORM_RENDERED_FIELD))
    // The form turns away anything sent back within three seconds of being drawn.
    await Bun.sleep(3_100)
    const response = await h.server.fetch(
      new Request(`${ORIGIN}${action}`, {
        method: 'POST',
        body,
        headers: { referer: `${ORIGIN}/es/contacto`, cookie },
        redirect: 'manual',
      }),
    )
    expect(response.status).toBe(303)
    const entries = await h.server.db.q.selectFrom('form_entry').selectAll().execute()
    expect(entries.map((entry) => [entry.form_key, entry.culture])).toEqual([
      ['5e2c7a10-3f4b-4c6d-9a18-6b7d0e1f2a31', 'es-ES'],
    ])
  })
})

describe('its one contact form', () => {
  const KEY = '5e2c7a10-3f4b-4c6d-9a18-6b7d0e1f2a31'

  test('reaches an app in the language it asks for', async () => {
    const response = await h.server.fetch(
      new Request(`${ORIGIN}/umbraco/delivery/api/v2/forms/${KEY}`, {
        headers: { 'accept-language': 'es-ES' },
      }),
    )
    const text = await response.text()
    expect(text).toContain('Correo electrónico')
    expect(text).not.toContain('#contact')
  })

  test('exports its columns as words', async () => {
    const response = await h.call(`/crombolo/crombolo/api/forms/${KEY}/entries.csv`)
    const header = (await response.text()).split('\r\n')[0]
    expect(header).toContain('Name')
    expect(header).not.toContain('#contact')
  })

  test('says which languages its entries came in', async () => {
    const list = await h.json<{ languages: string[]; items: Array<{ culture: string }> }>(
      `/crombolo/crombolo/api/forms/${KEY}/entries?language=es-ES`,
    )
    expect(list.languages).toEqual(['es-ES'])
    expect(list.items.map((entry) => entry.culture)).toEqual(['es-ES'])
  })

  test('a name the dictionary does not have is reported when the bundle is built', async () => {
    const copy = mkdtempSync(join(process.cwd(), 'output', 'crombolo-demo-words-'))
    try {
      for (const part of ['schema', 'components', 'css', 'content', 'package.json', 'site.json'])
        cpSync(join(SITE, part), join(copy, part), { recursive: true })
      const file = join(copy, 'schema', 'forms', 'contact.toml')
      writeFileSync(file, readFileSync(file, 'utf8').replace('{#contact.send}', '{#contact.sned}'))
      const built = await buildBundleFromDirectory(copy, { media: false })
      expect(built.problems.join('\n')).toContain('{#contact.sned}')
    } finally {
      rmSync(copy, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('the Crombolo demo, to search engines', () => {
  test('a page names both its languages', async () => {
    const { html } = await page('/features/search')
    expect(html).toContain('hreflang="en-US"')
    expect(html).toContain('hreflang="es-ES"')
    expect(html).toContain('hreflang="x-default"')
    expect(html).toContain('content="Visitors search your pages, with nothing else to run."')
  })

  test('a page describes itself in its own language', async () => {
    const { html } = await page('/es/funciones/busqueda')
    expect(html).toContain(
      'content="Los visitantes buscan en tus páginas, sin nada más que instalar."',
    )
  })

  test('the language switch goes to the same page in the other language', async () => {
    const { html } = await page('/features/search')
    expect(html).toContain('href="/es/funciones/busqueda"')
  })

  test('the sitemap lists both languages', async () => {
    const { html } = await page('/sitemap.xml')
    expect(html).toContain(`${ORIGIN}/features/search`)
    expect(html).toContain(`${ORIGIN}/es/funciones/busqueda`)
    expect(html).not.toContain('settings')
  })
})

describe('the Crombolo demo, as a template', () => {
  const textFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : textFiles(path)
      return /\.(toml|tsx?|css|md|json)$/.test(name) ? [path] : []
    })

  test('names nothing of Umbraco’s events or community', () => {
    // Saying where Crombolo comes from is the one mention the home page makes.
    const banned = /codegarden|(?<!inspirado en )umbraco(?!-inspired)|our\.umbraco|hq\b/i
    // Media types are generated, and their aliases are the CMS's own.
    const found = textFiles(SITE)
      .filter((file) => !file.includes('media-types'))
      .filter((file) => banned.test(readFileSync(file, 'utf8')))
      .filter((file) => !file.includes(join('schema', 'data-types')))
    expect(found).toEqual([])
  })
})
