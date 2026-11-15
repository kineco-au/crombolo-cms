/**
 * Story 362 from the command line: `extension activity`, in a site folder and on
 * a hosted site with --profile, as Installed's Activity view lists and exports
 * it. A person without Settings is refused, CI is refused on each route, and a
 * site too old for them is told apart.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hashToken } from '@crombolo/auth'
import { packageInRoot, prepareRoot, recordExtension } from '@crombolo/backoffice-host'
import { CliTokenPermissions, RemotePermissions } from '@crombolo/core'
import {
  type ActivityInput,
  type Db,
  DbDate,
  ExtensionActivityLog,
  RemoteTrustRepository,
  UserGroupRepository,
  UserRepository,
} from '@crombolo/data'
import {
  activityCsv,
  bootstrapDatabase,
  JWT_TOKEN_TYPE,
  REMOTE_API_PATH,
  TOKEN_EXCHANGE_GRANT,
  VERSION,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import { type TreeSite, treeSite, writeTreeSite } from './support/content-tree.ts'
import { BACKOFFICE, ORIGIN, signInAsGroup } from './support/harness.ts'
import { cli, type LocalSite, localSite, withSiteDb } from './support/local-site.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const ADA = '6c1f6f9e-2b7a-4d4e-9a51-1f0e8d2a3b4c'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Item {
  id: number
  kind: string
  personName: string | null
  occurredAt: string
}
interface Listed {
  summary: { counts: Record<string, number>; people: { key: string; name: string }[]; days: number }
  items: Item[]
  next: number | null
}

const row = (over: Partial<ActivityInput>): ActivityInput => ({
  extensionId: 'crm',
  personKey: null,
  personName: null,
  kind: 'write',
  area: 'redirects',
  verb: 'save',
  entityKey: null,
  count: 1,
  outcome: 'ok',
  ms: 4,
  occurredAt: new Date(),
  ...over,
})

/** Ada, and seven things crm did, one of each kind, the oldest three days ago; and one by an extension since removed. */
async function seedActivity(db: Db) {
  if (!(await new UserRepository(db).byKey(ADA)))
    await new UserRepository(db).create({
      key: ADA,
      name: 'Ada Lovelace',
      userName: 'ada',
      email: 'ada@example.com',
      kind: 'Default',
      groupKeys: [],
      languageIsoCode: null,
    })
  await new ExtensionActivityLog(db).record([
    row({
      kind: 'read',
      area: 'content',
      verb: 'GET',
      count: 4,
      occurredAt: new Date(Date.now() - 3 * 86_400_000),
    }),
    row({ personKey: ADA, personName: 'Ada Lovelace', entityKey: 'k1' }),
    row({ kind: 'request', area: 'api.acme.test', verb: 'GET' }),
    row({ kind: 'rows', area: 'note', verb: 'insert', count: 2 }),
    row({ kind: 'call', area: 'route sync', verb: 'POST' }),
    row({
      kind: 'screen',
      area: 'rules',
      verb: 'view',
      personKey: ADA,
      personName: 'Ada Lovelace',
    }),
    row({ kind: 'refused', area: 'redirects', verb: 'save (redirects.write)', outcome: 'refused' }),
    row({ extensionId: 'gone', kind: 'call', area: 'job tidy', verb: null }),
  ])
}

const KINDS = {
  changes: 'write',
  reads: 'read',
  requests: 'request',
  data: 'rows',
  calls: 'call',
  screens: 'screen',
  refused: 'refused',
}

describe('in a site folder', () => {
  let here: LocalSite
  const run = (args: string[], env: Record<string, string> = {}) => cli(here, args, env)
  const ok = (...args: string[]) => {
    const done = run(args)
    expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
    return done
  }

  beforeAll(async () => {
    here = localSite('activity-cli')
    // crm installed, as `extension install` leaves it.
    prepareRoot(here.dir, 'crm')
    recordExtension(here.dir, 'crm', { name: '@acme/crm', version: '1.0.0' })
    const pkg = packageInRoot(here.dir, 'crm', '@acme/crm')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        name: '@acme/crm',
        version: '1.0.0',
        peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
        crombolo: {
          bundleType: 'extension',
          id: 'crm',
          name: 'CRM',
          server: 'crm',
          schemaVersion: 6,
          permissions: {},
        },
      }),
    )
    await (await bootstrapDatabase(here.config)).db.close()
    await withSiteDb(here, seedActivity)
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('the counts, then a line each, newest first, worded as the screen words them', () => {
    const lines = ok('extension', 'activity', 'crm').out.trimEnd().split('\n')
    expect(lines[0]).toBe(
      '  1 write, 4 reads, 1 request out, 2 rows written, 1 call, 1 screen opened, 1 refused in the last 14 days',
    )
    const rows = lines.slice(2)
    expect(rows).toHaveLength(7)
    expect(rows[0]).toContain('itself')
    expect(rows[0]).toContain('was refused: save (redirects.write)')
    expect(rows[1]).toContain('Ada Lovelace')
    expect(rows[1]).toContain('opened the rules screen')
    expect(rows[5]).toContain('changed redirects (k1)')
    expect(rows[6]).toContain('read pages, 4 times')
    expect(rows[6]).toMatch(/^ {2}\d{4}-\d{2}-\d{2} \d{2}:\d{2} {2}/)
  }, 60_000)

  test('each --kind, --user by e-mail and itself, and --since', () => {
    for (const [flag, kind] of Object.entries(KINDS)) {
      const found = json<Listed>(
        run(['extension', 'activity', 'crm', '--kind', flag, '-o', 'json']),
      )
      expect(
        found.items.map((item) => item.kind),
        flag,
      ).toEqual([kind])
    }
    expect(run(['extension', 'activity', 'crm', '--kind', 'write']).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
    const ada = json<Listed>(
      run(['extension', 'activity', 'crm', '--user', 'ada@example.com', '-o', 'json']),
    )
    expect(ada.items.map((item) => item.kind)).toEqual(['screen', 'write'])
    const byLogin = json<Listed>(
      run(['extension', 'activity', 'crm', '--user', 'ada', '-o', 'json']),
    )
    expect(byLogin.items).toHaveLength(2)
    const itself = json<Listed>(
      run(['extension', 'activity', 'crm', '--user', 'itself', '-o', 'json']),
    )
    expect(itself.items.map((item) => item.kind)).toEqual([
      'refused',
      'call',
      'rows',
      'request',
      'read',
    ])
    const unknown = run(['extension', 'activity', 'crm', '--user', 'nobody@example.com'])
    expect(unknown.code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(unknown.err).toContain('There is no user "nobody@example.com".')

    const since = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
    const recent = json<Listed>(
      run(['extension', 'activity', 'crm', '--since', since, '-o', 'json']),
    )
    expect(recent.items).toHaveLength(6)
    expect(recent.items.map((item) => item.kind)).not.toContain('read')
    expect(run(['extension', 'activity', 'crm', '--since', 'last tuesday']).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
  }, 60_000)

  test('two pages through --before', () => {
    const first = ok('extension', 'activity', 'crm', '--limit', '4').out
    const page = json<Listed>(run(['extension', 'activity', 'crm', '--limit', '4', '-o', 'json']))
    expect(page.items).toHaveLength(4)
    expect(page.next).not.toBeNull()
    expect(first).toContain(`More: --before ${page.next}`)
    const rest = json<Listed>(
      run([
        'extension',
        'activity',
        'crm',
        '--limit',
        '4',
        '--before',
        String(page.next),
        '-o',
        'json',
      ]),
    )
    expect(rest.items).toHaveLength(3)
    expect(rest.next).toBeNull()
    expect(new Set([...page.items, ...rest.items].map((item) => item.id)).size).toBe(7)
  }, 60_000)

  test('-o json: the summary, the stored kinds and full dates', () => {
    const listed = json<Listed>(run(['extension', 'activity', 'crm', '-o', 'json']))
    expect(listed.summary).toEqual({
      counts: { read: 4, write: 1, request: 1, rows: 2, call: 1, screen: 1, refused: 1 },
      people: [{ key: ADA, name: 'Ada Lovelace' }],
      days: 14,
    })
    expect(listed.items[0]).toMatchObject({ kind: 'refused', outcome: 'refused' })
    expect(listed.items[0]?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(listed.next).toBeNull()
  }, 60_000)

  test('--csv matches the screen’s file, to stdout or to --file', async () => {
    const screen = await withSiteDb(here, (db) =>
      activityCsv(new ExtensionActivityLog(db), 'crm', { kind: 'write' }),
    )
    expect(ok('extension', 'activity', 'crm', '--kind', 'changes', '--csv').out).toBe(screen)
    const all = await withSiteDb(here, (db) => activityCsv(new ExtensionActivityLog(db), 'crm', {}))
    const file = join(here.dir, 'crm.csv')
    expect(ok('extension', 'activity', 'crm', '--csv', '--file', file).out).toContain(
      'Wrote 7 rows to',
    )
    expect(readFileSync(file, 'utf8')).toBe(all)
    const both = run(['extension', 'activity', 'crm', '--csv', '-o', 'json'])
    expect(both.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(run(['extension', 'activity', 'crm', '--file', file]).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
  }, 60_000)

  test('named by its package name or its id; a removed one by its id', () => {
    const byPackage = json<Listed>(run(['extension', 'activity', '@acme/crm', '-o', 'json']))
    const byId = json<Listed>(run(['extension', 'activity', 'crm', '-o', 'json']))
    expect(byPackage.items).toEqual(byId.items)
    const gone = json<Listed>(run(['extension', 'activity', 'gone', '-o', 'json']))
    expect(gone.items.map((item) => item.kind)).toEqual(['call'])
    expect(ok('extension', 'activity', 'never-there').out).toContain('Nothing recorded.')
    const unknown = run(['extension', 'activity', '@acme/none'])
    expect(unknown.code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(unknown.err).toContain('No extension "@acme/none" is installed here.')
  }, 60_000)
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
    const dir = mkdtempSync(join(process.cwd(), 'output', 'activity-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const made = (await (
      await site.h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'activity' })
    ).json()) as { token: string }
    const run = async (args: string[], token = made.token): Promise<Run> => {
      const proc = Bun.spawn(['bun', BIN, ...args, '--profile', 'prod'], {
        cwd: dir,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
          ...(process.env as Record<string, string>),
          CROMBOLO_PROFILES_FILE: join(dir, 'profiles'),
          CROMBOLO_TOKEN: token,
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

  test('a page, a filter, two pages and the CSV file, as the screen gives them', async () => {
    const { site, run } = await hosted()
    await seedActivity(site.h.server.db)
    const text = await run(['extension', 'activity', 'crm'])
    expect(text.code, text.err).toBe(0)
    expect(text.out).toContain('2 rows written')
    expect(text.out).toContain('was refused: save (redirects.write)')
    const listed = json<Listed>(await run(['extension', 'activity', 'crm', '-o', 'json']))
    expect(listed.items).toHaveLength(7)
    expect(listed.summary.days).toBe(14)
    const ada = json<Listed>(
      await run(['extension', 'activity', 'crm', '--user', 'ada@example.com', '-o', 'json']),
    )
    expect(ada.items.map((item) => item.kind)).toEqual(['screen', 'write'])
    const refused = json<Listed>(
      await run(['extension', 'activity', 'crm', '--kind', 'refused', '-o', 'json']),
    )
    expect(refused.items.map((item) => item.kind)).toEqual(['refused'])
    const first = json<Listed>(
      await run(['extension', 'activity', 'crm', '--limit', '4', '-o', 'json']),
    )
    const rest = json<Listed>(
      await run([
        'extension',
        'activity',
        'crm',
        '--limit',
        '4',
        '--before',
        String(first.next),
        '-o',
        'json',
      ]),
    )
    expect(rest.items).toHaveLength(3)

    const screen = await (
      await site.h.call(`${BACKOFFICE}/crombolo/api/extensions/installed/crm/activity.csv`)
    ).text()
    const csv = await run(['extension', 'activity', 'crm', '--csv'])
    expect(csv.code, csv.err).toBe(0)
    expect(csv.out).toBe(screen)
    expect(csv.out.split('\n')[0]).toBe('when,person,kind,area,verb,item,count,outcome,ms')
    const unknown = await run(['extension', 'activity', 'crm', '--user', 'nobody@example.com'])
    expect(unknown.code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(unknown.err).toContain('There is no user')
  }, 120_000)

  test('a person without the Settings section is refused', async () => {
    const { site, run } = await hosted()
    await signInAsGroup(site.h, 'writer', 'writer@example.com')
    const writer = await new UserRepository(site.h.server.db).byEmail('writer@example.com')
    // Writers may not make command-line tokens until a group lets them.
    const groups = new UserGroupRepository(site.h.server.db)
    const group = await groups.byAlias('writer')
    if (group)
      await groups.save({
        ...group,
        permissions: [...group.permissions, CliTokenPermissions.Create],
      })
    const token = `crombolo_pat_${randomUUID().replaceAll('-', '')}`
    await site.h.server.db.q
      .insertInto('cli_token')
      .values({
        key: randomUUID(),
        user_id: writer?.id as number,
        name: 'writer',
        token_hash: hashToken(token),
        created_at: DbDate.toDb(new Date()),
        expires_at: DbDate.toDb(new Date(Date.now() + 86_400_000)),
      })
      .execute()
    for (const args of [
      ['extension', 'activity', 'crm'],
      ['extension', 'activity', 'crm', '--csv'],
    ]) {
      const refused = await run(args, token)
      expect(refused.code, `${args.join(' ')}: ${refused.err}`).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.err).toContain('You may not see what extensions did here')
    }
  }, 120_000)

  test('CI is refused on each route, as these show who did what', async () => {
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
    for (const path of [
      'installed/crm/activity',
      'installed/crm/activity/summary',
      'installed/crm/activity.csv',
    ]) {
      const answer = await site.h.server.fetch(
        new Request(`${env}/${path}`, { headers: { authorization: `Bearer ${token}` } }),
      )
      expect(answer.status, path).toBe(403)
      expect(await answer.json()).toMatchObject({
        code: 'ci-cannot-read-activity',
        title: 'Reading what an extension did needs a person',
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
              capabilities: ['content-query', 'bundle-manage'],
              environments: [{ id: 'production', name: 'production', protected: false }],
            })
          : new Response('Not Found', { status: 404 }),
    })
    cleanup.push(() => old.stop(true))
    const dir = mkdtempSync(join(process.cwd(), 'output', 'activity-old-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[old]\nurl = "http://localhost:${old.port}"\n`)
    const proc = Bun.spawn(['bun', BIN, 'extension', 'activity', 'crm', '--profile', 'old'], {
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
    expect(err).toContain('This site needs a newer crombolo to show what an extension did.')
  }, 60_000)
})
