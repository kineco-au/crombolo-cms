/**
 * Story 186: a server bundle's member and public routes, under
 * `/crombolo/bundle/<id>/` — who may call them, the anti-forgery token a
 * cookie-driven write carries, rate limits, CORS, and which nodes answer.
 *
 * The dispatcher is tested first with stub members and no database; then on a
 * real site, where the member signs in, the page writes the token and the
 * Delivery API issues the bearer token.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CorsPolicy } from '@crombolo/api-delivery'
import { antiforgeryToken, type MemberTicket, verifyAntiforgery } from '@crombolo/auth'
import { ComponentRepository, ContentTypeRepository, SYSTEM_MEMBER_TYPE } from '@crombolo/data'
import { ANTIFORGERY_HEADER, BUNDLE_SCRIPT, BUNDLE_SCRIPT_PATH } from '@crombolo/render'
import {
  type BundleCaller,
  type BundleHost,
  type BundleMember,
  type BundleSiteOptions,
  type CallerCapabilities,
  callerAddress,
  createServerBundles,
  RateLimiter,
  type ServerBundle,
  type ServerBundleRoute,
  type ServerHandle,
  VERSION,
  validateServerBundles,
} from '@crombolo/server'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { bootServer, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const SITE = '/crombolo/bundle/'
const PLUGIN_API = '/umbraco/crombolo/api'

const ada: BundleMember = {
  key: 'aaaaaaaa-0000-4000-8000-000000000001',
  name: 'Ada',
  username: 'ada',
  email: 'ada@example.test',
  groups: ['Observers'],
}
const bob: BundleMember = {
  key: 'bbbbbbbb-0000-4000-8000-000000000002',
  name: 'Bob',
  username: 'bob',
  email: 'bob@example.test',
  groups: [],
}

const log = { info: () => {}, warn: () => {}, error: () => {} }
const stubHost = (): Omit<BundleHost, 'tables' | 'media'> => ({
  redirects: {} as BundleHost['redirects'],
  documents: { url: async () => undefined },
  log,
  identityProviders: {} as BundleHost['identityProviders'],
})

/**
 * Cookie `member=<username>` signs in, and that session's token is
 * `token-<username>`. Bearer `bearer-<username>` names the member too.
 */
const stubSite = (over: Partial<BundleSiteOptions> = {}): BundleSiteOptions => {
  const named = (name: string | undefined) => [ada, bob].find((m) => m.username === name)
  return {
    session: async (request) => {
      const member = named(/member=(\w+)/.exec(request.headers.get('cookie') ?? '')?.[1])
      return member && { member, verify: async (token) => token === `token-${member.username}` }
    },
    memberByToken: async (token) => named(/^bearer-(\w+)$/.exec(token)?.[1]),
    callerAddress: (request) => callerAddress(undefined, request.headers.get('x-forwarded-for')),
    ...over,
  }
}

const bundle = (routes: ServerBundleRoute[], over: Partial<ServerBundle> = {}): ServerBundle =>
  ({
    id: 'visits',
    section: 'settings',
    capabilities: ['log'],
    routes,
    ...over,
  }) as ServerBundle

function mount(
  bundles: ServerBundle[],
  options: { site?: BundleSiteOptions; callerHost?: CallerCapabilities } = {},
) {
  return createServerBundles({
    bundles,
    packages: bundles.map((b) => stubBundlePackage(b.id)),
    coreVersion: VERSION,
    pluginApiPath: PLUGIN_API,
    host: stubHost(),
    log: () => log,
    site: options.site ?? stubSite(),
    callerHost: options.callerHost,
  })
}

const visit = async (
  bundles: ReturnType<typeof mount>,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<Response> => {
  const url = new URL(`http://localhost${SITE}visits/${path}`)
  return (await bundles.site(new Request(url, init), url)) as Response
}

const seen: unknown[] = []
const echo = (context: { member?: BundleMember; principal?: unknown; caller: BundleCaller }) => {
  seen.push(context)
  return Response.json({
    member: context.member ?? null,
    principal: context.principal ?? null,
    caller: context.caller.kind,
  })
}

describe('declaring an audience', () => {
  const validate = (routes: unknown[]) =>
    validateServerBundles(
      [bundle(routes as ServerBundleRoute[])],
      [stubBundlePackage('visits')],
      VERSION,
    )
  const route = (over: Record<string, unknown>) => ({
    method: 'GET',
    path: 'x',
    handler: echo,
    ...over,
  })

  test('accepts the back office, members, members of named groups, and anyone', () => {
    for (const audience of [
      undefined,
      'backoffice',
      'member',
      { member: { groups: ['Observers'] } },
      'public',
    ])
      expect(validate([route({ audience })]), JSON.stringify(audience)).toEqual([])
  })

  test('refuses an audience it does not know, or groups that are not names', () => {
    for (const audience of [
      'members',
      'anyone',
      { member: { groups: [] } },
      { member: { groups: [''] } },
      { member: {} },
      { members: { groups: ['Observers'] } },
    ])
      expect(validate([route({ audience })]).join(), JSON.stringify(audience)).toContain('route')
  })

  test('accepts a rate limit on a member or public route, and refuses one in the back office', () => {
    const limit = { max: 5, perSeconds: 60, by: 'caller' }
    expect(validate([route({ audience: 'public', rateLimit: limit })])).toEqual([])
    expect(
      validate([route({ audience: 'member', rateLimit: { ...limit, by: 'member' } })]),
    ).toEqual([])
    expect(validate([route({ rateLimit: limit })]).join()).toContain(
      'a rate limit applies only to member and public routes',
    )
  })

  test('refuses a rate limit that cannot be counted', () => {
    for (const rateLimit of [
      { max: 0, perSeconds: 60, by: 'caller' },
      { max: 1.5, perSeconds: 60, by: 'caller' },
      { max: 5, perSeconds: -1, by: 'caller' },
      { max: 5, perSeconds: 60, by: 'session' },
    ])
      expect(
        validate([route({ audience: 'public', rateLimit })]),
        JSON.stringify(rateLimit),
      ).not.toBeEmpty()
    expect(
      validate([
        route({ audience: 'public', rateLimit: { max: 5, perSeconds: 60, by: 'member' } }),
      ]).join(),
    ).toContain('a public route has no member to count by')
  })

  test('lets a back-office route and a site route share a path', () => {
    expect(validate([route({}), route({ audience: 'public' })])).toEqual([])
    expect(
      validate([route({ audience: 'public' }), route({ audience: 'member' })]).join(),
    ).toContain('twice')
  })
})

describe('who a site route lets in', () => {
  const routes: ServerBundleRoute[] = [
    { method: 'GET', path: 'species', audience: 'public', handler: echo },
    { method: 'GET', path: 'records', audience: 'member', handler: echo },
    { method: 'POST', path: 'records', audience: 'member', handler: echo },
    {
      method: 'GET',
      path: 'reviews',
      audience: { member: { groups: ['observers'] } },
      handler: echo,
    },
    { method: 'GET', path: 'admin', handler: echo },
  ]

  test('a public route answers anyone, and is given nobody even when a member is signed in', async () => {
    const bundles = mount([bundle(routes)])
    for (const headers of [{}, { cookie: 'member=ada' }] as Record<string, string>[]) {
      const response = await visit(bundles, 'species', { headers })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ member: null, principal: null, caller: 'public' })
    }
  })

  test('a member route refuses a visitor with 401, and gives a member as they are', async () => {
    const bundles = mount([bundle(routes)])
    const anonymous = await visit(bundles, 'records')
    expect(anonymous.status).toBe(401)
    expect(await anonymous.text()).toBe('Sign in to continue.')

    const response = await visit(bundles, 'records', { headers: { cookie: 'member=ada' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ member: ada, principal: null, caller: 'member' })
    const given = seen.at(-1) as { member: BundleMember; caller: BundleCaller }
    expect(Object.isFrozen(given.member)).toBe(true)
    expect(Object.isFrozen(given.member.groups)).toBe(true)
    expect(Object.isFrozen(given.caller)).toBe(true)
    expect(given.caller).toEqual({ kind: 'member', member: ada, via: 'cookie' })
  })

  test('a route for named groups refuses a member outside them with 403, in any case', async () => {
    const bundles = mount([bundle(routes)])
    expect((await visit(bundles, 'reviews', { headers: { cookie: 'member=bob' } })).status).toBe(
      403,
    )
    expect((await visit(bundles, 'reviews', { headers: { cookie: 'member=ada' } })).status).toBe(
      200,
    )
    expect((await visit(bundles, 'reviews')).status).toBe(401)
  })

  test('a member token works as the cookie does, and a bad one is not passed over for the cookie', async () => {
    const bundles = mount([bundle(routes)])
    const response = await visit(bundles, 'records', {
      headers: { authorization: 'Bearer bearer-ada' },
    })
    expect(response.status).toBe(200)
    expect((seen.at(-1) as { caller: BundleCaller }).caller).toEqual({
      kind: 'member',
      member: ada,
      via: 'token',
    })
    expect(
      (await visit(bundles, 'reviews', { headers: { authorization: 'Bearer bearer-bob' } })).status,
    ).toBe(403)
    const bad = await visit(bundles, 'records', {
      headers: { authorization: 'Bearer nonsense', cookie: 'member=ada' },
    })
    expect(bad.status).toBe(401)
    expect(bad.headers.get('www-authenticate')).toContain('invalid_token')
  })

  test('without a way to identify members, every member route answers 401', async () => {
    const bundles = createServerBundles({
      bundles: [bundle(routes)],
      packages: [stubBundlePackage('visits')],
      coreVersion: VERSION,
      pluginApiPath: PLUGIN_API,
      host: stubHost(),
      log: () => log,
    })
    const url = new URL(`http://localhost${SITE}visits/records`)
    const response = await bundles.site(
      new Request(url, { headers: { cookie: 'member=ada' } }),
      url,
    )
    expect(response?.status).toBe(401)
  })

  test('a back-office route is not on the site, and unknown paths and methods say so', async () => {
    const bundles = mount([bundle(routes)])
    expect((await visit(bundles, 'admin')).status).toBe(404)
    expect((await visit(bundles, 'nothing')).status).toBe(404)
    expect((await visit(bundles, 'species', { method: 'DELETE' })).status).toBe(405)
    const url = new URL(`http://localhost${SITE}other/species`)
    expect((await bundles.site(new Request(url), url))?.status).toBe(404)
    const outside = new URL('http://localhost/crombolo/forms/x')
    expect(await bundles.site(new Request(outside), outside)).toBeUndefined()
  })

  test('the back office still gives its routes the principal, as their caller', async () => {
    const bundles = mount([bundle(routes)])
    const principal = { isAdmin: true, allowedSections: ['settings'] } as never
    const url = new URL(`http://localhost${PLUGIN_API}/bundle/visits/admin`)
    expect((await bundles.handle(new Request(url), url, principal))?.status).toBe(200)
    expect((seen.at(-1) as { caller: BundleCaller }).caller).toEqual({
      kind: 'backoffice',
      principal,
    })
    const member = new URL(`http://localhost${PLUGIN_API}/bundle/visits/records`)
    expect((await bundles.handle(new Request(member), member, principal))?.status).toBe(404)
  })
})

describe('the anti-forgery token', () => {
  const routes: ServerBundleRoute[] = [
    { method: 'GET', path: 'records', audience: 'member', handler: echo },
    { method: 'POST', path: 'records', audience: 'member', handler: echo },
    { method: 'DELETE', path: 'records/:id', audience: 'member', handler: echo },
    { method: 'POST', path: 'sightings', audience: 'public', handler: echo },
  ]
  const write = (headers: Record<string, string>, method = 'POST', path = 'records') =>
    visit(mount([bundle(routes)]), path, { method, headers })

  test('a cookie write without it is refused with 403, naming the meta tag', async () => {
    const refused = await write({ cookie: 'member=ada' })
    expect(refused.status).toBe(403)
    expect(await refused.text()).toContain('<AntiforgeryMeta />')
    expect((await write({ cookie: 'member=ada' }, 'DELETE', 'records/1')).status).toBe(403)
  })

  test("a cookie write with the session's token is let through", async () => {
    expect((await write({ cookie: 'member=ada', [ANTIFORGERY_HEADER]: 'token-ada' })).status).toBe(
      200,
    )
  })

  test("another session's token is refused", async () => {
    expect((await write({ cookie: 'member=ada', [ANTIFORGERY_HEADER]: 'token-bob' })).status).toBe(
      403,
    )
  })

  test('a read needs none, nor does a write with a member token, nor a public route', async () => {
    expect((await write({ cookie: 'member=ada' }, 'GET')).status).toBe(200)
    expect((await write({ authorization: 'Bearer bearer-ada' })).status).toBe(200)
    expect((await write({ cookie: 'member=ada' }, 'POST', 'sightings')).status).toBe(200)
  })

  const ticket: MemberTicket = { id: ada.key, stamp: 'stamp-1', expires: 2_000_000_000 }

  test('is an HMAC of the session, so it ends with the session and its stamp', async () => {
    const token = await antiforgeryToken('secret', ticket)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await antiforgeryToken('secret', ticket)).toBe(token)
    expect(await verifyAntiforgery('secret', ticket, token)).toBe(true)
    for (const other of [
      { ...ticket, id: bob.key },
      { ...ticket, stamp: 'stamp-2' },
      { ...ticket, expires: ticket.expires + 1 },
    ])
      expect(await verifyAntiforgery('secret', other, token), JSON.stringify(other)).toBe(false)
    expect(await verifyAntiforgery('another', ticket, token)).toBe(false)
  })

  test('refuses a missing, malformed or altered token', async () => {
    const token = await antiforgeryToken('secret', ticket)
    const altered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    for (const value of [null, undefined, '', 'short', `${token}x`, altered])
      expect(await verifyAntiforgery('secret', ticket, value), String(value)).toBe(false)
  })
})

describe('rate limits', () => {
  let now = 1_000_000
  const clock = () => now
  const limited = (by: 'member' | 'caller', audience: 'member' | 'public' = 'member') =>
    mount(
      [
        bundle([
          {
            method: 'GET',
            path: 'records',
            audience,
            rateLimit: { max: 2, perSeconds: 60, by },
            handler: echo,
          } as ServerBundleRoute,
        ]),
      ],
      { site: stubSite({ now: clock }) },
    )

  test('answer 429 with retry-after once a caller has made max requests', async () => {
    const bundles = limited('caller', 'public')
    const from = (address: string) =>
      visit(bundles, 'records', { headers: { 'x-forwarded-for': address } })
    expect((await from('203.0.113.1')).status).toBe(200)
    now += 10_000
    expect((await from('203.0.113.1')).status).toBe(200)
    const refused = await from('203.0.113.1')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('retry-after')).toBe('50')
    expect((await from('203.0.113.2')).status).toBe(200)
    now += 50_000
    expect((await from('203.0.113.1')).status).toBe(200)
  })

  test('count a member by their key, however they signed in', async () => {
    const bundles = limited('member')
    expect((await visit(bundles, 'records', { headers: { cookie: 'member=ada' } })).status).toBe(
      200,
    )
    expect(
      (await visit(bundles, 'records', { headers: { authorization: 'Bearer bearer-ada' } })).status,
    ).toBe(200)
    const refused = await visit(bundles, 'records', { headers: { cookie: 'member=ada' } })
    expect(refused.status).toBe(429)
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await visit(bundles, 'records', { headers: { cookie: 'member=bob' } })).status).toBe(
      200,
    )
  })

  test('are held by each route separately', () => {
    const limiter = new RateLimiter({ max: 1, windowMs: 1000, now: () => 0 })
    expect(limiter.take('a')).toBeUndefined()
    expect(limiter.take('a')).toBe(1)
    expect(limiter.take('b')).toBeUndefined()
  })

  test("the caller is the socket's peer, or what the proxy in front of it says", () => {
    expect(callerAddress('203.0.113.9', null)).toBe('203.0.113.9')
    // A client writing its own header to a server it reaches directly is ignored.
    expect(callerAddress('203.0.113.9', '198.51.100.1')).toBe('203.0.113.9')
    // Behind a proxy, the entry the proxy added; anything before it is the client's.
    expect(callerAddress('10.0.0.5', '198.51.100.1, 203.0.113.7')).toBe('203.0.113.7')
    expect(callerAddress('127.0.0.1', '203.0.113.7')).toBe('203.0.113.7')
    expect(callerAddress('::ffff:172.18.0.2', '203.0.113.7')).toBe('203.0.113.7')
    expect(callerAddress(undefined, null)).toBe('unknown')
  })
})

describe('other origins', () => {
  const cors: CorsPolicy = {
    origins: new Set(['https://app.example.com']),
    any: false,
    problems: [],
  }
  const routes: ServerBundleRoute[] = [
    { method: 'GET', path: 'species', audience: 'public', handler: echo },
  ]

  test('an allowed origin gets CORS headers, and any other gets none', async () => {
    const bundles = mount([bundle(routes)], { site: stubSite({ cors }) })
    const allowed = await visit(bundles, 'species', {
      headers: { origin: 'https://app.example.com' },
    })
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    const other = await visit(bundles, 'species', { headers: { origin: 'https://evil.example' } })
    expect(other.status).toBe(200)
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('a pre-flight from an allowed origin is answered', async () => {
    const bundles = mount([bundle(routes)], { site: stubSite({ cors }) })
    const preflight = await visit(bundles, 'species', {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example.com', 'access-control-request-method': 'POST' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')
    expect(preflight.headers.get('access-control-allow-headers')).toContain('Authorization')
  })
})

describe('capabilities', () => {
  test('a site route gets what its bundle declared, and no more', async () => {
    let host: Record<string, unknown> = {}
    const bundles = mount([
      bundle([
        {
          method: 'GET',
          path: 'x',
          audience: 'public',
          handler: (context) => {
            host = context.host as Record<string, unknown>
            return new Response('ok')
          },
        },
      ]),
    ])
    await visit(bundles, 'x')
    expect(Object.keys(host)).toEqual(['log'])
    expect(Object.isFrozen(host)).toBe(true)
  })

  test('a capability built for the caller is built per request, from who is asking', async () => {
    const callers: BundleCaller[] = []
    const bundles = mount(
      [
        bundle(
          [
            { method: 'GET', path: 'p', audience: 'public', handler: echo },
            { method: 'GET', path: 'm', audience: 'member', handler: echo },
            { method: 'GET', path: 'b', handler: echo },
          ],
          { capabilities: ['documents'] },
        ),
      ],
      {
        callerHost: {
          documents: (caller) => {
            callers.push(caller)
            return { url: async () => caller.kind }
          },
        },
      },
    )
    await visit(bundles, 'p')
    await visit(bundles, 'm', { headers: { cookie: 'member=ada' } })
    const principal = { isAdmin: true, allowedSections: ['settings'] } as never
    const url = new URL(`http://localhost${PLUGIN_API}/bundle/visits/b`)
    await bundles.handle(new Request(url), url, principal)
    expect(callers.map((c) => c.kind)).toEqual(['public', 'member', 'backoffice'])
    expect(callers[1]).toEqual({ kind: 'member', member: ada, via: 'cookie' })
  })

  test("a member route's handler is typed with its member", () => {
    const route: ServerBundleRoute<'log'> = {
      method: 'GET',
      path: 'x',
      audience: 'member',
      handler: ({ member, host }) => {
        host.log.info(member.username)
        return new Response(member.key)
      },
    }
    expect(route.audience).toBe('member')
  })
})

describe('the meta tag and the script', () => {
  test('the script sends the token only to this site', () => {
    expect(BUNDLE_SCRIPT_PATH).toBe('/crombolo/bundle.js')
    expect(BUNDLE_SCRIPT).toContain(ANTIFORGERY_HEADER)
    expect(BUNDLE_SCRIPT).toContain('meta[name="crombolo-antiforgery"]')
    expect(BUNDLE_SCRIPT).toContain('url.origin === location.origin')
  })
})

// --- On a real site -----------------------------------------------------------

const BUNDLE_ID = 'visits'
const PACKAGE = { '@acme/visits': { json: { crombolo: { id: BUNDLE_ID, server: 'visits' } } } }
const PASSWORD = 'correct-horse-battery'

const TYPE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`
const VIEW = `import { AntiforgeryMeta } from '@crombolo/crombolo'
export default function Page({ member }) {
  return <html><head><AntiforgeryMeta /></head><body><p>{member ? member.name : 'Visitor'}</p></body></html>
}
`

/** The bundle a site would write: public species, a member's records, and a staff route. */
const visits = (): ServerBundle =>
  ({
    id: BUNDLE_ID,
    section: 'settings',
    capabilities: ['log'],
    routes: [
      { method: 'GET', path: 'species', audience: 'public', handler: echo },
      { method: 'GET', path: 'records', audience: 'member', handler: echo },
      { method: 'POST', path: 'records', audience: 'member', handler: echo },
      {
        method: 'GET',
        path: 'staff',
        audience: { member: { groups: ['Staff'] } },
        handler: echo,
      },
    ],
  }) as ServerBundle

const deliveryApi = {
  enabled: true,
  memberAuthorization: {
    clientCredentialsFlow: {
      enabled: true,
      associatedMembers: [{ userName: 'ada', clientId: 'ada', clientSecret: 'ada-secret' }],
    },
  },
}

const open: Harness[] = []
const servers: ServerHandle[] = []
const dirs: string[] = []
afterAll(async () => {
  for (const server of servers) await server.close()
  for (const h of open) await h.db.close()
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

async function realSite(extra: Record<string, unknown> = {}) {
  // The previous site must finish its background work before this one resets the database.
  while (servers.length > 0) await servers.pop()?.close()
  while (open.length > 0) await open.pop()?.db.close()
  const root = siteDeclaring('bundle-site-routes', PACKAGE)
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), TYPE)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  const config = {
    siteDir: root,
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    bundles: [visits()],
    deliveryApi,
    ...extra,
  }
  const h = await signedInServer({ config })
  open.push(h)

  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const created = await h.post(`${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  if (created.status !== 201) throw new Error(`create ${created.status}: ${await created.text()}`)
  await h.put(`${V1}/document/${created.headers.get('umb-generated-resource')}/publish`, {
    publishSchedules: [],
  })

  const group = async (name: string) =>
    (await h.post(`${V1}/member-group`, { name })).headers.get('umb-generated-resource') as string
  const member = async (username: string, groups: string[] = []) => {
    const response = await h.post(`${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: `${username}@example.test`,
      username,
      password: PASSWORD,
      isApproved: true,
      groups,
      values: [],
      variants: [{ culture: null, segment: null, name: username }],
    })
    if (response.status !== 201) throw new Error(`member ${username}: ${response.status}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const send = (server: ServerHandle, path: string, init: RequestInit = {}) =>
    server.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }))
  const signIn = async (username: string) => {
    const response = await send(h.server, '/umbraco/members/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    })
    expect(response.status).toBe(200)
    return (response.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
  }
  const page = async (cookie?: string) =>
    (await send(h.server, '/', { headers: cookie ? { cookie } : {} })).text()
  const tokenIn = (markup: string) =>
    /<meta name="crombolo-antiforgery" content="([^"]+)"/.exec(markup)?.[1]
  return { h, root, config, group, member, send, signIn, page, tokenIn }
}

describe('member and public routes on a real site', () => {
  test('a public route answers a visitor; a member route answers the signed-in member', async () => {
    const s = await realSite()
    const staff = await s.group('Staff')
    await s.member('ada', [staff])
    await s.member('bob')

    const species = await s.send(s.h.server, `${SITE}${BUNDLE_ID}/species`)
    expect(species.status).toBe(200)
    expect(await species.json()).toMatchObject({ member: null, caller: 'public' })
    expect((await s.send(s.h.server, `${SITE}${BUNDLE_ID}/records`)).status).toBe(401)

    const cookie = await s.signIn('ada')
    const records = await s.send(s.h.server, `${SITE}${BUNDLE_ID}/records`, { headers: { cookie } })
    expect(records.status).toBe(200)
    expect(((await records.json()) as { member: BundleMember }).member).toMatchObject({
      name: 'ada',
      username: 'ada',
      email: 'ada@example.test',
      groups: ['Staff'],
    })
    expect(
      (await s.send(s.h.server, `${SITE}${BUNDLE_ID}/staff`, { headers: { cookie } })).status,
    ).toBe(200)
    const bob = await s.signIn('bob')
    expect(
      (await s.send(s.h.server, `${SITE}${BUNDLE_ID}/staff`, { headers: { cookie: bob } })).status,
    ).toBe(403)
    expect((await s.send(s.h.server, `${SITE}${BUNDLE_ID}/nothing`)).status).toBe(404)
  })

  test('the page carries the token for a member only, and it lets their writes through', async () => {
    const s = await realSite()
    await s.member('ada')
    await s.member('bob')
    expect(s.tokenIn(await s.page())).toBeUndefined()

    const cookie = await s.signIn('ada')
    const token = s.tokenIn(await s.page(cookie)) as string
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const post = (headers: Record<string, string>) =>
      s.send(s.h.server, `${SITE}${BUNDLE_ID}/records`, { method: 'POST', headers })

    expect((await post({ cookie })).status).toBe(403)
    expect((await post({ cookie, [ANTIFORGERY_HEADER]: token })).status).toBe(200)

    const bob = await s.signIn('bob')
    const bobs = s.tokenIn(await s.page(bob)) as string
    expect(bobs).not.toBe(token)
    expect((await post({ cookie, [ANTIFORGERY_HEADER]: bobs })).status).toBe(403)

    // Signing out clears the cookie, so the token has no session to belong to.
    const out = await s.send(s.h.server, '/umbraco/members/logout', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
    })
    const cleared = (out.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
    expect(cleared.endsWith('=')).toBe(true)
    expect((await post({ cookie: cleared, [ANTIFORGERY_HEADER]: token })).status).toBe(401)
  })

  test("a member's token is refused once their security stamp rotates", async () => {
    const s = await realSite()
    const key = await s.member('ada')
    const cookie = await s.signIn('ada')
    const token = s.tokenIn(await s.page(cookie)) as string
    // As a password change does, which ends every session the member had.
    await s.h.server.db.exec(
      'UPDATE member SET security_stamp_token = ? WHERE node_id = (SELECT id FROM node WHERE unique_id = ?)',
      ['rotated', key],
    )
    expect(
      (
        await s.send(s.h.server, `${SITE}${BUNDLE_ID}/records`, {
          method: 'POST',
          headers: { cookie, [ANTIFORGERY_HEADER]: token },
        })
      ).status,
    ).toBe(401)
  })

  test('a Delivery API member token works without the cookie, and needs no anti-forgery token', async () => {
    const s = await realSite()
    await s.member('ada')
    const issued = await s.send(s.h.server, '/umbraco/delivery/api/v1/security/member/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'umbraco-member-ada',
        client_secret: 'ada-secret',
      }).toString(),
    })
    expect(issued.status).toBe(200)
    const { access_token } = (await issued.json()) as { access_token: string }
    const response = await s.send(s.h.server, `${SITE}${BUNDLE_ID}/records`, {
      method: 'POST',
      headers: { authorization: `Bearer ${access_token}` },
    })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { member: BundleMember }).member.username).toBe('ada')
    expect(
      (
        await s.send(s.h.server, `${SITE}${BUNDLE_ID}/records`, {
          headers: { authorization: 'Bearer not-a-token' },
        })
      ).status,
    ).toBe(401)
  })

  test('the script is served beside the forms script', async () => {
    const s = await realSite()
    const script = await s.send(s.h.server, BUNDLE_SCRIPT_PATH)
    expect(script.status).toBe(200)
    expect(script.headers.get('content-type')).toContain('javascript')
    expect(await script.text()).toBe(BUNDLE_SCRIPT)
  })

  test('a web node answers member and public routes, and an api node does not', async () => {
    const sqliteFile = join(
      process.cwd(),
      'output',
      `bundle-site-routes-${crypto.randomUUID()}.sqlite`,
    )
    dirs.push(sqliteFile, `${sqliteFile}-wal`, `${sqliteFile}-shm`)
    const s = await realSite({ sqliteFile })
    for (const role of ['web', 'api'] as const) {
      const server = await bootServer({
        keepDatabase: true,
        config: { ...s.config, sqliteFile, role, nodeId: `${role}-node` },
      })
      servers.push(server)
      const species = await s.send(server, `${SITE}${BUNDLE_ID}/species`)
      const script = await s.send(server, BUNDLE_SCRIPT_PATH)
      if (role === 'web') {
        expect(species.status).toBe(200)
        expect(script.status).toBe(200)
      } else {
        expect(species.status).toBe(404)
        expect(script.status).toBe(404)
      }
    }
  })
})
