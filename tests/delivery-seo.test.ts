/**
 * Story 055: a page's search and sharing details reach an app as `<SeoHead>`
 * works them out, the site can name the public address an app serves it on, and
 * the sitemap can be read as data.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import type { CromboloConfig } from '@crombolo/server'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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
allow-children = ["page"]
compositions = ["seoFields"]
components = ["page"]
default-component = "page"
`

const VIEW = `import { SeoHead } from '@crombolo/crombolo'
export default function Page(props) {
  return <html><head><SeoHead {...props} /></head><body><h1>{props.model.name}</h1></body></html>
}
`

type Seo = {
  title: string
  description: string | null
  image: { url: string; width: number | null; height: number | null } | null
  canonical: string | null
  robots: string | null
  siteName: string
}

async function site(config: Partial<CromboloConfig> = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'delivery-seo-'))
  dirs.push(root)
  const schemaDir = join(root, 'schema')
  mkdirSync(join(schemaDir, 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(schemaDir, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(schemaDir, 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  const h = await signedInServer({
    config: {
      schemaDir,
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      deliveryApi: { enabled: true },
      ...config,
    },
  })
  open.push(h)
  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const page = async (
    name: string,
    values: Array<{ alias: string; value: unknown }> = [],
    parent?: string,
  ) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      parent: parent ? { id: parent } : null,
      template: { id: componentKey },
      values: values.map((v) => ({ ...v, culture: null, segment: null })),
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
  const image = async () => {
    const id = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', id)
    form.set(
      'File',
      new File(
        [await Bun.file(join(import.meta.dir, 'fixtures', 'pixel.png')).bytes()],
        'share.png',
      ),
    )
    expect((await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(201)
    const created = await h.post(`${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Image },
      parent: null,
      values: [
        {
          alias: 'umbracoFile',
          value: { src: '', temporaryFileId: id, crops: [], focalPoint: null },
          culture: null,
          segment: null,
        },
      ],
      variants: [{ culture: null, segment: null, name: 'Share' }],
    })
    expect(created.status).toBe(201)
    return created.headers.get('umb-generated-resource') as string
  }
  const visit = (url: string) => h.server.fetch(new Request(url))
  const api = async <T = Record<string, unknown>>(host: string, path: string) => {
    const response = await visit(`http://${host}/umbraco/delivery/api/v2${path}`)
    expect(response.status, path).toBe(200)
    return (await response.json()) as T
  }
  return { h, page, image, visit, api }
}

/** What `<SeoHead>` wrote, read back out of the page. */
function headOf(html: string) {
  const meta = (attr: string, name: string) =>
    new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(html)?.[1] ?? null
  return {
    title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null,
    description: meta('name', 'description'),
    canonical: /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null,
    robots: meta('name', 'robots'),
    image: meta('property', 'og:image'),
  }
}

describe('a page’s search and sharing details', () => {
  test('match what <SeoHead> writes for the same page', async () => {
    const { page, image, visit, api } = await site({
      seo: { titleSuffix: ' | Acme', siteName: 'Acme' },
    })
    const share = await image()
    const home = await page('Home')
    const about = await page(
      'About',
      [
        { alias: 'seoTitle', value: 'About us' },
        { alias: 'seoDescription', value: 'Who we are.' },
        { alias: 'seoNoindex', value: true },
        { alias: 'seoImage', value: [{ key: crypto.randomUUID(), mediaKey: share }] },
      ],
      home,
    )
    const head = headOf(await (await visit('http://acme.test/about')).text())
    const { seo } = await api<{ seo: Seo }>('acme.test', `/content/item/${about}?seo=true`)
    expect(seo.title).toBe(head.title as string)
    expect(seo.title).toBe('About us | Acme')
    expect(seo.description).toBe(head.description)
    expect(seo.description).toBe('Who we are.')
    expect(seo.canonical).toBe(head.canonical)
    expect(seo.canonical).toBe('http://acme.test/about')
    expect(seo.robots).toBe(head.robots)
    expect(seo.robots).toBe('noindex')
    expect(seo.image?.url).toBe(head.image as string)
    expect(seo.image).toMatchObject({ width: 1, height: 1 })
    expect(seo.siteName).toBe('Acme')

    const plain = await api<{ seo: Seo }>('acme.test', `/content/item/${home}?seo=true`)
    const homeHead = headOf(await (await visit('http://acme.test/')).text())
    expect(plain.seo).toMatchObject({ title: homeHead.title, robots: null, image: null })
  })

  test('are there only when asked for, in lists too', async () => {
    const { page, api } = await site()
    const home = await page('Home')
    expect(await api('acme.test', `/content/item/${home}`)).not.toHaveProperty('seo')
    const listed = await api<{ items: Array<{ seo?: Seo }> }>(
      'acme.test',
      '/content?fetch=children:00000000-0000-0000-0000-000000000000&seo=true',
    )
    expect(listed.items[0]?.seo?.title).toBe('Home')
  })
})

describe('the public address', () => {
  test('writes preferred addresses, the sitemap and robots.txt for the app', async () => {
    const { page, visit, api } = await site({ seo: { publicUrl: 'https://www.acme.com/' } })
    const home = await page('Home')
    await page('About', [], home)
    const item = await api<{ seo: Seo }>('cms.acme.test', `/content/item/${home}?seo=true`)
    expect(item.seo.canonical).toBe('https://www.acme.com/')
    expect(await (await visit('http://cms.acme.test/sitemap.xml')).text()).toContain(
      '<loc>https://www.acme.com/about</loc>',
    )
    expect(await (await visit('http://cms.acme.test/robots.txt')).text()).toContain(
      'Sitemap: https://www.acme.com/sitemap.xml',
    )
  })
})

describe('the sitemap as data', () => {
  test('lists what the sitemap lists, and is not there when the sitemap is off', async () => {
    const { page, api } = await site()
    const home = await page('Home')
    const about = await page('About', [], home)
    await page('Hidden', [{ alias: 'seoSitemapHide', value: true }], home)
    const map = await api<{
      total: number
      items: Array<{ id: string; url: string; lastmod: string }>
    }>('acme.test', '/sitemap')
    expect(map.items.map((i) => i.id).sort()).toEqual([home, about].sort())
    expect(map.items.find((i) => i.id === about)?.url).toBe('http://acme.test/about')
    expect(map.items[0]?.lastmod).toMatch(/^\d{4}-\d\d-\d\dT/)

    const off = await site({ seo: { sitemap: false } })
    await off.page('Home')
    expect((await off.visit('http://acme.test/umbraco/delivery/api/v2/sitemap')).status).toBe(404)
  })
})
