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
import { normaliseUuid } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository, PublicAccessRepository } from '@crombolo/data'
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
  notChecked: Array<{ kind: string; item: string; why: string; says: string }>
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
  // Story 418: a type with no template, as a headless site's are, and one only members see.
  writeFileSync(
    join(root, 'schema', 'content-types', 'headless.toml'),
    '[content-type]\nalias = "headless"\nname = "Headless"\nallow-at-root = true\n',
  )
  writeFileSync(
    join(root, 'schema', 'content-types', 'members.toml'),
    '[content-type]\nalias = "members"\nname = "Members"\nallow-at-root = true\ncomponents = ["members"]\ndefault-component = "members"\n',
  )
  writeFileSync(
    join(root, 'components', 'members.tsx'),
    'export default ({ member }) => <main>{member.roles.join()}</main>\n',
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
  /** A page of a type, published, with its template or none (story 418). */
  const made = async (alias: string, name: string, template: boolean) => {
    const type = (await new ContentTypeRepository(db).byAlias(alias))?.key as string
    const component = template ? (await new ComponentRepository(db).byAlias(alias))?.key : undefined
    const created = await send('POST', `${V1}/document`, {
      documentType: { id: type },
      ...(component ? { template: { id: component } } : {}),
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    const published = await send('PUT', `${V1}/document/${key}/publish`, {
      publishSchedules: [{ culture: null }],
    })
    expect(published.status, await published.clone().text()).toBe(200)
    return key
  }
  return { h, db, root, home, about, base, merged, saveView, rename, check, send, made }
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
    expect(checked?.notChecked).toEqual([
      {
        kind: 'page',
        item: '',
        why: 'over-the-limit',
        says: '1 more page(s), past the 1 one check renders.',
      },
    ])
  })

  test('a page with nothing to render is not checked, and a members-only page renders as a member (story 418)', async () => {
    const { h, db, home, check, made } = await site()
    const headless = await made('headless', 'Headless', false)
    const members = await made('members', 'Staff only', true)
    await new PublicAccessRepository(db).save({
      nodeKey: members,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    h.server.cache.invalidate()
    const whole = await check({ all: true })
    expect(whole.body.failures, JSON.stringify(whole.body.failures)).toEqual([])
    expect(whole.body.ok).toBe(true)
    expect(whole.body.notChecked).toContainEqual({
      kind: 'page',
      item: expect.any(String),
      why: 'no-template',
      says: '"Headless": Its type has no template, so there is nothing to render.',
    })
    expect(whole.body.pages.find((p) => p.key === normaliseUuid(members))?.ok).toBe(true)
    void headless
  })

  test('a page of a type with templates and none chosen fails, saying so (story 418)', async () => {
    const { check, made } = await site()
    await made('page', 'Bare', false)
    const whole = await check({ all: true })
    expect(whole.body.ok).toBe(false)
    expect(whole.body.failures).toContainEqual(
      expect.objectContaining({ kind: 'page', says: 'It has no template chosen.' }),
    )
    expect(JSON.stringify(whole.body)).not.toContain('It answered')
  })

  test('a workspace’s check passes a renamed page with no template, and notes no error (story 418)', async () => {
    const { h, send, rename, made } = await site()
    const headless = await made('headless', 'Headless', false)
    const opened = await send('POST', WORKSPACES, { name: 'Spring' })
    const { key } = (await opened.json()) as { key: string }
    await rename(headless, 'Renamed', key)
    const checked = (await (await send('POST', `${WORKSPACES}/${key}/check`, {})).json()) as Checked
    expect(checked.ok, JSON.stringify(checked.failures)).toBe(true)
    expect(checked.notChecked.map((n) => n.why)).toEqual(
      expect.arrayContaining(['no-template', 'at-start']),
    )
    const url = checked.pages.find((p) => p.key === normaliseUuid(headless))?.url
    expect(url).toBeTruthy()
    expect(
      (await send('GET', `${WORKSPACES}/${key}/render?path=${enc(url as string)}`)).status,
    ).toBe(200)
    const errors = (await (await send('GET', `${WORKSPACES}/${key}/errors`)).json()) as {
      items: unknown[]
    }
    expect(errors.items).toEqual([])
    void h
  })
})
