/**
 * Story 379: a workspace looked at before it is merged. On its own host (or, with
 * no pattern, by a cookie on the site's own), its site shows its pages as it has
 * them published, with its views and stylesheets, to a member who opened it by a
 * single-use handoff, or to whoever holds a link a member made; never kept or
 * indexed. A stranger sees nothing; a withdrawn or lapsed link opens nothing.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

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
components = ["page"]
default-component = "page"
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const enc = encodeURIComponent

async function site(
  options: { components?: number; host?: string | null; linkDays?: number; page?: string } = {},
) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-sites-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components/parts', 'css', 'scripts'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    options.page ??
      "import Heading from './parts/heading.tsx'\nexport default () => <main><Heading /></main>\n",
  )
  writeFileSync(
    join(root, 'components', 'parts', 'heading.tsx'),
    'export default () => <h1>Welcome</h1>\n',
  )
  for (let n = 0; n < (options.components ?? 0); n++)
    writeFileSync(
      join(root, 'components', 'parts', `part-${n}.tsx`),
      `export default () => <p>${n}</p>\n`,
    )
  writeFileSync(join(root, 'css', 'site.css'), 'body { color: black; }\n')
  writeFileSync(join(root, 'package.json'), '{ "name": "site" }\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
      componentsCacheDir: join(root, '.cache', 'components'),
      schemaWritable: true,
      workspaces: true,
      workspacesHost:
        options.host === null ? undefined : (options.host ?? '{workspace}.preview.test'),
      workspaceLinkMaxDays: options.linkDays ?? 30,
    },
  })
  open.push(h)
  const db = h.server.db
  const send = (method: string, path: string, body?: unknown, workspace?: string) =>
    h.call(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(workspace ? { 'crombolo-workspace': workspace } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string }
  }
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const created = await send('POST', `${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status).toBe(201)
  const home = created.headers.get('umb-generated-resource') as string
  expect(
    (await send('PUT', `${V1}/document/${home}/publish`, { publishSchedules: [{ culture: null }] }))
      .status,
  ).toBe(200)
  const sharedPage = async () => (await h.server.fetch(new Request('http://localhost/'))).text()
  const rendered = async (workspace: string) =>
    (await (await send('GET', `${WORKSPACES}/${workspace}/render?path=/`)).json()) as {
      status: string
      html?: string
      views: string
    }
  const saveView = (path: string, content: string, workspace?: string) =>
    send('PUT', `${V1}/partial-view/${enc(path)}`, { content }, workspace)
  return { h, db, root, send, opened, sharedPage, rendered, saveView, home }
}

const label = (key: string) => key.replaceAll('-', '')

/** A browser of its own: follows a link once, keeps the cookie it is given. */
function browser(h: Harness) {
  let cookie = ''
  return {
    async get(url: string, headers: Record<string, string> = {}) {
      const response = await h.server.fetch(
        new Request(url, {
          headers: { ...(cookie ? { cookie } : {}), ...headers },
          redirect: 'manual',
        }),
      )
      const set = response.headers.getSetCookie()[0]
      if (set) cookie = set.split(';')[0] as string
      return response
    },
  }
}

/** A page's title made and published in the workspace. */
async function retitle(
  send: Awaited<ReturnType<typeof site>>['send'],
  home: string,
  workspace: string,
  name: string,
  publish = true,
) {
  const document = (await (
    await send('GET', `${V1}/document/${home}`, undefined, workspace)
  ).json()) as Record<string, unknown>
  expect(
    (
      await send(
        'PUT',
        `${V1}/document/${home}`,
        { ...document, variants: [{ culture: null, segment: null, name }] },
        workspace,
      )
    ).status,
  ).toBe(200)
  if (publish)
    expect(
      (
        await send(
          'PUT',
          `${V1}/document/${home}/publish`,
          { publishSchedules: [{ culture: null }] },
          workspace,
        )
      ).status,
    ).toBe(200)
}

describe(`a workspace's site (${dialectUnderTest})`, () => {
  test('a member opens it on its host, by a handoff used once, and sees its pages and views', async () => {
    const { h, send, opened, saveView, home } = await site()
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', 'export default () => <h1>Sale on</h1>\n', sale.key)
    await retitle(send, home, sale.key, 'Sale home')

    const opening = (await (
      await send('POST', `${WORKSPACES}/${sale.key}/open`, { path: '/' })
    ).json()) as { url: string }
    expect(new URL(opening.url).host).toBe(`${label(sale.key)}.preview.test`)
    const visitor = browser(h)
    const first = await visitor.get(opening.url)
    expect(first.status).toBe(303)
    expect(first.headers.get('location')).toBe('/')
    const page = await visitor.get(`http://${label(sale.key)}.preview.test/`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Sale on')
    expect(page.headers.get('cache-control')).toBe('private, no-store')
    expect(page.headers.get('x-robots-tag')).toContain('noindex')
    expect(page.headers.get('etag')).toBeNull()
    // Used once: the same address again sets nothing.
    const again = await browser(h).get(opening.url)
    expect(again.headers.getSetCookie()).toEqual([])
    // Shared is as it was.
    expect(await (await h.server.fetch(new Request('http://localhost/'))).text()).toContain(
      'Welcome',
    )
  })

  test('an administrator not in it opens it only when they ask to include private ones (story 401)', async () => {
    const { h } = await site()
    const writer = await signInAsGroup(h, 'writer')
    const made = await writer.call(WORKSPACES, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Theirs' }),
    })
    expect(made.status).toBe(201)
    const { key } = (await made.json()) as { key: string }
    const open = (query = '') =>
      h.call(`${WORKSPACES}/${key}/open${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: '/' }),
      })
    expect((await open()).status).toBe(404)
    const opening = (await (await open('?includePrivate=true')).json()) as { url: string }
    const visitor = browser(h)
    expect((await visitor.get(opening.url)).status).toBe(303)
    expect((await visitor.get(`http://${label(key)}.preview.test/`)).status).toBe(200)
  })

  test('a stranger is refused, and robots and the sitemap say nothing', async () => {
    const { h, opened } = await site()
    const sale = await opened('Spring sale')
    const host = `http://${label(sale.key)}.preview.test`
    expect((await browser(h).get(`${host}/`)).status).toBe(404)
    const visitor = browser(h)
    const links = (await (
      await h.call(`${WORKSPACES}/${sale.key}/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ days: 2 }),
      })
    ).json()) as { url: string }
    await visitor.get(links.url)
    expect(await (await visitor.get(`${host}/robots.txt`)).text()).toContain('Disallow: /')
    expect((await visitor.get(`${host}/sitemap.xml`)).status).toBe(404)
  })

  test('a link is good until withdrawn or out of date, and no longer than the site allows', async () => {
    const { h, db, send, opened } = await site({ linkDays: 7 })
    const sale = await opened('Spring sale')
    const host = `http://${label(sale.key)}.preview.test`
    expect((await send('POST', `${WORKSPACES}/${sale.key}/links`, { days: 30 })).status).toBe(400)
    const made = (await (
      await send('POST', `${WORKSPACES}/${sale.key}/links`, { days: 2 })
    ).json()) as { id: number; url: string }
    const holder = browser(h)
    expect((await holder.get(made.url)).status).toBe(303)
    expect((await holder.get(`${host}/`)).status).toBe(200)
    const withdrawn = await send('DELETE', `${WORKSPACES}/${sale.key}/links/${made.id}`)
    expect(withdrawn.status, `${JSON.stringify(made)} ${await withdrawn.clone().text()}`).toBe(204)
    expect((await holder.get(`${host}/`)).status).toBe(404)

    const lapsing = (await (
      await send('POST', `${WORKSPACES}/${sale.key}/links`, { days: 1 })
    ).json()) as { id: number; url: string }
    const late = browser(h)
    await late.get(lapsing.url)
    await db.q
      .updateTable('workspace_link')
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() as never })
      .where('id', '=', lapsing.id)
      .execute()
    expect((await late.get(`${host}/`)).status).toBe(404)
  })

  test('a site that makes no links refuses one', async () => {
    const { send, opened } = await site({ linkDays: 0 })
    const sale = await opened('Spring sale')
    expect((await send('POST', `${WORKSPACES}/${sale.key}/links`, { days: 1 })).status).toBe(403)
  })

  test('its stylesheets are served changed at its address only', async () => {
    const { h, send, opened } = await site()
    const sale = await opened('Spring sale')
    await send(
      'PUT',
      `${V1}/stylesheet/${encodeURIComponent('/site.css')}`,
      { content: 'body { color: red; }\n' },
      sale.key,
    )
    const made = (await (
      await send('POST', `${WORKSPACES}/${sale.key}/links`, { days: 1 })
    ).json()) as { url: string }
    const holder = browser(h)
    await holder.get(made.url)
    expect(
      await (await holder.get(`http://${label(sale.key)}.preview.test/css/site.css`)).text(),
    ).toContain('red')
    expect(
      await (await h.server.fetch(new Request('http://localhost/css/site.css'))).text(),
    ).toContain('black')
  })

  test('its site has the dictionary it holds (story 392)', async () => {
    const { send, opened, rendered, sharedPage } = await site({
      page: "export default ({ dictionary }) => <main><p>{dictionary('Greeting')}</p></main>\n",
    })
    const greeting = {
      id: crypto.randomUUID(),
      name: 'Greeting',
      parent: null,
      translations: [{ isoCode: 'en-US', translation: 'Hello' }],
    }
    expect((await send('POST', `${V1}/dictionary`, greeting)).status).toBe(201)
    const sale = await opened('Spring sale')
    expect(
      (
        await send(
          'PUT',
          `${V1}/dictionary/${greeting.id}`,
          { name: 'Greeting', translations: [{ isoCode: 'en-US', translation: 'Sale on' }] },
          sale.key,
        )
      ).status,
    ).toBe(200)
    expect((await rendered(sale.key)).html).toContain('Sale on')
    expect(await sharedPage()).toContain('Hello')
  }, 20_000)

  test('a page changed there but not published shows as Shared had it published when the workspace began', async () => {
    const { h, send, opened, home } = await site()
    const sale = await opened('Spring sale')
    await retitle(send, home, sale.key, 'Draft in sale', false)
    // Shared publishes a newer version meanwhile.
    await retitle(send, home, '', 'Newer in Shared')
    const made = (await (
      await send('POST', `${WORKSPACES}/${sale.key}/links`, { days: 1 })
    ).json()) as { url: string }
    const holder = browser(h)
    await holder.get(made.url)
    const shown = await holder.get(
      `http://${label(sale.key)}.preview.test/umbraco/delivery/api/v2/content/item/`,
    )
    const body = (await shown.json()) as { name: string }
    expect(body.name).toBe('Home')
  })

  test('the Delivery API on its host answers from it, with a link in a header', async () => {
    const { h, send, opened, home } = await site()
    const sale = await opened('Spring sale')
    await retitle(send, home, sale.key, 'Sale home')
    const made = (await (
      await send('POST', `${WORKSPACES}/${sale.key}/links`, { days: 1 })
    ).json()) as { url: string }
    const secret = new URL(made.url).searchParams.get('crombolo-workspace-link') as string
    const item = await h.server.fetch(
      new Request(`http://${label(sale.key)}.preview.test/umbraco/delivery/api/v2/content/item/`, {
        headers: { 'crombolo-workspace-link': secret },
      }),
    )
    expect(((await item.json()) as { name: string }).name).toBe('Sale home')
    const shared = await h.server.fetch(
      new Request('http://localhost/umbraco/delivery/api/v2/content/item/'),
    )
    expect(((await shared.json()) as { name: string }).name).toBe('Home')
  })

  test('without a host pattern, a cookie on the site’s own host switches the view', async () => {
    const { h, send, opened, home, saveView } = await site({ host: null })
    const sale = await opened('Spring sale')
    await retitle(send, home, sale.key, 'Sale home')
    await saveView('/parts/heading.tsx', 'export default () => <h1>Sale home</h1>\n', sale.key)
    const opening = (await (
      await send('POST', `${WORKSPACES}/${sale.key}/open`, { path: '/' })
    ).json()) as { url: string }
    expect(new URL(opening.url).host).toBe('localhost')
    const visitor = browser(h)
    await visitor.get(opening.url)
    expect(await (await visitor.get('http://localhost/')).text()).toContain('Sale home')
    expect(await (await browser(h).get('http://localhost/')).text()).not.toContain('Sale home')
  })

  test('the preview link takes a workspace: it opens the page on its site', async () => {
    const { h, send, opened, home, saveView } = await site()
    const sale = await opened('Spring sale')
    await retitle(send, home, sale.key, 'Sale home')
    await saveView('/parts/heading.tsx', 'export default () => <h1>Sale home</h1>\n', sale.key)
    const link = (await (
      await send('POST', `${BACKOFFICE}/crombolo/api/preview-link`, {
        document: home,
        workspace: sale.key,
      })
    ).json()) as { url: string }
    const visitor = browser(h)
    expect((await visitor.get(link.url)).status).toBe(303)
    expect(await (await visitor.get(`http://${label(sale.key)}.preview.test/`)).text()).toContain(
      'Sale home',
    )
  })
})
