/**
 * Story 208: `@crombolo/next-integration` against a real site's Delivery API,
 * with Next.js's own modules stood in for: page lookups as Results and Next's
 * navigation, caching by tag, Draft Mode, member sessions and their refresh,
 * the route handlers, media, images and metadata.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import { redirect } from '@crombolo/render'
import { type Harness, signedInServer } from './support/harness.ts'

/** What the stand-ins for Next.js saw and are set to answer. */
const next = {
  draft: false,
  cookies: new Map<string, string>(),
  tags: [] as string[],
  life: [] as string[],
  revalidated: [] as Array<[string, string | undefined]>,
  draftCalls: [] as string[],
}

class NextNavigation extends Error {
  constructor(
    readonly kind: string,
    readonly location?: string,
  ) {
    super(`${kind}${location ? ` ${location}` : ''}`)
  }
}

mock.module('next/headers', () => ({
  draftMode: async () => ({
    isEnabled: next.draft,
    enable: () => next.draftCalls.push('enable'),
    disable: () => next.draftCalls.push('disable'),
  }),
  cookies: async () => ({
    get: (name: string) =>
      next.cookies.has(name) ? { name, value: next.cookies.get(name) as string } : undefined,
  }),
}))
mock.module('next/navigation', () => ({
  redirect: (location: string) => {
    throw new NextNavigation('redirect', location)
  },
  permanentRedirect: (location: string) => {
    throw new NextNavigation('permanentRedirect', location)
  },
  notFound: () => {
    throw new NextNavigation('notFound')
  },
  unauthorized: () => {
    throw new NextNavigation('unauthorized')
  },
  forbidden: () => {
    throw new NextNavigation('forbidden')
  },
  useRouter: () => ({ push: () => {} }),
}))
mock.module('next/cache', () => ({
  cacheTag: (...tags: string[]) => next.tags.push(...tags),
  cacheLife: (profile: string) => next.life.push(profile),
  revalidateTag: (tag: string, profile?: string) => next.revalidated.push([tag, profile]),
}))
mock.module('next/server', () => ({
  NextResponse: {
    next: (init?: { request?: { headers?: Headers } }) => {
      const response = new Response(null, { status: 200 })
      response.headers.set('x-request-cookie', init?.request?.headers?.get('cookie') ?? '')
      return response
    },
    redirect: (url: URL, status = 307) =>
      new Response(null, { status, headers: { location: url.toString() } }),
    rewrite: (url: URL, init?: { status?: number }) =>
      new Response(null, { status: init?.status ?? 200, headers: { 'x-rewrite': url.pathname } }),
  },
}))

const integration = await import('@crombolo/next-integration')
const { cache16 } = await import('@crombolo/next-integration/cache-16')
const { cache15 } = await import('@crombolo/next-integration/cache-15')
const handlers = await import('@crombolo/next-integration/route-handlers')
const { cromboloMiddleware } = await import('@crombolo/next-integration/middleware')
const { default: imageLoader, cromboloImage } = await import(
  '@crombolo/next-integration/image-loader'
)
const session = await import('../packages/next-integration/src/session.ts')

const SECRET = 'a-secret-long-enough-to-seal-sessions-0123'

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"
compositions = ["seoFields"]

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

let h: Harness
let listener: { stop(force?: boolean): void; url: URL }
let root: string
let cms: string
const keys = {} as { home: string; news: string; story: string; lost: string }

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'next-integration-'))
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      deliveryApi: { enabled: true, apiKey: 'key' },
      redirects: [redirect('/old', '/news')],
      pages: { notFound: '/lost' },
    },
  })
  const db = h.server.db
  const docs = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const page = async (name: string, parentKey: string | null) => {
    const doc = await docs.create({
      key: crypto.randomUUID(),
      contentTypeKey: typeKey,
      componentKey,
      parentKey,
      variants: [{ culture: null, segment: null, name }],
      values: [{ alias: 'title', culture: null, segment: null, value: `${name} title` }],
    })
    await docs.publish(doc.key, null)
    return doc.key
  }
  keys.home = await page('Home', null)
  keys.news = await page('News', keys.home)
  keys.story = await page('Story', keys.news)
  keys.lost = await page('Lost', keys.home)
  h.server.cache.invalidate()
  listener = Bun.serve({ port: 0, fetch: (request) => h.server.fetch(request) })
  cms = listener.url.toString().replace(/\/$/, '')
})

afterAll(async () => {
  listener?.stop(true)
  await h?.db.close()
  rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  next.draft = false
  next.cookies.clear()
  next.tags = []
  next.life = []
  next.revalidated = []
  next.draftCalls = []
})

const crombolo = (options: Partial<Parameters<typeof integration.createCrombolo>[0]> = {}) =>
  integration.createCrombolo({ url: cms, host: 'localhost', secret: SECRET, ...options })

const thrown = async (work: () => Promise<unknown>) => {
  try {
    await work()
  } catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('the Result it carries', () => {
  test('is @crombolo/common’s, the one Crombolo’s own services return', async () => {
    const common = await import('@crombolo/common')
    expect(integration.Outcome).toBe(common.Outcome)
    expect(integration.isOutcome(common.Outcome.notFound())).toBe(true)
  })
})

describe('page lookups', () => {
  test('a page is Ok, with its search and sharing details', async () => {
    const result = await crombolo().page('/news/story')
    expect(result.ok).toBe(true)
    const item = result.unwrap()
    expect(item.id).toBe(keys.story)
    expect(item.seo?.title).toContain('Story')
  })

  test('a redirect and a miss are outcomes, and resolvePage ends them the Next.js way', async () => {
    const moved = await crombolo().page('/old')
    expect(moved.isOutcome() && [moved.status, moved.location]).toEqual([301, '/news'])
    const missing = await crombolo().page('/nowhere')
    expect(missing.isOutcome() && missing.status).toBe(404)
    expect(await thrown(() => crombolo().resolvePage('/old'))).toMatchObject({
      kind: 'permanentRedirect',
      location: '/news',
    })
    expect(await thrown(() => crombolo().resolvePage('/nowhere'))).toMatchObject({
      kind: 'notFound',
    })
  })

  test('the site’s not-found page is the one pages.notFound names', async () => {
    expect((await crombolo().notFoundPage())?.id).toBe(keys.lost)
  })
})

describe('caching', () => {
  test('with Next 16, answers are kept and tagged with every key they hold', async () => {
    const cms16 = crombolo({ cache: cache16 })
    await cms16.item(keys.story)
    expect(next.tags).toContain('crombolo')
    expect(next.tags).toContain(`crombolo:${keys.story}`)
    expect(next.life).toEqual(['max'])
    cms16.revalidate([keys.story, keys.news])
    expect(next.revalidated).toEqual([
      ['crombolo:missing', 'max'],
      [`crombolo:${keys.story}`, 'max'],
      [`crombolo:${keys.news}`, 'max'],
    ])
  })

  test('a kept not-found is cleared by any change, and an unkept answer kept briefly', async () => {
    await crombolo({ cache: cache16 }).item('no-such-page')
    expect(next.tags).toEqual(['crombolo', 'crombolo:missing'])
    next.tags = []
    await crombolo({ cache: cache16 }).page('/old')
    expect(next.life).toContain('seconds')
  })

  test('with Next 15, everything is cleared at once', () => {
    crombolo({ cache: cache15 }).revalidate([keys.story])
    expect(next.revalidated).toEqual([['crombolo', undefined]])
  })

  test('Draft Mode reads drafts with the preview token, and keeps nothing', async () => {
    next.draft = true
    next.cookies.set(session.PREVIEW_COOKIE, 'not-a-real-token')
    const error = await thrown(() => crombolo({ cache: cache16 }).item(keys.story))
    expect((error as { status?: number }).status).toBe(401)
    expect(next.tags).toEqual([])
  })
})

describe('members', () => {
  test('no session is a visitor; a sealed one reads as the member, never kept', async () => {
    expect(await crombolo().member()).toBeUndefined()
    next.cookies.set(
      session.SESSION_COOKIE,
      await session.seal({ accessToken: 'opaque', expiresAt: Date.now() + 60_000 }, SECRET),
    )
    const member = await crombolo({ cache: cache16 }).member()
    expect(member?.session.accessToken).toBe('opaque')
    await member?.item(keys.story)
    expect(next.tags).toEqual([])
  })

  test('an expired or forged session is a visitor', async () => {
    next.cookies.set(
      session.SESSION_COOKIE,
      await session.seal({ accessToken: 'old', expiresAt: Date.now() - 1 }, SECRET),
    )
    expect(await crombolo().member()).toBeUndefined()
    next.cookies.set(
      session.SESSION_COOKIE,
      await session.seal({ accessToken: 'x' }, 'another-secret-entirely-0123456789'),
    )
    expect(await crombolo().member()).toBeUndefined()
  })

  test('a short secret is refused', async () => {
    expect(() => session.sessionSecret('short')).toThrow('CROMBOLO_NEXT_SECRET')
  })
})

/** A stand-in CMS for the sign-in endpoints, recording what it is sent. */
function fakeCms() {
  const seen: Array<{ path: string; form: Record<string, string>; auth: string | null }> = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const form =
        request.method === 'POST'
          ? Object.fromEntries(new URLSearchParams(await request.text()))
          : Object.fromEntries(url.searchParams)
      seen.push({ path: url.pathname, form, auth: request.headers.get('authorization') })
      if (url.pathname.endsWith('/token'))
        return form.code === 'bad' || form.refresh_token === 'spent'
          ? Response.json({ error: 'invalid_grant' }, { status: 400 })
          : Response.json({
              access_token: 'new-access',
              refresh_token: 'new-refresh',
              expires_in: 300,
            })
      if (url.pathname.startsWith('/media/'))
        return new Response('image', {
          headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=60' },
        })
      return new Response('ok')
    },
  })
  return { url: server.url.toString().replace(/\/$/, ''), seen, stop: () => server.stop(true) }
}

const cookieValue = (response: Response, name: string) => {
  for (const value of response.headers.getSetCookie())
    if (value.startsWith(`${name}=`))
      return decodeURIComponent(value.split(';')[0]?.slice(name.length + 1) ?? '')
  return undefined
}

describe('route handlers', () => {
  test('revalidation needs the secret, and clears the item and its ancestors', async () => {
    const cms16 = crombolo({ cache: cache16 })
    const handle = handlers.revalidateHandler(cms16, { secret: 'shh' })
    const post = (secret: string | null, body: unknown) =>
      handle(
        new Request('http://app/api/crombolo/revalidate', {
          method: 'POST',
          headers: secret ? { 'x-crombolo-secret': secret } : {},
          body: JSON.stringify(body),
        }),
      )
    expect((await post('wrong', { Id: keys.story })).status).toBe(401)
    expect((await post(null, { Id: keys.story })).status).toBe(401)
    expect((await post('shh', { nothing: true })).status).toBe(400)
    const ok = await post('shh', { Id: keys.story, Ancestors: [keys.news, keys.home] })
    expect(ok.status).toBe(200)
    expect(next.revalidated.map(([tag]) => tag)).toEqual([
      'crombolo:missing',
      `crombolo:${keys.story}`,
      `crombolo:${keys.news}`,
      `crombolo:${keys.home}`,
    ])
  })

  test('preview refuses a missing or bad token, and never leaves the site', async () => {
    const handle = handlers.previewHandler(crombolo())
    expect((await handle(new Request('http://app/api/crombolo/preview?path=/news'))).status).toBe(
      401,
    )
    const bad = await handle(new Request('http://app/api/crombolo/preview?path=/news&token=forged'))
    expect(bad.status).toBe(401)
    expect(next.draftCalls).toEqual([])
    expect(handlers.localPath('//evil.example')).toBe('/')
    expect(handlers.localPath('https://evil.example')).toBe('/')
    expect(handlers.localPath('/news?x=1')).toBe('/news?x=1')
    const exit = await handlers.exitPreviewHandler()(new Request('http://app/x?path=/news'))
    expect(exit.headers.get('location')).toBe('/news')
    expect(next.draftCalls).toEqual(['disable'])
  })

  test('sign-in goes to the CMS with PKCE, and the callback seals the tokens', async () => {
    const fake = fakeCms()
    try {
      const member = handlers.memberHandlers(crombolo({ url: fake.url }), {
        redirectUri: 'https://app.example/api/crombolo/callback',
        postLogoutRedirectUri: 'https://app.example/',
      })
      const start = await member.signIn(
        new Request('https://app.example/api/crombolo/sign-in?returnTo=//evil'),
      )
      const authorize = new URL(start.headers.get('location') as string)
      expect(authorize.pathname).toBe('/crombolo/delivery/api/v1/security/member/authorize')
      expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
      const state = authorize.searchParams.get('state') as string
      const pending = cookieValue(start, session.SIGN_IN_COOKIE) as string
      expect(start.headers.getSetCookie()[0]).toContain('HttpOnly')

      const back = (query: string) =>
        member.callback(
          new Request(`https://app.example/api/crombolo/callback?${query}`, {
            headers: { cookie: `${session.SIGN_IN_COOKIE}=${encodeURIComponent(pending)}` },
          }),
        )
      expect((await back(`code=abc&state=other`)).status).toBe(400)
      expect((await back(`code=bad&state=${state}`)).status).toBe(400)
      const done = await back(`code=abc&state=${state}`)
      expect(done.headers.get('location')).toBe('/')
      const sealed = cookieValue(done, session.SESSION_COOKIE)
      expect(await session.unseal(sealed, SECRET)).toMatchObject({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      })
      const exchange = fake.seen.findLast((s) => s.path.endsWith('/token'))
      expect(exchange?.form).toMatchObject({ grant_type: 'authorization_code', code: 'abc' })
      expect(await session.challengeFor(exchange?.form.code_verifier as string)).toBe(
        authorize.searchParams.get('code_challenge') as string,
      )

      const out = await member.signOut(
        new Request('https://app.example/api/crombolo/sign-out', {
          headers: { cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(sealed as string)}` },
        }),
      )
      expect(new URL(out.headers.get('location') as string).pathname).toEndWith('/signout')
      expect(cookieValue(out, session.SESSION_COOKIE)).toBe('')
      expect(
        fake.seen.some((s) => s.path.endsWith('/revoke') && s.form.token === 'new-refresh'),
      ).toBe(true)
    } finally {
      fake.stop()
    }
  })

  test('media is fetched with the member’s token, and that answer is never shared', async () => {
    const fake = fakeCms()
    try {
      const handle = handlers.mediaHandler(crombolo({ url: fake.url }))
      const open = await handle(new Request('https://app.example/media/a/b.png'))
      expect(open.headers.get('cache-control')).toBe('public, max-age=60')
      const sealed = await session.seal(
        { accessToken: 'tok', expiresAt: Date.now() + 60_000 },
        SECRET,
      )
      const mine = await handle(
        new Request('https://app.example/media/a/b.png', {
          headers: { cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(sealed)}` },
        }),
      )
      expect(await mine.text()).toBe('image')
      expect(mine.headers.get('cache-control')).toBe('private, no-store')
      expect(fake.seen.at(-1)?.auth).toBe('Bearer tok')
    } finally {
      fake.stop()
    }
  })
})

describe('the middleware', () => {
  test('an expired session is refreshed before the page renders it', async () => {
    const fake = fakeCms()
    try {
      const middleware = cromboloMiddleware(crombolo({ url: fake.url }), { routes: false })
      const fresh = await session.seal(
        { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 600_000 },
        SECRET,
      )
      const untouched = await middleware(
        new Request('https://app.example/', {
          headers: { cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(fresh)}` },
        }),
      )
      expect(untouched.headers.getSetCookie()).toEqual([])

      const old = await session.seal(
        { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() - 1 },
        SECRET,
      )
      const refreshed = await middleware(
        new Request('https://app.example/', {
          headers: { cookie: `theme=dark; ${session.SESSION_COOKIE}=${encodeURIComponent(old)}` },
        }),
      )
      const value = cookieValue(refreshed, session.SESSION_COOKIE)
      expect(await session.unseal(value, SECRET)).toMatchObject({ accessToken: 'new-access' })
      expect(refreshed.headers.get('x-request-cookie')).toContain('theme=dark')
      expect(refreshed.headers.get('x-request-cookie')).toContain(`${session.SESSION_COOKIE}=`)

      const spent = await session.seal(
        { accessToken: 'a', refreshToken: 'spent', expiresAt: Date.now() - 1 },
        SECRET,
      )
      const forgotten = await middleware(
        new Request('https://app.example/', {
          headers: { cookie: `${session.SESSION_COOKIE}=${encodeURIComponent(spent)}` },
        }),
      )
      expect(cookieValue(forgotten, session.SESSION_COOKIE)).toBe('')
    } finally {
      fake.stop()
    }
  })
})

describe('the middleware answers before a page renders', () => {
  test('a redirect keeps its status, a miss is a 404, and a page passes through', async () => {
    const middleware = cromboloMiddleware(crombolo())
    const visit = (path: string, init: RequestInit = {}) =>
      middleware(new Request(`https://app.example${path}`, init))
    const moved = await visit('/old?utm=1')
    expect(moved.status).toBe(301)
    expect(moved.headers.get('location')).toBe('https://app.example/news?utm=1')
    const missing = await visit('/nowhere')
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-rewrite')).toBe('/crombolo/not-found')
    expect((await visit('/news')).status).toBe(200)
    expect((await visit('/api/crombolo/preview')).status).toBe(200)
    expect((await visit('/logo.png')).status).toBe(200)
    expect((await visit('/nowhere', { method: 'POST' })).status).toBe(200)
    const previewing = await visit('/nowhere', {
      headers: { cookie: `${session.PREVIEW_COOKIE}=token` },
    })
    expect(previewing.status).toBe(200)
  })
})

describe('images and metadata', () => {
  test('the loader writes the imaging query, keeping a crop', () => {
    expect(imageLoader({ src: '/media/x/a.jpg', width: 640 })).toBe(
      '/media/x/a.jpg?width=640&quality=75&format=webp',
    )
    const image = cromboloImage(
      {
        url: '/media/x/a.jpg',
        width: 2000,
        height: 1000,
        name: 'A',
        focalPoint: { left: 0.2, top: 0.3 },
        crops: [
          {
            alias: 'square',
            width: 400,
            height: 400,
            coordinates: { x1: 0.1, y1: 0, x2: 0.4, y2: 0 },
          },
        ],
      },
      { crop: 'square' },
    )
    expect(image).toEqual({
      src: '/media/x/a.jpg?cc=0.1%2C0%2C0.4%2C0',
      width: 400,
      height: 400,
      alt: 'A',
    })
    expect(imageLoader({ src: image.src, width: 200, quality: 60 })).toBe(
      '/media/x/a.jpg?cc=0.1%2C0%2C0.4%2C0&width=200&quality=60&format=webp',
    )
  })

  test('metadata comes from the page’s search and sharing details', () => {
    const metadata = integration.metadataOf({
      name: 'Story',
      seo: {
        title: 'Story | Acme',
        description: 'About it',
        image: { url: 'https://acme.example/media/s.png', width: 1200, height: 630 },
        canonical: 'https://acme.example/story',
        robots: 'noindex',
        alternates: [{ culture: 'en', url: 'https://acme.example/story' }],
        xDefault: 'https://acme.example/story',
        siteName: 'Acme',
      },
    })
    expect(metadata).toMatchObject({
      title: { absolute: 'Story | Acme' },
      description: 'About it',
      alternates: {
        canonical: 'https://acme.example/story',
        languages: { en: 'https://acme.example/story', 'x-default': 'https://acme.example/story' },
      },
      robots: { index: false },
      openGraph: {
        siteName: 'Acme',
        images: [{ url: 'https://acme.example/media/s.png', width: 1200 }],
      },
      twitter: { card: 'summary_large_image' },
    })
    expect(integration.metadataOf(undefined)).toEqual({})
  })
})

describe('the published package', () => {
  test('is built file for file, its directives where Next.js reads them, under a manifest pointing there', async () => {
    const { buildPackage, builtPackageManifest } = await import('../scripts/built-package.ts')
    const dir = join(import.meta.dir, '..', 'packages/next-integration')
    try {
      await buildPackage(dir)
      const client = readFileSync(join(dir, 'dist/client.js'), 'utf8')
      expect(
        client.split('\n').find((line) => !line.startsWith('/**') && !line.startsWith(' *')),
      ).toBe("'use client';")
      expect(readFileSync(join(dir, 'dist/cache-16.js'), 'utf8')).toContain("'use cache';")
      expect(readFileSync(join(dir, 'dist/index.js'), 'utf8')).toContain("from './session.js'")
      expect(readFileSync(join(dir, 'dist/index.d.ts'), 'utf8')).toContain('createCrombolo')
    } finally {
      rmSync(join(dir, 'dist'), { recursive: true, force: true })
    }
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(builtPackageManifest(manifest).exports?.['./cache-16']).toEqual({
      types: './dist/cache-16.d.ts',
      import: './dist/cache-16.js',
      default: './dist/cache-16.js',
    })
    expect(Object.keys(manifest.dependencies)).toEqual([
      '@crombolo/common',
      '@crombolo/delivery-client',
    ])
  }, 120_000)
})
