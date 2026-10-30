/**
 * Story 050: Umbraco's Delivery API v2 over the published cache — access,
 * items, paths, queries, expansion, members-only pages and media. Story 051:
 * requests from another origin.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  accessTo,
  allowedOrigin,
  bearerToken,
  contentAccess,
  corsMethodsFor,
  corsPolicy,
  type DeliveryApiOptions,
  mediaAccess,
  memberClientId,
  nextNode,
  parseContentFilters,
  parseContentSelector,
  parseContentSorts,
  parseExpansion,
  parseMediaQuery,
  requestedCulture,
  resolveDeliveryApiSettings,
} from '@crombolo/api-delivery'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  PublicAccessRepository,
} from '@crombolo/data'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

describe('settings', () => {
  test('are off by default, as in Umbraco, and a client id gains its prefix', () => {
    const settings = resolveDeliveryApiSettings()
    expect(settings.enabled).toBe(false)
    expect(settings.publicAccess).toBe(true)
    expect(settings.media).toEqual({ enabled: false, publicAccess: true })
    expect(memberClientId('shop')).toBe('umbraco-member-shop')
    expect(memberClientId('umbraco-member-shop')).toBe('umbraco-member-shop')
  })

  test('access follows Umbraco: public, or the exact key; preview always needs it', () => {
    const on = resolveDeliveryApiSettings({ enabled: true, apiKey: 'secret' })
    const req = (headers: Record<string, string>) => new Request(ORIGIN, { headers })
    expect(contentAccess(on, req({}))).toBe(true)
    expect(contentAccess(on, req({ preview: 'TRUE' }))).toBe(false)
    expect(contentAccess(on, req({ preview: 'true', 'api-key': 'secret' }))).toBe(true)
    const closed = resolveDeliveryApiSettings({
      enabled: true,
      publicAccess: false,
      apiKey: 'secret',
    })
    expect(contentAccess(closed, req({}))).toBe(false)
    expect(contentAccess(closed, req({ 'api-key': 'Secret' }))).toBe(false)
    expect(contentAccess(closed, req({ 'api-key': 'secret' }))).toBe(true)
    expect(mediaAccess(on, req({}))).toBe(false)
    expect(
      mediaAccess(resolveDeliveryApiSettings({ enabled: true, media: { enabled: true } }), req({})),
    ).toBe(true)
    expect(contentAccess(resolveDeliveryApiSettings(), req({}))).toBe(false)
  })

  test('a culture is read only when plain, and a token only from the header', () => {
    expect(requestedCulture('da-DK')).toBe('da-DK')
    expect(requestedCulture('en-GB,en;q=0.9')).toBeUndefined()
    expect(bearerToken(new Request(ORIGIN, { headers: { authorization: 'Bearer abc' } }))).toBe(
      'abc',
    )
    expect(bearerToken(new Request(`${ORIGIN}/?access_token=abc`))).toBeUndefined()
  })
})

describe('expand and fields', () => {
  test('parse into a tree, and $all expands one level', () => {
    const tree = parseExpansion('properties[a,b[properties[c]]]')
    expect(nextNode(tree, 'a')?.key).toBe('a')
    expect(nextNode(nextNode(tree, 'b'), 'c')?.key).toBe('c')
    expect(nextNode(tree, 'z')).toBeUndefined()
    const all = parseExpansion('properties[$all]')
    expect(nextNode(all, 'anything')?.key).toBe('$all')
    expect(nextNode(nextNode(all, 'anything'), 'deeper')).toBeUndefined()
  })

  test('refuse what Umbraco refuses', () => {
    expect(() => parseExpansion('properties[a')).toThrow('equal number')
    expect(() => parseExpansion('[a]')).toThrow('start with a bracket')
    expect(() => parseExpansion('properties[]')).toThrow('empty brackets')
  })
})

describe('query parameters', () => {
  test('fetch is ancestors, children or descendants, else the whole tree', () => {
    expect(parseContentSelector(null)).toEqual({ kind: 'all' })
    expect(parseContentSelector('Children:/news')).toEqual({ kind: 'children', target: '/news' })
    expect(parseContentSelector('siblings:x')).toBe('selector')
  })

  test('filters AND, their values OR, ! negates, and a bad date is dropped', () => {
    const filters = parseContentFilters([
      'contentType:!page,post',
      'name:a,b',
      'createDate>2024-01-01',
      'updateDate<nonsense',
    ])
    expect(filters).toEqual([
      { kind: 'contentType', negate: true, values: ['page', 'post'] },
      { kind: 'name', negate: false, values: ['a', 'b'] },
      { kind: 'createDate', operator: '>', date: new Date('2024-01-01') },
    ])
    expect(parseContentFilters(['colour:red'])).toBe('filter')
  })

  test('sorts are ascending only when the direction starts with asc', () => {
    expect(parseContentSorts(['name:asc', 'createDate:DESC', 'level:ascending'])).toEqual([
      { field: 'name', ascending: true },
      { field: 'createDate', ascending: false },
      { field: 'level', ascending: true },
    ])
    expect(parseContentSorts(['popularity:asc'])).toBe('sort')
  })

  test('media needs children:, takes key:value filters, and keeps the last sort', () => {
    expect(parseMediaQuery({ fetch: null, filters: [], sorts: [] })).toBe('selector')
    expect(
      parseMediaQuery({
        fetch: 'children:/',
        filters: ['mediaType:Image'],
        sorts: ['name:asc', 'sortOrder:desc'],
      }),
    ).toEqual({
      parent: '/',
      filters: [{ kind: 'mediaType', value: 'Image' }],
      sort: { field: 'sortOrder', ascending: false },
    })
    expect(parseMediaQuery({ fetch: 'children:/', filters: ['a:b:c'], sorts: [] })).toBe('filter')
  })
})

describe('members-only pages', () => {
  const rules = new Map([
    [12, { nodeId: 12, memberUserNames: ['Ada'], memberGroupNames: ['Staff'] }],
  ])
  const member = (
    over: Partial<{
      userName: string
      groups: string[]
      approved: boolean
      lockedOut: boolean
    }> = {},
  ) => ({
    key: 'k',
    userName: 'bob',
    groups: [],
    approved: true,
    lockedOut: false,
    ...over,
  })
  test('the nearest protected ancestor governs, by name or by group, both in any case', () => {
    expect(accessTo('-1,5', rules, undefined)).toBe('allowed')
    expect(accessTo('-1,12,30', rules, undefined)).toBe('unauthorized')
    expect(accessTo('-1,12,30', rules, member({ userName: 'ADA' }))).toBe('allowed')
    expect(accessTo('-1,12,30', rules, member({ groups: ['Staff'] }))).toBe('allowed')
    expect(accessTo('-1,12,30', rules, member({ groups: ['staff'] }))).toBe('allowed')
    expect(accessTo('-1,12,30', rules, member({ groups: ['Guests'] }))).toBe('forbidden')
    expect(accessTo('-1,12,30', rules, member({ userName: 'ada', lockedOut: true }))).toBe(
      'unauthorized',
    )
  })
})

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

[[property]]
alias = "body"
name = "Body"
type = "richtext"
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

const API = '/umbraco/delivery/api/v2'

/** Home › News › Story and a second root, Other; Story picks Other. */
async function site(deliveryApi: DeliveryApiOptions = { enabled: true }) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'delivery-api-'))
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
  const page = async (name: string, parentKey: string | null, related?: string, body?: string) => {
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
        ...(body
          ? [{ alias: 'body', culture: null, segment: null, value: { markup: body, blocks: null } }]
          : []),
      ],
    })
    await docs.publish(doc.key, null)
    return doc.key
  }
  const home = await page('Home', null)
  const news = await page('News', home)
  const other = await page('Other', null)
  const story = await page('Story', news, other)
  h.server.cache.invalidate()
  const get = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${API}${path}`, { headers }))
  const json = async <T = Record<string, unknown>>(
    path: string,
    headers: Record<string, string> = {},
  ) => {
    const response = await get(path, headers)
    expect(response.status, `${path}`).toBe(200)
    return (await response.json()) as T
  }
  return { h, home, news, story, other, page, get, json }
}

type Item = {
  id: string
  name: string
  route: { path: string; startItem: { id: string; path: string } }
  properties: Record<string, unknown>
  cultures: Record<string, unknown>
  contentType: string
}

describe('the Delivery API over HTTP', () => {
  test('answers 401 when it is switched off, as Umbraco does', async () => {
    const { get } = await site({})
    expect((await get('/content')).status).toBe(401)
  })

  test('an item by id has Umbraco’s shape and a route relative to its root', async () => {
    const { json, home, news, story } = await site()
    const item = await json<Item>(`/content/item/${story}`)
    expect(item).toMatchObject({
      contentType: 'page',
      name: 'Story',
      id: story,
      route: { path: '/news/story', queryString: null, startItem: { id: home, path: 'home' } },
      cultures: {},
    })
    expect(item.properties.title).toBe('Story title')
    expect(Object.keys(item)).toEqual([
      'contentType',
      'name',
      'createDate',
      'updateDate',
      'route',
      'id',
      'properties',
      'cultures',
    ])
    expect((await json<Item>(`/content/item/${home}`)).route.path).toBe('/')
    expect((await json<Item>(`/content/item/${news}`)).route.path).toBe('/news')
  })

  test('an item by path, the first root at /, another root by its segment', async () => {
    const { json, get, story, home, other } = await site()
    expect((await json<Item>('/content/item/news/story')).id).toBe(story)
    expect((await json<Item>('/content/item/news/story/')).id).toBe(story)
    expect((await json<Item>('/content/item/')).id).toBe(home)
    expect((await json<Item>('/content/item/other')).id).toBe(other)
    expect((await get('/content/item/news/STORY')).status).toBe(404)
    expect((await get('/content/item/nowhere')).status).toBe(404)
  })

  test('items by id drop duplicates and unknowns', async () => {
    const { json, news, story } = await site()
    const items = await json<Item[]>(
      `/content/items?id=${story}&id=${news}&id=${story}&id=${crypto.randomUUID()}`,
    )
    expect(items.map((i) => i.id)).toEqual([story, news])
  })

  test('a picker is a reference unless expanded; fields narrows the properties', async () => {
    const { json, story, other } = await site()
    const plain = await json<Item>(`/content/item/${story}`)
    expect(plain.properties.related).toMatchObject({ id: other, name: 'Other', properties: {} })
    const expanded = await json<Item>(`/content/item/${story}?expand=properties[related]`)
    expect((expanded.properties.related as Item).properties.title).toBe('Other title')
    const narrowed = await json<Item>(`/content/item/${story}?fields=properties[title]`)
    expect(Object.keys(narrowed.properties)).toEqual(['title'])
  })

  test('queries fetch, filter, sort and page; a bad option is a 400 problem', async () => {
    const { json, get, home, news, story } = await site()
    const children = await json<{ total: number; items: Item[] }>(`/content?fetch=children:${home}`)
    expect(children.items.map((i) => i.id)).toEqual([news])
    const below = await json<{ total: number; items: Item[] }>(`/content?fetch=descendants:${home}`)
    expect(below.items.map((i) => i.id).sort()).toEqual([news, story].sort())
    const above = await json<{ items: Item[] }>(`/content?fetch=ancestors:${story}`)
    expect(above.items.map((i) => i.id)).toEqual([home, news])
    const named = await json<{ total: number; items: Item[] }>(
      '/content?filter=name:st&sort=name:asc',
    )
    expect(named.items.map((i) => i.name)).toEqual(['Story'])
    const all = await json<{ total: number; items: Item[] }>('/content?sort=name:desc&take=2')
    expect(all.total).toBe(4)
    expect(all.items.map((i) => i.name)).toEqual(['Story', 'Other'])
    const bad = await get('/content?fetch=siblings:x')
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ title: 'Selector option not found' })
    expect((await get('/content?skip=abc')).status).toBe(400)
  })

  test('a Start-Item it cannot find is a 404 saying so', async () => {
    const { get, json, story } = await site()
    const missing = await get('/content', { 'start-item': 'nowhere' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toBe('The Start-Item could not be found')
    expect((await json<Item>('/content/item/news/story', { 'start-item': 'home' })).id).toBe(story)
  })

  test('without public access the key is needed', async () => {
    const { get } = await site({ enabled: true, publicAccess: false, apiKey: 'k3y' })
    expect((await get('/content')).status).toBe(401)
    expect((await get('/content', { 'api-key': 'k3y' })).status).toBe(200)
  })

  test('a members-only page answers 401 to an anonymous caller and is never listed', async () => {
    const { h, get, json, story, home } = await site()
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: story,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    h.server.cache.invalidate()
    const response = await get(`/content/item/${story}`)
    expect(response.status).toBe(401)
    expect(await response.text()).toBe('')
    const listed = await json<{ items: Item[] }>('/content')
    expect(listed.items.map((i) => i.id)).not.toContain(story)
  })

  test('media: off unless enabled, then by parent, path and id', async () => {
    const off = await site()
    expect((await off.get('/media?fetch=children:/')).status).toBe(401)
    const { h, json } = await site({ enabled: true, media: { enabled: true } })
    const media = new DocumentRepository(h.server.db, {
      kind: 'media',
      nodeState: h.server.schema.nodeState,
    })
    const folder = await media.create({
      key: crypto.randomUUID(),
      contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
      componentKey: null,
      parentKey: null,
      variants: [{ culture: null, segment: null, name: 'Photos' }],
      values: [],
    })
    const image = await media.create({
      key: crypto.randomUUID(),
      contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Image,
      componentKey: null,
      parentKey: folder.key,
      variants: [{ culture: null, segment: null, name: 'Harbour View' }],
      values: [],
    })
    h.server.cache.invalidate()
    const roots = await json<{
      total: number
      items: Array<{ id: string; path: string; mediaType: string }>
    }>('/media?fetch=children:/')
    expect(roots.items).toMatchObject([{ id: folder.key, path: '/photos/', mediaType: 'Folder' }])
    const inside = await json<{ items: Array<{ id: string; path: string }> }>(
      '/media?fetch=children:/photos',
    )
    expect(inside.items).toMatchObject([{ id: image.key, path: '/photos/harbour view/' }])
    expect((await json<{ id: string }>('/media/item/photos/harbour view')).id).toBe(image.key)
    expect((await json<{ id: string }>(`/media/item/${image.key}`)).id).toBe(image.key)
  })

  test('rich text is the tree: links to pages and media resolved, comments dropped', async () => {
    const { h, json, page, news, other } = await site()
    const media = new DocumentRepository(h.server.db, {
      kind: 'media',
      nodeState: h.server.schema.nodeState,
    })
    const image = await media.create({
      key: crypto.randomUUID(),
      contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Image,
      componentKey: null,
      parentKey: null,
      variants: [{ culture: null, segment: null, name: 'Harbour' }],
      values: [
        {
          alias: 'umbracoFile',
          culture: null,
          segment: null,
          value: { src: '/media/abc/harbour.jpg' },
        },
      ],
    })
    const hex = (key: string) => key.replaceAll('-', '')
    const key = await page(
      'Article',
      news,
      undefined,
      `<p>Read <a href="/{localLink:umb://document/${hex(other)}}#top">other</a><!-- note --></p>\n<p><img src="/old.jpg?width=200" data-udi="umb://media/${hex(image.key)}"></p>`,
    )
    h.server.cache.invalidate()
    const item = await json<Item>(`/content/item/${key}`)
    expect(item.properties.body).toEqual({
      tag: '#root',
      attributes: {},
      elements: [
        {
          $type: 'RichTextGenericElement',
          tag: 'p',
          attributes: {},
          elements: [
            { $type: 'RichTextTextElement', text: 'Read ', tag: '#text' },
            {
              $type: 'RichTextGenericElement',
              tag: 'a',
              attributes: {
                destinationId: other,
                destinationType: 'page',
                linkType: 'Content',
                route: {
                  path: '/other',
                  queryString: '#top',
                  startItem: { id: other, path: 'other' },
                },
              },
              elements: [{ $type: 'RichTextTextElement', text: 'other', tag: '#text' }],
            },
          ],
        },
        {
          $type: 'RichTextGenericElement',
          tag: 'p',
          attributes: {},
          elements: [
            {
              $type: 'RichTextGenericElement',
              tag: 'img',
              attributes: { src: '/media/abc/harbour.jpg?width=200' },
              elements: [],
            },
          ],
        },
      ],
      blocks: [],
    })
  })

  test('media lists are paged by the database: Umbraco’s order, sorts, filters and the total', async () => {
    const { h, json } = await site({ enabled: true, media: { enabled: true } })
    const media = new DocumentRepository(h.server.db, {
      kind: 'media',
      nodeState: h.server.schema.nodeState,
    })
    const folder = await media.create({
      key: crypto.randomUUID(),
      contentTypeKey: SYSTEM_MEDIA_TYPE_KEYS.Folder,
      componentKey: null,
      parentKey: null,
      variants: [{ culture: null, segment: null, name: 'Library' }],
      values: [],
    })
    const names = ['Kestrel', 'avocet', 'Bittern', 'Curlew', 'dunlin', 'Egret', 'Fulmar']
    const made: string[] = []
    for (const [index, name] of names.entries())
      made.push(
        (
          await media.create({
            key: crypto.randomUUID(),
            contentTypeKey:
              index === 3 ? SYSTEM_MEDIA_TYPE_KEYS.Folder : SYSTEM_MEDIA_TYPE_KEYS.Image,
            componentKey: null,
            parentKey: folder.key,
            variants: [{ culture: null, segment: null, name }],
            values: [],
          })
        ).key,
      )
    type Listing = { total: number; items: Array<{ id: string; name: string; path: string }> }
    const list = (query: string) => json<Listing>(`/media?fetch=children:/library${query}`)

    // Sort order, then the node id: the order they were made
    const page = await list('&skip=2&take=3')
    expect(page.total).toBe(7)
    expect(page.items.map((m) => m.name)).toEqual(['Bittern', 'Curlew', 'dunlin'])
    expect(page.items[0]?.path).toBe('/library/bittern/')
    // By name, in any case, with the rest kept in order
    expect((await list('&sort=name:asc&take=3')).items.map((m) => m.name)).toEqual([
      'avocet',
      'Bittern',
      'Curlew',
    ])
    expect((await list('&sort=name:desc&take=2')).items.map((m) => m.name)).toEqual([
      'Kestrel',
      'Fulmar',
    ])
    // Filters narrow the total too
    const birds = await list('&filter=mediaType:Image&filter=name:L&take=10')
    expect(birds.items.map((m) => m.name)).toEqual(['Kestrel', 'dunlin', 'Fulmar'])
    expect(birds.total).toBe(3)
    // Past the end: the total, and nothing
    expect(await list('&skip=50&take=10')).toEqual({ total: 7, items: [] })
    // Items keep the order asked for, and leave out what is not there
    const items = await json<Array<{ id: string }>>(
      `/media/items?id=${made[4]}&id=${crypto.randomUUID()}&id=${made[0]}`,
    )
    expect(items.map((m) => m.id)).toEqual([made[4] as string, made[0] as string])
    // By path, in any case
    expect((await json<{ id: string }>('/media/item/LIBRARY/EGRET')).id).toBe(made[5] as string)
  })
})

describe('requests from another origin', () => {
  const policy = (allowedOrigins: string[], publicAccess = true) =>
    corsPolicy(resolveDeliveryApiSettings({ publicAccess, cors: { allowedOrigins } }))
  const from = (origin: string) => new Request(`${ORIGIN}/x`, { headers: { origin } })

  test('allow exact origins only, in any case, and say why a malformed one is ignored', () => {
    const p = policy([
      'https://App.example.com',
      'http://localhost:5173/',
      'app.example.com',
      'https://example.com/app',
      'https://example.com?x=1',
    ])
    expect([...p.origins]).toEqual(['https://app.example.com', 'http://localhost:5173'])
    expect(p.problems).toHaveLength(3)
    expect(p.problems[0]).toContain('"app.example.com"')
    expect(allowedOrigin(p, from('https://app.example.com'))).toBe('https://app.example.com')
    expect(allowedOrigin(p, from('https://APP.example.com'))).toBe('https://APP.example.com')
    expect(allowedOrigin(p, from('https://evil.example.com'))).toBeUndefined()
    expect(allowedOrigin(p, from('https://app.example.com.evil.com'))).toBeUndefined()
  })

  test('accept * only while the API is public', () => {
    expect(allowedOrigin(policy(['*']), from('https://any.example.com'))).toBe('*')
    const closed = policy(['*'], false)
    expect(closed.any).toBe(false)
    expect(closed.problems[0]).toContain('not public')
    expect(allowedOrigin(closed, from('https://any.example.com'))).toBeUndefined()
  })

  test('cover the API and the token endpoints, never sign-in or sign-out', () => {
    expect(corsMethodsFor('v2/content/item/x')).toBe('GET, HEAD')
    expect(corsMethodsFor('v2/media')).toBe('GET, HEAD')
    expect(corsMethodsFor('v2/search')).toBe('GET, HEAD')
    expect(corsMethodsFor('v1/security/member/token')).toBe('POST')
    expect(corsMethodsFor('v1/security/member/revoke')).toBe('POST')
    expect(corsMethodsFor('v1/security/member/userinfo')).toBe('GET, POST')
    expect(corsMethodsFor('v1/security/member/authorize')).toBeUndefined()
    expect(corsMethodsFor('v1/security/member/signout')).toBeUndefined()
  })

  const APP = 'https://app.example.com'
  const SECURITY = '/umbraco/delivery/api/v1/security/member'
  const preflight = (path: string, origin = APP) =>
    new Request(`${ORIGIN}${path}`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'api-key, accept-language',
      },
    })

  test('a listed origin reads content, and the answer varies by origin', async () => {
    const { get, story } = await site({ enabled: true, cors: { allowedOrigins: [APP] } })
    const allowed = await get(`/content/item/${story}`, { origin: APP })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(APP)
    expect(allowed.headers.get('access-control-allow-credentials')).toBeNull()
    expect(allowed.headers.get('vary')).toBe(
      'Accept-Language, Accept-Segment, Preview, Start-Item, Origin',
    )
    const other = await get(`/content/item/${story}`, { origin: 'https://evil.example.com' })
    expect(other.status).toBe(200)
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('a pre-flight names the methods and the headers the API reads', async () => {
    const { h } = await site({ enabled: true, cors: { allowedOrigins: [APP] } })
    const content = await h.server.fetch(preflight(`${API}/content`))
    expect(content.status).toBe(204)
    expect(content.headers.get('access-control-allow-origin')).toBe(APP)
    expect(content.headers.get('access-control-allow-methods')).toBe('GET, HEAD')
    expect(content.headers.get('access-control-allow-headers')).toBe(
      'Accept-Language, Api-Key, Authorization, Content-Type, Preview, Preview-Token, Start-Item',
    )
    const token = await h.server.fetch(preflight(`${SECURITY}/token`))
    expect(token.headers.get('access-control-allow-methods')).toBe('POST')
    const refused = await h.server.fetch(preflight(`${API}/content`, 'https://evil.example.com'))
    expect(refused.status).toBe(204)
    expect(refused.headers.get('access-control-allow-origin')).toBeNull()
    expect(refused.headers.get('access-control-allow-methods')).toBeNull()
  })

  test('a refusal still carries the header, so the app can read its status', async () => {
    const { get, h } = await site({
      enabled: true,
      publicAccess: false,
      cors: { allowedOrigins: [APP] },
    })
    const refused = await get('/content', { origin: APP })
    expect(refused.status).toBe(401)
    expect(refused.headers.get('access-control-allow-origin')).toBe(APP)
    const missing = await get(`/content/item/${crypto.randomUUID()}`, {
      origin: APP,
      'api-key': 'wrong',
    })
    expect(missing.headers.get('access-control-allow-origin')).toBe(APP)
    const token = await h.server.fetch(
      new Request(`${ORIGIN}${SECURITY}/token`, { method: 'POST', headers: { origin: APP } }),
    )
    expect(token.headers.get('access-control-allow-origin')).toBe(APP)
  })

  test('sign-in and sign-out are navigations, and get no header', async () => {
    const { h } = await site({ enabled: true, cors: { allowedOrigins: [APP] } })
    const signIn = await h.server.fetch(
      new Request(`${ORIGIN}${SECURITY}/authorize`, { headers: { origin: APP } }),
    )
    expect(signIn.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('with no origins listed nothing changes', async () => {
    const { get, h, story } = await site()
    const response = await get(`/content/item/${story}`, { origin: APP })
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(response.headers.get('vary')).toBe(
      'Accept-Language, Accept-Segment, Preview, Start-Item',
    )
    expect((await h.server.fetch(preflight(`${API}/content`))).status).toBe(405)
  })
})
