/**
 * Story 400: a workspace's life raised as webhook events. Opened, merged, discarded,
 * and in conflict with Shared, each written to the outbox as it happens, carrying the
 * workspace (`personal` included) and who did it. A conflict is found as Shared is
 * written, raised once until it is settled.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WEBHOOK_EVENT_ALIASES } from '@crombolo/api-management'
import { ComponentRepository, ContentTypeRepository, WORKSPACE_EVENT_ALIASES } from '@crombolo/data'
import { webhookPayload } from '../packages/server/src/webhooks.ts'
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
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

interface Raised {
  alias: string
  key: string
  workspace: { key: string; name: string; personal: boolean; owner: string; state: string }
  by: string
  change?: { key: string; name: string | null }
  items?: Array<{ kind: string; key?: string; path?: string; name: string }>
}

async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-events-'))
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
  const send = (method: string, path: string, body?: unknown, headers = {}) =>
    h.call(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const inside = (key?: string): Record<string, string> =>
    key ? { 'crombolo-workspace': key } : {}
  const page = async (name: string, title: string) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: title }],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    const published = await send('PUT', `${V1}/document/${key}/publish`, {
      publishSchedules: [{ culture: null }],
    })
    expect(published.status).toBe(200)
    return key
  }
  /** Saves a page's title and name, from a copy read the same way. */
  const save = async (key: string, change: { title?: string; name?: string }, ws?: string) => {
    const copy = await h.call(`${V1}/document/${key}`, { headers: inside(ws) })
    const document = (await copy.json()) as {
      values: Array<{ alias: string; value: unknown }>
      variants: Array<{ name: string }>
    }
    const response = await send(
      'PUT',
      `${V1}/document/${key}`,
      {
        ...document,
        values: change.title
          ? [{ alias: 'title', culture: null, segment: null, value: change.title }]
          : document.values,
        variants: document.variants.map((v) => ({ ...v, name: change.name ?? v.name })),
      },
      { 'if-match': copy.headers.get('etag') as string, ...inside(ws) },
    )
    expect(response.status, await response.clone().text()).toBe(200)
  }
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string; name: string }
  }
  /** The workspace events raised so far, oldest first. */
  const raised = async (): Promise<Raised[]> =>
    (
      await db.q
        .selectFrom('content_event')
        .select(['facts', 'occurred_at'])
        .where('entity_type', '=', 'Workspace')
        .orderBy('occurred_at')
        .execute()
    ).map((e) => (JSON.parse(String(e.facts)) as { webhook: Raised }).webhook)
  const of = async (alias: string) => (await raised()).filter((e) => e.alias === alias)
  return { h, db, send, page, save, opened, raised, of, inside }
}

describe(`a workspace's life, raised (${dialectUnderTest})`, () => {
  test('opening, merging and discarding each raise their event once, with the workspace', async () => {
    const s = await site()
    const home = await s.page('Home', 'Welcome')
    const sale = await s.opened('Spring sale')
    expect(await s.of('Crombolo.WorkspaceOpened')).toEqual([
      expect.objectContaining({
        key: sale.key,
        by: 'person',
        workspace: expect.objectContaining({
          key: sale.key,
          name: 'Spring sale',
          personal: false,
          state: 'open',
        }),
      }),
    ])

    await s.save(home, { title: 'Sale on' }, sale.key)
    const merged = await s.send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(merged.status).toBe(200)
    const [announced] = await s.of('Crombolo.WorkspaceMerged')
    expect(announced).toMatchObject({
      key: sale.key,
      workspace: { state: 'merged', personal: false },
      change: { key: sale.key, name: 'Spring sale' },
    })
    expect(await s.of('Crombolo.WorkspaceMerged')).toHaveLength(1)

    const footer = await s.opened('Footer')
    expect((await s.send('DELETE', `${WORKSPACES}/${footer.key}`)).status).toBe(204)
    expect(await s.of('Crombolo.WorkspaceDiscarded')).toEqual([
      expect.objectContaining({
        key: footer.key,
        workspace: expect.objectContaining({ name: 'Footer' }),
      }),
    ])
    expect(await s.of('Crombolo.WorkspaceOpened')).toHaveLength(2)
  }, 30_000)

  test("a person's own workspace raises them too, marked personal; its one-page merges do not", async () => {
    const s = await site()
    const home = await s.page('Home', 'Welcome')
    s.h.server.config.workspacesRequired = true
    await s.save(home, { title: 'Sale on' }, 'mine')
    const [own] = await s.of('Crombolo.WorkspaceOpened')
    expect(own?.workspace.personal).toBe(true)
    const published = await s.send(
      'PUT',
      `${V1}/document/${home}/publish`,
      { publishSchedules: [{ culture: null }] },
      s.inside('mine'),
    )
    expect(published.status).toBe(200)
    expect(await s.of('Crombolo.WorkspaceMerged')).toEqual([])
    expect(await s.of('Crombolo.WorkspaceOpened')).toHaveLength(1)
  }, 30_000)

  test('a Shared write that conflicts raises it once, naming the page, until it is answered', async () => {
    const s = await site()
    const home = await s.page('Home', 'Welcome')
    const sale = await s.opened('Spring sale')
    await s.save(home, { title: 'Sale on' }, sale.key)
    // A change Shared makes that merges cleanly is no conflict.
    await s.save(home, { name: 'Start' })
    expect(await s.of('Crombolo.WorkspaceConflicted')).toEqual([])

    await s.save(home, { title: 'Hello world' })
    expect(await s.of('Crombolo.WorkspaceConflicted')).toEqual([
      expect.objectContaining({
        key: sale.key,
        items: [{ kind: 'document', key: home, name: 'Home' }],
      }),
    ])
    await s.save(home, { title: 'Hello again' })
    expect(await s.of('Crombolo.WorkspaceConflicted')).toHaveLength(1)

    const answered = await s.send('POST', `${WORKSPACES}/${sale.key}/conflicts`, {
      page: home,
      answers: { 'title||': 'mine' },
    })
    expect(answered.status).toBe(200)
    await s.save(home, { title: 'Once more' })
    expect(await s.of('Crombolo.WorkspaceConflicted')).toHaveLength(2)
  }, 30_000)
})

describe('what a workspace event is posted', () => {
  test('the workspace, who did it, and what the event names', () => {
    const workspace = {
      key: 'w1',
      name: 'Spring sale',
      personal: false,
      owner: 'u1',
      state: 'merged' as const,
    }
    expect(
      webhookPayload(
        {
          alias: 'Crombolo.WorkspaceMerged',
          key: 'w1',
          workspace,
          by: 'tool',
          tool: { id: 'agent-7', name: 'Release bot' },
          change: { key: 'c1', name: 'Spring sale' },
        },
        'minimal',
      ),
    ).toEqual({
      Id: 'w1',
      Workspace: { Key: 'w1', Name: 'Spring sale', Personal: false, Owner: 'u1', State: 'merged' },
      By: 'tool',
      Tool: { Id: 'agent-7', Name: 'Release bot' },
      Change: { Key: 'c1', Name: 'Spring sale' },
    })
    expect(
      webhookPayload(
        {
          alias: 'Crombolo.WorkspaceConflicted',
          key: 'w1',
          workspace: { ...workspace, state: 'open' },
          items: [
            { kind: 'file', path: 'content-types/page.toml', name: 'content-types/page.toml' },
          ],
        },
        'crombolo',
      ),
    ).toMatchObject({
      By: 'person',
      Items: [{ Kind: 'file', Path: 'content-types/page.toml', Name: 'content-types/page.toml' }],
    })
  })

  test('every event a workspace raises is one a webhook can choose', () => {
    for (const alias of WORKSPACE_EVENT_ALIASES) expect(WEBHOOK_EVENT_ALIASES.has(alias)).toBe(true)
  })
})
