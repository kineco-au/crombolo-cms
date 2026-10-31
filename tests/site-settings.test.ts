/**
 * Story 058: the dictionary as a map from the Delivery API, and a site's
 * settings: a type marked `site-settings`, its page a root's child with no
 * address, read by templates as `settings` and by apps from `v2/settings`.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  NodeRepository,
  siteEntriesFor,
} from '@crombolo/data'
import { createDeliveryClient } from '@crombolo/delivery-client'
import { generateDeliveryTypes, parseContentType, writeContentType } from '@crombolo/schema'
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

const API = '/umbraco/delivery/api/v2'

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page", "siteSettings"]
components = ["page"]
default-component = "page"
`

const SETTINGS_TOML = `[content-type]
alias = "siteSettings"
name = "Site settings"
site-settings = true

[[property]]
alias = "phone"
name = "Phone"
type = "textstring"
`

/** Writes the settings page's phone, and the root's child pages as links. */
const VIEW = `export default function Page({ model, nav, settings }) {
  const top = nav.ancestors(model).at(-1) ?? model
  return <main data-phone={settings?.value('phone') ?? 'none'}>{nav.children(top).map((c) => c.name).join(',')}</main>
}
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'site-settings-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'schema', 'content-types', 'site-settings.toml'), SETTINGS_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      deliveryApi: { enabled: true },
    },
  })
  open.push(h)
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const types = new ContentTypeRepository(db)
  const pageType = (await types.byAlias('page'))?.key as string
  const settingsType = (await types.byAlias('siteSettings'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const make = async (name: string, parentKey: string | null, phone?: string) => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: phone === undefined ? pageType : settingsType,
      componentKey: phone === undefined ? componentKey : null,
      parentKey,
      variants: [{ culture: null, segment: null, name }],
      values:
        phone === undefined ? [] : [{ alias: 'phone', culture: null, segment: null, value: phone }],
    })
    await docs.publish(doc.key, null)
    return doc.key
  }
  const home = await make('Home', null)
  const about = await make('About', home)
  const settings = await make('Settings', home, '+44 1 2345')
  h.server.cache.invalidate()
  await h.server.cache.fresh()
  const visit = async (path: string) => {
    const response = await h.server.fetch(new Request(`${ORIGIN}${path}`))
    return { status: response.status, html: await response.text() }
  }
  return { h, make, home, about, settings, visit }
}

describe('a site-settings type in schema/', () => {
  test('is read, written back, and refused on an element type', () => {
    const parsed = parseContentType('site-settings.toml', SETTINGS_TOML)
    expect(parsed.problems).toEqual([])
    expect(parsed.value?.siteSettings).toBe(true)
    expect(writeContentType(parsed.value as never)).toContain('site-settings = true')
    const element = parseContentType(
      'x.toml',
      SETTINGS_TOML.replace('site-settings = true', 'site-settings = true\nis-element = true'),
    )
    expect(element.problems.map((p) => p.message).join()).toContain('cannot be a site')
  })
})

describe('the settings page', () => {
  test('has no address, and is left out of navigation and the sitemap', async () => {
    const { h, visit } = await site()
    expect((await visit('/settings')).status).toBe(404)
    const home = await visit('/')
    expect(home.html).toContain('data-phone="+44 1 2345"')
    // The root's children, as a template lists them: the settings page is not one.
    expect(home.html).toContain('>About</main>')
    const sitemap = await (await h.server.fetch(new Request(`${ORIGIN}/sitemap.xml`))).text()
    expect(sitemap).toContain('/about')
    expect(sitemap).not.toContain('settings')
  })

  test('is what v2/settings answers, and content/item by key still reaches it', async () => {
    const { h, settings } = await site()
    const body = await h.json<{
      id: string
      contentType: string
      route: { path: string }
      properties: { phone: string }
    }>(`${API}/settings`)
    expect(body).toMatchObject({
      id: settings,
      contentType: 'siteSettings',
      route: { path: '#' },
      properties: { phone: '+44 1 2345' },
    })
    expect((await h.json<{ id: string }>(`${API}/content/item/${settings}`)).id).toBe(settings)
    const children = await h.json<{ items: { name: string }[] }>(
      `${API}/content?fetch=children:/&take=10`,
    )
    expect(children.items.map((item) => item.name)).toEqual(['About'])
  })

  test('is found under the Start-Item root, and is a 404 for a root with none', async () => {
    const { h, make } = await site()
    const other = await make('Other', null)
    h.server.cache.invalidate()
    await h.server.cache.fresh()
    const response = await h.call(`${API}/settings`, { headers: { 'start-item': other } })
    expect(response.status).toBe(404)
    expect((await h.call(`${API}/settings`, { headers: { 'start-item': 'nowhere' } })).status).toBe(
      404,
    )
  })

  test('is never indexed for site search', async () => {
    const { h, about, settings } = await site()
    const nodes = new NodeRepository(h.server.db)
    const idOf = async (key: string) => (await nodes.byKey(key))?.id as number
    expect(await siteEntriesFor(h.server.db, await idOf(settings))).toEqual([])
    expect((await siteEntriesFor(h.server.db, await idOf(about))).length).toBeGreaterThan(0)
  })

  test('a second, or one deeper, is named by the status check', async () => {
    const { h, home, about, make } = await site()
    await make('Settings again', home, '0')
    await make('Lost settings', about, '0')
    h.server.cache.invalidate()
    await h.server.cache.fresh()
    const findings = await h.server.cache.settingsFindings()
    expect(findings.map((f) => [f.kind, f.name])).toEqual([
      ['deep', 'Lost settings'],
      ['second', 'Settings again'],
    ])
    expect(findings.find((f) => f.kind === 'second')?.counted).toBe('Settings')
    const group = (await (await h.post(`${V1}/health-check-group/Site/check`, {})).json()) as {
      checks: { results: { message: string }[] }[]
    }
    const messages = group.checks.flatMap((check) => check.results.map((r) => r.message)).join('\n')
    expect(messages).toContain('"Settings again" is a second settings page')
    expect(messages).toContain('"Lost settings" is a settings page below another page')
  })

  test('the delivery client reads it, and generated types name the settings type', async () => {
    const { h } = await site()
    const client = createDeliveryClient({
      baseUrl: ORIGIN,
      fetch: (input, init) => h.server.fetch(new Request(input, init)),
    })
    expect((await client.settings())?.contentType).toBe('siteSettings')
    const parsed = parseContentType('site-settings.toml', SETTINGS_TOML).value
    const page = parseContentType('page.toml', PAGE_TOML).value
    const types = generateDeliveryTypes({
      version: '1.0.0',
      contentTypes: [page, parsed],
      dataTypes: [],
      languages: [],
    } as never)
    expect(types).toContain("settings: 'siteSettings'")
  })
})

describe('v2/dictionary', () => {
  test('every item in the culture, falling back, narrowed by keys', async () => {
    const { h } = await site()
    await h.post(`${V1}/language`, {
      isoCode: 'da-DK',
      name: 'Danish',
      isDefault: false,
      isMandatory: false,
      fallbackIsoCode: 'en-US',
    })
    const item = async (name: string, translations: Record<string, string>) =>
      expect(
        (
          await h.post(`${V1}/dictionary`, {
            name,
            parent: null,
            translations: Object.entries(translations).map(([isoCode, translation]) => ({
              isoCode,
              translation,
            })),
          })
        ).status,
      ).toBe(201)
    await item('ReadMore', { 'en-US': 'Read more', 'da-DK': 'Læs mere' })
    await item('Back', { 'en-US': 'Back' })
    await item('Empty', {})
    expect(await h.json<Record<string, string>>(`${API}/dictionary`)).toEqual({
      Back: 'Back',
      Empty: '',
      ReadMore: 'Read more',
    })
    expect(
      await (await h.call(`${API}/dictionary`, { headers: { 'accept-language': 'da-DK' } })).json(),
    ).toEqual({ Back: 'Back', Empty: '', ReadMore: 'Læs mere' })
    expect(await h.json<Record<string, string>>(`${API}/dictionary?keys=ReadMore,Missing`)).toEqual(
      {
        ReadMore: 'Read more',
        Missing: '',
      },
    )
    const response = await h.call(`${API}/dictionary`)
    expect(response.headers.get('etag')).toBeTruthy()
    const client = createDeliveryClient({
      baseUrl: ORIGIN,
      fetch: (input, init) => h.server.fetch(new Request(input, init)),
    })
    expect(await client.dictionary(['Back'])).toEqual({ Back: 'Back' })
  })

  test('needs the API key when the API is not public', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'site-settings-'))
    dirs.push(root)
    const h = await signedInServer({
      config: { deliveryApi: { enabled: true, publicAccess: false, apiKey: 'secret' } },
    })
    open.push(h)
    expect((await h.server.fetch(new Request(`${ORIGIN}${API}/dictionary`))).status).toBe(401)
    expect(
      (
        await h.server.fetch(
          new Request(`${ORIGIN}${API}/dictionary`, { headers: { 'api-key': 'secret' } }),
        )
      ).status,
    ).toBe(200)
    expect((await h.server.fetch(new Request(`${ORIGIN}${API}/settings`))).status).toBe(401)
  })
})
