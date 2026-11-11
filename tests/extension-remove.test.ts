/**
 * Story 328: removing an extension stops it, forgets its grant and settings,
 * and deletes its root, its build and its line, in one step with one audit
 * entry. Its data, its tables and its data folder, stays unless asked, listed
 * under "Data left by…" with a delete of its own, and an install of the same
 * extension picks it back up. Nothing is backed up first.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readRecord } from '@crombolo/backoffice-host'
import { BundleGrantRepository } from '@crombolo/data'
import { siteDeclaring } from './support/bundles.ts'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const NOTES = `import { defineBundleTables, route } from '@crombolo/extension'

export function notes() {
  return {
    id: 'notes',
    section: 'settings',
    capabilities: ['log'],
    tables: defineBundleTables('notes', [
      { name: 'notes', release: '1.0.0', up: (s) => s.createTable('note', { id: s.uuid().primaryKey(), text: s.text() }) },
    ]),
    routes: [
      route('note', {
        POST: async (_r, { bundle }) => {
          await bundle.database.insertInto('note').values({ id: crypto.randomUUID(), text: 'kept' }).execute()
          return Response.json({ ok: true })
        },
      }, { audience: 'backoffice' }),
    ],
  }
}
`

async function notesSite() {
  const dir = siteDeclaring('extension-remove', {
    '@acme/notes': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'notes',
          name: 'Notes',
          server: 'notes',
          migrations: 'compatible',
          permissions: { 'data.tables': 'Keeps notes' },
        },
      },
      files: { 'index.js': NOTES },
    },
  })
  // Granted by the site's code, so its tables are made at boot.
  const h = await signedInServer({
    config: {
      siteDir: dir,
      componentsDir: join(dir, 'components'),
      extensions: { notes: { grant: ['data.tables'] } },
    },
  })
  open.push(h)
  const wrote = await h.post(`${BACKOFFICE}/crombolo/api/bundle/notes/note`, {})
  expect(wrote.status, await wrote.clone().text()).toBe(200)
  return { h, dir }
}

type Installed = {
  items: { id: string }[]
  left: { id: string; tables: string[] }[]
}

const remove = (h: Harness, body: object = {}) =>
  h.post(`${BACKOFFICE}/crombolo/api/extensions/uninstall`, { name: '@acme/notes', ...body })

describe(`removing an extension (${dialectUnderTest})`, () => {
  test('keeps its data by default, and nothing else of it', async () => {
    const { h, dir } = await notesSite()
    // Its tables, as its first run makes them, and a file in its data folder.
    const home = join(dir, '.crombolo', 'extensions', 'notes')
    mkdirSync(join(home, 'data'), { recursive: true })
    writeFileSync(join(home, 'data', 'cache.json'), '{}')
    mkdirSync(join(home, 'build'), { recursive: true })
    expect(
      (await h.json<Installed>(`${BACKOFFICE}/crombolo/api/extensions/installed`)).left,
    ).toEqual([])

    const removed = await remove(h)
    const outcome = await removed.json()
    expect(removed.status, JSON.stringify(outcome)).toBe(200)
    expect(outcome.dataKept).toBe(true)
    expect(outcome.message).toContain('Its data was kept')

    expect(existsSync(join(dir, 'extensions', 'notes'))).toBe(false)
    expect(readRecord(dir)).toEqual({})
    expect(existsSync(join(home, 'build'))).toBe(false)
    expect(existsSync(join(home, 'data', 'cache.json'))).toBe(true)
    expect(await new BundleGrantRepository(h.server.db).get('notes')).toBeUndefined()
    // Its tables stay, listed as what it left.
    const left = (await h.json<Installed>(`${BACKOFFICE}/crombolo/api/extensions/installed`)).left
    expect(left).toEqual([{ id: 'notes', tables: [expect.stringContaining('note')] }])

    const log = await h.json<{ items: { action: string; detail: string | null }[] }>(
      `${BACKOFFICE}/crombolo/api/audit?take=20`,
    )
    expect(log.items.filter((item) => item.action === 'Uninstall')).toEqual([
      expect.objectContaining({ detail: 'removed; its data kept' }),
    ])
  }, 90_000)

  test('with its data asked for, the folder goes too, and nothing is left', async () => {
    const { h, dir } = await notesSite()
    const home = join(dir, '.crombolo', 'extensions', 'notes')
    mkdirSync(join(home, 'data'), { recursive: true })
    const removed = await remove(h, { dropData: true })
    const outcome = await removed.json()
    expect(removed.status, JSON.stringify(outcome)).toBe(200)
    expect(outcome.dataKept).toBeUndefined()
    expect(existsSync(home)).toBe(false)
    const installed = await h.json<Installed>(`${BACKOFFICE}/crombolo/api/extensions/installed`)
    expect(installed.left.map((left) => left.id)).not.toContain('notes')
  }, 90_000)

  test('is an administrator’s, and a wired bundle is refused', async () => {
    const { h } = await notesSite()
    const writer = await signInAsGroup(h, 'writer')
    expect((await remove(writer)).status).toBe(403)
    expect(
      (await writer.post(`${BACKOFFICE}/crombolo/api/extensions/drop-left-data`, { id: 'notes' }))
        .status,
    ).toBe(403)
  }, 90_000)

  test('the data it left is deleted on its own, and an installed one’s is refused', async () => {
    const { h } = await notesSite()
    expect(
      (await h.post(`${BACKOFFICE}/crombolo/api/extensions/drop-left-data`, { id: 'notes' }))
        .status,
    ).toBe(409)
    await remove(h)
    const dropped = await h.post(`${BACKOFFICE}/crombolo/api/extensions/drop-left-data`, {
      id: 'notes',
    })
    expect(dropped.status, await dropped.clone().text()).toBe(200)
    expect((await dropped.json()).dropped).toEqual([expect.stringContaining('note')])
    const gone = await h.json<Installed>(`${BACKOFFICE}/crombolo/api/extensions/installed`)
    expect(gone.left).toEqual([])
  }, 90_000)
})
