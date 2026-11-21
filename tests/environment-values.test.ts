/**
 * Story 387: a property with a value per environment. The schema names the
 * environments, a property may vary by them, and each copy of the site serves its
 * own value where it has one and the shared value otherwise. Every environment's
 * value is edited from any of them, travels in a change, and is set from the command
 * line and content files.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { forEnvironment, SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository, readEnvironments } from '@crombolo/data'
import { describeFileChange } from '@crombolo/schema'
import { encodePng, REMOTE_API_PATH } from '@crombolo/server'
import { rowsFor } from '../packages/backoffice-host/plugin/environment-values.js'
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

const SCHEMA_TOML =
  '[schema]\nversion = "1.0.0"\n\n[environments]\nnames = ["staging", "production"]\n'

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
varies-by-environment = true

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
  const root = mkdtempSync(join(process.cwd(), 'output', 'environment-values-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), SCHEMA_TOML)
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "export default ({ model }) => <main><h1>{model.text('title')}</h1></main>\n",
  )
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
      environment: 'staging',
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

const VALUES = `${BACKOFFICE}/crombolo/api/environment-values`

/** The site's page as a visitor sees it. */
const served = async (h: Harness) => (await h.server.fetch(new Request('http://localhost/'))).text()

describe(`a property with a value per environment (${dialectUnderTest})`, () => {
  test('a site reports its environment and the ones the schema names', async () => {
    const s = await site()
    expect(await (await s.send('GET', VALUES)).json()).toEqual({
      current: 'staging',
      names: ['staging', 'production'],
      readOnly: false,
    })
    expect(await readEnvironments(s.h.server.db)).toEqual(['staging', 'production'])
  })

  test('each environment serves its own value, and the shared value where it has none', async () => {
    const s = await site()
    const set = (environment: string, value: string | null) =>
      s.send('PUT', `${VALUES}/${HOME}`, { alias: 'title', environment, value })
    expect((await set('production', 'Live title')).status).toBe(200)
    const listed = (await (await s.send('GET', `${VALUES}/${HOME}`)).json()) as {
      items: Array<{
        alias: string
        shared: unknown
        overrides: Array<{ environment: string; value: unknown }>
      }>
    }
    expect(listed.items).toEqual([
      expect.objectContaining({
        alias: 'title',
        shared: 'Welcome',
        overrides: [expect.objectContaining({ environment: 'production', value: 'Live title' })],
      }),
    ])
    // The editor edits the shared value; it is never shown the others.
    expect((await s.read(HOME)).values.filter((v) => v.alias === 'title')).toHaveLength(1)
    expect(await s.fieldValue(HOME, 'title')).toBe('Welcome')
    // A save from the editor keeps each environment's own value.
    await s.edit(HOME, { intro: 'Edited' })
    expect(
      ((await (await s.send('GET', `${VALUES}/${HOME}`)).json()) as typeof listed).items[0]
        ?.overrides,
    ).toHaveLength(1)

    // Staging has none of its own: it serves the shared value; with its own, that.
    await s.edit(HOME, { title: 'Shared title' })
    expect(await served(s.h)).toContain('Shared title')
    expect((await set('staging', 'Staging title')).status).toBe(200)
    await s.send('PUT', `${V1}/document/${HOME}/publish`, { publishSchedules: [{ culture: null }] })
    expect(await served(s.h)).toContain('Staging title')
    expect(await served(s.h)).not.toContain('Live title')
    // Cleared, it is the shared value again.
    expect((await set('staging', null)).status).toBe(200)
    await s.send('PUT', `${V1}/document/${HOME}/publish`, { publishSchedules: [{ culture: null }] })
    expect(await served(s.h)).toContain('Shared title')
  }, 20_000)

  test("production's value set on staging is what production serves once the change is applied", async () => {
    const staging = await site()
    expect(
      (
        await staging.send('PUT', `${VALUES}/${HOME}`, {
          alias: 'title',
          environment: 'production',
          value: 'Live title',
        })
      ).status,
    ).toBe(200)
    await staging.send('PUT', `${V1}/document/${HOME}/publish`, {
      publishSchedules: [{ culture: null }],
    })
    const edit = (await staging.changes()).find((c) => c.kind === 'edit') as { id: string }
    const bundle = await staging.take(`changes/${edit.id}/bundle`)
    expect(await served(staging.h)).not.toContain('Live title')
    await staging.close()

    const production = await site({ environment: 'production' })
    const applied = await production.put(bundle)
    expect(applied.status, await applied.clone().text()).toBe(200)
    expect(await served(production.h)).toContain('Live title')
  }, 20_000)

  test('read only on an environment, its values are refused, and still arrive by a change', async () => {
    const s = await site({ environmentValuesReadOnly: true })
    expect((await (await s.send('GET', VALUES)).json()) as { readOnly: boolean }).toMatchObject({
      readOnly: true,
    })
    const refused = await s.send('PUT', `${VALUES}/${HOME}`, {
      alias: 'title',
      environment: 'production',
      value: 'Live title',
    })
    expect(refused.status).toBe(409)
  })

  test('a property that does not vary by environment takes none', async () => {
    const s = await site()
    const refused = await s.send('PUT', `${VALUES}/${HOME}`, {
      alias: 'intro',
      environment: 'production',
      value: 'x',
    })
    expect(refused.status).toBe(400)
  })

  test('an environment taken out of the list keeps its values, shown as unused', async () => {
    const s = await site()
    await s.send('PUT', `${VALUES}/${HOME}`, {
      alias: 'title',
      environment: 'qa',
      value: 'QA title',
    })
    const listed = (await (await s.send('GET', `${VALUES}/${HOME}`)).json()) as {
      items: Array<{
        overrides: Array<{ environment: string; known: boolean }>
        shared: unknown
        alias: string
        name: string
        culture: null
        segment: null
      }>
    }
    const item = listed.items[0]
    expect(item?.overrides).toEqual([expect.objectContaining({ environment: 'qa', known: false })])
    const rows = rowsFor(item as never, { current: 'staging', names: ['staging', 'production'] })
    expect(
      (rows as Array<{ environment: string; current: boolean; unused: boolean }>).map((r) => [
        r.environment,
        r.current,
        r.unused,
      ]),
    ).toEqual([
      ['staging', true, false],
      ['production', false, false],
      ['qa', false, true],
    ])
  })

  test('turning it off is a lossy change, and drops each environment’s own value', async () => {
    const before = PAGE_TOML
    const after = PAGE_TOML.replace('varies-by-environment = true\n', '')
    const items = describeFileChange('content-types/page.toml', before, after, { definition: true })
    expect(items.map((i) => i.kind)).toContain('property-environments-dropped')

    const s = await site()
    await s.send('PUT', `${VALUES}/${HOME}`, {
      alias: 'title',
      environment: 'production',
      value: 'Live',
    })
    const types = new ContentTypeRepository(s.h.server.db)
    const page = await types.byAlias('page')
    if (!page) throw new Error('no page type')
    await types.save({
      ...page,
      properties: page.properties.map((p) =>
        p.alias === 'title' ? { ...p, variesByEnvironment: false } : p,
      ),
    })
    const values = (await s.read(HOME)).values
    expect(values.some((v) => (v as { environment?: string }).environment)).toBe(false)
    expect(await s.fieldValue(HOME, 'title')).toBe('Welcome')
  })

  test('the values an environment shows: its own over the shared, the others left out', () => {
    const values = [
      { alias: 'title', culture: null, segment: null, value: 'Shared' },
      { alias: 'title', culture: null, segment: null, environment: 'production', value: 'Live' },
      { alias: 'title', culture: null, segment: null, environment: 'qa', value: 'QA' },
      { alias: 'intro', culture: null, segment: null, value: 'Hello' },
    ]
    expect(forEnvironment(values, 'production').map((v) => v.value)).toEqual(['Live', 'Hello'])
    expect(forEnvironment(values, 'staging').map((v) => v.value)).toEqual(['Shared', 'Hello'])
    expect(forEnvironment(values, undefined).map((v) => v.value)).toEqual(['Shared', 'Hello'])
  })
})
