/**
 * Story 354 from the command line: the `members` commands, `members groups`, and
 * `content access`, in a site folder and on a hosted site with --profile; a person
 * without the Members section refused at sign-in, one without Public access on a
 * page refused, CI refused on each remote route, and a site too old for them.
 * Audit entries name the member by key, never by name or e-mail.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemotePermissions } from '@crombolo/core'
import { RemoteTrustRepository } from '@crombolo/data'
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
  treeSite,
  writeTreeSchema,
  writeTreeSite,
} from './support/content-tree.ts'
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

const CUSTOMER = `[member-type]
alias = "customer"
name = "Customer"

[[property]]
alias = "nickname"
name = "Nickname"
type = "textstring"

[[property]]
alias = "creditLimit"
name = "Credit limit"
type = "textstring"
sensitive = true
`

const writeCustomer = (root: string) => {
  mkdirSync(join(root, 'schema', 'member-types'), { recursive: true })
  writeFileSync(join(root, 'schema', 'member-types', 'customer.toml'), CUSTOMER)
}

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()?.()
})

type Run = { code: number | null; out: string; err: string }
const json = <T>(run: Run): T => {
  expect(run.code, run.err).toBe(0)
  return JSON.parse(run.out) as T
}

interface Member {
  key: string
  login: string
  email: string
  name: string
  type: string
  groups: string[]
  approved: boolean
  locked: boolean
  signsIn: string
  changed?: boolean
  values?: Array<{ property: string; value: unknown }>
}
interface Access {
  rule: string
  groups: string[]
  members: string[]
  protectedBy: { path: string } | null
  loginPage: { path: string; key: string } | null
}

/** The command line in the site's folder, with something on stdin. */
function piped(site: LocalSite, args: string[], input: string): Run {
  const proc = Bun.spawnSync(['bun', BIN, ...args], {
    cwd: site.dir,
    env: site.env(),
    stdin: Buffer.from(input),
  })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}

describe('in a site folder', () => {
  let here: LocalSite
  const run = (...args: string[]) => cli(here, args)
  const ok = (...args: string[]) => {
    const done = run(...args)
    expect(done.code, done.err).toBe(0)
    return done
  }

  beforeAll(async () => {
    here = localSite('members-cli')
    writeTreeSchema(here.dir)
    writeCustomer(here.dir)
    ok('types', 'sync')
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('new, list, show and update, values in the shorthand, a field not named kept', () => {
    ok('members', 'groups', 'new', 'Subscribers')
    const made = json<Member>(
      piped(
        here,
        [
          'members',
          'new',
          'ana@example.com',
          '--type',
          'customer',
          '--name',
          'Ana Lee',
          '--group',
          'Subscribers',
          '--set',
          'nickname=Ana',
          '--set',
          'creditLimit=5000',
          '--stdin',
          '-o',
          'json',
        ],
        'correct-horse-battery',
      ),
    )
    expect(made).toMatchObject({
      login: 'ana@example.com',
      name: 'Ana Lee',
      type: 'customer',
      groups: ['Subscribers'],
      signsIn: 'password',
      changed: true,
    })
    const provider = ok('members', 'new', 'ext@example.com', '--type', 'customer', '--login', 'ext')
    expect(provider.out).toContain('only through an identity provider')
    expect(provider.out).toContain('members reset-password ext --stdin')
    expect(run('members', 'new', 'ANA@example.com', '--type', 'customer').code).toBe(
      ERROR_KINDS.conflict.exitCode,
    )

    const listed = json<{ items: Member[]; total: number }>(
      run('members', 'list', '--group', 'Subscribers', '-o', 'json'),
    )
    expect(listed.items.map((m) => m.email)).toEqual(['ana@example.com'])
    expect(json<{ total: number }>(run('members', 'list', '-o', 'json')).total).toBe(2)
    expect(ok('members', 'list').out).toContain('signs in through a provider')

    const shown = json<Member>(run('members', 'show', 'ANA@EXAMPLE.COM', '-o', 'json'))
    expect(shown.values?.find((v) => v.property === 'creditLimit')?.value).toBe('5000')
    expect(ok('members', 'show', made.key).out).toContain('Ana Lee <ana@example.com>')
    expect(run('members', 'show', 'nobody@example.com').code).toBe(ERROR_KINDS.not_found.exitCode)

    const updated = json<Member>(
      run('members', 'update', 'ana@example.com', '--set', 'nickname=Annie', '-o', 'json'),
    )
    expect(updated).toMatchObject({ name: 'Ana Lee', groups: ['Subscribers'], changed: true })
    const after = json<Member>(run('members', 'show', 'ana@example.com', '-o', 'json'))
    expect(Object.fromEntries((after.values ?? []).map((v) => [v.property, v.value]))).toEqual({
      nickname: 'Annie',
      creditLimit: '5000',
    })
  }, 120_000)

  test('approve, lock and unlock, each with "no change"; a password made, given, and refused', async () => {
    expect(ok('members', 'approve', 'ana@example.com').out).toContain('no change')
    expect(ok('members', 'lock', 'ana@example.com').out).toContain('is locked out')
    expect(json<Member>(run('members', 'show', 'ana@example.com', '-o', 'json')).locked).toBe(true)
    expect(ok('members', 'lock', 'ana@example.com').out).toContain('no change')
    expect(ok('members', 'unlock', 'ana@example.com').out).toContain(
      'Ana Lee <ana@example.com> can sign in again',
    )
    expect(ok('members', 'unlock', 'ana@example.com').out).toContain('no change')
    expect(ok('members', 'reset-2fa', 'ana@example.com').out).toContain('no change')

    const made = json<{ password: string | null }>(
      run('members', 'reset-password', 'ana@example.com', '-o', 'json'),
    )
    expect(made.password?.length).toBeGreaterThan(10)
    const refused = run('members', 'reset-password', 'ext')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.err).toContain('--stdin')
    const given = json<{ password: string | null }>(
      piped(here, ['members', 'reset-password', 'ext', '--stdin', '-o', 'json'], 'a-new-one-12'),
    )
    expect(given.password).toBeNull()
    expect(json<Member>(run('members', 'show', 'ext', '-o', 'json')).signsIn).toBe('password')

    const audited = await withSiteDb(here, (db) =>
      db.query<{
        action: string
        entity_key: string | null
        entity_name: string | null
        detail: string | null
      }>(
        "SELECT action, entity_key, entity_name, detail FROM audit_entry WHERE category = 'member'",
      ),
    )
    const key = json<Member>(run('members', 'show', 'ana@example.com', '-o', 'json')).key
    const lock = audited.find((a) => a.action === 'Lock')
    expect(lock).toMatchObject({
      entity_key: key,
      entity_name: null,
      detail: 'crombolo members lock',
    })
    expect(audited.filter((a) => a.action === 'Lock')).toHaveLength(1)
    for (const entry of audited) {
      expect(JSON.stringify(entry)).not.toContain('example.com')
      expect(JSON.stringify(entry)).not.toContain('Ana')
    }
  }, 120_000)

  test('groups joined and left; a member in a group removed, and a group a page names refused without --yes', async () => {
    ok('members', 'groups', 'new', 'Staff')
    expect(ok('members', 'groups', 'add', 'ext', 'Staff').out).toContain('is in Staff now')
    expect(ok('members', 'groups', 'add', 'ext', 'Staff').out).toContain('no change')
    const groups = json<{ groups: Array<{ name: string; members: number }> }>(
      run('members', 'groups', 'list', '-o', 'json'),
    )
    expect(groups.groups).toMatchObject([
      { name: 'Staff', members: 1 },
      { name: 'Subscribers', members: 1 },
    ])
    expect(ok('members', 'groups', 'leave', 'ext', 'Staff').out).toContain('has left Staff')
    ok('members', 'groups', 'add', 'ext', 'Staff')

    expect(run('members', 'remove', 'ext').code).toBe(ERROR_KINDS.confirmation_required.exitCode)
    const removed = ok('members', 'remove', 'ext', '--yes')
    expect(removed.out).toContain('who was in Staff')
    expect(run('members', 'show', 'ext').code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(
      json<{ groups: Array<{ name: string; members: number }> }>(
        run('members', 'groups', 'list', '-o', 'json'),
      ).groups.find((g) => g.name === 'Staff')?.members,
    ).toBe(0)

    ok('content', 'new', '/Club', '--type', 'page')
    ok('content', 'new', '/Club/Inside', '--type', 'page')
    ok('content', 'new', '/Sign in', '--type', 'page')
    ok('content', 'new', '/Subscribe', '--type', 'page')
    expect(run('content', 'access', 'set', '/Club', '--group', 'Staff').code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
    expect(
      run(
        'content',
        'access',
        'set',
        '/Club',
        '--group',
        'Staff',
        '--member',
        'ana@example.com',
        '--login-page',
        '/Sign in',
        '--no-access-page',
        '/Subscribe',
      ).code,
    ).toBe(ERROR_KINDS.usage.exitCode)
    const set = ok(
      'content',
      'access',
      'set',
      '/Club',
      '--group',
      'Staff',
      '--group',
      'Subscribers',
      '--login-page',
      '/Sign in',
      '--no-access-page',
      '/Subscribe',
    )
    expect(set.out).toContain('/Club is now for Staff and Subscribers')
    const inherited = json<Access>(run('content', 'access', 'show', '/Club/Inside', '-o', 'json'))
    expect(inherited).toMatchObject({ rule: 'ancestor', protectedBy: { path: '/Club' } })
    expect(ok('content', 'access', 'show', '/Club/Inside').out).toContain(
      "protected by /Club's rule",
    )
    const byMember = json<Access>(
      run('content', 'access', 'set', '/Club', '--member', 'ana@example.com', '-o', 'json'),
    )
    expect(byMember).toMatchObject({
      groups: [],
      members: ['ana@example.com'],
      loginPage: { path: '/Sign in' },
    })
    ok('content', 'access', 'set', '/Club', '--group', 'Staff')

    const refused = run('members', 'groups', 'remove', 'Staff')
    expect(refused.code).toBe(ERROR_KINDS.confirmation_required.exitCode)
    expect(refused.err).toContain('/Club is for Staff')
    ok('members', 'groups', 'remove', 'Staff', '--yes')
    expect(json<Access>(run('content', 'access', 'show', '/Club', '-o', 'json')).groups).toEqual([])

    const cleared = json<{ changed: boolean; access: Access }>(
      run('content', 'access', 'clear', '/Club', '-o', 'json'),
    )
    expect(cleared).toMatchObject({ changed: true, access: { rule: 'none' } })
    expect(ok('content', 'access', 'show', '/Club').out).toContain('open to everyone')
    expect(ok('content', 'access', 'clear', '/Club').out).toContain('no change')
    const audited = await withSiteDb(here, (db) =>
      db.query<{ action: string }>(
        "SELECT action FROM audit_entry WHERE action IN ('AddPublicAccess', 'SetPublicAccess', 'RemovePublicAccess')",
      ),
    )
    expect(audited.map((a) => a.action)).toContain('RemovePublicAccess')
  }, 120_000)

  test('at sign-in, a person without Members is refused, and one without Public access on the page', async () => {
    const other = localSite('members-cli-sign-in')
    cleanup.push(() => rmSync(other.dir, { recursive: true, force: true }))
    writeTreeSchema(other.dir)
    expect(cli(other, ['types', 'sync']).code).toBe(0)
    expect(cli(other, ['content', 'new', '/Club', '--type', 'page']).code).toBe(0)
    expect(cli(other, ['content', 'new', '/Sign in', '--type', 'page']).code).toBe(0)
    expect(cli(other, ['members', 'groups', 'new', 'Staff']).code).toBe(0)
    await (await bootstrapDatabase(other.config)).db.close()
    const h = await serveSite(other)
    try {
      await signInAsGroup(h, 'writer', 'writer@example.com')
    } finally {
      await h.db.close()
    }
    await keepSignIn(other, await sessionFor(other, 'writer@example.com'))
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }
    for (const args of [
      ['members', 'list'],
      ['members', 'groups', 'new', 'Others'],
    ]) {
      const refused = cli(other, args, env)
      expect(refused.code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.err).toContain('Members section')
    }
    const page = cli(
      other,
      [
        'content',
        'access',
        'set',
        '/Club',
        '--group',
        'Staff',
        '--login-page',
        '/Sign in',
        '--no-access-page',
        '/Sign in',
      ],
      env,
    )
    expect(page.code, page.err).toBe(ERROR_KINDS.refused.exitCode)
    expect(page.err).toContain('may not change who may see')
    await keepSignIn(other, await sessionFor(other, ADMIN.username))
    expect(cli(other, ['members', 'list'], env).code).toBe(0)
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
    writeCustomer(root)
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
    const dir = mkdtempSync(join(process.cwd(), 'output', 'members-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const made = (await (
      await site.h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'members' })
    ).json()) as { token: string }
    const run = async (args: string[], input?: string): Promise<Run> => {
      const proc = Bun.spawn(['bun', BIN, ...args, '--profile', 'prod'], {
        cwd: dir,
        stdin: input === undefined ? 'ignore' : Buffer.from(input),
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

  test('members and groups looked after, and a page made for a group and cleared', async () => {
    const { site, run } = await hosted()
    const ok = async (...args: string[]) => {
      const done = await run(args)
      expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
      return done
    }
    await ok('members', 'groups', 'new', 'Subscribers')
    const made = json<Member>(
      await run(
        [
          'members',
          'new',
          'ana@example.com',
          '--type',
          'customer',
          '--name',
          'Ana Lee',
          '--group',
          'Subscribers',
          '--set',
          'creditLimit=5000',
          '--stdin',
          '-o',
          'json',
        ],
        'correct-horse-battery',
      ),
    )
    expect(made).toMatchObject({ groups: ['Subscribers'], signsIn: 'password' })
    expect(
      json<{ items: Member[] }>(await run(['members', 'list', '--find', 'ana', '-o', 'json']))
        .items[0]?.key,
    ).toBe(made.key)
    const shown = json<Member>(await run(['members', 'show', 'ANA@example.com', '-o', 'json']))
    expect(shown.values?.find((v) => v.property === 'creditLimit')?.value).toBe('5000')
    await ok('members', 'update', 'ana@example.com', '--set', 'nickname=Annie')
    expect((await ok('members', 'approve', 'ana@example.com')).out).toContain('no change')
    expect((await ok('members', 'lock', 'ana@example.com')).out).toContain('locked out')
    expect((await ok('members', 'unlock', 'ana@example.com')).out).toContain('can sign in again')
    expect((await ok('members', 'reset-2fa', 'ana@example.com')).out).toContain('no change')
    const password = json<{ password: string }>(
      await run(['members', 'reset-password', 'ana@example.com', '-o', 'json']),
    )
    expect(password.password.length).toBeGreaterThan(10)
    await ok('members', 'groups', 'new', 'Staff')
    await ok('members', 'groups', 'add', 'ana@example.com', 'Staff')
    await ok('members', 'groups', 'leave', 'ana@example.com', 'Subscribers')
    expect(json<Member>(await run(['members', 'show', made.key, '-o', 'json'])).groups).toEqual([
      'Staff',
    ])

    const club = await createPage(site, 'Club')
    const signIn = await createPage(site, 'Sign in')
    expect((await run(['content', 'access', 'show', '/Club'])).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
    const set = json<Access>(
      await run([
        'content',
        'access',
        'set',
        club,
        '--group',
        'Staff',
        '--login-page',
        signIn,
        '--no-access-page',
        signIn,
        '-o',
        'json',
      ]),
    )
    expect(set).toMatchObject({ rule: 'own', groups: ['Staff'], loginPage: { path: '/Sign in' } })
    expect((await ok('content', 'access', 'show', club)).out).toContain('/Club is for Staff')
    const refused = await run(['members', 'groups', 'remove', 'Staff'])
    expect(refused.code).toBe(ERROR_KINDS.confirmation_required.exitCode)
    await ok('members', 'groups', 'remove', 'Staff', '--yes')
    expect(
      json<{ changed: boolean }>(await run(['content', 'access', 'clear', club, '-o', 'json']))
        .changed,
    ).toBe(true)

    expect((await run(['members', 'remove', 'ana@example.com'])).code).toBe(
      ERROR_KINDS.confirmation_required.exitCode,
    )
    expect((await ok('members', 'remove', 'ana@example.com', '--yes')).out).toContain(
      'who was in no group',
    )

    const entries = await site.h.server.db.query<{
      action: string
      user_name: string | null
      entity_key: string | null
      entity_name: string | null
      detail: string | null
    }>(
      "SELECT action, user_name, entity_key, entity_name, detail FROM audit_entry WHERE category = 'member' AND source = 'request' AND entity_type = 'Member'",
    )
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(['Create', 'Save', 'Lock', 'Unlock', 'ResetPassword', 'Delete']),
    )
    for (const entry of entries) {
      expect(entry).toMatchObject({
        user_name: 'Administrator',
        entity_key: made.key,
        entity_name: null,
      })
      expect(entry.detail).toContain('through the token members')
      expect(JSON.stringify(entry)).not.toContain('example.com')
    }
  }, 180_000)

  test('CI is refused on each route, as these act for a person', async () => {
    const { site } = await hosted()
    const page = await createPage(site, 'Club')
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
    const someone = randomUUID()
    for (const [method, path] of [
      ['GET', 'members'],
      ['GET', 'members/ana@example.com'],
      ['POST', 'members'],
      ['PATCH', `members/${someone}`],
      ['DELETE', `members/${someone}`],
      ['GET', 'member-groups'],
      ['POST', 'member-groups'],
      ['DELETE', 'member-groups/Staff'],
      ['GET', `content/${page}/access`],
      ['PUT', `content/${page}/access`],
      ['DELETE', `content/${page}/access`],
    ] as const) {
      const answer = await site.h.server.fetch(
        new Request(`${env}/${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
        }),
      )
      expect(answer.status, `${method} ${path}`).toBe(403)
      const problem = (await answer.json()) as { code: string; title: string }
      expect(problem).toMatchObject({
        code: 'ci-cannot-change-people',
        title: 'Members need a person',
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
              capabilities: ['content-query'],
              environments: [{ id: 'production', name: 'production', protected: false }],
            })
          : new Response('Not Found', { status: 404 }),
    })
    cleanup.push(() => old.stop(true))
    const dir = mkdtempSync(join(process.cwd(), 'output', 'members-old-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[old]\nurl = "http://localhost:${old.port}"\n`)
    for (const [args, words] of [
      [['members', 'list'], 'to look after its members'],
      [['content', 'access', 'show', randomUUID()], 'to set who may see a page'],
    ] as const) {
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
      expect(err).toContain(`This site needs a newer crombolo ${words}`)
    }
  }, 60_000)
})
