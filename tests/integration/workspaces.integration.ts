/**
 * Stories 375–377 and 380 end to end: a site made with the command line and run
 * with `crombolo start`, worked on in a workspace over HTTP as the back office
 * does. A type gains a property, a page is filled in and published, and a
 * template changed, all in the workspace while the live site serves what it did;
 * the workspace's own views render its change; the merge brings all of it in at
 * once, into the live site and its files. A second workspace meets a change
 * Shared made to the same lines, is refused naming the file, settles it and
 * merges; a third brings Shared's later change in; a fourth is discarded and
 * leaves nothing behind.
 *
 * Named `*.integration.ts`, so `bun test` does not collect it: it spawns
 * processes and boots servers. `bun run test:integration` runs it, and CI does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deriveChallenge, generateToken, parseCookies } from '@crombolo/auth'
import { DEFAULT_BACKOFFICE_PATH, managementApiPath } from '@crombolo/core'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')
const PASSWORD = 'integration-password'
const API = managementApiPath(DEFAULT_BACKOFFICE_PATH)
const SECURITY = `${API}/security/back-office`
const WORKSPACES = `${DEFAULT_BACKOFFICE_PATH}/crombolo/api/workspaces`

const TEMPLATE = `import type { PageProps } from '@crombolo/crombolo'
import Banner from './parts/banner.tsx'

export default function Page({ model }: PageProps) {
  return (
    <html lang="en">
      <body>
        <h1>{model.text('title')}</h1>
        <Banner />
      </body>
    </html>
  )
}
`

const BANNER = 'export default function Banner() { return <p class="banner">Welcome</p> }\n'

let dir: string
let origin = ''
let server: ReturnType<typeof Bun.spawn> | undefined
const cookies = new Map<string, string>()
const cookie = () => [...cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ')
const absorb = (response: Response) => {
  for (const header of response.headers.getSetCookie())
    for (const [name, value] of parseCookies(header.split(';')[0] ?? ''))
      if (value === '') cookies.delete(name)
      else cookies.set(name, value)
}

const site = () => join(dir, 'harbour')

function environment(): Record<string, string> {
  const inherited = { ...(process.env as Record<string, string>) }
  for (const name of [
    'CROMBOLO_SQLITE_FILE',
    'CROMBOLO_COMPONENTS_DIR',
    'CROMBOLO_SCHEMA_DIR',
    'CROMBOLO_MEDIA_DIR',
    'CROMBOLO_CSS_DIR',
    'CROMBOLO_SCRIPTS_DIR',
    'CROMBOLO_SITE_NAME',
    'CROMBOLO_PROFILE',
    'CROMBOLO_PROFILE_URL',
  ])
    delete inherited[name]
  return {
    ...inherited,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_LOGS_DIR: join(dir, 'logs'),
    CROMBOLO_LOG_TO_CONSOLE: 'false',
    CROMBOLO_ADMIN_PASSWORD: PASSWORD,
    CROMBOLO_PROFILES_FILE: join(dir, 'profiles'),
    CROMBOLO_CLI_ACCESS: 'open',
  }
}

async function ok(...args: string[]) {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd: site(),
    env: environment(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  expect(await proc.exited, `crombolo ${args.join(' ')}\n${out}${err}`).toBe(0)
  return `${out}${err}`
}

/** Starts the site with workspaces on and its files writable, and waits for its banner. */
async function start() {
  const proc = Bun.spawn(['bun', CLI, 'start'], {
    cwd: site(),
    env: {
      ...environment(),
      NODE_ENV: 'production',
      PORT: '0',
      CROMBOLO_WORKSPACES: 'true',
      CROMBOLO_SCHEMA_WRITABLE: 'true',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  server = proc
  const decoder = new TextDecoder()
  let banner = ''
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    banner += decoder.decode(chunk)
    if (banner.includes('└─')) break
  }
  const url = /site\s+(http:\/\/\S+)/.exec(banner)?.[1] ?? ''
  if (!url) throw new Error(`the site did not start:\n${banner}`)
  void (async () => {
    for await (const _ of proc.stdout as ReadableStream<Uint8Array>);
  })().catch(() => {})
  origin = new URL(url).origin
}

/** One request, as the signed-in browser, keeping what it sets. */
async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (cookies.size > 0) headers.set('cookie', cookie())
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' })
  absorb(response)
  return response
}

/**
 * A call as the signed-in administrator, in a workspace when one is named. A
 * page's save names the revision it was read at, as the back office's does.
 */
async function call(method: string, path: string, body?: unknown, workspace?: string) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(workspace ? { 'crombolo-workspace': workspace } : {}),
  }
  const page = /\/document\/([0-9a-f-]{36})$/.exec(path)
  if (page && method === 'PUT') {
    const read = await send(path, { headers })
    const etag = read.headers.get('etag')
    if (etag) headers['if-match'] = etag
  }
  return send(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/** Signs in to the back office as a browser does: the password, then a code for a token. */
async function signIn() {
  const login = await send(`${SECURITY}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin@crombolo.local', password: PASSWORD }),
  })
  expect(login.status).toBe(200)
  const redirect = `${origin}${DEFAULT_BACKOFFICE_PATH}/oauth_complete`
  const verifier = generateToken(96)
  const authorize = await send(
    `${SECURITY}/authorize?${new URLSearchParams({
      client_id: 'umbraco-back-office',
      redirect_uri: redirect,
      scope: 'offline_access',
      response_type: 'code',
      code_challenge: deriveChallenge(verifier),
      code_challenge_method: 'S256',
    })}`,
  )
  const code = new URL(authorize.headers.get('location') as string).searchParams.get('code')
  const token = await send(`${SECURITY}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'umbraco-back-office',
      redirect_uri: redirect,
      grant_type: 'authorization_code',
      code: code as string,
      code_verifier: verifier,
    }).toString(),
  })
  expect(token.status).toBe(200)
}

const json = async <T>(response: Response): Promise<T> => {
  expect(response.status, `${response.url}: ${await response.clone().text()}`).toBeLessThan(300)
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const live = async (path = '/') => (await fetch(`${origin}${path}`)).text()

async function open(name: string) {
  return json<{ key: string }>(await call('POST', WORKSPACES, { name }))
}

type Model = Record<string, unknown> & { properties: Array<Record<string, unknown>> }

async function pageType(workspace?: string) {
  const roots = await json<{ items: Array<{ id: string; name: string }> }>(
    await call('GET', `${API}/document-type/allowed-at-root?skip=0&take=10`, undefined, workspace),
  )
  // The site's one type at the top, whatever a test has renamed it to.
  const id = roots.items[0]?.id as string
  return {
    id,
    model: await json<Model>(await call('GET', `${API}/document-type/${id}`, undefined, workspace)),
  }
}

async function homeKey() {
  const roots = await json<{ items: Array<{ id: string }> }>(
    await call('GET', `${API}/tree/document/root?skip=0&take=10`),
  )
  return roots.items[0]?.id as string
}

/** Waits for the live site to say `text`, as its views take a new generation. */
async function liveSays(text: string, path = '/') {
  for (let n = 0; n < 60; n++) {
    if ((await live(path)).includes(text)) return
    await Bun.sleep(500)
  }
  expect(await live(path)).toContain(text)
}

beforeAll(async () => {
  mkdirSync(join(ROOT, 'output'), { recursive: true })
  dir = mkdtempSync(join(ROOT, 'output', 'workspaces-'))
  mkdirSync(site())
  await ok('init', '--name', 'Harbour', '--empty')
  await ok('types', 'new', 'content-type', 'page', '--name', 'Page', '--at-root')
  mkdirSync(join(site(), 'components', 'parts'), { recursive: true })
  writeFileSync(join(site(), 'components', 'page.tsx'), TEMPLATE)
  writeFileSync(join(site(), 'components', 'parts', 'banner.tsx'), BANNER)
  await ok('content', 'new', '/Home', '--type', 'page', '--set', 'title=Home', '--publish')
  await start()
  await signIn()
}, 180_000)

afterAll(async () => {
  server?.kill()
  await server?.exited
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('a workspace on a running site, end to end', () => {
  test('a type, a page and a template changed apart, then merged into the live site at once', async () => {
    const pageFile = () =>
      readFileSync(join(site(), 'schema', 'content-types', 'page.toml'), 'utf8')
    const bannerFile = () => readFileSync(join(site(), 'components', 'parts', 'banner.tsx'), 'utf8')
    const sale = await open('Spring sale')

    // The type gains a property, in the workspace only.
    const own = await pageType(sale.key)
    const first = own.model.properties[0] as Record<string, unknown>
    const saved = await call(
      'PUT',
      `${API}/document-type/${own.id}`,
      {
        ...own.model,
        properties: [
          ...own.model.properties,
          {
            ...first,
            id: crypto.randomUUID(),
            alias: 'strapline',
            name: 'Strapline',
            sortOrder: 9,
          },
        ],
      },
      sale.key,
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect(pageFile()).not.toContain('strapline')

    // The page is filled in and published there.
    const home = await homeKey()
    const document = await json<Record<string, unknown>>(
      await call('GET', `${API}/document/${home}`, undefined, sale.key),
    )
    const put = await call(
      'PUT',
      `${API}/document/${home}`,
      {
        ...document,
        values: [
          { alias: 'title', culture: null, segment: null, value: 'Spring sale' },
          { alias: 'strapline', culture: null, segment: null, value: 'Half price' },
        ],
      },
      sale.key,
    )
    expect(put.status, await put.clone().text()).toBe(200)
    expect(
      (
        await call(
          'PUT',
          `${API}/document/${home}/publish`,
          { publishSchedules: [{ culture: null }] },
          sale.key,
        )
      ).status,
    ).toBe(200)

    // The template the page imports changes there, and the page renders with it.
    const banner = await call(
      'PUT',
      `${API}/partial-view/${encodeURIComponent('/parts/banner.tsx')}`,
      { content: 'export default function Banner() { return <p class="banner">Sale on</p> }\n' },
      sale.key,
    )
    expect(banner.status, await banner.clone().text()).toBe(200)
    const rendered = await json<{ status: string; html: string; views: string }>(
      await call('GET', `${WORKSPACES}/${sale.key}/render?path=/`),
    )
    expect(rendered).toMatchObject({ status: 'ok', views: 'workspace' })
    expect(rendered.html).toContain('Sale on')

    // Meanwhile the live site serves what it did, and its files are as they were.
    expect(await live()).toContain('<h1>Home</h1>')
    expect(await live()).toContain('Welcome')
    expect(bannerFile()).toContain('Welcome')

    // What the merge would do, then the merge.
    const preview = await json<{ pages: unknown[]; files: { writes: string[] } }>(
      await call('GET', `${WORKSPACES}/${sale.key}/merge`),
    )
    expect(preview.files.writes).toEqual(
      expect.arrayContaining(['content-types/page.toml', 'components/parts/banner.tsx']),
    )
    expect(preview.pages).toHaveLength(1)
    await json(await call('POST', `${WORKSPACES}/${sale.key}/merge`, {}))

    expect(pageFile()).toContain('strapline')
    expect(bannerFile()).toContain('Sale on')
    expect(await live()).toContain('<h1>Spring sale</h1>')
    await liveSays('Sale on')
    const shared = await pageType()
    expect(shared.model.properties.map((p) => p.alias)).toContain('strapline')
  }, 120_000)

  test('a change Shared made to the same lines is refused, named, settled, then merged', async () => {
    const rebrand = await open('Rebrand')
    const own = await pageType(rebrand.key)
    expect(
      (
        await call(
          'PUT',
          `${API}/document-type/${own.id}`,
          { ...own.model, name: 'Landing page' },
          rebrand.key,
        )
      ).status,
    ).toBe(200)
    const shared = await pageType()
    expect(
      (
        await call('PUT', `${API}/document-type/${shared.id}`, {
          ...shared.model,
          name: 'Plain page',
        })
      ).status,
    ).toBe(200)

    const refused = await call('POST', `${WORKSPACES}/${rebrand.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { blockers: string[] }).blockers).toEqual([
      'The definition content-types/page.toml was changed in both the workspace and Shared.',
    ])
    await json(
      await call('POST', `${WORKSPACES}/${rebrand.key}/files/resolve`, {
        path: 'content-types/page.toml',
        side: 'mine',
      }),
    )
    await json(await call('POST', `${WORKSPACES}/${rebrand.key}/merge`, {}))
    expect(readFileSync(join(site(), 'schema', 'content-types', 'page.toml'), 'utf8')).toContain(
      'name = "Landing page"',
    )
  }, 120_000)

  test('Shared’s later change comes into a workspace, and a discarded one leaves nothing', async () => {
    const later = await open('Later')
    // Its first schema change freezes its copy of the types.
    const own = await pageType(later.key)
    await json(
      await call(
        'PUT',
        `${API}/document-type/${own.id}`,
        { ...own.model, icon: 'icon-star' },
        later.key,
      ),
    )
    const stylesheet = await call(
      'POST',
      `${API}/stylesheet`,
      { name: 'later.css', parent: null, content: 'body { color: teal; }\n' },
      later.key,
    )
    expect(stylesheet.status, await stylesheet.clone().text()).toBe(201)
    const shared = await pageType()
    const first = shared.model.properties[0] as Record<string, unknown>
    await json(
      await call('PUT', `${API}/document-type/${shared.id}`, {
        ...shared.model,
        properties: [
          ...shared.model.properties,
          { ...first, id: crypto.randomUUID(), alias: 'footnote', name: 'Footnote', sortOrder: 10 },
        ],
      }),
    )
    const aliases = async () => (await pageType(later.key)).model.properties.map((p) => p.alias)
    expect(await aliases()).not.toContain('footnote')
    await json(await call('POST', `${WORKSPACES}/${later.key}/update`))
    expect(await aliases()).toContain('footnote')

    const before = readFileSync(join(site(), 'schema', 'content-types', 'page.toml'), 'utf8')
    expect((await call('DELETE', `${WORKSPACES}/${later.key}`)).status).toBe(204)
    expect(readFileSync(join(site(), 'schema', 'content-types', 'page.toml'), 'utf8')).toBe(before)
    expect(
      (await call('GET', `${API}/stylesheet/${encodeURIComponent('/later.css')}`)).status,
    ).toBe(404)
  }, 120_000)
})
