/**
 * Story 375: a workspace's pages, changed apart from Shared. Opening one copies
 * nothing; what it changes it sees, and nothing else does: not Shared's reads,
 * revision, published pages or clean-up, and not another workspace. Discarding
 * it leaves no row behind.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  WorkspaceRefusedError,
  WorkspaceRepository,
} from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, signedInServer } from './support/harness.ts'

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
allow-children = ["page"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"

[[property]]
alias = "summary"
name = "Summary"
type = "textstring"
`

const OWNER = crypto.randomUUID()

async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspaces-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(h)
  const db = h.server.db
  const shared = new DocumentRepository(db, { nodeState: h.server.schema.nodeState })
  const workspaces = new WorkspaceRepository(db)
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const input = (
    key: string,
    name: string,
    values: Record<string, string>,
    parentKey: string | null = null,
  ) => ({
    key,
    contentTypeKey: typeKey,
    componentKey,
    parentKey,
    values: Object.entries(values).map(([alias, value]) => ({
      alias,
      culture: null,
      segment: null,
      value,
    })),
    variants: [{ culture: null, segment: null, name }],
  })
  const page = async (name: string, values: Record<string, string>, parentKey?: string) => {
    const made = await shared.create(input(crypto.randomUUID(), name, values, parentKey ?? null))
    await shared.publish(made.key, null)
    return made.key
  }
  const valuesOf = async (repo: DocumentRepository, key: string) =>
    Object.fromEntries(
      ((await repo.byKey(key))?.values ?? []).map((v) => [v.alias, v.value as string]),
    )
  const count = async (table: 'property_value' | 'content_version' | 'node') =>
    Number(
      (
        await db.q
          .selectFrom(table)
          .select((eb) => eb.fn.countAll().as('n'))
          .execute()
      )[0]?.n,
    )
  const workspace = async (name = 'Spring sale') => {
    const opened = await workspaces.open({ name, ownerKey: OWNER })
    return { ...opened, docs: shared.inWorkspace(opened.id) }
  }
  return { h, db, shared, workspaces, input, page, valuesOf, count, workspace }
}

describe(`a workspace (${dialectUnderTest})`, () => {
  test('opening one copies nothing', async () => {
    const { page, count, workspace, workspaces } = await site()
    await page('Home', { title: 'Welcome' })
    const before = [await count('property_value'), await count('content_version')]
    const opened = await workspace()
    expect([await count('property_value'), await count('content_version')]).toEqual(before)
    expect(await workspaces.forUser(OWNER)).toEqual([
      expect.objectContaining({ key: opened.key, name: 'Spring sale', memberKeys: [] }),
    ])
  })

  test('a page changed there reads changed there, and unchanged in Shared and in another', async () => {
    const { shared, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const revision = (await shared.byKey(home))?.revision
    const sale = await workspace()
    const other = await workspace('Rebrand')

    const saved = await sale.docs.update(
      input(home, 'Home (sale)', { title: 'Sale on', summary: 'Hello' }),
    )
    expect(saved?.variants[0]?.name).toBe('Home (sale)')
    expect(await valuesOf(sale.docs, home)).toEqual({ title: 'Sale on', summary: 'Hello' })
    expect(await valuesOf(shared, home)).toEqual({ title: 'Welcome', summary: 'Hello' })
    expect(await valuesOf(other.docs, home)).toEqual({ title: 'Welcome', summary: 'Hello' })
    expect((await shared.byKey(home))?.variants[0]?.name).toBe('Home')
    expect((await shared.nodes.byKey(home))?.text).toBe('Home')

    // A Shared editor's copy is not made stale by it, nor does Shared publish take from it.
    expect((await shared.byKey(home))?.revision).toBe(revision)
    await shared.update({
      ...input(home, 'Home', { title: 'Welcome back', summary: 'Hello' }),
      expectedRevision: revision,
    })
    await shared.publish(home, null)
    const published = await shared.byKeyPublished(home)
    expect(Object.fromEntries((published?.values ?? []).map((v) => [v.alias, v.value]))).toEqual({
      title: 'Welcome back',
      summary: 'Hello',
    })
    const cache = (await shared.loadPublished()).find((row) => row.key === home)
    expect(cache?.name).toBe('Home')
    expect(JSON.stringify(cache?.values)).not.toContain('Sale on')
    expect(JSON.stringify(await shared.loadCurrent({ keys: [home] }))).not.toContain('Sale on')
    expect(JSON.stringify(await shared.loadDrafts())).not.toContain('Sale on')

    // The workspace keeps its own copy of what it changed, over the Shared it started from.
    expect(await valuesOf(sale.docs, home)).toEqual({ title: 'Sale on', summary: 'Hello' })
  })

  test('an untouched page follows Shared, and two workspaces each hold a draft of one page', async () => {
    const { shared, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const about = await page('About', { title: 'About us' })
    const sale = await workspace()
    const other = await workspace('Rebrand')
    await shared.update(input(about, 'About', { title: 'About the shop' }))
    expect(await valuesOf(sale.docs, about)).toEqual({ title: 'About the shop' })

    await sale.docs.update(input(home, 'Home', { title: 'Sale' }))
    await other.docs.update(input(home, 'Home', { title: 'New brand' }))
    expect(await valuesOf(sale.docs, home)).toEqual({ title: 'Sale' })
    expect(await valuesOf(other.docs, home)).toEqual({ title: 'New brand' })
    expect(await valuesOf(shared, home)).toEqual({ title: 'Welcome' })
  })

  test("the workspace's own value wins, though a Shared row written later has a higher id", async () => {
    const { db, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale' }))
    // An upgrade's converted twin: the same Shared event as the base, appended after the workspace saved.
    const twin = await db.q
      .selectFrom('property_value')
      .selectAll()
      .where('workspace_id', 'is', null)
      .where('is_current', '=', db.dialect.boolValue(true) as boolean)
      .orderBy('id', 'desc')
      .limit(1)
      .execute()
    const { id: _, ...row } = twin[0] as Record<string, unknown>
    await db.q
      .insertInto('property_value')
      .values({ ...row, varchar_value: 'Welcome (converted)' } as never)
      .execute()
    expect(await valuesOf(sale.docs, home)).toEqual({ title: 'Sale' })
  })

  test('a page made there is found there and nowhere else', async () => {
    const { shared, input, page, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    const other = await workspace('Rebrand')
    const made = await sale.docs.create(
      input(crypto.randomUUID(), 'Offers', { title: 'Offers' }, home),
    )
    expect(made.variants[0]?.name).toBe('Offers')
    expect((await sale.docs.byKey(made.key))?.values).toEqual([
      expect.objectContaining({ alias: 'title', value: 'Offers' }),
    ])
    expect((await sale.docs.children(home, 0, 10)).items.map((n) => n.key)).toEqual([made.key])

    expect(await shared.byKey(made.key)).toBeUndefined()
    expect(await other.docs.byKey(made.key)).toBeUndefined()
    expect((await shared.children(home, 0, 10)).total).toBe(0)
    expect((await other.docs.children(home, 0, 10)).total).toBe(0)
    expect(await shared.loadCurrent({ keys: [made.key] })).toEqual([])
    expect((await shared.loadDrafts()).map((row) => row.key)).not.toContain(made.key)
  })

  test('publishing there publishes there only', async () => {
    const { db, shared, input, page, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    const made = await sale.docs.create(
      input(crypto.randomUUID(), 'Offers', { title: 'Offers' }, home),
    )
    const published = await sale.docs.publish(made.key, null)
    expect(published?.published).toBe(true)
    expect(published?.variants[0]?.state).toBe('Published')
    await sale.docs.update(input(home, 'Home', { title: 'Sale' }))
    await sale.docs.unpublish(home, null)
    expect((await sale.docs.byKey(home))?.published).toBe(false)

    expect((await shared.byKey(home))?.published).toBe(true)
    expect((await shared.loadPublished()).map((row) => row.key)).toEqual([home])
    const published_ = await db.q
      .selectFrom('document_version')
      .select((eb) => eb.fn.countAll().as('n'))
      .where('published', '=', db.dialect.boolValue(true) as boolean)
      .execute()
    expect(Number(published_[0]?.n)).toBe(1)
  })

  test('moves, reorders and deletes of Shared pages wait for the merge', async () => {
    const { shared, input, page, workspace, workspaces } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const about = await page('About', { title: 'About' }, home)
    const contact = await page('Contact', { title: 'Contact' }, home)
    const sale = await workspace()
    const made = await sale.docs.create(input(crypto.randomUUID(), 'Offers', {}, home))
    expect(await sale.docs.move(about, null)).toBe('moved')
    expect(await sale.docs.sort(home, [{ key: contact, sortOrder: 0 }])).toBe('sorted')
    expect(await sale.docs.moveToRecycleBin(contact)).toBe(true)
    expect(await sale.docs.move(made.key, null)).toBe('moved')

    const children = (await shared.children(home, 0, 10)).items.map((n) => n.key)
    expect(children).toEqual([about, contact])
    expect((await shared.nodes.byKey(contact))?.trashed).toBe(false)
    expect((await sale.docs.children(null, 0, 10)).items.map((n) => n.key)).toEqual([
      home,
      made.key,
    ])
    expect((await workspaces.changes(sale.id)).map((c) => [c.name, c.kind])).toEqual([
      ['Offers', 'made'],
      ['About', 'move'],
      ['Contact', 'sort'],
      ['Contact', 'trash'],
    ])
    await expect(sale.docs.rollback('1')).rejects.toBeInstanceOf(WorkspaceRefusedError)
    await expect(sale.docs.copy(home, null, { includeDescendants: false })).rejects.toBeInstanceOf(
      WorkspaceRefusedError,
    )
  })

  test('clean-up keeps what a workspace reads; discarding it leaves no row behind', async () => {
    const { db, shared, input, page, valuesOf, count, workspace, workspaces } = await site()
    const home = await page('Home', { title: 'First' })
    const before = {
      values: await count('property_value'),
      versions: await count('content_version'),
      nodes: await count('node'),
    }
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale' }))
    await sale.docs.create(input(crypto.randomUUID(), 'Offers', { title: 'Offers' }, home))
    // Shared moves on, and its old events are cleared away, all but the one the workspace started from.
    for (const title of ['Second', 'Third']) await shared.update(input(home, 'Home', { title }))
    await shared.cleanupVersions(new Date(Date.now() + 400 * 86_400_000), {
      keepAllVersionsNewerThanDays: 0,
      keepLatestVersionPerDayForDays: 0,
    })
    expect(await valuesOf(sale.docs, home)).toEqual({ title: 'Sale' })

    await workspaces.discard(sale.id)
    expect(await workspaces.byKey(sale.key)).toBeUndefined()
    for (const table of [
      'property_value',
      'content_version',
      'node',
      'content_schedule',
      'workspace_document',
      'workspace_document_culture',
      'workspace_pending',
      'workspace_member',
    ] as const) {
      const rows = await db.q
        .selectFrom(table)
        .select((eb) => eb.fn.countAll().as('n'))
        .where('workspace_id', '=', sale.id)
        .execute()
      expect([table, Number(rows[0]?.n)]).toEqual([table, 0])
    }
    expect(await count('node')).toBe(before.nodes)
    expect(await count('property_value')).toBeGreaterThanOrEqual(before.values)
    expect(await valuesOf(shared, home)).toEqual({ title: 'Third' })
  })

  test("a Shared page deleted with a workspace's page beneath keeps that page, marked", async () => {
    const { shared, input, page, workspace, workspaces } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    const made = await sale.docs.create(input(crypto.randomUUID(), 'Offers', {}, home))
    await shared.delete(home)
    expect(await shared.byKey(home)).toBeUndefined()
    expect((await sale.docs.byKey(made.key))?.parentKey).toBeNull()
    expect(await workspaces.changes(sale.id)).toContainEqual(
      expect.objectContaining({ key: made.key, kind: 'orphaned' }),
    )
  })

  test('members are added and removed, and a person sees what they own or belong to', async () => {
    const { workspaces } = await site()
    const sale = await workspaces.open({ name: 'Sale', ownerKey: OWNER })
    const member = crypto.randomUUID()
    expect(await workspaces.addMember(sale.id, member)).toBe(true)
    expect(await workspaces.addMember(sale.id, member)).toBe(false)
    expect((await workspaces.forUser(member)).map((w) => w.key)).toEqual([sale.key])
    expect(await workspaces.removeMember(sale.id, member)).toBe(true)
    expect(await workspaces.forUser(member)).toEqual([])
    expect(await workspaces.forUser(crypto.randomUUID())).toEqual([])
  })
})
