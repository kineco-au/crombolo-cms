/**
 * Story 380: a workspace merges into Shared all or nothing. Fields only one side
 * changed come from that side; a field both changed is a conflict, answered in
 * the workspace; what it published is published; its moves and deletes are done
 * where Shared has not moved on; and the workspace is closed, holding nothing.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  previewWorkspaceMerge,
  runWorkspaceMerge,
  SILENT,
  systemActor,
  type WorkspaceMergeOptions,
} from '@crombolo/content'
import {
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
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
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-merge-'))
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

const MERGER = crypto.randomUUID()

const merge = (
  h: Harness,
  ws: Parameters<typeof runWorkspaceMerge>[0],
  more: Partial<WorkspaceMergeOptions> = {},
) =>
  runWorkspaceMerge(ws, {
    db: h.server.db,
    repository: { nodeState: h.server.schema.nodeState },
    events: SILENT,
    actor: systemActor('test'),
    userKey: MERGER,
    ...more,
  })

describe(`merging a workspace (${dialectUnderTest})`, () => {
  test('takes each field from the side that changed it, and closes the workspace', async () => {
    const { h, db, shared, workspaces, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale on', summary: 'Hello' }))
    await shared.update(input(home, 'Home', { title: 'Welcome', summary: 'Hi there' }))

    const outcome = await merge(h, sale)
    expect(outcome).toMatchObject({ ok: true, merged: [{ key: home, published: false }] })
    expect(await valuesOf(shared, home)).toEqual({ title: 'Sale on', summary: 'Hi there' })
    expect(await workspaces.byKey(sale.key)).toMatchObject({ state: 'merged', mergedBy: MERGER })
    expect(await workspaces.changes(sale.id)).toEqual([])
    const left = await db.q
      .selectFrom('content_version')
      .select('id')
      .where('workspace_id', '=', sale.id)
      .execute()
    expect(left).toEqual([])
  })

  test('a field both changed is a conflict, nothing is written, and an answer lets it go', async () => {
    const { h, shared, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale on', summary: 'Hello' }))
    await shared.update(input(home, 'Home', { title: 'Hello world', summary: 'Hello' }))

    const plan = await previewWorkspaceMerge(h.server.db, undefined, sale)
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        key: home,
        field: 'title||',
        mine: 'Sale on',
        theirs: 'Hello world',
      }),
    ])
    const refused = await merge(h, sale)
    expect(refused.ok).toBe(false)
    expect(await valuesOf(shared, home)).toEqual({ title: 'Hello world', summary: 'Hello' })

    await sale.docs.rebaseWorkspacePage(home, { 'title||': 'theirs' })
    expect(await valuesOf(sale.docs, home)).toEqual({ title: 'Hello world', summary: 'Hello' })
    expect((await merge(h, sale)).ok).toBe(true)
    expect(await valuesOf(shared, home)).toEqual({ title: 'Hello world', summary: 'Hello' })
  })

  test('keeping its own answer takes the workspace value', async () => {
    const { h, shared, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale on' }))
    await shared.update(input(home, 'Home', { title: 'Hello world' }))
    await sale.docs.rebaseWorkspacePage(home, { 'title||': 'mine' })
    expect((await merge(h, sale)).ok).toBe(true)
    expect(await valuesOf(shared, home)).toEqual({ title: 'Sale on' })
  })

  test('pages it made become Shared pages, parents first, published as it left them', async () => {
    const { h, shared, input, valuesOf, workspace } = await site()
    const sale = await workspace()
    const parent = await sale.docs.create(input(crypto.randomUUID(), 'Sale', { title: 'Sale' }))
    const child = await sale.docs.create(
      input(crypto.randomUUID(), 'Shoes', { title: 'Shoes' }, parent.key),
    )
    await sale.docs.publish(parent.key, null)
    expect(await shared.byKey(parent.key)).toBeUndefined()

    expect((await merge(h, sale)).ok).toBe(true)
    expect(await valuesOf(shared, parent.key)).toEqual({ title: 'Sale' })
    expect(await valuesOf(shared, child.key)).toEqual({ title: 'Shoes' })
    expect((await shared.byKeyPublished(parent.key))?.variants[0]?.name).toBe('Sale')
    expect(await shared.byKeyPublished(child.key)).toBeUndefined()
  })

  test('publishing what Shared left unpublished is accepted by name first', async () => {
    const { h, shared, input, page, workspace } = await site()
    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale on', summary: 'Hello' }))
    await sale.docs.publish(home, null)
    await shared.update(input(home, 'Home', { title: 'Welcome', summary: 'Draft' }))

    const refused = await merge(h, sale)
    expect(refused).toMatchObject({ ok: false })
    const finding = `publishes-shared-draft:${home}`
    expect(await merge(h, sale, { accepted: [finding] })).toMatchObject({ ok: true })
    const published = await shared.byKeyPublished(home)
    expect(Object.fromEntries((published?.values ?? []).map((v) => [v.alias, v.value]))).toEqual({
      title: 'Sale on',
      summary: 'Draft',
    })
  })

  test('a page a workflow covers is saved and left to be sent for approval', async () => {
    const { h, shared, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale on' }))
    await sale.docs.publish(home, null)
    const outcome = await merge(h, sale, {
      publishRefusal: async () => 'needs approval',
    })
    expect(outcome).toMatchObject({
      ok: true,
      forApproval: [{ key: home, action: 'publish', cultures: null }],
    })
    expect(await valuesOf(shared, home)).toEqual({ title: 'Sale on' })
    const live = await shared.byKeyPublished(home)
    expect(live?.values.find((v) => v.alias === 'title')?.value).toBe('Welcome')
  })

  test('its moves and deletes are done, unless Shared moved the page since', async () => {
    const { h, shared, page, workspace } = await site()
    const a = await page('A', { title: 'A' })
    const b = await page('B', { title: 'B' })
    const c = await page('C', { title: 'C' })
    const gone = await page('Gone', { title: 'Gone' })
    const sale = await workspace()
    await sale.docs.move(c, a)
    await sale.docs.delete(gone)
    // A deletion is accepted by a person first (story 382).
    expect(await merge(h, sale)).toMatchObject({
      ok: false,
      blockers: ['"Gone" is deleted. Accept "page-deleted" to go ahead.'],
    })
    expect((await merge(h, sale, { accepted: ['page-deleted'] })).ok).toBe(true)
    expect((await shared.nodes.byKey(c))?.parentId).toBe((await shared.nodes.byKey(a))?.id)
    expect(await shared.byKey(gone)).toBeUndefined()

    const rebrand = await workspace('Rebrand')
    await rebrand.docs.move(c, b)
    await shared.move(c, null)
    const refused = await merge(h, rebrand)
    expect(refused).toMatchObject({ ok: false, blockers: ['"C" was moved in Shared since.'] })
  })

  test('a page Shared deleted is a finding to accept, and its changes are not merged', async () => {
    const { h, shared, input, page, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale on' }))
    await shared.delete(home)
    const plan = await previewWorkspaceMerge(h.server.db, undefined, sale)
    expect(plan.findings).toEqual([expect.objectContaining({ name: 'Home' })])
    const id = plan.findings[0]?.id as string
    expect((await merge(h, sale)).ok).toBe(false)
    expect((await merge(h, sale, { accepted: [id] })).ok).toBe(true)
  })

  test('a rehearsal meets every refusal and writes nothing', async () => {
    const { h, shared, workspaces, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome' })
    const sale = await workspace()
    await sale.docs.update(input(home, 'Home', { title: 'Sale on' }))
    expect(await merge(h, sale, { rehearse: true })).toMatchObject({ ok: true, rehearsed: true })
    expect(await valuesOf(shared, home)).toEqual({ title: 'Welcome' })
    expect(await workspaces.byKey(sale.key)).toMatchObject({ state: 'open' })
  })
})
