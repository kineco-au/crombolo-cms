/**
 * Story 351 from the command line: `crombolo tokens new|list|revoke` in a site
 * folder and on a hosted site with --profile, and a command run with
 * CROMBOLO_TOKEN acting as the token's person, audited through its name.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapDatabase } from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import {
  ADMIN,
  BACKOFFICE,
  type Harness,
  signedInServer,
  signInAsGroup,
} from './support/harness.ts'
import {
  cli,
  keepSignIn,
  type LocalSite,
  localSite,
  serveSite,
  sessionFor,
  withSiteDb,
} from './support/local-site.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const ON = { CROMBOLO_CLI_TOKENS: 'true' }

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

async function signedInSite(): Promise<LocalSite> {
  const here = localSite('cli-tokens')
  cleanup.push(() => rmSync(here.dir, { recursive: true, force: true }))
  await (await bootstrapDatabase(here.config)).db.close()
  await keepSignIn(here, await sessionFor(here, ADMIN.username))
  return here
}

const json = <T>(run: { code: number | null; out: string; err: string }): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

describe('in a site folder', () => {
  test('new prints the token once; a command with CROMBOLO_TOKEN acts as its person, audited by name', async () => {
    const here = await signedInSite()
    const text = cli(here, ['tokens', 'new', '--name', 'deploy', '--expires', '7'], ON)
    expect(text.code, text.err).toBe(0)
    expect(text.out).toContain('crombolo_pat_')
    expect(text.out).toContain("won't be shown again")
    const made = json<{ token: string; name: string }>(
      cli(here, ['tokens', 'new', '--name', 'nightly', '-o', 'json'], ON),
    )
    expect(made.token.startsWith('crombolo_pat_')).toBe(true)
    const listed = json<{ items: Array<{ name: string }> }>(
      cli(here, ['tokens', 'list', '-o', 'json'], ON),
    )
    expect(listed.items.map((t) => t.name).sort()).toEqual(['deploy', 'nightly'])

    const paused = cli(here, ['maintenance', 'pause', '--reason', 'moving'], {
      ...ON,
      CROMBOLO_CLI_ACCESS: 'sign-in',
      CROMBOLO_TOKEN: made.token,
      CROMBOLO_CREDENTIALS_FILE: join(here.dir, 'nobody-signed-in'),
    })
    expect(paused.code, paused.err).toBe(0)
    const entries = await withSiteDb(here, (db) =>
      db.query<{ action: string; user_name: string; detail: string }>(
        "SELECT action, user_name, detail FROM audit_entry WHERE action IN ('PauseEditing', 'FirstUseOfToken', 'CreateToken')",
      ),
    )
    const pause = entries.find((e) => e.action === 'PauseEditing')
    expect(pause?.user_name).toBe('Administrator')
    expect(pause?.detail).toContain('through the token nightly')
    expect(entries.filter((e) => e.action === 'FirstUseOfToken')).toHaveLength(1)
    expect(entries.filter((e) => e.action === 'CreateToken')).toHaveLength(2)

    const revoked = cli(here, ['tokens', 'revoke', 'nightly'], ON)
    expect(revoked.code, revoked.err).toBe(0)
    const refused = cli(here, ['users', 'list'], { ...ON, CROMBOLO_TOKEN: made.token })
    expect(refused.code).toBe(ERROR_KINDS.auth.exitCode)
    expect(refused.err).toContain('revoked')
    const off = cli(here, ['users', 'list'], { CROMBOLO_TOKEN: made.token })
    expect(off.code).toBe(ERROR_KINDS.auth.exitCode)
    expect(off.err).toContain('does not take command-line tokens')
  }, 120_000)

  test("a non-administrator's --user is refused, and so is creating without the permission", async () => {
    const here = await signedInSite()
    const h = await serveSite(here)
    await signInAsGroup(h, 'writer')
    await h.db.close()
    await keepSignIn(here, await sessionFor(here, 'writer@example.com'))

    const others = cli(here, ['tokens', 'list', '--user', ADMIN.username], ON)
    expect(others.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(others.err).toContain('Only an administrator')
    const create = cli(here, ['tokens', 'new', '--name', 'mine'], ON)
    expect(create.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(create.err).toContain('None of your groups')
  }, 120_000)
})

describe('on a hosted site, with --profile', () => {
  test('tokens new, list and revoke; whoami acts as the token; a revoked one says why', async () => {
    const h: Harness = await signedInServer({
      config: {
        cliTokens: true,
        remote: {
          enabled: true,
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 2,
        },
      },
    })
    const listening = Bun.serve({ port: 0, fetch: (request) => h.server.fetch(request) })
    cleanup.push(async () => {
      await listening.stop(true)
      await h.db.close()
    })
    const dir = mkdtempSync(join(process.cwd(), 'output', 'cli-tokens-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const made = (await (
      await h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'ci' })
    ).json()) as { token: string }
    // Spawned, not run synchronously: the server answering it is in this process.
    const run = async (args: string[]) => {
      const proc = Bun.spawn(['bun', BIN, ...args, '--profile', 'prod'], {
        cwd: dir,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...(process.env as Record<string, string>),
          CROMBOLO_PROFILES_FILE: join(dir, 'profiles'),
          CROMBOLO_TOKEN: made.token,
        },
      })
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ])
      return { code, out, err }
    }

    expect(json<{ name: string }>(await run(['whoami', '-o', 'json'])).name).toBe('Administrator')
    const more = json<{ token: string; key: string }>(
      await run(['tokens', 'new', '--name', 'second', '-o', 'json']),
    )
    expect(more.token.startsWith('crombolo_pat_')).toBe(true)
    const listed = json<{ items: Array<{ name: string }> }>(
      await run(['tokens', 'list', '-o', 'json']),
    )
    expect(listed.items.map((t) => t.name).sort()).toEqual(['ci', 'second'])
    expect((await run(['tokens', 'revoke', 'ci'])).code).toBe(0)
    const refused = await run(['tokens', 'list'])
    expect(refused.code).toBe(ERROR_KINDS.auth.exitCode)
    expect(refused.err).toContain('revoked')
  }, 120_000)
})
