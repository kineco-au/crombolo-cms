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
import { normaliseUuid, SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import {
  ChangeRepository,
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  NodeRepository,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import { contentFilesLocked, encodePng, loadConfig, REMOTE_API_PATH } from '@crombolo/server'
import {
  editedHref,
  linkable,
  lockedNotice,
} from '../packages/backoffice-host/plugin/content-locked.js'
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
async function site(extra: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'content-locked-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
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
    // Events have no order of their own, so each new one is told by what was there before.
    const seeded = await announced()
    await s.edit(HOME, { title: 'Spring sale' })
    const first = await announced()
    const fresh = first.filter((k) => !seeded.includes(k))
    expect(fresh).toHaveLength(1)
    const key = fresh[0] as string
    const change = await new ChangeRepository(s.h.server.db).byId(key)
    expect(change).toMatchObject({ kind: 'edit', pages: 1 })
    expect(change?.closedAt).not.toBeNull()

    // It carries the page as it was and as it is, and the next edit is another change.
    const bundle = await s.take(`changes/${change?.id}/bundle`)
    expect(bundle.bytes.length).toBeGreaterThan(0)
    await s.edit(HOME, { title: 'Summer' })
    const later = (await announced()).filter((k) => !first.includes(k))
    expect(later).toHaveLength(1)
    expect(later[0]).not.toBe(key)
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

// Story 412: a locked site's refusal says where content is edited.
describe(`a locked site's refusal names where content is edited (${dialectUnderTest})`, () => {
  const said = `This site's content is edited at ${LOCKED.contentEditedAt}. Changes reach it from there.`
  const refusals = async (s: Awaited<ReturnType<typeof site>>) => {
    const answers: Record<string, { status: number; body: Record<string, unknown> }> = {}
    const take = async (name: string, response: Response) => {
      answers[name] = {
        status: response.status,
        body: (await response.json()) as Record<string, unknown>,
      }
    }
    await take('page', await s.send('PUT', `${V1}/document/${HOME}`, await s.read(HOME)))
    await take(
      'media',
      await s.send('POST', `${V1}/media`, {
        mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
        parent: null,
        values: [],
        variants: [{ culture: null, segment: null, name: 'Folder' }],
      }),
    )
    const typeKey = (await new ContentTypeRepository(s.h.server.db).byAlias('page'))?.key
    const type = await (await s.send('GET', `${V1}/document-type/${typeKey}`)).json()
    await take('type', await s.send('PUT', `${V1}/document-type/${typeKey}`, type))
    await take(
      'code',
      await s.send('POST', `${V1}/partial-view`, {
        name: 'banner.tsx',
        parent: null,
        content: 'export default () => <p />\n',
      }),
    )
    await take(
      'environment value',
      await s.send('PUT', `${BACKOFFICE}/crombolo/api/environment-values/${HOME}`, {
        alias: 'title',
        environment: 'production',
        value: 'x',
      }),
    )
    await take(
      'workspace',
      await s.send('POST', `${BACKOFFICE}/crombolo/api/workspaces`, { name: 'Mine' }),
    )
    return answers
  }

  test('with the address set, every refusal names it, in the words and as editedAt', async () => {
    const s = await site(LOCKED)
    for (const [name, { status, body }] of Object.entries(await refusals(s))) {
      expect(status, name).toBe(409)
      expect(body.detail ?? body.message, name).toBe(said)
      expect(body.editedAt, name).toBe(LOCKED.contentEditedAt)
    }
    const env = (await (
      await s.send('GET', `${BACKOFFICE}/crombolo/api/environment-values`)
    ).json()) as {
      editedAt: string | null
    }
    expect(env.editedAt).toBe(LOCKED.contentEditedAt)
  })

  test('with none set, each says what it said before, with no editedAt', async () => {
    const s = await site({ contentEditing: 'locked' })
    for (const [name, { status, body }] of Object.entries(await refusals(s))) {
      expect(status, name).toBe(409)
      expect(JSON.stringify(body), name).not.toContain('edited at')
      expect(body.editedAt, name).toBeUndefined()
    }
  })

  test('the back office’s notice links to the same item there, only for a web address', () => {
    const notice = lockedNotice(
      409,
      { title: 'x', editedAt: LOCKED.contentEditedAt },
      '/crombolo/section/settings/workspace/document-type/edit/abc',
      '/crombolo',
    )
    expect(notice).toEqual({
      headline: 'This is edited on another site',
      message: said,
      href: 'https://edit.example.test/crombolo/section/settings/workspace/document-type/edit/abc',
    })
    expect(lockedNotice(409, { title: 'x' }, '/crombolo/x', '/crombolo')).toBeUndefined()
    expect(
      lockedNotice(412, { editedAt: 'https://e.test' }, '/crombolo/x', '/crombolo'),
    ).toBeUndefined()
    for (const address of ['javascript:alert(1)', 'ftp://e.test', 'edit.example.test', ''])
      expect(linkable(address), address).toBe(false)
    expect(
      lockedNotice(409, { editedAt: 'javascript:alert(1)' }, '/crombolo/x', '/crombolo')?.href,
    ).toBeUndefined()
    expect(editedHref('javascript:alert(1)', '/crombolo/x', '/crombolo')).toBeUndefined()
  })
})

// Story 411: an unpublish, a move, a reorder and a delete are passed on as a publish is.
const ALPHA = '6b2f1f0e-3c1d-4a8e-9f00-0000000411a1'
const BETA = '6b2f1f0e-3c1d-4a8e-9f00-0000000411b2'
const GAMMA = '6b2f1f0e-3c1d-4a8e-9f00-0000000411c3'

type Announced = {
  key: string
  kind?: string
  from?: string
  page?: { key: string; name: string | null }
}

/** Alpha, Beta and Gamma under Home, made as the site's seed is, whatever it takes. */
async function threePages(s: Awaited<ReturnType<typeof site>>) {
  const was = s.h.server.config.contentEditing
  s.h.server.config.contentEditing = 'editable'
  await s.page('Alpha', { title: 'A' }, { key: ALPHA, parent: HOME })
  await s.page('Beta', { title: 'B' }, { key: BETA, parent: HOME })
  await s.page('Gamma', { title: 'C' }, { key: GAMMA, parent: HOME })
  s.h.server.config.contentEditing = was
}

/** The changes announced since it last looked. */
function announcements(s: Awaited<ReturnType<typeof site>>) {
  const seen = new Set<string>()
  const all = async () =>
    (
      await s.h.server.db.q
        .selectFrom('content_event')
        .select(['id', 'facts'])
        .where('kind', '=', 'change-published')
        .execute()
    ).map((e) => ({
      id: String(e.id),
      change: (JSON.parse(String(e.facts)) as { webhook: { change: Announced } }).webhook.change,
    }))
  return {
    async fresh(): Promise<Announced[]> {
      const out = (await all()).filter((e) => !seen.has(e.id))
      for (const e of out) seen.add(e.id)
      return out.map((e) => e.change)
    },
  }
}

const childrenOf = async (s: Awaited<ReturnType<typeof site>>, parent: string) =>
  (await new DocumentRepository(s.h.server.db).children(parent, 0, 100)).items.map((n) =>
    normaliseUuid(n.key),
  )
const parentOf = async (s: Awaited<ReturnType<typeof site>>, key: string) => {
  const nodes = new NodeRepository(s.h.server.db)
  const node = await nodes.byKey(key)
  return node ? ((await nodes.byId(node.parentId))?.key ?? null) : undefined
}
const stateOf = async (s: Awaited<ReturnType<typeof site>>, key: string, workspace?: string) =>
  ((await s.read(key, workspace)).variants as Array<{ state: string }>)[0]?.state

describe(`an unpublish, a move, a reorder and a delete are passed on (${dialectUnderTest}, story 411)`, () => {
  test('straight in Shared, each closes the change and is announced once, saying what it did', async () => {
    const s = await site()
    await threePages(s)
    const told = announcements(s)
    await told.fresh()

    expect(
      (await s.send('PUT', `${V1}/document/${ALPHA}/unpublish`, { cultures: null })).status,
    ).toBe(200)
    expect(await told.fresh()).toEqual([expect.objectContaining({ kind: 'unpublish' })])
    expect(
      (await s.send('PUT', `${V1}/document/${BETA}/move`, { target: { id: ALPHA } })).status,
    ).toBe(200)
    expect(await told.fresh()).toEqual([expect.objectContaining({ kind: 'move' })])
    expect(
      (
        await s.send('PUT', `${V1}/document/sort`, {
          parent: { id: HOME },
          sorting: [
            { id: GAMMA, sortOrder: 0 },
            { id: ALPHA, sortOrder: 1 },
          ],
        })
      ).status,
    ).toBe(200)
    expect(await told.fresh()).toEqual([expect.objectContaining({ kind: 'reorder' })])
    expect((await s.send('PUT', `${V1}/document/${GAMMA}/move-to-recycle-bin`, {})).status).toBe(
      200,
    )
    const deleted = await told.fresh()
    expect(deleted).toEqual([
      expect.objectContaining({ kind: 'delete', page: { key: GAMMA, name: 'Gamma' } }),
    ])
    // Emptying the bin says nothing more; a publish says no kind, as before.
    expect((await s.send('DELETE', `${V1}/recycle-bin/document`)).status).toBe(200)
    expect(await told.fresh()).toEqual([])
    await s.edit(ALPHA, { title: 'A2' })
    const published = await told.fresh()
    expect(published).toHaveLength(1)
    expect(published[0]?.kind).toBeUndefined()
  }, 30_000)

  test('each change, taken to the serving copy, does the same there', async () => {
    const source = await site()
    await threePages(source)
    const told = announcements(source)
    await told.fresh()
    await source.send('PUT', `${V1}/document/${ALPHA}/unpublish`, { cultures: null })
    await source.send('PUT', `${V1}/document/${BETA}/move`, { target: { id: ALPHA } })
    await source.send('PUT', `${V1}/document/sort`, {
      parent: { id: HOME },
      sorting: [
        { id: GAMMA, sortOrder: 0 },
        { id: ALPHA, sortOrder: 1 },
      ],
    })
    await source.send('PUT', `${V1}/document/${GAMMA}/move-to-recycle-bin`, {})
    const keys = (await told.fresh()).map((c) => c.key)
    expect(keys).toHaveLength(4)
    const listed = await source.changes()
    const bundles = []
    for (const key of keys) {
      const id = listed.find((c) => c.key === key)?.id
      bundles.push(await source.take(`changes/${id}/bundle`))
    }
    await source.close()

    const served = await site(LOCKED)
    await threePages(served)
    for (const bundle of bundles) {
      // A delete is settled as any loss of content is: accepted.
      const applied = await served.put(bundle, '?accept=page-deleted')
      expect(applied.status, await applied.clone().text()).toBe(200)
    }
    expect(await stateOf(served, ALPHA)).toBe('Draft')
    expect(await parentOf(served, BETA)).toBe(ALPHA)
    expect(await childrenOf(served, HOME)).toEqual([ALPHA])
    expect((await new NodeRepository(served.h.server.db).byKey(GAMMA))?.trashed ?? true).toBe(true)
  }, 60_000)

  test('a reorder the serving copy made since is a conflict', async () => {
    const source = await site()
    await threePages(source)
    const told = announcements(source)
    await told.fresh()
    await source.send('PUT', `${V1}/document/sort`, {
      parent: { id: HOME },
      sorting: [
        { id: GAMMA, sortOrder: 0 },
        { id: BETA, sortOrder: 1 },
        { id: ALPHA, sortOrder: 2 },
      ],
    })
    const [reordered] = await told.fresh()
    const id = (await source.changes()).find((c) => c.key === reordered?.key)?.id
    const bundle = await source.take(`changes/${id}/bundle`)
    await source.close()
    const served = await site()
    await threePages(served)
    await served.send('PUT', `${V1}/document/sort`, {
      parent: { id: HOME },
      sorting: [
        { id: BETA, sortOrder: 0 },
        { id: ALPHA, sortOrder: 1 },
        { id: GAMMA, sortOrder: 2 },
      ],
    })
    const applied = await served.put(bundle)
    expect(await applied.text()).toContain('put in another order here since')
    expect(await childrenOf(served, HOME)).toEqual([BETA, ALPHA, GAMMA])
  }, 60_000)

  test('in a person’s own workspace, done to a page Shared has, each merges at once and is announced', async () => {
    const s = await site()
    await threePages(s)
    const told = announcements(s)
    await told.fresh()
    const mine = { 'crombolo-workspace': 'mine' }

    const unpublished = await s.send(
      'PUT',
      `${V1}/document/${ALPHA}/unpublish`,
      { cultures: null },
      mine,
    )
    expect(unpublished.status, await unpublished.clone().text()).toBe(200)
    expect(await stateOf(s, ALPHA)).toBe('Draft')
    expect(await told.fresh()).toEqual([
      expect.objectContaining({ kind: 'unpublish', from: 'own-workspace' }),
    ])

    expect(
      (await s.send('PUT', `${V1}/document/${BETA}/move`, { target: { id: ALPHA } }, mine)).status,
    ).toBe(200)
    expect(await parentOf(s, BETA)).toBe(ALPHA)
    expect(await told.fresh()).toEqual([
      expect.objectContaining({ kind: 'move', from: 'own-workspace' }),
    ])

    expect(
      (await s.send('PUT', `${V1}/document/${GAMMA}/move-to-recycle-bin`, {}, mine)).status,
    ).toBe(200)
    expect((await new NodeRepository(s.h.server.db).byKey(GAMMA))?.trashed).toBe(true)
    expect(await told.fresh()).toEqual([
      expect.objectContaining({
        kind: 'delete',
        from: 'own-workspace',
        page: { key: GAMMA, name: 'Gamma' },
      }),
    ])

    // A page made there and never merged is only changed there.
    const draft = await s.send(
      'POST',
      `${V1}/document`,
      {
        documentType: { id: (await new ContentTypeRepository(s.h.server.db).byAlias('page'))?.key },
        parent: { id: HOME },
        values: [],
        variants: [{ culture: null, segment: null, name: 'Draft only' }],
      },
      mine,
    )
    expect(draft.status, await draft.clone().text()).toBe(201)
    const made = draft.headers.get('umb-generated-resource') as string
    expect(
      (await s.send('PUT', `${V1}/document/${made}/move-to-recycle-bin`, {}, mine)).status,
    ).toBe(200)
    expect(await told.fresh()).toEqual([])
  }, 60_000)

  test('a named workspace’s merge announces none of them', async () => {
    const s = await site()
    await threePages(s)
    const told = announcements(s)
    await told.fresh()
    const named = await s.opened('Spring')
    const within = { 'crombolo-workspace': named.key }
    expect(
      (await s.send('PUT', `${V1}/document/${BETA}/move`, { target: { id: ALPHA } }, within))
        .status,
    ).toBe(200)
    await s.merge(named.key)
    expect(await parentOf(s, BETA)).toBe(ALPHA)
    expect(await told.fresh()).toEqual([])
  }, 30_000)

  test('a restore is announced as a move, a delete for good from outside the bin as a delete, and a reorder in one’s own workspace merges at once', async () => {
    const s = await site()
    await threePages(s)
    const told = announcements(s)
    await told.fresh()
    await s.send('PUT', `${V1}/document/${GAMMA}/move-to-recycle-bin`, {})
    await told.fresh()
    const restored = await s.send('PUT', `${V1}/recycle-bin/document/${GAMMA}/restore`, {
      target: { id: HOME },
    })
    expect(restored.status, await restored.clone().text()).toBe(200)
    expect(await told.fresh()).toEqual([expect.objectContaining({ kind: 'move' })])

    const gone = await s.send('DELETE', `${V1}/document/${BETA}`)
    expect(gone.status, await gone.clone().text()).toBe(200)
    expect(await told.fresh()).toEqual([
      expect.objectContaining({ kind: 'delete', page: { key: BETA, name: 'Beta' } }),
    ])

    const mine = { 'crombolo-workspace': 'mine' }
    const sorted = await s.send(
      'PUT',
      `${V1}/document/sort`,
      {
        parent: { id: HOME },
        sorting: [
          { id: GAMMA, sortOrder: 0 },
          { id: ALPHA, sortOrder: 1 },
        ],
      },
      mine,
    )
    expect(sorted.status, await sorted.clone().text()).toBe(200)
    expect((await childrenOf(s, HOME)).filter((k) => k === GAMMA || k === ALPHA)).toEqual([
      GAMMA,
      ALPHA,
    ])
    expect(await told.fresh()).toEqual([
      expect.objectContaining({ kind: 'reorder', from: 'own-workspace' }),
    ])
  }, 30_000)
})

// Story 414: a schedule set in a workspace goes with its change.
describe(`a schedule set in a workspace goes with its change (${dialectUnderTest}, story 414)`, () => {
  const inAnHour = () => new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000)
  const entriesOf = (s: Awaited<ReturnType<typeof site>>, key: string) =>
    new DocumentRepository(s.h.server.db).scheduleEntries(key)
  const schedule = (
    s: Awaited<ReturnType<typeof site>>,
    key: string,
    times: { publishTime?: string; unpublishTime?: string } | null,
    headers = {},
  ) =>
    s.send(
      'PUT',
      `${V1}/document/${key}/publish`,
      { publishSchedules: [{ culture: null, schedule: times }] },
      headers,
    )

  test('set in one’s own workspace, it merges the page, its change holds it, and the serving copy fires it', async () => {
    const source = await site()
    await threePages(source)
    const told = announcements(source)
    await told.fresh()
    const mine = { 'crombolo-workspace': 'mine' }
    const at = inAnHour()

    const set = await schedule(source, ALPHA, { unpublishTime: at.toISOString() }, mine)
    expect(set.status, await set.clone().text()).toBe(200)
    // An instant, carried as one.
    expect(await entriesOf(source, ALPHA)).toEqual([
      { culture: null, publishTime: null, unpublishTime: at.toISOString() },
    ])
    const [announced] = await told.fresh()
    expect(announced).toMatchObject({ from: 'own-workspace' })
    const id = (await source.changes()).find((c) => c.key === announced?.key)?.id
    const bundle = await source.take(`changes/${id}/bundle`)

    // Cleared there, it is cleared in Shared, and that change carries the clearing.
    expect((await schedule(source, ALPHA, null, mine)).status).toBe(200)
    expect(await entriesOf(source, ALPHA)).toEqual([])
    const [cleared] = await told.fresh()
    const clearedId = (await source.changes()).find((c) => c.key === cleared?.key)?.id
    const clearing = await source.take(`changes/${clearedId}/bundle`)
    await source.close()

    const served = await site(LOCKED)
    await threePages(served)
    expect((await served.put(bundle)).status).toBe(200)
    expect(await entriesOf(served, ALPHA)).toEqual([
      { culture: null, publishTime: null, unpublishTime: at.toISOString() },
    ])
    const firing = announcements(served)
    await firing.fresh()
    await served.h.server.jobs.runScheduledPublishing(new Date(at.getTime() + 1000))
    expect(await stateOf(served, ALPHA)).toBe('Draft')
    // It names the change that set it.
    expect(await firing.fresh()).toEqual([
      expect.objectContaining({ key: announced?.key, kind: 'unpublish' }),
    ])

    // The clearing, taken there, clears a schedule there.
    const served2 = await site(LOCKED)
    await threePages(served2)
    expect((await served2.put(bundle)).status).toBe(200)
    expect((await served2.put(clearing)).status).toBe(200)
    expect(await entriesOf(served2, ALPHA)).toEqual([])
  }, 60_000)

  test('a page made in the workspace with a schedule arrives unpublished and goes live at its time', async () => {
    const s = await site()
    const mine = { 'crombolo-workspace': 'mine' }
    const made = await s.send(
      'POST',
      `${V1}/document`,
      {
        documentType: { id: (await new ContentTypeRepository(s.h.server.db).byAlias('page'))?.key },
        parent: { id: HOME },
        values: [],
        variants: [{ culture: null, segment: null, name: 'Coming soon' }],
      },
      mine,
    )
    expect(made.status, await made.clone().text()).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    const at = inAnHour()
    const set = await schedule(s, key, { publishTime: at.toISOString() }, mine)
    expect(set.status, await set.clone().text()).toBe(200)
    expect(await stateOf(s, key)).toBe('Draft')
    expect(await entriesOf(s, key)).toEqual([
      { culture: null, publishTime: at.toISOString(), unpublishTime: null },
    ])
    await s.h.server.jobs.runScheduledPublishing(new Date(at.getTime() + 1000))
    expect(await stateOf(s, key)).toBe('Published')
  }, 30_000)

  test('a named workspace’s merge carries its schedules, and one Shared changed since is a conflict', async () => {
    const s = await site()
    await threePages(s)
    const named = await s.opened('Spring')
    const within = { 'crombolo-workspace': named.key }
    const at = inAnHour()
    expect((await schedule(s, BETA, { unpublishTime: at.toISOString() }, within)).status).toBe(200)
    expect(await entriesOf(s, BETA)).toEqual([])
    // Shared sets its own meanwhile.
    const other = new Date(at.getTime() + 3_600_000)
    expect((await schedule(s, BETA, { unpublishTime: other.toISOString() })).status).toBe(200)
    const refused = await s.send('POST', `${WORKSPACES}/${named.key}/merge`, { accept: [] })
    expect(refused.status).toBe(409)
    expect(await refused.text()).toContain('schedule-changed')

    await s.merge(named.key, ['schedule-changed'])
    expect(await entriesOf(s, BETA)).toEqual([
      { culture: null, publishTime: null, unpublishTime: at.toISOString() },
    ])
    const merged = (await s.changes()).find((c) => c.kind === 'merge')
    const items = await new ChangeRepository(s.h.server.db).itemsOf(merged?.id as string, {
      pages: true,
    })
    expect(items.map((i) => i.path)).toContain(`schedules/${BETA}`)
  }, 30_000)
})

// Story 423: a staged change's schedule is set however it is merged.
describe(`a staged change’s schedule is set however it is merged (${dialectUnderTest}, story 423)`, () => {
  const inAnHour = () => new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000)
  const mine = { 'crombolo-workspace': 'mine' }
  type Site = Awaited<ReturnType<typeof site>>
  const entriesOf = (s: Site, key: string) =>
    new DocumentRepository(s.h.server.db).scheduleEntries(key)
  const schedule = (
    s: Site,
    key: string,
    times: { publishTime?: string; unpublishTime?: string } | null,
  ) =>
    s.send(
      'PUT',
      `${V1}/document/${key}/publish`,
      { publishSchedules: [{ culture: null, schedule: times }] },
      mine,
    )
  /** A page of a type made in the person's own workspace, only scheduled. */
  const madeScheduled = async (s: Site, type: string, parent: string | null, at: Date) => {
    const made = await s.send(
      'POST',
      `${V1}/document`,
      {
        documentType: { id: (await new ContentTypeRepository(s.h.server.db).byAlias(type))?.key },
        parent: parent ? { id: parent } : null,
        values: [],
        variants: [{ culture: null, segment: null, name: 'Coming soon' }],
      },
      mine,
    )
    expect(made.status, await made.clone().text()).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    const set = await schedule(s, key, { publishTime: at.toISOString() })
    expect(set.status, await set.clone().text()).toBe(200)
    return key
  }
  /** The bundle of the change last announced. */
  const lastBundle = async (s: Site, told: ReturnType<typeof announcements>) => {
    const [announced] = await told.fresh()
    const id = (await s.changes()).find((c) => c.key === announced?.key)?.id
    return { key: announced?.key as string, bundle: await s.take(`changes/${id}/bundle`) }
  }
  /** Staged, then merged through the workspace's own merge. */
  const stagedAndMerged = async (s: Site, bundle: Bytes) => {
    const staged = await s.put(bundle, '?stage=true')
    expect(staged.status, await staged.clone().text()).toBe(200)
    const { workspace } = (await staged.json()) as { workspace: string }
    return workspace
  }

  test('staged and merged through the workspace’s merge, the schedule is set, named and fired; a rehearsal sets nothing', async () => {
    const source = await site()
    await threePages(source)
    const told = announcements(source)
    await told.fresh()
    const at = inAnHour()
    const key = await madeScheduled(source, 'page', HOME, at)
    const made = await lastBundle(source, told)
    expect((await schedule(source, ALPHA, { unpublishTime: at.toISOString() })).status).toBe(200)
    const down = await lastBundle(source, told)
    expect((await schedule(source, ALPHA, null)).status).toBe(200)
    const cleared = await lastBundle(source, told)
    await source.close()

    const served = await site(LOCKED)
    await threePages(served)
    const workspace = await stagedAndMerged(served, made.bundle)
    const rehearsed = await served.send('POST', `${WORKSPACES}/${workspace}/merge`, {
      accept: [],
      rehearse: true,
    })
    expect(rehearsed.status, await rehearsed.clone().text()).toBe(200)
    expect(await entriesOf(served, key)).toEqual([])
    await served.merge(workspace)
    expect(await stateOf(served, key)).toBe('Draft')
    expect(await entriesOf(served, key)).toEqual([
      { culture: null, publishTime: at.toISOString(), unpublishTime: null },
    ])
    // The change it made here holds the schedule, for a site that takes it from here.
    const here = (await served.changes()).find((c) => c.key === made.key)
    const items = await new ChangeRepository(served.h.server.db).itemsOf(here?.id as string, {
      pages: true,
    })
    expect(items.map((i) => i.path)).toContain(`schedules/${normaliseUuid(key)}`)

    const firing = announcements(served)
    await firing.fresh()
    await served.h.server.jobs.runScheduledPublishing(new Date(at.getTime() + 1000))
    expect(await stateOf(served, key)).toBe('Published')
    expect(await firing.fresh()).toEqual([expect.objectContaining({ key: made.key })])

    // A time to come down at, on a page nothing else changed; then its clearing.
    await served.merge(await stagedAndMerged(served, down.bundle))
    expect(await entriesOf(served, ALPHA)).toEqual([
      { culture: null, publishTime: null, unpublishTime: at.toISOString() },
    ])
    await served.merge(await stagedAndMerged(served, cleared.bundle))
    expect(await entriesOf(served, ALPHA)).toEqual([])
  }, 90_000)

  test('a page a workflow covers is not scheduled: its time waits with its approval', async () => {
    const NOTICE = PAGE_TOML.replace('alias = "page"', 'alias = "notice"').replace(
      'name = "Page"',
      'name = "Notice"',
    )
    const WORKFLOW = `[workflow]
alias = "notices"
name = "Notices"
applies-to = { branches = [], content-types = ["notice"] }
publishers-may-skip = false
scheduling = true

[[stage]]
alias = "legal"
approvers = ["admin"]
`
    const source = await site({}, { 'schema/content-types/notice.toml': NOTICE })
    const told = announcements(source)
    await told.fresh()
    const at = inAnHour()
    const key = await madeScheduled(source, 'notice', null, at)
    const made = await lastBundle(source, told)
    await source.close()

    const served = await site(LOCKED, {
      'schema/content-types/notice.toml': NOTICE,
      'schema/workflows/notices.toml': WORKFLOW,
    })
    await served.merge(await stagedAndMerged(served, made.bundle))
    expect(await entriesOf(served, key)).toEqual([])
    const tab = (await (
      await served.h.call(`${BACKOFFICE}/crombolo/api/approvals/page/${key}`)
    ).json()) as { request?: { state: string; action: string; schedule: unknown } }
    expect(tab.request).toMatchObject({
      state: 'waiting',
      action: 'publish',
      schedule: [{ culture: null, publishTime: at.toISOString(), unpublishTime: null }],
    })
    // Its time passes with nobody having approved it: it stays as it arrived.
    await served.h.server.jobs.runScheduledPublishing(new Date(at.getTime() + 1000))
    expect(await stateOf(served, key)).toBe('Draft')
  }, 60_000)
})

// Story 425: a page that arrives by a change takes its place in the order.
describe(`a page that arrives by a change takes its place in the order (${dialectUnderTest}, story 425)`, () => {
  type Site = Awaited<ReturnType<typeof site>>
  const sort = (s: Site, keys: string[]) =>
    s.send('PUT', `${V1}/document/sort`, {
      parent: { id: HOME },
      sorting: keys.map((id, sortOrder) => ({ id, sortOrder })),
    })
  const lastBundle = async (s: Site, told: ReturnType<typeof announcements>) => {
    const [announced] = await told.fresh()
    const id = (await s.changes()).find((c) => c.key === announced?.key)?.id
    return s.take(`changes/${id}/bundle`)
  }
  const taken = async (s: Site, bundle: Bytes) => {
    const applied = await s.put(bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
  }

  test('pages that arrive in another order end in the order they were made in, and a reorder follows', async () => {
    const source = await site()
    const told = announcements(source)
    await told.fresh()
    const made: Bytes[] = []
    for (const [name, key] of [
      ['Alpha', ALPHA],
      ['Beta', BETA],
      ['Gamma', GAMMA],
    ] as const) {
      await source.page(name, { title: name }, { key, parent: HOME })
      made.push(await lastBundle(source, told))
    }
    expect((await sort(source, [GAMMA, ALPHA, BETA])).status).toBe(200)
    const reordered = await lastBundle(source, told)
    // Moved under Alpha, it is kept with its place there too.
    await source.send('PUT', `${V1}/document/${GAMMA}/move`, { target: { id: ALPHA } })
    const moved = await lastBundle(source, told)
    await source.close()

    const served = await site(LOCKED)
    // Beta last, as one that waited for something a later change brought.
    for (const bundle of [made[0], made[2], made[1]]) await taken(served, bundle as Bytes)
    expect(await childrenOf(served, HOME)).toEqual([ALPHA, BETA, GAMMA])
    await taken(served, reordered)
    expect(await childrenOf(served, HOME)).toEqual([GAMMA, ALPHA, BETA])
    await taken(served, moved)
    expect(await childrenOf(served, HOME)).toEqual([ALPHA, BETA])
    expect(await childrenOf(served, ALPHA)).toEqual([GAMMA])
  }, 90_000)

  test('where content is locked a reorder is applied over another order; a merge keeps the place of a page it made', async () => {
    const source = await site()
    await threePages(source)
    const told = announcements(source)
    await told.fresh()
    expect((await sort(source, [GAMMA, ALPHA, BETA])).status).toBe(200)
    const reordered = await lastBundle(source, told)
    const named = await source.opened('Spring')
    await source.page('Delta', { title: 'D' }, { parent: HOME, workspace: named.key })
    await source.merge(named.key)
    const merged = (await source.changes()).find((c) => c.kind === 'merge')
    const items = await new ChangeRepository(source.h.server.db).itemsOf(merged?.id as string, {
      pages: true,
    })
    expect(items.map((i) => i.path)).toContain(`siblings/${HOME}`)
    await source.close()

    // Its pages in another order, as ones that arrived so: nobody sorts a locked site.
    const served = await site(LOCKED)
    await threePages(served)
    served.h.server.config.contentEditing = 'editable'
    expect((await sort(served, [BETA, ALPHA, GAMMA])).status).toBe(200)
    served.h.server.config.contentEditing = 'locked'
    await taken(served, reordered)
    expect(await childrenOf(served, HOME)).toEqual([GAMMA, ALPHA, BETA])
  }, 60_000)
})

// Story 417: a change that only schedules says so, with its times.
describe(`a change that only schedules says so (${dialectUnderTest}, story 417)`, () => {
  const later = () => new Date(Math.floor(Date.now() / 1000) * 1000 + 3_600_000).toISOString()
  const scheduleOf = (
    s: Awaited<ReturnType<typeof site>>,
    key: string,
    times: { publishTime?: string; unpublishTime?: string } | null,
    headers = {},
  ) =>
    s.send(
      'PUT',
      `${V1}/document/${key}/publish`,
      { publishSchedules: [{ culture: null, schedule: times }] },
      headers,
    )
  type Told = Announced & { schedule?: unknown[] }

  test('setting and clearing a time says schedule with the times; a publish that sets one says none', async () => {
    const s = await site()
    await threePages(s)
    const told = announcements(s)
    await s.send('PUT', `${V1}/document/${ALPHA}/unpublish`, { cultures: null })
    await told.fresh()
    const at = later()

    expect((await scheduleOf(s, ALPHA, { publishTime: at })).status).toBe(200)
    expect((await told.fresh()) as Told[]).toEqual([
      expect.objectContaining({
        kind: 'schedule',
        schedule: [{ culture: null, publishTime: at, unpublishTime: null }],
      }),
    ])
    // Cleared through a publish, which publishes it now: a publish, carrying no times.
    expect((await scheduleOf(s, ALPHA, null)).status).toBe(200)
    const cleared = (await told.fresh()) as Told[]
    expect(cleared).toEqual([expect.objectContaining({ schedule: [] })])
    expect(cleared[0]?.kind).toBeUndefined()

    // Live now and down later is a publish, carrying the time.
    expect((await scheduleOf(s, BETA, { unpublishTime: at })).status).toBe(200)
    expect(await stateOf(s, BETA)).toBe('Published')
    const published = (await told.fresh()) as Told[]
    expect(published).toEqual([
      expect.objectContaining({
        schedule: [{ culture: null, publishTime: null, unpublishTime: at }],
      }),
    ])
    expect(published[0]?.kind).toBeUndefined()
  }, 30_000)

  test('in a person’s own workspace, a page only scheduled says schedule', async () => {
    const s = await site()
    await threePages(s)
    const told = announcements(s)
    await s.send('PUT', `${V1}/document/${GAMMA}/unpublish`, { cultures: null })
    await told.fresh()
    const at = later()
    const set = await scheduleOf(s, GAMMA, { publishTime: at }, { 'crombolo-workspace': 'mine' })
    expect(set.status, await set.clone().text()).toBe(200)
    expect((await told.fresh()) as Told[]).toEqual([
      expect.objectContaining({
        kind: 'schedule',
        from: 'own-workspace',
        schedule: [{ culture: null, publishTime: at, unpublishTime: null }],
      }),
    ])
  }, 30_000)
})

describe(`a promoted delete goes to the recycle bin (${dialectUnderTest}, story 430)`, () => {
  type Site = Awaited<ReturnType<typeof site>>
  const nodeOf = (s: Site, key: string) => new NodeRepository(s.h.server.db).byKey(key)
  const CHILD = '6b2f1f0e-3c1d-4a8e-9f00-000000000430'

  /** The changes `work` makes on a source with the three pages, each taken as its bundle. */
  async function made(work: (s: Site, take: () => Promise<void>) => Promise<void>) {
    const source = await site()
    await threePages(source)
    const told = announcements(source)
    await told.fresh()
    const bundles: Bytes[] = []
    const take = async () => {
      for (const { key } of await told.fresh()) {
        const id = (await source.changes()).find((c) => c.key === key)?.id
        bundles.push(await source.take(`changes/${id}/bundle`))
      }
    }
    await work(source, take)
    await take()
    await source.close()
    return bundles
  }
  const bin = async (s: Site) => {
    const sent = await s.send('PUT', `${V1}/document/${GAMMA}/move-to-recycle-bin`, {})
    expect(sent.status, await sent.clone().text()).toBe(200)
  }
  const apply = async (s: Site, bundle: Bytes, query = '?accept=page-deleted') => {
    const applied = await s.put(bundle, query)
    expect(applied.status, await applied.clone().text()).toBe(200)
  }
  const target = async () => {
    const s = await site()
    await threePages(s)
    return s
  }

  test('one moved to the bin is binned with its history and branch, and the restore takes it out', async () => {
    const [deleted, restored] = await made(async (s, take) => {
      await bin(s)
      await take()
      const back = await s.send('PUT', `${V1}/recycle-bin/document/${GAMMA}/restore`, {
        target: { id: HOME },
      })
      expect(back.status).toBe(200)
    })
    const s = await target()
    await s.page('Only here', { title: 'D' }, { key: CHILD, parent: GAMMA })
    const before = await nodeOf(s, GAMMA)
    const head = await new DocumentRepository(s.h.server.db).eventMarkers(GAMMA)

    // Staged, the merge says where it goes, and asks for it.
    const staged = await s.put(deleted as Bytes, '?stage=true')
    const { workspace } = (await staged.json()) as { workspace: string }
    const refused = await s.send('POST', `${WORKSPACES}/${workspace}/merge`, { accept: [] })
    expect(refused.status).toBe(409)
    expect(await refused.text()).toContain('moved to the recycle bin')
    await s.merge(workspace, ['page-deleted'])

    const binned = await nodeOf(s, GAMMA)
    expect(binned?.id).toBe(before?.id as number)
    expect(binned?.trashed).toBe(true)
    expect((await nodeOf(s, CHILD))?.trashed).toBe(true)
    expect(await parentOf(s, CHILD)).toBe(GAMMA)

    await apply(s, restored as Bytes)
    expect((await nodeOf(s, GAMMA))?.trashed).toBe(false)
    expect(await parentOf(s, GAMMA)).toBe(HOME)
    expect((await new DocumentRepository(s.h.server.db).eventMarkers(GAMMA))?.head).toBe(
      head?.head as number,
    )
  }, 60_000)

  test('one deleted for good is binned; one already in the bin needs nothing; its address is free', async () => {
    const [deleted] = await made(async (s) => {
      expect((await s.send('DELETE', `${V1}/document/${GAMMA}`)).status).toBe(200)
    })
    let fresh: Bytes | undefined
    const [again] = await made(async (src, take) => {
      await src.send('DELETE', `${V1}/document/${GAMMA}`)
      await take()
      const w = await src.opened('Again')
      await src.page('Gamma', { title: 'New' }, { key: CHILD, parent: HOME, workspace: w.key })
      await src.merge(w.key)
      const change = (await src.changes())[0]
      fresh = await src.take(`changes/${change?.id}/bundle`)
    })
    expect(again).toBeDefined()
    const other = await target()
    await bin(other)
    await apply(other, deleted as Bytes, '')
    expect((await nodeOf(other, GAMMA))?.trashed).toBe(true)
    await other.close()

    const s = await target()
    await apply(s, deleted as Bytes)
    expect((await nodeOf(s, GAMMA))?.trashed).toBe(true)

    await apply(s, fresh as Bytes)
    expect(await parentOf(s, CHILD)).toBe(HOME)
  }, 60_000)

  test('reverting the delete takes it out of the bin, published as it was', async () => {
    let reverted: Bytes | undefined
    let asReverted: string | undefined
    const [deleted] = await made(async (s, take) => {
      await bin(s)
      await take()
      const change = (await s.changes())[0]
      const sent = await s.send(
        'POST',
        `${BACKOFFICE}/crombolo/api/changes/${change?.id}/revert`,
        {},
      )
      expect(sent.status, await sent.clone().text()).toBe(200)
      const revert = (await s.changes()).find((c) => c.kind === 'revert')
      reverted = await s.take(`changes/${revert?.id}/bundle`)
      expect((await nodeOf(s, GAMMA))?.trashed).toBe(false)
      asReverted = await stateOf(s, GAMMA)
    })
    const s = await target()
    await apply(s, deleted as Bytes)
    await apply(s, reverted as Bytes)
    expect((await nodeOf(s, GAMMA))?.trashed).toBe(false)
    expect(await stateOf(s, GAMMA)).toBe(asReverted as string)
    expect(await parentOf(s, GAMMA)).toBe(HOME)

    // Both staged into one workspace: nothing is left to bin.
    await s.close()
    const both = await target()
    const { workspace } = (await (await both.put(deleted as Bytes, '?stage=true')).json()) as {
      workspace: string
    }
    await apply(both, reverted as Bytes, `?stage=true&into=${workspace}`)
    await both.merge(workspace)
    expect((await nodeOf(both, GAMMA))?.trashed).toBe(false)
  }, 60_000)

  test('an old version naming the page does not hold it; a value in use does', async () => {
    const [deleted] = await made((s) => bin(s))
    const s = await target()
    await s.edit(BETA, { title: GAMMA })
    const held = await s.put(deleted as Bytes, '?accept=page-deleted')
    expect(held.status).toBe(409)
    expect(await held.text()).toContain('still used here')

    await s.close()
    const was = await target()
    await was.edit(BETA, { title: GAMMA })
    await was.edit(BETA, { title: 'B' })
    await apply(was, deleted as Bytes)
    expect((await nodeOf(was, GAMMA))?.trashed).toBe(true)
  }, 60_000)

  test('a later change to a page binned here takes it out, edited and published', async () => {
    const [edited] = await made((s) => s.edit(GAMMA, { title: 'Later' }))
    const s = await target()
    await bin(s)
    // Binned, it counts as edited since it was published: publishing it is asked for.
    await apply(s, edited as Bytes, `?accept=publishes-shared-draft:${GAMMA}`)
    expect((await nodeOf(s, GAMMA))?.trashed).toBe(false)
    expect(await parentOf(s, GAMMA)).toBe(HOME)
    expect(await s.fieldValue(GAMMA, 'title')).toBe('Later')
    expect(await stateOf(s, GAMMA)).toBe('Published')
  }, 60_000)

  const CARD = {
    'schema/content-types/card.toml':
      '[content-type]\nalias = "card"\nname = "Card"\nis-element = true\nallow-in-library = true\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n',
  }
  test('a blueprint is deleted, and a Library item binned', async () => {
    for (const kind of ['blueprint', 'element'] as const) {
      const path = kind === 'blueprint' ? 'document-blueprint' : 'element'
      const id = crypto.randomUUID()
      const source = await site({}, CARD)
      const typeKey = (
        await new ContentTypeRepository(source.h.server.db).byAlias(
          kind === 'element' ? 'card' : 'page',
        )
      )?.key as string
      const step = async (
        work: (headers: Record<string, string>) => Promise<Response>,
      ): Promise<Bytes> => {
        const w = await source.opened('Step')
        const sent = await work({ 'crombolo-workspace': w.key })
        expect(sent.status, await sent.clone().text()).toBeLessThan(300)
        await source.merge(w.key, ['page-deleted'])
        return source.take(`changes/${(await source.changes())[0]?.id}/bundle`)
      }
      const added = await step((h) =>
        source.send(
          'POST',
          `${V1}/${path}`,
          {
            id,
            documentType: { id: typeKey },
            parent: null,
            values: [],
            variants: [{ culture: null, segment: null, name: 'One' }],
          },
          h,
        ),
      )
      const gone = await step((h) =>
        kind === 'blueprint'
          ? source.send('DELETE', `${V1}/${path}/${id}`, undefined, h)
          : source.send('PUT', `${V1}/${path}/${id}/move-to-recycle-bin`, {}, h),
      )
      await source.close()
      const s = await site({}, CARD)
      await apply(s, added)
      await apply(s, gone)
      const node = await nodeOf(s, id)
      if (kind === 'blueprint') expect(node).toBeUndefined()
      else expect(node?.trashed).toBe(true)
      await s.close()
    }
  }, 60_000)

  test('media goes to its own bin', async () => {
    const source = await site()
    const w = await source.opened('Image')
    const { key } = await source.image('Photo', w.key)
    await source.merge(w.key)
    const take = async () => source.take(`changes/${(await source.changes())[0]?.id}/bundle`)
    const added = await take()
    const x = await source.opened('Remove')
    const sent = await source.send(
      'PUT',
      `${V1}/media/${key}/move-to-recycle-bin`,
      {},
      { 'crombolo-workspace': x.key },
    )
    expect(sent.status, await sent.clone().text()).toBe(200)
    await source.merge(x.key, ['page-deleted'])
    const gone = await take()
    await source.close()

    const s = await site()
    await apply(s, added)
    await apply(s, gone)
    expect((await nodeOf(s, key))?.trashed).toBe(true)
  }, 60_000)
})
