/**
 * Story 054: one lookup answers a route — the page, a redirect, or not found
 * with the site's not-found page — as the rendered site would at that address.
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
  RedirectRepository,
} from '@crombolo/data'
import { type RedirectRule, redirect } from '@crombolo/render'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

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
alias = "umbracoRedirect"
name = "Send visitors to"
type = "contentPicker"
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

type Answer = {
  kind: 'page' | 'redirect' | 'notFound'
  culture?: string | null
  item?: { id: string; name: string } | null
  location?: string
  statusCode?: number
  permanent?: boolean
}

async function site(
  options: { redirects?: RedirectRule[]; deliveryApi?: DeliveryApiOptions } = {},
) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'delivery-route-'))
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
      deliveryApi: options.deliveryApi ?? { enabled: true, apiKey: 'key' },
      redirects: options.redirects ?? [],
    },
  })
  open.push(h)
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const page = async (
    name: string,
    parentKey: string | null,
    { publish = true, sendTo }: { publish?: boolean; sendTo?: string } = {},
  ) => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: typeKey,
      componentKey,
      parentKey,
      variants: [{ culture: null, segment: null, name }],
      values: [
        { alias: 'title', culture: null, segment: null, value: `${name} title` },
        ...(sendTo
          ? [
              {
                alias: 'umbracoRedirect',
                culture: null,
                segment: null,
                value: `umb://document/${sendTo.replaceAll('-', '')}`,
              },
            ]
          : []),
      ],
    })
    if (publish) await docs.publish(doc.key, null)
    return doc.key
  }
  const home = await page('Home', null)
  const news = await page('News', home)
  const story = await page('Story', news)
  const draft = await page('Draft', news, { publish: false })
  h.server.cache.invalidate()
  const route = async (query: string, headers: Record<string, string> = {}) => {
    const response = await h.server.fetch(
      new Request(`${ORIGIN}/umbraco/delivery/api/v2/route?${query}`, { headers }),
    )
    return {
      status: response.status,
      response,
      body:
        response.status === 401 || response.status === 403
          ? undefined
          : ((await response.json()) as Answer),
    }
  }
  return { h, page, home, news, story, draft, route }
}

describe('a page', () => {
  test('answers the page as item/{path} would, with its culture', async () => {
    const { route, story } = await site()
    const { status, body } = await route('path=/news/story')
    expect(status).toBe(200)
    expect(body?.kind).toBe('page')
    expect(body?.item).toMatchObject({ id: story, name: 'Story' })
    expect((await route('path=news/story/')).body?.item?.id).toBe(story)
  })

  test('a page that sends its visitors elsewhere is a temporary redirect', async () => {
    const { route, page, home, story } = await site()
    await page('Moved', home, { sendTo: story })
    const { body } = await route('path=/moved')
    expect(body).toMatchObject({
      kind: 'redirect',
      location: '/news/story',
      statusCode: 302,
      permanent: false,
    })
  })

  test('the hostname picks the root and the culture, as domains do on the site', async () => {
    const { h, route, page, home } = await site()
    const other = await page('Other', null)
    expect(
      (
        await h.put(`${V1}/document/${other}/domains`, {
          defaultIsoCode: 'en-US',
          domains: [{ domainName: 'other.example', isoCode: 'en-US' }],
        })
      ).status,
    ).toBe(200)
    h.server.cache.invalidate()
    const there = await route('path=/&host=other.example')
    expect(there.body).toMatchObject({ kind: 'page', culture: 'en-US', item: { id: other } })
    expect((await route('path=/')).body?.item?.id).toBe(home)
  })

  test('a members-only page is a 401, as the item endpoints answer', async () => {
    const { h, route, story, home } = await site()
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: story,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    h.server.cache.invalidate()
    expect((await route('path=/news/story')).status).toBe(401)
  })

  test('a draft is a page only in preview', async () => {
    const { route, draft } = await site()
    expect((await route('path=/news/draft')).body?.kind).toBe('notFound')
    const previewed = await route('path=/news/draft', { preview: 'true', 'api-key': 'key' })
    expect(previewed.body).toMatchObject({ kind: 'page', item: { id: draft } })
    expect(previewed.response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('a redirect', () => {
  test('declared rules first, then the URL tracker, as the site', async () => {
    const { h, route, news, story } = await site({
      redirects: [redirect('/old-news/*', '/news/$1')],
    })
    const tracked = (pattern: string, target: string) =>
      new RedirectRepository(h.server.db).save({
        source: 'tracked',
        matchKind: 'exact',
        pattern,
        rootKey: null,
        culture: null,
        targetKind: 'document',
        target,
        statusCode: 301,
        sortOrder: 0,
      })
    // The tracker would send this one to News; the declared rule, tried first, does not.
    await tracked('/old-news/story', news)
    await tracked('/earlier-story', story)
    h.server.cache.invalidate()
    expect((await route('path=/old-news/story')).body).toMatchObject({
      kind: 'redirect',
      location: '/news/story',
      statusCode: 301,
      permanent: true,
    })
    const fromTracker = await route('path=/earlier-story')
    expect(fromTracker.body).toMatchObject({ kind: 'redirect', location: '/news/story' })
    expect(fromTracker.response.headers.get('cache-control')).toBe('no-store')
  })

  test('never hides a live page', async () => {
    const { route, news } = await site({ redirects: [redirect('/news', '/elsewhere')] })
    expect((await route('path=/news')).body).toMatchObject({ kind: 'page', item: { id: news } })
  })
})

describe('not found', () => {
  test('is a 404 naming the site’s not-found page when it has one', async () => {
    const { h, route, home, page } = await site()
    const nowhere = await route('path=/nowhere')
    expect(nowhere.status).toBe(404)
    expect(nowhere.body).toEqual({ kind: 'notFound', item: null })
    const missing = await page('Not found', home)
    h.server.cache.invalidate()
    expect(
      (
        await h.put(`${BACKOFFICE}/crombolo/api/seo/settings`, {
          notFoundPage: [{ document: missing }],
        })
      ).status,
    ).toBe(200)
    const configured = await route('path=/nowhere')
    expect(configured.status).toBe(404)
    expect(configured.body).toMatchObject({
      kind: 'notFound',
      item: { id: missing, name: 'Not found' },
    })
  })

  test('needs a path', async () => {
    const { route } = await site()
    expect((await route('host=example.com')).status).toBe(400)
  })
})
