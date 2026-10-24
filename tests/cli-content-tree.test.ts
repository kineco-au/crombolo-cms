/**
 * Story 165: moving, copying, sorting and deleting pages and media from the
 * command line, driven through the CLI against a SQLite site of its own. What the
 * operations decide is tested on both dialects in content-tree.test.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ObjectTypes } from '@crombolo/core'
import {
  AuditLog,
  ComponentRepository,
  ContentTypeRepository,
  connect,
  currentSchemaState,
  type Db,
  DocumentRepository,
  ensureSystemMediaTypes,
  NodeRepository,
  RedirectRepository,
} from '@crombolo/data'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
let site: string

const env = () => ({
  ...process.env,
  CROMBOLO_DB: 'sqlite',
  CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
  CROMBOLO_MEDIA_DIR: join(site, 'media'),
  CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
  CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
  CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
  CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
})

function cli(args: string[]) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: site, env: env(), stdin: 'ignore' })
  const out = proc.stdout.toString()
  const err = proc.stderr.toString()
  return {
    code: proc.exitCode,
    out,
    err,
    json: <T>() => JSON.parse(out) as T,
    envelope: () =>
      (JSON.parse(err.trim().split('\n').at(-1) ?? '{}') as { error?: Record<string, unknown> })
        .error ?? {},
  }
}

/** The site's database, opened beside the CLI: nothing else has it open. */
async function withDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
  try {
    return await work(db)
  } finally {
    await db.close()
  }
}

const TYPE = (alias: string, name: string, extra: string) => `[content-type]
alias = "${alias}"
name = "${name}"
${extra}
components = ["page"]
default-component = "page"
`

type Item = { key: string; name: string; changed: boolean }
const keys: Record<string, string> = {}

/** The names under a page, in their order; `null` for the top level. */
const namesUnder = (parent: string | null, objectType: string = ObjectTypes.Document) =>
  withDb(async (db) => {
    const nodes = new NodeRepository(db)
    const id = parent ? (await nodes.byKey(parent))?.id : -1
    const page = await nodes.children(id as number, objectType, 0, 100)
    return page.items.map((node) => node.text)
  })

const audited = (key: string, action: string) =>
  withDb(async (db) =>
    (await new AuditLog(db).query({ entityKey: key }, { skip: 0, take: 50 })).items.filter(
      (entry) => entry.action === action,
    ),
  )

beforeAll(async () => {
  site = mkdtempSync(join(process.cwd(), 'output', 'cli-content-tree-'))
  mkdirSync(join(site, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(site, 'components'), { recursive: true })
  writeFileSync(join(site, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(
    join(site, 'schema', 'content-types', 'page.toml'),
    TYPE('page', 'Page', 'allow-at-root = true\nallow-children = ["page", "post"]'),
  )
  writeFileSync(join(site, 'schema', 'content-types', 'post.toml'), TYPE('post', 'Post', ''))
  writeFileSync(join(site, 'components', 'page.tsx'), 'export default () => <main />\n')
  const synced = cli(['types', 'sync'])
  expect(synced.code, synced.err).toBe(0)

  await withDb(async (db) => {
    // As a server's boot does: Folder holds the other built-in media types.
    await ensureSystemMediaTypes(db, { linkFolderChildren: true })
    const state = await currentSchemaState(db)
    const nodeState = { version: state.version, revision: state.revision }
    const docs = new DocumentRepository(db, { nodeState })
    const types = new ContentTypeRepository(db)
    const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
    const page = async (name: string, parent: string | null, type = 'page') => {
      const doc = await docs.create({
        key: crypto.randomUUID(),
        contentTypeKey: (await types.byAlias(type))?.key as string,
        componentKey,
        parentKey: parent ? (keys[parent] as string) : null,
        values: [],
        variants: [{ culture: null, segment: null, name }],
      })
      await docs.publish(doc.key, null)
      keys[name] = doc.key
    }
    await page('Home', null)
    for (const name of ['About', 'Team', 'Contact', 'Archive', 'Old', 'Older', 'Blog'])
      await page(name, 'Home')
    await page('Hello', 'Blog', 'post')

    const media = new DocumentRepository(db, { nodeState, kind: 'media' })
    const mediaTypes = new ContentTypeRepository(db, { kind: 'media' })
    const item = async (name: string, parent: string | null, type: string) => {
      const made = await media.create({
        key: crypto.randomUUID(),
        contentTypeKey: (await mediaTypes.byAlias(type))?.key as string,
        componentKey: null,
        parentKey: parent ? (keys[parent] as string) : null,
        values: [],
        variants: [{ culture: null, segment: null, name }],
      })
      keys[name] = made.key
    }
    await item('Brand', null, 'Folder')
    await item('Logo', null, 'Image')
    await item('Banner', null, 'Image')
  })
})
afterAll(() => rmSync(site, { recursive: true, force: true }))

describe('content move', () => {
  test('a dry run says what would move and moves nothing', async () => {
    const result = cli([
      'content',
      'move',
      '/Home/Older',
      '/Home/Old',
      '--to',
      '/Home/Archive',
      '--dry-run',
      '-o',
      'json',
    ])
    expect(result.code, result.err).toBe(0)
    expect(result.json<{ items: Item[]; changed: boolean }>()).toMatchObject({
      items: [
        { name: 'Older', changed: true },
        { name: 'Old', changed: true },
      ],
      changed: false,
    })
    expect(await namesUnder(keys.Archive as string)).toEqual([])
  })

  test('moves them in the order named, records each, and keeps their old addresses working', async () => {
    const result = cli(['content', 'move', '/Home/Older', '/Home/Old', '--to', '/Home/Archive'])
    expect(result.code, result.err).toBe(0)
    expect(result.out).toContain('moved  Older')
    expect(await namesUnder(keys.Archive as string)).toEqual(['Older', 'Old'])
    expect(await audited(keys.Old as string, 'Move')).toHaveLength(1)
    const redirects = await withDb((db) =>
      new RedirectRepository(db).byDocument(keys.Old as string, { take: 10 }),
    )
    expect(redirects.items.map((r) => r.pattern)).toContain('/old')

    const again = cli([
      'content',
      'move',
      '/Home/Archive/Old',
      '--to',
      '/Home/Archive',
      '-o',
      'json',
    ])
    expect(again.json<{ items: Item[]; changed: boolean }>()).toMatchObject({
      items: [{ name: 'Old', changed: false }],
      changed: false,
    })
  })

  test('refuses a page its new place does not allow, naming it, and moves none of them', async () => {
    const result = cli([
      'content',
      'move',
      '/Home/Team',
      '/Home/Blog/Hello',
      '--to',
      '/',
      '-o',
      'json',
    ])
    expect(result.code).toBe(ERROR_KINDS.refused.exitCode)
    const envelope = result.envelope()
    expect(envelope.message).toBe('1 of 2 page(s) cannot be moved there, so nothing was moved.')
    expect(JSON.stringify(envelope.details)).toContain(
      `Hello  \\"Post\\" isn't allowed at the top level.`,
    )
    expect(await namesUnder(null)).toEqual(['Home'])
  })

  test('a path that names nothing is not found', () => {
    expect(cli(['content', 'move', '/Home/Nowhere', '--to', '/']).code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
  })
})

describe('content copy', () => {
  test('copies a page and its branch to the top level as a draft', async () => {
    const dry = cli([
      'content',
      'copy',
      '/Home/Archive',
      '--to',
      '/',
      '--descendants',
      '--dry-run',
      '-o',
      'json',
    ])
    expect(dry.json<{ key: string | null }>().key).toBeNull()
    expect(await namesUnder(null)).toEqual(['Home'])

    const result = cli([
      'content',
      'copy',
      '/Home/Archive',
      '--to',
      '/',
      '--descendants',
      '-o',
      'json',
    ])
    expect(result.code, result.err).toBe(0)
    const copy = result.json<{ key: string; target: unknown; changed: boolean }>()
    expect(copy).toMatchObject({ target: null, changed: true })
    expect(await namesUnder(null)).toEqual(['Home', 'Archive'])
    expect(await namesUnder(copy.key)).toEqual(['Older', 'Old'])
  })

  test('refuses a post at the top level', () => {
    expect(cli(['content', 'copy', '/Home/Blog/Hello', '--to', '/']).code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
  })
})

describe('content sort', () => {
  test('the pages named come first, in order, and the rest keep theirs after them', async () => {
    const dry = cli(['content', 'sort', '/Home', 'Contact', 'Team', '--dry-run', '-o', 'json'])
    expect(dry.code, dry.err).toBe(0)
    expect(await namesUnder(keys.Home as string)).toEqual([
      'About',
      'Team',
      'Contact',
      'Archive',
      'Blog',
    ])

    const result = cli(['content', 'sort', '/Home', 'Contact', 'Team', '-o', 'json'])
    expect(result.code, result.err).toBe(0)
    expect(result.json<{ order: Array<{ name: string }>; changed: boolean }>()).toMatchObject({
      order: [
        { name: 'Contact' },
        { name: 'Team' },
        { name: 'About' },
        { name: 'Archive' },
        { name: 'Blog' },
      ],
      changed: true,
    })
    expect(await namesUnder(keys.Home as string)).toEqual([
      'Contact',
      'Team',
      'About',
      'Archive',
      'Blog',
    ])
    expect(await audited(keys.Home as string, 'Sort')).toHaveLength(1)
  })

  test('a child that is not under the parent, or is named twice, is a usage error', () => {
    expect(cli(['content', 'sort', '/Home', '/Home/Blog/Hello']).code).toBe(
      ERROR_KINDS.usage.exitCode,
    )
    expect(cli(['content', 'sort', '/Home', 'Nowhere']).code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(cli(['content', 'sort', '/Home', 'Team', 'team']).code).toBe(ERROR_KINDS.usage.exitCode)
  })
})

describe('content delete', () => {
  test('moves a page to the recycle bin; a second time changes nothing', async () => {
    const dry = cli(['content', 'delete', '/Home/Contact', '--dry-run'])
    expect(dry.code, dry.err).toBe(0)
    expect(await namesUnder(keys.Home as string)).toContain('Contact')

    const result = cli(['content', 'delete', '/Home/Contact', '-o', 'json'])
    expect(result.code, result.err).toBe(0)
    expect(result.json<{ changed: boolean }>().changed).toBe(true)
    expect(await namesUnder(keys.Home as string)).not.toContain('Contact')
    expect(await audited(keys.Contact as string, 'Trash')).toHaveLength(1)

    const again = cli(['content', 'delete', keys.Contact as string, '-o', 'json'])
    expect(again.json<{ items: Item[]; changed: boolean }>()).toMatchObject({
      items: [{ name: 'Contact', changed: false }],
      changed: false,
    })
  })
})

describe('media move and delete', () => {
  test('moves images into a folder, and refuses one into an image', async () => {
    const refused = cli(['media', 'move', '/Banner', '--to', '/Logo'])
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)

    const result = cli(['media', 'move', '/Logo', '/Banner', '--to', '/Brand', '-o', 'json'])
    expect(result.code, result.err).toBe(0)
    expect(await namesUnder(keys.Brand as string, ObjectTypes.Media)).toEqual(['Logo', 'Banner'])
    expect(await audited(keys.Logo as string, 'Move')).toHaveLength(1)
  })

  test('moves a folder and what is in it to the recycle bin', async () => {
    const result = cli(['media', 'delete', '/Brand', '-o', 'json'])
    expect(result.code, result.err).toBe(0)
    expect(await namesUnder(null, ObjectTypes.Media)).toEqual([])
    const trashed = await withDb(async (db) => new NodeRepository(db).byKey(keys.Logo as string))
    expect(trashed?.trashed).toBe(true)
  })
})
