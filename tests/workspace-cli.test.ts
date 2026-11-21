/**
 * Story 386: workspaces from the command line, on a site in a folder reached through
 * the remote protocol's own routes in the command's process. A change made here goes
 * into the person's own workspace; it is diffed, checked, rendered, its conflict listed
 * with the change that made the other side and settled, merged, and reverted; a
 * workspace is pushed to another site, and that site's changes pulled back. Every
 * command says where it acts, and its exit code says why it stopped.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, DocumentRepository } from '@crombolo/data'
import { seedKey } from '@crombolo/server'
import { OUTCOMES } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
let root: string
const siteA = () => join(root, 'a')
const siteB = () => join(root, 'b')

// Relative, so a command that moves into another site's folder opens that site's.
const env = (_site: string, workspaces = true) => ({
  ...process.env,
  CROMBOLO_DB: 'sqlite',
  CROMBOLO_SQLITE_FILE: 'site.sqlite',
  CROMBOLO_MEDIA_DIR: 'media',
  CROMBOLO_COMPONENTS_DIR: 'components',
  CROMBOLO_SCHEMA_DIR: 'schema',
  CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
  CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
  CROMBOLO_LOG_TO_CONSOLE: 'false',
  CROMBOLO_PROFILES_FILE: join(root, 'profiles'),
  CROMBOLO_WORKSPACES: workspaces ? 'true' : 'false',
  CROMBOLO_SCHEMA_WRITABLE: 'true',
})

function cli(site: string, args: string[], workspaces = true) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], {
    cwd: site,
    env: env(site, workspaces),
    stdin: 'ignore',
  })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}
const ok = (site: string, ...args: string[]) => {
  const run = cli(site, args)
  expect(run.code, `${args.join(' ')}\n${run.out}${run.err}`).toBe(0)
  return run
}
const json = <T>(site: string, ...args: string[]) =>
  JSON.parse(ok(site, ...args, '-o', 'json').out) as T

async function titleIn(site: string, key: string): Promise<unknown> {
  const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
  try {
    const doc = await new DocumentRepository(db, {
      nodeState: { version: '1.0.0', revision: '0' },
    }).byKey(key)
    return doc?.values.find((v) => v.alias === 'title')?.value
  } finally {
    await db.close()
  }
}

/** Shared's title changed straight in the database, as another person's edit would. */
async function sharedEdit(site: string, key: string, title: string) {
  const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
  try {
    const docs = new DocumentRepository(db, { nodeState: { version: '1.0.0', revision: '0' } })
    const doc = await docs.byKey(key)
    if (!doc) throw new Error('no page')
    await docs.update({
      key,
      contentTypeKey: doc.contentTypeKey,
      componentKey: doc.componentKey,
      parentKey: doc.parentKey,
      values: doc.values.map((v) => (v.alias === 'title' ? { ...v, value: title } : v)),
      variants: doc.variants.map((v) => ({ culture: v.culture, segment: v.segment, name: v.name })),
    })
    await docs.publish(key, null)
  } finally {
    await db.close()
  }
}

const HOME = () => seedKey('content/home')
type Listed = { where: string; items: Array<{ key: string; name: string; state: string }> }
const own = (site: string) =>
  json<Listed>(site, 'workspace', 'list').items.find((w) => w.name.startsWith('Changes by')) as {
    key: string
    name: string
  }

beforeAll(() => {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  root = mkdtempSync(join(process.cwd(), 'output', 'workspace-cli-'))
  mkdirSync(join(siteA(), 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(siteA(), 'components'), { recursive: true })
  writeFileSync(join(siteA(), 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(
    join(siteA(), 'schema', 'content-types', 'page.toml'),
    '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n',
  )
  writeFileSync(
    join(siteA(), 'components', 'page.tsx'),
    "export default ({ model }) => <main><h1>{model.text('title')}</h1></main>\n",
  )
  writeFileSync(join(siteA(), 'crombolo.config.ts'), 'export default {}\n')
  writeFileSync(
    join(siteA(), 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { jsx: 'react-jsx', jsxImportSource: '@crombolo/crombolo' },
    }),
  )
  const synced = cli(siteA(), ['types', 'sync'])
  expect(synced.code, synced.err).toBe(0)
  // Shared's first page, before workspaces: made with them off, so it is in Shared.
  const made = cli(
    siteA(),
    ['content', 'new', '/Home', '--type', 'page', '--set', 'title=Welcome', '--publish'],
    false,
  )
  expect(made.code, made.err).toBe(0)
  cpSync(siteA(), siteB(), { recursive: true })
  writeFileSync(join(root, 'profiles'), `[b]\npath = "${siteB()}"\n\n[a]\npath = "${siteA()}"\n`)
}, 120_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('workspaces from the command line', () => {
  test('a change here goes into your own workspace; diff, check and render it', async () => {
    ok(siteA(), 'content', 'update', '/Home', '--set', 'title=Spring sale', '--publish')
    expect(await titleIn(siteA(), HOME())).toBe('Welcome')
    const mine = own(siteA())
    expect(mine).toBeDefined()

    const status = json<{ where: string; changes: Array<{ name: string }> }>(
      siteA(),
      'workspace',
      'status',
      mine.key,
    )
    expect(status.where).toBe(`Crombolo › local › workspace ${mine.name}`)
    expect(status.changes.map((c) => c.name)).toEqual(['Home'])

    const diff = json<{
      pages: Array<{ fields: Array<{ field: string; mine: unknown; theirs: unknown }> }>
    }>(siteA(), 'workspace', 'diff', mine.key)
    expect(diff.pages[0]?.fields).toEqual([
      expect.objectContaining({ field: 'title||', mine: 'Spring sale', theirs: 'Welcome' }),
    ])
    const check = json<{ ok: boolean; pages: Array<{ ok: boolean }> }>(
      siteA(),
      'workspace',
      'check',
      mine.key,
    )
    expect(check.ok).toBe(true)
    expect(check.pages).toHaveLength(1)
    const rendered = json<{ status: string; html: string }>(
      siteA(),
      'workspace',
      'render',
      mine.key,
      '/',
      '--html',
    )
    expect(rendered.html).toContain('Spring sale')
  }, 120_000)

  test('a conflict is listed with the other change, settled with no prompt, and merged; a dry run changes nothing', async () => {
    const mine = own(siteA())
    await sharedEdit(siteA(), HOME(), 'Edited in Shared')
    const conflicted = cli(siteA(), ['workspace', 'conflicts', mine.key, '-o', 'json'])
    expect(conflicted.code).toBe(OUTCOMES.conflicts_found.code)
    const items = (
      JSON.parse(conflicted.out) as {
        items: Array<{ item: string; mine: unknown; theirs: unknown }>
      }
    ).items
    expect(items).toEqual([
      expect.objectContaining({
        item: `${HOME()}#title||`,
        mine: 'Spring sale',
        theirs: 'Edited in Shared',
      }),
    ])
    ok(siteA(), 'workspace', 'resolve', mine.key, items[0]?.item as string, '--mine')
    expect(cli(siteA(), ['workspace', 'conflicts', mine.key]).code).toBe(0)

    const dry = json<{ merged: boolean }>(siteA(), 'workspace', 'merge', mine.key, '--dry-run')
    expect(dry.merged).toBe(false)
    expect(await titleIn(siteA(), HOME())).toBe('Edited in Shared')
    const merged = json<{ merged: boolean }>(siteA(), 'workspace', 'merge', mine.key, '--yes')
    expect(merged.merged).toBe(true)
    expect(await titleIn(siteA(), HOME())).toBe('Spring sale')
  }, 120_000)

  test('changes lists the merge, and revert undoes it as a change of its own', async () => {
    const { items } = json<{ items: Array<{ id: string; kind: string }> }>(siteA(), 'changes')
    const merge = items.find((c) => c.kind === 'merge') as { id: string }
    expect(merge).toBeDefined()
    const reverted = json<{ reverted: boolean }>(siteA(), 'revert', merge.id, '--yes')
    expect(reverted.reverted).toBe(true)
    expect(await titleIn(siteA(), HOME())).toBe('Edited in Shared')
  }, 120_000)

  test('a workspace pushed to another site waits there to be merged; that site’s changes are pulled back', async () => {
    // The other site begins as this one is now, so the change applies there cleanly.
    rmSync(siteB(), { recursive: true, force: true })
    cpSync(siteA(), siteB(), { recursive: true })
    ok(siteA(), 'content', 'update', '/Home', '--set', 'title=Summer')
    const mine = own(siteA())
    const dry = json<{ workspace: string | null }>(
      siteA(),
      'workspace',
      'push',
      mine.key,
      '--to',
      'b',
    )
    expect(dry.workspace).toBeNull()
    const pushed = json<{ workspace: string }>(
      siteA(),
      'workspace',
      'push',
      mine.key,
      '--to',
      'b',
      '--yes',
    )
    expect(pushed.workspace).toMatch(/^[0-9a-f-]{36}$/)
    expect(await titleIn(siteB(), HOME())).toBe('Edited in Shared')
    ok(siteB(), 'workspace', 'merge', pushed.workspace, '--yes')
    expect(await titleIn(siteB(), HOME())).toBe('Summer')

    const pulled = json<{ applied: string[] }>(siteA(), 'workspace', 'pull', '--from', 'b', '--yes')
    expect(pulled.applied.length).toBeGreaterThan(0)
  }, 180_000)

  test('a site with workspaces off refuses the workspace commands by name', () => {
    const run = cli(siteA(), ['workspace', 'list'], false)
    expect(run.code).not.toBe(0)
    expect(run.out + run.err).toContain('not turned on')
  }, 60_000)
})
