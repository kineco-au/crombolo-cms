/**
 * Story 401, and 451 after it: an administrator lists and reads every workspace, whoever
 * it is shared with, a person's own included (`includePrivate=true` is still accepted);
 * writes stay with its owner and members, and nobody else reads one they aren't in.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import type { WorkSite } from '../packages/cli/src/support/work-site.ts'
import { includingPrivate } from '../packages/cli/src/support/workspace-commands.ts'
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

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-admin-read-'))
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
      workspaces: true,
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
  const created = await h.post(`${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [{ alias: 'title', culture: null, segment: null, value: 'Welcome' }],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status).toBe(201)
  const home = created.headers.get('umb-generated-resource') as string
  /** Saves Home's title in a workspace, as `who`. */
  const save = async (who: Harness, title: string, workspace: string) => {
    const inside = { 'crombolo-workspace': workspace }
    const copy = await who.call(`${V1}/document/${home}`, { headers: inside })
    const document = (await copy.json()) as Record<string, unknown>
    const saved = await send(
      who,
      'PUT',
      `${V1}/document/${home}`,
      { ...document, values: [{ alias: 'title', culture: null, segment: null, value: title }] },
      { 'if-match': copy.headers.get('etag') as string, ...inside },
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
  }
  return { h, db, send, save, home }
}

describe(`an administrator reading a workspace they are not in (${dialectUnderTest})`, () => {
  test('reads every read route, asking or not, and writes stay refused', async () => {
    const s = await site()
    const writer = await signInAsGroup(s.h, 'writer')
    const opened = await s.send(writer, 'POST', WORKSPACES, { name: 'Spring sale' })
    expect(opened.status).toBe(201)
    const { key } = (await opened.json()) as { key: string }
    await s.save(writer, 'Sale on', key)

    expect((await s.send(s.h, 'GET', `${WORKSPACES}/${key}`)).status).toBe(200)
    // Listed for them too.
    const listed = (await (await s.send(s.h, 'GET', WORKSPACES)).json()) as {
      items: Array<{ key: string }>
    }
    expect(listed.items.map((w) => w.key)).toContain(key)
    const asked = (path = '') => `${WORKSPACES}/${key}${path}?includePrivate=true`
    const view = await s.send(s.h, 'GET', asked())
    expect(view.status).toBe(200)
    expect(await view.json()).toMatchObject({ key, name: 'Spring sale', member: false })
    for (const path of ['/changes', '/merge', '/members'])
      expect((await s.send(s.h, 'GET', asked(path))).status, path).toBe(200)

    // Writes stay with its owner and members.
    expect((await s.send(s.h, 'POST', asked('/merge'), {})).status).toBe(404)
    expect((await s.send(s.h, 'PATCH', asked(), { name: 'Mine now' })).status).toBe(404)

    // An administrator reading it is not one of its members.
    expect((await (await s.send(s.h, 'GET', asked())).json()) as { member: boolean }).toMatchObject(
      {
        member: false,
      },
    )
  }, 30_000)

  test('a person’s own workspace is read the same way, and nobody else may ask', async () => {
    const s = await site()
    s.h.server.config.workspacesRequired = true
    const writer = await signInAsGroup(s.h, 'writer')
    await s.save(writer, 'Sale on', 'mine')
    const own = (await (await s.send(writer, 'GET', `${WORKSPACES}/mine`)).json()) as {
      workspace: { key: string }
    }
    const key = own.workspace.key
    expect(
      (await s.send(s.h, 'GET', `${WORKSPACES}/${key}/changes?includePrivate=true`)).status,
    ).toBe(200)
    const editor = await signInAsGroup(s.h, 'editor')
    expect((await s.send(editor, 'GET', `${WORKSPACES}/${key}?includePrivate=true`)).status).toBe(
      404,
    )
  }, 30_000)
})

describe('the command line, as an administrator', () => {
  test('asks every workspace route as one, and lists every workspace', async () => {
    const asked: string[] = []
    const site = includingPrivate({
      where: () => '',
      call: async (_m: string, path: string) => {
        asked.push(path)
        return new Response('{}')
      },
      json: async (_m: string, path: string) => {
        asked.push(path)
        return {} as never
      },
      close: async () => {},
    } as unknown as WorkSite)
    await site.json('GET', 'workspaces')
    await site.json('GET', 'workspaces/abc/changes')
    await site.call('GET', 'workspaces/abc/diff?against=base')
    await site.json('GET', 'changes')
    expect(asked).toEqual([
      'workspaces?all=true',
      'workspaces/abc/changes?includePrivate=true',
      'workspaces/abc/diff?against=base&includePrivate=true',
      'changes',
    ])
  })
})
