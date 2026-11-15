/**
 * Story 351: command-line tokens. The service issues, lists, revokes and
 * resolves them, keeping only a hash; the endpoints let a person manage their
 * own and an administrator anyone's; a token acts as its person, audited
 * through its name, and never decides an approval.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Principal } from '@crombolo/api-management/domain'
import {
  AuthStore,
  CLI_TOKEN_PREFIX,
  CLI_TOKEN_REFUSALS,
  CliTokens,
  hashToken,
} from '@crombolo/auth'
import { CliTokenPermissions, PERMISSION_NAMES } from '@crombolo/core'
import { AuditLog, type Db, UserGroupRepository } from '@crombolo/data'
import { REMOTE_API_PATH } from '@crombolo/server'
import { ApprovalRefused, createApprovals } from '../packages/server/src/approvals.ts'
import {
  ADMIN,
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const TOKENS = `${BACKOFFICE}/crombolo/api/cli-tokens`
const DAY = 86_400_000

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0) await open.pop()?.db.close()
})

async function site(config: Record<string, unknown> = {}) {
  const h = await signedInServer({ config: { cliTokens: true, ...config } })
  open.push(h)
  return h
}

const adminId = async (db: Db) =>
  (await new AuthStore(db).findUserByLogin(ADMIN.username))?.id as number

/** A request carrying a token as its bearer, and nothing else. */
const asToken = (h: Harness, token: string, path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${token}`)
  return h.server.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }))
}

async function setGroupVerb(db: Db, alias: string, on: boolean) {
  const groups = new UserGroupRepository(db)
  const group = await groups.byAlias(alias)
  if (!group) throw new Error(`no group ${alias}`)
  const others = group.permissions.filter((p) => p !== CliTokenPermissions.Create)
  await groups.save({
    ...group,
    permissions: on ? [...others, CliTokenPermissions.Create] : others,
  })
}

describe('the service', () => {
  test('issues a token once, keeping only its hash; 30 days unless asked, and capped', async () => {
    const h = await site({ cliTokenMaxDays: 60 })
    const tokens = new CliTokens(h.server.db, { enabled: true, maxDays: 60 })
    const id = await adminId(h.server.db)
    const now = new Date('2026-11-15T10:00:00Z')
    const made = await tokens.issue(id, 'deploy', undefined, now)
    if (!made.ok) throw new Error(made.message)
    expect(made.token.startsWith(CLI_TOKEN_PREFIX)).toBe(true)
    expect(made.token.length).toBeGreaterThan(CLI_TOKEN_PREFIX.length + 40)
    expect(made.issued.expiresAt.getTime() - now.getTime()).toBe(30 * DAY)
    const rows = await h.server.db.query<{ token_hash: string }>('SELECT token_hash FROM cli_token')
    expect(rows).toEqual([{ token_hash: hashToken(made.token) }])

    const tooLong = await tokens.issue(id, 'long', 61)
    expect(tooLong).toMatchObject({ ok: false, refused: 'days' })
    expect((await tokens.issue(id, 'deploy')).ok).toBe(false)
    expect(await tokens.issue(id, '  ')).toMatchObject({ ok: false, refused: 'name' })
    expect((await tokens.issue(id, 'longest', 60)).ok).toBe(true)
    expect((await tokens.list(id)).map((t) => t.name).sort()).toEqual(['deploy', 'longest'])
  })

  test('each refusal has its own reason, and switching tokens off keeps them', async () => {
    const h = await site()
    const db = h.server.db
    const tokens = new CliTokens(db, { enabled: true, maxDays: 90 })
    const writer = await signInAsGroup(h, 'writer')
    open.push(writer)
    await setGroupVerb(db, 'writer', true)
    const user = await new AuthStore(db).findUserByLogin('writer@example.com')
    const id = user?.id as number
    const issue = async (name: string, days?: number) => {
      const made = await tokens.issue(id, name, days)
      if (!made.ok) throw new Error(made.message)
      return made.token
    }

    expect(await tokens.resolve(`${CLI_TOKEN_PREFIX}nothing`)).toMatchObject({
      ok: false,
      reason: 'unknown',
    })
    const fine = await issue('fine')
    expect(await tokens.resolve(fine)).toMatchObject({ ok: true, firstUse: true })
    expect(await tokens.resolve(fine)).toMatchObject({ ok: true, firstUse: false })

    const expiring = await issue('expiring', 1)
    expect(await tokens.resolve(expiring, new Date(Date.now() + 2 * DAY))).toMatchObject({
      ok: false,
      reason: 'expired',
    })

    const revoked = await issue('revoked')
    const key = (await tokens.byName(id, 'revoked'))?.key as string
    expect(await tokens.revoke(key, user?.key as string)).toBeDefined()
    expect(await tokens.resolve(revoked)).toMatchObject({ ok: false, reason: 'revoked' })
    expect(await tokens.list(id)).toHaveLength(2)

    const off = new CliTokens(db, { enabled: false, maxDays: 90 })
    expect(await off.resolve(fine)).toMatchObject({ ok: false, reason: 'off' })
    expect((await off.issue(id, 'more')).ok).toBe(false)
    expect(await tokens.resolve(fine)).toMatchObject({ ok: true })

    await setGroupVerb(db, 'writer', false)
    expect(await tokens.resolve(fine)).toMatchObject({ ok: false, reason: 'not-allowed' })
    expect((await tokens.issue(id, 'more')).ok).toBe(false)
    await setGroupVerb(db, 'writer', true)
    expect(await tokens.resolve(fine)).toMatchObject({ ok: true })

    const bool = (value: boolean) => db.dialect.boolValue(value)
    await db.exec('UPDATE user_account SET is_locked_out = ? WHERE id = ?', [bool(true), id])
    expect(await tokens.resolve(fine)).toMatchObject({ ok: false, reason: 'locked' })
    await db.exec('UPDATE user_account SET is_locked_out = ?, is_approved = ? WHERE id = ?', [
      bool(false),
      bool(false),
      id,
    ])
    expect(await tokens.resolve(fine)).toMatchObject({ ok: false, reason: 'disabled' })
    await db.exec('UPDATE user_account SET is_approved = ? WHERE id = ?', [bool(true), id])
    for (const table of ['user_group_member', 'user_login_session', 'auth_token', 'auth_code'])
      await db.exec(`DELETE FROM ${table} WHERE user_id = ?`, [id])
    await db.exec('DELETE FROM user_account WHERE id = ?', [id])
    expect(await tokens.resolve(fine)).toMatchObject({ ok: false, reason: 'removed' })

    const reasons = Object.values(CLI_TOKEN_REFUSALS)
    expect(new Set(reasons).size).toBe(reasons.length)
  })

  test('the permission is given to Administrators and no one else, and has a plain name', async () => {
    const h = await site()
    const rows = await h.server.db.query<{ alias: string }>(
      `SELECT g.alias FROM user_group_permission p
       JOIN user_group g ON g.key = p.user_group_key WHERE p.permission = ?`,
      [CliTokenPermissions.Create],
    )
    expect(rows.map((r) => r.alias)).toEqual(['admin'])
    expect(PERMISSION_NAMES.find((p) => p.verb === CliTokenPermissions.Create)?.name).toBe(
      'tokens:create',
    )
  })
})

describe('the endpoints', () => {
  test('list, create once and revoke your own; creating, first use and revoking are audited', async () => {
    const h = await site()
    expect(await h.json(TOKENS)).toMatchObject({ enabled: true, mayCreate: true, items: [] })
    const created = await h.post(TOKENS, { name: 'deploy', days: 7 })
    expect(created.status).toBe(201)
    const made = (await created.json()) as { key: string; token: string; expiresAt: string }
    expect(made.token.startsWith(CLI_TOKEN_PREFIX)).toBe(true)
    const listed = await h.json<{ items: Array<Record<string, unknown>> }>(TOKENS)
    expect(listed.items.map((t) => t.name)).toEqual(['deploy'])
    expect(JSON.stringify(listed)).not.toContain(made.token)

    // It acts as its person, and what it does says it was through the token.
    const me = await asToken(h, made.token, `${V1}/user/current`)
    expect(me.status).toBe(200)
    expect(((await me.json()) as { email: string }).email).toBe(ADMIN.username)
    const second = await asToken(h, made.token, TOKENS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'nightly' }),
    })
    expect(second.status).toBe(201)
    // Never from a cookie: a browser sign-in cannot be made of one.
    const accessCookie = h
      .cookie()
      .split('; ')
      .map((pair) => pair.split('=')[0] as string)
      .find((name) => name.includes('umbAccessToken'))
    expect(accessCookie).toBeDefined()
    const asCookie = await h.server.fetch(
      new Request(`${ORIGIN}${V1}/user/current`, {
        headers: { cookie: `${accessCookie}=${made.token}` },
      }),
    )
    expect(asCookie.status).toBe(401)

    expect((await h.del(`${TOKENS}/${made.key}`)).status).toBe(204)
    const refused = await asToken(h, made.token, TOKENS)
    expect(refused.status).toBe(401)
    expect(await refused.json()).toMatchObject({ reason: 'revoked' })

    const { items } = await new AuditLog(h.server.db).page({ category: 'user' }, { limit: 50 })
    const actions = items.map((e) => e.action)
    expect(actions.filter((a) => a === 'CreateToken')).toHaveLength(2)
    expect(actions.filter((a) => a === 'FirstUseOfToken')).toHaveLength(1)
    expect(actions).toContain('RevokeToken')
    const through = items.find((e) => e.action === 'CreateToken' && e.detail?.includes('nightly'))
    expect(through?.userName).toBe('Administrator')
    expect(through?.detail).toContain('through the token deploy')
  })

  test("an administrator lists and revokes anyone's; others are refused theirs, and creating without the permission", async () => {
    const h = await site()
    const writer = await signInAsGroup(h, 'writer')
    open.push(writer)
    const own = await writer.json<{ mayCreate: boolean; items: unknown[] }>(TOKENS)
    expect(own).toMatchObject({ mayCreate: false, items: [] })
    expect((await writer.post(TOKENS, { name: 'mine' })).status).toBe(403)

    await setGroupVerb(h.server.db, 'writer', true)
    const made = (await (await writer.post(TOKENS, { name: 'mine' })).json()) as { key: string }
    const user = await new AuthStore(h.server.db).findUserByLogin('writer@example.com')
    const theirs = await h.json<{ items: Array<{ key: string }>; mayCreate: boolean }>(
      `${TOKENS}?user=${user?.key}`,
    )
    expect(theirs.items.map((t) => t.key)).toEqual([made.key])
    expect(theirs.mayCreate).toBe(false)
    const admin = await new AuthStore(h.server.db).findUserByLogin(ADMIN.username)
    expect((await writer.call(`${TOKENS}?user=${admin?.key}`)).status).toBe(403)
    const adminToken = (await (await h.post(TOKENS, { name: 'admin' })).json()) as { key: string }
    expect((await writer.del(`${TOKENS}/${adminToken.key}`)).status).toBe(404)
    expect((await h.del(`${TOKENS}/${made.key}`)).status).toBe(204)
    const revoked = (await new AuditLog(h.server.db).page({ action: 'RevokeToken' }, { limit: 5 }))
      .items[0]
    expect(revoked?.entityName).toBe(user?.userName)
  })

  test('while tokens are off, the list says so and the rest are refused', async () => {
    const h = await site({ cliTokens: false })
    expect(await h.json<unknown>(TOKENS)).toEqual({ enabled: false })
    expect((await h.post(TOKENS, { name: 'x' })).status).toBe(403)
    const id = await adminId(h.server.db)
    const made = await new CliTokens(h.server.db, { enabled: true, maxDays: 90 }).issue(id, 'kept')
    if (!made.ok) throw new Error(made.message)
    const refused = await asToken(h, made.token, `${V1}/user/current`)
    expect(refused.status).toBe(401)
    const why = await asToken(h, made.token, TOKENS)
    expect(await why.json()).toMatchObject({ reason: 'off' })
    expect((await h.server.db.query('SELECT key FROM cli_token')).length).toBe(1)
  })
})

describe('approvals', () => {
  const principal = (extra: Partial<Principal>): Principal =>
    ({
      id: randomUUID(),
      name: 'Ada',
      isAdmin: true,
      permissions: [],
      groups: [],
      ...extra,
    }) as unknown as Principal

  test('the engine refuses a decision from a token, or from CI', async () => {
    const h = await site()
    const approvals = createApprovals({
      db: h.server.db,
      publisher: {} as Parameters<typeof createApprovals>[0]['publisher'],
    })
    for (const who of [
      principal({ viaToken: { key: randomUUID(), name: 'deploy' } }),
      principal({ ci: { rule: 'r', claims: {} } }),
    ]) {
      for (const decide of [
        () => approvals.approve(who, randomUUID(), undefined, undefined),
        () => approvals.sendBack(who, randomUUID(), undefined, undefined),
      ]) {
        const refused = await decide().catch((error: unknown) => error)
        expect(refused).toBeInstanceOf(ApprovalRefused)
        expect((refused as ApprovalRefused).status).toBe(403)
      }
    }
  })

  test('a token never approves a held push', async () => {
    const h = await site({
      remote: {
        enabled: true,
        environment: 'production',
        protected: true,
        approvals: true,
        maxUploadBytes: 1024,
      },
    })
    const made = (await (await h.post(TOKENS, { name: 'deploy' })).json()) as { token: string }
    const approve = await asToken(
      h,
      made.token,
      `${REMOTE_API_PATH}/jobs/${randomUUID()}/approve`,
      {
        method: 'POST',
      },
    )
    expect(approve.status).toBe(403)
    expect(((await approve.json()) as { code: string }).code).toBe('token-cannot-approve')
  })
})
