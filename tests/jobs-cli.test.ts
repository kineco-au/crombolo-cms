/**
 * Story 359 from the command line: `jobs list`, `jobs show` and `jobs retry`, in a
 * site folder and on a hosted site with --profile, as Settings → Background jobs
 * lists and retries them. A person without Settings is refused, CI is refused on
 * each route, and a site too old for them is told apart.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemotePermissions } from '@crombolo/core'
import {
  type Db,
  DbDate,
  JobRepository,
  type JobState,
  RemoteTrustRepository,
  SUPER_USER_KEY,
} from '@crombolo/data'
import {
  bootstrapDatabase,
  JWT_TOKEN_TYPE,
  REMOTE_API_PATH,
  TOKEN_EXCHANGE_GRANT,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import { type TreeSite, treeSite, writeTreeSite } from './support/content-tree.ts'
import { ADMIN, BACKOFFICE, ORIGIN, signInAsGroup } from './support/harness.ts'
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

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Job {
  id: string
  owner: string
  name: string
  state: string
  attempts: number
  maxAttempts: number
  progress: { done: number; total?: number; note?: string } | null
  error: string | null
  createdAt: string
}
interface Listed {
  items: Partial<Job>[]
  total: number
  offset: number
  truncated: boolean
}

/** Four jobs, one in each state, the newest last; queued an hour on, so no node claims them. */
async function seedJobs(db: Db) {
  const repo = new JobRepository(db)
  const make = async (owner: string, name: string, state: JobState, more = {}) => {
    const id = await repo.enqueue({
      owner,
      name,
      payload: '{}',
      maxAttempts: 3,
      queuedBy: 'ada',
      runAt: new Date(Date.now() + 60 * 60_000),
    })
    await db.q
      .updateTable('job')
      .set({
        state,
        attempts: state === 'queued' ? 0 : state === 'failed' ? 3 : 1,
        finished_at: state === 'failed' || state === 'succeeded' ? DbDate.toDb(new Date()) : null,
        ...more,
      })
      .where('id', '=', id)
      .execute()
    await Bun.sleep(5)
    return id
  }
  const done = await make('site', 'reports.nightly', 'succeeded')
  const failed = await make('acme', 'feeds.pull', 'failed', {
    last_error: 'the feed is down\n  at pull (feeds.ts:12)',
  })
  const running = await make('site', 'imports.run', 'running', {
    progress: JSON.stringify({ done: 40, total: 100, note: 'species checked' }),
  })
  const waiting = await make('acme', 'feeds.tidy', 'queued')
  return { done, failed, running, waiting }
}

const retries = (db: Db) =>
  db.query<{ entity_name: string; source: string; user_key: string | null; user_name: string }>(
    "SELECT entity_name, source, user_key, user_name FROM audit_entry WHERE action = 'Retry' AND entity_type = 'Job'",
  )

describe('in a site folder', () => {
  let here: LocalSite
  let jobs: Awaited<ReturnType<typeof seedJobs>>
  const run = (args: string[], env: Record<string, string> = {}) => cli(here, args, env)
  const ok = (...args: string[]) => {
    const done = run(args)
    expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
    return done
  }

  beforeAll(async () => {
    here = localSite('jobs-cli')
    await (await bootstrapDatabase(here.config)).db.close()
    jobs = await withSiteDb(here, seedJobs)
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('list: newest first, a line each, narrowed by state and owner, a page at a time', () => {
    const lines = ok('jobs', 'list').out.trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain(jobs.waiting.slice(0, 8))
    expect(lines[0]).not.toContain(jobs.waiting)
    expect(lines[0]).toContain('feeds.tidy')
    expect(lines[0]).toContain('Waiting')
    expect(lines[1]).toContain('The site')
    expect(lines[1]).toContain('Running')
    expect(lines[1]).toContain('40 of 100: species checked')
    expect(lines[2]).toContain('Failed')
    expect(lines[2]).toContain('tried 3 of 3')
    expect(lines[3]).toContain('Done')

    const failed = json<Listed>(run(['jobs', 'list', '--state', 'failed', '-o', 'json']))
    expect(failed.total).toBe(1)
    expect(failed.items[0]).toMatchObject({ id: jobs.failed, state: 'failed', owner: 'acme' })
    expect(failed.items[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const site = json<Listed>(run(['jobs', 'list', '--owner', 'site', '-o', 'json']))
    expect(site.items.map((j) => j.id)).toEqual([jobs.running, jobs.done])

    const paged = run(['jobs', 'list', '--limit', '2'])
    expect(paged.out).toContain('… 2 more: --offset 2')
    const fields = json<Listed>(
      run(['jobs', 'list', '--limit', '1', '--fields', 'id,state', '-o', 'json']),
    )
    expect(fields).toMatchObject({ total: 4, truncated: true })
    expect(fields.items).toEqual([{ id: jobs.waiting, state: 'queued' }])

    expect(ok('jobs', 'list', '--owner', 'nobody').out).toContain('No background jobs.')
    expect(ok('jobs', 'list', '--owner', 'nobody', '--state', 'failed').out).toContain(
      'No failed jobs.',
    )
    expect(run(['jobs', 'list', '--state', 'stuck']).code).toBe(ERROR_KINDS.usage.exitCode)
  }, 60_000)

  test('show: what it is, how far it got and the whole error, by a prefix', () => {
    const shown = ok('jobs', 'show', jobs.failed.slice(0, 8)).out
    expect(shown).toContain(`feeds.pull  (${jobs.failed})`)
    expect(shown).toContain('from      acme')
    expect(shown).toContain('state     Failed')
    expect(shown).toContain('by ada')
    expect(shown).toContain('tried     3 of 3')
    expect(shown).toContain('the feed is down')
    expect(shown).toContain('at pull (feeds.ts:12)')
    expect(ok('jobs', 'show', jobs.running).out).toContain('progress  40 of 100: species checked')
    const asJson = json<Job>(run(['jobs', 'show', jobs.running, '-o', 'json']))
    expect(asJson).toMatchObject({ id: jobs.running, state: 'running', progress: { done: 40 } })

    const short = run(['jobs', 'show', 'abc'])
    expect(short.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(short.err).toContain('at least the first 8 characters')
    expect(run(['jobs', 'show', '99999999']).code).toBe(ERROR_KINDS.not_found.exitCode)
  }, 60_000)

  test('retry: a failed job queued again and audited; any other refused, saying its state', async () => {
    for (const [id, word] of [
      [jobs.waiting, 'waiting'],
      [jobs.running, 'running'],
      [jobs.done, 'done'],
    ] as const) {
      const refused = run(['jobs', 'retry', id])
      expect(refused.code).toBe(ERROR_KINDS.conflict.exitCode)
      expect(refused.err).toContain('Only a job that has failed can be run again.')
      expect(refused.err).toContain(`is ${word}.`)
    }
    expect(await withSiteDb(here, retries)).toEqual([])
    expect(ok('jobs', 'retry', jobs.failed.slice(0, 8)).out).toContain(
      'feeds.pull is queued to run again.',
    )
    const row = await withSiteDb(here, (db) => new JobRepository(db).get(jobs.failed))
    expect(row).toMatchObject({ state: 'queued', attempts: 0, lastError: null })
    const entries = await withSiteDb(here, retries)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entity_name: 'acme/feeds.pull', source: 'cli' })
    expect(run(['jobs', 'retry', jobs.failed]).code).toBe(ERROR_KINDS.conflict.exitCode)
  }, 60_000)

  test('signed in: a person without Settings is refused; a retry names the person', async () => {
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }
    const h = await serveSite(here)
    try {
      await signInAsGroup(h, 'writer', 'writer@example.com')
    } finally {
      await h.db.close()
    }
    await keepSignIn(here, await sessionFor(here, 'writer@example.com'))
    for (const args of [
      ['jobs', 'list'],
      ['jobs', 'show', jobs.failed],
      ['jobs', 'retry', jobs.failed],
    ]) {
      const refused = run(args, env)
      expect(refused.code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.err).toContain('needs the Settings section')
    }

    await keepSignIn(here, await sessionFor(here, ADMIN.username))
    await withSiteDb(here, (db) =>
      db.q
        .updateTable('job')
        .set({ state: 'failed', last_error: 'down again' })
        .where('id', '=', jobs.failed)
        .execute(),
    )
    const retried = run(['jobs', 'retry', jobs.failed], env)
    expect(retried.code, retried.err).toBe(0)
    const entries = await withSiteDb(here, retries)
    expect(entries.at(-1)).toMatchObject({ source: 'cli', user_key: SUPER_USER_KEY })
  }, 120_000)
})

describe('on a hosted site, with --profile', () => {
  let issuer = ''
  let oidc: ReturnType<typeof Bun.serve>
  let privateKey: CryptoKey
  beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
    oidc = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url)
        if (pathname === '/.well-known/openid-configuration')
          return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
        if (pathname === '/jwks') return Response.json({ keys: [jwk] })
        return new Response('Not Found', { status: 404 })
      },
    })
    issuer = `http://localhost:${oidc.port}`
  })
  afterAll(() => oidc.stop(true))

  async function hosted() {
    const root = writeTreeSite()
    const site: TreeSite = await treeSite({
      root,
      config: {
        cliTokens: true,
        remote: {
          enabled: true,
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 2,
          oidcIssuers: [issuer],
        },
      },
    })
    const listening = Bun.serve({ port: 0, fetch: (request) => site.h.server.fetch(request) })
    cleanup.push(async () => {
      await listening.stop(true)
      await site.close()
      rmSync(root, { recursive: true, force: true })
    })
    const dir = mkdtempSync(join(process.cwd(), 'output', 'jobs-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const made = (await (
      await site.h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'jobs' })
    ).json()) as { token: string }
    const run = async (args: string[]): Promise<Run> => {
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
    return { site, run }
  }

  test('listed, shown and a failed one retried, audited as the person signed in', async () => {
    const { site, run } = await hosted()
    const jobs = await seedJobs(site.h.server.db)
    const ok = async (...args: string[]) => {
      const done = await run(args)
      expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
      return done
    }
    const lines = (await ok('jobs', 'list')).out.trim().split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain(jobs.waiting.slice(0, 8))
    expect(lines[1]).toContain('40 of 100: species checked')
    const failed = json<Listed>(await run(['jobs', 'list', '--state', 'failed', '-o', 'json']))
    expect(failed.items.map((j) => j.id)).toEqual([jobs.failed])
    const owned = json<Listed>(
      await run(['jobs', 'list', '--owner', 'acme', '--fields', 'id', '-o', 'json']),
    )
    expect(owned.items).toEqual([{ id: jobs.waiting }, { id: jobs.failed }])

    const shown = (await ok('jobs', 'show', jobs.failed.slice(0, 8))).out
    expect(shown).toContain('state     Failed')
    expect(shown).toContain('at pull (feeds.ts:12)')
    expect(json<Job>(await run(['jobs', 'show', jobs.done, '-o', 'json'])).state).toBe('succeeded')

    const refused = await run(['jobs', 'retry', jobs.running])
    expect(refused.code).toBe(ERROR_KINDS.conflict.exitCode)
    expect(refused.err).toContain('Only a job that has failed can be run again.')
    expect(refused.err).toContain('imports.run is running.')
    const retried = json<Job>(await run(['jobs', 'retry', jobs.failed, '-o', 'json']))
    expect(retried).toMatchObject({ id: jobs.failed, state: 'queued', attempts: 0 })
    const entries = await retries(site.h.server.db)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ entity_name: 'acme/feeds.pull', source: 'request' })
    expect(entries[0]?.user_key).toBeTruthy()
  }, 120_000)

  test("the list warns, as the dashboard does, when nothing is running the site's jobs", async () => {
    const waiting: ReturnType<typeof Bun.serve> = Bun.serve({
      port: 0,
      fetch: (request): Response => {
        const { pathname } = new URL(request.url)
        if (pathname === '/.well-known/crombolo-remote')
          return Response.json({
            protocol: 'crombolo-remote',
            versions: ['1'],
            name: 'Waiting site',
            api: `http://localhost:${waiting.port}${REMOTE_API_PATH}`,
            auth: {},
            capabilities: ['background-jobs'],
            environments: [{ id: 'production', name: 'production', protected: false }],
          })
        if (pathname === `${REMOTE_API_PATH}/environments/production/background-jobs`)
          return Response.json({ total: 0, waitingSince: new Date().toISOString(), items: [] })
        return new Response('Not Found', { status: 404 })
      },
    })
    cleanup.push(() => waiting.stop(true))
    const dir = mkdtempSync(join(process.cwd(), 'output', 'jobs-waiting-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[waiting]\nurl = "http://localhost:${waiting.port}"\n`)
    const proc = Bun.spawn(['bun', BIN, 'jobs', 'list', '--profile', 'waiting'], {
      cwd: dir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...(process.env as Record<string, string>),
        CROMBOLO_PROFILES_FILE: join(dir, 'profiles'),
        CROMBOLO_TOKEN: 'crombolo_pat_unused',
      },
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    expect(code, err).toBe(0)
    expect(err).toContain('Background work is waiting: nothing is running it.')
    expect(out).toContain('No background jobs.')
  }, 60_000)

  test('CI is refused on each route, as these act for a person', async () => {
    const { site } = await hosted()
    await new RemoteTrustRepository(site.h.server.db).create(
      {
        name: 'Deploys',
        issuer,
        repository: 'acme/site',
        refKind: 'branch',
        refValue: 'main',
        permissions: [RemotePermissions.Pull, RemotePermissions.Push],
      },
      'test',
    )
    const now = Math.floor(Date.now() / 1000)
    const identity = await new SignJWT({
      project_path: 'acme/site',
      ref: 'main',
      ref_type: 'branch',
      pipeline_id: '42',
      job_id: '7',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setAudience(ORIGIN)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .setJti(randomUUID())
      .sign(privateKey)
    const API = `${ORIGIN}${REMOTE_API_PATH}`
    const exchanged = await site.h.server.fetch(
      new Request(`${API}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: identity,
          subject_token_type: JWT_TOKEN_TYPE,
        }),
      }),
    )
    expect(exchanged.status).toBe(200)
    const token = ((await exchanged.json()) as { access_token: string }).access_token
    const env = `${API}/environments/production`
    const id = randomUUID()
    for (const [method, path] of [
      ['GET', 'background-jobs'],
      ['GET', `background-jobs/${id}`],
      ['POST', `background-jobs/${id}/retry`],
    ] as const) {
      const answer = await site.h.server.fetch(
        new Request(`${env}/${path}`, {
          method,
          headers: { authorization: `Bearer ${token}` },
        }),
      )
      expect(answer.status, `${method} ${path}`).toBe(403)
      expect(await answer.json()).toMatchObject({
        code: 'ci-cannot-manage-jobs',
        title: 'Background jobs need a person',
      })
    }
  }, 120_000)

  test('a site from before these routes is told apart, and the command says it needs upgrading', async () => {
    const old: ReturnType<typeof Bun.serve> = Bun.serve({
      port: 0,
      fetch: (request): Response =>
        new URL(request.url).pathname === '/.well-known/crombolo-remote'
          ? Response.json({
              protocol: 'crombolo-remote',
              versions: ['1'],
              name: 'Old site',
              api: `http://localhost:${old.port}${REMOTE_API_PATH}`,
              auth: {},
              capabilities: ['content-query', 'users'],
              environments: [{ id: 'production', name: 'production', protected: false }],
            })
          : new Response('Not Found', { status: 404 }),
    })
    cleanup.push(() => old.stop(true))
    const dir = mkdtempSync(join(process.cwd(), 'output', 'jobs-old-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[old]\nurl = "http://localhost:${old.port}"\n`)
    for (const args of [
      ['jobs', 'list'],
      ['jobs', 'show', '12345678'],
      ['jobs', 'retry', '12345678'],
    ]) {
      const proc = Bun.spawn(['bun', BIN, ...args, '--profile', 'old'], {
        cwd: dir,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...(process.env as Record<string, string>),
          CROMBOLO_PROFILES_FILE: join(dir, 'profiles'),
          CROMBOLO_TOKEN: 'crombolo_pat_unused',
        },
      })
      const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
      expect(code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(err).toContain('This site needs a newer crombolo to show its background jobs')
    }
  }, 60_000)
})
