/**
 * The redirects bundle, end to end: a rule typed in the backoffice has to
 * actually redirect a visitor, which is the only assertion that proves the
 * client half, the bundle's routes, the capability and core's matcher all agree.
 *
 * It also holds the line the capability draws. Writing is confined to `manual`
 * rules, so this bundle cannot delete a rule the site's configuration owns, nor
 * edit one the URL tracker recorded, however the request is phrased.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, RedirectRepository } from '@crombolo/data'
import { redirect } from '@crombolo/render'
import type { CromboloConfig } from '@crombolo/server'
import { REDIRECTS_BUNDLE_ID } from '@crombolo/simple-redirects'
import { type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

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

/**
 * Where the bundle answers. Derived from the host rather than written out,
 * because the backoffice path is configurable and the plugin path moves with it
 * — which is exactly why the client reads `<base href>` instead of assuming one.
 */
const rulesPath = (h: Harness) =>
  `${h.server.paths.pluginPath}/api/bundle/${REDIRECTS_BUNDLE_ID}/rules`

const TYPE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"
`

const VIEW = `export default function Page({ model }) {
  return <main><h1>{model.name}</h1></main>
}
`

interface Rule {
  key: string
  source: string
  editable: boolean
  matchKind: string
  pattern: string
  targetKind: string
  target: string
  statusCode: number
  culture: string | null
  destinationUrl?: string
}

async function site(config: Partial<CromboloConfig> = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'simple-redirects-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), TYPE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  // The site depends on the package, and its config grants it, so it runs in a
  // process of its own (story 311); the workspace's copy resolves from the
  // repository root.
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'a-site', dependencies: { '@crombolo/simple-redirects': '*' } }),
  )
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      extensions: {
        [REDIRECTS_BUNDLE_ID]: {
          grant: ['redirects.read', 'redirects.write', 'content.read'],
        },
      },
      ...config,
    },
  })
  open.push(h)

  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string

  const page = async (name: string, parent: string | null = null) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      parent: parent ? { id: parent } : null,
      template: { id: componentKey },
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (created.status !== 201) throw new Error(`create ${created.status}: ${await created.text()}`)
    const key = created.headers.get('umb-generated-resource') as string
    const published = await h.put(`${V1}/document/${key}/publish`, {
      publishSchedules: [{ culture: null }],
    })
    if (published.status !== 200)
      throw new Error(`publish ${published.status}: ${await published.text()}`)
    return key
  }

  const rename = async (key: string, name: string) => {
    const response = await h.put(`${V1}/document/${key}/update-and-publish`, {
      template: { id: componentKey },
      values: [],
      variants: [{ culture: null, segment: null, name }],
      culturesToPublish: [null],
    })
    if (response.status !== 200)
      throw new Error(`rename ${response.status}: ${await response.text()}`)
  }

  const rules = rulesPath(h)
  const list = () => h.json<{ total: number; items: Rule[] }>(rules)
  const add = (rule: Record<string, unknown>) => h.post(rules, rule)
  const at = async (url: string) => {
    const response = await h.server.fetch(new Request(url, { redirect: 'manual' }))
    return { status: response.status, location: response.headers.get('location') }
  }

  return { h, page, rename, list, add, at, rules }
}

describe('a rule somebody typed', () => {
  test('redirects a visitor, which is the whole point', async () => {
    const { page, add, at } = await site()
    await page('Home')
    expect((await at('http://localhost/brochure')).status).toBe(404)

    const created = await add({
      matchKind: 'exact',
      pattern: '/brochure',
      targetKind: 'url',
      target: 'https://example.com/brochure.pdf',
    })
    expect(created.status).toBe(200)

    expect(await at('http://localhost/brochure')).toEqual({
      status: 301,
      location: 'https://example.com/brochure.pdf',
    })
  })

  test('is stored as manual, so it is told apart from the other two kinds', async () => {
    const { page, add, list } = await site()
    await page('Home')
    await add({ matchKind: 'exact', pattern: '/a', targetKind: 'path', target: '/b' })
    const rule = (await list()).items.find((item) => item.pattern === '/a')
    expect(rule?.source).toBe('manual')
    expect(rule?.editable).toBe(true)
  })

  test('points at a page by key, so it follows the page when it is renamed', async () => {
    const { page, rename, add, at } = await site()
    const home = await page('Home')
    const about = await page('About', home)
    await add({ matchKind: 'exact', pattern: '/company', targetKind: 'document', target: about })
    expect(await at('http://localhost/company')).toEqual({ status: 301, location: '/about' })

    await rename(about, 'Our Company')
    expect(await at('http://localhost/company')).toEqual({
      status: 301,
      location: '/our-company',
    })
  })

  test('reports where a page target resolves, so the table is never stale', async () => {
    const { page, add, list } = await site()
    const home = await page('Home')
    const about = await page('About', home)
    await add({ matchKind: 'exact', pattern: '/company', targetKind: 'document', target: about })
    const rule = (await list()).items.find((item) => item.pattern === '/company')
    expect(rule?.destinationUrl).toBe('/about')
  })

  test('honours the chosen status code', async () => {
    const { page, add, at } = await site()
    await page('Home')
    await add({
      matchKind: 'exact',
      pattern: '/temporary',
      targetKind: 'path',
      target: '/home',
      statusCode: 302,
    })
    expect((await at('http://localhost/temporary')).status).toBe(302)
  })

  test('redirects a whole subtree, passing the remainder through', async () => {
    const { page, add, at } = await site()
    await page('Home')
    await add({
      matchKind: 'prefix',
      pattern: '/legacy',
      targetKind: 'path',
      target: '/archive/$1',
    })
    expect((await at('http://localhost/legacy/2019/report')).location).toBe('/archive/2019/report')
  })

  test('redirects by regular expression, with its captures', async () => {
    const { page, add, at } = await site()
    await page('Home')
    await add({
      matchKind: 'regex',
      pattern: '^/news/(\\d+)/(.+)$',
      targetKind: 'path',
      target: '/articles/$2',
    })
    expect((await at('http://localhost/news/2019/budget')).location).toBe('/articles/budget')
  })

  test('never shadows a page that resolves', async () => {
    // Matching happens only after route resolution has found nothing, so a rule
    // cannot make a live URL unreachable however it is written.
    const { page, add, at } = await site()
    const home = await page('Home')
    await page('About', home)
    await add({
      matchKind: 'prefix',
      pattern: '/',
      targetKind: 'url',
      target: 'https://example.com',
    })
    expect((await at('http://localhost/about')).status).toBe(200)
  })

  test('is refused with a message the screen can show, not a 500', async () => {
    const { page, add } = await site()
    await page('Home')
    const response = await add({
      matchKind: 'regex',
      pattern: '([a-',
      targetKind: 'path',
      target: '/x',
    })
    expect(response.status).toBe(400)
    expect(((await response.json()) as { message: string }).message).toContain('regular expression')
  })

  test('is deleted when asked', async () => {
    const { page, add, list, h, at, rules } = await site()
    await page('Home')
    await add({ matchKind: 'exact', pattern: '/gone', targetKind: 'path', target: '/home' })
    const key = (await list()).items.find((item) => item.pattern === '/gone')?.key as string

    expect((await h.del(`${rules}/${key}`)).status).toBe(200)
    expect((await list()).items.find((item) => item.pattern === '/gone')).toBeUndefined()
    expect((await at('http://localhost/gone')).status).toBe(404)
  })
})

describe('editing one', () => {
  test('changes where it points', async () => {
    const { page, add, list, h, at, rules } = await site()
    await page('Home')
    await add({ matchKind: 'exact', pattern: '/offer', targetKind: 'path', target: '/old' })
    const key = (await list()).items.find((item) => item.pattern === '/offer')?.key as string

    const updated = await h.put(`${rules}/${key}`, {
      matchKind: 'exact',
      pattern: '/offer',
      targetKind: 'path',
      target: '/new',
    })
    expect(updated.status).toBe(200)
    expect((await at('http://localhost/offer')).location).toBe('/new')
  })

  test('changing the pattern does not leave the old rule behind', async () => {
    // A rule is identified by what it matches, so an edit to the pattern is a
    // different row. Leaving the original would keep redirecting a URL the
    // administrator believes they have stopped redirecting.
    const { page, add, list, h, at, rules } = await site()
    await page('Home')
    await add({ matchKind: 'exact', pattern: '/first', targetKind: 'path', target: '/home' })
    const key = (await list()).items.find((item) => item.pattern === '/first')?.key as string

    expect(
      (
        await h.put(`${rules}/${key}`, {
          matchKind: 'exact',
          pattern: '/second',
          targetKind: 'path',
          target: '/home',
        })
      ).status,
    ).toBe(200)

    const patterns = (await list()).items.map((item) => item.pattern)
    expect(patterns).toContain('/second')
    expect(patterns).not.toContain('/first')
    expect((await at('http://localhost/first')).status).toBe(404)
  })

  test('a refusal costs nothing, because the rule is checked before it is replaced', async () => {
    const { page, add, list, h, at, rules } = await site()
    await page('Home')
    await add({ matchKind: 'exact', pattern: '/keep', targetKind: 'path', target: '/home' })
    const key = (await list()).items.find((item) => item.pattern === '/keep')?.key as string

    const refused = await h.put(`${rules}/${key}`, {
      matchKind: 'regex',
      pattern: '([a-',
      targetKind: 'path',
      target: '/home',
    })
    expect(refused.status).toBe(400)
    // Still there, still redirecting.
    expect((await at('http://localhost/keep')).location).toBe('/home')
  })

  test('a key that no longer exists is a 404', async () => {
    const { page, h, rules } = await site()
    await page('Home')
    const response = await h.put(`${rules}/f0000000-0000-0000-0000-00000000dead`, {
      matchKind: 'exact',
      pattern: '/a',
      targetKind: 'path',
      target: '/b',
    })
    expect(response.status).toBe(404)
  })
})

describe('the rules this bundle must not touch', () => {
  test('lists a configured rule, and refuses to delete it', async () => {
    const { page, list, h, rules } = await site({ redirects: [redirect('/declared', '/home')] })
    await page('Home')
    const rule = (await list()).items.find((item) => item.pattern === '/declared')
    expect(rule?.source).toBe('config')
    expect(rule?.editable).toBe(false)

    const refused = await h.del(`${rules}/${rule?.key}`)
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { message: string }).message).toContain('configured')
    // And it is still in force, which is the part that matters.
    expect((await list()).items.some((item) => item.pattern === '/declared')).toBe(true)
  })

  test('refuses to edit a configured rule', async () => {
    const { page, list, h, rules } = await site({ redirects: [redirect('/declared', '/home')] })
    await page('Home')
    const key = (await list()).items.find((item) => item.pattern === '/declared')?.key as string
    const refused = await h.put(`${rules}/${key}`, {
      matchKind: 'exact',
      pattern: '/declared',
      targetKind: 'url',
      target: 'https://example.com',
    })
    expect(refused.status).toBe(409)
  })

  test('lists a tracked rule, and refuses to delete or edit it', async () => {
    const { page, rename, list, h, rules } = await site()
    const home = await page('Home')
    const about = await page('About', home)
    await rename(about, 'Contact')

    const rule = (await list()).items.find((item) => item.pattern === '/about')
    expect(rule?.source).toBe('tracked')
    expect(rule?.editable).toBe(false)

    expect((await h.del(`${rules}/${rule?.key}`)).status).toBe(409)
    expect(
      (
        await h.put(`${rules}/${rule?.key}`, {
          matchKind: 'exact',
          pattern: '/about',
          targetKind: 'path',
          target: '/elsewhere',
        })
      ).status,
    ).toBe(409)
  })

  test('cannot forge a configured rule by asking for one', async () => {
    // `source` is not an input the bundle can set: the capability writes it.
    const { page, add, list } = await site()
    await page('Home')
    await add({
      matchKind: 'exact',
      pattern: '/sneaky',
      targetKind: 'path',
      target: '/home',
      source: 'config',
    })
    expect((await list()).items.find((item) => item.pattern === '/sneaky')?.source).toBe('manual')
  })

  test('a manual rule survives the configuration being synced at boot', async () => {
    // `syncConfigured` removes config rows the file no longer declares. A manual
    // rule caught by that would vanish on the next deploy.
    const { page, add, h } = await site()
    await page('Home')
    await add({ matchKind: 'exact', pattern: '/typed', targetKind: 'path', target: '/home' })

    const repository = new RedirectRepository(h.server.db)
    await repository.syncConfigured([])
    expect((await repository.list()).items.some((item) => item.pattern === '/typed')).toBe(true)
  })

  test('a manual rule survives a rename being reverted', async () => {
    // `removeSelfReferencing` drops a tracked rule that would point a live URL at
    // itself. It is scoped to tracked rules, and a manual rule for the same route
    // is somebody's deliberate decision.
    const { page, rename, add, h } = await site()
    const home = await page('Home')
    const about = await page('About', home)
    await add({ matchKind: 'exact', pattern: '/about', targetKind: 'path', target: '/home' })

    await rename(about, 'Contact')
    await rename(about, 'About')

    const repository = new RedirectRepository(h.server.db)
    const rules = (await repository.list()).items.filter((item) => item.pattern === '/about')
    expect(rules.map((rule) => rule.source)).toContain('manual')
  })
})

describe('precedence', () => {
  test('a manual rule outranks a tracked one for the same URL', async () => {
    // Both rows exist — they are different sources, so they do not collide — and
    // the administrator's decision is the one that should answer.
    const { page, rename, add, at } = await site()
    const home = await page('Home')
    const about = await page('About', home)
    const news = await page('News', home)
    await rename(about, 'Contact')
    expect((await at('http://localhost/about')).location).toBe('/contact')

    await add({ matchKind: 'exact', pattern: '/about', targetKind: 'document', target: news })
    expect((await at('http://localhost/about')).location).toBe('/news')
  })

  test('a configured rule outranks a manual one, because the file is the deploy', async () => {
    const { page, add, at } = await site({ redirects: [redirect('/both', '/from-config')] })
    await page('Home')
    await add({ matchKind: 'exact', pattern: '/both', targetKind: 'path', target: '/from-manual' })
    expect((await at('http://localhost/both')).location).toBe('/from-config')
  })
})

describe('who may use it', () => {
  test('refuses a caller with no session', async () => {
    const { h, rules } = await site()
    const response = await h.server.fetch(new Request(`http://localhost${rules}`))
    expect(response.status).toBe(401)
  })

  test('refuses a signed-in user without the Settings section', async () => {
    const { h, page, rules } = await site()
    await page('Home')
    const writer = await signInAsGroup(h, 'writer')
    expect((await writer.call(rules)).status).toBe(403)
    expect(
      (
        await writer.post(rules, {
          matchKind: 'exact',
          pattern: '/x',
          targetKind: 'path',
          target: '/y',
        })
      ).status,
    ).toBe(403)
  })

  test('answers an unknown path below its own namespace with a 404', async () => {
    const { h } = await site()
    expect(
      (await h.call(`${h.server.paths.pluginPath}/api/bundle/${REDIRECTS_BUNDLE_ID}/nonsense`))
        .status,
    ).toBe(404)
  })
})

describe('the bundle as a package', () => {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), 'packages/simple-redirects/package.json'), 'utf8'),
  ) as {
    version: string
    keywords: string[]
    crombolo: { id: string; extensions: Array<Record<string, unknown>> }
  }

  test('declares the two extensions the screen needs', () => {
    // A menu item in Settings' Advanced menu and the workspace it points at —
    // the pattern Umbraco's own log viewer uses, so no vendored element is
    // replaced to put a screen in Settings.
    const types = manifest.crombolo.extensions.map((extension) => extension.type)
    expect(types).toEqual(['menuItem', 'workspace'])
  })

  test('its menu item and workspace agree on the entity type', () => {
    // The menu item's href is `section/settings/workspace/<entityType>`, so a
    // mismatch here is a link to a screen that does not exist.
    const [menuItem, workspace] = manifest.crombolo.extensions as Array<{
      meta: { entityType: string; menus?: string[] }
    }>
    expect(menuItem?.meta.entityType).toBe(workspace?.meta.entityType as string)
    expect(menuItem?.meta.menus).toContain('Umb.Menu.AdvancedSettings')
  })

  test('its workspace is a screen it describes, with no code of its own in the back office (story 329)', () => {
    const [, workspace] = manifest.crombolo.extensions as Array<{
      element?: string
      screen?: string
    }>
    expect(workspace?.screen).toBe('rules')
    expect(workspace?.element).toBeUndefined()
    expect(
      Object.keys((manifest.crombolo as unknown as { permissions: object }).permissions).sort(),
    ).toEqual(['content.read', 'redirects.read', 'redirects.write'])
  })

  test('carries the keyword the Bundles section searches', () => {
    expect(manifest.keywords).toContain('crombolo-bundle')
  })

  test('is versioned with the rest of the set', () => {
    const umbrella = JSON.parse(
      readFileSync(join(process.cwd(), 'packages/crombolo/package.json'), 'utf8'),
    ) as { version: string }
    expect(manifest.version).toBe(umbrella.version)
  })
})

describe('the described screen (story 329)', () => {
  type Answer = {
    screen: {
      title: string
      toolbar?: { type: string }[]
      body: { type: string; [key: string]: unknown }[]
    }
    state?: Record<string, unknown>
    notice?: string
  }
  const call = async (h: Harness, body: object = {}) => {
    const response = await h.post(
      `${h.server.paths.pluginPath}/api/bundle/${REDIRECTS_BUNDLE_ID}/_screen/rules`,
      body,
    )
    expect(response.status).toBe(200)
    return (await response.json()) as Answer
  }
  const nodeOf = (answer: Answer, type: string): unknown =>
    answer.screen.body.find((node) => node.type === type)

  test('lists each rule with where it came from, with Edit and Delete where it may change one', async () => {
    const { h } = await site()
    await call(h, {
      action: 'save',
      input: {
        values: {
          matchKind: 'exact',
          pattern: '/typed',
          targetKind: 'path',
          target: '/new',
          statusCode: '302',
        },
      },
    })
    const answer = await call(h)
    const rules = nodeOf(answer, 'table') as {
      rows: { cells: { text: string }[]; actions: { action: string }[] }[]
    }
    const typed = rules.rows.find((row) => row.cells[0]?.text === '/typed')
    expect(typed?.cells.map((c) => c.text)).toEqual(['/typed', '/new', '302', 'Added here'])
    expect(typed?.actions.map((a) => a.action)).toEqual(['edit', 'remove'])
    expect(answer.screen.toolbar?.map((item) => item.type)).toEqual(['search', 'button'])
  })

  test('the editor offers every match and target kind and status, and the page picker for a page', async () => {
    const { h } = await site()
    const answer = await call(h, { action: 'add' })
    const editor = nodeOf(answer, 'form') as {
      fields: { name: string; kind: string; options?: { value: string }[]; visibleWhen?: unknown }[]
    }
    const byName = Object.fromEntries(editor.fields.map((f) => [f.name, f]))
    expect(byName.matchKind?.options?.map((o) => o.value)).toEqual(['exact', 'prefix', 'regex'])
    expect(byName.targetKind?.options?.map((o) => o.value)).toEqual(['document', 'path', 'url'])
    expect(byName.statusCode?.options?.map((o) => o.value)).toEqual(['301', '302', '307', '308'])
    expect(byName.page).toMatchObject({
      kind: 'page',
      visibleWhen: { field: 'targetKind', equals: 'document' },
    })
  })

  test('adds, edits and deletes a rule, and a refusal keeps the editor open, saying why', async () => {
    const { h } = await site()
    const added = await call(h, {
      action: 'save',
      input: {
        values: {
          matchKind: 'exact',
          pattern: '/old',
          targetKind: 'path',
          target: '/new',
          statusCode: '301',
        },
      },
    })
    expect(added.notice).toBe('Redirect added.')
    const rules = nodeOf(added, 'table') as { rows: { key: string }[] }
    const key = rules.rows[0]?.key as string
    const editing = await call(h, { action: 'edit', input: { key } })
    expect((nodeOf(editing, 'form') as { values: Record<string, unknown> }).values).toMatchObject({
      pattern: '/old',
      target: '/new',
    })
    const refused = await call(h, {
      action: 'save',
      state: editing.state,
      input: {
        values: {
          matchKind: 'regex',
          pattern: '([',
          targetKind: 'path',
          target: '/x',
          statusCode: '301',
        },
      },
    })
    expect(nodeOf(refused, 'problem')).toBeDefined()
    expect(nodeOf(refused, 'form')).toBeDefined()
    const removed = await call(h, { action: 'remove', input: { key } })
    expect(removed.notice).toBe('Redirect deleted.')
    expect(nodeOf(removed, 'empty')).toBeDefined()
  })

  test('filters by either URL', async () => {
    const { h } = await site()
    for (const pattern of ['/alpha', '/beta'])
      await call(h, {
        action: 'save',
        input: {
          values: {
            matchKind: 'exact',
            pattern,
            targetKind: 'path',
            target: '/x',
            statusCode: '301',
          },
        },
      })
    const found = await call(h, { action: 'find', input: { query: 'alpha' } })
    const rules = nodeOf(found, 'table') as { rows: { cells: { text: string }[] }[] }
    expect(rules.rows.map((row) => row.cells[0]?.text)).toEqual(['/alpha'])
    expect(found.state).toMatchObject({ query: 'alpha' })
  })
})
