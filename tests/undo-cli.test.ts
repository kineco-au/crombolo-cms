/**
 * Story 353 from the command line: `content history`, `content history show|keep`,
 * `content rollback` and `recycle-bin list|restore`, in a site folder and on a
 * hosted site with --profile; a person without the Content section refused at
 * sign-in, CI refused on each remote route, and a site too old for them.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemotePermissions } from '@crombolo/core'
import { ContentTypeRepository, RemoteTrustRepository } from '@crombolo/data'
import {
  bootstrapDatabase,
  JWT_TOKEN_TYPE,
  REMOTE_API_PATH,
  TOKEN_EXCHANGE_GRANT,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import {
  createPage,
  type TreeSite,
  treeOps,
  treeSite,
  writeTreeSchema,
} from './support/content-tree.ts'
import { ADMIN, BACKOFFICE, type Harness, ORIGIN, signInAsGroup, V1 } from './support/harness.ts'
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

interface History {
  page: { key: string; name: string }
  versions: Array<{ id: string; kind: string; draft: boolean; live: boolean; kept: boolean }>
}
interface BinList {
  items: Array<{
    key: string
    name: string
    kind: string
    from: { path: string | null; gone: boolean }
  }>
}

/** Media folders through the back office, as an editor makes them. */
async function folder(h: Harness, name: string, parent: string | null = null): Promise<string> {
  const type = await new ContentTypeRepository(h.server.db, { kind: 'media' }).byAlias('Folder')
  const created = await h.post(`${V1}/media`, {
    mediaType: { id: type?.key },
    parent: parent ? { id: parent } : null,
    values: [],
    variants: [{ culture: null, segment: null, name }],
  })
  expect(created.status).toBe(201)
  return created.headers.get('umb-generated-resource') as string
}

const trashedIn = (site: LocalSite, name: string) =>
  withSiteDb(site, async (db) => {
    const rows = await db.query<{ trashed: number | boolean }>(
      `SELECT trashed FROM node WHERE text = '${name}'`,
    )
    return Boolean(rows[0]?.trashed)
  })

describe('in a site folder', () => {
  let here: LocalSite
  const run = (...args: string[]) => cli(here, args)
  const ok = (...args: string[]) => {
    const done = run(...args)
    expect(done.code, done.err).toBe(0)
    return done
  }

  beforeAll(async () => {
    here = localSite('undo-cli')
    writeTreeSchema(here.dir)
    ok('types', 'sync')
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('history, a version shown and diffed, kept and no longer kept', () => {
    ok('content', 'new', '/Home', '--type', 'page', '--set', 'title=Welcome')
    ok('content', 'update', '/Home', '--set', 'title=Hello')
    ok('content', 'publish', '/Home')
    ok('content', 'update', '/Home', '--set', 'title=Draft')

    const text = ok('content', 'history', '/Home')
    expect(text.out).toContain('Saved by the command line or the site')
    expect(text.out).toContain('the draft')
    expect(text.out).toContain('live')
    const history = json<History>(run('content', 'history', '/Home', '-o', 'json'))
    expect(history.versions[0]?.draft).toBe(true)
    expect(history.versions.filter((v) => v.live)).toHaveLength(1)

    const first = history.versions.at(-1)?.id as string
    const shown = json<{ values: Array<{ property: string; value: unknown }> }>(
      run('content', 'history', 'show', '/Home', first, '-o', 'json'),
    )
    expect(shown.values).toEqual([{ property: 'title', culture: null, value: 'Welcome' } as never])
    const diff = ok('content', 'history', 'show', '/Home', first, '--diff')
    expect(diff.out).toContain('draft "Draft", this version "Welcome"')
    const live = json<{ diff: Array<{ version: unknown }> }>(
      run('content', 'history', 'show', '/Home', 'latest-published', '--diff', '-o', 'json'),
    )
    expect(live.diff[0]?.version).toBe('Hello')
    expect(run('content', 'history', 'show', '/Home', '99999').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )

    const kept = json<{ kept: boolean; changed: boolean }>(
      run('content', 'history', 'keep', '/Home', 'latest-published', '-o', 'json'),
    )
    expect(kept).toMatchObject({ kept: true, changed: true })
    expect(
      json<History>(run('content', 'history', '/Home', '-o', 'json')).versions.find((v) => v.live)
        ?.kept,
    ).toBe(true)
    ok('content', 'history', 'keep', '/Home', 'latest-published', '--off')
    expect(
      json<History>(run('content', 'history', '/Home', '-o', 'json')).versions.some((v) => v.kept),
    ).toBe(false)
  }, 120_000)

  test('rollback makes a version the draft; --publish takes it live, and a workflow asks for approval', async () => {
    ok('content', 'rollback', '/Home', 'latest-published')
    const page = json<{ values: Array<{ value: unknown }>; variants: Array<{ state: string }> }>(
      run('content', 'show', '/Home', '-o', 'json'),
    )
    expect(page.values[0]?.value).toBe('Hello')
    expect(page.variants[0]?.state).toBe('PublishedPendingChanges')
    const audited = await withSiteDb(here, (db) =>
      db.query<{ action: string }>("SELECT action FROM audit_entry WHERE action = 'Rollback'"),
    )
    expect(audited.length).toBeGreaterThan(0)

    ok('content', 'rollback', '/Home', 'previous', '--publish')
    expect(
      json<{ variants: Array<{ state: string }> }>(run('content', 'show', '/Home', '-o', 'json'))
        .variants[0]?.state,
    ).toBe('Published')

    ok('workflows', 'new', 'signOff', '--content-type', 'page')
    const asked = run('content', 'rollback', '/Home', 'previous', '--publish')
    expect(asked.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(asked.err).toContain('--skip-approval')
    expect(asked.err).toContain('rolled back to a draft, and not published')
    ok('content', 'rollback', '/Home', 'previous', '--publish', '--skip-approval')
    expect(run('content', 'rollback', '/Home', 'nothing').code).toBe(ERROR_KINDS.not_found.exitCode)
  }, 120_000)

  test('restore to where it came from, to --to, and refused when its place is gone', async () => {
    ok('content', 'new', '/Home/Visit us', '--type', 'page')
    ok('content', 'new', '/About', '--type', 'page')
    ok('content', 'new', '/About/Team', '--type', 'page')
    ok('content', 'delete', '/Home/Visit us')
    ok('content', 'delete', '/About/Team')
    ok('content', 'delete', '/About')

    const listed = json<BinList>(run('recycle-bin', 'list', '--content', '-o', 'json'))
    expect(listed.items.map((i) => i.name).sort()).toEqual(['About', 'Team', 'Visit us'])
    expect(listed.items.find((i) => i.name === 'Visit us')?.from).toMatchObject({
      path: '/Home',
      gone: false,
    })
    expect(ok('recycle-bin', 'list').out).toContain('from a place that is gone')

    ok('recycle-bin', 'restore', '/Home/Visit us')
    expect(await trashedIn(here, 'Visit us')).toBe(false)
    expect(json<{ key: string }>(run('content', 'show', '/Home/Visit us', '-o', 'json')).key).toBe(
      listed.items.find((i) => i.name === 'Visit us')?.key as string,
    )

    const refused = run('recycle-bin', 'restore', 'Team')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.err).toContain('in the recycle bin too')
    expect(refused.err).toContain('--to')
    expect(await trashedIn(here, 'Team')).toBe(true)
    const moved = json<{ to: { name: string } }>(
      run('recycle-bin', 'restore', 'Team', '--to', '/Home', '-o', 'json'),
    )
    expect(moved.to.name).toBe('Home')
    ok('content', 'show', '/Home/Team')
    expect(run('recycle-bin', 'restore', 'Nothing').code).toBe(ERROR_KINDS.not_found.exitCode)
  }, 120_000)

  test('a media branch restored, with what was below it', async () => {
    const h = await serveSite(here)
    try {
      const photos = await folder(h, 'Photos')
      await folder(h, 'Summer', photos)
      expect((await h.put(`${V1}/media/${photos}/move-to-recycle-bin`, {})).status).toBe(200)
    } finally {
      await h.db.close()
    }
    expect(await trashedIn(here, 'Summer')).toBe(true)
    const listed = json<BinList>(run('recycle-bin', 'list', '--media', '-o', 'json'))
    expect(listed.items.map((i) => i.name)).toEqual(['Photos'])
    ok('recycle-bin', 'restore', 'Photos', '--media')
    expect(await trashedIn(here, 'Photos')).toBe(false)
    expect(await trashedIn(here, 'Summer')).toBe(false)
  }, 120_000)

  test('at sign-in, a person without the Content section is refused', async () => {
    const other = localSite('undo-cli-sign-in')
    cleanup.push(() => rmSync(other.dir, { recursive: true, force: true }))
    await (await bootstrapDatabase(other.config)).db.close()
    const h = await serveSite(other)
    try {
      // Sensitive data holds no section: Translators hold Content beside Translation (story 419).
      await signInAsGroup(h, 'sensitiveData', 'outsider@example.com')
    } finally {
      await h.db.close()
    }
    await keepSignIn(other, await sessionFor(other, 'outsider@example.com'))
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }
    for (const args of [
      ['content', 'history', '/Home'],
      ['content', 'rollback', '/Home', 'previous'],
      ['recycle-bin', 'list'],
    ]) {
      const refused = cli(other, args, env)
      expect(refused.code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.err).toContain('section')
    }
    await keepSignIn(other, await sessionFor(other, ADMIN.username))
    expect(cli(other, ['recycle-bin', 'list'], env).code).toBe(0)
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
    const site: TreeSite = await treeSite({
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
    })
    const dir = mkdtempSync(join(process.cwd(), 'output', 'undo-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const made = (await (
      await site.h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'undo' })
    ).json()) as { token: string }
    const run = async (...args: string[]): Promise<Run> => {
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

  test('history, show, keep and rollback, then the bin listed and restored, media included', async () => {
    const { site, run } = await hosted()
    const ops = treeOps(site)
    const home = await createPage(site, 'Home')
    await ops.save(home, 'Home', 'Second')
    await ops.publish(home)
    await ops.save(home, 'Home', 'Third')

    const history = json<History>(await run('content', 'history', home, '-o', 'json'))
    expect(history.page.name).toBe('Home')
    expect((await run('content', 'history', home)).out).toContain('Saved by Administrator')
    expect((await run('content', 'history', '/Home')).code).toBe(ERROR_KINDS.usage.exitCode)
    const diff = json<{ diff: Array<{ draft: unknown; version: unknown }> }>(
      await run('content', 'history', 'show', home, 'latest-published', '--diff', '-o', 'json'),
    )
    expect(diff.diff).toEqual([
      { property: 'title', culture: null, change: 'changed', draft: 'Third', version: 'Second' },
    ] as never)
    expect((await run('content', 'history', 'keep', home, 'latest-published')).code).toBe(0)
    expect(
      json<History>(await run('content', 'history', home, '-o', 'json')).versions.find(
        (v) => v.live,
      )?.kept,
    ).toBe(true)
    expect((await run('content', 'history', 'keep', home, 'latest-published', '--off')).code).toBe(
      0,
    )

    expect((await run('content', 'rollback', home, 'latest-published', '--publish')).code).toBe(0)
    const page = await site.h.json<{ values: Array<{ value: unknown }> }>(`${V1}/document/${home}`)
    expect(page.values[0]?.value).toBe('Second')
    const entries = await site.h.server.db.query<{ user_name: string; detail: string | null }>(
      "SELECT user_name, detail FROM audit_entry WHERE action = 'Rollback'",
    )
    expect(entries[0]?.user_name).toBe('Administrator')
    expect(entries[0]?.detail).toContain('Through the token undo')

    const visit = await createPage(site, 'Visit us', home)
    const about = await createPage(site, 'About')
    const team = await createPage(site, 'Team', about)
    await ops.trash(visit)
    await ops.trash(team)
    await ops.trash(about)
    const photos = await folder(site.h, 'Photos')
    await folder(site.h, 'Summer', photos)
    expect((await site.h.put(`${V1}/media/${photos}/move-to-recycle-bin`, {})).status).toBe(200)

    const listed = json<BinList>(await run('recycle-bin', 'list', '-o', 'json'))
    expect(listed.items.map((i) => i.name).sort()).toEqual(['About', 'Photos', 'Team', 'Visit us'])
    expect(
      json<BinList>(await run('recycle-bin', 'list', '--media', '-o', 'json')).items.map(
        (i) => i.name,
      ),
    ).toEqual(['Photos'])
    expect((await run('recycle-bin', 'restore', '/Home/Visit us')).code).toBe(0)
    const refused = await run('recycle-bin', 'restore', 'Team')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.err).toContain('--to')
    expect((await run('recycle-bin', 'restore', 'Team', '--to', home)).code).toBe(0)
    expect((await run('recycle-bin', 'restore', 'Photos')).code).toBe(0)
    const left = json<BinList>(await run('recycle-bin', 'list', '-o', 'json'))
    expect(left.items.map((i) => i.name)).toEqual(['About'])
    const summer = await site.h.server.db.query<{ trashed: number | boolean }>(
      "SELECT trashed FROM node WHERE text = 'Summer'",
    )
    expect(Boolean(summer[0]?.trashed)).toBe(false)
  }, 180_000)

  test('CI is refused on each route, as these act for a person', async () => {
    const { site } = await hosted()
    const home = await createPage(site, 'Home')
    const versions = await site.h.json<{ items: Array<{ id: string }> }>(
      `${V1}/document-version?documentId=${home}`,
    )
    const version = versions.items[0]?.id as string
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
    for (const [method, path] of [
      ['GET', `content/${home}/history`],
      ['GET', `content/versions/${version}?diff=true`],
      ['POST', `content/versions/${version}/rollback`],
      ['PUT', `content/versions/${version}/keep`],
      ['GET', 'recycle-bin'],
      ['POST', `recycle-bin/${home}/restore`],
      ['GET', `recycle-bin/jobs/${randomUUID()}`],
    ] as const) {
      const answer = await site.h.server.fetch(
        new Request(`${env}/${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(method === 'GET' ? {} : { body: '{}' }),
        }),
      )
      expect(answer.status, `${method} ${path}`).toBe(403)
      expect(((await answer.json()) as { code: string }).code).toBe('needs-person')
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
              capabilities: ['content-query'],
              environments: [{ id: 'production', name: 'production', protected: false }],
            })
          : new Response('Not Found', { status: 404 }),
    })
    cleanup.push(() => old.stop(true))
    const dir = mkdtempSync(join(process.cwd(), 'output', 'undo-old-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[old]\nurl = "http://localhost:${old.port}"\n`)
    for (const args of [
      ['content', 'history', randomUUID()],
      ['recycle-bin', 'list'],
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
      expect(code).toBe(ERROR_KINDS.refused.exitCode)
      expect(err).toContain('This site needs a newer crombolo')
    }
  }, 60_000)
})
