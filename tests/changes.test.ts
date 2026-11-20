/**
 * Story 381: every change to a site is recorded. A merged workspace is a change,
 * with each file's text before and after and its pages; a type, data type or
 * file edited straight in Shared is a change by its author, one per person until
 * ten minutes pass; a file's versions are the changes that touched it, compared
 * with it now; and a revert is a change of its own, refused where something later
 * touched the same file, and able to reopen the work as a workspace.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ChangeRepository, ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

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

const CHANGES = `${BACKOFFICE}/crombolo/api/changes`

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const enc = encodeURIComponent

async function site(options: { components?: number } = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'changes-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components/parts', 'css', 'scripts'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "import Heading from './parts/heading.tsx'\nexport default () => <main><Heading /></main>\n",
  )
  writeFileSync(
    join(root, 'components', 'parts', 'heading.tsx'),
    'export default () => <h1>Welcome</h1>\n',
  )
  for (let n = 0; n < (options.components ?? 0); n++)
    writeFileSync(
      join(root, 'components', 'parts', `part-${n}.tsx`),
      `export default () => <p>${n}</p>\n`,
    )
  writeFileSync(join(root, 'css', 'site.css'), 'body { color: black; }\n')
  writeFileSync(join(root, 'package.json'), '{ "name": "site" }\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
      componentsCacheDir: join(root, '.cache', 'components'),
      schemaWritable: true,
      workspaces: true,
    },
  })
  open.push(h)
  const db = h.server.db
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
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const created = await send('POST', `${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status).toBe(201)
  const home = created.headers.get('umb-generated-resource') as string
  expect(
    (await send('PUT', `${V1}/document/${home}/publish`, { publishSchedules: [{ culture: null }] }))
      .status,
  ).toBe(200)
  const sharedPage = async () => (await h.server.fetch(new Request('http://localhost/'))).text()
  const rendered = async (workspace: string) =>
    (await (await send('GET', `${WORKSPACES}/${workspace}/render?path=/`)).json()) as {
      status: string
      html?: string
      views: string
    }
  const saveView = (path: string, content: string, workspace?: string) =>
    send('PUT', `${V1}/partial-view/${enc(path)}`, { content }, workspace)
  return { h, db, root, send, opened, sharedPage, rendered, saveView, home, typeKey }
}

type ChangeView = {
  id: string
  kind: string
  name: string | null
  madeBy: string | null
  files: Array<{ path: string; before: string | null; after: string | null; class: string }>
  pageChanges: Array<{ key: string; action: string }>
  pageEdits?: number
}

const list = async (h: Harness) =>
  (await h.json<{ items: Array<{ id: string; kind: string; name: string | null }> }>(CHANGES)).items
const detail = (h: Harness, id: string) => h.json<ChangeView>(`${CHANGES}/${id}`)

describe(`changes (${dialectUnderTest})`, () => {
  test('a merged workspace is a change, each file before and after, and its pages', async () => {
    const { h, send, opened, saveView, home } = await site()
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', 'export default () => <h1>Sale on</h1>\n', sale.key)
    const document = (await (
      await send('GET', `${V1}/document/${home}`, undefined, sale.key)
    ).json()) as Record<string, unknown>
    expect(
      (
        await send(
          'PUT',
          `${V1}/document/${home}`,
          { ...document, variants: [{ culture: null, segment: null, name: 'Sale home' }] },
          sale.key,
        )
      ).status,
    ).toBe(200)
    expect(
      (await send('POST', `${BACKOFFICE}/crombolo/api/workspaces/${sale.key}/merge`, {})).status,
    ).toBe(200)

    const [latest] = await list(h)
    expect(latest).toMatchObject({ kind: 'merge', name: 'Spring sale' })
    const change = await detail(h, latest?.id as string)
    expect(change.files).toEqual([
      expect.objectContaining({
        path: 'components/parts/heading.tsx',
        before: expect.stringContaining('Welcome'),
        after: expect.stringContaining('Sale on'),
      }),
    ])
    expect(change.pageChanges).toEqual([{ key: home, action: 'update' }])
  })

  test('a type, data type and file edited straight in Shared are a change by their author', async () => {
    const { h, send, typeKey, home } = await site()
    const me = (await h.json<{ id: string }>(`${V1}/user/current`)).id
    const type = (await (await send('GET', `${V1}/document-type/${typeKey}`)).json()) as Record<
      string,
      unknown
    >
    expect(
      (await send('PUT', `${V1}/document-type/${typeKey}`, { ...type, icon: 'icon-star' })).status,
    ).toBe(200)
    expect(
      (
        await send('PUT', `${V1}/stylesheet/${encodeURIComponent('/site.css')}`, {
          content: 'body { color: red; }\n',
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await send('PUT', `${V1}/stylesheet/${encodeURIComponent('/site.css')}`, {
          content: 'body { color: blue; }\n',
        })
      ).status,
    ).toBe(200)

    // One change for one person's edits within ten minutes, each file once.
    const edits = (await list(h)).filter((c) => c.kind === 'edit')
    expect(edits).toHaveLength(1)
    const change = await detail(h, edits[0]?.id as string)
    expect(change.madeBy).toBe(me)
    const css = change.files.find((f) => f.path === 'stylesheets/site.css')
    expect(css).toMatchObject({
      before: 'body { color: black; }\n',
      after: 'body { color: blue; }\n',
    })
    const page = change.files.find((f) => f.path === 'schema/content-types/page.toml')
    expect(page?.after).toContain('icon-star')
    expect(page?.before).not.toContain('icon-star')
    // Page edits made meanwhile are counted on it, not listed.
    const document = (await (await send('GET', `${V1}/document/${home}`)).json()) as Record<
      string,
      unknown
    >
    expect((await send('PUT', `${V1}/document/${home}`, document)).status).toBe(200)
    expect((await detail(h, edits[0]?.id as string)).pageEdits).toBeGreaterThan(0)
  })

  test('a person’s later edits, after ten minutes without, are a change of their own', async () => {
    const { h } = await site()
    const changes = new ChangeRepository(h.server.db)
    const at = new Date('2026-11-20T09:00:00Z')
    const first = await changes.recordEdit(
      'a',
      { path: 'stylesheets/a.css', kind: 'file-changed', class: 'none', before: 'x', after: 'y' },
      at,
    )
    const again = await changes.recordEdit(
      'a',
      { path: 'stylesheets/a.css', kind: 'file-changed', class: 'none', before: 'y', after: 'z' },
      new Date(at.getTime() + 5 * 60_000),
    )
    const later = await changes.recordEdit(
      'a',
      { path: 'stylesheets/a.css', kind: 'file-changed', class: 'none', before: 'z', after: 'w' },
      new Date(at.getTime() + 20 * 60_000),
    )
    expect(again).toBe(first)
    expect(later).not.toBe(first)
    expect((await changes.itemsOf(first))[0]).toMatchObject({ before: 'x', after: 'z' })
    expect((await changes.byId(first))?.closedAt).not.toBeNull()
  })

  test('a file’s versions are the changes that touched it, compared with it now', async () => {
    const { h, send, opened, saveView } = await site()
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', 'export default () => <h1>Sale on</h1>\n', sale.key)
    await send('POST', `${BACKOFFICE}/crombolo/api/workspaces/${sale.key}/merge`, {})
    await saveView('/parts/heading.tsx', 'export default () => <h1>Hello</h1>\n')
    const versions = await h.json<{ versions: Array<{ changeId: string; kind: string }> }>(
      `${CHANGES}/versions?path=${encodeURIComponent('components/parts/heading.tsx')}`,
    )
    expect(versions.versions.map((v) => v.kind)).toEqual(['merge', 'edit'])
    const compared = await h.json<{ version: string; current: string; same: boolean }>(
      `${CHANGES}/${versions.versions[0]?.changeId}/compare?path=${encodeURIComponent('components/parts/heading.tsx')}`,
    )
    expect(compared).toMatchObject({ same: false })
    expect(compared.version).toContain('Sale on')
    expect(compared.current).toContain('Hello')
  })

  test('a revert puts each file back as a change of its own, refused where something later touched it', async () => {
    const { h, root, send, opened, saveView } = await site()
    const heading = () => readFileSync(join(root, 'components', 'parts', 'heading.tsx'), 'utf8')
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', 'export default () => <h1>Sale on</h1>\n', sale.key)
    await send('POST', `${BACKOFFICE}/crombolo/api/workspaces/${sale.key}/merge`, {})
    const merged = (await list(h))[0]?.id as string
    await saveView('/parts/heading.tsx', 'export default () => <h1>Hello</h1>\n')
    const edit = (await list(h))[0]?.id as string

    const refused = await send('POST', `${CHANGES}/${merged}/revert`, {})
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { files: string[] }).files).toEqual([
      'components/parts/heading.tsx',
    ])

    expect((await send('POST', `${CHANGES}/${edit}/revert`, {})).status).toBe(200)
    expect(heading()).toContain('Sale on')
    const [revert] = await list(h)
    expect(revert).toMatchObject({ kind: 'revert' })
    // With the later edit undone, the merge can go back too, its work reopened as a workspace.
    const reopened = await send('POST', `${CHANGES}/${merged}/revert`, { toWorkspace: true })
    expect(reopened.status).toBe(200)
    expect(heading()).toContain('Welcome')
    const { workspace } = (await reopened.json()) as { workspace: string }
    const read = await send(
      'GET',
      `${V1}/partial-view/${encodeURIComponent('/parts/heading.tsx')}`,
      undefined,
      workspace,
    )
    expect(((await read.json()) as { content: string }).content).toContain('Sale on')
  })

  test('only an administrator reverts a change', async () => {
    const { h, saveView } = await site()
    await saveView('/parts/heading.tsx', 'export default () => <h1>Hello</h1>\n')
    const edit = (await list(h))[0]?.id as string
    const editor = await signInAsGroup(h, 'editor')
    const refused = await editor.call(`${CHANGES}/${edit}/revert`, { method: 'POST', body: '{}' })
    expect(refused.status).toBe(403)
  })

  test('with a workspace required, a type is changed only in one, and only by whom its permissions allow', async () => {
    const { h, send, typeKey } = await site()
    h.server.config.workspacesRequired = true
    const type = (await (await send('GET', `${V1}/document-type/${typeKey}`)).json()) as Record<
      string,
      unknown
    >
    expect(
      (await send('PUT', `${V1}/document-type/${typeKey}`, { ...type, icon: 'icon-star' })).status,
    ).toBe(409)
    expect(
      (await send('PUT', `${V1}/document-type/${typeKey}`, { ...type, icon: 'icon-star' }, 'mine'))
        .status,
    ).toBe(200)
    const writer = await signInAsGroup(h, 'writer')
    const refused = await writer.call(`${V1}/document-type/${typeKey}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'crombolo-workspace': 'mine' },
      body: JSON.stringify({ ...type, icon: 'icon-heart' }),
    })
    expect(refused.status).toBe(403)
  })
})
