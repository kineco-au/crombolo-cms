/**
 * Story 356 from the command line: `users update`, `users remove`, `users
 * sessions [end]`, and a group's start nodes and owners on `users groups
 * new|update`, in a site folder and on a hosted site with --profile. The `users`
 * commands act as the person signed in: a non-administrator is refused the
 * group commands, another person's sign-ins, and an administrator's account.
 * CI is refused on each route, and a site too old for them is told apart.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemotePermissions } from '@crombolo/core'
import {
  RemoteTrustRepository,
  SUPER_USER_KEY,
  UserGroupRepository,
  UserRepository,
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
import { createPage, type TreeSite, treeSite, writeTreeSite } from './support/content-tree.ts'
import { ADMIN, BACKOFFICE, ORIGIN, signInAsGroup, V1 } from './support/harness.ts'
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

interface User {
  key: string
  name: string
  email: string
  userName: string
  groups: string[]
  changed?: string[]
}
interface SignIn {
  id: string
  kind: string
  device: string | null
  current: boolean
  user: { key: string }
}
interface StartAt {
  at: string
  path: string | null
}
interface Placed {
  key: string
  alias: string
  content: StartAt
  media: StartAt
  library: StartAt
  owners: string[]
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
    here = localSite('users-cli')
    // A group with the Users section that is no administrator's, made before the server
    // starts so a person can be put in it.
    ok(
      'users',
      'groups',
      'new',
      'keepers',
      '--name',
      'Keepers',
      '--section',
      'users',
      '--section',
      'settings',
    )
    await (await bootstrapDatabase(here.config)).db.close()
    const h = await serveSite(here)
    try {
      await signInAsGroup(h, 'writer', 'writer@example.com')
      await signInAsGroup(h, 'admin', 'second@example.com')
      await signInAsGroup(h, 'keepers', 'keeper@example.com')
    } finally {
      await h.db.close()
    }
  }, 120_000)
  afterAll(() => rmSync(here.dir, { recursive: true, force: true }))

  test('update: what changed is said, what is not named is kept, and "no change"', async () => {
    const done = json<User>(
      run([
        'users',
        'update',
        'writer@example.com',
        '--name',
        'Wren Writer',
        '--group',
        'editor',
        '-o',
        'json',
      ]),
    )
    expect(done).toMatchObject({
      name: 'Wren Writer',
      groups: ['writer', 'editor'],
      changed: ['name', 'groups'],
    })
    expect(ok('users', 'update', 'writer@example.com', '--remove-group', 'editor').out).toContain(
      'saved    Wren Writer <writer@example.com>: groups',
    )
    expect(ok('users', 'update', 'WRITER@example.com', '--name', 'Wren Writer').out).toContain(
      'no change',
    )
    const moved = json<User>(
      run(['users', 'update', 'writer@example.com', '--email', 'wren@example.com', '-o', 'json']),
    )
    expect(moved).toMatchObject({ email: 'wren@example.com', userName: 'wren@example.com' })
    expect(run(['users', 'update', 'wren@example.com', '--group', 'nope']).code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
    const audited = await withSiteDb(here, (db) =>
      db.query<{ action: string; entity_key: string | null; detail: string | null }>(
        "SELECT action, entity_key, detail FROM audit_entry WHERE category = 'user' AND action = 'Save'",
      ),
    )
    expect(audited).toHaveLength(3)
    expect(audited[0]).toMatchObject({ entity_key: done.key, detail: 'crombolo users update' })
  }, 120_000)

  test('remove: someone who never signed in; refused for one who has, the built-in and the last administrator', async () => {
    ok('users', 'invite', 'never@example.com', '--group', 'writer')
    expect(ok('users', 'remove', 'never@example.com').out).toContain('removed  never@example.com')
    expect(run(['users', 'remove', 'never@example.com']).code).toBe(ERROR_KINDS.not_found.exitCode)
    const signedIn = run(['users', 'remove', 'wren@example.com'])
    expect(signedIn.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(signedIn.err).toContain('has signed in before, so they can be disabled but not removed')
    expect(signedIn.err).toContain('crombolo users disable wren@example.com')
    const builtIn = run(['users', 'remove', ADMIN.username])
    expect(builtIn.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(builtIn.err).toContain("built-in administrator can't be removed")

    // With the built-in administrator out of the group, the second is the last one.
    const admin = await withSiteDb(here, async (db) => {
      const key = (await new UserGroupRepository(db).byAlias('admin'))?.key as string
      await new UserRepository(db).removeFromGroup(key, [SUPER_USER_KEY])
      return key
    })
    try {
      const last = run([
        'users',
        'update',
        'second@example.com',
        '--remove-group',
        'admin',
        '--group',
        'editor',
      ])
      expect(last.code).toBe(ERROR_KINDS.refused.exitCode)
      expect(last.err).toContain('That would leave the site with no administrator.')
    } finally {
      await withSiteDb(here, (db) => new UserRepository(db).addToGroup(admin, [SUPER_USER_KEY]))
    }
  }, 120_000)

  test('sessions: listed and ended, with nobody signed in naming whose', () => {
    const nobody = run(['users', 'sessions'])
    expect(nobody.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(nobody.err).toContain('name whose sign-ins')
    const listed = json<{ items: SignIn[] }>(
      run(['users', 'sessions', 'wren@example.com', '-o', 'json']),
    )
    expect(listed.items.length).toBeGreaterThan(0)
    expect(listed.items[0]).toMatchObject({ kind: 'browser', current: false })
    const id = (listed.items[0] as SignIn).id
    expect(ok('users', 'sessions', 'wren@example.com').out).toContain(
      `${id.slice(0, 8)}  a browser`,
    )
    expect(ok('users', 'sessions', 'end', id.slice(0, 8)).out).toContain(
      "ended    Wren Writer's sign-in in a browser",
    )
    expect(
      json<{ items: SignIn[] }>(
        run(['users', 'sessions', 'wren@example.com', '-o', 'json']),
      ).items.map((s) => s.id),
    ).not.toContain(id)
    expect(run(['users', 'sessions', 'end', id.slice(0, 8)]).code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
  }, 60_000)

  test('groups: start nodes and owners on new and update, --no-apply refused, --dry-run, a back-office group placed', async () => {
    const refused = run([
      'users',
      'groups',
      'new',
      'nope',
      '--name',
      'Nope',
      '--start-at',
      'root',
      '--no-apply',
    ])
    expect(refused.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(refused.err).toContain('need the change applied')
    const dry = ok(
      'users',
      'groups',
      'new',
      'bloggers',
      '--name',
      'Bloggers',
      '--start-at',
      'root',
      '--dry-run',
    )
    expect(dry.out).toContain('starts in content at all of it')
    expect(dry.out).toContain('Nothing was changed (--dry-run).')

    const made = json<{ applied: boolean; placed: Placed }>(
      run([
        'users',
        'groups',
        'new',
        'bloggers',
        '--name',
        'Bloggers',
        '--section',
        'content',
        '--start-at',
        'root',
        '--media-start-at',
        'none',
        '--owner',
        'editor',
        '-o',
        'json',
      ]),
    )
    expect(made).toMatchObject({
      applied: true,
      placed: {
        alias: 'bloggers',
        content: { at: 'root' },
        media: { at: 'none' },
        owners: ['editor'],
      },
    })
    // Owners set in the database, so the file does not name them.
    expect(
      readFileSync(join(here.dir, 'schema', 'user-groups', 'bloggers.toml'), 'utf8'),
    ).not.toContain('owners')

    const preview = ok(
      'users',
      'groups',
      'update',
      'bloggers',
      '--name',
      'Blog',
      '--library-start-at',
      'root',
      '--dry-run',
    )
    expect(preview.out).toContain('named "Blog"')
    expect(preview.out).toContain('starts in the Library at all of it')
    expect(preview.out).toContain('Nothing was changed')
    const both = json<{ applied: boolean; placed: Placed }>(
      run([
        'users',
        'groups',
        'update',
        'bloggers',
        '--name',
        'Blog',
        '--library-start-at',
        'root',
        '--remove-owner',
        'editor',
        '-o',
        'json',
      ]),
    )
    expect(both).toMatchObject({ applied: true, placed: { library: { at: 'root' }, owners: [] } })
    expect(
      run(['users', 'groups', 'update', 'bloggers', '--media-start-at', 'root', '--no-apply']).code,
    ).toBe(ERROR_KINDS.usage.exitCode)
    expect(run(['users', 'groups', 'update', 'bloggers', '--start-at', '/Nowhere']).code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )

    // A group made in the back office: placed, though its file fields are refused.
    const writer = json<{ placed: Placed }>(
      run([
        'users',
        'groups',
        'update',
        'writer',
        '--media-start-at',
        'none',
        '--owner',
        'editor',
        '-o',
        'json',
      ]),
    )
    expect(writer.placed).toMatchObject({ media: { at: 'none' }, owners: ['editor'] })
    expect(ok('users', 'groups', 'update', 'writer', '--owner', 'editor').out).toContain(
      'already so',
    )
    expect(run(['users', 'groups', 'update', 'writer', '--name', 'Writers']).code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
    const shown = ok('users', 'groups', 'show', 'writer').out
    expect(shown).toContain('media        none of it')
    expect(shown).toContain('owners       editor')
    expect(shown).toContain("kept with this environment's database")
    const audited = await withSiteDb(here, (db) =>
      db.query<{ entity_key: string | null }>(
        "SELECT entity_key FROM audit_entry WHERE category = 'permission' AND action = 'Save' AND entity_type = 'UserGroup'",
      ),
    )
    expect(audited.map((a) => a.entity_key)).toContain(writer.placed.key)
  }, 180_000)

  test('signed in: a non-administrator is refused the group commands, another’s sign-ins and an administrator’s account', async () => {
    const env = { CROMBOLO_CLI_ACCESS: 'sign-in' }
    await keepSignIn(here, await sessionFor(here, 'wren@example.com'))
    for (const args of [
      ['users', 'groups', 'update', 'writer', '--start-at', 'root'],
      ['users', 'groups', 'new', 'others', '--name', 'Others'],
      ['users', 'groups', 'remove', 'bloggers'],
    ]) {
      const refused = run(args, env)
      expect(refused.code, args.join(' ')).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.err).toContain('is for administrators')
    }
    const mine = json<{ items: SignIn[] }>(run(['users', 'sessions', '-o', 'json'], env))
    const current = mine.items.find((s) => s.current)
    expect(current).toMatchObject({ kind: 'terminal', device: 'crombolo in a test' })
    expect(ok('users', 'sessions').out).toContain('(this terminal)')
    const theirs = run(['users', 'sessions', 'keeper@example.com'], env)
    expect(theirs.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(theirs.err).toContain('Only an administrator can see or end someone else')
    const second = await withSiteDb(here, (db) =>
      db.query<{ session_id: string }>(
        "SELECT s.session_id FROM user_login_session s JOIN user_account u ON u.id = s.user_id WHERE u.email = 'second@example.com' AND s.logged_out_utc IS NULL",
      ),
    )
    const ending = run(['users', 'sessions', 'end', (second[0]?.session_id ?? '').slice(0, 8)], env)
    expect(ending.code).toBe(ERROR_KINDS.refused.exitCode)

    const ended = ok('users', 'sessions', 'end', (current as SignIn).id)
    expect(ended.out).toContain('crombolo logout')
    expect(run(['users', 'sessions'], env).code).toBe(ERROR_KINDS.auth.exitCode)

    // Someone with the Users section who is no administrator: not an administrator's account.
    await keepSignIn(here, await sessionFor(here, 'keeper@example.com'))
    const disable = run(['users', 'disable', 'second@example.com'], env)
    expect(disable.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(disable.err).toContain("Only an administrator can change an administrator's account.")
    const listed = json<{ items: Array<{ email: string }> }>(
      run(['users', 'list', '-o', 'json'], env),
    )
    expect(listed.items.map((u) => u.email)).not.toContain('second@example.com')
    expect(listed.items.map((u) => u.email)).toContain('wren@example.com')
    expect(run(['users', 'remove', 'keeper@example.com'], env).err).toContain(
      "You can't remove yourself.",
    )
    await keepSignIn(here, await sessionFor(here, ADMIN.username))
    expect(run(['users', 'sessions', 'second@example.com'], env).code).toBe(0)
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
    const dir = mkdtempSync(join(process.cwd(), 'output', 'users-hosted-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[prod]\nurl = "http://localhost:${listening.port}"\n`)
    const made = (await (
      await site.h.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'people' })
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

  test('a user changed and removed, sign-ins listed and ended, and a group placed; file fields refused', async () => {
    const { site, run } = await hosted()
    const ok = async (...args: string[]) => {
      const done = await run(args)
      expect(done.code, `${args.join(' ')}: ${done.err}`).toBe(0)
      return done
    }
    await signInAsGroup(site.h, 'writer', 'writer@example.com')
    const changed = json<User>(
      await run([
        'users',
        'update',
        'writer@example.com',
        '--name',
        'Wren',
        '--group',
        'editor',
        '-o',
        'json',
      ]),
    )
    expect(changed).toMatchObject({
      name: 'Wren',
      groups: ['writer', 'editor'],
      changed: ['name', 'groups'],
    })
    expect((await ok('users', 'update', 'writer@example.com', '--name', 'Wren')).out).toContain(
      'no change',
    )
    const refused = await run(['users', 'remove', 'writer@example.com'])
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.err).toContain('has signed in before')
    await site.h.post(`${V1}/user`, {
      kind: 'Default',
      email: 'never@example.com',
      userName: 'never@example.com',
      name: 'Never',
      userGroupIds: [
        { id: (await new UserGroupRepository(site.h.server.db).byAlias('writer'))?.key },
      ],
    })
    const gone = json<User>(await run(['users', 'remove', 'never@example.com', '-o', 'json']))
    expect(gone.email).toBe('never@example.com')

    const theirs = json<{ items: SignIn[] }>(
      await run(['users', 'sessions', 'writer@example.com', '-o', 'json']),
    )
    expect(theirs.items.length).toBeGreaterThan(0)
    const id = (theirs.items[0] as SignIn).id
    expect((await ok('users', 'sessions', 'end', id)).out).toContain('sign-in in a browser')
    const mine = json<{ items: SignIn[] }>(await run(['users', 'sessions', '-o', 'json']))
    expect(mine.items.every((s) => s.user.key === SUPER_USER_KEY)).toBe(true)

    const page = await createPage(site, 'Blog')
    const placed = json<{ placed: Placed }>(
      await run([
        'users',
        'groups',
        'update',
        'writer',
        '--start-at',
        page,
        '--owner',
        'editor',
        '-o',
        'json',
      ]),
    )
    expect(placed.placed).toMatchObject({
      content: { at: 'node', path: '/Blog' },
      owners: ['editor'],
    })
    const dry = await ok('users', 'groups', 'update', 'writer', '--start-at', 'root', '--dry-run')
    expect(dry.out).toContain('Nothing was changed (--dry-run).')
    expect(
      (await new UserGroupRepository(site.h.server.db).byAlias('writer'))?.startNodes.document.key,
    ).toBe(page)
    const file = await run(['users', 'groups', 'update', 'writer', '--name', 'Writers'])
    expect(file.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(file.err).toContain("are in the site's files: change them in the site and deploy it")
    expect((await run(['users', 'groups', 'new', 'others', '--name', 'Others'])).code).not.toBe(0)

    const entries = await site.h.server.db.query<{
      action: string
      category: string
      entity_key: string | null
      detail: string | null
    }>(
      "SELECT action, category, entity_key, detail FROM audit_entry WHERE source = 'request' AND detail LIKE 'Through the remote protocol%'",
    )
    expect(entries.map((e) => `${e.category} ${e.action}`)).toEqual(
      expect.arrayContaining(['user Save', 'user Delete', 'user EndSession', 'permission Save']),
    )
    expect(entries.filter((e) => e.action === 'Save' && e.category === 'user')).toHaveLength(1)
    for (const entry of entries) {
      expect(entry.detail).toContain('through the token people')
      expect(JSON.stringify(entry)).not.toContain('example.com')
    }
  }, 180_000)

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
    for (const [method, path] of [
      ['GET', 'users?find=admin@crombolo.local'],
      ['PATCH', `users/${SUPER_USER_KEY}`],
      ['DELETE', `users/${randomUUID()}`],
      ['GET', 'sign-ins'],
      ['DELETE', 'sign-ins/abcdefgh'],
      ['PATCH', 'user-groups/writer'],
    ] as const) {
      const answer = await site.h.server.fetch(
        new Request(`${env}/${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(method === 'GET' || method === 'DELETE' ? {} : { body: '{}' }),
        }),
      )
      expect(answer.status, `${method} ${path}`).toBe(403)
      expect(await answer.json()).toMatchObject({
        code: 'ci-cannot-change-people',
        title: 'Changing people needs a person',
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
              capabilities: ['content-query', 'members'],
              environments: [{ id: 'production', name: 'production', protected: false }],
            })
          : new Response('Not Found', { status: 404 }),
    })
    cleanup.push(() => old.stop(true))
    const dir = mkdtempSync(join(process.cwd(), 'output', 'users-old-'))
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
    writeFileSync(join(dir, 'profiles'), `[old]\nurl = "http://localhost:${old.port}"\n`)
    for (const args of [
      ['users', 'update', 'ada@example.com', '--name', 'Ada'],
      ['users', 'sessions'],
      ['users', 'groups', 'update', 'writer', '--start-at', 'root'],
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
      expect(err).toContain('This site needs a newer crombolo to change its users')
    }
  }, 60_000)
})
