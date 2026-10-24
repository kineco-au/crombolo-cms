/**
 * Story 156: `crombolo audit list` and `audit stream`, through the CLI against a
 * SQLite site of its own. The reads themselves, and a remote's, are tested on
 * both dialects in audit-read.test.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuditLog, connect, type Db } from '@crombolo/data'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
let site: string

const env = (dir = site) => ({
  ...process.env,
  CROMBOLO_DB: 'sqlite',
  CROMBOLO_SQLITE_FILE: join(dir, 'site.sqlite'),
  CROMBOLO_MEDIA_DIR: join(dir, 'media'),
  CROMBOLO_SCHEMA_DIR: join(dir, 'schema'),
  CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
  CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
})

function cli(args: string[], dir = site) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: dir, env: env(dir), stdin: 'ignore' })
  const out = proc.stdout.toString()
  return { code: proc.exitCode, out, err: proc.stderr.toString() }
}

async function withDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
  try {
    return await work(db)
  } finally {
    await db.close()
  }
}

type Entry = { id: number; category: string; action: string; user: { name: string } | null }
const lines = (out: string) =>
  out
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Entry)

const record = (action: string) =>
  withDb((db) =>
    new AuditLog(db).record({ category: 'content', action, source: 'request', userName: 'Ada' }),
  )

const count = () =>
  withDb(
    async (db) => (await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM audit_entry'))[0]?.n,
  )

beforeAll(async () => {
  site = mkdtempSync(join(process.cwd(), 'output', 'cli-audit-'))
  mkdirSync(join(site, 'schema'), { recursive: true })
  writeFileSync(join(site, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  expect(cli(['users', 'list']).code).toBe(0)
  for (const action of ['Save', 'Publish', 'Unpublish', 'Delete']) await record(action)
})
afterAll(() => rmSync(site, { recursive: true, force: true }))

describe('audit list', () => {
  test('pages newest first, and the cursor carries on where the page stopped', () => {
    const first = cli(['audit', 'list', '--category', 'content', '--limit', '2', '-o', 'json'])
    expect(first.code, first.err).toBe(0)
    const page = JSON.parse(first.out) as { items: Entry[]; next: number; truncated: boolean }
    expect(page.items.map((e) => e.action)).toEqual(['Delete', 'Unpublish'])
    const second = cli([
      'audit',
      'list',
      '--category',
      'content',
      '--limit',
      '2',
      '--before',
      String(page.next),
      '-o',
      'json',
    ])
    expect((JSON.parse(second.out) as { items: Entry[] }).items.map((e) => e.action)).toEqual([
      'Publish',
      'Save',
    ])
  })

  test('says each entry as a line, and names the next page', () => {
    const run = cli(['audit', 'list', '--category', 'content', '--limit', '1'])
    expect(run.code, run.err).toBe(0)
    expect(run.out).toContain('content    Delete')
    expect(run.out).toContain('Ada')
    expect(run.out).toContain('More: --before ')
  })

  test('a date it cannot read is a usage error; a site with no database is not found', () => {
    expect(cli(['audit', 'list', '--since', 'yesterday-ish']).code).toBe(ERROR_KINDS.usage.exitCode)
    const empty = mkdtempSync(join(process.cwd(), 'output', 'cli-audit-empty-'))
    try {
      const run = cli(['audit', 'list'], empty)
      expect(run.code).toBe(ERROR_KINDS.not_found.exitCode)
      expect(run.err).toContain('There is no database at')
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})

describe('audit stream', () => {
  test('one entry per line, oldest first, from after a cursor', () => {
    const all = cli(['audit', 'stream', '--category', 'content'])
    expect(all.code, all.err).toBe(0)
    const entries = lines(all.out)
    expect(entries.map((e) => e.action)).toEqual(['Save', 'Publish', 'Unpublish', 'Delete'])
    const rest = cli([
      'audit',
      'stream',
      '--category',
      'content',
      '--after',
      String(entries[1]?.id),
    ])
    expect(lines(rest.out).map((e) => e.action)).toEqual(['Unpublish', 'Delete'])
    expect(lines(cli(['audit', 'stream', '--category', 'content', '-o', 'json']).out)).toHaveLength(
      4,
    )
  })

  test('--follow prints what is written while it runs, and stops cleanly when told', async () => {
    const last = lines(cli(['audit', 'stream']).out).at(-1)?.id as number
    const proc = Bun.spawn(
      ['bun', BIN, 'audit', 'stream', '--follow', '--interval', '1', '--after', String(last)],
      { cwd: site, env: env(), stdout: 'pipe', stderr: 'pipe' },
    )
    await Bun.sleep(1500)
    await record('Rollback')
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let out = ''
    const deadline = Date.now() + 15_000
    while (!out.includes('\n') && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      out += decoder.decode(value)
    }
    expect(lines(out).map((e) => e.action)).toEqual(['Rollback'])
    proc.kill('SIGTERM')
    expect(await proc.exited).toBe(0)
  }, 30_000)

  test('reading writes nothing: no entry, and the database file untouched', async () => {
    const before = await count()
    const touched = statSync(join(site, 'site.sqlite')).mtimeMs
    expect(cli(['audit', 'list']).code).toBe(0)
    expect(cli(['audit', 'stream']).code).toBe(0)
    expect(await count()).toBe(before)
    expect(statSync(join(site, 'site.sqlite')).mtimeMs).toBe(touched)
  })
})
