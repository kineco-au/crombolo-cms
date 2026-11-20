/**
 * Story 388: a site that takes its content by change. With CROMBOLO_CONTENT=locked its
 * pages, media, types and code are refused in the back office and the API, saying so;
 * a change applied to it still writes, and members are written as before. On the site
 * where content is made, a publish closes the publisher's change and raises an event
 * naming it, for a host to pass on.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import {
  ChangeRepository,
  ComponentRepository,
  ContentTypeRepository,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import { contentFilesLocked, encodePng, loadConfig, REMOTE_API_PATH } from '@crombolo/server'
import { editedHref } from '../packages/backoffice-host/plugin/content-locked.js'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

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

[[property]]
alias = "intro"
name = "Intro"
type = "textstring"
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const HOME = '6b2f1f0e-3c1d-4a8e-9f00-000000000383'

interface Bytes {
  bytes: Uint8Array
  sha: string
}

/** One copy of the site, holding Home as both copies began. */
async function site(extra: Record<string, unknown> = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'content-locked-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      schemaWritable: true,
      workspaces: true,
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 16 * 1024 ** 2,
        access: 'all',
      },
      ...extra,
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
  const remote = (path: string, init: RequestInit = {}) =>
    h.server.fetch(
      new Request(`${ORIGIN}${REMOTE_API_PATH}/environments/production/${path}`, {
        ...init,
        headers: { cookie: h.cookie(), ...(init.headers as Record<string, string>) },
      }),
    )
  const page = async (
    name: string,
    values: Record<string, string>,
    options: { key?: string; parent?: string | null; workspace?: string } = {},
  ) => {
    const created = await send(
      'POST',
      `${V1}/document`,
      {
        ...(options.key ? { id: options.key } : {}),
        documentType: { id: typeKey },
        template: { id: componentKey },
        parent: options.parent ? { id: options.parent } : null,
        values: Object.entries(values).map(([alias, value]) => ({
          alias,
          culture: null,
          segment: null,
          value,
        })),
        variants: [{ culture: null, segment: null, name }],
      },
      options.workspace ? { 'crombolo-workspace': options.workspace } : {},
    )
    expect(created.status, await created.clone().text()).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    const published = await send(
      'PUT',
      `${V1}/document/${key}/publish`,
      { publishSchedules: [{ culture: null }] },
      options.workspace ? { 'crombolo-workspace': options.workspace } : {},
    )
    expect(published.status).toBe(200)
    return key
  }
  const read = async (key: string, workspace?: string) =>
    (await (
      await h.call(`${V1}/document/${key}`, {
        headers: workspace ? { 'crombolo-workspace': workspace } : {},
      })
    ).json()) as Record<string, unknown> & {
      values: Array<{ alias: string; value: unknown }>
    }
  const fieldValue = async (key: string, alias: string, workspace?: string) =>
    (await read(key, workspace)).values.find((v) => v.alias === alias)?.value
  /** Saves values on a page, in a workspace when one is named. */
  const edit = async (key: string, values: Record<string, string>, workspace?: string) => {
    const document = await read(key, workspace)
    const merged = document.values.map((v) =>
      v.alias in values ? { ...v, value: values[v.alias] } : v,
    )
    for (const [alias, value] of Object.entries(values))
      if (!merged.some((v) => v.alias === alias))
        merged.push({ alias, culture: null, segment: null, value } as never)
    const headers = workspace ? { 'crombolo-workspace': workspace } : {}
    const saved = await send(
      'PUT',
      `${V1}/document/${key}`,
      { ...document, values: merged },
      headers,
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    const published = await send(
      'PUT',
      `${V1}/document/${key}/publish`,
      { publishSchedules: [{ culture: null }] },
      headers,
    )
    expect(published.status).toBe(200)
  }
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string }
  }
  const merge = async (key: string, accept: string[] = []) => {
    const response = await send('POST', `${WORKSPACES}/${key}/merge`, { accept })
    expect(response.status, await response.clone().text()).toBe(200)
  }
  const changes = async () =>
    (
      (await (await remote('changes')).json()) as {
        items: Array<{ id: string; key: string; kind: string; name: string | null }>
      }
    ).items
  /** A change taken from this site as its bundle's bytes. */
  const take = async (path: string): Promise<Bytes> => {
    const response = await remote(path)
    expect(response.status, await response.clone().text()).toBe(200)
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      sha: response.headers.get('crombolo-sha256') as string,
    }
  }
  /** A change sent here: applied, or staged with `?stage=true`. */
  const put = async (change: Bytes, query = '') =>
    remote(`changes${query}`, {
      method: 'PUT',
      body: change.bytes as Uint8Array<ArrayBuffer>,
      headers: { 'crombolo-sha256': change.sha, 'content-type': 'application/gzip' },
    })
  const held = async (keys: string[]) =>
    ((await (await remote(`changes/held?keys=${keys.join(',')}`)).json()) as { held: string[] })
      .held
  const close = async () => {
    open.splice(open.indexOf(h), 1)
    await h.db.close()
  }
  /** An image made, in a workspace when one is named: its key and its file's address. */
  const image = async (name: string, workspace?: string) => {
    const id = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', id)
    form.set(
      'File',
      new File(
        [
          encodePng({
            width: 2,
            height: 2,
            data: new Uint8Array(16).fill(200),
          }) as Uint8Array<ArrayBuffer>,
        ],
        `${name}.png`,
      ),
    )
    expect((await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(201)
    const made = await send(
      'POST',
      `${V1}/media`,
      {
        mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Image },
        parent: null,
        values: [
          {
            alias: 'umbracoFile',
            culture: null,
            segment: null,
            value: { src: '', temporaryFileId: id, crops: [], focalPoint: null },
          },
        ],
        variants: [{ culture: null, segment: null, name }],
      },
      workspace ? { 'crombolo-workspace': workspace } : {},
    )
    expect(made.status, await made.clone().text()).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    const media = (await (
      await h.call(`${V1}/media/${key}`, {
        headers: workspace ? { 'crombolo-workspace': workspace } : {},
      })
    ).json()) as { values: Array<{ alias: string; value: { src: string } }> }
    return { key, src: media.values.find((v) => v.alias === 'umbracoFile')?.value.src as string }
  }
  const locked = h.server.config.contentEditing
  h.server.config.contentEditing = 'editable'
  await page('Home', { title: 'Welcome', intro: 'Hello' }, { key: HOME })
  h.server.config.contentEditing = locked
  return {
    image,
    h,
    send,
    remote,
    page,
    read,
    fieldValue,
    edit,
    opened,
    merge,
    changes,
    take,
    put,
    held,
    close,
  }
}

const LOCKED = { contentEditing: 'locked', contentEditedAt: 'https://edit.example.test/crombolo' }

describe(`a site that takes its content by change (${dialectUnderTest})`, () => {
  test('saving a page, a media item, a type or a component is refused, saying why', async () => {
    const s = await site(LOCKED)
    const document = await s.read(HOME)
    const saved = await s.send('PUT', `${V1}/document/${HOME}`, document)
    expect(saved.status).toBe(409)
    expect(JSON.stringify(await saved.json())).toContain('takes its content by change')
    const media = await s.send('POST', `${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Folder' }],
    })
    expect(media.status).toBe(409)
    const typeKey = (await new ContentTypeRepository(s.h.server.db).byAlias('page'))?.key
    const type = await s.send('GET', `${V1}/document-type/${typeKey}`)
    const typeSaved = await s.send('PUT', `${V1}/document-type/${typeKey}`, await type.json())
    expect(typeSaved.status).toBe(409)
    const view = await s.send('POST', `${V1}/partial-view`, {
      name: 'banner.tsx',
      parent: null,
      content: 'export default () => <p />\n',
    })
    expect(view.status).toBe(409)
    expect(await s.fieldValue(HOME, 'title')).toBe('Welcome')
  })

  test('members are written as before', async () => {
    const s = await site(LOCKED)
    const member = await s.send('POST', `${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: 'shop@example.test',
      username: 'shop',
      password: 'correct-horse-battery',
      isApproved: true,
      groups: [],
      values: [],
      variants: [{ culture: null, segment: null, name: 'shop' }],
    })
    expect(member.status).toBe(201)
  })

  test('a change applied to it still writes', async () => {
    const source = await site()
    const workspace = await source.opened('Spring sale')
    await source.edit(HOME, { title: 'Spring sale' }, workspace.key)
    await source.merge(workspace.key)
    const made = (await source.changes())[0] as { id: string }
    const bundle = await source.take(`changes/${made.id}/bundle`)
    await source.close()

    const served = await site(LOCKED)
    const applied = await served.put(bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    expect(await served.fieldValue(HOME, 'title')).toBe('Spring sale')
  }, 20_000)

  test('the back office is told it is locked and where content is edited; no workspace opens', async () => {
    const s = await site(LOCKED)
    const mine = (await (
      await s.send('GET', `${BACKOFFICE}/crombolo/api/workspaces/mine`)
    ).json()) as {
      contentLocked: boolean
      editedAt: string | null
      required: boolean
    }
    expect(mine).toMatchObject({
      contentLocked: true,
      editedAt: LOCKED.contentEditedAt,
      required: false,
    })
    const opened = await s.send('POST', `${BACKOFFICE}/crombolo/api/workspaces`, { name: 'Mine' })
    expect(opened.status).toBe(409)
    expect(
      editedHref(
        LOCKED.contentEditedAt,
        '/crombolo/section/content/workspace/document/edit/x',
        '/crombolo',
      ),
    ).toBe('https://edit.example.test/crombolo/section/content/workspace/document/edit/x')
    expect(editedHref(null, '/crombolo/x', '/crombolo')).toBeUndefined()
  })

  test('a publish where content is made closes the change and raises an event naming it', async () => {
    const s = await site()
    const announced = async () =>
      (
        await s.h.server.db.q
          .selectFrom('content_event')
          .select('facts')
          .where('kind', '=', 'change-published')
          .execute()
      ).map(
        (e) =>
          (JSON.parse(String(e.facts)) as { webhook: { change: { key: string } } }).webhook.change
            .key,
      )
    const seeded = (await announced()).length
    await s.edit(HOME, { title: 'Spring sale' })
    const first = await announced()
    expect(first).toHaveLength(seeded + 1)
    const key = first.at(-1) as string
    const change = await new ChangeRepository(s.h.server.db).byId(key)
    expect(change).toMatchObject({ kind: 'edit', pages: 1 })
    expect(change?.closedAt).not.toBeNull()

    // It carries the page as it was and as it is, and the next edit is another change.
    const bundle = await s.take(`changes/${change?.id}/bundle`)
    expect(bundle.bytes.length).toBeGreaterThan(0)
    await s.edit(HOME, { title: 'Summer' })
    const later = await announced()
    expect(later).toHaveLength(seeded + 2)
    expect(later.at(-1)).not.toBe(key)
  })

  test('the change a publish closed carries the page to the serving copy', async () => {
    const source = await site()
    await source.edit(HOME, { title: 'Spring sale' })
    const edits = (await source.changes()).filter((c) => c.kind === 'edit')
    const bundle = await source.take(`changes/${edits[0]?.id}/bundle`)
    await source.close()
    const served = await site(LOCKED)
    const applied = await served.put(bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    expect(await served.fieldValue(HOME, 'title')).toBe('Spring sale')
    expect(await served.fieldValue(HOME, 'intro')).toBe('Hello')
  }, 20_000)

  test('with the setting off, nothing changes', async () => {
    const s = await site()
    await s.edit(HOME, { title: 'Edited' })
    expect(await s.fieldValue(HOME, 'title')).toBe('Edited')
    const mine = (await (
      await s.send('GET', `${BACKOFFICE}/crombolo/api/workspaces/mine`)
    ).json()) as {
      contentLocked: boolean
    }
    expect(mine.contentLocked).toBe(false)
  })

  test('CROMBOLO_CONTENT is editable or locked, and locked content locks the code', () => {
    const env = Bun.env as Record<string, string | undefined>
    const before = env.CROMBOLO_CONTENT
    try {
      env.CROMBOLO_CONTENT = 'Locked'
      const config = loadConfig({})
      expect(config.contentEditing).toBe('locked')
      expect(contentFilesLocked(config)).toBe(true)
      env.CROMBOLO_CONTENT = 'sometimes'
      expect(() => loadConfig({})).toThrow('editable or locked')
    } finally {
      if (before === undefined) delete env.CROMBOLO_CONTENT
      else env.CROMBOLO_CONTENT = before
    }
    expect(loadConfig({}).contentEditing).toBe('editable')
  })
})
