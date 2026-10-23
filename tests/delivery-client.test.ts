/**
 * Story 052: `@crombolo/delivery-client` against a running site's Delivery API,
 * and the built JavaScript it is published as.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import {
  createDeliveryClient,
  type DeliveryClientOptions,
  DeliveryError,
  isExpanded,
} from '@crombolo/delivery-client'
import { buildDeliveryClient, builtManifest } from '../scripts/delivery-client.ts'
import { type Manifest, ROOT } from '../scripts/packages.ts'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"

[[property]]
alias = "related"
name = "Related"
type = "contentPicker"
`

type Types = {
  content: { page: { title: string | null; related: unknown } }
  media: Record<string, never>
}

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

async function site(deliveryApi: Record<string, unknown> = { enabled: true }) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'delivery-client-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      deliveryApi,
    },
  })
  open.push(h)
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const page = async (name: string, parentKey: string | null, related?: string) => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: typeKey,
      componentKey,
      parentKey,
      variants: [{ culture: null, segment: null, name }],
      values: [
        { alias: 'title', culture: null, segment: null, value: `${name} title` },
        ...(related
          ? [
              {
                alias: 'related',
                culture: null,
                segment: null,
                value: `umb://document/${related.replaceAll('-', '')}`,
              },
            ]
          : []),
      ],
    })
    await docs.publish(doc.key, null)
    return doc.key
  }
  const home = await page('Home', null)
  const news = await page('News', home)
  const story = await page('Story', news, home)
  h.server.cache.invalidate()
  const sent: Request[] = []
  const client = (options: Partial<DeliveryClientOptions> = {}) =>
    createDeliveryClient<Types>({
      baseUrl: `${ORIGIN}/`,
      fetch: (url, init) => {
        const request = new Request(url, init)
        sent.push(request)
        return h.server.fetch(request)
      },
      ...options,
    })
  return { client, sent, home, news, story, index: () => h.server.jobs.runSearchIndexing() }
}

describe('the delivery client', () => {
  test('reads an item by id or path, and answers undefined for none', async () => {
    const { client, story } = await site()
    const cms = client()
    const byId = await cms.item(story)
    expect(byId?.properties.title).toBe('Story title')
    expect(byId?.route.path).toBe('/news/story')
    expect((await cms.item('/news/story'))?.id).toBe(story)
    expect(await cms.item(crypto.randomUUID())).toBeUndefined()
  })

  test('tells an expanded picker from a reference', async () => {
    const { client, story, home } = await site()
    const cms = client()
    const plain = (await cms.item(story))?.properties.related as { properties: object; id: string }
    expect(plain.id).toBe(home)
    expect(isExpanded(plain)).toBe(false)
    const expanded = (await cms.item(story, { expand: 'properties[related]' }))?.properties
      .related as { properties: { title?: string } }
    expect(isExpanded(expanded)).toBe(true)
    expect(expanded.properties.title).toBe('Home title')
  })

  test('queries, pages and narrows with the API’s own grammar', async () => {
    const { client, home, news, story } = await site()
    const cms = client()
    const below = await cms.content({ fetch: `descendants:${home}`, sort: 'name:asc' })
    expect(below.total).toBe(2)
    expect(below.items.map((i) => i.id)).toEqual([news, story])
    const one = await cms.content({ fetch: `descendants:${home}`, take: 1, skip: 1 })
    expect(one.items).toHaveLength(1)
    const items = await cms.items([story, news, crypto.randomUUID()], {
      fields: 'properties[title]',
    })
    expect(items.map((i) => i.id)).toEqual([story, news])
    expect(Object.keys(items[0]?.properties ?? {})).toEqual(['title'])
  })

  test("asks at crombolo's path, or at Umbraco's when told to, and both answer", async () => {
    const { client, sent } = await site()
    const own = await client({}).content({ fetch: 'children:/' })
    const umbraco = await client({ apiPath: '/umbraco/delivery/api/v2' }).content({
      fetch: 'children:/',
    })
    expect(sent.map((request) => new URL(request.url).pathname)).toEqual([
      '/crombolo/delivery/api/v2/content',
      '/umbraco/delivery/api/v2/content',
    ])
    expect(umbraco.items.map((item) => item.id)).toEqual(own.items.map((item) => item.id))
  })

  test('sends the key, the culture, the start item and a member’s token', async () => {
    const { client, sent } = await site()
    const cms = client({
      apiKey: 'secret',
      culture: 'en-US',
      startItem: 'home',
      memberToken: async () => 'member-token',
    })
    await cms.content({ fetch: 'children:/' })
    await cms.item('news', { culture: 'da-DK', startItem: 'other' }).catch(() => {})
    const [query, item] = sent
    expect(query?.headers.get('api-key')).toBe('secret')
    expect(query?.headers.get('accept-language')).toBe('en-US')
    expect(query?.headers.get('start-item')).toBe('home')
    expect(query?.headers.get('authorization')).toBe('Bearer member-token')
    expect(new URL(query?.url ?? '').pathname).toBe('/crombolo/delivery/api/v2/content')
    expect(item?.headers.get('accept-language')).toBe('da-DK')
    expect(item?.headers.get('start-item')).toBe('other')
  })

  test('throws a DeliveryError with the status and body when refused', async () => {
    const { client } = await site({ enabled: true, publicAccess: false, apiKey: 'right' })
    const error = await client({ apiKey: 'wrong' })
      .content()
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DeliveryError)
    expect((error as DeliveryError).status).toBe(401)
    const bad = await client({ apiKey: 'right' })
      .content({ sort: 'nonsense:asc' })
      .catch((e: unknown) => e)
    expect((bad as DeliveryError).status).toBe(400)
    expect((bad as DeliveryError).body).toMatchObject({ title: 'Sort option not found' })
    expect((await client({ apiKey: 'right' }).content()).total).toBe(3)
  })

  test('looks up a route: the page, or not found', async () => {
    const { client, story } = await site()
    const found = await client().route('/news/story')
    expect(found.kind).toBe('page')
    if (found.kind === 'page') expect(found.item.id).toBe(story)
    expect(await client().route('/nowhere')).toEqual({ kind: 'notFound', item: null })
  })

  test('searches published pages', async () => {
    const { client, story, index } = await site()
    await index()
    const hits = await client().search('story')
    expect(hits.items.map((i) => i.id)).toContain(story)
    expect(hits.items[0]?.excerpt).toContain('<mark>')
  })
})

describe('the published package', () => {
  test('is built to JavaScript with declarations, and packed under a manifest pointing there', async () => {
    const dir = join(ROOT, 'packages/delivery-client')
    try {
      await buildDeliveryClient(dir)
      const js = readFileSync(join(dir, 'dist/index.js'), 'utf8')
      expect(js).toContain('createDeliveryClient')
      expect(js).not.toContain(': string')
      const declarations = readFileSync(join(dir, 'dist/index.d.ts'), 'utf8')
      expect(declarations).toContain('export declare function createDeliveryClient')
      const built = await import(join(dir, 'dist/index.js'))
      expect(Object.keys(built).sort()).toEqual([
        'DELIVERY_API_PATH',
        'DeliveryError',
        'createDeliveryClient',
        'isExpanded',
      ])
    } finally {
      rmSync(join(dir, 'dist'), { recursive: true, force: true })
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest
    expect(manifest.exports).toEqual({ '.': './src/index.ts' })
    expect(builtManifest(manifest)).toMatchObject({
      exports: {
        '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
      },
      files: ['dist', 'NOTICE'],
    })
    expect(existsSync(join(dir, 'dist'))).toBe(false)
  })

  test('depends on nothing, so it runs wherever an app does', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'packages/delivery-client/package.json'), 'utf8'),
    ) as Manifest
    expect(manifest.dependencies ?? {}).toEqual({})
    const source = readFileSync(join(ROOT, 'packages/delivery-client/src/index.ts'), 'utf8')
    expect(source).not.toMatch(/^import /m)
  })
})
