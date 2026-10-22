/**
 * Story 141: navigation menus, made in the Library as Menu elements and read by
 * alias — `menu('main')` in a template, `v2/menus/main` from the Delivery API.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_CONTENT_TYPE_KEYS, safeAlias } from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  type NodeRow,
  PublicAccessRepository,
} from '@crombolo/data'
import { exportBundle, importBundle } from '@crombolo/transfer'
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
allow-children = ["page"]
components = ["page"]
default-component = "page"
`

/** Draws the main menu as `label=url`, items below in brackets. */
const VIEW = `const draw = (items) => items.map((i) => i.label + '=' + (i.url ?? '-') + (i.children.length ? '[' + draw(i.children) + ']' : '')).join('|')
export default function Page(props) {
  return <main>{draw(props.menu('main'))}</main>
}
`

type Entry = { page?: string; url?: string; label?: string; children?: Entry[] }

/** A menu's items as the block list stores them. */
function blocks(entries: Entry[]): Record<string, unknown> {
  const keyed = entries.map((entry) => ({ entry, key: crypto.randomUUID() }))
  return {
    layout: { 'Umbraco.BlockList': keyed.map(({ key }) => ({ contentKey: key })) },
    contentData: keyed.map(({ entry, key }) => ({
      key,
      contentTypeKey: SYSTEM_CONTENT_TYPE_KEYS.MenuItem,
      values: [
        {
          alias: 'link',
          value: entry.page
            ? [{ unique: entry.page, type: 'document', name: '', target: null }]
            : entry.url
              ? [{ type: 'external', url: entry.url, name: 'Elsewhere', target: '_blank' }]
              : [],
        },
        { alias: 'label', value: entry.label ?? '' },
        { alias: 'children', value: blocks(entry.children ?? []) },
      ],
    })),
    settingsData: [],
  }
}

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'menus-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
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
  const elements = new DocumentRepository(db, {
    nodeState: h.server.schema.nodeState,
    kind: 'element',
  })
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const page = async (name: string, parentKey: string | null, publish = true) => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: typeKey,
      componentKey,
      parentKey,
      variants: [{ culture: null, segment: null, name }],
      values: [],
    })
    if (publish) await docs.publish(doc.key, null)
    return doc.key
  }
  /** A menu made through the Management API, as the Library makes one, then published. */
  const menu = async (name: string, entries: Entry[], alias?: string) => {
    const response = await h.post(`${V1}/element`, {
      documentType: { id: SYSTEM_CONTENT_TYPE_KEYS.Menu },
      parent: null,
      values: [
        ...(alias === undefined
          ? []
          : [{ alias: 'alias', culture: null, segment: null, value: alias }]),
        { alias: 'items', culture: null, segment: null, value: blocks(entries) },
      ],
      variants: [{ culture: null, segment: null, name }],
    })
    if (response.status !== 201) return { status: response.status, body: await response.text() }
    const key = response.headers.get('umb-generated-resource') as string
    await elements.publish(key, null)
    h.server.cache.invalidate()
    return { status: 201, key }
  }
  const visit = async (path: string) => {
    h.server.cache.invalidate()
    return (await (await h.server.fetch(new Request(`${ORIGIN}${path}`))).text()).replace(
      /^<!DOCTYPE html>/,
      '',
    )
  }
  return { h, docs, elements, page, menu, visit }
}

describe('a menu', () => {
  test('is drawn by alias: labels, page names, links below, an address and a heading', async () => {
    const { page, menu, visit } = await site()
    const home = await page('Home', null)
    const about = await page('About', home)
    const team = await page('Team', about)
    expect(
      (
        await menu(
          'Main navigation',
          [
            { page: home, label: 'Start' },
            { page: about, children: [{ page: team }] },
            { url: 'https://example.org/shop' },
            { label: 'More' },
          ],
          'main',
        )
      ).status,
    ).toBe(201)
    expect(await visit('/')).toBe(
      '<main>Start=/|About=/about[Team=/about/team]|Elsewhere=https://example.org/shop|More=-</main>',
    )
  })

  test('follows a page that is renamed, and drops one unpublished, with what is below it', async () => {
    const { docs, page, menu, visit } = await site()
    const home = await page('Home', null)
    const about = await page('About', home)
    const team = await page('Team', about)
    await menu(
      'Main navigation',
      [{ page: about, children: [{ page: team }] }, { page: home }],
      'main',
    )
    const typeKey = (await docs.byKey(about))?.contentTypeKey as string
    await docs.update({
      key: about,
      contentTypeKey: typeKey,
      componentKey: null,
      parentKey: home,
      variants: [{ culture: null, segment: null, name: 'About us' }],
      values: [],
    })
    await docs.publish(about, null)
    expect(await visit('/')).toBe('<main>About us=/about-us[Team=/about-us/team]|Home=/</main>')
    await docs.unpublish(about, null)
    expect(await visit('/')).toBe('<main>Home=/</main>')
  })
})

describe('its alias', () => {
  test('is made from the name when left empty, kept on rename, and refused when taken', async () => {
    const { h, page, menu, elements } = await site()
    await page('Home', null)
    const made = await menu('Main navigation', [])
    expect(made.status).toBe(201)
    const stored = await elements.byKey(made.key as string)
    expect(stored?.values.find((v) => v.alias === 'alias')?.value).toBe('mainNavigation')

    const renamed = await h.put(`${V1}/element/${made.key}`, {
      values: [{ alias: 'alias', culture: null, segment: null, value: 'mainNavigation' }],
      variants: [{ culture: null, segment: null, name: 'Top navigation' }],
    })
    expect(renamed.status).toBe(200)

    const clash = await menu('Another', [], 'MainNavigation')
    expect(clash.status).toBe(400)
    expect(clash.body).toContain('Another menu already uses the alias')
    expect(safeAlias('Footer – legal links')).toBe('footerLegalLinks')
  })
})

describe('the Delivery API', () => {
  test('answers a menu with routes, leaving out what the caller may not open', async () => {
    const { h, page, menu } = await site()
    const home = await page('Home', null)
    const about = await page('About', home)
    const staff = await page('Staff', home)
    await menu('Main navigation', [{ page: about }, { page: staff }, { label: 'More' }], 'main')
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: staff,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    h.server.cache.invalidate()
    const response = await h.server.fetch(
      new Request(`${ORIGIN}/umbraco/delivery/api/v2/menus/main`),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      alias: string
      items: Array<{
        label: string
        kind: string
        id: string | null
        route: { path: string } | null
      }>
    }
    expect(body.alias).toBe('main')
    expect(body.items.map((i) => i.label)).toEqual(['About', 'More'])
    expect(body.items[0]).toMatchObject({ kind: 'page', id: about, route: { path: '/about' } })
    expect(
      (await h.server.fetch(new Request(`${ORIGIN}/umbraco/delivery/api/v2/menus/nope`))).status,
    ).toBe(404)
  })
})

describe('the types', () => {
  test('a menu is made in the Library; its items are not', async () => {
    const { h } = await site()
    const types = new ContentTypeRepository(h.server.db)
    const menuType = await types.byAlias('menu')
    const itemType = await types.byAlias('menuItem')
    expect(menuType).toMatchObject({ isElement: true, allowedInLibrary: true })
    expect(itemType).toMatchObject({ isElement: true, allowedInLibrary: false })
    expect(menuType?.properties.map((p) => p.alias)).toEqual(['alias', 'items'])
    expect(itemType?.properties.map((p) => p.alias)).toEqual(['link', 'label', 'children'])
  })
})

describe('moving a site', () => {
  test('a menu travels in a bundle with its pages, and draws the same', async () => {
    const source = await site()
    const home = await source.page('Home', null)
    const about = await source.page('About', home)
    const made = await source.menu(
      'Main navigation',
      [{ page: home, label: 'Start' }, { page: about }],
      'main',
    )
    const nodes = new DocumentRepository(source.h.server.db).nodes
    const roots = [await nodes.byKey(home), await nodes.byKey(made.key as string)] as NodeRow[]
    const { set } = await exportBundle(source.h.server.db, {
      roots,
      asGiven: roots.map((r) => r.key),
      descendants: true,
      snapshot: 'published',
      blueprints: false,
      withBlobs: false,
      siteName: 'Source',
      nodeId: 'source',
    })

    const target = await site()
    const result = await importBundle(target.h.server.db, set, { nodeId: 'target' })
    expect(result.runId).toBeDefined()
    // Imported content arrives as drafts, for a person to publish.
    await target.docs.publish(home, null)
    await target.docs.publish(about, null)
    await target.elements.publish(made.key as string, null)
    expect(await target.visit('/')).toBe('<main>Start=/|About=/about</main>')
  })
})
