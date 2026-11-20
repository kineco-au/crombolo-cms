/**
 * Story 380: merging a workspace over HTTP. `GET <plugin>/api/workspaces/{key}/merge`
 * says what a merge would do, `POST` does it, for someone holding the merge
 * permission and every change's own verbs; a conflict is answered in the
 * workspace, a pending change can be dropped, and a merged workspace takes no
 * more edits. What it merges is announced as Shared's own writes are.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspacePermissions } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository, DocumentRepository } from '@crombolo/data'
import { type CromboloConfig, REMOTE_API_PATH, REMOTE_DISCOVERY_PATH } from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

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

async function site(extra: Partial<CromboloConfig> = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-merge-api-'))
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
      ...extra,
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

describe(`merging a workspace over HTTP (${dialectUnderTest})`, () => {
  test('says what it would do, then does it, announced and audited, and closes it', async () => {
    const { h, db, send, page, opened, titleOf, save, count } = await site()
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    expect((await save(h, home, 'Sale on', sale.key)).status).toBe(200)

    const preview = await h.json<{ pages: unknown[]; mayMerge: boolean; refusals: string[] }>(
      `${WORKSPACES}/${sale.key}/merge`,
    )
    expect(preview).toMatchObject({
      pages: [{ key: home, name: 'Home', changes: ['title'] }],
      mayMerge: true,
      refusals: [],
    })
    expect(await titleOf(h, home)).toBe('Welcome')

    const events = await count('content_event')
    const merged = await send(h, 'POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(merged.status).toBe(200)
    expect(await titleOf(h, home)).toBe('Sale on')
    expect(await count('content_event')).toBeGreaterThan(events)
    const audited = await db.q
      .selectFrom('audit_entry')
      .select(['action', 'detail'])
      .where('entity_key', '=', sale.key)
      .where('action', '=', 'Merge')
      .execute()
    expect(audited).toHaveLength(1)

    const after = await h.json<{ state: string }>(`${WORKSPACES}/${sale.key}`)
    expect(after.state).toBe('merged')
    expect((await save(h, home, 'Again', sale.key)).status).toBe(409)
    expect((await send(h, 'POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(409)
  })

  test('someone without the permission previews it and is refused the merge', async () => {
    const { h, send, page, opened, save, titleOf } = await site()
    const home = await page('Home', 'Welcome')
    const writer = await signInAsGroup(h, 'writer')
    const sale = await opened(writer, 'Spring sale')
    expect((await save(writer, home, 'Sale on', sale.key)).status).toBe(200)
    const preview = await writer.json<{ mayMerge: boolean }>(`${WORKSPACES}/${sale.key}/merge`)
    expect(preview.mayMerge).toBe(false)
    expect((await send(writer, 'POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(403)
    expect(await titleOf(h, home)).toBe('Welcome')
  })

  test('the permission is not enough for a change the person could not make directly', async () => {
    const { h, db, send, page, opened, save } = await site()
    const home = await page('Home', 'Welcome')
    const writer = await signInAsGroup(h, 'writer')
    const group = await db.q
      .selectFrom('user_group')
      .select('key')
      .where('alias', '=', 'writer')
      .execute()
    await db.q
      .insertInto('user_group_permission')
      .values({ user_group_key: String(group[0]?.key), permission: WorkspacePermissions.Merge })
      .execute()
    const sale = await opened(writer, 'Spring sale')
    expect((await save(writer, home, 'Sale on', sale.key)).status).toBe(200)
    // A writer may save in the workspace, and may merge a save, but not a publish.
    expect(
      (await send(writer, 'POST', `${WORKSPACES}/${sale.key}/merge`, { rehearse: true })).status,
    ).toBe(200)
    await db.q
      .updateTable('workspace_document')
      .set({ published: db.dialect.boolValue(false) as boolean })
      .execute()
    const unpublish = await send(writer, 'GET', `${WORKSPACES}/${sale.key}/merge`)
    expect(((await unpublish.json()) as { refusals: string[] }).refusals).toEqual([
      'You may not make these changes to "Home".',
    ])
    expect((await send(writer, 'POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(403)
  })

  test('a conflict is refused, named, answered in the workspace, then merged', async () => {
    const { h, send, page, opened, save, titleOf } = await site()
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    expect((await save(h, home, 'Sale on', sale.key)).status).toBe(200)
    expect((await save(h, home, 'Hello world')).status).toBe(200)

    const refused = await send(h, 'POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({
      blockers: ['"Home": title was changed in both the workspace and Shared.'],
      conflicts: [{ key: home, words: 'title', mine: 'Sale on', theirs: 'Hello world' }],
    })
    const answered = await send(h, 'POST', `${WORKSPACES}/${sale.key}/conflicts`, {
      page: home,
      answers: { 'title||': 'mine' },
    })
    expect(answered.status).toBe(200)
    expect(((await answered.json()) as { conflicts: unknown[] }).conflicts).toEqual([])
    expect((await send(h, 'POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(await titleOf(h, home)).toBe('Sale on')
  })

  test('a pending move dropped from the workspace does not go', async () => {
    const { h, db, send, page, opened, inside } = await site()
    const a = await page('A', 'A')
    const b = await page('B', 'B')
    const sale = await opened(h, 'Spring sale')
    const moved = await send(
      h,
      'PUT',
      `${V1}/document/${b}/move`,
      { target: { id: a } },
      inside(sale.key),
    )
    expect(moved.status).toBe(200)
    const preview = await h.json<{ pending: Array<{ id: number; kind: string }> }>(
      `${WORKSPACES}/${sale.key}/merge`,
    )
    expect(preview.pending).toEqual([expect.objectContaining({ kind: 'move' })])
    const id = preview.pending[0]?.id as number
    expect((await send(h, 'DELETE', `${WORKSPACES}/${sale.key}/pending/${id}`)).status).toBe(204)
    expect((await send(h, 'POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    const node = await new DocumentRepository(db).nodes.byKey(b)
    expect(node?.parentId).toBe(-1)
  })

  test('several merge as one, and a field two of them changed differently is named first', async () => {
    const { h, send, page, opened, save, titleOf } = await site()
    const home = await page('Home', 'Welcome')
    const about = await page('About', 'About us')
    const sale = await opened(h, 'Spring sale')
    const rebrand = await opened(h, 'Rebrand')
    expect((await save(h, home, 'Sale on', sale.key)).status).toBe(200)
    expect((await save(h, about, 'About the new us', rebrand.key)).status).toBe(200)
    const both = await send(h, 'POST', `${WORKSPACES}/merge`, {
      workspaces: [sale.key, rebrand.key],
    })
    expect(both.status).toBe(200)
    expect([await titleOf(h, home), await titleOf(h, about)]).toEqual([
      'Sale on',
      'About the new us',
    ])

    const one = await opened(h, 'One')
    const two = await opened(h, 'Two')
    expect((await save(h, home, 'One says', one.key)).status).toBe(200)
    expect((await save(h, home, 'Two says', two.key)).status).toBe(200)
    const clash = await send(h, 'POST', `${WORKSPACES}/merge`, { workspaces: [one.key, two.key] })
    expect(clash.status).toBe(409)
    expect(((await clash.json()) as { blockers: string[] }).blockers).toEqual([
      '"Home": title is changed differently in "One" and "Two"; settle it in one of them.',
    ])
    expect(await titleOf(h, home)).toBe('Sale on')
  })
})

describe(`a site that requires a workspace (${dialectUnderTest})`, () => {
  test('refuses a direct change, and takes one in the person’s own workspace', async () => {
    const { h, send, page, save, titleOf } = await site()
    const home = await page('Home', 'Welcome')
    const about = await page('About', 'About us')
    h.server.config.workspacesRequired = true
    expect(await h.json<unknown>(`${WORKSPACES}/mine`)).toEqual({
      required: true,
      workspace: null,
      contentLocked: false,
      editedAt: null,
    })

    expect((await save(h, home, 'Directly')).status).toBe(409)
    expect((await save(h, home, 'Sale on', 'mine')).status).toBe(200)
    const own = await h.json<{ workspace: { key: string; name: string } }>(`${WORKSPACES}/mine`)
    expect(own.workspace).toMatchObject({ name: 'Changes by Administrator' })
    expect(await titleOf(h, home)).toBe('Welcome')
    expect(await titleOf(h, home, 'mine')).toBe('Sale on')

    // Publishing there is the merge of that page alone.
    expect((await save(h, about, 'About the new us', 'mine')).status).toBe(200)
    const published = await send(
      h,
      'PUT',
      `${V1}/document/${home}/publish`,
      { publishSchedules: [{ culture: null }] },
      { 'crombolo-workspace': 'mine' },
    )
    expect(published.status).toBe(200)
    expect(await titleOf(h, home)).toBe('Sale on')
    expect(await titleOf(h, about)).toBe('About us')
    expect(await titleOf(h, about, 'mine')).toBe('About the new us')
    const still = await h.json<{ workspace: { key: string } }>(`${WORKSPACES}/mine`)
    expect(still.workspace.key).toBe(own.workspace.key)
  })

  test('a site cannot require workspaces it has not turned on', async () => {
    const { loadConfig } = await import('@crombolo/server')
    expect(() => loadConfig({ workspacesRequired: true, workspaces: false })).toThrow(
      /CROMBOLO_WORKSPACES=true/,
    )
  })
})

describe(`a host merges a workspace through the remote (${dialectUnderTest})`, () => {
  test('offered at the content level, by the same rules', async () => {
    const remote = {
      enabled: true,
      environment: 'production',
      protected: false,
      approvals: false,
      maxUploadBytes: 1024 ** 2,
    }
    const { h, page, opened, save, titleOf } = await site({ remote } as Partial<CromboloConfig>)
    const discovery = await h.json<{ capabilities: string[] }>(REMOTE_DISCOVERY_PATH)
    expect(discovery.capabilities).toContain('workspace-merge')
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    expect((await save(h, home, 'Sale on', sale.key)).status).toBe(200)
    const api = (client: Harness, method: string) =>
      client.server.fetch(
        new Request(
          `${ORIGIN}${REMOTE_API_PATH}/environments/production/workspaces/${sale.key}/merge`,
          {
            method,
            headers: { cookie: client.cookie(), 'content-type': 'application/json' },
            ...(method === 'POST' ? { body: '{}' } : {}),
          },
        ),
      )
    const writer = await signInAsGroup(h, 'writer')
    const refused = await api(writer, 'POST')
    expect(refused.status).toBe(404)
    expect((await api(h, 'GET')).status).toBe(200)
    expect((await api(h, 'POST')).status).toBe(200)
    expect(await titleOf(h, home)).toBe('Sale on')
  })
})
