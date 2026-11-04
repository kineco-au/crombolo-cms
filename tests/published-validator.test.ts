/**
 * Story 258: a site that asks for it answers a cache's check from what was
 * published, without rendering: the ETag changes with every publish, code
 * change and upgrade, and a page that stopped being public is never
 * confirmed from a copy made while it was.
 *
 * Two servers share one database, a file on SQLite and the schema on Postgres,
 * because a publish on one must change what the other answers.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComponentRepository,
  ContentTypeRepository,
  latestCheckpoint,
  PublicAccessRepository,
} from '@crombolo/data'
import {
  type CacheOptions,
  publishedEtag,
  RememberedAnswers,
  resolveCacheSettings,
  validatorFor,
} from '@crombolo/render'
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

const typeToml = (alias: string) => `[content-type]
alias = "${alias}"
name = "${alias}"
allow-at-root = true
allow-children = ["page", "news"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'published-validator-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), typeToml('page'))
  writeFileSync(join(root, 'schema', 'content-types', 'news.toml'), typeToml('news'))
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "export default ({ model }) => <main>{model.text('title')}</main>\n",
  )
  return root
}

async function boot(
  root: string,
  cache: CacheOptions,
  options: { nodeId?: string; first?: boolean } = {},
) {
  const nodeId = options.nodeId ?? 'one'
  const h = await signedInServer({
    keepDatabase: options.first === false,
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo', nodeId),
      sqliteFile: join(root, 'site.sqlite'),
      mediaDir: join(root, 'media'),
      deliveryApi: { enabled: true },
      cache: { maxAge: 60, tagHeader: 'Surrogate-Key', ...cache },
      nodeId,
    },
  })
  open.push(h)
  return h
}

async function page(h: Harness, type: string, name: string, parent: string | null = null) {
  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias(type))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const created = await h.post(`${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: parent ? { id: parent } : null,
    values: [{ alias: 'title', culture: null, segment: null, value: name }],
    variants: [{ culture: null, segment: null, name }],
  })
  expect(created.status).toBe(201)
  const key = created.headers.get('umb-generated-resource') as string
  await publish(h, key)
  return key
}

async function publish(h: Harness, key: string) {
  expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(200)
}

const visit = (h: Harness, path: string, headers: Record<string, string> = {}) =>
  h.server.fetch(new Request(`${ORIGIN}${path}`, { headers }))

const counted = (h: Harness) => spyOn(h.server.renderer, 'render')

describe('a page answered from what was published', () => {
  test('a check is a 304 without a render, repeating the lifetime and tags, until a publish', async () => {
    const h = await boot(site(), { validator: 'published' })
    const home = await page(h, 'page', 'Home')
    const first = await visit(h, '/')
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag') as string
    expect(etag).toStartWith('W/"p')

    const renders = counted(h)
    const again = await visit(h, '/', { 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(renders).not.toHaveBeenCalled()
    expect(again.headers.get('etag')).toBe(etag)
    expect(again.headers.get('cache-control')).toBe('public, max-age=60, stale-if-error=604800')
    expect(again.headers.get('surrogate-key')).toBe(home)
    expect(await again.text()).toBe('')

    // Another address, or the same with a query, is its own answer.
    const queried = await visit(h, '/?page=2', { 'if-none-match': etag })
    expect(queried.status).toBe(200)
    expect(renders).toHaveBeenCalledTimes(1)

    await publish(h, home)
    const published = await visit(h, '/', { 'if-none-match': etag })
    expect(published.status).toBe(200)
    expect(published.headers.get('etag')).not.toBe(etag)
    expect(renders).toHaveBeenCalledTimes(2)
  })

  test('a visitor something personal may be shown to is rendered for', async () => {
    const h = await boot(site(), { validator: 'published' })
    await page(h, 'page', 'Home')
    const etag = (await visit(h, '/')).headers.get('etag') as string
    const renders = counted(h)
    for (const cookie of ['__Host-umbMemberCrombolo=x', 'UMB_PREVIEW=1', 'crombolo-form=x'])
      await visit(h, '/', { 'if-none-match': etag, cookie })
    expect(renders).toHaveBeenCalledTimes(3)
  })

  test('a page made members-only is never confirmed from its public copy', async () => {
    const h = await boot(site(), { validator: 'published' })
    const home = await page(h, 'page', 'Home')
    const login = await page(h, 'page', 'Login')
    const etag = (await visit(h, '/')).headers.get('etag') as string
    // Written straight to the table, as a change this server has not heard of yet.
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: home,
      loginNodeKey: login,
      errorNodeKey: login,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    const after = await visit(h, '/', { 'if-none-match': etag })
    expect(after.status).toBe(200)
    expect(after.headers.get('cache-control')).toBe('private, no-store')
  })

  test('changing who may see a page moves every page’s ETag', async () => {
    const h = await boot(site(), { validator: 'published' })
    const home = await page(h, 'page', 'Home')
    const story = await page(h, 'page', 'Story', home)
    const etag = (await visit(h, '/')).headers.get('etag') as string
    const before = await latestCheckpoint(h.server.db)
    const saved = await h.post(`${V1}/document/${story}/public-access`, {
      memberUserNames: [],
      memberGroupNames: ['Staff'],
      loginDocument: { id: home },
      errorDocument: { id: home },
    })
    expect(saved.status).toBe(201)
    expect(await latestCheckpoint(h.server.db)).toBeGreaterThan(before)
    const after = await visit(h, '/', { 'if-none-match': etag })
    expect(after.status).toBe(200)
    expect(after.headers.get('etag')).not.toBe(etag)
  })

  test('a type set to its body keeps the hash over the body', async () => {
    const h = await boot(site(), { validator: 'published', types: { news: { validator: 'body' } } })
    await page(h, 'page', 'Home')
    await page(h, 'news', 'News')
    expect((await visit(h, '/')).headers.get('etag')).toStartWith('W/"p')
    const news = await visit(h, '/news')
    expect(news.headers.get('etag')).not.toStartWith('W/"p')
  })

  test('without it, every ETag is over the body and a check renders', async () => {
    const h = await boot(site(), {})
    await page(h, 'page', 'Home')
    const etag = (await visit(h, '/')).headers.get('etag') as string
    expect(etag).not.toStartWith('W/"p')
    const renders = counted(h)
    expect((await visit(h, '/', { 'if-none-match': etag })).status).toBe(304)
    expect(renders).toHaveBeenCalledTimes(1)
  })

  test('a template edited changes the ETag', async () => {
    const root = site()
    const h = await boot(root, { validator: 'published' })
    await page(h, 'page', 'Home')
    const etag = (await visit(h, '/')).headers.get('etag') as string
    writeFileSync(
      join(root, 'components', 'page.tsx'),
      "export default ({ model }) => <article>{model.text('title')}</article>\n",
    )
    await h.server.snapshots.refresh()
    const after = await visit(h, '/', { 'if-none-match': etag })
    expect(after.status).toBe(200)
    expect(await after.text()).toContain('<article>')
  })

  test('a publish on one server changes the ETag the other answers with', async () => {
    const root = site()
    const one = await boot(root, { validator: 'published' }, { nodeId: 'one' })
    const home = await page(one, 'page', 'Home')
    const two = await boot(root, { validator: 'published' }, { nodeId: 'two', first: false })
    const etag = (await visit(two, '/')).headers.get('etag') as string
    expect((await visit(two, '/', { 'if-none-match': etag })).status).toBe(304)
    await publish(one, home)
    await two.server.poll()
    const after = await visit(two, '/', { 'if-none-match': etag })
    expect(after.status).toBe(200)
    expect(after.headers.get('etag')).not.toBe(etag)
  })
})

describe('a Delivery API answer from what was published', () => {
  test('items and queries take the validator, with the query string in it', async () => {
    const h = await boot(site(), { validator: 'published' })
    const home = await page(h, 'page', 'Home')
    const api = (path: string, headers: Record<string, string> = {}) =>
      visit(h, `/umbraco/delivery/api/v2${path}`, headers)
    const item = await api(`/content/item/${home}`)
    const etag = item.headers.get('etag') as string
    expect(etag).toStartWith('W/"p')
    const again = await api(`/content/item/${home}`, { 'if-none-match': etag })
    expect(again.status).toBe(304)
    expect(again.headers.get('surrogate-key')).toBe(home)
    const expanded = await api(`/content/item/${home}?expand=all`, { 'if-none-match': etag })
    expect(expanded.status).toBe(200)
    expect(expanded.headers.get('etag')).not.toBe(etag)

    const query = await api('/content?take=5')
    expect(query.headers.get('etag')).toStartWith('W/"p')
    await publish(h, home)
    expect((await api(`/content/item/${home}`, { 'if-none-match': etag })).status).toBe(200)
  })
})

describe('the validator policy', () => {
  test('is the body unless asked, and published only when every type in an answer is', () => {
    expect(resolveCacheSettings().validator).toBe('body')
    const settings = resolveCacheSettings({
      validator: 'published',
      types: { news: { validator: 'body' }, bad: { validator: 'nonsense' as never } },
    })
    expect(validatorFor(settings, ['page'])).toBe('published')
    expect(validatorFor(settings, ['page', 'News'])).toBe('body')
    expect(validatorFor(settings, [])).toBe('published')
    expect(settings.validators.has('bad')).toBe(false)
    const optedIn = resolveCacheSettings({ types: { page: { validator: 'published' } } })
    expect(validatorFor(optedIn, ['page'])).toBe('published')
    expect(validatorFor(optedIn, ['news'])).toBe('body')
    expect(publishedEtag([1, 'a'])).toBe(publishedEtag([1, 'a']))
    expect(publishedEtag([1, 'a'])).not.toBe(publishedEtag([2, 'a']))
  })

  test('remembers the most recent answers, the oldest dropped first', () => {
    const answers = new RememberedAnswers(2)
    answers.set('/a', { etag: 'a', headers: [] })
    answers.set('/b', { etag: 'b', headers: [] })
    answers.get('/a')
    answers.set('/c', { etag: 'c', headers: [] })
    expect(answers.get('/b')).toBeUndefined()
    expect(answers.get('/a')?.etag).toBe('a')
    expect(answers.size).toBe(2)
  })
})
