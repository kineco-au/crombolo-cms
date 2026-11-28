/**
 * Story 384: workspaces in the back office. The switch's choices, each workspace's
 * colour and the header a tab sends; a workspace's privacy, chosen by its owner; the
 * notice that another workspace changed a page, by whose, never what; dropping a
 * change; the trees' mark on what a workspace changed; and what the switch is told.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, DbDate } from '@crombolo/data'
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
  contrast,
  controlsFor,
  currentWorkspace,
  filtered,
  headerFor,
  inkOn,
  inWorkspace,
  markOf,
  menuFor,
  mergeRows,
  onceKnown,
  PALETTE,
  WORKSPACE_HEADER,
  whoSees,
  workspaceFacts,
  workspaceRows,
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

  test('the menu offers Merge only to who may merge; a new workspace, sharing and every workspace are not in it', () => {
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
    expect(actions({})).toEqual(['shared', 'enter', 'enter'])
    expect(actions({ current: { key: 'a', name: 'Sale' }, changes: 2 })).toEqual([
      'shared',
      'enter',
      'enter',
      'changes',
      'merge',
      'address',
    ])
    expect(actions({ current: { key: 'b', name: 'Footer' }, changes: 2, mayMerge: false })).toEqual(
      ['shared', 'enter', 'enter', 'changes', 'address'],
    )
    // Shared is a section of its own, apart from the workspaces and from what to do.
    const sections = (
      menuFor({
        current: { key: 'a', name: 'Sale' },
        workspaces,
        mayMerge: true,
        changes: 1,
        required: false,
      } as never) as Array<{ section: string }>
    ).map((i) => i.section)
    expect(sections).toEqual([
      'shared',
      'workspaces',
      'workspaces',
      'actions',
      'actions',
      'actions',
    ])
  })

  test('the buttons beside the menu: merging, sharing and deleting need a workspace, and say why not (story 428)', () => {
    const workspaces = [
      { key: 'a', name: 'Sale', mine: true, personal: false },
      { key: 'b', name: 'Footer', mine: false, personal: false },
      { key: 'c', name: 'Mine', mine: true, personal: true },
    ]
    type Control = { enabled: boolean; why?: string }
    const at = (key?: string, more: Record<string, unknown> = { mayMerge: true, changes: 2 }) =>
      controlsFor({
        current: key ? { key, name: key } : null,
        workspaces,
        ...more,
      } as never) as Record<'merge' | 'share' | 'remove', Control>
    // In Shared, none.
    for (const control of Object.values(at()))
      expect(control).toEqual({ enabled: false, why: expect.stringContaining('Shared') })
    // One's own, with changes, for someone who may merge: all three.
    expect(at('a')).toEqual({
      merge: { enabled: true },
      share: { enabled: true },
      remove: { enabled: true },
    })
    // Nothing to merge, or not theirs to merge.
    expect(at('a', { mayMerge: true, changes: 0 }).merge.why).toContain('no changes')
    expect(at('a', { mayMerge: false, changes: 2 }).merge.why).toContain('may not merge')
    // Someone else's: only its owner shares it; the site says who may delete it.
    expect(at('b').share).toEqual({ enabled: false, why: expect.stringContaining('owner') })
    expect(at('b').remove).toEqual({ enabled: true })
    // The workspace every edit of theirs goes in stays.
    expect(at('c').remove.enabled).toBe(false)
  })
})

describe('the marks beside a tree’s items', () => {
  const marks = {
    items: {
      'aaaaaaaa-0000-4000-8000-000000000001': 'changed',
      'aaaaaaaa-0000-4000-8000-000000000002': 'new',
      '/site.css': 'changed',
      '/parts/heading.tsx': 'deleted',
    },
    below: ['aaaaaaaa-0000-4000-8000-000000000009'],
  }

  test('an item is found by its key, a file by its path as a tree names it, and one above a change is below', () => {
    expect(markOf(marks, 'AAAAAAAA-0000-4000-8000-000000000001')).toBe('changed')
    expect(markOf(marks, 'aaaaaaaa-0000-4000-8000-000000000002')).toBe('new')
    expect(markOf(marks, '%2Fsite%dot%css')).toBe('changed')
    expect(markOf(marks, '%2Fparts%2Fheading%dot%tsx')).toBe('deleted')
    expect(markOf(marks, 'aaaaaaaa-0000-4000-8000-000000000009')).toBe('below')
  })

  test('one that is as Shared has it carries none, and nothing does with no marks', () => {
    expect(markOf(marks, 'aaaaaaaa-0000-4000-8000-000000000003')).toBeUndefined()
    expect(markOf(marks, undefined)).toBeUndefined()
    expect(markOf(undefined, '/site.css')).toBeUndefined()
    expect(markOf({ items: {}, below: [] }, '%E0%A4%A')).toBeUndefined()
  })
})

describe('the Workspaces page', () => {
  const view = {
    createdAt: '2026-11-25T03:00:00.000Z',
    updatedAt: '2026-11-25T04:00:00.000Z',
    conflicts: 0,
    staged: false,
    personal: false,
  }
  type Fact = { label: string; value: string; note: string }
  const facts = (...args: unknown[]) =>
    (workspaceFacts as (...a: unknown[]) => Fact[])(...args).map((f) => [f.label, f.value, f.note])

  test('lists Shared, then each open workspace, marking where the tab is and what stands out', () => {
    const workspaces = [
      { key: 'a', name: 'Sale', state: 'open', member: true, conflicts: 2 },
      { key: 'b', name: 'Footer', state: 'open', member: true, conflicts: 0 },
      { key: 'c', name: 'Theirs', state: 'open', member: false, conflicts: 0 },
      { key: 'd', name: 'Autumn', state: 'merged', member: true, conflicts: 0 },
    ]
    expect(workspaceRows({ current: { key: 'b' }, workspaces } as never)).toEqual([
      { key: 'shared', name: 'Shared', here: false, note: '' },
      { key: 'a', name: 'Sale', here: false, note: '2 conflicts' },
      { key: 'b', name: 'Footer', here: true, note: '' },
      { key: 'c', name: 'Theirs', here: false, note: 'to look at' },
    ])
    const inShared = workspaceRows({ current: null, workspaces } as never) as Array<{
      here: boolean
    }>
    expect(inShared.map((r) => r.here)).toEqual([true, false, false, false])
  })

  test('says who made a workspace and when, when it last changed, and who it is shared with', () => {
    const members = [
      { name: 'Ada', owner: true },
      { name: 'Grace', owner: false },
      { name: 'Linus', owner: false },
    ]
    expect(facts({ ...view, conflicts: 2 }, members, 3)).toEqual([
      ['Created by', 'Ada', '2026-11-25T03:00:00.000Z'],
      ['Last changed', '2026-11-25T04:00:00.000Z', '3 changes, 2 conflicts with Shared'],
      ['Shared with', 'Grace, Linus', ''],
    ])
    expect(facts(view, [{ name: 'Ada', owner: true }], 0)).toEqual([
      ['Created by', 'Ada', '2026-11-25T03:00:00.000Z'],
      ['Last changed', '2026-11-25T04:00:00.000Z', 'No changes yet'],
      ['Shared with', 'Nobody else', ''],
    ])
    expect(facts({ ...view, staged: true })[2]?.[2]).toContain('another site')
    expect(facts({ ...view, personal: true })[2]?.[2]).toContain('Your own')
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
    expect(listed.items).toEqual([
      expect.objectContaining({ key: 'shared', shared: true }),
      expect.objectContaining({ key: sale.key, member: false }),
    ])
    expect((await writer.call(`${WORKSPACES}/${sale.key}/changes`)).status).toBe(200)
    expect((await save(writer, home, 'Mine', sale.key)).status).toBe(404)
    expect(
      (await send(writer, 'PATCH', `${WORKSPACES}/${sale.key}`, { visibility: 'members' })).status,
    ).toBe(404)
  })

  test('opening a page another workspace changed in the last week says whose, never what', async () => {
    const { h, opened, page, save } = await site()
    const home = await page('Home', 'Welcome')
    const writer = await signInAsGroup(h, 'writer')
    const theirs = await opened(writer, 'Their sale')
    expect((await save(writer, home, 'Theirs', theirs.key)).status).toBe(200)
    const told = await h.json<{ items: Array<{ owner: string; workspace?: unknown }> }>(
      `${WORKSPACES}/touched/${home}`,
    )
    expect(told.items).toHaveLength(1)
    // An administrator sees every workspace, so is told which.
    expect(told.items[0]?.workspace).toEqual({ key: theirs.key, name: 'Their sale' })
    expect(JSON.stringify(told)).not.toContain('Theirs')
    // An editor not in it is told whose, never which.
    const editor = await signInAsGroup(h, 'editor')
    const toldEditor = await editor.json<{ items: Array<{ workspace?: unknown }> }>(
      `${WORKSPACES}/touched/${home}`,
    )
    expect(toldEditor.items).toHaveLength(1)
    expect(toldEditor.items[0]?.workspace).toBeUndefined()
    // Not of one's own.
    expect(
      (await writer.json<{ items: unknown[] }>(`${WORKSPACES}/touched/${home}`)).items,
    ).toEqual([])
    // A change older than a week is not worth a warning.
    const db = h.server.db
    await db.q
      .updateTable('content_version')
      .set({ version_date: DbDate.toDb(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)) })
      .where('workspace_id', 'is not', null)
      .execute()
    expect((await h.json<{ items: unknown[] }>(`${WORKSPACES}/touched/${home}`)).items).toEqual([])
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

  test('what a workspace holds is answered item by item: changed, new, deleted, and what is above them', async () => {
    const { h, send, opened, page, save, inside, typeKey } = await site()
    const home = await page('Home', 'Welcome')
    const about = await page('About', 'About us')
    const sale = await opened(h, 'Spring sale')
    const marks = async () =>
      (await (await send(h, 'GET', `${WORKSPACES}/${sale.key}/marks`)).json()) as {
        items: Record<string, string>
        below: string[]
      }
    expect(await marks()).toEqual({ items: {}, below: [] })

    await save(h, home, 'Sale on', sale.key)
    const made = await h.call(`${V1}/document`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...inside(sale.key) },
      body: JSON.stringify({
        documentType: { id: typeKey },
        parent: { id: about },
        values: [],
        variants: [{ culture: null, segment: null, name: 'Offers' }],
      }),
    })
    expect(made.status, await made.clone().text()).toBe(201)
    const offers = made.headers.get('umb-generated-resource') as string
    const held = await marks()
    expect(held.items[home]).toBe('changed')
    expect(held.items[offers]).toBe('new')
    // About holds a new page below it, and is not changed itself.
    expect(held.below).toEqual([about])

    // Moved to the recycle bin there, it is to be deleted; Shared still has it.
    const binned = await h.call(`${V1}/document/${home}/move-to-recycle-bin`, {
      method: 'PUT',
      headers: inside(sale.key),
    })
    expect(binned.status, await binned.clone().text()).toBe(200)
    expect((await marks()).items[home]).toBe('deleted')
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

describe("a workspace's colour and Shared's grid", () => {
  test('a name on its colour is always readable', () => {
    for (const colour of [...PALETTE, '#ffffff', '#f5d000', '#000000']) {
      expect(contrast(colour, inkOn(colour))).toBeGreaterThanOrEqual(4.5)
    }
    expect(inkOn('#ffffff')).toBe('#1f1d1a')
    expect(inkOn('#1f6f8b')).toBe('#ffffff')
  })

  test('shows each open workspace with its status, and merges only those without conflicts', () => {
    const at = { state: 'open', member: true, conflicts: 0, staged: false }
    type Row = {
      name: string
      colour: string
      status: { icon: string; label: string }
      merge: { enabled: boolean; why: string }
    }
    const rows: Row[] = mergeRows(
      [
        { ...at, key: 'a', name: 'Ready' },
        { ...at, key: 'b', name: 'Clashing', conflicts: 2 },
        { ...at, key: 'c', name: 'Imported', staged: true },
        { ...at, key: 'd', name: 'Theirs', member: false },
        { ...at, key: 'e', name: 'Gone', state: 'merged' },
      ],
      true,
    )
    expect(rows.map((r: Row) => [r.name, r.status.icon, r.status.label, r.merge.enabled])).toEqual([
      ['Ready', 'icon-check', 'Ready to merge', true],
      ['Clashing', 'icon-alert', '2 conflicts with Shared', false],
      ['Imported', 'icon-download-alt', 'Staged from another site', true],
      ['Theirs', 'icon-eye', 'Yours to look at', true],
    ])
    expect(rows[1]?.merge.why).toBe('Settle its conflicts in the workspace first.')
    expect(rows[0]?.colour).toBe(colourOf('a') as string)
    expect(mergeRows([{ ...at, key: 'a', name: 'Ready' }], false)[0].merge).toEqual({
      enabled: false,
      why: 'You may not merge workspaces.',
    })
  })
})

describe('who sees a workspace (story 451)', () => {
  test("the list's filter: Mine is those the person is in, All is every one they can see", () => {
    const list = [
      { key: 'a', member: true },
      { key: 'b', member: false },
    ]
    expect(filtered(list, 'mine').map((w: { key: string }) => w.key)).toEqual(['a'])
    expect(filtered(list, 'all').map((w: { key: string }) => w.key)).toEqual(['a', 'b'])
  })

  test('who sees it is said in words: its owner and the administrators, then the rest', () => {
    expect(whoSees({ visibility: 'members' })).toBe('Its owner and the administrators')
    expect(whoSees({ visibility: 'editors' })).toBe(
      'Its owner, the administrators and every editor',
    )
    expect(
      whoSees(
        { visibility: 'members' },
        [{ name: 'Writers' }],
        [
          { name: 'Ann', owner: true },
          { name: 'Bo', owner: false },
        ],
      ),
    ).toBe('Its owner, the administrators, Writers and Bo')
  })

  test('the Shared with card names its groups, then its people', () => {
    const view = { createdAt: '', updatedAt: '', conflicts: 0 }
    const facts = workspaceFacts(
      view,
      [
        { name: 'Ann', owner: true },
        { name: 'Bo', owner: false },
      ],
      0,
      (iso: string) => iso,
      [{ name: 'Editors' }],
    )
    expect(facts.find((f: { label: string }) => f.label === 'Shared with')?.value).toBe(
      'Editors, Bo',
    )
  })
})
