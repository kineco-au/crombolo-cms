/**
 * Story 156: reading the audit log out, page by page or as a stream — from the
 * database through a connection that cannot write, and from a hosted site
 * through the remote protocol's `audit` capability. Reading writes nothing.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuditLog, connect, type Db } from '@crombolo/data'
import { type Keychain, memoryKeychain } from '@crombolo/server'
import { discover, RemoteClient, RemoteError, signIn } from '../packages/cli/src/remote/client.ts'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, ORIGIN, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const temp = (name: string) => {
  const dir = mkdtempSync(join(process.cwd(), 'output', `${name}-`))
  dirs.push(dir)
  return dir
}

/** Six entries a second apart and after everything else, so id order is time order. */
async function seeded(db: Db) {
  const log = new AuditLog(db)
  const start = Date.now() + 60_000
  const entries = [
    { category: 'sign-in', action: 'SignIn', userName: 'ada@example.com' },
    { category: 'content', action: 'Publish', userName: 'Ada' },
    { category: 'sign-in', action: 'SignInFailed', userName: 'nobody@example.com' },
    { category: 'content', action: 'Save', userName: 'Ada' },
    { category: 'settings', action: 'Save', userName: 'Ada' },
    { category: 'content', action: 'Delete', userName: 'Ada' },
  ] as const
  const before = await log.page({}, { before: undefined, limit: 1 })
  const floor = before.items[0]?.id ?? 0
  for (const [index, entry] of entries.entries())
    await log.record({ ...entry, source: 'request', occurredAt: new Date(start + index * 1000) })
  const all = await log.page({}, { after: floor, limit: 100 })
  return { log, floor, ids: all.items.map((item) => item.id) }
}

describe(`reading the log by page (${dialectUnderTest})`, () => {
  test('newest first below a cursor, oldest first above one, with the cursor to carry on', async () => {
    const h = await signedInServer()
    open.push(h)
    const { log, floor, ids } = await seeded(h.server.db)
    expect(ids).toHaveLength(6)

    const first = await log.page({}, { limit: 4 })
    expect(first.items[0]?.id).toBe(ids[5] as number)
    expect(first.next).toBe(first.items.at(-1)?.id as number)
    const older = await log.page({}, { before: first.next as number, limit: 100 })
    expect(older.items.every((item) => item.id < (first.next as number))).toBe(true)

    const forward = await log.page({}, { after: floor, limit: 4 })
    expect(forward.items.map((item) => item.id)).toEqual(ids.slice(0, 4))
    expect(forward.next).toBe(ids[3] as number)
    const rest = await log.page({}, { after: forward.next as number, limit: 4 })
    expect(rest.items.map((item) => item.id)).toEqual(ids.slice(4))
    // Nothing newer: the cursor stays where it was, for a follower to ask again.
    const none = await log.page({}, { after: ids[5] as number, limit: 4 })
    expect(none).toEqual({ items: [], next: ids[5] as number, truncated: false })
  })

  test('filters by category and action, and finds a failed sign-in by the login it tried', async () => {
    const h = await signedInServer()
    open.push(h)
    const { log, floor } = await seeded(h.server.db)
    const content = await log.page({ category: 'content' }, { after: floor, limit: 100 })
    expect(content.items.map((item) => item.action)).toEqual(['Publish', 'Save', 'Delete'])
    const failed = await log.page({ user: 'NOBODY@example.com' }, { after: floor, limit: 100 })
    expect(failed.items.map((item) => item.action)).toEqual(['SignInFailed'])
  })

  test("a person's e-mail finds their account's entries, and only theirs", async () => {
    const h = await signedInServer()
    open.push(h)
    const log = new AuditLog(h.server.db)
    const floor = (await log.page({}, { limit: 1 })).items[0]?.id ?? 0
    await signInAsGroup(h, 'writer', 'wren@example.com')
    const theirs = await log.page({ user: 'WREN@example.com' }, { after: floor, limit: 100 })
    expect(theirs.items.map((item) => item.action)).toContain('SignIn')
    expect(theirs.items.every((item) => item.userKey === theirs.items[0]?.userKey)).toBe(true)
    // The administrator created that user; that entry is the administrator's.
    const admins = await log.page({ user: 'admin@crombolo.local' }, { after: floor, limit: 100 })
    expect(admins.items.some((item) => item.entityType === 'User')).toBe(true)
    expect(admins.items.some((item) => item.userKey === theirs.items[0]?.userKey)).toBe(false)
  })

  test('a cursor retention has passed says so', async () => {
    const h = await signedInServer()
    open.push(h)
    const { log, ids } = await seeded(h.server.db)
    // Everything up to and including the second seeded entry goes.
    await log.prune(new Date(Date.now() + 61_500))
    const after = await log.page({}, { after: ids[0] as number, limit: 100 })
    expect(after.truncated).toBe(true)
    expect(after.items[0]?.id).toBe(ids[2] as number)
    expect((await log.page({}, { after: ids[3] as number, limit: 100 })).truncated).toBe(false)
  })
})

describe(`a connection that cannot write (${dialectUnderTest})`, () => {
  test('reads, and refuses a write', async () => {
    let file: string | undefined
    let writer: Db
    if (dialectUnderTest === 'sqlite') {
      file = join(temp('read-only'), 'site.sqlite')
      writer = await connect({ dialect: 'sqlite', file })
    } else {
      const h = await signedInServer()
      open.push(h)
      writer = h.server.db
    }
    await writer.exec('CREATE TABLE IF NOT EXISTS read_only_probe (n INTEGER)')
    await writer.exec('INSERT INTO read_only_probe (n) VALUES (1)')
    const reader = await connect({ file, readOnly: true })
    try {
      expect(await reader.query('SELECT n FROM read_only_probe')).toHaveLength(1)
      await expect(reader.exec('INSERT INTO read_only_probe (n) VALUES (2)')).rejects.toThrow()
      expect(await writer.query('SELECT n FROM read_only_probe')).toHaveLength(1)
    } finally {
      await reader.close()
      await writer.exec('DROP TABLE read_only_probe')
      if (file) await writer.close()
    }
  })

  test('a SQLite file that is not there is not created', async () => {
    const file = join(temp('read-only-missing'), 'none.sqlite')
    await expect(connect({ dialect: 'sqlite', file, readOnly: true })).rejects.toThrow(
      `There is no database at ${file}`,
    )
  })
})

/** A site that is a remote, with one page type. */
async function remoteSite() {
  const root = temp('audit-remote')
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
      },
    },
  })
  open.push(h)
  return h
}

const fetchFrom = (h: Harness) =>
  ((input: RequestInfo | URL, init?: RequestInit) =>
    h.server.fetch(new Request(input, init))) as unknown as typeof fetch

async function signedInClient(
  h: Harness,
  approver: Harness,
  keychain: Keychain = memoryKeychain(),
) {
  const http = fetchFrom(h)
  const discovery = await discover(ORIGIN, http)
  await signIn(discovery, keychain, {
    clientName: 'crombolo in a test',
    http,
    sleep: () => Bun.sleep(5),
    onCode: async (code) => {
      await approver.post(`${V1}/security/back-office/device/decide`, {
        userCode: code,
        approve: true,
      })
    },
  })
  return { client: new RemoteClient(discovery, keychain, http), discovery }
}

describe(`reading a hosted site's log (${dialectUnderTest})`, () => {
  test('a remote offers it to whoever has Settings, and reading it records nothing', async () => {
    const h = await remoteSite()
    const { client, discovery } = await signedInClient(h, h)
    expect(discovery.capabilities).toContain('audit')
    const [env] = await client.json<Array<{ may: { audit: boolean } }>>('environments')
    expect(env?.may.audit).toBe(true)

    const log = new AuditLog(h.server.db)
    const latest = (await log.page({}, { limit: 1 })).items[0]?.id ?? 0
    const page = await client.json<{
      items: Array<{ id: number; category: string; user: unknown; item: unknown }>
      next: number | null
      truncated: boolean
    }>('environments/production/audit?limit=500&after=0&category=sign-in')
    expect(page.truncated).toBe(false)
    expect(page.items.length).toBeGreaterThan(0)
    expect(page.items.every((item) => item.category === 'sign-in')).toBe(true)
    expect(Object.keys(page.items[0] ?? {})).toEqual([
      'id',
      'occurredAt',
      'category',
      'action',
      'source',
      'user',
      'item',
      'ipAddress',
      'forwardedFor',
      'detail',
    ])
    expect((await log.page({}, { limit: 1 })).items[0]?.id ?? 0).toBe(latest)

    const bad = await client.api('environments/production/audit?limit=900')
    expect(bad.status).toBe(400)
  })

  test('a person without Settings is refused', async () => {
    const h = await remoteSite()
    const writer = await signInAsGroup(h, 'writer')
    const { client } = await signedInClient(h, writer)
    const [env] = await client.json<Array<{ may: { audit: boolean } }>>('environments')
    expect(env?.may.audit).toBe(false)
    const refused = await client.json('environments/production/audit').catch((e) => e)
    expect(refused).toBeInstanceOf(RemoteError)
    expect((refused as RemoteError).problem.status).toBe(403)
  })
})
