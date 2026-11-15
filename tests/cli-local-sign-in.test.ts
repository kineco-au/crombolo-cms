/**
 * Story 350: `crombolo login` with no profile signs in to this folder's site
 * through its running server, by the device grant, approved here through the
 * API as the person would in the back office. Commands then act as that person
 * with the server stopped, renewing the session, until `crombolo logout`.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { AuthStore } from '@crombolo/auth'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import { ADMIN, type Harness, V1 } from './support/harness.ts'
import {
  cli,
  keepSignIn,
  type LocalSite,
  localSite,
  serveSite,
  storedSignIn,
  withSiteDb,
} from './support/local-site.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const SECURITY = `${V1}/security/back-office`

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

/** The site's server listening on a port of its own, as `crombolo start` would. */
async function running(site: LocalSite) {
  const h = await serveSite(site)
  const listening = Bun.serve({ port: 0, fetch: (request) => h.server.fetch(request) })
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await listening.stop(true)
    await h.db.close()
  }
  cleanup.push(stop)
  return { h, port: String(listening.port), stop }
}

/** `crombolo login`, approving its code as `approver` once it is shown. */
async function login(site: LocalSite, approver: Harness, port: string) {
  const proc = Bun.spawn(['bun', BIN, 'login', '--no-browser'], {
    cwd: site.dir,
    env: site.env({ PORT: port }),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), 60_000)
  let err = ''
  let approved = false
  const decoder = new TextDecoder()
  const out = new Response(proc.stdout).text()
  for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) {
    err += decoder.decode(chunk)
    const code = /shows\s+([A-Z]{4}-[A-Z]{4})/.exec(err)?.[1]
    if (code && !approved) {
      approved = true
      await approver.post(`${SECURITY}/device/decide`, { userCode: code, approve: true })
    }
  }
  const code = await proc.exited
  clearTimeout(timer)
  return { code, out: await out, err }
}

const site = () => {
  const made = localSite('cli-sign-in')
  cleanup.push(() => rmSync(made.dir, { recursive: true, force: true }))
  return made
}

describe('signing in to this site', () => {
  test('through its running server, listed as a device; then commands as the person, with it stopped', async () => {
    const here = site()
    const { h, port, stop } = await running(here)

    const signedIn = await login(here, h, port)
    expect(signedIn.code, signedIn.err).toBe(0)
    expect(signedIn.out).toContain('as Administrator')
    const devices = await h.json<Array<{ name: string }>>(`${SECURITY}/devices`)
    expect(devices.map((d) => d.name).some((name) => name.startsWith('crombolo on '))).toBe(true)
    await stop()

    const whoami = cli(here, ['whoami', '-o', 'json'])
    expect(whoami.code, whoami.err).toBe(0)
    expect(JSON.parse(whoami.out)).toMatchObject({
      name: 'Administrator',
      email: ADMIN.username,
      access: 'open',
    })

    // Run at sign-in, with no server: it acts as the person, and the audit log says so.
    const paused = cli(here, ['maintenance', 'pause', '--reason', 'moving'], {
      CROMBOLO_CLI_ACCESS: 'sign-in',
    })
    expect(paused.code, paused.err).toBe(0)
    const admin = await withSiteDb(here, (db) => new AuthStore(db).findUserByLogin(ADMIN.username))
    const entries = await withSiteDb(here, (db) =>
      db.query<{ user_key: string; user_name: string }>(
        "SELECT user_key, user_name FROM audit_entry WHERE action = 'PauseEditing'",
      ),
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.user_name).toBe('Administrator')
    expect(entries[0]?.user_key?.toLowerCase()).toBe(admin?.key.toLowerCase())
  }, 120_000)

  test('a run-out access token is renewed while the session lasts', async () => {
    const here = site()
    const { h, port, stop } = await running(here)
    expect((await login(here, h, port)).code).toBe(0)
    await stop()

    const before = (await storedSignIn(here)) as NonNullable<
      Awaited<ReturnType<typeof storedSignIn>>
    >
    await keepSignIn(here, { ...before, expiresAt: 0 })
    const run = cli(here, ['whoami', '-o', 'json'])
    expect(run.code, run.err).toBe(0)
    expect(JSON.parse(run.out).name).toBe('Administrator')
    const after = await storedSignIn(here)
    expect(after?.accessToken).not.toBe(before.accessToken)
    expect(after?.expiresAt).toBeGreaterThan(Date.now())
  }, 120_000)

  test('logout ends the session in the database, and it is refused afterwards', async () => {
    const here = site()
    const { h, port, stop } = await running(here)
    expect((await login(here, h, port)).code).toBe(0)
    const session = await storedSignIn(here)
    await stop()

    const out = cli(here, ['logout'])
    expect(out.code, out.err).toBe(0)
    expect(out.out).toContain('signed out')
    expect(await storedSignIn(here)).toBeUndefined()
    const nobody = cli(here, ['whoami', '-o', 'json'])
    expect(JSON.parse(nobody.out).name).toBeNull()

    // The same sign-in kept again, as a copy of it would be: the site has ended it.
    if (session) await keepSignIn(here, session)
    const refused = cli(here, ['users', 'list'])
    expect(refused.code).toBe(ERROR_KINDS.auth.exitCode)
    expect(refused.err).toContain('has ended')
  }, 120_000)

  test('a session revoked from the back office is refused', async () => {
    const here = site()
    const { h, port, stop } = await running(here)
    expect((await login(here, h, port)).code).toBe(0)
    const [device] = await h.json<Array<{ id: number }>>(`${SECURITY}/devices`)
    expect((await h.del(`${SECURITY}/devices/${device?.id}`)).status).toBe(204)
    await stop()

    const refused = cli(here, ['users', 'list'])
    expect(refused.code).toBe(ERROR_KINDS.auth.exitCode)
    expect(refused.err).toContain('has ended')
  }, 120_000)

  test('with no server running, login is refused, saying to start the site', () => {
    const here = site()
    const run = cli(here, ['login', '--no-browser'], { PORT: '1' })
    expect(run.code).toBe(ERROR_KINDS.unavailable.exitCode)
    expect(run.err).toContain('not running')
    expect(run.err).toContain('crombolo start')
  })
})
