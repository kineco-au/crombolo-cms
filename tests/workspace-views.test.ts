/**
 * Story 377: a workspace's components, stylesheets and scripts. With the header
 * they are read and written in the workspace's own copy, taken as it opened; a
 * page rendered with its views shows its changes, and Shared's pages do not; a
 * file the site reads only as it starts is carried to the merge; and a merge
 * writes them where they live, refused where a component would break.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, WorkspaceFileRepository } from '@crombolo/data'
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
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-views-'))
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
  return { h, db, root, send, opened, sharedPage, rendered, saveView }
}

describe(`a workspace's views (${dialectUnderTest})`, () => {
  test('a changed component renders changed there, and Shared’s pages are as they were', async () => {
    const { root, opened, sharedPage, rendered, saveView } = await site()
    const sale = await opened('Spring sale')
    // Opening builds no tree; one that changed no view renders with Shared's.
    expect(existsSync(join(root, '.cache', 'components-workspaces', sale.key))).toBe(false)
    expect(await rendered(sale.key)).toMatchObject({ status: 'ok', views: 'shared' })

    const saved = await saveView(
      '/parts/heading.tsx',
      'export default () => <h1>Sale on</h1>\n',
      sale.key,
    )
    expect(saved.status).toBe(200)
    // The template that imports it is unchanged, and renders the changed one.
    const own = await rendered(sale.key)
    expect(own).toMatchObject({ status: 'ok', views: 'workspace' })
    expect(own.html).toContain('<h1>Sale on</h1>')
    expect(await sharedPage()).toContain('<h1>Welcome</h1>')
    expect(readFileSync(join(root, 'components', 'parts', 'heading.tsx'), 'utf8')).toContain(
      'Welcome',
    )

    // A second change renders at once, with nothing restarted.
    await saveView('/parts/heading.tsx', 'export default () => <h1>Last days</h1>\n', sale.key)
    expect((await rendered(sale.key)).html).toContain('<h1>Last days</h1>')
  })

  test('a component that does not compile is refused, saying where', async () => {
    const { opened, saveView } = await site()
    const sale = await opened('Spring sale')
    const refused = await saveView(
      '/parts/heading.tsx',
      'export default () => <h1>Sale</h1\n',
      sale.key,
    )
    expect(refused.status).toBe(400)
    expect(JSON.stringify(await refused.json())).toContain('line')
  })

  test('a stylesheet is read changed in the workspace only, and every node reads the same', async () => {
    const { db, root, send, opened } = await site()
    const sale = await opened('Spring sale')
    const path = `${V1}/stylesheet/${enc('/site.css')}`
    expect((await send('PUT', path, { content: 'body { color: red; }\n' }, sale.key)).status).toBe(
      200,
    )
    const read = async (workspace?: string) =>
      ((await (await send('GET', path, undefined, workspace)).json()) as { content: string })
        .content
    expect(await read(sale.key)).toContain('red')
    expect(await read()).toContain('black')
    expect(readFileSync(join(root, 'css', 'site.css'), 'utf8')).toContain('black')
    // The workspace's files are the database's: any node reads them.
    const kept = await new WorkspaceFileRepository(db).changes(
      Number(
        (await db.q.selectFrom('workspace').select('id').where('key', '=', sale.key).execute())[0]
          ?.id,
      ),
    )
    expect(kept.map((c) => c.path)).toEqual(['stylesheets/site.css'])
  })

  test('a merge writes them where they live, and a file the site reads at start takes effect there', async () => {
    const { root, send, opened, saveView } = await site()
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', 'export default () => <h1>Sale on</h1>\n', sale.key)
    const carried = await send('PUT', `${WORKSPACES}/${sale.key}/site-files`, {
      path: 'package.json',
      text: '{ "name": "site", "private": true }\n',
    })
    expect(carried.status).toBe(200)
    const files = (await (await send('GET', `${WORKSPACES}/${sale.key}/files`)).json()) as {
      changes: Array<{ path: string; takesEffect?: string }>
    }
    expect(files.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'components/parts/heading.tsx' }),
        expect.objectContaining({ path: 'site/package.json', takesEffect: 'at merge' }),
      ]),
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).not.toContain('private')

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(readFileSync(join(root, 'components', 'parts', 'heading.tsx'), 'utf8')).toContain(
      'Sale on',
    )
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('private')
  })

  test('a merge whose component would break against Shared’s is refused, saying where', async () => {
    const { send, opened, saveView } = await site()
    const sale = await opened('Spring sale')
    await saveView(
      '/page.tsx',
      "import Heading from './parts/missing.tsx'\nexport default () => <main><Heading /></main>\n",
      sale.key,
    )
    const refused = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    const blockers = ((await refused.json()) as { blockers: string[] }).blockers
    expect(blockers.some((b) => b.startsWith('A component would break: components/page.tsx'))).toBe(
      true,
    )
  })

  test('only an administrator carries a file the site reads at start', async () => {
    const { h, send, opened } = await site()
    const sale = await opened('Spring sale')
    const editor = await signInAsGroup(h, 'editor')
    await send('POST', `${WORKSPACES}/${sale.key}/members`, {
      userKey: (await editor.json<{ id: string }>(`${V1}/user/current`)).id,
    })
    const refused = await editor.call(`${WORKSPACES}/${sale.key}/site-files`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'package.json', text: '{}' }),
    })
    expect(refused.status).toBe(403)
  })
})

describe(`a workspace on a site of several thousand files (${dialectUnderTest})`, () => {
  test('opens by listing them, each text kept once whichever workspaces hold it', async () => {
    const { db, opened } = await site({ components: 3000 })
    const started = Date.now()
    await opened('One')
    const took = Date.now() - started
    await opened('Two')
    const count = async (table: 'file_blob' | 'workspace_file') =>
      Number(
        (
          await db.q
            .selectFrom(table)
            .select((eb) => eb.fn.countAll().as('n'))
            .execute()
        )[0]?.n,
      )
    // The texts the workspaces hold: a change keeps what else it records beside them.
    const texts = (await db.q.selectFrom('workspace_file').select('hash').distinct().execute())
      .length
    expect(texts).toBeGreaterThan(3000)
    expect(await count('workspace_file')).toBe(texts * 2)
    expect(await count('file_blob')).toBeLessThan(texts + 20)
    expect(took).toBeLessThan(30_000)
  }, 120_000)
})
