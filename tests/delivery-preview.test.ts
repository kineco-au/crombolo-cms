/**
 * Story 053: an app previews drafts. The Delivery API answers `Preview: true`
 * from every page as last saved, for the API key or an editor's preview token,
 * and the backoffice's Preview button opens the app with one.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type DeliveryApiOptions,
  fillPreviewUrl,
  previewProblems,
  previewUrlFor,
  resolveDeliveryApiSettings,
} from '@crombolo/api-delivery'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  PublicAccessRepository,
} from '@crombolo/data'
import {
  readPreviewToken,
  signPreviewToken,
  stampDigest,
} from '../packages/server/src/preview-tokens.ts'
import { type Harness, ORIGIN, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

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

const API = '/umbraco/delivery/api/v2'
const APP = 'https://app.example.com/preview?path={path}&id={id}&culture={culture}&token={token}'

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

type Item = {
  id: string
  name: string
  properties: Record<string, unknown>
  route: { path: string }
}

/**
 * Home and News published; News has a newer unpublished title; Draft, below
 * News, was never published; Story is published and picks Draft.
 */
async function site(deliveryApi: DeliveryApiOptions = { enabled: true, apiKey: 'key' }) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'delivery-preview-'))
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
  const input = (key: string, name: string, parentKey: string | null, related?: string) => ({
    key,
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
  const page = async (name: string, parentKey: string | null, publish = true, related?: string) => {
    const doc = await docs.create(input(crypto.randomUUID(), name, parentKey, related))
    if (publish) await docs.publish(doc.key, null)
    return doc.key
  }
  const home = await page('Home', null)
  const news = await page('News', home)
  const draft = await page('Draft', news, false)
  const story = await page('Story', home, true, draft)
  await docs.update({
    ...input(news, 'News', home),
    values: [{ alias: 'title', culture: null, segment: null, value: 'News, rewritten' }],
  })
  h.server.cache.invalidate()
  const get = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${API}${path}`, { headers }))
  const json = async <T = Item>(path: string, headers: Record<string, string> = {}) => {
    const response = await get(path, headers)
    expect(response.status, path).toBe(200)
    return (await response.json()) as T
  }
  return { h, docs, input, home, news, draft, story, get, json }
}

const KEYED = { preview: 'true', 'api-key': 'key' }

describe('previewing with the API key', () => {
  test('answers drafts: an unpublished page, a newer title, a picker to a draft', async () => {
    const { get, json, draft, news, story } = await site()
    expect((await get(`/content/item/${draft}`)).status).toBe(404)
    expect((await json(`/content/item/${draft}`, KEYED)).name).toBe('Draft')
    expect((await json(`/content/item/${draft}`, KEYED)).route.path).toBe('/news/draft')
    expect((await json('/content/item/news/draft', KEYED)).id).toBe(draft)

    expect((await json(`/content/item/${news}`)).properties.title).toBe('News title')
    expect((await json(`/content/item/${news}`, KEYED)).properties.title).toBe('News, rewritten')

    const children = await json<{ items: Item[] }>(`/content?fetch=children:${news}`, KEYED)
    expect(children.items.map((i) => i.id)).toEqual([draft])
    expect((await json<{ items: Item[] }>(`/content?fetch=children:${news}`)).items).toEqual([])

    const picked = await json(`/content/item/${story}?expand=properties[related]`, KEYED)
    expect((picked.properties.related as Item).properties.title).toBe('Draft title')
  })

  test('is never cached, and answers Umbraco’s preview address only in preview', async () => {
    const { get, draft } = await site()
    const response = await get(`/content/item/${draft}`, KEYED)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(
      (await get(`/content/item/${crypto.randomUUID()}`, KEYED)).headers.get('cache-control'),
    ).toBe('no-store')
    expect((await get(`/content/item/preview-${draft}`, KEYED)).status).toBe(200)
    expect((await get(`/content/item/preview-${draft}`)).status).toBe(404)
    const published = await get(`/content/item/${crypto.randomUUID()}`)
    expect(published.headers.get('cache-control')).toBeNull()
  })

  test('is refused without the key or a token, even on a public API', async () => {
    const { get, draft } = await site()
    expect((await get(`/content/item/${draft}`, { preview: 'true' })).status).toBe(401)
    expect(
      (await get(`/content/item/${draft}`, { preview: 'true', 'api-key': 'wrong' })).status,
    ).toBe(401)
    expect(
      (await get(`/content/item/${draft}`, { preview: 'true', 'preview-token': 'nonsense' }))
        .status,
    ).toBe(401)
  })

  test('sees the next save, wherever it was made', async () => {
    const { docs, input, json, draft, news } = await site()
    expect((await json(`/content/item/${draft}`, KEYED)).properties.title).toBe('Draft title')
    // Straight to the repository, as another node would write it: nothing here is told.
    await docs.update({
      ...input(draft, 'Draft', news),
      values: [{ alias: 'title', culture: null, segment: null, value: 'Draft, again' }],
    })
    expect((await json(`/content/item/${draft}`, KEYED)).properties.title).toBe('Draft, again')
  })

  test('still keeps members-only pages from a caller who is not let in', async () => {
    const { h, get, draft, home } = await site()
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: draft,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    h.server.cache.invalidate()
    expect((await get(`/content/item/${draft}`, KEYED)).status).toBe(401)
  })
})

const WITH_APP: DeliveryApiOptions = {
  enabled: true,
  apiKey: 'key',
  preview: { url: APP },
}

async function previewUrl(h: Harness, key: string, providerAlias = 'cromboloAppPreview') {
  return h.json<{ url: string | null; isExternal: boolean; message: string | null }>(
    `${V1}/document/${key}/preview-url?providerAlias=${providerAlias}&culture=`,
  )
}

const tokenIn = (url: string) => new URL(url).searchParams.get('token') as string

describe('Preview in app', () => {
  test('opens the app with the page’s path and a token that reads drafts', async () => {
    const { h, get, draft } = await site(WITH_APP)
    const answer = await previewUrl(h, draft)
    expect(answer.isExternal).toBe(true)
    const url = new URL(answer.url as string)
    expect(`${url.origin}${url.pathname}`).toBe('https://app.example.com/preview')
    expect(url.searchParams.get('path')).toBe('/news/draft')
    expect(url.searchParams.get('id')).toBe(draft)
    const token = tokenIn(answer.url as string)
    const response = await get(`/content/item/${draft}`, {
      preview: 'true',
      'preview-token': token,
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as Item).name).toBe('Draft')
    // A token is not a key: without Preview it reads what is published, like anyone.
    expect((await get(`/content/item/${draft}`, { 'preview-token': token })).status).toBe(404)
  })

  test('keeps the built-in preview for the other provider, and is offered only when set up', async () => {
    const { h, draft } = await site(WITH_APP)
    const builtIn = await previewUrl(h, draft, 'umbDocumentUrlProvider')
    expect(builtIn.isExternal).toBe(false)
    expect(builtIn.url).toStartWith('preview?id=')
    const manifests = await h.json<Array<{ id?: string }>>(`${V1}/manifest/manifest/private`)
    expect(manifests.map((m) => m.id)).toContain('Crombolo.AppPreview')

    const plain = await site()
    const without = await plain.h.json<Array<{ id?: string }>>(`${V1}/manifest/manifest/private`)
    expect(without.map((m) => m.id)).not.toContain('Crombolo.AppPreview')
  })

  test('a token reads only what its editor may read', async () => {
    const { h, get, json, news, story, draft } = await site(WITH_APP)
    const created = await h.post(`${V1}/user-group`, {
      name: 'News desk',
      alias: 'newsDesk',
      sections: ['Umb.Section.Content'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: false,
      documentStartNode: { id: news },
      mediaRootAccess: false,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: ['Umb.Document.Read'],
      permissions: [],
    })
    expect(created.status).toBe(201)
    const desk = await signInAsGroup(h, 'newsDesk')
    open.push(desk)
    const token = tokenIn((await previewUrl(desk, draft)).url as string)
    const as = { preview: 'true', 'preview-token': token }
    expect((await get(`/content/item/${draft}`, as)).status).toBe(200)
    expect((await get(`/content/item/${story}`, as)).status).toBe(404)
    const all = await json<{ items: Item[] }>('/content', as)
    expect(all.items.map((i) => i.id).sort()).toEqual([news, draft].sort())
    // Outside their start node, the page cannot be previewed at all.
    expect(
      (await desk.call(`${V1}/document/${story}/preview-url?providerAlias=cromboloAppPreview`))
        .status,
    ).toBe(403)
  })

  test('stops working when the editor is locked out or changes their password', async () => {
    const { h, get, draft } = await site(WITH_APP)
    const desk = await signInAsGroup(h, 'writer')
    open.push(desk)
    const token = tokenIn((await previewUrl(desk, draft)).url as string)
    const as = { preview: 'true', 'preview-token': token }
    expect((await get(`/content/item/${draft}`, as)).status).toBe(200)
    await h.server.db.exec('UPDATE user_account SET security_stamp = ? WHERE login = ?', [
      'changed',
      'writer@example.com',
    ])
    expect((await get(`/content/item/${draft}`, as)).status).toBe(401)

    const fresh = tokenIn((await previewUrl(desk, draft)).url as string)
    expect(
      (await get(`/content/item/${draft}`, { preview: 'true', 'preview-token': fresh })).status,
    ).toBe(200)
    await h.server.db.exec('UPDATE user_account SET is_locked_out = ? WHERE login = ?', [
      h.server.db.dialect.boolValue(true),
      'writer@example.com',
    ])
    expect(
      (await get(`/content/item/${draft}`, { preview: 'true', 'preview-token': fresh })).status,
    ).toBe(401)
  })

  test('says so when the page’s type has no preview address', async () => {
    const { h, draft } = await site({
      enabled: true,
      preview: { urls: { other: 'https://app.example.com/{path}' } },
    })
    const answer = await previewUrl(h, draft)
    expect(answer.url).toBeNull()
    expect(answer.message).toContain('no preview address')
  })
})

describe('preview tokens and settings', () => {
  test('a token is refused when tampered with, signed elsewhere or expired', () => {
    const claims = { user: 1, stamp: stampDigest('s'), expires: Date.now() + 60_000 }
    const token = signPreviewToken('secret', claims)
    expect(readPreviewToken('secret', token)).toEqual(claims)
    expect(readPreviewToken('other', token)).toBeUndefined()
    const [payload, signature] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...claims, user: 2 })).toString('base64url')
    expect(readPreviewToken('secret', `${forged}.${signature}`)).toBeUndefined()
    expect(readPreviewToken('secret', `${payload}.${signature}.x`)).toBeUndefined()
    expect(readPreviewToken('secret', token, claims.expires + 1)).toBeUndefined()
  })

  test('preview addresses: per type first, malformed ones said and never used, values escaped', () => {
    const settings = resolveDeliveryApiSettings({
      preview: { url: 'https://app.example.com/{path}', urls: { news: 'app.example.com/news' } },
    })
    expect(settings.preview.tokenMinutes).toBe(60)
    expect(previewProblems(settings)).toEqual([
      'The preview.urls.news "app.example.com/news" is ignored: it must start with the app\'s address, such as https://app.example.com.',
    ])
    expect(previewUrlFor(settings, 'news')).toBeUndefined()
    expect(previewUrlFor(settings, 'page')).toBe('https://app.example.com/{path}')
    expect(
      fillPreviewUrl('https://a.example/p{path}?c={culture}&t={token}&id={id}', {
        path: '/news/a b',
        id: 'k',
        culture: null,
        token: 'x.y+z',
      }),
    ).toBe('https://a.example/p/news/a%20b?c=&t=x.y%2Bz&id=k')
  })
})
