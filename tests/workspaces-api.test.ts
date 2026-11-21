/**
 * Story 375: workspaces over HTTP. The routes at `<plugin>/api/workspaces` open,
 * list, share and discard them; the `Crombolo-Workspace` header on the
 * Management API's page routes reads and writes the workspace's pages, for its
 * owner and members only, and refuses what a workspace cannot hold yet. A
 * workspace's change is audited, and announced nowhere else.
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
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspaces-api-'))
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

describe(`workspaces over HTTP (${dialectUnderTest})`, () => {
  test('opened, listed, renamed, shared and discarded, by their owner', async () => {
    const { h, send, opened } = await site()
    const sale = await opened(h, 'Spring sale')
    const listed = await h.json<{ items: Array<{ key: string; mine: boolean }> }>(WORKSPACES)
    expect(listed.items).toEqual([expect.objectContaining({ key: sale.key, mine: true })])
    const renamed = await send(h, 'PATCH', `${WORKSPACES}/${sale.key}`, { name: 'Summer sale' })
    expect(await renamed.json()).toMatchObject({ name: 'Summer sale' })

    const writer = await signInAsGroup(h, 'writer')
    const writerKey = (await writer.json<{ id: string }>(`${V1}/user/current`)).id
    expect((await writer.call(`${WORKSPACES}/${sale.key}`)).status).toBe(404)
    expect((await writer.json<{ items: unknown[] }>(WORKSPACES)).items).toEqual([])
    const shared = await send(h, 'POST', `${WORKSPACES}/${sale.key}/members`, {
      userKey: writerKey,
    })
    expect(await shared.json()).toMatchObject({ memberKeys: [writerKey] })
    expect((await writer.call(`${WORKSPACES}/${sale.key}`)).status).toBe(200)
    // A member works in it, and does not rename, share or discard it.
    expect((await send(writer, 'PATCH', `${WORKSPACES}/${sale.key}`, { name: 'x' })).status).toBe(
      403,
    )
    expect((await send(writer, 'DELETE', `${WORKSPACES}/${sale.key}`)).status).toBe(403)
    expect((await send(h, 'DELETE', `${WORKSPACES}/${sale.key}/members/${writerKey}`)).status).toBe(
      204,
    )
    expect((await writer.call(`${WORKSPACES}/${sale.key}`)).status).toBe(404)

    expect((await send(h, 'DELETE', `${WORKSPACES}/${sale.key}`)).status).toBe(204)
    expect((await h.call(`${WORKSPACES}/${sale.key}`)).status).toBe(404)
    expect((await send(h, 'POST', WORKSPACES, { name: '' })).status).toBe(400)
  })

  test('an administrator lists and discards another’s, and does not read it', async () => {
    const { h, send, opened } = await site()
    const writer = await signInAsGroup(h, 'writer')
    const theirs = await opened(writer, 'Their work')
    expect((await h.json<{ items: unknown[] }>(WORKSPACES)).items).toEqual([])
    expect(
      (await h.json<{ items: Array<{ key: string }> }>(`${WORKSPACES}?all=true`)).items,
    ).toEqual([expect.objectContaining({ key: theirs.key })])
    expect((await writer.call(`${WORKSPACES}?all=true`)).status).toBe(403)
    expect((await h.call(`${WORKSPACES}/${theirs.key}`)).status).toBe(404)
    expect((await h.call(`${WORKSPACES}/${theirs.key}/changes`)).status).toBe(404)
    expect((await send(h, 'DELETE', `${WORKSPACES}/${theirs.key}`)).status).toBe(204)
    expect((await writer.call(`${WORKSPACES}/${theirs.key}`)).status).toBe(404)
  })

  test('the header reads and writes the workspace’s pages, and Shared hears nothing of it', async () => {
    const { h, send, page, opened, inside, read, titleOf, save, count } = await site()
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    const before = {
      events: await count('content_event'),
      queued: await count('search_index_queue'),
      files: await count('node_file'),
    }
    const lastAudit = Number(
      (
        await h.server.db.q
          .selectFrom('audit_entry')
          .select((eb) => eb.fn.max('id').as('n'))
          .execute()
      )[0]?.n ?? 0,
    )

    expect((await save(h, home, 'Sale on', sale.key)).status).toBe(200)
    expect(await titleOf(h, home, sale.key)).toBe('Sale on')
    expect(await titleOf(h, home)).toBe('Welcome')
    expect(
      (
        await send(
          h,
          'PUT',
          `${V1}/document/${home}/unpublish`,
          { cultures: null },
          inside(sale.key),
        )
      ).status,
    ).toBe(200)
    expect(
      ((await (await read(h, home, sale.key)).json()) as { variants: Array<{ state: string }> })
        .variants[0]?.state,
    ).toBe('Draft')
    expect(
      ((await (await read(h, home)).json()) as { variants: Array<{ state: string }> }).variants[0]
        ?.state,
    ).toBe('Published')

    // The site still serves Shared's page.
    const html = await (await h.server.fetch(new Request('http://localhost/'))).text()
    expect(html).not.toContain('Sale on')
    expect(await count('content_event')).toBe(before.events)
    // Nothing is queued for search; a worker may empty the queue meanwhile.
    expect(await count('search_index_queue')).toBeLessThanOrEqual(before.queued)
    expect(await count('node_file')).toBe(before.files)
    const entries = await h.server.db.q
      .selectFrom('audit_entry')
      .select(['detail'])
      .where('id', '>', lastAudit)
      .orderBy('id')
      .execute()
    expect(entries.map((e) => e.detail)).toContain('In the workspace "Spring sale"')

    const changes = await h.json<{ items: Array<{ key: string; kind: string }> }>(
      `${WORKSPACES}/${sale.key}/changes`,
    )
    expect(changes.items).toEqual([expect.objectContaining({ key: home, kind: 'changed' })])
  })

  test('a page made with the header is found there only', async () => {
    const { h, send, page, opened, inside, typeKey, componentKey } = await site()
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    const made = await send(
      h,
      'POST',
      `${V1}/document`,
      {
        documentType: { id: typeKey },
        template: { id: componentKey },
        parent: { id: home },
        values: [{ alias: 'title', culture: null, segment: null, value: 'Offers' }],
        variants: [{ culture: null, segment: null, name: 'Offers' }],
      },
      inside(sale.key),
    )
    expect(made.status).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    expect((await h.call(`${V1}/document/${key}`, { headers: inside(sale.key) })).status).toBe(200)
    expect((await h.call(`${V1}/document/${key}`)).status).toBe(404)
    const children = (path: string, headers = {}) =>
      h.json<{ items: Array<{ id: string }> }>(path, { headers })
    expect(
      (await children(`${V1}/tree/document/children?parentId=${home}`, inside(sale.key))).items.map(
        (i) => i.id,
      ),
    ).toEqual([key])
    expect((await children(`${V1}/tree/document/children?parentId=${home}`)).items).toEqual([])
  })

  test('someone else’s workspace is not there, and what a workspace cannot hold is refused', async () => {
    const { h, send, page, opened, inside, save } = await site()
    const home = await page('Home', 'Welcome')
    const sale = await opened(h, 'Spring sale')
    const writer = await signInAsGroup(h, 'writer')
    expect(
      (await writer.call(`${V1}/document/${home}`, { headers: inside(sale.key) })).status,
    ).toBe(404)
    expect(
      (await h.call(`${V1}/document/${home}`, { headers: inside(crypto.randomUUID()) })).status,
    ).toBe(404)
    const domains = await send(
      h,
      'PUT',
      `${V1}/document/${home}/domains`,
      { defaultIsoCode: null, domains: [] },
      inside(sale.key),
    )
    expect(domains.status).toBe(409)
    expect(await domains.json()).toMatchObject({ detail: expect.stringContaining('hostnames') })
    const copy = await send(
      h,
      'POST',
      `${V1}/document/${home}/copy`,
      { target: null, relateToOriginal: false, includeDescendants: false },
      inside(sale.key),
    )
    expect(copy.status).toBe(409)
    // A save without the header is Shared's, as ever.
    expect((await save(h, home, 'Hello')).status).toBe(200)
  })

  test('with workspaces off, their routes and the header are refused, and nothing else changes', async () => {
    const { h, send, page, save, titleOf } = await site(false)
    const home = await page('Home', 'Welcome')
    expect((await send(h, 'POST', WORKSPACES, { name: 'Sale' })).status).toBe(404)
    expect((await h.call(WORKSPACES)).status).toBe(404)
    // What the back office asks at every sign-in says no, rather than refusing (story 380).
    expect(await h.json<unknown>(`${WORKSPACES}/mine`)).toEqual({
      required: false,
      workspace: null,
      contentLocked: false,
      editedAt: null,
      enabled: expect.any(Boolean),
      mayMerge: expect.any(Boolean),
    })
    expect(
      (
        await h.call(`${V1}/document/${home}`, {
          headers: { 'crombolo-workspace': crypto.randomUUID() },
        })
      ).status,
    ).toBe(400)
    expect((await save(h, home, 'Hello')).status).toBe(200)
    expect(await titleOf(h, home)).toBe('Hello')
  })
})
