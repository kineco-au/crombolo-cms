/**
 * Story 327: what each extension did, attributed to it and to the person it
 * acted for. Writes, requests out, rows written, refusals, calls and screens
 * are a row each; reads are counted per minute. No statement, body or value is
 * kept. Installed opens it, filters it, counts it and exports it, and rows
 * older than the window go.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { cromboloPlan, type Db, ExtensionActivityLog, migrate } from '@crombolo/data'
import { createActivityRecorder, readActivityQuery } from '@crombolo/server'
import {
  activitySentence,
  countsLine,
} from '../packages/backoffice-host/plugin/bundles-activity-words.js'
import { siteDeclaring } from './support/bundles.ts'
import { dialectUnderTest, freshDb } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
const dbs: Db[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  for (const db of dbs.splice(0)) await db.close().catch(() => {})
})

async function migrated(): Promise<Db> {
  const db = await freshDb()
  dbs.push(db)
  await migrate(db, cromboloPlan)
  return db
}

const row = (over: Partial<Parameters<ExtensionActivityLog['record']>[0][number]> = {}) => ({
  extensionId: 'crm',
  personKey: null,
  personName: null,
  kind: 'write' as const,
  area: 'redirects',
  verb: 'save',
  entityKey: null,
  count: 1,
  outcome: 'ok' as const,
  ms: 3,
  occurredAt: new Date(),
  ...over,
})

describe(`the log (${dialectUnderTest})`, () => {
  test('pages newest first, filters by kind and person, counts and names the people', async () => {
    const store = new ExtensionActivityLog(await migrated())
    await store.record([
      row({ kind: 'read', count: 50 }),
      row({ personKey: 'u1', personName: 'Adam' }),
      row({ kind: 'refused', outcome: 'refused' }),
      row({ extensionId: 'other' }),
    ])
    const page = await store.page('crm', {}, { limit: 2 })
    expect(page.items.map((item) => item.kind)).toEqual(['refused', 'write'])
    expect(page.next).not.toBeNull()
    const rest = await store.page('crm', {}, { before: page.next as number, limit: 2 })
    expect(rest.items.map((item) => item.kind)).toEqual(['read'])
    expect((await store.page('crm', { kind: 'refused' }, { limit: 10 })).items).toHaveLength(1)
    expect((await store.page('crm', { person: 'u1' }, { limit: 10 })).items).toHaveLength(1)
    expect((await store.page('crm', { person: 'itself' }, { limit: 10 })).items).toHaveLength(2)
    expect(await store.counts('crm')).toMatchObject({ read: 50, write: 1, refused: 1, request: 0 })
    expect(await store.people('crm')).toEqual([{ key: 'u1', name: 'Adam' }])
  })

  test('prunes what is older than the window, and keeps an extension to its cap', async () => {
    const store = new ExtensionActivityLog(await migrated())
    const old = new Date(Date.now() - 20 * 86_400_000)
    await store.record([row({ occurredAt: old }), row(), row(), row()])
    expect(await store.prune(new Date(Date.now() - 14 * 86_400_000))).toBe(1)
    expect(await store.cap('crm', 2)).toBe(1)
    expect((await store.page('crm', {}, { limit: 10 })).items).toHaveLength(2)
  })
})

describe(`the recorder (${dialectUnderTest})`, () => {
  test('folds a minute’s reads into one row, and writes each change apart', async () => {
    const db = await migrated()
    const recorder = createActivityRecorder(db, { flushMs: 60_000 })
    const read = {
      extensionId: 'crm',
      personKey: 'u1',
      personName: 'Adam',
      kind: 'read' as const,
      area: 'content',
      verb: 'GET',
      outcome: 'ok' as const,
    }
    for (let i = 0; i < 5; i++) recorder.record(read)
    recorder.record({ ...read, kind: 'write', verb: 'PUT' })
    recorder.record({ ...read, kind: 'write', verb: 'PUT' })
    await recorder.stop()
    const items = (await new ExtensionActivityLog(db).page('crm', {}, { limit: 10 })).items
    expect(items.map((item) => [item.kind, item.count]).sort()).toEqual([
      ['read', 5],
      ['write', 1],
      ['write', 1],
    ])
  })
})

describe('the query and the words', () => {
  test('a page query is held to its limits', () => {
    expect(readActivityQuery(new URLSearchParams('limit=0'))).toBe(
      'limit must be between 1 and 500.',
    )
    expect(readActivityQuery(new URLSearchParams('kind=everything'))).toBe(
      'There is no kind "everything".',
    )
    expect(readActivityQuery(new URLSearchParams('kind=refused&before=9&person=itself'))).toEqual({
      filter: { kind: 'refused', person: 'itself' },
      cursor: { before: 9, limit: 100 },
    })
  })

  test('each row reads as a sentence, and the counts as a line', () => {
    expect(activitySentence({ kind: 'read', area: 'content', count: 50 })).toBe(
      'read pages, 50 times',
    )
    expect(activitySentence({ kind: 'request', area: 'api.acme.com', outcome: 'ok' })).toBe(
      'sent a request to api.acme.com',
    )
    expect(activitySentence({ kind: 'rows', area: 'note', verb: 'insert', count: 3 })).toBe(
      'wrote 3 rows to note',
    )
    expect(activitySentence({ kind: 'screen', area: 'rules', verb: 'view' })).toBe(
      'opened the rules screen',
    )
    expect(
      activitySentence({ kind: 'refused', area: 'redirects', verb: 'save (redirects.write)' }),
    ).toBe('was refused: save (redirects.write)')
    expect(countsLine({ write: 12, request: 3, refused: 1, read: 0 })).toBe(
      '12 writes, 3 requests out, 1 refused',
    )
    expect(countsLine({})).toBe('Nothing yet')
  })
})

/** An extension that reads, writes, keeps rows, reaches out and is refused, as asked. */
const BUSY = `import { defineBundleTables, route } from '@crombolo/extension'

const attempt = async (fn) => {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) }
  }
}
const answer = (fn) => async (request, context) => Response.json(await attempt(() => fn(request, context)))

export function busy() {
  return {
    id: 'busy',
    section: 'settings',
    capabilities: ['redirects', 'fetch', 'log'],
    tables: defineBundleTables('busy', [
      { name: 'notes', release: '1.0.0', up: (s) => s.createTable('note', { id: s.uuid().primaryKey(), text: s.text() }) },
    ]),
    routes: [
      route('read', { GET: answer((_r, { bundle }) => bundle.redirects.list()) }, { audience: 'backoffice' }),
      route('write', {
        POST: answer((_r, { bundle }) =>
          bundle.redirects.save({ matchKind: 'exact', pattern: '/busy-old', targetKind: 'path', target: '/busy-new', statusCode: 301 }),
        ),
      }, { audience: 'backoffice' }),
      route('note', {
        POST: answer(async (_r, { bundle }) => bundle.database.insertInto('note').values({ id: crypto.randomUUID(), text: 'secret value' }).execute()),
      }, { audience: 'backoffice' }),
      route('away', { GET: answer((_r, { bundle }) => bundle.fetch.fetch('https://elsewhere.example/x')) }, { audience: 'backoffice' }),
    ],
  }
}
`

async function busySite() {
  const dir = siteDeclaring('extension-activity', {
    '@acme/busy': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'busy',
          name: 'Busy',
          server: 'busy',
          migrations: 'compatible',
          permissions: {
            'redirects.read': 'Lists rules',
            'redirects.write': 'Saves rules',
            'data.tables': 'Keeps notes',
            'http.outbound': { reason: 'Calls its service', origins: ['https://api.acme.test'] },
          },
        },
      },
      files: { 'index.js': BUSY },
    },
  })
  const h = await signedInServer({
    config: {
      siteDir: dir,
      componentsDir: join(dir, 'components'),
      extensions: {
        busy: {
          grant: ['redirects.read', 'redirects.write', 'data.tables', 'http.outbound'],
          origins: ['https://api.acme.test'],
        },
      },
    },
  })
  open.push(h)
  return h
}

type Entry = {
  kind: string
  area: string | null
  verb: string | null
  count: number
  outcome: string
  personName: string | null
  entityKey: string | null
}

describe(`through its own process (${dialectUnderTest})`, () => {
  test('what it did is recorded with whom it acted for, and summarised, filtered and exported', async () => {
    const h = await busySite()
    const route = (path: string) => `${BACKOFFICE}/crombolo/api/bundle/busy/${path}`
    await h.call(route('read'))
    await h.call(route('read'))
    await h.post(route('write'), {})
    await h.post(route('note'), {})
    expect((await h.json<{ ok: boolean }>(route('away'))).ok).toBe(false)

    const base = `${BACKOFFICE}/crombolo/api/extensions/installed/busy/activity`
    const { items } = await h.json<{ items: Entry[] }>(`${base}?limit=100`)
    const of = (kind: string) => items.filter((item) => item.kind === kind)
    expect(of('read').find((item) => item.area === 'redirects')).toMatchObject({
      verb: 'list',
      count: 2,
      personName: 'Administrator',
    })
    expect(of('write')).toEqual([
      expect.objectContaining({
        area: 'redirects',
        verb: 'save',
        outcome: 'ok',
        personName: 'Administrator',
      }),
    ])
    expect(of('rows')).toEqual([
      expect.objectContaining({ area: 'note', verb: 'insert', count: 1 }),
    ])
    expect(of('refused')).toEqual([
      expect.objectContaining({ area: 'elsewhere.example', outcome: 'refused' }),
    ])
    expect(of('call').map((item) => item.area)).toContain('route read')
    // Nothing it sent or stored is kept: not the note's text, not a statement.
    expect(JSON.stringify(items)).not.toContain('secret value')
    expect(JSON.stringify(items)).not.toMatch(/insert into/i)

    const summary = await h.json<{ counts: Record<string, number>; people: unknown[] }>(
      `${base}/summary`,
    )
    expect(summary.counts).toMatchObject({ write: 1, refused: 1, rows: 1 })
    expect(summary.people).toEqual([expect.objectContaining({ name: 'Administrator' })])

    const refused = await h.json<{ items: Entry[] }>(`${base}?kind=refused`)
    expect(refused.items).toHaveLength(1)

    const csv = await (await h.call(`${base}.csv?kind=write`)).text()
    expect(csv.split('\n')[0]).toBe('when,person,kind,area,verb,item,count,outcome,ms')
    expect(csv).toContain(',Administrator,write,redirects,save,')
    expect((await h.call(`${base}?limit=0`)).status).toBe(400)
  }, 90_000)
})
