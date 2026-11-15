/**
 * Story 350: a new site at `sign-in`, walked through as its owner would. Its
 * commands are refused until someone signs in; `crombolo login` finds the
 * server `crombolo start` runs and signs in through it, approved here over
 * HTTP as the person would in the back office; with the server stopped, pages
 * are made as the administrator, until `crombolo logout`.
 *
 * Named `*.integration.ts`, so `bun test` does not collect it: it spawns
 * processes and boots servers. `bun run test:integration` runs it, and CI does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { managementApiPath } from '@crombolo/core'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')
const PASSWORD = 'integration-password'
const SECURITY = `${managementApiPath('/umbraco')}/security/back-office`

interface Run {
  code: number
  out: string
  err: string
}

describe('signing in to a site from its own folder', () => {
  let dir: string
  let server: { proc: ReturnType<typeof Bun.spawn>; origin: string } | undefined

  function environment(): Record<string, string> {
    const inherited = { ...(process.env as Record<string, string>) }
    for (const name of [
      'CROMBOLO_SQLITE_FILE',
      'CROMBOLO_COMPONENTS_DIR',
      'CROMBOLO_SCHEMA_DIR',
      'CROMBOLO_MEDIA_DIR',
      'CROMBOLO_SITE_NAME',
    ])
      delete inherited[name]
    return {
      ...inherited,
      CROMBOLO_DB: 'sqlite',
      CROMBOLO_LOGS_DIR: join(dir, 'logs'),
      CROMBOLO_LOG_TO_CONSOLE: 'false',
      CROMBOLO_ADMIN_PASSWORD: PASSWORD,
      CROMBOLO_CLI_ACCESS: 'sign-in',
      CROMBOLO_CREDENTIALS: 'file',
      CROMBOLO_CREDENTIALS_FILE: join(dir, 'credentials'),
    }
  }

  const site = () => join(dir, 'site')

  async function collect(proc: ReturnType<typeof Bun.spawn>): Promise<Run> {
    const timer = setTimeout(() => proc.kill(), 60_000)
    try {
      const [out, err] = await Promise.all([
        new Response(proc.stdout as ReadableStream).text(),
        new Response(proc.stderr as ReadableStream).text(),
      ])
      return { code: await proc.exited, out, err }
    } finally {
      clearTimeout(timer)
    }
  }

  const cli = (...args: string[]) =>
    collect(
      Bun.spawn(['bun', CLI, ...args], {
        cwd: site(),
        env: environment(),
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )

  const ok = async (...args: string[]) => {
    const run = await cli(...args)
    expect(run.code, `crombolo ${args.join(' ')}\n${run.out}${run.err}`).toBe(0)
    return run
  }

  async function start() {
    const proc = Bun.spawn(['bun', CLI, 'start'], {
      cwd: site(),
      env: { ...environment(), PORT: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(), 90_000)
    const decoder = new TextDecoder()
    let banner = ''
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      banner += decoder.decode(chunk)
      if (banner.includes('└─')) break
    }
    clearTimeout(timer)
    const url = /site\s+(http:\/\/\S+)/.exec(banner)?.[1]
    if (!url) throw new Error(`The site did not start:\n${banner}`)
    server = { proc, origin: new URL(url).origin }
    return server
  }

  async function stop() {
    if (!server) return
    server.proc.kill()
    await server.proc.exited
    server = undefined
  }

  /** Signs in to the back office over HTTP, as a browser would, and approves the code. */
  async function approve(origin: string, code: string) {
    const login = await fetch(`${origin}${SECURITY}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@crombolo.local', password: PASSWORD }),
    })
    expect(login.status).toBe(200)
    const cookie = login.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; ')
    const decided = await fetch(`${origin}${SECURITY}/device/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ userCode: code, approve: true }),
    })
    expect(decided.status).toBe(204)
  }

  beforeAll(() => {
    mkdirSync(join(ROOT, 'output'), { recursive: true })
    dir = mkdtempSync(join(ROOT, 'output', 'sign-in-'))
    mkdirSync(site())
  })

  afterAll(async () => {
    await stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test('init, refused until signed in, login through the running site, pages as the administrator, logout', async () => {
    await ok('init', '--empty')
    const refused = await cli('types', 'list')
    expect(refused.code).toBe(4)
    expect(refused.err).toContain('crombolo login')

    const nobody = await ok('whoami')
    expect(nobody.out).toContain('nobody is signed in')
    expect(nobody.out).toContain('sign-in')

    const { origin } = await start()
    const proc = Bun.spawn(['bun', CLI, 'login', '--no-browser'], {
      cwd: site(),
      env: environment(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(), 60_000)
    const decoder = new TextDecoder()
    const out = new Response(proc.stdout as ReadableStream).text()
    let err = ''
    let approved = false
    for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
      err += decoder.decode(chunk)
      const code = /shows\s+([A-Z]{4}-[A-Z]{4})/.exec(err)?.[1]
      if (code && !approved) {
        approved = true
        await approve(origin, code)
      }
    }
    clearTimeout(timer)
    expect(await proc.exited, err).toBe(0)
    expect(await out).toContain('as Administrator')
    await stop()

    expect((await ok('whoami')).out).toContain('Administrator <admin@crombolo.local>')
    await ok('types', 'new', 'content-type', 'page', '--name', 'Page', '--at-root')
    await ok('content', 'new', '/Home', '--type', 'page', '--set', 'title=Home', '--publish')
    const audit = await ok('audit', 'list', '--category', 'content', '-o', 'json')
    const home = (
      JSON.parse(audit.out) as {
        items: Array<{ item: { name: string } | null; user: { name: string } | null }>
      }
    ).items.filter((entry) => entry.item?.name === 'Home')
    expect(home.length, audit.out).toBeGreaterThan(0)
    expect(home.map((entry) => entry.user?.name)).toEqual(home.map(() => 'Administrator'))

    expect((await ok('logout')).out).toContain('signed out')
    const after = await cli('content', 'show', '/Home')
    expect(after.code).toBe(4)
  }, 240_000)
})
