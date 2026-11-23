/**
 * Story 399: a site bundle staged into a workspace as a change, measured from a base.
 * The first staging from a source names its base; a merged staging becomes the
 * source's next base, so an editor's later edit to an item the bundle left alone is
 * kept, and one to an item it changed is a conflict. Nothing is deleted unless asked.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { packCheckout } from '../packages/cli/src/support/site-bundle.ts'
import { siteFileKey, siteStateOf } from '../packages/server/src/change-transfer.ts'
import { exportSite } from '../packages/server/src/site-file.ts'
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
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const FROM_SITE = `${BACKOFFICE}/crombolo/api/changes/from-site`
const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const tokenOf = (h: Harness) => /umbAccessToken[^=]*=([^;]+)/.exec(h.cookie())?.[1] as string

interface Staged {
  workspace: string | null
  conflicts: Array<{ says: string }>
  pages: Array<{ key: string; name: string; action: string }>
  files: Array<{ path: string; class: string }>
  leftOut: string[]
}

async function site() {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'site-staging-'))
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
      workspaces: true,
    },
  })
  open.push(h)
  const db = h.server.db
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const send = (method: string, path: string, body?: unknown) =>
    h.call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const publish = async (key: string) => {
    const response = await send('PUT', `${V1}/document/${key}/publish`, {
      publishSchedules: [{ culture: null }],
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }
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
    await publish(key)
    return key
  }
  const read = async (key: string) =>
    (await (await h.call(`${V1}/document/${key}`)).json()) as {
      values: Array<{ alias: string; value: unknown }>
      variants: Array<{ name: string }>
    }
  /** Sets a page's title or name in Shared and publishes it, as an editor would. */
  const edit = async (key: string, change: { title?: string; name?: string }) => {
    const copy = await h.call(`${V1}/document/${key}`)
    const document = (await copy.json()) as {
      values: Array<{ alias: string; value: unknown }>
      variants: Array<{ name: string }>
    }
    const saved = await send('PUT', `${V1}/document/${key}`, {
      ...document,
      values: change.title
        ? [{ alias: 'title', culture: null, segment: null, value: change.title }]
        : document.values,
      variants: document.variants.map((v) => ({ ...v, name: change.name ?? v.name })),
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    await publish(key)
  }
  /** The site as a checkout would hold it now: a whole-site bundle. */
  const checkout = async () => {
    const out = join(mkdtempSync(join(root, 'out-')), 'site.tgz')
    await exportSite(db, h.server.config, { out, media: false })
    return new Uint8Array(readFileSync(out))
  }
  const stage = async (bytes: Uint8Array, query: string) => {
    const response = await h.server.fetch(
      new Request(`${ORIGIN}${FROM_SITE}?${query}`, {
        method: 'PUT',
        body: bytes as BodyInit,
        headers: {
          'content-type': 'application/gzip',
          'crombolo-sha256': new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
          authorization: `Bearer ${tokenOf(h)}`,
        },
      }),
    )
    return {
      status: response.status,
      body: (await response.json()) as Staged & { message?: string },
    }
  }
  const merge = async (workspace: string) => {
    const merged = await send('POST', `${WORKSPACES}/${workspace}/merge`, {})
    expect(merged.status, await merged.clone().text()).toBe(200)
  }
  return { h, root, page, read, edit, checkout, stage, merge }
}

const titleOf = (doc: { values: Array<{ alias: string; value: unknown }> }) =>
  doc.values.find((v) => v.alias === 'title')?.value

describe(`a site bundle staged as a change (${dialectUnderTest})`, () => {
  test('measured from the source’s last merge: what the bundle left alone keeps the editor’s edit', async () => {
    const s = await site()
    const home = await s.page('Home', 'Welcome')
    const first = await s.checkout()

    // The first staging from a source names its base.
    const refused = await s.stage(first, 'source=ci&into=CI')
    expect(refused.status).toBe(409)
    expect(refused.body.message).toContain('Nothing has been merged from ci yet')

    await s.edit(home, { title: 'Draft' })
    const staged = await s.stage(first, 'source=ci&into=CI&base=now')
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    expect(staged.body.pages).toEqual([{ key: home, name: 'Home', action: 'update' }])
    await s.merge(staged.body.workspace as string)
    expect(titleOf(await s.read(home))).toBe('Welcome')

    // The checkout changes the title; meanwhile an editor renames the page in Shared.
    await s.edit(home, { title: 'Checkout' })
    const second = await s.checkout()
    await s.edit(home, { title: 'Welcome' })
    await s.edit(home, { name: 'Start' })
    const again = await s.stage(second, 'source=ci&into=CI')
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    await s.merge(again.body.workspace as string)
    const now = await s.read(home)
    expect(titleOf(now)).toBe('Checkout')
    expect(now.variants[0]?.name).toBe('Start')

    // Both changed the title since the base: a conflict, and Shared is left as it was.
    await s.edit(home, { title: 'Third' })
    const third = await s.checkout()
    await s.edit(home, { title: 'Editor' })
    const clash = await s.stage(third, 'source=ci&into=CI')
    expect(clash.status).toBe(409)
    expect(clash.body.conflicts.length).toBeGreaterThan(0)
    expect(titleOf(await s.read(home))).toBe('Editor')
  }, 60_000)

  test('a check says what it would do and changes nothing; only prune deletes', async () => {
    const s = await site()
    await s.page('Home', 'Welcome')
    const bundle = await s.checkout()
    const about = await s.page('About', 'About us')

    const kept = await s.stage(bundle, 'source=ci&into=CI&base=now&check=true')
    expect(kept.status, JSON.stringify(kept.body)).toBe(200)
    expect(kept.body.workspace).toBeNull()
    expect(kept.body.pages.some((p) => p.key === about)).toBe(false)

    const pruned = await s.stage(bundle, 'source=ci&into=CI&base=now&check=true&prune=true')
    expect(pruned.body.pages).toContainEqual({ key: about, name: 'About', action: 'delete' })
    const listed = (await (await s.h.call(WORKSPACES)).json()) as { items: unknown[] }
    expect(listed.items).toEqual([])
  }, 60_000)

  test('a checkout with no database is staged as its files: a definition changed, no page touched', async () => {
    const s = await site()
    await s.page('Home', 'Welcome')
    const checkout = mkdtempSync(join(s.root, 'checkout-'))
    for (const dir of ['schema/content-types', 'components'])
      mkdirSync(join(checkout, dir), { recursive: true })
    writeFileSync(join(checkout, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(
      join(checkout, 'schema', 'content-types', 'page.toml'),
      PAGE_TOML.replace('name = "Page"', 'name = "Plain page"'),
    )
    writeFileSync(join(checkout, 'components', 'page.tsx'), 'export default () => <main />\n')
    const staged = await s.stage(packCheckout(checkout, 'riverside'), 'source=ci&into=CI&base=now')
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    expect(staged.body.pages).toEqual([])
    expect(staged.body.files.map((f) => f.path)).toEqual(['schema/content-types/page.toml'])
    expect(staged.body.workspace).toEqual(expect.any(String))
  }, 60_000)

  test('its dictionary is staged as the workspace keeps one, and merged by item', async () => {
    const s = await site()
    await s.page('Home', 'Welcome')
    const made = await s.h.post(`${V1}/dictionary`, {
      name: 'Greeting',
      parent: null,
      translations: [{ isoCode: 'en-US', translation: 'Hello' }],
    })
    expect(made.status).toBe(201)
    const item = made.headers.get('umb-generated-resource') as string
    const bundle = await s.checkout()
    const unchanged = await s.stage(bundle, 'source=ci&into=CI&base=now&check=true')
    expect(unchanged.body.files).toEqual([])
    expect(unchanged.body.leftOut).not.toContain('dictionary.udt')

    const changed = await s.h.put(`${V1}/dictionary/${item}`, {
      name: 'Greeting',
      translations: [{ isoCode: 'en-US', translation: 'Hi' }],
    })
    expect(changed.status).toBe(200)
    const staged = await s.stage(bundle, 'source=ci&into=CI&base=now')
    expect(staged.status, JSON.stringify(staged.body)).toBe(200)
    expect(staged.body.files.map((f) => f.path)).toEqual(['content/dictionary.jsonl'])
    await s.merge(staged.body.workspace as string)
    const now = (await (await s.h.call(`${V1}/dictionary/${item}`)).json()) as {
      translations: Array<{ isoCode: string; translation: string }>
    }
    expect(now.translations).toEqual([{ isoCode: 'en-US', translation: 'Hello' }])
  }, 60_000)

  test('one that changes a component needs Install code', async () => {
    const s = await site()
    await s.page('Home', 'Welcome')
    const bundle = await s.checkout()
    writeFileSync(join(s.root, 'components', 'page.tsx'), 'export default () => <main>v2</main>\n')
    const refused = await s.stage(bundle, 'source=ci&into=CI&base=now')
    expect(refused.status).toBe(403)
    expect(refused.body.message).toBe('You may not stage this site here')
  }, 60_000)
})

describe('a site bundle, read as a change', () => {
  test('its sections are kept where a workspace keeps its files; its code is not', () => {
    expect(siteFileKey('schema/content-types/page.toml')).toBe('schema/content-types/page.toml')
    expect(siteFileKey('components/page.tsx')).toBe('components/page.tsx')
    expect(siteFileKey('styles/site.css')).toBe('stylesheets/site.css')
    expect(siteFileKey('scripts/site.js')).toBe('scripts/site.js')
    expect(siteFileKey('code/server.ts')).toBeUndefined()
    expect(siteFileKey('dictionary.udt')).toBeUndefined()
  })

  test('a node is the state a change carries: its names, values and whether it is live', () => {
    expect(
      siteStateOf({
        key: 'k',
        kind: 'document',
        contentType: { key: 't', alias: 'page' },
        parent: null,
        sortOrder: 0,
        template: 'page',
        variants: [
          { culture: 'en-US', segment: null, name: 'Home', published: true },
          { culture: 'da-DK', segment: null, name: 'Hjem', published: false },
        ],
        values: [{ property: 'title', culture: 'en-US', segment: null, editor: 'x', value: 'Hi' }],
      }),
    ).toEqual({
      name: 'Home',
      names: { 'en-US': 'Home', 'da-DK': 'Hjem' },
      values: [{ alias: 'title', culture: 'en-US', segment: null, value: 'Hi' }],
      published: true,
    })
  })
})
