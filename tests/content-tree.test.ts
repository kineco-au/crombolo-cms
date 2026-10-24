/**
 * Story 165: moving, copying, sorting and deleting pages and media, whoever asks.
 * An item goes only where its parent's type allows it, for the backoffice and the
 * command line alike; a selection is checked whole before any of it is written;
 * and media writes record their audit entry with the change.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMediaOperations,
  mediaAuditFor,
  mediaWebhookFor,
  operatorActor,
  systemActor,
  userActor,
} from '@crombolo/content'
import {
  DocumentPermissions as D,
  MediaPermissions as M,
  ROOT_ACCESS,
  type StartNodes,
} from '@crombolo/core'
import {
  AuditLog,
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  NodeRepository,
  RedirectRepository,
} from '@crombolo/data'
import { createMediaEventSink, siteDocumentOperations } from '@crombolo/server'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page", "post"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

/** A post sits under a page, never at the top, and holds nothing. */
const POST_TOML = `[content-type]
alias = "post"
name = "Post"
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'content-tree-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'schema', 'content-types', 'post.toml'), POST_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(h)
  const db = h.server.db
  const nodeState = h.server.schema.nodeState
  const docs = new DocumentRepository(db, { nodeState })
  const types = new ContentTypeRepository(db)
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const typeKey = async (alias: string) => (await types.byAlias(alias))?.key as string
  const input = async (name: string, parentKey: string | null, type = 'page') => ({
    key: crypto.randomUUID(),
    contentTypeKey: await typeKey(type),
    componentKey,
    parentKey,
    values: [{ alias: 'title', culture: null, segment: null, value: `${name} title` }],
    variants: [{ culture: null, segment: null, name }],
  })
  const page = async (name: string, parentKey: string | null, type = 'page', publish = true) => {
    const doc = await docs.create(await input(name, parentKey, type))
    if (publish) await docs.publish(doc.key, null)
    h.server.cache.invalidate()
    return doc.key
  }
  const { operations } = await siteDocumentOperations(db, h.server.config)
  const parentOf = async (key: string) => (await docs.byKey(key))?.parentKey ?? null
  const audit = async (key: string) =>
    (await new AuditLog(db).query({ entityKey: key }, { skip: 0, take: 50 })).items
  return { h, db, docs, input, page, operations, parentOf, audit, typeKey }
}

const group = (defaults: string[]) => ({
  key: 'g',
  alias: 'editors',
  defaults,
  granular: new Map(),
  properties: new Map(),
})

/** A user who may do everything to pages, and to media within `media`. */
const editor = (
  media: StartNodes = ROOT_ACCESS,
  verbs: string[] = [...Object.values(D), M.Update],
) =>
  userActor({
    id: crypto.randomUUID(),
    name: 'Ed',
    isAdmin: false,
    allowedSections: ['Umb.Section.Content', 'Umb.Section.Media'],
    hasAccessToAllLanguages: true,
    languages: [],
    startNodes: { document: ROOT_ACCESS, media },
    groups: [group(verbs)],
  })

describe('an item goes only where its parent allows it', () => {
  test('creating, moving, copying and restoring refuse a type the place does not allow', async () => {
    const { input, page, operations, parentOf } = await site()
    const home = await page('Home', null)
    const blog = await page('Blog', home)
    const post = await page('Hello', blog, 'post')

    const atTop = await operations.create(editor(), await input('Loose', null, 'post'))
    expect(atTop).toMatchObject({ ok: false, kind: 'invalid', status: 400 })
    if (!atTop.ok) expect(atTop.reason).toBe(`"Post" isn't allowed at the top level.`)
    const underPost = await operations.create(operatorActor('ci'), await input('Child', post))
    expect(underPost.ok).toBe(false)
    if (!underPost.ok) expect(underPost.reason).toBe(`"Page" isn't allowed under "Hello".`)

    const moved = await operations.move(editor(), post, null)
    expect(moved).toMatchObject({ ok: false, kind: 'invalid' })
    expect(await parentOf(post)).toBe(blog)
    expect((await operations.copy(editor(), post, null, { includeDescendants: false })).ok).toBe(
      false,
    )

    await operations.trash(editor(), post)
    expect((await operations.restore(editor(), post, null)).ok).toBe(false)
    // Back where it was is where it was allowed.
    expect((await operations.restore(editor(), post, undefined)).ok).toBe(true)
  })

  test('the system carries out what was already decided', async () => {
    const { input, operations } = await site()
    const made = await operations.create(systemActor('A form'), await input('Loose', null, 'post'))
    expect(made.ok).toBe(true)
  })

  test('the backoffice is refused too', async () => {
    const { h, typeKey } = await site()
    const response = await h.post(`${V1}/document`, {
      documentType: { id: await typeKey('post') },
      template: null,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Loose' }],
    })
    expect(response.status).toBe(400)
    expect(await response.text()).toContain(`isn't allowed at the top level`)
  })
})

describe('a selection is checked whole, then written in one go', () => {
  test('one page that cannot move stops them all, and says which and why', async () => {
    const { page, operations, parentOf } = await site()
    const home = await page('Home', null)
    const blog = await page('Blog', home)
    const about = await page('About', home)
    const post = await page('Hello', blog, 'post')
    const result = await operations.moveMany(operatorActor('ci'), [about, post], null)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('1 of 2 page(s) cannot be moved there, so nothing was moved.')
      expect(result.blocked).toEqual([
        { key: post, reasons: [`"Post" isn't allowed at the top level.`] },
      ])
    }
    expect(await parentOf(about)).toBe(home)
  })

  test('moves them in the order named, leaves one already there, and records each redirect', async () => {
    const { h, db, page, operations, parentOf, audit } = await site()
    const home = await page('Home', null)
    const archive = await page('Archive', home)
    const old = await page('Old', home)
    const older = await page('Older', home)
    const kept = await page('Kept', archive)

    const dry = await operations.moveMany(operatorActor('ci'), [older, old, kept], archive, {
      dryRun: true,
    })
    expect(dry).toEqual({ ok: true, changed: [older, old], unchanged: [kept] })
    expect(await parentOf(old)).toBe(home)

    const done = await operations.moveMany(operatorActor('ci'), [older, old, kept], archive)
    expect(done).toEqual({ ok: true, changed: [older, old], unchanged: [kept] })
    const children = await new NodeRepository(db).children(
      (await new NodeRepository(db).byKey(archive))?.id as number,
      (await new NodeRepository(db).byKey(old))?.objectType as string,
      0,
      10,
    )
    expect(children.items.map((n) => n.text)).toEqual(['Kept', 'Older', 'Old'])
    h.server.cache.invalidate()
    const redirects = await new RedirectRepository(db).byDocument(old, { take: 10 })
    expect(redirects.items.map((r) => r.pattern)).toContain('/old')
    expect((await audit(old)).find((e) => e.action === 'Move')).toMatchObject({
      source: 'cli',
      userName: 'ci',
    })
    expect((await audit(kept)).some((e) => e.action === 'Move')).toBe(false)
  })

  test('to the recycle bin: a page below another named goes with it, one already there stays', async () => {
    const { db, page, operations, audit } = await site()
    const home = await page('Home', null)
    const blog = await page('Blog', home)
    const first = await page('First', blog, 'post')
    const gone = await page('Gone', home)
    await operations.trash(operatorActor('ci'), gone)

    const dry = await operations.trashMany(operatorActor('ci'), [blog, first, gone], {
      dryRun: true,
    })
    expect(dry).toEqual({ ok: true, changed: [blog, first], unchanged: [gone] })
    expect((await new NodeRepository(db).byKey(blog))?.trashed).toBe(false)

    const done = await operations.trashMany(operatorActor('ci'), [blog, first, gone])
    expect(done).toEqual({ ok: true, changed: [blog, first], unchanged: [gone] })
    const nodes = new NodeRepository(db)
    expect((await nodes.byKey(blog))?.trashed).toBe(true)
    expect((await nodes.byKey(first))?.trashed).toBe(true)
    // Below the page that went, not a second item in the bin of its own.
    expect((await nodes.byKey(first))?.parentId).toBe((await nodes.byKey(blog))?.id as number)
    expect((await audit(blog)).filter((e) => e.action === 'Trash')).toHaveLength(1)
    expect((await audit(first)).filter((e) => e.action === 'Trash')).toHaveLength(0)
  })

  test('a user is refused a page they may not move, naming it', async () => {
    const { page, operations } = await site()
    const home = await page('Home', null)
    const about = await page('About', home)
    const result = await operations.moveMany(editor(ROOT_ACCESS, [D.Read]), [about], null)
    expect(result).toMatchObject({ ok: false, kind: 'forbidden', blocked: [{ key: about }] })
  })

  test('a dry run of a copy or a sort writes nothing', async () => {
    const { db, page, operations } = await site()
    const home = await page('Home', null)
    const a = await page('A', home)
    const b = await page('B', home)
    const before = (await new NodeRepository(db).byKey(a))?.sortOrder
    expect(
      await operations.copy(operatorActor('ci'), a, home, {
        includeDescendants: true,
        dryRun: true,
      }),
    ).toEqual({ ok: true, key: null })
    expect(
      await operations.sort(
        operatorActor('ci'),
        home,
        [
          { key: b, sortOrder: 0 },
          { key: a, sortOrder: 1 },
        ],
        { dryRun: true },
      ),
    ).toEqual({ ok: true })
    const nodes = new NodeRepository(db)
    expect((await nodes.byKey(a))?.sortOrder).toBe(before as number)
    const home_ = await nodes.byKey(home)
    expect(
      (await nodes.children(home_?.id as number, home_?.objectType as string, 0, 10)).total,
    ).toBe(2)
  })
})

describe('media goes through its own operations', () => {
  async function media() {
    const s = await site()
    const mediaTypes = new ContentTypeRepository(s.db, { kind: 'media' })
    const folderType = (await mediaTypes.byAlias('Folder'))?.key as string
    const imageType = (await mediaTypes.byAlias('Image'))?.key as string
    const removed: string[] = []
    const operations = createMediaOperations({
      db: s.db,
      repository: { nodeState: s.h.server.schema.nodeState },
      events: createMediaEventSink({}),
      files: { remove: async (path) => void removed.push(path) },
    })
    const item = (name: string, parentKey: string | null, type: string, file?: string) => ({
      key: crypto.randomUUID(),
      contentTypeKey: type,
      parentKey,
      values: file ? [{ alias: 'umbracoFile', culture: null, segment: null, value: file }] : [],
      variants: [{ culture: null, segment: null, name }],
    })
    const create = async (name: string, parentKey: string | null, type: string, file?: string) => {
      const made = await operations.create(systemActor('setup'), item(name, parentKey, type, file))
      if (!made.ok) throw new Error(made.reason)
      return made.key
    }
    return { ...s, operations, folderType, imageType, removed, item, create }
  }

  test('each write records its audit entry as the backoffice always has', async () => {
    const { operations, folderType, item, audit } = await media()
    const made = await operations.create(editor(), item('Brand', null, folderType))
    expect(made.ok).toBe(true)
    const key = (made as { key: string }).key
    expect(await audit(key)).toEqual([
      expect.objectContaining({
        category: 'media',
        action: 'Create',
        entityType: 'Media',
        entityName: 'Brand',
        userName: 'Ed',
        source: 'request',
      }),
    ])
  })

  test('an image holds nothing, and a folder may go anywhere', async () => {
    const { operations, folderType, imageType, create, item } = await media()
    const logo = await create('Logo', null, imageType)
    const brand = await create('Brand', null, folderType)
    const inside = await operations.create(operatorActor('ci'), item('Crop', logo, imageType))
    expect(inside.ok).toBe(false)
    if (!inside.ok) expect(inside.reason).toBe(`"Image" isn't allowed under "Logo".`)
    expect((await operations.move(operatorActor('ci'), brand, logo)).ok).toBe(false)
    expect((await operations.move(operatorActor('ci'), logo, brand)).ok).toBe(true)
  })

  test('a user needs the media verb, and works only within their media start nodes', async () => {
    const { operations, folderType, imageType, create } = await media()
    const mine = await create('Mine', null, folderType)
    const theirs = await create('Theirs', null, folderType)
    const logo = await create('Logo', mine, imageType)
    const scoped = editor({ root: false, keys: [mine] })
    expect((await operations.move(scoped, logo, theirs)).ok).toBe(false)
    expect(await operations.trash(editor(ROOT_ACCESS, [D.Read]), logo)).toMatchObject({
      ok: false,
      kind: 'forbidden',
    })
    expect((await operations.trash(scoped, logo)).ok).toBe(true)
  })

  test('a delete removes the files after the rows, and empties the bin once', async () => {
    const { operations, folderType, imageType, create, removed, audit, db } = await media()
    const brand = await create('Brand', null, folderType)
    await create('Logo', brand, imageType, '/media/ab/logo.png')
    expect(
      await operations.trashMany(operatorActor('ci'), [brand], { dryRun: true }),
    ).toMatchObject({ ok: true, changed: [brand] })
    expect((await new NodeRepository(db).byKey(brand))?.trashed).toBe(false)
    await operations.trash(operatorActor('ci'), brand)
    expect(removed).toEqual([])
    const emptied = await operations.emptyBin(operatorActor('ci'))
    expect(emptied).toEqual({ ok: true, deleted: 1 })
    expect(removed).toEqual(['/media/ab/logo.png'])
    expect((await audit(brand)).map((e) => e.action)).toEqual(
      expect.arrayContaining(['Trash', 'Delete']),
    )
  })

  test('through the backoffice, a media write is recorded once', async () => {
    const { h, create, folderType, imageType, audit } = await media()
    const brand = await create('Brand', null, folderType)
    const logo = await create('Logo', null, imageType)
    expect((await h.put(`${V1}/media/${logo}/move`, { target: { id: brand } })).status).toBe(200)
    expect((await audit(logo)).filter((e) => e.action === 'Move')).toHaveLength(1)
    const refused = await h.put(`${V1}/media/${brand}/move`, { target: { id: logo } })
    expect(refused.status).toBe(400)
  })

  test('saves and deletes raise the webhooks they always have', () => {
    expect(mediaWebhookFor({ type: 'saved', key: 'k' })).toEqual({
      alias: 'Umbraco.MediaSave',
      key: 'k',
    })
    expect(mediaWebhookFor({ type: 'deleted', key: 'k', name: null })?.alias).toBe(
      'Umbraco.MediaDelete',
    )
    expect(mediaWebhookFor({ type: 'moved', key: 'k' })).toBeUndefined()
    expect(mediaAuditFor({ type: 'trashed', key: 'k' }).action).toBe('Trash')
  })
})
