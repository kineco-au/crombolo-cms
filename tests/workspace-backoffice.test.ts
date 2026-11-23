/**
 * Story 384: workspaces in the back office. The switch's choices, each workspace's
 * colour and the header a tab sends; a workspace's privacy, chosen by its owner; the
 * notice that another workspace changed a page, by whose, never what; dropping a
 * change; the trees' mark on what a workspace changed; and what the switch is told.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
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
allow-children = ["page"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

async function site(workspaces = true) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-backoffice-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      workspaces,
    },
  })
  open.push(h)
  const db = h.server.db
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const send = (who: Harness, method: string, path: string, body?: unknown, headers = {}) =>
    who.call(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const page = async (name: string, title: string, parent: string | null = null) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: parent ? { id: parent } : null,
      values: [{ alias: 'title', culture: null, segment: null, value: title }],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    expect(
      (
        await send(h, 'PUT', `${V1}/document/${key}/publish`, {
          publishSchedules: [{ culture: null }],
        })
      ).status,
    ).toBe(200)
    return key
  }
  const opened = async (who: Harness, name: string) => {
    const response = await send(who, 'POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string; name: string; memberKeys: string[] }
  }
  const inside = (key: string) => ({ 'crombolo-workspace': key })
  /** A page read, as the workspace sees it when one is named. */
  const read = async (who: Harness, key: string, workspace?: string) => {
    const response = await who.call(`${V1}/document/${key}`, {
      headers: workspace ? inside(workspace) : {},
    })
    return response
  }
  const titleOf = async (who: Harness, key: string, workspace?: string) =>
    (
      (await (await read(who, key, workspace)).json()) as {
        values: Array<{ alias: string; value: unknown }>
      }
    ).values.find((v) => v.alias === 'title')?.value
  /** Saves a page's title, from a copy read the same way. */
  const save = async (who: Harness, key: string, title: string, workspace?: string) => {
    const copy = await read(who, key, workspace)
    const document = (await copy.json()) as Record<string, unknown>
    return send(
      who,
      'PUT',
      `${V1}/document/${key}`,
      { ...document, values: [{ alias: 'title', culture: null, segment: null, value: title }] },
      { 'if-match': copy.headers.get('etag') as string, ...(workspace ? inside(workspace) : {}) },
    )
  }
  const count = async (table: 'content_event' | 'search_index_queue' | 'node_file') =>
    Number(
      (
        await db.q
          .selectFrom(table)
          .select((eb) => eb.fn.countAll().as('n'))
          .execute()
      )[0]?.n,
    )
  return { h, db, send, page, opened, inside, read, titleOf, save, count, typeKey, componentKey }
}

import {
  chooseWorkspace,
  colourOf,
  currentWorkspace,
  headerFor,
  inWorkspace,
  menuFor,
  onceKnown,
  PALETTE,
  WORKSPACE_HEADER,
} from '../packages/backoffice-host/plugin/workspace-client.js'

const memory = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as unknown as Storage
}

describe('the switch, in the browser', () => {
  test('a workspace’s colour comes from its key, the same each time, from the palette', () => {
    const key = '7b0f0c1e-1d2a-4f3b-9c4d-5e6f7a8b9c0d'
    expect(colourOf(key)).toBe(colourOf(key))
    expect(PALETTE as string[]).toContain(colourOf(key) as string)
  })

  test('the tab keeps its choice, and sends it; Shared looked at sends nothing', () => {
    const storage = memory()
    expect(currentWorkspace(storage)).toBeNull()
    chooseWorkspace({ key: 'abc', name: 'Sale' }, storage)
    expect(currentWorkspace(storage)).toEqual({ key: 'abc', name: 'Sale' })
    const api = 'http://local/umbraco/management/api/v1/document/x'
    expect(inWorkspace(false, storage)(new Request(api)).headers.get(WORKSPACE_HEADER)).toBe('abc')
    expect(
      inWorkspace(
        false,
        storage,
      )(new Request('http://local/umbraco/crombolo/api/x')).headers.has(WORKSPACE_HEADER),
    ).toBe(false)
    chooseWorkspace(null, storage)
    expect(headerFor(null, false)).toBeUndefined()
    expect(headerFor(null, true)).toBe('mine')
    expect(headerFor({ key: 'shared' } as never, true)).toBeUndefined()
  })

  test('a request waits for the server to say which workspace the tab works in', async () => {
    const storage = memory()
    chooseWorkspace({ key: 'abc', name: 'Sale' }, storage)
    const api = 'http://local/umbraco/management/api/v1/document/x'
    let answer: (mine: unknown) => void = () => {}
    const asked = new Promise((resolve) => {
      answer = resolve
    })
    let sent: Request | undefined
    const sending = onceKnown(
      asked,
      storage,
    )(new Request(api)).then((r: Request) => {
      sent = r
    })
    await Promise.resolve()
    expect(sent).toBeUndefined()
    answer({ enabled: true, required: false })
    await sending
    expect(sent?.headers.get(WORKSPACE_HEADER)).toBe('abc')
    // With workspaces off, or no answer, it goes as it is.
    const off = await onceKnown(Promise.resolve(undefined), storage)(new Request(api))
    expect(off.headers.has(WORKSPACE_HEADER)).toBe(false)
  })

  test('the menu offers Merge only to who may merge, and Share only to the owner', () => {
    const workspaces = [
      { key: 'a', name: 'Sale', state: 'open', member: true, mine: true },
      { key: 'b', name: 'Footer', state: 'open', member: true, mine: false },
      { key: 'c', name: 'Theirs', state: 'open', member: false, mine: false },
    ]
    const actions = (o: Record<string, unknown>) =>
      (
        menuFor({
          current: null,
          workspaces,
          mayMerge: true,
          changes: 0,
          required: false,
          ...o,
        } as never) as Array<{ action: string }>
      ).map((i) => i.action)
    expect(actions({})).toEqual(['shared', 'enter', 'enter', 'new', 'all'])
    expect(actions({ current: { key: 'a', name: 'Sale' }, changes: 2 })).toEqual([
      'shared',
      'enter',
      'enter',
      'new',
      'changes',
      'merge',
      'address',
      'share',
      'all',
    ])
    expect(actions({ current: { key: 'b', name: 'Footer' }, changes: 2, mayMerge: false })).toEqual(
      ['shared', 'enter', 'enter', 'new', 'changes', 'address', 'all'],
    )
  })
})

describe(`workspaces in the back office, on the server (${dialectUnderTest})`, () => {
  test('the switch is told whether workspaces are on and whether its person may merge', async () => {
    const { h } = await site()
    expect(await h.json(`${WORKSPACES}/mine`)).toMatchObject({ enabled: true, mayMerge: true })
    const off = await site(false)
    expect(await off.h.json(`${WORKSPACES}/mine`)).toMatchObject({
      enabled: false,
      mayMerge: false,
    })
  })

  test('its owner chooses who sees it: shown to every editor, it is read by them and changed by its members', async () => {
    const { h, send, opened, page, save } = await site()
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    expect((await save(h, home, 'Sale on', sale.key)).status).toBe(200)
    const writer = await signInAsGroup(h, 'writer')
    expect((await writer.call(`${WORKSPACES}/${sale.key}`)).status).toBe(404)
    const shown = await send(h, 'PATCH', `${WORKSPACES}/${sale.key}`, { visibility: 'editors' })
    expect(await shown.json()).toMatchObject({ visibility: 'editors' })
    const listed = await writer.json<{ items: Array<{ key: string; member: boolean }> }>(WORKSPACES)
    expect(listed.items).toEqual([expect.objectContaining({ key: sale.key, member: false })])
    expect((await writer.call(`${WORKSPACES}/${sale.key}/changes`)).status).toBe(200)
    expect((await save(writer, home, 'Mine', sale.key)).status).toBe(404)
    expect(
      (await send(writer, 'PATCH', `${WORKSPACES}/${sale.key}`, { visibility: 'members' })).status,
    ).toBe(404)
  })

  test('opening a page another workspace changed says whose, never what, unless its owner keeps quiet', async () => {
    const { h, send, opened, page, save } = await site()
    const home = await page('Home', 'Welcome')
    const writer = await signInAsGroup(h, 'writer')
    const theirs = await opened(writer, 'Their sale')
    expect((await save(writer, home, 'Theirs', theirs.key)).status).toBe(200)
    const told = await h.json<{ items: Array<{ owner: string; workspace?: unknown }> }>(
      `${WORKSPACES}/touched/${home}`,
    )
    expect(told.items).toHaveLength(1)
    expect(told.items[0]?.workspace).toBeUndefined()
    expect(JSON.stringify(told)).not.toContain('Theirs')
    await send(writer, 'PATCH', `${WORKSPACES}/${theirs.key}`, { tellOthers: false })
    expect((await h.json<{ items: unknown[] }>(`${WORKSPACES}/touched/${home}`)).items).toEqual([])
    // Not of one's own.
    expect(
      (await writer.json<{ items: unknown[] }>(`${WORKSPACES}/touched/${home}`)).items,
    ).toEqual([])
  })

  test('a change is dropped, and the page reads as Shared’s there again', async () => {
    const { h, send, opened, page, save, titleOf } = await site()
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    await save(h, home, 'Sale on', sale.key)
    expect(await titleOf(h, home, sale.key)).toBe('Sale on')
    expect((await send(h, 'DELETE', `${WORKSPACES}/${sale.key}/changes/${home}`)).status).toBe(204)
    expect(await titleOf(h, home, sale.key)).toBe('Welcome')
  })

  test('the tree marks what the workspace changed, read in it', async () => {
    const { h, opened, page, save, inside } = await site()
    const home = await page('Home', 'Welcome')
    await page('About', 'About us')
    const sale = await opened(h, 'Spring sale')
    await save(h, home, 'Sale on', sale.key)
    const flags = async (workspace?: string) =>
      (
        (await (
          await h.call(`${V1}/tree/document/root?skip=0&take=10`, {
            headers: workspace ? inside(workspace) : {},
          })
        ).json()) as { items: Array<{ id: string; flags: Array<{ alias: string }> }> }
      ).items.map((i) => [i.id, i.flags.map((f) => f.alias)])
    const there = await flags(sale.key)
    expect(there.find(([id]) => id === home)?.[1]).toContain('Crombolo.Workspace.Changed')
    expect(
      there.filter(([, f]) => (f as string[]).includes('Crombolo.Workspace.Changed')),
    ).toHaveLength(1)
    expect(
      (await flags()).some(([, f]) => (f as string[]).includes('Crombolo.Workspace.Changed')),
    ).toBe(false)
  })
})
