/**
 * Story 376: a workspace's types over HTTP. With the `Crombolo-Workspace` header a
 * type or data type is read and saved in the workspace's own copy, taken from
 * Shared's files as it opened; its pages use it; a merge brings its files into
 * Shared, three ways, before its pages; "update from Shared" brings Shared's
 * later changes in; and every type and data-type operation is classified.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  WORKSPACE_OPERATIONS,
  WORKSPACE_REFUSALS,
  WORKSPACE_SHARED_SCHEMA_READS,
} from '@crombolo/api-management/domain'
import { listOperations, loadSpec } from '@crombolo/contracts'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

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

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

type TypeModel = { properties: Array<Record<string, unknown>> } & Record<string, unknown>

async function site(options: { writable?: boolean } = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-schema-api-'))
  dirs.push(root)
  const schemaDir = join(root, 'schema')
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(schemaDir, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(schemaDir, 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      schemaDir,
      componentsDir: join(root, 'components'),
      schemaWritable: options.writable ?? true,
      workspaces: true,
    },
  })
  open.push(h)
  const db = h.server.db
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const send = (method: string, path: string, body?: unknown, workspace?: string) =>
    h.call(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(workspace ? { 'crombolo-workspace': workspace } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string }
  }
  const readType = async (key: string, workspace?: string) => {
    const response = await send('GET', `${V1}/document-type/${key}`, undefined, workspace)
    return response.status === 200 ? ((await response.json()) as TypeModel) : undefined
  }
  /** The type with a property added, as the back office sends it. */
  const withProperty = (type: TypeModel, alias: string, name: string): TypeModel => ({
    ...type,
    properties: [
      ...type.properties,
      {
        ...(type.properties[0] as Record<string, unknown>),
        id: crypto.randomUUID(),
        alias,
        name,
        sortOrder: type.properties.length,
      },
    ],
  })
  const aliases = (type: TypeModel | undefined) => type?.properties.map((p) => p.alias)
  const page = async (name: string, values: Record<string, string>, workspace?: string) => {
    const created = await send(
      'POST',
      `${V1}/document`,
      {
        documentType: { id: typeKey },
        template: { id: componentKey },
        parent: null,
        values: Object.entries(values).map(([alias, value]) => ({
          alias,
          culture: null,
          segment: null,
          value,
        })),
        variants: [{ culture: null, segment: null, name }],
      },
      workspace,
    )
    expect(created.status).toBe(201)
    return created.headers.get('umb-generated-resource') as string
  }
  const valuesOf = async (key: string, workspace?: string) => {
    const response = await send('GET', `${V1}/document/${key}`, undefined, workspace)
    const body = (await response.json()) as { values: Array<{ alias: string; value: unknown }> }
    return Object.fromEntries(body.values.map((v) => [v.alias, v.value]))
  }
  const pageFile = () => readFileSync(join(schemaDir, 'content-types', 'page.toml'), 'utf8')
  return {
    h,
    db,
    schemaDir,
    typeKey,
    send,
    opened,
    readType,
    withProperty,
    aliases,
    page,
    valuesOf,
    pageFile,
  }
}

describe(`a workspace's types over HTTP (${dialectUnderTest})`, () => {
  test('a type saved with the header is the workspace’s, filled in on its pages, and merged with them', async () => {
    const { send, opened, readType, withProperty, aliases, typeKey, page, valuesOf, pageFile } =
      await site()
    const fileBefore = pageFile()
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    const saved = await send(
      'PUT',
      `${V1}/document-type/${typeKey}`,
      withProperty(own, 'subtitle', 'Subtitle'),
      sale.key,
    )
    expect(saved.status).toBe(200)
    expect(aliases(await readType(typeKey, sale.key))).toEqual(['title', 'summary', 'subtitle'])
    expect(aliases(await readType(typeKey))).toEqual(['title', 'summary'])
    expect(pageFile()).toBe(fileBefore)

    const files = await (await send('GET', `${WORKSPACES}/${sale.key}/files`)).json()
    expect(files).toMatchObject({
      changes: [{ path: 'content-types/page.toml', class: 'additive' }],
      conflicts: [],
    })

    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const document = (await (
      await send('GET', `${V1}/document/${home}`, undefined, sale.key)
    ).json()) as Record<string, unknown>
    const put = await send(
      'PUT',
      `${V1}/document/${home}`,
      {
        ...document,
        values: [
          { alias: 'title', culture: null, segment: null, value: 'Welcome' },
          { alias: 'summary', culture: null, segment: null, value: 'Hello' },
          { alias: 'subtitle', culture: null, segment: null, value: 'Spring' },
        ],
      },
      sale.key,
    )
    expect(put.status).toBe(200)
    expect(await valuesOf(home, sale.key)).toMatchObject({ subtitle: 'Spring' })
    expect(await valuesOf(home)).not.toHaveProperty('subtitle')

    const merged = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(merged.status).toBe(200)
    expect(aliases(await readType(typeKey))).toEqual(['title', 'summary', 'subtitle'])
    expect(pageFile()).toContain('alias = "subtitle"')
    expect(await valuesOf(home)).toMatchObject({ subtitle: 'Spring' })
  })

  test('a type made in the workspace, with a page of it, arrives in Shared at merge', async () => {
    const { db, send, opened, readType, typeKey, schemaDir } = await site()
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    const articleKey = crypto.randomUUID()
    const made = await send(
      'POST',
      `${V1}/document-type`,
      { ...own, id: articleKey, alias: 'article', name: 'Article', properties: [], containers: [] },
      sale.key,
    )
    expect(made.status).toBe(201)
    expect(await readType(articleKey, sale.key)).toBeDefined()
    expect(await readType(articleKey)).toBeUndefined()
    const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
    const news = await send(
      'POST',
      `${V1}/document`,
      {
        documentType: { id: articleKey },
        template: { id: componentKey },
        parent: null,
        values: [],
        variants: [{ culture: null, segment: null, name: 'News' }],
      },
      sale.key,
    )
    expect(news.status).toBe(201)
    const newsKey = news.headers.get('umb-generated-resource') as string

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(await readType(articleKey)).toBeDefined()
    expect(existsSync(join(schemaDir, 'content-types', 'article.toml'))).toBe(true)
    const read = await send('GET', `${V1}/document/${newsKey}`)
    expect(read.status).toBe(200)
    expect(((await read.json()) as { documentType: { id: string } }).documentType.id).toBe(
      articleKey,
    )
  })

  test('the same lines changed in Shared are a conflict, answered in the workspace', async () => {
    const { send, opened, readType, typeKey, pageFile } = await site()
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    expect(
      (await send('PUT', `${V1}/document-type/${typeKey}`, { ...own, name: 'Sale page' }, sale.key))
        .status,
    ).toBe(200)
    const shared = (await readType(typeKey)) as TypeModel
    expect(
      (await send('PUT', `${V1}/document-type/${typeKey}`, { ...shared, name: 'Plain page' }))
        .status,
    ).toBe(200)

    const refused = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { blockers: string[] }).blockers).toEqual([
      'The definition content-types/page.toml was changed in both the workspace and Shared.',
    ])
    const answered = await send('POST', `${WORKSPACES}/${sale.key}/files/resolve`, {
      path: 'content-types/page.toml',
      side: 'mine',
    })
    expect(answered.status).toBe(200)
    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(pageFile()).toContain('name = "Sale page"')
  })

  test('update from Shared brings Shared’s later change into the workspace', async () => {
    const { send, opened, readType, withProperty, aliases, typeKey } = await site()
    const sale = await opened('Spring sale')
    // Its first change builds its types from its copy; from then on they are frozen.
    const own = (await readType(typeKey, sale.key)) as TypeModel
    expect(
      (await send('PUT', `${V1}/document-type/${typeKey}`, { ...own, icon: 'icon-star' }, sale.key))
        .status,
    ).toBe(200)
    const shared = (await readType(typeKey)) as TypeModel
    expect(
      (await send('PUT', `${V1}/document-type/${typeKey}`, withProperty(shared, 'intro', 'Intro')))
        .status,
    ).toBe(200)
    expect(aliases(await readType(typeKey, sale.key))).toEqual(['title', 'summary'])
    const update = await send('POST', `${WORKSPACES}/${sale.key}/update`)
    expect(update.status).toBe(200)
    expect(aliases(await readType(typeKey, sale.key))).toEqual(['title', 'summary', 'intro'])
    expect((await readType(typeKey, sale.key))?.icon).toBe('icon-star')
  })

  test('discarding leaves Shared’s types and files as they were', async () => {
    const { send, opened, readType, withProperty, aliases, typeKey, pageFile } = await site()
    const fileBefore = pageFile()
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    await send(
      'PUT',
      `${V1}/document-type/${typeKey}`,
      withProperty(own, 'extra', 'Extra'),
      sale.key,
    )
    expect((await send('DELETE', `${WORKSPACES}/${sale.key}`)).status).toBe(204)
    expect(aliases(await readType(typeKey))).toEqual(['title', 'summary'])
    expect(pageFile()).toBe(fileBefore)
  })

  test('where the site’s files are read-only, a type is not saved in a workspace', async () => {
    const { send, opened, readType, withProperty, typeKey } = await site({ writable: false })
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    const saved = await send(
      'PUT',
      `${V1}/document-type/${typeKey}`,
      withProperty(own, 'subtitle', 'Subtitle'),
      sale.key,
    )
    expect(saved.status).toBe(409)
  })
})

describe(`a merge that removes or loses (${dialectUnderTest})`, () => {
  test('a property removed is accepted by name first, and its values are kept to come back', async () => {
    const { db, send, opened, readType, aliases, typeKey, page, valuesOf } = await site()
    const home = await page('Home', { title: 'Welcome', summary: 'Hello' })
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    const without = { ...own, properties: own.properties.filter((p) => p.alias !== 'summary') }
    expect((await send('PUT', `${V1}/document-type/${typeKey}`, without, sale.key)).status).toBe(
      200,
    )

    const preview = (await (await send('GET', `${WORKSPACES}/${sale.key}/merge`)).json()) as {
      files: { items: Array<{ id: string; class: string; accept: boolean }> }
    }
    expect(preview.files.items).toEqual([
      expect.objectContaining({
        id: 'property-retired:page.summary',
        class: 'additive',
        accept: true,
      }),
    ])
    const refused = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { blockers: string[] }).blockers[0]).toContain(
      'Accept "property-retired:page.summary"',
    )
    expect(
      (await send('POST', `${WORKSPACES}/${sale.key}/merge`, { accept: ['property-retired'] }))
        .status,
    ).toBe(200)
    expect(aliases(await readType(typeKey))).toEqual(['title'])
    expect(await valuesOf(home)).not.toHaveProperty('summary')
    // Retired, not lost: its values are still there, and come back with it.
    const kept = await db.q
      .selectFrom('property_type')
      .select('retired_at')
      .where('alias', '=', 'summary')
      .where('origin_key', 'is', null)
      .execute()
    expect(kept[0]?.retired_at).not.toBeNull()
  })

  test('an editor changed on a property pages use says how many pages hold a value', async () => {
    const { send, opened, readType, typeKey, page } = await site()
    await page('Home', { title: 'Welcome', summary: 'Hello' })
    await page('About', { title: 'About', summary: 'Us' })
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    const textarea = (
      (await (
        await send('GET', `${V1}/filter/data-type?editorAlias=Umbraco.TextArea&take=1`)
      ).json()) as {
        items: Array<{ id: string }>
      }
    ).items[0]?.id as string
    const changed = {
      ...own,
      properties: own.properties.map((p) =>
        p.alias === 'summary' ? { ...p, dataType: { id: textarea } } : p,
      ),
    }
    expect((await send('PUT', `${V1}/document-type/${typeKey}`, changed, sale.key)).status).toBe(
      200,
    )
    const refused = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    const blockers = ((await refused.json()) as { blockers: string[] }).blockers
    expect(blockers.join(' ')).toContain('2 page(s) hold a value for it.')
  })
})

describe(`a Shared delete of a type a workspace changed (${dialectUnderTest})`, () => {
  test('is refused, naming no workspace; forced, the workspace must settle it at merge', async () => {
    const { send, opened, readType, withProperty, typeKey } = await site()
    const sale = await opened('Spring sale')
    const own = (await readType(typeKey, sale.key)) as TypeModel
    await send(
      'PUT',
      `${V1}/document-type/${typeKey}`,
      withProperty(own, 'extra', 'Extra'),
      sale.key,
    )

    const refused = await send('DELETE', `${V1}/document-type/${typeKey}`)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).not.toContain('Spring sale')
    expect(await readType(typeKey)).toBeDefined()

    expect((await send('DELETE', `${V1}/document-type/${typeKey}?force=true`)).status).toBe(200)
    const merge = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(merge.status).toBe(409)
    expect(((await merge.json()) as { blockers: string[] }).blockers).toEqual([
      'The definition content-types/page.toml was changed in both the workspace and Shared.',
    ])
  })
})

describe('the workspace header on type, data-type and file operations', () => {
  test('is classified for every one', () => {
    const unclassified = listOperations(loadSpec())
      .map((o) => o.operationId)
      .filter((id) =>
        /DocumentType|MediaType|MemberType|DataType|PartialView|Stylesheet|Script|Template/.test(
          id,
        ),
      )
      .filter((id) => id !== 'GetLogViewerMessageTemplate')
      .filter(
        (id) =>
          !WORKSPACE_OPERATIONS.has(id) &&
          !WORKSPACE_REFUSALS.has(id) &&
          !WORKSPACE_SHARED_SCHEMA_READS.has(id),
      )
    expect(unclassified).toEqual([])
  })
})
