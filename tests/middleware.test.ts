/**
 * Story 210: a site's middleware chain. Stages run as onions in the order the
 * config lists them; the request stage before redirects and content finding,
 * the route stage with the page found, the page stage after access. Rewrites
 * stay among the site's own pages; reading cookies or setting one keeps the
 * answer private; the chain has one time limit, crombolo's own work aside;
 * and a Next.js middleware joins as one link.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rewrite, withCookie } from '@crombolo/common'
import { fromNextMiddleware, type Middleware, NextResponse } from '@crombolo/crombolo/middleware'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import { redirect } from '@crombolo/render'
import { isSitePath, matches } from '@crombolo/server'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

describe('matchers', () => {
  const at = (path: string, headers: Record<string, string> = {}) => {
    const url = new URL(`http://x${path}`)
    return [new Request(url, { headers }), url] as const
  }
  test("take Next.js's path syntax, negative lookaheads included", () => {
    expect(matches('/about/:path*', ...at('/about/team/a'))).toBe(true)
    expect(matches('/about/:path*', ...at('/about'))).toBe(true)
    expect(matches('/about/:path*', ...at('/contact'))).toBe(false)
    expect(matches('/((?!api|_next/static|favicon.ico).*)', ...at('/shop'))).toBe(true)
    expect(matches('/((?!api|_next/static|favicon.ico).*)', ...at('/api/x'))).toBe(false)
    expect(matches(['/a', '/b/:id'], ...at('/b/7'))).toBe(true)
    expect(matches(undefined, ...at('/anything'))).toBe(true)
  })

  test('and has and missing, on headers, cookies and the query', () => {
    const beta = {
      source: '/:path*',
      has: [{ type: 'cookie' as const, key: 'beta', value: 'on|yes' }],
    }
    expect(matches(beta, ...at('/x', { cookie: 'beta=yes' }))).toBe(true)
    expect(matches(beta, ...at('/x', { cookie: 'beta=no' }))).toBe(false)
    const notPrefetch = {
      source: '/:path*',
      missing: [{ type: 'header' as const, key: 'next-router-prefetch' }],
    }
    expect(matches(notPrefetch, ...at('/x', { 'next-router-prefetch': '1' }))).toBe(false)
    expect(
      matches({ source: '/s', has: [{ type: 'query' as const, key: 'q' }] }, ...at('/s?q=a')),
    ).toBe(true)
  })
})

describe('the helpers', () => {
  test('rewrite keeps the query unless the path names its own, and stays on the site', () => {
    const request = new Request('http://x/promo?utm=1', { headers: { 'x-a': 'b' } })
    expect(rewrite(request, '/about').url).toBe('http://x/about?utm=1')
    expect(rewrite(request, '/search?q=whisky').url).toBe('http://x/search?q=whisky')
    expect(rewrite(request, '/about').headers.get('x-a')).toBe('b')
    expect(() => rewrite(request, '//evil.example/x')).toThrow('path on this site')
    expect(() => rewrite(request, 'https://evil.example')).toThrow('path on this site')
  })

  test('withCookie sets one, http-only and secure unless told otherwise', () => {
    const response = withCookie(new Response('x'), 'region', 'en', { maxAge: 60 })
    expect(response.headers.getSetCookie()).toEqual([
      'region=en; Path=/; Max-Age=60; Secure; HttpOnly; SameSite=Lax',
    ])
  })

  test("a rewrite may go only to the site's own pages", () => {
    for (const path of ['/about', '/css/site.css', '/umbrella'])
      expect(isSitePath(path, '/umbraco')).toBe(true)
    for (const path of [
      '/umbraco/management/api/v1/x',
      '/crombolo/forms/1',
      '/media/a.png',
      '/sitemap.xml',
      '/robots.txt',
      '/health',
    ])
      expect(isSitePath(path, '/umbraco')).toBe(false)
  })
})

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
`

const VIEW = `import { cookies, headers } from '@crombolo/crombolo/headers'
import { usePage } from '@crombolo/crombolo'

async function Seen() {
  const h = await headers()
  const c = await cookies()
  const query = JSON.stringify(await usePage().searchParams)
  if (usePage().model.name === 'Slow') await new Promise((r) => setTimeout(r, 300))
  return <p class="seen">{h.get('x-from-middleware') ?? '-'} {c.get('chosen')?.value ?? '-'} {query}</p>
}

export default function Page({ model }) {
  if (model.name === 'Plain') return <main><h1>Plain</h1></main>
  return <main><h1>{model.name}</h1><Seen /></main>
}
`

/** What each middleware saw, for the tests to read back. */
const seen: string[] = []

const recorder: Middleware = {
  name: 'recorder',
  handle: (request, next, context) => {
    seen.push(`${context.stage} ${new URL(request.url).pathname}`)
    return next()
  },
}

const requestStage: Middleware[] = [
  recorder,
  {
    name: 'answers',
    matcher: [
      '/go-away',
      '/teapot',
      '/boom',
      '/slow-middleware',
      '/to-backoffice',
      '/to-elsewhere',
    ],
    async handle(request, _next, context) {
      const path = context.url.pathname
      if (path === '/go-away') return Response.redirect(new URL('/about', request.url), 308)
      if (path === '/teapot') return new Response('short and stout', { status: 418 })
      if (path === '/boom') throw new Error('the region service is down')
      if (path === '/slow-middleware') await new Promise((r) => setTimeout(r, 400))
      if (path === '/to-backoffice')
        return _next(rewrite(request, '/umbraco/management/api/v1/server/status'))
      return new Response('unreachable')
    },
  },
  {
    name: 'rewrites',
    matcher: ['/promo', '/promo-search'],
    handle: (request, next, context) =>
      next(rewrite(request, context.url.pathname === '/promo' ? '/about' : '/about?q=whisky')),
  },
  {
    name: 'headers',
    matcher: { source: '/:path*', has: [{ type: 'query', key: 'tag' }] },
    async handle(request, next) {
      const headers = new Headers(request.headers)
      headers.set('x-from-middleware', 'tagged')
      headers.set('cookie', 'chosen=oak')
      const answer = await next(new Request(request, { headers }))
      const out = new Headers(answer.headers)
      out.set('x-after', 'yes')
      return new Response(answer.body, { status: answer.status, headers: out })
    },
  },
  {
    name: 'reads cookies',
    matcher: { source: '/plain', has: [{ type: 'query', key: 'reads' }] },
    handle: (_request, next, context) => {
      context.cookies.get('anything')
      return next()
    },
  },
  {
    name: 'sets a cookie',
    matcher: { source: '/plain', has: [{ type: 'query', key: 'sets' }] },
    async handle(_request, next) {
      return withCookie(await next(), 'region', 'en')
    },
  },
  fromNextMiddleware(
    (request) => {
      if (request.nextUrl.pathname === '/next-redirect')
        return NextResponse.redirect(new URL('/about', request.url))
      if (request.nextUrl.pathname === '/next-rewrite')
        return NextResponse.rewrite(new URL('/about', request.url))
      const headers = new Headers(request.headers)
      headers.set('x-from-middleware', 'next')
      const response = NextResponse.next({ request: { headers } })
      response.headers.set('x-next', 'yes')
      return response
    },
    { name: 'next.js', matcher: ['/next-redirect', '/next-rewrite', '/next-pass'] },
  ),
]

const routeStage: Middleware[] = [
  recorder,
  {
    name: 'page header',
    async handle(_request, next, context) {
      const answer = await next()
      const out = new Headers(answer.headers)
      out.set('x-route-page', context.page?.name ?? 'none')
      return new Response(answer.body, { status: answer.status, headers: out })
    },
  },
  {
    name: 'route rewrite',
    matcher: '/legacy',
    handle: (request, next) => next(rewrite(request, '/about')),
  },
]

const pageStage: Middleware[] = [
  recorder,
  {
    name: 'page stage',
    handle: async (request, next, context) => {
      if (context.url.pathname === '/contact') return next(rewrite(request, '/about'))
      const answer = await next()
      const out = new Headers(answer.headers)
      out.set(
        'x-page-stage',
        `${context.page?.name ?? 'none'} ${context.member ? 'member' : 'visitor'}`,
      )
      return new Response(answer.body, { status: answer.status, headers: out })
    },
  },
]

let h: Harness
let root: string
const visit = (path: string, init: RequestInit = {}) =>
  h.server.fetch(new Request(`${ORIGIN}${path}`, init))

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'middleware-'))
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  mkdirSync(join(root, 'css'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  writeFileSync(join(root, 'css', 'site.css'), 'body {}')
  h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      redirects: [redirect('/old-about', '/about')],
      middleware: { request: requestStage, route: routeStage, page: pageStage },
      middlewareTimeoutMs: 150,
      cache: { maxAge: 60 },
      errors: { showDetails: false },
    },
  })
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  let home: string | null = null
  for (const name of ['Home', 'About', 'Contact', 'Slow', 'Plain']) {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: typeKey,
      componentKey,
      parentKey: home,
      variants: [{ culture: null, segment: null, name }],
      values: [{ alias: 'title', culture: null, segment: null, value: name }],
    })
    await docs.publish(doc.key, null)
    home ??= doc.key
  }
  h.server.cache.invalidate()
})

afterAll(async () => {
  await h?.db.close().catch(() => {})
  rmSync(root, { recursive: true, force: true })
})

describe('the request stage', () => {
  test('answers outright, before anything else is looked up', async () => {
    const moved = await visit('/go-away')
    expect(moved.status).toBe(308)
    expect(moved.headers.get('location')).toBe(`${ORIGIN}/about`)
    expect(moved.headers.get('cache-control')).not.toBe('private, no-store')
    const teapot = await visit('/teapot')
    expect([teapot.status, await teapot.text()]).toEqual([418, 'short and stout'])
  })

  test('changed headers and cookies reach the page, and the answer can be changed after', async () => {
    const response = await visit('/about?tag=1')
    expect(response.headers.get('x-after')).toBe('yes')
    expect(await response.text()).toContain(
      '<p class="seen">tagged oak {&quot;tag&quot;:&quot;1&quot;}</p>',
    )
  })

  test('a rewrite renders another page at the address asked for, with its query', async () => {
    const promo = await visit('/promo?utm=mail')
    expect(promo.status).toBe(200)
    const html = await promo.text()
    expect(html).toContain('<h1>About</h1>')
    expect(html).toContain('{&quot;utm&quot;:&quot;mail&quot;}')
    expect(await (await visit('/promo-search')).text()).toContain(
      '{&quot;q&quot;:&quot;whisky&quot;}',
    )
  })

  test("a rewrite into crombolo's own endpoints is refused", async () => {
    const refused = await visit('/to-backoffice')
    expect(refused.status).toBe(500)
    expect(refused.headers.get('cache-control')).toBe('private, no-store')
  })

  test('only sees site requests: never the back office, the APIs or media', async () => {
    seen.length = 0
    await visit('/umbraco/management/api/v1/server/status')
    await visit('/media/nothing.png')
    await visit('/sitemap.xml')
    await visit('/css/site.css')
    expect(seen).toEqual(['request /css/site.css'])
  })
})

describe('caching', () => {
  test('reading cookies or setting one keeps the answer private; the path alone does not', async () => {
    expect((await visit('/plain')).headers.get('cache-control')).toBe('public, max-age=60')
    expect((await visit('/plain?reads')).headers.get('cache-control')).toBe('private, no-store')
    const sets = await visit('/plain?sets')
    expect(sets.headers.get('cache-control')).toBe('private, no-store')
    expect(sets.headers.getSetCookie().some((c) => c.startsWith('region=en'))).toBe(true)
  })
})

describe('the route stage', () => {
  test('sees the page found, after the redirect tables have had their say', async () => {
    const about = await visit('/about')
    expect(about.headers.get('x-route-page')).toBe('About')
    seen.length = 0
    const old = await visit('/old-about')
    expect(old.status).toBe(301)
    expect(seen).toEqual(['request /old-about'])
  })

  test('a rewrite there is resolved again, from the start', async () => {
    const legacy = await visit('/legacy')
    expect(legacy.status).toBe(200)
    expect(await legacy.text()).toContain('<h1>About</h1>')
  })
})

describe('the page stage', () => {
  test('runs after access, seeing the page that renders and who is asking', async () => {
    const about = await visit('/about')
    expect(about.headers.get('x-page-stage')).toBe('About visitor')
  })

  test('may not rewrite: which page renders is already decided', async () => {
    expect((await visit('/contact')).status).toBe(500)
  })
})

describe('errors and the time limit', () => {
  test('a middleware that throws answers the error page with a reference', async () => {
    const response = await visit('/boom')
    expect(response.status).toBe(500)
    const html = await response.text()
    expect(html).toContain('Something went wrong')
    expect(html).toMatch(/Reference: <code>[0-9A-F]{10}<\/code>/)
    expect(html).not.toContain('region service')
  })

  test("one that overruns the chain's limit fails; crombolo's own rendering does not count", async () => {
    expect((await visit('/slow-middleware')).status).toBe(500)
    const slow = await visit('/slow')
    expect(slow.status).toBe(200)
    expect(await slow.text()).toContain('<h1>Slow</h1>')
  })
})

describe('a Next.js middleware', () => {
  test('redirects, rewrites, and carries on with its headers', async () => {
    const moved = await visit('/next-redirect')
    expect([moved.status, moved.headers.get('location')]).toEqual([307, `${ORIGIN}/about`])
    expect(await (await visit('/next-rewrite')).text()).toContain('<h1>About</h1>')
    const pass = await visit('/next-pass')
    expect(pass.headers.get('x-next')).toBe('yes')
  })
})

describe('preview', () => {
  test('a redirect shows the editor a notice instead of moving the frame', async () => {
    const response = await visit('/go-away', {
      headers: { cookie: `${h.cookie()}; UMB_PREVIEW=preview` },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('This page redirects')
  })
})
