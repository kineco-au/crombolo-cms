/**
 * Story 376: a workspace's types, from its own copy of the schema files. A sync in
 * a workspace writes copies of its types and data types, under keys of their
 * own, which its pages read and write by; Shared's types, values and listings are
 * untouched, and discarding the workspace leaves nothing behind.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComponentRepository,
  ContentTypeRepository,
  DataTypeRepository,
  DocumentRepository,
  WorkspaceRepository,
} from '@crombolo/data'
import { loadSchemaDirectory, syncSchema } from '@crombolo/schema'
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
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-schema-'))
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
  return { h, db, root, shared, workspaces, input, page, valuesOf, count, workspace }
}

const WITH_SUBTITLE = `${PAGE_TOML}
[[property]]
alias = "subtitle"
name = "Subtitle"
type = "textstring"
`

const ARTICLE_TOML = `[content-type]
alias = "article"
name = "Article"
allow-at-root = true
components = ["page"]

[[property]]
alias = "body"
name = "Body"
type = "short"
`

const SEO_TOML = `[content-type]
alias = "seo"
name = "SEO"
is-element = true

[[property]]
alias = "metaTitle"
name = "Meta title"
type = "textstring"
`

const SHORT_TOML = `[data-type]
alias = "short"
name = "Short text"
editor = "Umbraco.TextBox"

[data-type.config]
maxChars = 40
`

/** Writes the workspace's files over a copy of the site's, and syncs them into its rows. */
async function syncIn(
  h: Harness,
  root: string,
  workspace: { id: number; key: string },
  files: Record<string, string>,
) {
  const dir = mkdtempSync(join(process.cwd(), 'output', 'workspace-schema-files-'))
  dirs.push(dir)
  cpSync(join(root, 'schema'), dir, { recursive: true })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const report = await syncSchema(
    h.server.db,
    loadSchemaDirectory(dir),
    { nodeId: 'test', version: '1.0.0', revision: '0' },
    { mode: 'development', workspace },
  )
  expect(report.action).toBe('applied')
  return report
}

describe(`a workspace's types (${dialectUnderTest})`, () => {
  test('a property added there is filled in on its pages, and is not in Shared', async () => {
    const { h, db, root, shared, input, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const sale = await workspace()
    await syncIn(h, root, sale, { 'content-types/page.toml': WITH_SUBTITLE })

    const sharedType = await new ContentTypeRepository(db).byAlias('page')
    const ownType = await new ContentTypeRepository(db).inWorkspace(sale).byAlias('page')
    expect(sharedType?.properties.map((p) => p.alias)).toEqual(['title', 'summary'])
    expect(ownType?.properties.map((p) => p.alias)).toEqual(['title', 'summary', 'subtitle'])
    // Read under the keys it stands for: the same type, the same properties.
    expect(ownType?.key).toBe(sharedType?.key)
    expect(ownType?.properties[0]?.key).toBe(sharedType?.properties[0]?.key)

    await sale.docs.update(
      input(home, 'Home', { title: 'Welcome', summary: 'Hello', subtitle: 'New' }),
    )
    expect(await valuesOf(sale.docs, home)).toEqual({
      title: 'Welcome',
      summary: 'Hello',
      subtitle: 'New',
    })
    expect(await valuesOf(shared, home)).toEqual({ title: 'Welcome', summary: 'Hello' })
  })

  test('a property changed there reads changed there, with Shared and its values as they were', async () => {
    const { h, db, root, shared, page, valuesOf, workspace } = await site()
    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const sale = await workspace()
    await syncIn(h, root, sale, {
      'content-types/page.toml': PAGE_TOML.replace('name = "Title"', 'name = "Headline"'),
    })
    const name = async (repo: ContentTypeRepository) =>
      (await repo.byAlias('page'))?.properties.find((p) => p.alias === 'title')?.name
    expect(await name(new ContentTypeRepository(db).inWorkspace(sale))).toBe('Headline')
    expect(await name(new ContentTypeRepository(db))).toBe('Title')
    // The workspace reads Shared's values through its copy.
    expect(await valuesOf(sale.docs, home)).toEqual({ title: 'Welcome', summary: 'Hello' })
    expect(await valuesOf(shared, home)).toEqual({ title: 'Welcome', summary: 'Hello' })
  })

  test('a new type and data type are its own: pages of it are made there, and none is offered outside', async () => {
    const { h, db, root, input, workspace } = await site()
    const sale = await workspace()
    await syncIn(h, root, sale, {
      'content-types/article.toml': ARTICLE_TOML,
      'data-types/short.toml': SHORT_TOML,
    })
    const types = new ContentTypeRepository(db)
    const article = await types.inWorkspace(sale).byAlias('article')
    expect(article).toBeDefined()
    expect(await types.byAlias('article')).toBeUndefined()
    expect((await types.allowedAtRoot(0, 100)).items.map((t) => t.alias)).not.toContain('article')
    expect(
      (await types.inWorkspace(sale).allowedAtRoot(0, 100)).items.map((t) => t.alias),
    ).toContain('article')
    const dataTypes = new DataTypeRepository(db)
    expect(await dataTypes.byAlias('short')).toBeUndefined()
    const short = await dataTypes.inWorkspace(sale).byAlias('short')
    expect(short?.values).toEqual([{ alias: 'maxChars', value: 40 }])
    expect(article?.properties[0]?.dataTypeKey).toBe(short?.key)

    const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
    const made = await sale.docs.create({
      ...input(crypto.randomUUID(), 'News', {}),
      contentTypeKey: article?.key as string,
      componentKey,
      values: [{ alias: 'body', culture: null, segment: null, value: 'Short' }],
    })
    expect((await sale.docs.byKey(made.key))?.contentTypeKey).toBe(article?.key)
    expect((await sale.docs.byKey(made.key))?.values.map((v) => v.value)).toEqual(['Short'])
  })

  test('compositions and allowed children are the workspace’s own', async () => {
    const { h, db, root, workspace } = await site()
    const sale = await workspace()
    await syncIn(h, root, sale, {
      'content-types/seo.toml': SEO_TOML,
      'content-types/article.toml': ARTICLE_TOML.replace('type = "short"', 'type = "textstring"'),
      'content-types/page.toml': PAGE_TOML.replace(
        'allow-children = ["page"]',
        'allow-children = ["page", "article"]\ncompositions = ["seo"]',
      ),
    })
    const types = new ContentTypeRepository(db)
    const own = await types.inWorkspace(sale).byAlias('page')
    const seo = await types.inWorkspace(sale).byAlias('seo')
    const article = await types.inWorkspace(sale).byAlias('article')
    expect(own?.compositions.map((c) => c.contentTypeKey)).toEqual([seo?.key as string])
    expect(own?.allowedContentTypes.map((c) => c.contentTypeKey)).toContain(article?.key)
    expect(
      (await types.inWorkspace(sale).allowedChildren(own?.key as string, 0, 10)).items.map(
        (t) => t.alias,
      ),
    ).toEqual(['page', 'article'])
    const sharedPage = await types.byAlias('page')
    expect(sharedPage?.compositions).toEqual([])
    expect(
      (await types.allowedChildren(sharedPage?.key as string, 0, 10)).items.map((t) => t.alias),
    ).toEqual(['page'])
  })

  test('discarding leaves no copy behind, and Shared as it was', async () => {
    const { h, db, root, workspaces, workspace } = await site()
    const sale = await workspace()
    await syncIn(h, root, sale, {
      'content-types/article.toml': ARTICLE_TOML,
      'data-types/short.toml': SHORT_TOML,
    })
    await workspaces.discard(sale.id)
    const left = await db.q
      .selectFrom('content_type')
      .select('node_id')
      .where('workspace_id', 'is not', null)
      .execute()
    expect(left).toEqual([])
    const dataLeft = await db.q
      .selectFrom('data_type')
      .select('node_id')
      .where('workspace_id', 'is not', null)
      .execute()
    expect(dataLeft).toEqual([])
    expect(await new ContentTypeRepository(db).byAlias('page')).toBeDefined()
  })
})
