/**
 * Story 057: how long pages, Delivery API answers and media may be kept. Nothing
 * unless the site says so; then the site, a type, or a page or media item's own
 * "Keep copies for", the narrowest winning; never anything personal.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeliveryApiOptions } from '@crombolo/api-delivery'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  PublicAccessRepository,
} from '@crombolo/data'
import {
  type CacheOptions,
  cacheControl,
  chosenLifetime,
  lifetimeFor,
  notModified,
  resolveCacheSettings,
  shortest,
  tagValue,
} from '@crombolo/render'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page", "news"]
components = ["page"]
default-component = "page"
compositions = ["cacheFields"]

[[property]]
alias = "title"
name = "Title"
type = "textstring"

[[property]]
alias = "related"
name = "Related"
type = "contentPicker"
`

const NEWS_TOML = `[content-type]
alias = "news"
name = "News"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const PHOTO_TOML = `[media-type]
alias = "photo"
name = "Photo"
allow-at-root = true
compositions = ["mediaCacheFields"]

[[group]]
name = "Photo"
alias = "photo"

  [[group.property]]
  alias = "umbracoFile"
  name = "File"
  type = "imageCropper"
`

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

async function png(): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await Bun.file(join(import.meta.dir, 'fixtures', 'pixel.png')).bytes())
}

/** Home (a page) with Story below it picking News; News is its own type. */
async function site(cache: CacheOptions = {}, deliveryApi: DeliveryApiOptions = { enabled: true }) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'cache-headers-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'schema/media-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'schema', 'content-types', 'news.toml'), NEWS_TOML)
  writeFileSync(join(root, 'schema', 'media-types', 'photo.toml'), PHOTO_TOML)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "export default ({ model }) => <main>{model.text('title')}</main>\n",
  )
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      deliveryApi,
      cache,
    },
  })
  open.push(h)
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const types = new ContentTypeRepository(db)
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const make = async (
    type: string,
    name: string,
    parentKey: string | null,
    values: Array<{ alias: string; value: unknown }> = [],
  ) => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: (await types.byAlias(type))?.key as string,
      componentKey,
      parentKey,
      variants: [{ culture: null, segment: null, name }],
      values: [
        { alias: 'title', culture: null, segment: null, value: `${name} title` },
        ...values.map((v) => ({ ...v, culture: null, segment: null })),
      ],
    })
    await docs.publish(doc.key, null)
    h.server.cache.invalidate()
    return doc.key
  }
  const home = await make('page', 'Home', null)
  const news = await make('news', 'News', home)
  const story = await make('page', 'Story', home, [
    { alias: 'related', value: `umb://document/${news.replaceAll('-', '')}` },
  ])
  h.server.cache.invalidate()
  const visit = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${path}`, { headers }))
  const api = (path: string, headers: Record<string, string> = {}) =>
    visit(`/umbraco/delivery/api/v2${path}`, headers)
  return { h, docs, make, home, news, story, visit, api }
}

const control = (response: Response) => response.headers.get('cache-control')

describe('with nothing configured', () => {
  test('pages and API answers say nothing about lifetime, but carry an ETag that answers 304', async () => {
    const { visit, api, story } = await site()
    const page = await visit('/story')
    expect(page.status).toBe(200)
    expect(control(page)).toBeNull()
    const etag = page.headers.get('etag') as string
    expect(etag).toStartWith('W/"')
    const again = await visit('/story', { 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')

    const item = await api(`/content/item/${story}`)
    expect(control(item)).toBeNull()
    const tag = item.headers.get('etag') as string
    expect((await api(`/content/item/${story}`, { 'if-none-match': tag })).status).toBe(304)
    expect(item.headers.get('surrogate-key')).toBeNull()
  })
})

describe('lifetimes', () => {
  test('the site’s, then a type’s, then a page’s own choice', async () => {
    const { visit, api, make, home, news, story } = await site({
      maxAge: 60,
      staleWhileRevalidate: 30,
      types: { news: { maxAge: 300 } },
    })
    expect(control(await visit('/story'))).toBe('public, max-age=60, stale-while-revalidate=30')
    expect(control(await api(`/content/item/${story}`))).toBe(
      'public, max-age=60, stale-while-revalidate=30',
    )
    expect(control(await api(`/content/item/${news}`))).toBe(
      'public, max-age=300, stale-while-revalidate=30',
    )
    const hourly = await make('page', 'Hourly', home, [
      { alias: 'cacheKeepFor', value: ['1 hour'] },
    ])
    const never = await make('page', 'Never', home, [
      { alias: 'cacheKeepFor', value: ["Don't keep copies"] },
    ])
    expect(control(await visit('/hourly'))).toBe('public, max-age=3600, stale-while-revalidate=30')
    expect(control(await api(`/content/item/${hourly}`))).toBe(
      'public, max-age=3600, stale-while-revalidate=30',
    )
    expect(control(await visit('/never'))).toBe('no-store')
    expect(control(await api(`/content/item/${never}`))).toBe('no-store')
    // A list takes the shortest of what it holds; one kept by nobody keeps the list from anybody.
    expect(control(await api(`/content?fetch=children:${home}`))).toBe('no-store')
    expect(control(await api(`/content/items?id=${story}&id=${news}`))).toBe(
      'public, max-age=60, stale-while-revalidate=30',
    )
  })

  test('a media file is kept for a year unless its item says otherwise', async () => {
    const { h, visit } = await site({ maxAge: 60 })
    const upload = async () => {
      const id = crypto.randomUUID()
      const form = new FormData()
      form.set('Id', id)
      form.set('File', new File([await png()], 'pixel.png'))
      expect((await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(
        201,
      )
      return id
    }
    const photoType = (
      await new ContentTypeRepository(h.server.db, { kind: 'media' }).byAlias('photo')
    )?.key as string
    const photo = async (name: string, keepFor?: string) => {
      const created = await h.post(`${V1}/media`, {
        mediaType: { id: photoType },
        parent: null,
        values: [
          {
            alias: 'umbracoFile',
            value: { src: '', temporaryFileId: await upload(), crops: [], focalPoint: null },
          },
          ...(keepFor ? [{ alias: 'cacheKeepFor', value: [keepFor] }] : []),
        ].map((v) => ({ ...v, culture: null, segment: null })),
        variants: [{ culture: null, segment: null, name }],
      })
      expect(created.status).toBe(201)
      const key = created.headers.get('umb-generated-resource') as string
      const media = await h.json<{ values: Array<{ alias: string; value: { src: string } }> }>(
        `${V1}/media/${key}`,
      )
      return media.values.find((v) => v.alias === 'umbracoFile')?.value.src as string
    }
    const kept = await photo('Kept')
    const withdrawn = await photo('Withdrawn', "Don't keep copies")
    h.server.cache.invalidate()
    expect(control(await visit(kept))).toBe('public, max-age=31536000, immutable')
    expect(control(await visit(withdrawn))).toBe('no-store')
    expect(control(await visit(`${withdrawn}?width=2`))).toBe('no-store')
  })
})

describe('nothing personal is kept', () => {
  test('a members-only page, even as the login page a visitor sees, is private', async () => {
    const { h, visit, story, home } = await site({ maxAge: 60 })
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: story,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    h.server.cache.invalidate()
    const page = await visit('/story')
    expect(page.status).toBe(200)
    expect(control(page)).toBe('private, no-store')
    expect(control(await visit('/'))).toBe('public, max-age=60')
  })

  test('a non-public API and a member’s token are private', async () => {
    const closed = await site({ maxAge: 60 }, { enabled: true, publicAccess: false, apiKey: 'key' })
    expect(control(await closed.api(`/content/item/${closed.story}`, { 'api-key': 'key' }))).toBe(
      'private, no-store',
    )
    const members = await site(
      { maxAge: 60 },
      {
        enabled: true,
        memberAuthorization: {
          clientCredentialsFlow: {
            enabled: true,
            associatedMembers: [{ userName: 'shop', clientId: 'shop', clientSecret: 's' }],
          },
        },
      },
    )
    const item = `/content/item/${members.story}`
    expect(control(await members.api(item, { authorization: 'Bearer anything' }))).toBe(
      'private, no-store',
    )
    expect(control(await members.api(item))).toBe('public, max-age=60')
  })
})

describe('purge tags', () => {
  test('list a page and its ancestors, and every page an answer holds', async () => {
    const { visit, api, home, news, story } = await site({ tagHeader: 'Surrogate-Key' })
    const page = await visit('/story')
    expect(page.headers.get('surrogate-key')?.split(' ').sort()).toEqual([home, story].sort())
    const item = await api(`/content/item/${story}`)
    expect(item.headers.get('surrogate-key')?.split(' ').sort()).toEqual([news, story].sort())
    const children = await api(`/content?fetch=children:${home}`)
    expect(children.headers.get('surrogate-key')?.split(' ')).toContain(home)
  })
})

describe('the policy', () => {
  test('resolves what can be used and drops what cannot', () => {
    const settings = resolveCacheSettings({
      maxAge: 60,
      types: { News: { maxAge: 0 }, bad: { maxAge: -1 } },
      tagHeader: 'Cache Tag',
    })
    expect(settings.site).toEqual({ maxAge: 60 })
    expect(settings.types.get('news')).toBe('none')
    expect(settings.types.has('bad')).toBe(false)
    expect(settings.tagHeader).toBeUndefined()
    expect(resolveCacheSettings().site).toBeUndefined()
  })

  test('the narrowest level wins, and an unknown choice is no choice', () => {
    const settings = resolveCacheSettings({ maxAge: 60, types: { news: { maxAge: 300 } } })
    const item = (typeAlias: string, keepFor?: unknown) => ({
      typeAlias,
      value: (alias: string) => (alias === 'cacheKeepFor' ? keepFor : undefined),
    })
    expect(lifetimeFor(settings, item('page'))).toEqual({ maxAge: 60 })
    expect(lifetimeFor(settings, item('news'))).toEqual({ maxAge: 300 })
    expect(lifetimeFor(settings, item('news', ['1 minute']))).toEqual({ maxAge: 60 })
    expect(lifetimeFor(settings, item('news', 'nonsense'))).toEqual({ maxAge: 300 })
    expect(chosenLifetime(["Don't keep copies"])).toBe('none')
    expect(chosenLifetime(undefined)).toBeUndefined()
  })

  test('the shortest of a list, the headers, and the validators', () => {
    expect(shortest([{ maxAge: 60 }, { maxAge: 30 }], undefined)).toEqual({ maxAge: 30 })
    expect(shortest([{ maxAge: 60 }, 'none'], undefined)).toBe('none')
    expect(shortest([], { maxAge: 5 })).toEqual({ maxAge: 5 })
    expect(cacheControl(undefined)).toBeUndefined()
    expect(cacheControl({ maxAge: 10, staleWhileRevalidate: 5 })).toBe(
      'public, max-age=10, stale-while-revalidate=5',
    )
    const request = (value: string) => new Request(ORIGIN, { headers: { 'if-none-match': value } })
    expect(notModified(request('"a", W/"b"'), 'W/"b"')).toBe(true)
    expect(notModified(request('"b"'), 'W/"b"')).toBe(true)
    expect(notModified(request('"c"'), 'W/"b"')).toBe(false)
    expect(tagValue('Surrogate-Key', ['A', 'a', 'b'])).toBe('a b')
    expect(tagValue('Cache-Tag', ['a', 'b'])).toBe('a,b')
  })
})

describe('the Caching compositions', () => {
  test('are shipped for pages and media, and the media one is never made as an item', async () => {
    const { h } = await site()
    const pages = await new ContentTypeRepository(h.server.db).byAlias('cacheFields')
    const media = await new ContentTypeRepository(h.server.db, { kind: 'media' }).byAlias(
      'mediaCacheFields',
    )
    expect(pages?.properties.map((p) => p.alias)).toEqual(['cacheKeepFor'])
    expect(media?.properties.map((p) => p.alias)).toEqual(['cacheKeepFor'])
    expect(media?.allowedAsRoot).toBe(false)
    expect(media?.properties[0]?.key).not.toBe(pages?.properties[0]?.key)
  })
})
