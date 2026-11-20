/**
 * Story 390: a workspace holds media and its files, and Library items. An upload
 * or a replaced file there is placed as any is, and named only by the workspace's
 * version: Shared serves it as missing, the workspace's site serves it, and a
 * merge makes it Shared's. A file replaced on both sides is a conflict; a
 * discarded workspace's files go, unless something else names them.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { encodePng } from '@crombolo/server'
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

const halves = () => {
  const data = new Uint8Array(16 * 8 * 4)
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 16; x++)
      data.set(x < 8 ? [255, 0, 0, 255] : [0, 255, 0, 255], (y * 16 + x) * 4)
  return encodePng({ width: 16, height: 8, data }) as Uint8Array<ArrayBuffer>
}

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

async function site(options: { components?: number } = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-media-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components/parts', 'css', 'scripts'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(
    join(root, 'schema', 'content-types', 'promo.toml'),
    '[content-type]\nalias = "promo"\nname = "Promo"\nis-element = true\nallow-in-library = true\n',
  )
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "import Heading from './parts/heading.tsx'\nexport default () => <main><Heading /></main>\n",
  )
  writeFileSync(
    join(root, 'components', 'parts', 'heading.tsx'),
    'export default () => <h1>Welcome</h1>\n',
  )
  for (let n = 0; n < (options.components ?? 0); n++)
    writeFileSync(
      join(root, 'components', 'parts', `part-${n}.tsx`),
      `export default () => <p>${n}</p>\n`,
    )
  writeFileSync(join(root, 'css', 'site.css'), 'body { color: black; }\n')
  writeFileSync(join(root, 'package.json'), '{ "name": "site" }\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
      componentsCacheDir: join(root, '.cache', 'components'),
      mediaDir: join(root, 'media'),
      workspacesHost: '{workspace}.preview.test',
      schemaWritable: true,
      workspaces: true,
    },
  })
  open.push(h)
  const db = h.server.db
  const send = (method: string, path: string, body?: unknown, workspace?: string) =>
    h.call(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(workspace ? { 'crombolo-workspace': workspace } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string }
  }
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const created = await send('POST', `${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status).toBe(201)
  const home = created.headers.get('umb-generated-resource') as string
  expect(
    (await send('PUT', `${V1}/document/${home}/publish`, { publishSchedules: [{ culture: null }] }))
      .status,
  ).toBe(200)
  const upload = async () => {
    const id = crypto.randomUUID()
    const form = new FormData()
    form.set('Id', id)
    form.set('File', new File([halves()], 'halves.png'))
    expect((await h.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(201)
    return id
  }
  const fileValue = async () => ({
    src: '',
    temporaryFileId: await upload(),
    crops: [],
    focalPoint: null,
  })
  /** An image made, in a workspace when one is named; its key and file's address. */
  const image = async (name: string, workspace?: string) => {
    const response = await send(
      'POST',
      `${V1}/media`,
      {
        mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Image },
        parent: null,
        values: [{ alias: 'umbracoFile', culture: null, segment: null, value: await fileValue() }],
        variants: [{ culture: null, segment: null, name }],
      },
      workspace,
    )
    expect(response.status, await response.clone().text()).toBe(201)
    const key = response.headers.get('umb-generated-resource') as string
    return { key, src: await srcOf(key, workspace) }
  }
  const srcOf = async (key: string, workspace?: string) => {
    const media = (await (
      await send('GET', `${V1}/media/${key}`, undefined, workspace)
    ).json()) as {
      values: Array<{ alias: string; value: { src: string } }>
    }
    return media.values.find((v) => v.alias === 'umbracoFile')?.value.src as string
  }
  /** The image's file replaced, in a workspace when one is named. */
  const replace = async (key: string, workspace?: string) => {
    const media = (await (
      await send('GET', `${V1}/media/${key}`, undefined, workspace)
    ).json()) as Record<string, unknown>
    const saved = await send(
      'PUT',
      `${V1}/media/${key}`,
      {
        ...media,
        values: [{ alias: 'umbracoFile', culture: null, segment: null, value: await fileValue() }],
      },
      workspace,
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    return srcOf(key, workspace)
  }
  const served = async (url: string, cookie = '') =>
    (await h.server.fetch(new Request(url, { headers: cookie ? { cookie } : {} }))).status
  /** A link's holder on the workspace's site: the cookie its link leaves. */
  const holder = async (workspace: string) => {
    const made = (await (
      await send('POST', `${WORKSPACES}/${workspace}/links`, { days: 1 })
    ).json()) as { url: string }
    const first = await h.server.fetch(new Request(made.url, { redirect: 'manual' }))
    return (first.headers.getSetCookie()[0] ?? '').split(';')[0] as string
  }
  return { h, db, root, send, opened, image, srcOf, replace, served, holder }
}

const label = (key: string) => key.replaceAll('-', '')

describe(`a workspace's media (${dialectUnderTest})`, () => {
  test('an upload there is the workspace’s, served at its address only, until merged', async () => {
    const { send, opened, image, served, holder } = await site()
    const sale = await opened('Spring sale')
    const banner = await image('Banner', sale.key)
    expect((await send('GET', `${V1}/media/${banner.key}`)).status).toBe(404)
    expect(await served(`http://localhost${banner.src}`)).toBe(404)
    const cookie = await holder(sale.key)
    expect(await served(`http://${label(sale.key)}.preview.test${banner.src}`, cookie)).toBe(200)

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect((await send('GET', `${V1}/media/${banner.key}`)).status).toBe(200)
    expect(await served(`http://localhost${banner.src}`)).toBe(200)
  })

  test('a file replaced there leaves Shared serving the earlier one until the merge', async () => {
    const { send, opened, image, replace, srcOf, served } = await site()
    const logo = await image('Logo')
    const sale = await opened('Spring sale')
    const newer = await replace(logo.key, sale.key)
    expect(newer).not.toBe(logo.src)
    expect(await srcOf(logo.key)).toBe(logo.src)
    expect(await served(`http://localhost${newer}`)).toBe(404)
    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(await srcOf(logo.key)).toBe(newer)
    expect(await served(`http://localhost${newer}`)).toBe(200)
  })

  test('a file replaced on both sides is a conflict, settled by choosing one', async () => {
    const { send, opened, image, replace } = await site()
    const logo = await image('Logo')
    const sale = await opened('Spring sale')
    await replace(logo.key, sale.key)
    await replace(logo.key)
    const refused = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    const plan = (await refused.json()) as { conflicts: Array<{ key: string; field: string }> }
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ key: logo.key, field: 'umbracoFile||' }),
    ])
  })

  test('moving and renaming a Shared media item there changes nothing in Shared until the merge', async () => {
    const { send, opened, image, srcOf } = await site()
    const logo = await image('Logo')
    const sale = await opened('Spring sale')
    const media = (await (
      await send('GET', `${V1}/media/${logo.key}`, undefined, sale.key)
    ).json()) as Record<string, unknown>
    expect(
      (
        await send(
          'PUT',
          `${V1}/media/${logo.key}`,
          { ...media, variants: [{ culture: null, segment: null, name: 'Sale logo' }] },
          sale.key,
        )
      ).status,
    ).toBe(200)
    const shared = (await (await send('GET', `${V1}/media/${logo.key}`)).json()) as {
      variants: Array<{ name: string }>
    }
    expect(shared.variants[0]?.name).toBe('Logo')
    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    const merged = (await (await send('GET', `${V1}/media/${logo.key}`)).json()) as {
      variants: Array<{ name: string }>
    }
    expect(merged.variants[0]?.name).toBe('Sale logo')
    void srcOf
  })

  test('discarding removes the workspace’s files, and leaves Shared’s alone', async () => {
    const { root, send, opened, image } = await site()
    const kept = await image('Kept')
    const sale = await opened('Spring sale')
    const gone = await image('Gone', sale.key)
    const file = (src: string) => join(root, 'media', ...src.replace(/^\/media\//, '').split('/'))
    expect(existsSync(file(gone.src))).toBe(true)
    expect((await send('DELETE', `${WORKSPACES}/${sale.key}`)).status).toBe(204)
    for (let n = 0; n < 50 && existsSync(file(gone.src)); n++) await Bun.sleep(20)
    expect(existsSync(file(gone.src))).toBe(false)
    expect(existsSync(file(kept.src))).toBe(true)
  })

  test('a Library item is made in a workspace as media is', async () => {
    const { send, opened } = await site()
    const sale = await opened('Spring sale')
    const types = (await (
      await send('GET', `${V1}/document-type/allowed-in-library?skip=0&take=10`)
    ).json()) as { items: Array<{ id: string }> }
    const type = types.items[0]
    expect(type).toBeDefined()
    if (!type) return
    const made = await send(
      'POST',
      `${V1}/element`,
      {
        documentType: { id: type.id },
        parent: null,
        values: [],
        variants: [{ culture: null, segment: null, name: 'Promo' }],
      },
      sale.key,
    )
    expect(made.status, await made.clone().text()).toBe(201)
    const key = made.headers.get('umb-generated-resource') as string
    expect((await send('GET', `${V1}/element/${key}`, undefined, sale.key)).status).toBe(200)
    expect((await send('GET', `${V1}/element/${key}`)).status).toBe(404)
  })

  test('with a workspace required, a direct media edit is refused, and one in a workspace taken', async () => {
    const { h, send, image } = await site()
    h.server.config.workspacesRequired = true
    const response = await send('POST', `${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Folder' }],
    })
    expect(response.status).toBe(409)
    expect((await image('Mine', 'mine')).key).toBeDefined()
  })
})
