/**
 * Story 383 end to end: two copies of a site, each run with `crombolo start`. A
 * change made in a workspace on the first is taken over the remote protocol,
 * staged on the second, looked at there while its live site serves what it did,
 * and applied by the staged workspace's merge. A later change, to a page the
 * second copy has edited since, is refused naming the field, and the second
 * copy's page is as it was.
 *
 * Named `*.integration.ts`, so `bun test` does not collect it: it spawns
 * processes and boots servers. `bun run test:integration` runs it, and CI does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { deriveChallenge, generateToken, parseCookies } from '@crombolo/auth'
import { DEFAULT_BACKOFFICE_PATH, managementApiPath } from '@crombolo/core'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')
const PASSWORD = 'integration-password'
const API = managementApiPath(DEFAULT_BACKOFFICE_PATH)
const SECURITY = `${API}/security/back-office`
const WORKSPACES = `${DEFAULT_BACKOFFICE_PATH}/crombolo/api/workspaces`
const REMOTE = '/crombolo/remote/v1/environments/production'

const TEMPLATE = `import type { PageProps } from '@crombolo/crombolo'

export default function Page({ model }: PageProps) {
  return (
    <html lang="en">
      <body>
        <h1>{model.text('title')}</h1>
      </body>
    </html>
  )
}
`

let dir: string

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

async function ok(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd,
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
}

/** One copy of the site, running, with a signed-in administrator's session. */
class Site {
  origin = ''
  proc: ReturnType<typeof Bun.spawn> | undefined
  #cookies = new Map<string, string>()

  constructor(readonly root: string) {}

  async start() {
    const proc = Bun.spawn(['bun', CLI, 'start'], {
      cwd: this.root,
      env: {
        ...environment(),
        NODE_ENV: 'production',
        PORT: '0',
        CROMBOLO_WORKSPACES: 'true',
        CROMBOLO_SCHEMA_WRITABLE: 'true',
        CROMBOLO_REMOTE_ACCESS: 'all',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    this.proc = proc
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
    this.origin = new URL(url).origin
    await this.signIn()
  }

  async send(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    if (this.#cookies.size > 0)
      headers.set(
        'cookie',
        [...this.#cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; '),
      )
    const response = await fetch(`${this.origin}${path}`, { ...init, headers, redirect: 'manual' })
    for (const header of response.headers.getSetCookie())
      for (const [name, value] of parseCookies(header.split(';')[0] ?? ''))
        if (value === '') this.#cookies.delete(name)
        else this.#cookies.set(name, value)
    return response
  }

  /** A call as the administrator, in a workspace when one is named; a page's save names its revision. */
  async call(method: string, path: string, body?: unknown, workspace?: string) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(workspace ? { 'crombolo-workspace': workspace } : {}),
    }
    if (/\/document\/[0-9a-f-]{36}$/.test(path) && method === 'PUT') {
      const etag = (await this.send(path, { headers })).headers.get('etag')
      if (etag) headers['if-match'] = etag
    }
    return this.send(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async signIn() {
    const login = await this.send(`${SECURITY}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@crombolo.local', password: PASSWORD }),
    })
    expect(login.status).toBe(200)
    const redirect = `${this.origin}${DEFAULT_BACKOFFICE_PATH}/oauth_complete`
    const verifier = generateToken(96)
    const authorize = await this.send(
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
    const token = await this.send(`${SECURITY}/token`, {
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

  live = async (path = '/') => (await fetch(`${this.origin}${path}`)).text()

  async liveSays(text: string) {
    for (let n = 0; n < 60; n++) {
      if ((await this.live()).includes(text)) return
      await Bun.sleep(500)
    }
    expect(await this.live()).toContain(text)
  }

  async home() {
    const roots = (await (
      await this.call('GET', `${API}/tree/document/root?skip=0&take=10`)
    ).json()) as { items: Array<{ id: string }> }
    return roots.items[0]?.id as string
  }

  /** Sets Home's title and publishes it, in a workspace when one is named. */
  async title(value: string, workspace?: string) {
    const home = await this.home()
    const document = (await (
      await this.call('GET', `${API}/document/${home}`, undefined, workspace)
    ).json()) as Record<string, unknown> & { values: Array<{ alias: string }> }
    const saved = await this.call(
      'PUT',
      `${API}/document/${home}`,
      {
        ...document,
        values: document.values.map((v) => (v.alias === 'title' ? { ...v, value } : v)),
      },
      workspace,
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    const published = await this.call(
      'PUT',
      `${API}/document/${home}/publish`,
      { publishSchedules: [{ culture: null }] },
      workspace,
    )
    expect(published.status).toBe(200)
  }

  /** A change made in a workspace and merged here, taken over the remote protocol. */
  async changeMade(name: string, title: string) {
    const workspace = (await (await this.call('POST', WORKSPACES, { name })).json()) as {
      key: string
    }
    await this.title(title, workspace.key)
    const merged = await this.call('POST', `${WORKSPACES}/${workspace.key}/merge`, { accept: [] })
    expect(merged.status, await merged.clone().text()).toBe(200)
    const list = (await (await this.send(`${REMOTE}/changes`)).json()) as {
      items: Array<{ id: string; key: string; name: string }>
    }
    const change = list.items.find((c) => c.name === name) as { id: string; key: string }
    const taken = await this.send(`${REMOTE}/changes/${change.id}/bundle`)
    expect(taken.status).toBe(200)
    return {
      key: change.key,
      bytes: new Uint8Array(await taken.arrayBuffer()),
      sha: taken.headers.get('crombolo-sha256') as string,
    }
  }

  put(change: { bytes: Uint8Array; sha: string }, query = '') {
    return this.send(`${REMOTE}/changes${query}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/gzip', 'crombolo-sha256': change.sha },
      body: change.bytes as Uint8Array<ArrayBuffer>,
    })
  }

  async stop() {
    this.proc?.kill()
    await this.proc?.exited
  }
}

let made: Site
let served: Site

beforeAll(async () => {
  mkdirSync(join(ROOT, 'output'), { recursive: true })
  dir = mkdtempSync(join(ROOT, 'output', 'change-transfer-'))
  const first = join(dir, 'made')
  mkdirSync(first)
  await ok(first, 'init', '--name', 'Harbour', '--empty')
  await ok(first, 'types', 'new', 'content-type', 'page', '--name', 'Page', '--at-root')
  writeFileSync(join(first, 'components', 'page.tsx'), TEMPLATE)
  await ok(first, 'content', 'new', '/Home', '--type', 'page', '--set', 'title=Home', '--publish')
  // The second copy begins as the first, its pages and their keys alike.
  cpSync(first, join(dir, 'served'), { recursive: true })
  made = new Site(first)
  served = new Site(join(dir, 'served'))
  await Promise.all([made.start(), served.start()])
}, 180_000)

afterAll(async () => {
  await Promise.all([made?.stop(), served?.stop()])
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('a change moved between two running copies of a site', () => {
  test('staged, looked at, applied; then refused where the copy moved on', async () => {
    const sale = await made.changeMade('Spring sale', 'Spring sale')
    await made.liveSays('Spring sale')

    const staged = await served.put(sale, '?stage=true')
    expect(staged.status, await staged.clone().text()).toBe(200)
    const { workspace } = (await staged.json()) as { workspace: string }
    expect(await served.live()).toContain('Home')
    const looked = (await (
      await served.call('GET', `${WORKSPACES}/${workspace}/render?path=/`)
    ).json()) as { html?: string }
    expect(looked.html).toContain('Spring sale')
    expect(await served.live()).not.toContain('Spring sale')

    const merged = await served.call('POST', `${WORKSPACES}/${workspace}/merge`, { accept: [] })
    expect(merged.status, await merged.clone().text()).toBe(200)
    await served.liveSays('Spring sale')
    const held = (await (await served.send(`${REMOTE}/changes/held?keys=${sale.key}`)).json()) as {
      held: string[]
    }
    expect(held.held).toEqual([sale.key])

    // The served copy edits its own page; the next change from the first meets it.
    await served.title('Ours')
    await served.liveSays('Ours')
    const summer = await made.changeMade('Summer', 'Summer')
    const refused = await served.put(summer)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).toContain('title')
    expect(await served.live()).toContain('Ours')
  }, 120_000)
})
