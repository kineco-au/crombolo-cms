/**
 * Story 211: route handlers, the site's own and a bundle's. The pipeline first,
 * with stand-in members: matching and params, methods, results and outcomes,
 * errors as problem+json or the status page, the time limit, caching, CSRF,
 * members and rate limits. Then on a real site, where a member signs in, the
 * page writes the anti-forgery token and the Delivery API issues a bearer
 * token; and a bundle's site routes carry its capabilities.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { antiforgeryToken, type MemberTicket, verifyAntiforgery } from '@crombolo/auth'
import { Outcome, ok, rewrite, route, type SiteRoute } from '@crombolo/common'
import { headers as requestHeaders } from '@crombolo/crombolo/headers'
import { notFound } from '@crombolo/crombolo/navigation'
import { ComponentRepository, ContentTypeRepository, SYSTEM_MEMBER_TYPE } from '@crombolo/data'
import { ANTIFORGERY_HEADER, BUNDLE_SCRIPT, BUNDLE_SCRIPT_PATH } from '@crombolo/render'
import {
  type BundleRouteContext,
  createRoutes,
  type DeclaredRoute,
  type RouteMember,
  type ServerBundle,
  type ServerHandle,
  siteRouteProblems,
} from '@crombolo/server'
import { siteDeclaring } from './support/bundles.ts'
import {
  BACKOFFICE,
  bootServer,
  type Harness,
  ORIGIN,
  signedInServer,
  V1,
} from './support/harness.ts'

const ada: RouteMember = { key: 'aaaaaaaa-0000-4000-8000-000000000001', roles: ['Observers'] }
const bob: RouteMember = { key: 'bbbbbbbb-0000-4000-8000-000000000002', roles: [] }

/**
 * Cookie `member=<name>` signs in, and that session's token is `token-<name>`.
 * Bearer `bearer-<name>` names the member too.
 */
const named = (name: string | undefined) =>
  name === 'ada' ? ada : name === 'bob' ? bob : undefined

function pipeline(routes: SiteRoute[], over: Partial<Parameters<typeof createRoutes>[1]> = {}) {
  const logged: Array<Record<string, unknown>> = []
  const routing = createRoutes(
    routes.map((r): DeclaredRoute => ({ route: r, owner: 'the site' })),
    {
      backOfficePath: '/umbraco',
      timeoutMs: 0,
      defaultPerMinute: 0,
      siteFor: () => () => ({ media: 'the services' }),
      session: async (request) => {
        const name = /member=(\w+)/.exec(request.headers.get('cookie') ?? '')?.[1]
        const member = named(name)
        return member && { member, verify: async (token) => token === `token-${name}` }
      },
      memberByToken: async (token) => named(/^bearer-(\w+)$/.exec(token)?.[1]),
      callerAddress: (request) => request.headers.get('x-forwarded-for') ?? 'peer',
      statusPage: async (_request, outcome) =>
        new Response(`<h1>status page ${outcome.status}</h1>${outcome.message ?? ''}`, {
          status: outcome.status,
          headers: { 'content-type': 'text/html' },
        }),
      logError: (_message, properties) => logged.push(properties),
      showDetails: false,
      ...over,
    },
  )
  const call = async (
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ) =>
    (await routing.handle(
      new Request(`http://site.test${path}`, init),
      new URL(`http://site.test${path}`),
    )) as Response
  return { routing, call, logged }
}

describe('declaring routes', () => {
  test('refuses a path under crombolo’s own, one that is not a path, and two on one path', () => {
    const problems = siteRouteProblems(
      [
        { route: route('/umbraco/x', { GET: () => ok(1) }), owner: 'the site' },
        { route: route('/crombolo/forms/x', { GET: () => ok(1) }), owner: 'the site' },
        { route: route('/media/:file', { GET: () => ok(1) }), owner: 'the site' },
        { route: route('api/x', { GET: () => ok(1) }), owner: 'the site' },
        { route: route('/api/records/:species', { GET: () => ok(1) }), owner: 'the site' },
        { route: route('/api/records/:kind', { POST: () => ok(1) }), owner: 'the bundle visits' },
      ],
      '/umbraco',
    ).join('\n')
    expect(problems).toContain('"/umbraco/x" is under one of crombolo')
    expect(problems).toContain('"/crombolo/forms/x" is under')
    expect(problems).toContain('"/media/:file" is under')
    expect(problems).toContain('"api/x" must be a path starting with /')
    expect(problems).toContain(
      'the bundle visits and the site both claim the route "/api/records/:kind"',
    )
  })

  test('refuses a method name HTTP has not got', () => {
    expect(() => route('/x', { FETCH: () => ok(1) } as never)).toThrow('FETCH')
  })
})

describe('answering', () => {
  test('matches its path, hands the params on, and leaves any other path to content finding', async () => {
    let params: Record<string, string> = {}
    const { call, routing } = pipeline([
      route('/api/records/:species', {
        GET: (_r, context) => {
          params = context.params
          return ok({ species: context.params.species })
        },
      }),
    ])
    const response = await call('/api/records/oak')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ species: 'oak' })
    expect(params).toEqual({ species: 'oak' })
    expect(
      await routing.handle(
        new Request('http://site.test/about'),
        new URL('http://site.test/about'),
      ),
    ).toBeUndefined()
  })

  test('HEAD from GET with no body, OPTIONS with Allow, and any other method a 405', async () => {
    const { call } = pipeline([route('/api/x', { GET: () => ok({ a: 1 }), POST: () => ok(2) })])
    const head = await call('/api/x', { method: 'HEAD' })
    expect([head.status, await head.text()]).toEqual([200, ''])
    const options = await call('/api/x', { method: 'OPTIONS' })
    expect([options.status, options.headers.get('allow')]).toEqual([
      204,
      'GET, POST, HEAD, OPTIONS',
    ])
    const refused = await call('/api/x', { method: 'DELETE' })
    expect(refused.status).toBe(405)
    expect(refused.headers.get('allow')).toBe('GET, POST, HEAD, OPTIONS')
  })

  test('a Response as it is, an Ok as JSON, an outcome returned or thrown as its status', async () => {
    const { call } = pipeline([
      route('/r', { GET: () => new Response('raw', { status: 201, headers: { 'x-own': '1' } }) }),
      route('/ok', { GET: () => ok({ hello: 'world' }) }),
      route('/gone', { GET: () => Outcome.gone('Closed for the season') }),
      route('/thrown', {
        GET: () => {
          notFound('No such species')
        },
      }),
      route('/invalid', {
        POST: () => Outcome.unprocessableContent([{ field: 'species', message: 'Choose one' }]),
      }),
      route('/moved', { GET: () => Outcome.seeOther('/thanks') }),
    ])
    const raw = await call('/r')
    expect([raw.status, raw.headers.get('x-own'), await raw.text()]).toEqual([201, '1', 'raw'])
    expect(await (await call('/ok')).json()).toEqual({ hello: 'world' })
    const gone = await call('/gone')
    expect(gone.status).toBe(410)
    expect(gone.headers.get('content-type')).toBe('application/problem+json')
    expect(await gone.json()).toMatchObject({
      status: 410,
      title: 'Gone',
      detail: 'Closed for the season',
    })
    expect(await (await call('/thrown')).json()).toMatchObject({
      status: 404,
      detail: 'No such species',
    })
    expect(
      await (
        await call('/invalid', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })
      ).json(),
    ).toMatchObject({
      status: 422,
      errors: [{ field: 'species', message: 'Choose one' }],
    })
    const moved = await call('/moved')
    expect([moved.status, moved.headers.get('location')]).toEqual([303, '/thanks'])
  })

  test("206's headers() and site(), and the context's member(), cookies and setCookie", async () => {
    const { call } = pipeline([
      route('/me', {
        async GET(_r, context) {
          context.setCookie('seen', 'yes', { maxAge: 60 })
          return ok({
            header: (await requestHeaders()).get('x-test'),
            site: context.site(),
            member: ((await context.member()) as RouteMember | undefined)?.key ?? null,
            cookie: context.cookies.get('flavour')?.value ?? null,
          })
        },
      }),
    ])
    const response = await call('/me', {
      headers: { 'x-test': 'from the request', cookie: 'member=ada; flavour=oak' },
    })
    expect(await response.json()).toEqual({
      header: 'from the request',
      site: { media: 'the services' },
      member: ada.key,
      cookie: 'oak',
    })
    expect(response.headers.getSetCookie()).toEqual([
      'seen=yes; Path=/; Max-Age=60; Secure; HttpOnly; SameSite=Lax',
    ])
  })
})

describe('errors and the time limit', () => {
  test('a thrown error is a 500 with a reference the log shares, problem+json or the status page', async () => {
    const { call, logged } = pipeline([
      route('/boom', {
        GET: () => {
          throw new Error('database password is hunter2')
        },
      }),
    ])
    const json = await call('/boom')
    expect(json.status).toBe(500)
    const body = (await json.json()) as { reference: string; detail?: string }
    expect(body.reference).toMatch(/^[0-9A-F]{10}$/)
    expect(body.detail).toBeUndefined()
    expect(logged[0]?.reference).toBe(body.reference)
    const html = await call('/boom', { headers: { accept: 'text/html,application/xhtml+xml' } })
    expect(html.status).toBe(500)
    expect(await html.text()).toContain('status page 500')
  })

  test('with details shown, the message is in the answer', async () => {
    const { call } = pipeline(
      [route('/boom', { GET: () => Promise.reject(new Error('kaboom')) })],
      { showDetails: true },
    )
    expect(await (await call('/boom')).json()).toMatchObject({ detail: 'kaboom' })
  })

  test('a handler past the limit answers 504, and its signal aborts', async () => {
    let aborted = false
    const { call } = pipeline(
      [
        route('/slow', {
          GET: (_r, { signal }) =>
            new Promise((resolve) => {
              signal.addEventListener('abort', () => {
                aborted = true
                resolve(ok('late'))
              })
            }),
        }),
      ],
      { timeoutMs: 50 },
    )
    expect((await call('/slow')).status).toBe(504)
    expect(aborted).toBe(true)
  })
})

describe("a route's signal once it has answered (story 224)", () => {
  const ANSWERED = 'The answer has been sent.'

  test('ends when the answer is read, and lets go of what a listener held', async () => {
    let seen: AbortSignal | undefined
    let held: WeakRef<object> | undefined
    const { call } = pipeline([
      route('/listens', {
        GET: (_r, { signal }) => {
          seen = signal
          const big = { payload: new Array(10_000).fill('x') }
          held = new WeakRef(big)
          // Never removed, as a cancellable job or a stream reader leaves it.
          signal.addEventListener('abort', () => void big.payload.length)
          return ok('done')
        },
      }),
    ])
    const response = await call('/listens')
    expect(seen?.aborted).toBe(false)
    expect(await response.json()).toBe('done')
    expect(seen?.aborted).toBe(true)
    expect(String(seen?.reason?.message)).toBe(ANSWERED)
    seen = undefined
    for (let i = 0; i < 5 && held?.deref(); i++) {
      Bun.gc(true)
      await Bun.sleep(10)
    }
    expect(held?.deref()).toBeUndefined()
  })

  test('a streamed body that reads from the signal is read to its end before the signal ends', async () => {
    let seen: AbortSignal | undefined
    const chunks: boolean[] = []
    const { call } = pipeline([
      route('/stream', {
        GET: (_r, { signal }) => {
          seen = signal
          let n = 0
          return new Response(
            new ReadableStream({
              async pull(controller) {
                await Bun.sleep(5)
                chunks.push(signal.aborted)
                if (++n > 3) controller.close()
                else controller.enqueue(new TextEncoder().encode(`${n};`))
              },
            }),
          )
        },
      }),
    ])
    const response = await call('/stream')
    expect(await response.text()).toBe('1;2;3;')
    expect(chunks).toEqual([false, false, false, false])
    expect(String(seen?.reason?.message)).toBe(ANSWERED)
  })

  test('a visitor who cancels a streamed body part-way ends it', async () => {
    let seen: AbortSignal | undefined
    const { call } = pipeline([
      route('/endless', {
        GET: (_r, { signal }) => {
          seen = signal
          return new Response(
            new ReadableStream({
              pull: (controller) => controller.enqueue(new TextEncoder().encode('x')),
            }),
          )
        },
      }),
    ])
    const reader = (await call('/endless')).body?.getReader()
    await reader?.read()
    expect(seen?.aborted).toBe(false)
    await reader?.cancel()
    expect(String(seen?.reason?.message)).toBe(ANSWERED)
  })

  test('a HEAD, a throw and an overrun each end it', async () => {
    const signals: Record<string, AbortSignal> = {}
    const { call } = pipeline(
      [
        route('/head', {
          GET: (_r, { signal }) => {
            signals.head = signal
            return ok(1)
          },
        }),
        route('/throws', {
          GET: (_r, { signal }) => {
            signals.throws = signal
            throw new Error('kaboom')
          },
        }),
        route('/slow', {
          GET: (_r, { signal }) => {
            signals.slow = signal
            return new Promise(() => {})
          },
        }),
      ],
      { timeoutMs: 50 },
    )
    expect((await call('/head', { method: 'HEAD' })).status).toBe(200)
    expect(String(signals.head?.reason?.message)).toBe(ANSWERED)
    const failed = await call('/throws')
    expect(failed.status).toBe(500)
    await failed.text()
    expect(String(signals.throws?.reason?.message)).toBe(ANSWERED)
    expect((await call('/slow')).status).toBe(504)
    expect(String(signals.slow?.reason?.message)).toContain('took longer than 50ms')
  })
})

describe('caching', () => {
  test('private unless the handler says otherwise, and never for a write', async () => {
    const { call } = pipeline([
      route('/plain', { GET: () => ok(1) }),
      route('/public', {
        GET: () => Response.json(1, { headers: { 'cache-control': 'public, max-age=60' } }),
        POST: () => Response.json(1, { headers: { 'cache-control': 'public, max-age=60' } }),
      }),
    ])
    expect((await call('/plain')).headers.get('cache-control')).toBe('private, no-store')
    expect((await call('/public')).headers.get('cache-control')).toBe('public, max-age=60')
    expect(
      (
        await call('/public', { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } })
      ).headers.get('cache-control'),
    ).toBe('private, no-store')
  })
})

describe('other origins', () => {
  const cors = { origins: new Set(['https://app.example.com']), any: false, problems: [] }
  const app = { origin: 'https://app.example.com' }

  test('a route with cors: true answers an allowed origin, pre-flight included', async () => {
    const { call } = pipeline(
      [route('/open', { GET: () => ok(1), POST: () => ok(2) }, { cors: true })],
      { cors },
    )
    const read = await call('/open', { headers: app })
    expect(read.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(read.headers.get('vary')).toContain('Origin')
    const preflight = await call('/open', {
      method: 'OPTIONS',
      headers: { ...app, 'access-control-request-method': 'POST' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, POST, HEAD, OPTIONS')
    const stranger = await call('/open', { headers: { origin: 'https://evil.example' } })
    expect(stranger.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('without it, no origin is allowed', async () => {
    const { call } = pipeline([route('/closed', { GET: () => ok(1) })], { cors })
    const read = await call('/closed', { headers: app })
    expect(read.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('CSRF', () => {
  const routes = [
    route('/api/records', { GET: () => ok('read'), POST: () => ok('written') }),
    route('/hooks/in', { POST: () => ok('hook') }, { csrf: false }),
  ]
  test('a cookie write must come from this site, or carry the token', async () => {
    const { call } = pipeline(routes)
    const post = (headers: Record<string, string>, body?: BodyInit) =>
      call('/api/records', { method: 'POST', headers, body })
    expect((await post({ cookie: 'member=ada' })).status).toBe(403)
    expect((await post({ cookie: 'member=ada', 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect((await post({ cookie: 'member=ada', 'sec-fetch-site': 'same-origin' })).status).toBe(200)
    expect((await post({ cookie: 'member=ada', origin: 'http://site.test' })).status).toBe(200)
    expect((await post({ cookie: 'member=ada', [ANTIFORGERY_HEADER]: 'token-ada' })).status).toBe(
      200,
    )
    expect((await post({ cookie: 'member=ada', [ANTIFORGERY_HEADER]: 'token-bob' })).status).toBe(
      403,
    )
    const form = new URLSearchParams({ __antiforgery: 'token-ada', note: 'x' })
    expect(
      (
        await post(
          { cookie: 'member=ada', 'content-type': 'application/x-www-form-urlencoded' },
          form.toString(),
        )
      ).status,
    ).toBe(200)
  })

  test('a read, a bearer call, a visitor and an opted-out route are not checked', async () => {
    const { call } = pipeline(routes)
    expect((await call('/api/records', { headers: { cookie: 'member=ada' } })).status).toBe(200)
    expect(
      (
        await call('/api/records', {
          method: 'POST',
          headers: { authorization: 'Bearer bearer-ada' },
        })
      ).status,
    ).toBe(200)
    expect((await call('/api/records', { method: 'POST' })).status).toBe(200)
    expect(
      (await call('/hooks/in', { method: 'POST', headers: { cookie: 'member=ada' } })).status,
    ).toBe(200)
  })

  const ticket: MemberTicket = { id: ada.key, stamp: 'stamp-1', expires: 2_000_000_000 }

  test('the token is an HMAC of the session, ending with the session and its stamp', async () => {
    const token = await antiforgeryToken('secret', ticket)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await verifyAntiforgery('secret', ticket, token)).toBe(true)
    for (const other of [
      { ...ticket, id: bob.key },
      { ...ticket, stamp: 'stamp-2' },
    ])
      expect(await verifyAntiforgery('secret', other, token)).toBe(false)
    const altered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`
    for (const value of [null, '', 'short', altered])
      expect(await verifyAntiforgery('secret', ticket, value)).toBe(false)
  })
})

describe('members and rate limits', () => {
  test('members: true wants a member; groups want one of them, in any case', async () => {
    const { call } = pipeline([
      route('/mine', { GET: () => ok(1) }, { members: true }),
      route('/observers', { GET: () => ok(1) }, { members: { groups: ['observers'] } }),
    ])
    expect((await call('/mine')).status).toBe(401)
    expect((await call('/mine', { headers: { cookie: 'member=bob' } })).status).toBe(200)
    expect((await call('/observers', { headers: { cookie: 'member=bob' } })).status).toBe(403)
    expect((await call('/observers', { headers: { cookie: 'member=ada' } })).status).toBe(200)
    expect(
      (await call('/observers', { headers: { authorization: 'Bearer bearer-ada' } })).status,
    ).toBe(200)
  })

  test('the site-wide default counts each caller, a member by key; a route may set its own or none', async () => {
    let now = 1_000_000
    const { call } = pipeline(
      [
        route('/a', { GET: () => ok(1) }),
        route('/b', { GET: () => ok(1) }),
        route('/strict', { GET: () => ok(1) }, { rateLimit: { perMinute: 1 } }),
        route('/free', { GET: () => ok(1) }, { rateLimit: false }),
      ],
      { defaultPerMinute: 3, now: () => now },
    )
    const from = (ip: string) => ({ headers: { 'x-forwarded-for': ip } })
    for (let i = 0; i < 2; i++) expect((await call('/a', from('1.1.1.1'))).status).toBe(200)
    expect((await call('/b', from('1.1.1.1'))).status).toBe(200)
    const limited = await call('/a', from('1.1.1.1'))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await call('/a', from('2.2.2.2'))).status).toBe(200)
    expect((await call('/strict', from('3.3.3.3'))).status).toBe(200)
    expect((await call('/strict', from('3.3.3.3'))).status).toBe(429)
    for (let i = 0; i < 5; i++) expect((await call('/free', from('1.1.1.1'))).status).toBe(200)
    // Signed in, it counts by the member, wherever they call from.
    for (let i = 0; i < 3; i++)
      await call('/b', { headers: { cookie: 'member=ada', 'x-forwarded-for': `9.9.9.${i}` } })
    expect(
      (await call('/b', { headers: { cookie: 'member=ada', 'x-forwarded-for': '8.8.8.8' } }))
        .status,
    ).toBe(429)
    now += 61_000
    expect((await call('/a', from('1.1.1.1'))).status).toBe(200)
  })
})

describe('a Next.js-style route module', () => {
  test('becomes a route, its params a promise, its exported options honoured', async () => {
    const { fromRouteModule } = await import('@crombolo/crombolo/routes')
    const module = {
      GET: async (_request: Request, { params }: { params: Promise<Record<string, string>> }) =>
        Response.json({ id: (await params).id }),
      POST: () => Response.json('posted'),
      csrf: false,
    }
    const declared = fromRouteModule('/next/:id', module)
    expect(declared.options).toEqual({ csrf: false })
    const { call } = pipeline([declared as SiteRoute])
    expect(await (await call('/next/7')).json()).toEqual({ id: '7' })
    expect(
      (await call('/next/7', { method: 'POST', headers: { cookie: 'member=ada' } })).status,
    ).toBe(200)
  })
})

describe('the anti-forgery script', () => {
  test('sends the token only to this site', () => {
    expect(BUNDLE_SCRIPT_PATH).toBe('/crombolo/bundle.js')
    expect(BUNDLE_SCRIPT).toContain(ANTIFORGERY_HEADER)
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
allow-children = ["page"]
components = ["page"]
default-component = "page"
`
const VIEW = `import { AntiforgeryMeta } from '@crombolo/crombolo'
export default function Page({ member }) {
  return <html><head><AntiforgeryMeta /></head><body><p>{member ? member.name : 'Visitor'}</p></body></html>
}
`

type Visits = BundleRouteContext<'log'>
const whoIs = async (
  _request: Request,
  context: { member(): Promise<RouteMember | undefined> } & Visits,
) =>
  ok({
    member: (await context.member())?.key ?? null,
    caller: context.caller.kind,
    log: typeof context.bundle.log,
  })

/** A bundle a site would wire: public species, a member's records, and a staff route, at its own paths. */
const visits = (): ServerBundle =>
  ({
    id: BUNDLE_ID,
    section: 'settings',
    capabilities: ['log'],
    routes: [
      route<unknown, RouteMember, Visits>('/visits/species', { GET: whoIs }),
      route<unknown, RouteMember, Visits>(
        '/visits/records',
        { GET: whoIs, POST: whoIs },
        { members: true },
      ),
      route<unknown, RouteMember, Visits>(
        '/visits/staff',
        { GET: whoIs },
        { members: { groups: ['Staff'] } },
      ),
      route<unknown, RouteMember, Visits>(
        'admin',
        { GET: () => ok('back office') },
        { audience: 'backoffice' },
      ),
    ],
  }) as unknown as ServerBundle

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
  const root = siteDeclaring('routes', PACKAGE)
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
    routes: [route('/api/hello', { GET: () => ok({ hello: 'site' }) })],
    deliveryApi,
    ...extra,
  }
  const h = await signedInServer({ config })
  open.push(h)

  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const page = async (name: string, parent: string | null) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: parent ? { id: parent } : null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (created.status !== 201) throw new Error(`create ${created.status}: ${await created.text()}`)
    const key = created.headers.get('umb-generated-resource') as string
    await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
    return key
  }
  const home = await page('Home', null)

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
  const tokenIn = async (cookie?: string) =>
    /<meta name="crombolo-antiforgery" content="([^"]+)"/.exec(
      await (await send(h.server, '/', { headers: cookie ? { cookie } : {} })).text(),
    )?.[1]
  return { h, root, config, home, page, group, member, send, signIn, tokenIn }
}

describe('routes on a real site', () => {
  test("the site's route and a bundle's answer at their paths; its back-office route stays in the back office", async () => {
    const s = await realSite()
    expect(await (await s.send(s.h.server, '/api/hello')).json()).toEqual({ hello: 'site' })
    const species = await s.send(s.h.server, '/visits/species')
    expect(species.status).toBe(200)
    expect(await species.json()).toEqual({ member: null, caller: 'public', log: 'object' })
    expect((await s.send(s.h.server, '/crombolo/bundle/visits/species')).status).toBe(404)
    expect((await s.h.call(`${BACKOFFICE}/crombolo/api/bundle/visits/admin`)).status).toBe(200)
  })

  test("members, groups, the page's token and a bearer token, as the member", async () => {
    const s = await realSite()
    const staff = await s.group('Staff')
    const adaKey = await s.member('ada', [staff])
    await s.member('bob')
    expect((await s.send(s.h.server, '/visits/records')).status).toBe(401)
    const cookie = await s.signIn('ada')
    const records = await s.send(s.h.server, '/visits/records', { headers: { cookie } })
    expect(await records.json()).toMatchObject({ member: adaKey, caller: 'member' })
    expect((await s.send(s.h.server, '/visits/staff', { headers: { cookie } })).status).toBe(200)
    const bobCookie = await s.signIn('bob')
    expect(
      (await s.send(s.h.server, '/visits/staff', { headers: { cookie: bobCookie } })).status,
    ).toBe(403)

    const token = (await s.tokenIn(cookie)) as string
    expect(await s.tokenIn()).toBeUndefined()
    const post = (headers: Record<string, string>) =>
      s.send(s.h.server, '/visits/records', { method: 'POST', headers })
    expect((await post({ cookie })).status).toBe(403)
    expect((await post({ cookie, [ANTIFORGERY_HEADER]: token })).status).toBe(200)

    const issued = await s.send(s.h.server, '/umbraco/delivery/api/v1/security/member/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'umbraco-member-ada',
        client_secret: 'ada-secret',
      }).toString(),
    })
    const { access_token } = (await issued.json()) as { access_token: string }
    const bearer = await post({ authorization: `Bearer ${access_token}` })
    expect(bearer.status).toBe(200)
    expect(await bearer.json()).toMatchObject({ member: adaKey })
  })

  test('a route wins at its path over a page, and the status checks say so', async () => {
    const s = await realSite({ routes: [route('/hidden', { GET: () => ok('route') })] })
    await s.page('Hidden', s.home)
    s.h.server.cache.invalidate()
    expect(await (await s.send(s.h.server, '/hidden')).json()).toBe('route')
    const ran = await s.h.post(`${V1}/health-check-group/Site/check`, {})
    const results = (
      (await ran.json()) as {
        checks: Array<{ results: Array<{ resultType: string; message: string }> }>
      }
    ).checks[0]?.results
    expect(results?.[0]?.resultType).toBe('Warning')
    expect(results?.[0]?.message).toContain('The route /hidden (the site) answers /hidden')
  })

  test("the request stage wraps routes and may rewrite to one; the route and page stages don't run", async () => {
    const stages: string[] = []
    const noting = (stage: string) => (_request: Request, next: () => Promise<Response>) => {
      stages.push(stage)
      return next()
    }
    const s = await realSite({
      routes: [
        route('/api/echo', {
          GET: async () => ok({ tagged: (await requestHeaders()).get('x-tagged') }),
        }),
      ],
      middleware: {
        request: [
          (request: Request, next: (request?: Request) => Promise<Response>) => {
            stages.push('request')
            const tagged = new Request(request, { headers: { 'x-tagged': 'yes' } })
            return next(
              new URL(request.url).pathname === '/hi' ? rewrite(tagged, '/api/echo') : tagged,
            )
          },
        ],
        route: [noting('route')],
        page: [noting('page')],
      },
    })
    expect(await (await s.send(s.h.server, '/api/echo')).json()).toEqual({ tagged: 'yes' })
    expect(await (await s.send(s.h.server, '/hi')).json()).toEqual({ tagged: 'yes' })
    expect(stages).toEqual(['request', 'request'])
  })

  test('the anti-forgery script is served, and an api node answers no site routes', async () => {
    const sqliteFile = join(process.cwd(), 'output', `routes-${crypto.randomUUID()}.sqlite`)
    dirs.push(sqliteFile, `${sqliteFile}-wal`, `${sqliteFile}-shm`)
    const s = await realSite({ sqliteFile })
    expect(await (await s.send(s.h.server, BUNDLE_SCRIPT_PATH)).text()).toBe(BUNDLE_SCRIPT)
    for (const role of ['web', 'api'] as const) {
      const server = await bootServer({
        keepDatabase: true,
        config: { ...s.config, sqliteFile, role, nodeId: `${role}-node` },
      })
      servers.push(server)
      expect((await s.send(server, '/api/hello')).status).toBe(role === 'web' ? 200 : 404)
    }
  })
})
