/**
 * Story 447: Shared answers the workspace routes under the key `shared`. It is read as
 * the site serves it, listed first, and refused, with why, what only a workspace does.
 * `open` and links let a browser in at the site's own address, past a closed site's gate
 * (story 446): to look, unless an administrator lets it write, and never into the back
 * office or the Management API. A link goes with its maker's Content section.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCookies } from '@crombolo/auth'
import { ok, route } from '@crombolo/common'
import { DELIVERY_API_PREFIX } from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  SHARED_WORKSPACE_KEY,
  sharedLinksMigration,
  WorkspaceRepository,
} from '@crombolo/data'
import type { CromboloConfig } from '@crombolo/server'
import { SHARED_COOKIE } from '../packages/server/src/shared-access.ts'
import { workspaceHeaderOf } from '../packages/server/src/workspaces.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const SHARED = `${WORKSPACES}/shared`

const TYPE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

/** A browser with a cookie jar of its own and no back-office session. */
function browser(h: Harness) {
  const jar = new Map<string, string>()
  const send = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (jar.size > 0) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    const response = await h.server.fetch(
      new Request(path.startsWith('/') ? `${ORIGIN}${path}` : path, {
        ...init,
        headers,
        redirect: 'manual',
      }),
    )
    for (const set of response.headers.getSetCookie())
      for (const [name, value] of parseCookies(set.split(';')[0] ?? '')) {
        if (value === '') jar.delete(name)
        else jar.set(name, value)
      }
    return response
  }
  return { send, jar }
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe(`Shared under the workspace routes (${dialectUnderTest})`, () => {
  let root: string
  let h: Harness
  let writer: Harness

  const siteConfig = (): Partial<CromboloConfig> => ({
    siteDir: root,
    sqliteFile: join(root, 'site.sqlite'),
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    componentsCacheDir: join(root, '.cache', 'components'),
    schemaWritable: true,
    siteAccess: 'users',
    deliveryApi: { enabled: true, apiKey: 'the-front-end-key' },
    workspaces: true,
    links: { maxDays: 7 },
    routes: [
      route(
        '/api/hello',
        {
          GET: (request) => ok({ cookie: request.headers.get('cookie') }),
          POST: () => ok({ posted: true }),
        },
        { csrf: false },
      ),
    ],
  })

  beforeAll(async () => {
    mkdirSync(join(process.cwd(), 'output'), { recursive: true })
    root = mkdtempSync(join(process.cwd(), 'output', 'shared-workspace-'))
    mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
    mkdirSync(join(root, 'components'), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), TYPE_TOML)
    writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <h1>Welcome</h1>\n')
    writeFileSync(join(root, 'package.json'), '{ "name": "site" }\n')
    h = await signedInServer({ config: siteConfig() })
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    expect(created.status).toBe(201)
    const home = created.headers.get('umb-generated-resource') as string
    expect((await h.put(`${V1}/document/${home}/publish`, { publishSchedules: [] })).status).toBe(
      200,
    )
    writer = await signInAsGroup(h, 'writer')
  }, 60_000)

  afterAll(async () => {
    await h?.db.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** A link made by `who`, as its routes answer it. */
  const linkBy = async (who: Harness, body: Record<string, unknown> = { days: 1 }) => {
    const made = await who.call(`${SHARED}/links`, post(body))
    expect(made.status, await made.clone().text()).toBe(201)
    return (await made.json()) as { id: number; url: string; writes: boolean }
  }

  /** A browser let in by a link or `open`'s address. */
  const holding = async (url: string) => {
    const b = browser(h)
    const swapped = await b.send(url)
    expect(swapped.status).toBe(303)
    expect(swapped.headers.get('location')).toBe('/')
    expect(b.jar.has(SHARED_COOKIE)).toBe(true)
    return b
  }

  test('GET /shared describes it, and GET / lists it first', async () => {
    expect(await h.json(SHARED)).toMatchObject({
      key: 'shared',
      name: 'Shared',
      shared: true,
      mine: false,
      ownerKey: null,
      memberKeys: [],
    })
    expect((await h.post(WORKSPACES, { name: 'Spring sale' })).status).toBe(201)
    for (const query of ['', '?all=true']) {
      const { items } = await h.json<{ items: Array<{ key: string; shared?: boolean }> }>(
        `${WORKSPACES}${query}`,
      )
      expect(items[0]).toMatchObject({ key: 'shared', shared: true })
      expect(items.slice(1).some((w) => w.shared)).toBe(false)
    }
    // Everyone who may use workspaces reads it.
    expect((await writer.call(SHARED)).status).toBe(200)
  })

  test('render, pages, check and errors read Shared as the site serves it; diff is empty', async () => {
    const page = await h.json<{ status: string; html: string }>(`${SHARED}/render?path=/`)
    expect(page.status).toBe('ok')
    expect(page.html).toContain('Welcome')
    const missing = await h.json<{ status: string }>(`${SHARED}/render?path=/nowhere`)
    expect(missing.status).toBe('notFound')

    const pages = await h.json<{ items: Array<{ url: string; ok: boolean }> }>(`${SHARED}/pages`)
    expect(pages.items).toEqual([expect.objectContaining({ url: '/', ok: true })])
    expect((await h.json<{ items: unknown[] }>(`${SHARED}/pages?failing=true`)).items).toEqual([])
    const checked = await h.json<{ ok: boolean; pages: unknown[] }>(`${SHARED}/check`, post({}))
    expect(checked).toMatchObject({ ok: true, pages: [expect.objectContaining({ url: '/' })] })
    const unknownChange = await h.call(`${SHARED}/check`, post({ since: crypto.randomUUID() }))
    expect(unknownChange.status).toBe(404)

    // The failed render is one of Shared's errors, kept under its key.
    const errors = await h.json<{ items: Array<{ page: string; says: string }> }>(
      `${SHARED}/errors`,
    )
    expect(errors.items).toEqual([
      expect.objectContaining({ page: '/nowhere', says: 'Nothing was found at its address.' }),
    ])

    for (const against of ['base', 'shared'])
      expect(await h.json<Record<string, unknown>>(`${SHARED}/diff?against=${against}`)).toEqual({
        against,
        pages: [],
        pending: [],
        files: [],
      })
  })

  test('what only a workspace does is refused, each saying why', async () => {
    const refusals: Array<[string, string, unknown?]> = [
      ['PATCH', SHARED, { name: 'Renamed' }],
      ['DELETE', SHARED],
      ['GET', `${SHARED}/members`],
      ['POST', `${SHARED}/members`, { email: 'someone@example.com' }],
      ['GET', `${SHARED}/merge`],
      ['POST', `${SHARED}/merge`, {}],
      ['POST', `${WORKSPACES}/merge`, { workspaces: ['shared'] }],
      ['POST', `${SHARED}/update`, {}],
      ['GET', `${SHARED}/conflicts`],
      ['POST', `${SHARED}/conflicts`, {}],
      ['DELETE', `${SHARED}/pending/1`],
      ['PUT', `${SHARED}/site-files`, { path: 'package.json', text: '{}' }],
    ]
    for (const [method, path, body] of refusals) {
      const answer = await h.call(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      expect(answer.status, `${method} ${path}`).toBe(400)
      const { message } = (await answer.json()) as { message: string }
      expect(message, `${method} ${path}`).toStartWith('Shared')
      expect(message.length).toBeGreaterThan(30)
    }
    expect((await h.json<{ name: string }>(SHARED)).name).toBe('Shared')
  })

  test('no workspace can have the key', async () => {
    const opened = (await (await h.post(WORKSPACES, { name: 'shared' })).json()) as {
      key: string
    }
    expect(opened.key).not.toBe(SHARED_WORKSPACE_KEY)
    expect(opened.key).toMatch(/^[0-9a-f-]{36}$/)
    expect(await new WorkspaceRepository(h.server.db).byKey('shared')).toBeUndefined()
    expect(await new WorkspaceRepository(h.server.db).byKey('SHARED')).toBeUndefined()
    // Named so, it is still a workspace; the key still answers Shared.
    expect(await h.json(`${WORKSPACES}/${opened.key}`)).toMatchObject({ name: 'shared' })
    expect(await h.json(SHARED)).toMatchObject({ shared: true })
  })

  test('the header naming shared is the same as none', async () => {
    const named = (value: string) =>
      workspaceHeaderOf(new Request(ORIGIN, { headers: { 'crombolo-workspace': value } }))
    expect(named('shared')).toBeUndefined()
    expect(named(' Shared ')).toBeUndefined()
    expect(named('mine')).toBe('mine')
    const asShared = await h.call(`${V1}/tree/document/root`, {
      headers: { 'crombolo-workspace': 'shared' },
    })
    expect(asShared.status).toBe(200)
    expect(await asShared.json()).toEqual(await h.json(`${V1}/tree/document/root`))
  })

  test('open lets the caller in at the site’s own address, used once, not into the back office', async () => {
    const opened = await h.json<{ url: string }>(`${SHARED}/open`, post({ path: '/' }))
    const url = new URL(opened.url)
    expect(url.origin).toBe(ORIGIN)
    expect(url.searchParams.has('crombolo-shared')).toBe(true)
    const stranger = browser(h)
    expect((await stranger.send('/')).status).toBe(303)
    const b = await holding(opened.url)
    const page = await b.send('/')
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Welcome')
    // An administrator's way in writes, as a signed-in user could.
    expect((await b.send('/api/hello', { method: 'POST' })).status).toBe(200)
    // Used once.
    const again = browser(h)
    await again.send(opened.url)
    expect(again.jar.has(SHARED_COOKIE)).toBe(false)
    // Never the back office or the Management API.
    expect((await b.send(`${V1}/user/current`)).status).toBe(401)
    expect((await b.send(WORKSPACES)).status).toBe(401)
  })

  test('a non-administrator’s open only looks', async () => {
    const opened = await writer.json<{ url: string }>(`${SHARED}/open`, post({ path: '/' }))
    const b = await holding(opened.url)
    expect((await b.send('/')).status).toBe(200)
    const wrote = await b.send('/api/hello', { method: 'POST' })
    expect(wrote.status).toBe(401)
    expect(((await wrote.json()) as { detail: string }).detail).toContain('only lets you look')
  })

  test('a link lets a browser with no account read the site, its pages, routes and Delivery API, and the site never sees the cookie', async () => {
    const link = await linkBy(writer)
    expect(link.writes).toBe(false)
    const b = await holding(link.url)
    const page = await b.send('/')
    expect(page.status).toBe(200)
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    const hello = await b.send('/api/hello')
    expect(hello.status).toBe(200)
    expect(JSON.stringify(await hello.json())).not.toContain(SHARED_COOKIE)
    const delivery = await b.send(`${DELIVERY_API_PREFIX}/v2/content`, {
      headers: { accept: 'application/json' },
    })
    expect(delivery.status).toBe(200)
    // It only looks: a write is a 401 saying so.
    const wrote = await b.send('/api/hello', { method: 'POST' })
    expect(wrote.status).toBe(401)
    expect(((await wrote.json()) as { detail: string }).detail).toContain('only lets you look')
    // Never the back office or the Management API.
    expect((await b.send(`${V1}/user/current`)).status).toBe(401)
    expect((await b.send(SHARED)).status).toBe(401)
    // Its use is audited, with its making.
    const audited = await h.server.db.query<{ action: string }>(
      "SELECT action FROM audit_entry WHERE entity_key = 'shared' ORDER BY id",
    )
    expect(audited.map((row) => row.action)).toEqual(expect.arrayContaining(['Link', 'LinkUsed']))
  })

  test('an administrator chooses whether a link writes; nobody else may', async () => {
    expect((await writer.call(`${SHARED}/links`, post({ days: 1, writes: true }))).status).toBe(403)
    const writing = await linkBy(h, { days: 0.5, writes: true })
    expect(writing.writes).toBe(true)
    const b = await holding(writing.url)
    expect((await b.send('/api/hello', { method: 'POST' })).status).toBe(200)
    // From another site, a cookie-carried write is refused.
    expect(
      (
        await b.send('/api/hello', {
          method: 'POST',
          headers: { origin: 'https://elsewhere.example', 'sec-fetch-site': 'cross-site' },
        })
      ).status,
    ).toBe(401)
    expect((await b.send(`${V1}/user/current`)).status).toBe(401)
    const looking = await holding((await linkBy(h, { days: 1, writes: false })).url)
    expect((await looking.send('/api/hello', { method: 'POST' })).status).toBe(401)
  })

  test('a link lasts no longer than the site allows, and not once withdrawn or lapsed', async () => {
    expect((await h.call(`${SHARED}/links`, post({ days: 8 }))).status).toBe(400)
    const link = await linkBy(writer)
    const b = await holding(link.url)
    expect((await b.send('/')).status).toBe(200)
    // Someone else's link is not theirs to withdraw; an administrator may.
    const other = await signInAsGroup(h, 'editor', 'other-editor@example.com')
    expect((await other.call(`${SHARED}/links/${link.id}`, { method: 'DELETE' })).status).toBe(404)
    const listed = await writer.json<{ items: Array<{ id: number; withdrawn: boolean }> }>(
      `${SHARED}/links`,
    )
    expect(listed.items.some((l) => l.id === link.id && !l.withdrawn)).toBe(true)
    expect((await writer.call(`${SHARED}/links/${link.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await b.send('/')).status).toBe(303)
    expect((await browser(h).send(link.url)).headers.getSetCookie()).toEqual([])

    const lapsing = await linkBy(writer)
    const late = await holding(lapsing.url)
    await h.server.db.q
      .updateTable('shared_link')
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() as never })
      .where('id', '=', lapsing.id)
      .execute()
    expect((await late.send('/')).status).toBe(303)
  })

  test('a link stops working when its maker loses Content, or is disabled', async () => {
    const maker = await signInAsGroup(h, 'writer', 'leaving-writer@example.com')
    const lost = await holding((await linkBy(maker)).url)
    const disabledMaker = await signInAsGroup(h, 'writer', 'disabled-writer@example.com')
    const disabled = await holding((await linkBy(disabledMaker)).url)
    expect((await lost.send('/')).status).toBe(200)
    expect((await disabled.send('/')).status).toBe(200)

    const db = h.server.db
    const idOf = async (email: string) =>
      Number(
        (
          await db.q
            .selectFrom('user_account')
            .select('id')
            .where('email', '=', email)
            .executeTakeFirstOrThrow()
        ).id,
      )
    await db.q
      .deleteFrom('user_group_member')
      .where('user_id', '=', await idOf('leaving-writer@example.com'))
      .execute()
    await db.q
      .updateTable('user_account')
      .set({ is_approved: db.dialect.boolValue(false) as boolean })
      .where('id', '=', await idOf('disabled-writer@example.com'))
      .execute()
    expect((await lost.send('/')).status).toBe(303)
    expect((await disabled.send('/')).status).toBe(303)
  })
})

describe('the migration (story 447)', () => {
  test('adds shared_link by an expand step, in this release', () => {
    expect(sharedLinksMigration).toMatchObject({
      name: 'AddSharedLinks',
      kind: 'expand',
      release: '0.83.0',
    })
  })
})
