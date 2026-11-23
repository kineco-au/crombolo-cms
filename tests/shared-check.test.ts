/**
 * Story 406: Shared checked as a whole since a change. Two merged workspaces that
 * break a page between them are found by a check from the change before both, though
 * each passed its own; a page nothing since affects is not rendered; a problem in a
 * view is a failure of its own; `all` renders every published page; no more than the
 * limit are rendered; and a change the site does not hold is refused.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { createSharedCheck } from '../packages/server/src/shared-check.ts'
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

const CHANGES = `${BACKOFFICE}/crombolo/api/changes`
const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const enc = encodeURIComponent

type Checked = {
  ok: boolean
  since: string | null
  upTo: string | null
  changes: number
  pages: Array<{ key: string; url: string; ok: boolean; because: string }>
  failures: Array<{ kind: string; item: string; says: string }>
  notChecked: string[]
}

async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'shared-check-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components/parts', 'css', 'scripts'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(
    join(root, 'schema', 'content-types', 'page.toml'),
    '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\nallow-children = ["page"]\ncomponents = ["page"]\ndefault-component = "page"\n',
  )
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "import Heading from './parts/heading.tsx'\nexport default () => <main><Heading /></main>\n",
  )
  writeFileSync(
    join(root, 'components', 'parts', 'heading.tsx'),
    "export default ({ text }) => <h1>{text === undefined ? 'Welcome' : text.shout()}</h1>\n",
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
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const page = async (name: string, parent: string | null) => {
    const created = await send('POST', `${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: parent ? { id: parent } : null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    expect(
      (
        await send('PUT', `${V1}/document/${key}/publish`, {
          publishSchedules: [{ culture: null }],
        })
      ).status,
    ).toBe(200)
    return key
  }
  const home = await page('Home', null)
  const about = await page('About', home)

  /** A change of its own to check from, later than everything before it. */
  const base = async () => {
    await Bun.sleep(20)
    expect(
      (
        await send('PUT', `${V1}/stylesheet/${enc('/site.css')}`, {
          content: `/* ${Date.now()} */\n`,
        })
      ).status,
    ).toBe(200)
    const newest = (await h.json<{ items: Array<{ id: string }> }>(CHANGES)).items[0]
    await Bun.sleep(20)
    return newest?.id as string
  }
  /** A workspace opened, changed and merged. */
  const merged = async (name: string, change: (workspace: string) => Promise<void>) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    const { key } = (await response.json()) as { key: string }
    await change(key)
    const own = (await (await send('POST', `${WORKSPACES}/${key}/check`, {})).json()) as Checked
    expect((await send('POST', `${WORKSPACES}/${key}/merge`, {})).status).toBe(200)
    await Bun.sleep(5)
    return own
  }
  const saveView = async (path: string, content: string, workspace: string) =>
    expect(
      (await send('PUT', `${V1}/partial-view/${enc(path)}`, { content }, workspace)).status,
    ).toBe(200)
  const rename = async (key: string, name: string, workspace: string) => {
    const document = (await (
      await send('GET', `${V1}/document/${key}`, undefined, workspace)
    ).json()) as Record<string, unknown>
    expect(
      (
        await send(
          'PUT',
          `${V1}/document/${key}`,
          { ...document, variants: [{ culture: null, segment: null, name }] },
          workspace,
        )
      ).status,
    ).toBe(200)
  }
  const check = async (body: unknown) => {
    const response = await send('POST', `${CHANGES}/check`, body)
    return { status: response.status, body: (await response.json()) as Checked }
  }
  return { h, db, root, home, about, base, merged, saveView, rename, check }
}

describe(`Shared checked since a change (${dialectUnderTest})`, () => {
  test('two merges that break a page between them are found, though each passed its own check', async () => {
    const { home, about, base, merged, saveView, check } = await site()
    const from = await base()
    const first = await merged('Titles', (workspace) =>
      saveView(
        '/page.tsx',
        "import Heading from './parts/heading.tsx'\nexport default ({ model }) => <main><Heading text={model.name} /></main>\n",
        workspace,
      ),
    )
    const second = await merged('Headings', (workspace) =>
      saveView(
        '/parts/heading.tsx',
        "export default ({ text }) => <h1>{text === undefined ? 'Hello' : text.shout()}</h1>\n",
        workspace,
      ),
    )
    expect(second.ok).toBe(true)
    expect(first.failures.filter((f) => f.kind === 'file')).toEqual([])

    const { status, body } = await check({ since: from })
    expect(status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.since).toBe(from)
    expect(body.changes).toBe(2)
    expect(body.upTo).not.toBe(from)
    expect(body.pages.map((p) => p.key).sort()).toEqual([home, about].sort())
    expect(body.pages.every((p) => p.because === 'template' && !p.ok)).toBe(true)
    expect(body.failures.map((f) => f.kind)).toEqual(['page', 'page'])
    expect(body.failures.map((f) => f.item).sort()).toEqual(['/', '/about'])
  })

  test('a page nothing since affects is not rendered', async () => {
    const { home, base, merged, rename, check } = await site()
    const from = await base()
    await merged('Home renamed', (workspace) => rename(home, 'Front page', workspace))
    const { body } = await check({ since: from })
    expect(body.ok).toBe(true)
    expect(body.pages).toEqual([
      expect.objectContaining({ key: home, url: '/', because: 'changed', ok: true }),
    ])
    const nothing = await check({ since: body.upTo })
    expect(nothing.body).toMatchObject({ ok: true, changes: 0, pages: [] })
  })

  test('all renders every published page, and a view that does not compile is a failure of its own', async () => {
    const { root, check } = await site()
    const whole = await check({ all: true })
    expect(whole.body.ok).toBe(true)
    expect(whole.body.since).toBeNull()
    expect(whole.body.pages.map((p) => p.url).sort()).toEqual(['/', '/about'])
    expect((await check({})).body.pages).toHaveLength(2)

    writeFileSync(join(root, 'components', 'parts', 'broken.tsx'), 'export default () => <p>\n')
    const broken = await check({ all: true })
    expect(broken.body.ok).toBe(false)
    expect(broken.body.failures).toContainEqual(
      expect.objectContaining({ kind: 'file', says: expect.stringContaining('broken.tsx') }),
    )
    expect(broken.body.failures.every((f) => f.kind === 'file')).toBe(true)
  })

  test('a change the site does not hold is refused, and one not named by an id', async () => {
    const { check } = await site()
    expect((await check({ since: crypto.randomUUID() })).status).toBe(404)
    expect((await check({ since: 'last week' })).status).toBe(400)
  })

  test('no more pages than the limit are rendered, and the rest are counted', async () => {
    const { db } = await site()
    const rendered: string[] = []
    const checked = await createSharedCheck({
      db,
      limit: 1,
      render: async (path) => {
        rendered.push(path)
        return { status: 'ok' }
      },
      page: async (key) => ({ url: `/${key}`, name: key }),
      problems: async () => [],
    }).check(undefined, true)
    expect(rendered).toHaveLength(1)
    expect(checked?.pages).toHaveLength(1)
    expect(checked?.notChecked).toEqual(['1 more page(s), past the 1 one check renders'])
  })
})
