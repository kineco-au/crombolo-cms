/**
 * Story 408: a workspace's errors are kept for every node. A page that fails in a
 * check, or when asked for by name, is noted with the node that rendered it; another
 * node answers the same list, `since` included; only the newest are kept; a merged or
 * discarded workspace keeps none; and a note that cannot be written fails nothing.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComponentRepository,
  ContentTypeRepository,
  type Db,
  WorkspaceErrorRepository,
  WorkspaceRepository,
} from '@crombolo/data'
import { createWorkspaceChecks } from '../packages/server/src/workspace-checks.ts'
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

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
type Noted = { at: string; node: string; page: string; says: string }

async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-errors-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(
    join(root, 'schema', 'content-types', 'page.toml'),
    '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n',
  )
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "export default ({ model }) => {\n  if (model.text('title') === 'Boom') throw new Error('boom went the page')\n  return <main />\n}\n",
  )
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
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
  const created = await send('POST', `${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [{ alias: 'title', culture: null, segment: null, value: 'Welcome' }],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status).toBe(201)
  const home = created.headers.get('umb-generated-resource') as string
  const publish = (workspace?: string) =>
    send(
      'PUT',
      `${V1}/document/${home}/publish`,
      { publishSchedules: [{ culture: null }] },
      workspace,
    )
  expect((await publish()).status).toBe(200)

  /** A workspace whose home page throws as it renders. */
  const broken = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    const { key } = (await response.json()) as { key: string }
    const document = (await (
      await send('GET', `${V1}/document/${home}`, undefined, key)
    ).json()) as Record<string, unknown>
    expect(
      (
        await send(
          'PUT',
          `${V1}/document/${home}`,
          {
            ...document,
            values: [{ alias: 'title', culture: null, segment: null, value: 'Boom' }],
          },
          key,
        )
      ).status,
    ).toBe(200)
    expect((await publish(key)).status).toBe(200)
    return key
  }
  const errors = async (key: string, since?: string) =>
    (
      (await (
        await send(
          'GET',
          `${WORKSPACES}/${key}/errors${since ? `?since=${encodeURIComponent(since)}` : ''}`,
        )
      ).json()) as { items: Noted[] }
    ).items
  /** The same workspace's checks as another node would hold them. */
  const otherNode = (handle: Db = db) =>
    createWorkspaceChecks({
      db: handle,
      nodeId: 'another-node',
      merge: () => undefined,
      schema: () => undefined,
      render: async () => ({ status: 'ok' }),
      urlOf: async () => undefined,
    })
  return { h, db, send, home, broken, errors, otherNode }
}

describe(`a workspace's errors, for the whole site (${dialectUnderTest})`, () => {
  test('a page that fails in a check or when asked for is noted, and another node answers it', async () => {
    const s = await site()
    const key = await s.broken('Spring sale')
    expect(await s.errors(key)).toEqual([])

    const checked = (await (await s.send('POST', `${WORKSPACES}/${key}/check`, {})).json()) as {
      ok: boolean
    }
    expect(checked.ok).toBe(false)
    const first = await s.errors(key)
    expect(first).toEqual([
      expect.objectContaining({ page: '/', says: expect.stringContaining('boom went the page') }),
    ])
    expect(first[0]?.node).toBeTruthy()

    const asked = await s.send('GET', `${WORKSPACES}/${key}/render?path=/`)
    expect(((await asked.json()) as { status: string }).status).toBe('error')
    expect(await s.errors(key)).toHaveLength(2)

    const workspace = (await new WorkspaceRepository(s.db).byKey(key)) as { key: string }
    const elsewhere = s.otherNode()
    expect(await elsewhere.errors(workspace as never)).toHaveLength(2)
    await Bun.sleep(10)
    const later = new Date().toISOString()
    await elsewhere.note(workspace, '/about', 'It answered notFound.')
    const all = await s.errors(key)
    expect(all.map((e) => e.page)).toEqual(['/', '/', '/about'])
    expect(all.at(-1)?.node).toBe('another-node')
    expect(await s.errors(key, later)).toEqual([
      expect.objectContaining({ page: '/about', node: 'another-node' }),
    ])
  }, 30_000)

  test('only the newest are kept, and a merged or discarded workspace keeps none', async () => {
    const s = await site()
    const key = await s.broken('Spring sale')
    const kept = new WorkspaceErrorRepository(s.db)
    for (let n = 1; n <= 5; n++)
      await kept.note(key, { node: 'a', page: `/${n}`, says: 'no' }, new Date(), 3)
    expect((await kept.of(key)).map((e) => e.page)).toEqual(['/3', '/4', '/5'])

    const other = await s.broken('Summer')
    await kept.note(other, { node: 'a', page: '/', says: 'no' })
    expect((await s.send('DELETE', `${WORKSPACES}/${key}`)).status).toBeLessThan(300)
    await Bun.sleep(50)
    expect(await kept.of(key)).toEqual([])
    expect(await kept.of(other)).toHaveLength(1)
  }, 30_000)

  test('a note that cannot be written fails nothing', async () => {
    const s = await site()
    const down = {
      q: {
        insertInto() {
          throw new Error('the database is away')
        },
      },
    } as unknown as Db
    await expect(
      s.otherNode(down).note({ key: crypto.randomUUID() }, '/', 'no'),
    ).resolves.toBeUndefined()
  }, 30_000)
})
