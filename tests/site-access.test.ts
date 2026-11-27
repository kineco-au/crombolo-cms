/**
 * Story 446: a site open only to its back-office users. With `siteAccess: 'users'`
 * every request needs a signed-in back-office user, on an `all` node and on a `web`
 * node sharing its database; the sign-in, the Management API, the Delivery API with
 * its key, a workspace's link and a preview link go on as they were. Nothing is
 * refreshed to let a request in, and the site's code never sees the back office's
 * cookies, with either setting.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuthService, AuthStore, cookieNames, parseCookies } from '@crombolo/auth'
import { ok, route } from '@crombolo/common'
import { DELIVERY_API_PREFIX } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository, DbDate } from '@crombolo/data'
import { type CromboloConfig, loadConfig, oidc, type ServerHandle } from '@crombolo/server'
import {
  isBrowserNavigation,
  privateAnswer,
  sameHostProblem,
  signInLocation,
  withoutBackOfficeCookies,
} from '../packages/server/src/site-access.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  ADMIN,
  BACKOFFICE,
  bootServer,
  type Harness,
  ORIGIN,
  signedInServer,
  signIn,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const NAMES = cookieNames({ siteName: 'Crombolo', securePrefix: true })

describe('the pieces', () => {
  test("the back office's cookies are taken from what the site sees, and nothing else", () => {
    const headers = new Headers({
      cookie: `region=en; ${NAMES.accessToken}=a; ${NAMES.refreshToken}=r; ${NAMES.session}=s; ${NAMES.twoFactorPending}=t; theme=dark`,
      'x-other': '1',
    })
    const seen = withoutBackOfficeCookies(headers, NAMES)
    expect(seen.get('cookie')).toBe('region=en; theme=dark')
    expect(seen.get('x-other')).toBe('1')
    const only = withoutBackOfficeCookies(new Headers({ cookie: `${NAMES.session}=s` }), NAMES)
    expect(only.has('cookie')).toBe(false)
    const none = new Headers({ cookie: 'region=en' })
    expect(withoutBackOfficeCookies(none, NAMES)).toBe(none)
  })

  test('the way back after signing in is a path on this site', () => {
    const at = (path: string) => signInLocation('/crombolo', new URL(`http://site.test${path}`))
    expect(at('/about?x=1')).toBe(`/crombolo/login?returnUrl=${encodeURIComponent('/about?x=1')}`)
    expect(at('//evil.example/x')).toBe(`/crombolo/login?returnUrl=${encodeURIComponent('/')}`)
  })

  test('a browser opening an address, not a script calling an API', () => {
    const asked = (init: RequestInit) => isBrowserNavigation(new Request('http://x/', init))
    expect(asked({})).toBe(true)
    expect(asked({ headers: { accept: 'text/html,application/xhtml+xml' } })).toBe(true)
    expect(asked({ headers: { 'sec-fetch-mode': 'navigate' } })).toBe(true)
    expect(asked({ headers: { 'sec-fetch-mode': 'no-cors' } })).toBe(true)
    expect(asked({ headers: { 'sec-fetch-mode': 'cors' } })).toBe(false)
    expect(asked({ headers: { accept: 'application/json' } })).toBe(false)
    expect(asked({ headers: { authorization: 'Bearer x' } })).toBe(false)
    expect(asked({ method: 'POST' })).toBe(false)
  })

  test("every answer is the browser's alone and never indexed", () => {
    const marked = (cacheControl?: string) =>
      privateAnswer(
        new Response('x', { headers: cacheControl ? { 'cache-control': cacheControl } : {} }),
      ).headers
    expect(marked('public, max-age=60, s-maxage=600').get('cache-control')).toBe(
      'private, max-age=60',
    )
    expect(marked('private, no-store').get('cache-control')).toBe('private, no-store')
    expect(marked().get('cache-control')).toBe('private')
    expect(marked().get('x-robots-tag')).toBe('noindex, nofollow')
    const redirect = privateAnswer(Response.redirect('http://x/a', 302))
    expect(redirect.status).toBe(302)
    expect(redirect.headers.get('location')).toBe('http://x/a')
  })

  test('the site and its back office on one host, or a warning', () => {
    expect(sameHostProblem('https://www.acme.test', [])).toBeUndefined()
    expect(sameHostProblem('https://www.acme.test', ['*1050'])).toBeUndefined()
    expect(
      sameHostProblem('https://www.acme.test', ['https://www.acme.test/en', 'acme.test']),
    ).toBeUndefined()
    expect(sameHostProblem('https://cms.acme.test', ['www.acme.test/en'])).toContain(
      'cms.acme.test is not among',
    )
  })
})

const TYPE_TOML = `[content-type]
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
`

const VIEW = `import { headers } from '@crombolo/crombolo/headers'

async function Seen() {
  const h = await headers()
  return <p class="cookie">[{h.get('cookie') ?? ''}]</p>
}

export default function Page({ model }) {
  return <main><h1>{model.text('title')}</h1><Seen /></main>
}
`

/** What the site's middleware and routes were shown of the cookies. */
const middlewareSaw: string[] = []

describe(`a site open only to its back-office users (${dialectUnderTest})`, () => {
  let root: string
  let h: Harness
  let web: ServerHandle
  let home: string
  let about: string

  const siteConfig = (overrides: Partial<CromboloConfig> = {}): Partial<CromboloConfig> => ({
    siteDir: root,
    sqliteFile: join(root, 'site.sqlite'),
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    componentsCacheDir: join(root, '.cache', 'components'),
    siteAccess: 'users',
    deliveryApi: { enabled: true, apiKey: 'the-front-end-key' },
    workspaces: true,
    workspacesHost: '{workspace}.preview.test',
    links: { maxDays: 30 },
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
    middleware: {
      request: [
        {
          name: 'peek',
          handle: (request, next) => {
            middlewareSaw.push(request.headers.get('cookie') ?? '')
            return next()
          },
        },
      ],
    },
    ...overrides,
  })

  /** A browser of no session, or of the one in `cookie`. */
  const visit = (server: ServerHandle, path: string, init: RequestInit = {}, cookie?: string) => {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('cookie', cookie)
    return server.fetch(
      new Request(path.startsWith('/') ? `${ORIGIN}${path}` : path, {
        ...init,
        headers,
        redirect: 'manual',
      }),
    )
  }
  const cookieOf = (harness: Harness) => parseCookies(harness.cookie())
  /** Only the named cookies of a Cookie header. */
  const only = (cookie: string, ...kept: string[]) =>
    [...parseCookies(cookie)]
      .filter(([name]) => kept.includes(name))
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('; ')
  const names = () =>
    cookieNames({
      siteName: h.server.config.siteName,
      securePrefix: h.server.config.secureCookies,
    })

  beforeAll(async () => {
    mkdirSync(join(process.cwd(), 'output'), { recursive: true })
    root = mkdtempSync(join(process.cwd(), 'output', 'site-access-'))
    mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
    mkdirSync(join(root, 'components'), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), TYPE_TOML)
    writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
    writeFileSync(join(root, 'package.json'), '{ "name": "site" }\n')
    h = await signedInServer({ config: { ...siteConfig(), schemaWritable: true } })
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
    const body = (name: string, title: string) => ({
      template: { id: componentKey },
      values: [{ alias: 'title', culture: null, segment: null, value: title }],
      variants: [{ culture: null, segment: null, name }],
    })
    const page = async (name: string, parent: string | null) => {
      const created = await h.post(`${V1}/document`, {
        ...body(name, `${name} published`),
        documentType: { id: typeKey },
        parent: parent ? { id: parent } : null,
      })
      expect(created.status).toBe(201)
      const key = created.headers.get('umb-generated-resource') as string
      expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(
        200,
      )
      const saved = await h.put(`${V1}/document/${key}`, body(name, `${name} draft`))
      expect(saved.status).toBe(200)
      return key
    }
    home = await page('Home', null)
    about = await page('About', home)
    web = await bootServer({ keepDatabase: true, config: siteConfig({ role: 'web' }) })
  }, 60_000)

  afterAll(async () => {
    await web?.close()
    await h?.db.close()
    rmSync(root, { recursive: true, force: true })
  })

  test('a browser not signed in goes to the sign-in and back to the same path, on either node', async () => {
    for (const server of [h.server, web])
      for (const path of [
        '/',
        '/about?x=1',
        '/media/1234/photo.jpg',
        '/api/hello',
        '/umbraco/members/login',
      ]) {
        const answer = await visit(server, path)
        expect(answer.status, `${server.config.role} ${path}`).toBe(303)
        expect(answer.headers.get('location')).toBe(
          `${BACKOFFICE}/login?returnUrl=${encodeURIComponent(path)}`,
        )
        expect(answer.headers.get('x-robots-tag')).toBe('noindex, nofollow')
      }
  })

  test('an API call without a session is a 401 with problem details', async () => {
    for (const server of [h.server, web]) {
      const asked = await visit(server, '/api/hello', { headers: { accept: 'application/json' } })
      expect(asked.status).toBe(401)
      expect(asked.headers.get('content-type')).toContain('application/problem+json')
      expect(((await asked.json()) as { status: number }).status).toBe(401)
      const posted = await visit(server, '/api/hello', { method: 'POST' })
      expect(posted.status).toBe(401)
    }
  })

  test('signed in, the site opens on both nodes, whatever the group', async () => {
    const writer = await signInAsGroup(h, 'writer', 'site-reader@example.com')
    for (const server of [h.server, web])
      for (const who of [h, writer]) {
        const page = await visit(server, '/about', {}, who.cookie())
        expect(page.status, server.config.role).toBe(200)
        expect(await page.text()).toContain('About published')
        expect(page.headers.get('cache-control')).toStartWith('private')
        expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
        expect((await visit(server, '/api/hello', {}, who.cookie())).status).toBe(200)
      }
  })

  test('an expired access token is let in by a live refresh token, which is not spent or extended', async () => {
    const reader = await signIn(h.server, ADMIN)
    const tokens = () =>
      h.server.db.q
        .selectFrom('auth_token')
        .select(['id', 'expires_at', 'revoked_at'])
        .orderBy('id')
        .execute()
    await h.server.db.q
      .updateTable('auth_token')
      .set({ expires_at: DbDate.toDb(new Date(Date.now() - 60_000)) })
      .where('token_type', '=', 'access')
      .where('session_id', '=', cookieOf(reader).get(names().session) as string)
      .execute()
    const before = await tokens()
    const withRefresh = only(reader.cookie(), names().accessToken, names().refreshToken)
    for (const server of [h.server, web]) {
      const answers = await Promise.all(
        Array.from({ length: 4 }, () => visit(server, '/about', {}, withRefresh)),
      )
      expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200])
    }
    expect(await tokens()).toEqual(before)
    // The access token alone, expired, opens nothing.
    expect(
      (await visit(web, '/about', {}, only(reader.cookie(), names().accessToken))).status,
    ).toBe(303)
    // The session alone, as a sign-in through the login page leaves it, opens the site.
    expect((await visit(web, '/about', {}, only(reader.cookie(), names().session))).status).toBe(
      200,
    )
  })

  test('signing out, an ended session or a disabled user closes the site at once', async () => {
    const leaving = await signIn(h.server, ADMIN)
    const cookie = leaving.cookie()
    expect((await visit(web, '/', {}, cookie)).status).toBe(200)
    await leaving.call(`${V1}/security/back-office/signout`)
    for (const kept of [cookie, only(cookie, names().refreshToken), only(cookie, names().session)])
      expect((await visit(web, '/', {}, kept)).status).toBe(303)

    const ended = await signIn(h.server, ADMIN)
    const auth = new AuthService(new AuthStore(h.server.db))
    const sessionId = cookieOf(ended).get(names().session) as string
    expect(await auth.resolveActiveSession(sessionId)).toBeDefined()
    await new AuthStore(h.server.db).endSession(sessionId)
    expect(await auth.resolveActiveSession(sessionId)).toBeUndefined()
    expect(
      await auth.resolveRefreshToken(cookieOf(ended).get(names().refreshToken) as string),
    ).toBeUndefined()
    expect((await visit(h.server, '/', {}, ended.cookie())).status).toBe(303)

    const disabled = await signInAsGroup(h, 'writer', 'site-leaver@example.com')
    expect((await visit(web, '/', {}, disabled.cookie())).status).toBe(200)
    await h.server.db.q
      .updateTable('user_account')
      .set({ is_locked_out: h.server.db.dialect.boolValue(true) })
      .where('user_name', '=', 'site-leaver@example.com')
      .execute()
    for (const kept of [
      disabled.cookie(),
      only(disabled.cookie(), names().refreshToken),
      only(disabled.cookie(), names().session),
    ])
      expect((await visit(web, '/', {}, kept)).status).toBe(303)
  })

  test('a write relying on the cookie from another site is refused; from this one it goes through', async () => {
    const from = (origin: string) =>
      visit(h.server, '/api/hello', { method: 'POST', headers: { origin } }, h.cookie())
    expect((await from('https://evil.example')).status).toBe(401)
    expect((await from(ORIGIN)).status).toBe(200)
  })

  test("the site's code never sees the back office's cookies", async () => {
    middlewareSaw.length = 0
    const cookie = `${h.cookie()}; region=en`
    const page = await (await visit(h.server, '/about', {}, cookie)).text()
    expect(page).toContain('[region=en]')
    const routed = (await (await visit(web, '/api/hello', {}, cookie)).json()) as { cookie: string }
    expect(routed.cookie).toBe('region=en')
    expect(middlewareSaw.length).toBeGreaterThan(0)
    for (const seen of middlewareSaw) expect(seen).toBe('region=en')
  })

  test('the Delivery API answers its key without a session, and a session without its key', async () => {
    const content = `${DELIVERY_API_PREFIX}/v2/content`
    for (const server of [h.server, web]) {
      expect((await visit(server, content)).status).toBe(401)
      const keyed = await visit(server, content, { headers: { 'api-key': 'the-front-end-key' } })
      expect(keyed.status).toBe(200)
      expect((await visit(server, content, {}, h.cookie())).status).toBe(200)
    }
  })

  test('the Management API, the sign-in and /health are as they were', async () => {
    const bearer = cookieOf(h).get(names().accessToken) as string
    const asked = await visit(h.server, `${V1}/user/current`, {
      headers: { authorization: `Bearer ${bearer}` },
    })
    expect(asked.status).toBe(200)
    expect((await visit(h.server, `${V1}/user/current`)).status).toBe(401)
    expect((await visit(h.server, `${BACKOFFICE}/login`)).status).toBe(200)
    expect((await visit(h.server, BACKOFFICE)).status).toBe(200)
    expect((await visit(web, '/health')).status).toBe(200)
  })

  test('robots.txt disallows everything, to anyone', async () => {
    for (const server of [h.server, web]) {
      const robots = await visit(server, '/robots.txt')
      expect(robots.status).toBe(200)
      expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
      expect(robots.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    }
  })

  test("a preview link opens its page's draft for a browser with no account, and nothing else", async () => {
    const asked = await h.post(`${BACKOFFICE}/crombolo/api/preview-link`, { document: about })
    const { url } = (await asked.json()) as { url: string }
    const first = await visit(h.server, url)
    expect(first.status).toBe(303)
    const cookie = first.headers.get('set-cookie')?.split(';')[0] as string
    const location = first.headers.get('location') as string
    const page = await visit(h.server, location, {}, cookie)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('About draft')
    expect((await visit(h.server, '/', {}, cookie)).status).toBe(303)
  })

  test("a workspace's link opens its site for a browser with no account", async () => {
    const workspaces = `${BACKOFFICE}/crombolo/api/workspaces`
    const opened = (await (await h.post(workspaces, { name: 'Spring sale' })).json()) as {
      key: string
    }
    const link = (await (
      await h.post(`${workspaces}/${opened.key}/links`, { days: 2 })
    ).json()) as {
      url: string
    }
    const first = await visit(h.server, link.url)
    expect(first.status).toBe(303)
    const cookie = first.headers.get('set-cookie')?.split(';')[0] as string
    const host = new URL(link.url).origin
    const page = await visit(h.server, `${host}/about`, {}, cookie)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('About published')
    expect((await visit(h.server, `${host}/about`)).status).toBe(404)
  })
})

describe(`a public site (${dialectUnderTest})`, () => {
  let h: Harness
  beforeAll(async () => {
    h = await signedInServer({
      config: {
        routes: [
          route('/api/hello', { GET: (request) => ok({ cookie: request.headers.get('cookie') }) }),
        ],
      },
    })
  }, 60_000)
  afterAll(() => h?.db.close())

  test('answers anyone as it did, and its code still never sees the back office cookies', async () => {
    const anyone = await h.server.fetch(new Request(`${ORIGIN}/api/hello`))
    expect(anyone.status).toBe(200)
    expect(anyone.headers.get('x-robots-tag')).toBeNull()
    expect(((await anyone.json()) as { cookie: string | null }).cookie).toBeNull()
    const signedIn = await h.server.fetch(
      new Request(`${ORIGIN}/api/hello`, { headers: { cookie: `${h.cookie()}; region=en` } }),
    )
    expect(((await signedIn.json()) as { cookie: string }).cookie).toBe('region=en')
    const robots = await (await h.server.fetch(new Request(`${ORIGIN}/robots.txt`))).text()
    expect(robots).not.toBe('User-agent: *\nDisallow: /\n')
  })
})

describe(`one way in (${dialectUnderTest})`, () => {
  const provider = (id: string) =>
    oidc({ id, name: id, issuer: `https://${id}.idp.test`, clientId: 'crombolo' })
  const loginAt = async (config: Partial<CromboloConfig>, query = '') => {
    const server = await bootServer({ config })
    try {
      return await server.fetch(
        new Request(`${ORIGIN}${server.config.backOfficePath}/login${query}`, {
          redirect: 'manual',
        }),
      )
    } finally {
      await server.close()
    }
  }
  const returning = `?returnUrl=${encodeURIComponent('/about')}`

  for (const siteAccess of ['public', 'users'] as const)
    test(`goes straight to the provider, with ${siteAccess}`, async () => {
      const straight = await loginAt(
        { siteAccess, allowLocalLogin: false, backofficeIdentityProviders: [provider('only')] },
        returning,
      )
      expect(straight.status).toBe(303)
      expect(straight.headers.get('location')).toBe(
        `/umbraco/management/api/v1/security/back-office/external/only?returnUrl=${encodeURIComponent('/about')}`,
      )
    })

  test('a refused sign-in shows its error on the screen, and is not sent round again', async () => {
    const refused = await loginAt(
      { allowLocalLogin: false, backofficeIdentityProviders: [provider('only')] },
      `${returning}&externalLoginError=${encodeURIComponent('This account is locked out.')}`,
    )
    expect(refused.status).toBe(200)
    expect(await refused.text()).toContain('external/only?returnUrl=')
  })

  test('the screen is shown when there is more than one way in', async () => {
    const passwords = await loginAt({ backofficeIdentityProviders: [provider('only')] }, returning)
    expect(passwords.status).toBe(200)
    const two = await loginAt(
      { allowLocalLogin: false, backofficeIdentityProviders: [provider('one'), provider('two')] },
      returning,
    )
    expect(two.status).toBe(200)
  })
})

test('a misspelt site access stops the server', () => {
  expect(() => loadConfig({ siteAccess: 'staff' as never })).toThrow('CROMBOLO_SITE_ACCESS must be')
})
