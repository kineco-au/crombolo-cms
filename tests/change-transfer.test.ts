/**
 * Story 383: a change moves from one site to another. Exported from where it was
 * made, it applies to another copy of the site: only what it altered is written,
 * a field the target changed since is a conflict that leaves a workspace holding
 * the change, and a change is applied once. Staged, it waits in a workspace
 * nobody edits, and is applied by that workspace's merge.
 *
 * Two sites cannot share one Postgres schema in a test, so each test runs the
 * source first, takes its change as bytes, and then the target.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { encodePng, REMOTE_API_PATH } from '@crombolo/server'
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
async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'change-transfer-'))
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
  await page('Home', { title: 'Welcome', intro: 'Hello' }, { key: HOME })
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

/** The source: a change made there by a workspace's merge, taken as bytes. */
async function madeThere(
  work: (s: Awaited<ReturnType<typeof site>>, w: string) => Promise<void>,
  accept: string[] = [],
) {
  const source = await site()
  const workspace = await source.opened('Spring sale')
  await work(source, workspace.key)
  await source.merge(workspace.key, accept)
  const made = (await source.changes())[0] as { id: string; key: string }
  const bundle = await source.take(`changes/${made.id}/bundle`)
  await source.close()
  return { key: made.key, bundle }
}

describe(`a change moved between sites (${dialectUnderTest})`, () => {
  test('a change exported from one site applies to another, and is applied once', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    expect(made.key).toMatch(/^[0-9a-f-]{36}$/)
    const target = await site()
    const applied = await target.put(made.bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    expect(await target.fieldValue(HOME, 'title')).toBe('Spring sale')
    expect(await target.held([made.key])).toEqual([made.key])

    const again = await target.put(made.bundle)
    expect(((await again.json()) as { skipped: string[] }).skipped).toEqual([made.key])
  }, 20_000)

  test('a language, a dictionary item and a blueprint made in a workspace travel with its change', async () => {
    const greeting = crypto.randomUUID()
    const blueprint = crypto.randomUUID()
    let typeKey = ''
    const made = await madeThere(async (s, w) => {
      typeKey = (await new ContentTypeRepository(s.h.server.db).byAlias('page'))?.key as string
      const at = { 'crombolo-workspace': w }
      const sent = [
        await s.send(
          'POST',
          `${V1}/language`,
          {
            isoCode: 'da-DK',
            name: 'Danish',
            isDefault: false,
            isMandatory: false,
            fallbackIsoCode: null,
          },
          at,
        ),
        await s.send(
          'POST',
          `${V1}/dictionary`,
          {
            id: greeting,
            name: 'Greeting',
            parent: null,
            translations: [{ isoCode: 'en-US', translation: 'Hello' }],
          },
          at,
        ),
        await s.send(
          'POST',
          `${V1}/document-blueprint`,
          {
            id: blueprint,
            documentType: { id: typeKey },
            parent: null,
            values: [{ alias: 'title', culture: null, segment: null, value: 'Sale' }],
            variants: [{ culture: null, segment: null, name: 'Sale page' }],
          },
          at,
        ),
      ]
      for (const response of sent) expect(response.status, await response.clone().text()).toBe(201)
    })
    const target = await site()
    const applied = await target.put(made.bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    const isos = (
      (await (await target.send('GET', `${V1}/language?skip=0&take=50`)).json()) as {
        items: Array<{ isoCode: string }>
      }
    ).items.map((l) => l.isoCode)
    expect(isos).toContain('da-DK')
    expect((await target.send('GET', `${V1}/dictionary/${greeting}`)).status).toBe(200)
    expect((await target.send('GET', `${V1}/document-blueprint/${blueprint}`)).status).toBe(200)
  }, 30_000)

  test('a property the change did not touch keeps the target’s edit', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    await target.edit(HOME, { intro: 'Edited here' })
    expect((await target.put(made.bundle)).status).toBe(200)
    expect(await target.fieldValue(HOME, 'title')).toBe('Spring sale')
    expect(await target.fieldValue(HOME, 'intro')).toBe('Edited here')
  }, 20_000)

  test('a field the target changed since is refused, named, and the change waits in a workspace', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    await target.edit(HOME, { title: 'Ours' })
    const refused = await target.put(made.bundle)
    expect(refused.status).toBe(409)
    const body = (await refused.json()) as {
      conflicts: Array<{ says: string }>
      workspace: string
    }
    expect(body.conflicts.map((c) => c.says).join(' ')).toContain('title')
    expect(await target.fieldValue(HOME, 'title')).toBe('Ours')
    // Left to settle: it can be edited there and merged.
    await target.edit(HOME, { title: 'Spring sale, ours' }, body.workspace)
    await target.merge(body.workspace)
    expect(await target.fieldValue(HOME, 'title')).toBe('Spring sale, ours')
    expect(await target.held([made.key])).toEqual([made.key])
  }, 20_000)

  test('a staged change is looked at in a workspace nobody edits, and applied by its merge', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    const staged = await target.put(made.bundle, '?stage=true')
    expect(staged.status).toBe(200)
    const { workspace } = (await staged.json()) as { workspace: string }
    expect(await target.fieldValue(HOME, 'title')).toBe('Welcome')
    expect(await target.fieldValue(HOME, 'title', workspace)).toBe('Spring sale')
    const document = await target.read(HOME, workspace)
    const edited = await target.send('PUT', `${V1}/document/${HOME}`, document, {
      'crombolo-workspace': workspace,
    })
    expect(edited.status).toBe(409)
    await target.merge(workspace)
    expect(await target.fieldValue(HOME, 'title')).toBe('Spring sale')
    expect(await target.held([made.key])).toEqual([made.key])
  }, 20_000)

  test('several changes staged together are applied together', async () => {
    const source = await site()
    const first = await source.opened('First')
    await source.edit(HOME, { title: 'One' }, first.key)
    await source.merge(first.key)
    const second = await source.opened('Second')
    await source.edit(HOME, { intro: 'Two' }, second.key)
    await source.merge(second.key)
    const all = await source.changes()
    const one = all.find((c) => c.name === 'First')
    const two = all.find((c) => c.name === 'Second')
    const bundles = [
      await source.take(`changes/${one?.id}/bundle`),
      await source.take(`changes/${two?.id}/bundle`),
    ]
    await source.close()

    const target = await site()
    const staged = (await (await target.put(bundles[0] as Bytes, '?stage=true')).json()) as {
      workspace: string
    }
    expect(
      (await target.put(bundles[1] as Bytes, `?stage=true&into=${staged.workspace}`)).status,
    ).toBe(200)
    expect(await target.fieldValue(HOME, 'intro', staged.workspace)).toBe('Two')
    await target.merge(staged.workspace)
    expect(await target.fieldValue(HOME, 'title')).toBe('One')
    expect(await target.fieldValue(HOME, 'intro')).toBe('Two')
    expect((await target.held([one?.key as string, two?.key as string])).sort()).toEqual(
      [one?.key as string, two?.key as string].sort(),
    )
  }, 30_000)

  test('a change without the earlier change it depends on is refused, naming it', async () => {
    const source = await site()
    const first = await source.opened('Make it')
    const promo = await source.page('Promo', { title: 'New', intro: 'x' }, { workspace: first.key })
    await source.merge(first.key)
    const second = await source.opened('Change it')
    await source.edit(promo, { title: 'Newer' }, second.key)
    await source.merge(second.key)
    const all = await source.changes()
    const later = all.find((c) => c.name === 'Change it')
    const earlier = all.find((c) => c.name === 'Make it')
    const bundle = await source.take(`changes/${later?.id}/bundle`)
    await source.close()

    const target = await site()
    const refused = await target.put(bundle)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).toContain(earlier?.key as string)
  }, 30_000)

  test('an open workspace is exported, and its later merge at the source is the same change', async () => {
    const source = await site()
    const workspace = await source.opened('Spring sale')
    await source.edit(HOME, { title: 'Spring sale' }, workspace.key)
    const bundle = await source.take(`workspaces/${workspace.key}/change`)
    await source.merge(workspace.key)
    expect((await source.changes())[0]?.key).toBe(workspace.key)
    await source.close()

    const target = await site()
    expect((await target.put(bundle)).status).toBe(200)
    expect(await target.fieldValue(HOME, 'title')).toBe('Spring sale')
    expect(await target.held([workspace.key])).toEqual([workspace.key])
  }, 20_000)

  test('a new page arrives; one made separately at the same address is a conflict', async () => {
    const made = await madeThere(async (s, w) => {
      await s.page('Offers', { title: 'Theirs', intro: '' }, { workspace: w })
    })
    const fresh = await site()
    expect((await fresh.put(made.bundle)).status).toBe(200)
    await fresh.close()

    const target = await site()
    await target.page('Offers', { title: 'Ours', intro: '' })
    const refused = await target.put(made.bundle)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).toContain('same address')
  }, 30_000)

  test('deleting a page the target edited since is a conflict, not a delete', async () => {
    const made = await madeThere(
      async (s, w) => {
        const deleted = await s.send('DELETE', `${V1}/document/${HOME}`, undefined, {
          'crombolo-workspace': w,
        })
        expect(deleted.status).toBe(200)
      },
      ['page-deleted'],
    )
    const target = await site()
    await target.edit(HOME, { intro: 'Kept here' })
    const refused = await target.put(made.bundle)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).toContain('not deleted')
    expect(await target.fieldValue(HOME, 'intro')).toBe('Kept here')
  }, 20_000)

  test('a lossy item is counted against the target, and applies once accepted there', async () => {
    const made = await madeThere(
      async (s, w) => {
        const deleted = await s.send('DELETE', `${V1}/document/${HOME}`, undefined, {
          'crombolo-workspace': w,
        })
        expect(deleted.status).toBe(200)
      },
      ['page-deleted'],
    )
    const target = await site()
    const refused = await target.put(made.bundle)
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).toContain('page-deleted')
    expect((await target.read(HOME)).values).toBeDefined()
    const accepted = await target.put(made.bundle, '?accept=page-deleted')
    expect(accepted.status, await accepted.clone().text()).toBe(200)
    expect((await target.read(HOME)).isTrashed).toBe(true)
  }, 20_000)

  test('media the change added arrives with its file; what it never touched is unchanged', async () => {
    let src = ''
    const made = await madeThere(async (s, w) => {
      src = (await s.image('Banner', w)).src
    })
    const target = await site()
    const own = await target.image('Ours')
    expect((await target.put(made.bundle)).status).toBe(200)
    const served = await target.h.server.fetch(new Request(`http://localhost${src}`))
    expect(served.status).toBe(200)
    expect((await target.h.server.fetch(new Request(`http://localhost${own.src}`))).status).toBe(
      200,
    )
    expect((await target.h.call(`${V1}/media/${own.key}`)).status).toBe(200)
  }, 20_000)

  test('page edits since a point are taken and applied as one', async () => {
    const source = await site()
    await Bun.sleep(20)
    const point = new Date()
    await Bun.sleep(20)
    await source.edit(HOME, { title: 'Edited directly' })
    const bundle = await source.take(`changes/since?at=${encodeURIComponent(point.toISOString())}`)
    await source.close()
    const target = await site()
    expect((await target.put(bundle)).status).toBe(200)
    expect(await target.fieldValue(HOME, 'title')).toBe('Edited directly')
  }, 20_000)

  test('a change that was altered on the way is refused', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    const response = await target.put({ ...made.bundle, sha: 'f'.repeat(64) })
    expect(response.status).toBe(400)
    expect(await target.fieldValue(HOME, 'title')).toBe('Welcome')
  }, 20_000)

  test('an administrator lists every pending workspace, staged ones included, and clears the idle', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    const own = await target.opened('Mine')
    const staged = (await (await target.put(made.bundle, '?stage=true')).json()) as {
      workspace: string
    }
    const listed = (await (await target.send('GET', `${WORKSPACES}/pending`)).json()) as {
      items: Array<{ key: string; staged: unknown; lastActivity: string; ownerName: string }>
    }
    expect(listed.items.map((w) => w.key).sort()).toEqual([own.key, staged.workspace].sort())
    expect(listed.items.find((w) => w.key === staged.workspace)?.staged).toEqual([
      expect.objectContaining({ key: made.key }),
    ])
    const kept = await target.send('POST', `${WORKSPACES}/pending/discard`, { olderThanDays: 1 })
    expect(((await kept.json()) as { discarded: string[] }).discarded).toEqual([])
    const cleared = await target.send('POST', `${WORKSPACES}/pending/discard`, { olderThanDays: 0 })
    expect(((await cleared.json()) as { discarded: string[] }).discarded.sort()).toEqual(
      [own.key, staged.workspace].sort(),
    )
  }, 20_000)

  test('applying needs Apply changes; discovery says changes', async () => {
    const target = await site()
    const discovery = (await (
      await target.h.server.fetch(new Request(`${ORIGIN}/.well-known/crombolo-remote`))
    ).json()) as { environments: Array<{ capabilities: string[] }> }
    expect(JSON.stringify(discovery)).toContain('"changes"')
  })
})

// Story 416: a staged change read by the site's editors, when whoever staged it says so.
describe(`a staged change read by the site’s editors (${dialectUnderTest}, story 416)`, () => {
  const ask = (h: Harness, method: string, path: string, body?: unknown) =>
    h.call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  test('shown to editors, an editor reads it, checks it and opens it, and changes nothing', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    const staged = await target.put(made.bundle, '?stage=true&visibility=editors')
    expect(staged.status, await staged.clone().text()).toBe(200)
    const { workspace } = (await staged.json()) as { workspace: string }
    const editor = await signInAsGroup(target.h, 'writer')
    const at = `${WORKSPACES}/${workspace}`

    const listed = (await (await ask(editor, 'GET', WORKSPACES)).json()) as {
      items: Array<{ key: string; staged: boolean; member: boolean }>
    }
    expect(listed.items.find((w) => w.key === workspace)).toMatchObject({
      staged: true,
      member: false,
    })
    for (const read of ['', '/changes', '/diff', '/merge', '/conflicts', '/pages', '/errors'])
      expect((await ask(editor, 'GET', `${at}${read}`)).status, read).toBe(200)
    expect((await ask(editor, 'POST', `${at}/check`, {})).status).toBe(200)
    expect((await ask(editor, 'GET', `${at}/render?path=/`)).status).toBe(200)
    const opened = await ask(editor, 'POST', `${at}/open`, { path: '/' })
    expect(opened.status, await opened.clone().text()).toBe(200)

    expect((await ask(editor, 'POST', `${at}/merge`, {})).status).toBeGreaterThanOrEqual(400)
    expect((await ask(editor, 'DELETE', at)).status).toBe(404)
    expect((await ask(editor, 'PATCH', at, { name: 'Mine' })).status).toBeGreaterThanOrEqual(400)
    expect((await ask(editor, 'POST', `${at}/links`, { days: 1 })).status).toBeGreaterThanOrEqual(
      400,
    )
    expect(await target.fieldValue(HOME, 'title')).toBe('Welcome')
  }, 30_000)

  test('not shown to editors, or to someone without Content, it is no workspace at all', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    const hidden = (await (await target.put(made.bundle, '?stage=true')).json()) as {
      workspace: string
    }
    const editor = await signInAsGroup(target.h, 'writer')
    expect((await ask(editor, 'GET', `${WORKSPACES}/${hidden.workspace}`)).status).toBe(404)
    await target.h.server.db.q
      .updateTable('workspace')
      .set({ visibility: 'editors' })
      .where('key', '=', hidden.workspace)
      .execute()
    const outsider = await signInAsGroup(target.h, 'sensitiveData')
    // Refused before the workspace is looked at, or answered as none.
    expect([403, 404]).toContain(
      (await ask(outsider, 'GET', `${WORKSPACES}/${hidden.workspace}`)).status,
    )
  }, 30_000)

  test('a page the editor may not read in Shared is left out, and refused by render and open', async () => {
    const made = await madeThere((s, w) => s.edit(HOME, { title: 'Spring sale' }, w))
    const target = await site()
    const { workspace } = (await (
      await target.put(made.bundle, '?stage=true&visibility=editors')
    ).json()) as { workspace: string }
    const writers = await target.h.server.db.q
      .selectFrom('user_group')
      .select('key')
      .where('alias', '=', 'writer')
      .executeTakeFirst()
    await target.h.server.db.q
      .deleteFrom('user_group_permission')
      .where('user_group_key', '=', String(writers?.key))
      .where('permission', '=', 'Umb.Document.Read')
      .execute()
    const editor = await signInAsGroup(target.h, 'writer')
    const at = `${WORKSPACES}/${workspace}`
    const changes = (await (await ask(editor, 'GET', `${at}/changes`)).json()) as {
      items: Array<{ key: string }>
    }
    expect(changes.items.map((c) => c.key)).not.toContain(HOME)
    expect((await ask(editor, 'GET', `${at}/render?path=/`)).status).toBe(404)
    expect((await ask(editor, 'POST', `${at}/open`, { path: '/' })).status).toBe(404)
  }, 30_000)
})

// Story 421: a change staged after another, into one workspace, builds on it.
describe(`changes staged one by one into one workspace (${dialectUnderTest}, story 421)`, () => {
  const OFFERS = '6b2f1f0e-3c1d-4a8e-9f00-000000000421'

  /** A source where each workspace merged is a change: made, then changed, then renamed, then deleted. */
  async function promotion() {
    const source = await site()
    const step = async (name: string, work: (w: string) => Promise<void>) => {
      const w = await source.opened(name)
      await work(w.key)
      await source.merge(w.key, ['page-deleted'])
      const made = (await source.changes())[0] as { id: string; key: string }
      return { key: made.key, bundle: await source.take(`changes/${made.id}/bundle`) }
    }
    const made = await step('Made', async (w) => {
      await source.page(
        'Offers',
        { title: 'Offers', intro: 'First' },
        { key: OFFERS, workspace: w },
      )
    })
    const changed = await step('Changed', (w) => source.edit(OFFERS, { intro: 'Second' }, w))
    const renamed = await step('Renamed', async (w) => {
      const document = await source.read(OFFERS, w)
      const saved = await source.send(
        'PUT',
        `${V1}/document/${OFFERS}`,
        { ...document, variants: [{ culture: null, segment: null, name: 'Deals' }] },
        { 'crombolo-workspace': w },
      )
      expect(saved.status, await saved.clone().text()).toBe(200)
    })
    const deleted = await step('Deleted', async (w) => {
      expect(
        (
          await source.send('DELETE', `${V1}/document/${OFFERS}`, undefined, {
            'crombolo-workspace': w,
          })
        ).status,
      ).toBeLessThan(300)
    })
    await source.close()
    return { made, changed, renamed, deleted }
  }

  test('each staged into the workspace the one before left, merged as one, each then held', async () => {
    const { made, changed, renamed } = await promotion()
    const target = await site()
    const first = await target.put(made.bundle, '?stage=true')
    expect(first.status, await first.clone().text()).toBe(200)
    const { workspace } = (await first.json()) as { workspace: string }
    for (const next of [changed, renamed]) {
      const staged = await target.put(next.bundle, `?stage=true&into=${workspace}`)
      expect(staged.status, await staged.clone().text()).toBe(200)
      expect(((await staged.json()) as { conflicts: unknown[] }).conflicts).toEqual([])
    }
    expect(await target.fieldValue(OFFERS, 'intro', workspace)).toBe('Second')
    expect(
      ((await target.read(OFFERS, workspace)).variants as Array<{ name: string }>)[0]?.name,
    ).toBe('Deals')

    // Staged again, it is skipped and changes nothing.
    const again = (await (
      await target.put(changed.bundle, `?stage=true&into=${workspace}`)
    ).json()) as { skipped: string[]; conflicts: unknown[] }
    expect(again.skipped).toEqual([changed.key])
    expect(again.conflicts).toEqual([])

    await target.merge(workspace)
    expect(await target.fieldValue(OFFERS, 'intro')).toBe('Second')
    expect(await target.held([made.key, changed.key, renamed.key])).toEqual(
      expect.arrayContaining([made.key, changed.key, renamed.key]),
    )
  }, 60_000)

  test('a change whose dependency is neither held nor staged is told what it needs', async () => {
    const { renamed } = await promotion()
    const target = await site()
    // Nothing of the earlier two is here, staged or held: the page it renames is not either.
    const staged = await target.put(renamed.bundle, '?stage=true')
    expect(staged.status).toBe(409)
    expect(await staged.text()).toContain('which this site does not have')
  }, 60_000)

  test('a change deleting a page an earlier staged change made leaves the workspace without it', async () => {
    const { made, changed, renamed, deleted } = await promotion()
    const target = await site()
    const { workspace } = (await (await target.put(made.bundle, '?stage=true')).json()) as {
      workspace: string
    }
    for (const next of [changed, renamed, deleted]) {
      const staged = await target.put(
        next.bundle,
        `?stage=true&into=${workspace}&accept=page-deleted`,
      )
      expect(staged.status, await staged.clone().text()).toBe(200)
    }
    const read = await target.send('GET', `${V1}/document/${OFFERS}`, undefined, {
      'crombolo-workspace': workspace,
    })
    expect(read.status).toBe(404)
  }, 60_000)
})

describe('story 434: workspaces that make the same page, and a type staged elsewhere', () => {
  /** A type made and merged, then a page of it made and published in an own workspace. */
  async function typeThenPage() {
    const source = await site()
    const shared = (await (await source.send('GET', `${V1}/document/${HOME}`)).json()) as {
      documentType: { id: string }
    }
    const own = (await (
      await source.send('GET', `${V1}/document-type/${shared.documentType.id}`)
    ).json()) as Record<string, unknown>
    const types = await source.opened('Proof type')
    const typeKey = crypto.randomUUID()
    const madeType = await source.send(
      'POST',
      `${V1}/document-type`,
      {
        ...own,
        id: typeKey,
        alias: 'proofPage',
        name: 'Proof page',
        properties: [],
        containers: [],
      },
      { 'crombolo-workspace': types.key },
    )
    expect(madeType.status, await madeType.clone().text()).toBe(201)
    await source.merge(types.key)
    const proof = await source.send(
      'POST',
      `${V1}/document`,
      {
        documentType: { id: typeKey },
        parent: null,
        values: [],
        variants: [{ culture: null, segment: null, name: 'Proof page X' }],
      },
      { 'crombolo-workspace': 'mine' },
    )
    expect(proof.status, await proof.clone().text()).toBe(201)
    const pageKey = proof.headers.get('umb-generated-resource') as string
    const published = await source.send(
      'PUT',
      `${V1}/document/${pageKey}/publish`,
      { publishSchedules: [{ culture: null }] },
      { 'crombolo-workspace': 'mine' },
    )
    expect(published.status, await published.clone().text()).toBe(200)
    const listed = (await source.changes()).slice().reverse()
    const typeChange = listed.find((c) => c.name === 'Proof type')
    const pageChange = listed.find((c) => c.name?.startsWith('Published'))
    const bundles = {
      type: await source.take(`changes/${typeChange?.id}/bundle`),
      page: await source.take(`changes/${pageChange?.id}/bundle`),
    }
    await source.close()
    return { bundles, typeKey, pageKey }
  }
  const stage = async (target: Awaited<ReturnType<typeof site>>, bundle: Bytes, into?: string) => {
    const answer = await target.put(bundle, into ? `?stage=true&into=${into}` : '?stage=true')
    return {
      status: answer.status,
      ...((await answer.json()) as {
        workspace: string
        conflicts: Array<{ item: string; says: string }>
      }),
    }
  }

  test('a page whose type is in neither Shared nor the workspace is a conflict, never another workspace’s type', async () => {
    const { bundles, typeKey } = await typeThenPage()
    const target = await site()
    const typeHeld = await stage(target, bundles.type)
    expect(typeHeld.status).toBe(200)
    const alone = await stage(target, bundles.page)
    expect(alone.status).toBe(409)
    expect(alone.conflicts[0]?.says).toContain(
      'needs the document type "proofPage", which this site does not have',
    )
    // Nothing of it uses the type the other workspace staged, so that one discards.
    const gone = await target.send('DELETE', `${WORKSPACES}/${typeHeld.workspace}`)
    expect(gone.status, await gone.clone().text()).toBe(204)
    const left = await target.h.server.db.q
      .selectFrom('node')
      .select('unique_id')
      .where('unique_id', '=', typeKey)
      .execute()
    expect(left).toEqual([])
  }, 30_000)

  test('staged after the change that makes its type, into one workspace, it builds on it, and both discard', async () => {
    const { bundles, pageKey } = await typeThenPage()
    const target = await site()
    const first = await stage(target, bundles.type)
    const second = await stage(target, bundles.page, first.workspace)
    expect(second.status, JSON.stringify(second)).toBe(200)
    const gone = await target.send('DELETE', `${WORKSPACES}/${first.workspace}`)
    expect(gone.status, await gone.clone().text()).toBe(204)
    const left = await target.h.server.db.q
      .selectFrom('node')
      .select('unique_id')
      .where('unique_id', '=', pageKey)
      .execute()
    expect(left).toEqual([])
  }, 30_000)

  test('story 436: the same change staged into two workspaces stages in both, and both merge', async () => {
    const { bundles, pageKey } = await typeThenPage()
    const target = await site()
    const first = await stage(target, bundles.type)
    expect((await stage(target, bundles.page, first.workspace)).status).toBe(200)
    const second = await stage(target, bundles.type)
    // The type change made its type in the second workspace too; the page is its own copy.
    const again = await stage(target, bundles.page, second.workspace)
    expect(again.status, JSON.stringify(again)).toBe(200)
    await target.merge(first.workspace)
    // The second holds the same change: it merges as a change to Shared's, with nothing to ask.
    await target.merge(second.workspace)
    const left = await target.h.server.db.q
      .selectFrom('node')
      .select(['workspace_id'])
      .where('unique_id', '=', pageKey)
      .execute()
    expect(left).toEqual([{ workspace_id: null }])
  }, 30_000)

  test('story 436: a second workspace’s different copy of a page merges field by field', async () => {
    const { bundles, pageKey } = await typeThenPage()
    const target = await site()
    const first = await stage(target, bundles.type)
    await stage(target, bundles.page, first.workspace)
    const second = await stage(target, bundles.type)
    const again = await stage(target, bundles.page, second.workspace)
    // Opened to edit, its copy renamed: the name is what the two disagree on.
    await target.h.server.db.q
      .updateTable('workspace')
      .set({ staged_changes: null })
      .where('key', '=', again.workspace)
      .execute()
    const read = await target.read(pageKey, again.workspace)
    const renamed = await target.send(
      'PUT',
      `${V1}/document/${pageKey}`,
      { ...read, variants: [{ culture: null, segment: null, name: 'Proof page Y' }] },
      { 'crombolo-workspace': again.workspace },
    )
    expect(renamed.status, await renamed.clone().text()).toBe(200)
    await target.merge(first.workspace)
    const refused = await target.send('POST', `${WORKSPACES}/${again.workspace}/merge`, {})
    expect(refused.status).toBe(409)
    expect(JSON.stringify(await refused.json())).toContain('Proof page Y')
  }, 30_000)
})
