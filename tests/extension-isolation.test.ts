/**
 * Story 311: an extension runs in a Deno process of its own, holding nothing it
 * was not granted. One test per threat the process answers
 * (docs/extension-threat-model.md, "What process isolation does"): secrets (T1),
 * the database (T2), outbound requests (T7), another extension's data (T11) and
 * a broken or hostile extension stopping the site (T14).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extensionSqlProblem } from '@crombolo/server'
import { siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

/** An extension that tries, on request, each thing it should not be able to do. */
const PROBE = `import { defineBundleTables, route } from '@crombolo/extension'

const attempt = async (fn) => {
  try {
    return { ok: true, value: await fn() }
  } catch (error) {
    return { ok: false, error: error?.name ?? String(error) }
  }
}
const answer = (fn) => async (request, context) => Response.json(await attempt(() => fn(request, context)))
const raw = (db, text) =>
  db.executeQuery({ query: { kind: 'RawNode', sqlFragments: [text], parameters: [] }, sql: text, parameters: [], queryId: { queryId: 'probe' } })

export function probe() {
  return {
    id: 'probe',
    section: 'settings',
    capabilities: ['fetch', 'log'],
    tables: defineBundleTables('probe', [
      {
        name: 'notes',
        release: '1.0.0',
        up: (s) => s.createTable('note', { id: s.uuid().primaryKey(), text: s.text() }),
      },
    ]),
    jobs: {
      async note(payload, { bundle, job }) {
        await bundle.database.insertInto('note').values({ id: crypto.randomUUID(), text: payload.text }).execute()
        await job.progress(1, 1, 'written')
      },
    },
    routes: [
      route('env', { GET: answer(() => Deno.env.toObject()) }, { audience: 'backoffice' }),
      route('read', { GET: answer((_r, { url }) => Deno.readTextFileSync(url.searchParams.get('path'))) }, { audience: 'backoffice' }),
      route('fetch', { GET: answer(async (_r, { url }) => (await fetch(url.searchParams.get('to'))).status) }, { audience: 'backoffice' }),
      route('host-fetch', { GET: answer(async (_r, { url, bundle }) => (await bundle.fetch.fetch(url.searchParams.get('to'))).status) }, { audience: 'backoffice' }),
      route('connect', { GET: answer(async () => (await Deno.connect({ hostname: '127.0.0.1', port: 5432 })).close()) }, { audience: 'backoffice' }),
      route('run', { GET: answer(() => new Deno.Command('/bin/sh', { args: ['-c', 'true'] }).outputSync().code) }, { audience: 'backoffice' }),
      route('ffi', { GET: answer(() => Deno.dlopen('libc.so.6', {})) }, { audience: 'backoffice' }),
      route('pid', { GET: () => Response.json({ pid: Deno.pid }) }, { audience: 'backoffice' }),
      route('throw', { GET: () => { throw new Error('boom') } }, { audience: 'backoffice' }),
      route('hang', { GET: () => { for (;;) {} } }, { audience: 'backoffice' }),
      route('exit', { GET: () => Deno.exit(1) }, { audience: 'backoffice' }),
      route('notes', {
        POST: answer(async (request, { bundle }) => {
          const { text } = await request.json()
          await bundle.database.insertInto('note').values({ id: crypto.randomUUID(), text }).execute()
          return (await bundle.database.selectFrom('note').select('text').execute()).map((row) => row.text)
        }),
      }, { audience: 'backoffice' }),
      route('theirs', { GET: answer((_r, { bundle }) => bundle.database.selectFrom('user').selectAll().execute()) }, { audience: 'backoffice' }),
      route('later', {
        POST: answer(async (_r, { bundle }) => bundle.jobs.enqueue('note', { text: 'from a job' })),
        GET: answer(async (_r, { url, bundle }) => {
          const job = await bundle.jobs.status(url.searchParams.get('id'))
          const notes = (await bundle.database.selectFrom('note').select('text').execute()).map((row) => row.text)
          return { state: job?.state, progress: job?.progress, notes }
        }),
      }, { audience: 'backoffice' }),
      route('attach', { GET: answer((_r, { url, bundle }) => raw(bundle.database, url.searchParams.get('sql'))) }, { audience: 'backoffice' }),
    ],
  }
}
`

async function probeSite() {
  const dir = siteDeclaring('extension-isolation', {
    '@acme/probe': {
      json: {
        exports: './index.js',
        crombolo: {
          id: 'probe',
          name: 'Probe',
          server: 'probe',
          migrations: 'compatible',
          permissions: {
            'data.tables': 'Keeps its own',
            'http.outbound': {
              reason: 'Calls its own service',
              origins: ['https://api.acme.test'],
            },
          },
        },
      },
      files: { 'index.js': PROBE },
    },
  })
  writeFileSync(join(dir, '.env'), 'CROMBOLO_SECRET_KEY=not-for-extensions\n')
  writeFileSync(join(dir, 'crombolo.config.ts'), 'export default {}\n')
  writeFileSync(join(dir, 'site.sqlite'), 'SQLite format 3\0')
  const h = await signedInServer({
    config: {
      siteDir: dir,
      componentsDir: join(dir, 'components'),
      extensions: {
        probe: {
          grant: ['data.tables', 'http.outbound'],
          origins: ['https://api.acme.test'],
          timeoutMs: 2000,
        },
      },
    },
  })
  open.push(h)
  const get = async (path: string) => {
    const response = await h.call(`${BACKOFFICE}/crombolo/api/bundle/probe/${path}`)
    return {
      status: response.status,
      body: (await response.json().catch(() => undefined)) as never,
    }
  }
  return { h, dir, get }
}

type Attempt = { ok: boolean; value?: unknown; error?: string }

describe('an extension in its own process', () => {
  test('T1: has no environment, and cannot read the site’s .env, database or config', async () => {
    const { dir, get } = await probeSite()
    expect(((await get('env')).body as Attempt).error).toBe('NotCapable')
    for (const file of ['.env', 'site.sqlite', 'crombolo.config.ts']) {
      const read = (await get(`read?path=${encodeURIComponent(join(dir, file))}`)).body as Attempt
      expect(read, file).toEqual({ ok: false, error: 'NotCapable' })
    }
  }, 60_000)

  test('T7: reaches only the origins it declared, and opens no raw connection', async () => {
    const { get } = await probeSite()
    for (const to of ['https://example.com/', 'http://10.0.0.1/', 'http://127.0.0.1:8080/'])
      expect(((await get(`fetch?to=${encodeURIComponent(to)}`)).body as Attempt).error, to).toBe(
        'NotCapable',
      )
    expect(
      ((await get(`host-fetch?to=${encodeURIComponent('http://127.0.0.1:8080/')}`)).body as Attempt)
        .ok,
    ).toBe(false)
    expect(((await get('connect')).body as Attempt).error).toBe('NotCapable')
  }, 60_000)

  test('cannot run a program or load native code', async () => {
    const { get } = await probeSite()
    expect(((await get('run')).body as Attempt).error).toBe('NotCapable')
    expect(((await get('ffi')).body as Attempt).error).toBe('NotCapable')
  }, 60_000)

  test('T2, T11: reaches its own tables through the CMS, and no others; ATTACH is refused', async () => {
    const { h, get } = await probeSite()
    const added = await h.post(`${BACKOFFICE}/crombolo/api/bundle/probe/notes`, { text: 'hello' })
    expect(await added.json()).toEqual({ ok: true, value: ['hello'] })
    expect(((await get('theirs')).body as Attempt).ok).toBe(false)
    const attach = (
      await get(`attach?sql=${encodeURIComponent("ATTACH DATABASE 'crombolo.sqlite' AS site")}`)
    ).body as Attempt
    expect(attach.ok).toBe(false)
  }, 60_000)

  test('T14: one that throws, hangs or exits fails its call, the site keeps serving, and it is started again', async () => {
    const { h, get } = await probeSite()
    expect((await get('throw')).status).toBe(500)
    const before = ((await get('pid')).body as { pid: number }).pid

    expect((await get('exit')).status).toBe(500)
    expect((await h.call('/health')).status).toBeLessThan(500)
    const restarted = ((await get('pid')).body as { pid: number }).pid
    expect(restarted).not.toBe(before)

    expect((await get('hang')).status).toBe(500)
    expect((await h.call('/health')).status).toBeLessThan(500)
    // The hung process is stopped and a new one answers, after its back-off.
    let after: number | undefined
    for (let i = 0; i < 20 && !after; i++) {
      const answered = await get('pid')
      if (answered.status === 200) after = (answered.body as { pid: number }).pid
      else await Bun.sleep(500)
    }
    expect(after).toBeDefined()
    expect(after).not.toBe(restarted)
  }, 90_000)
})

describe('over the channel', () => {
  test('a job runs in its process, with its progress and its tables', async () => {
    const { h, get } = await probeSite()
    const queued = await h.post(`${BACKOFFICE}/crombolo/api/bundle/probe/later`, {})
    const { value: id } = (await queued.json()) as { value: string }
    await h.server.backgroundJobs.runDue()
    expect(((await get(`later?id=${id}`)).body as Attempt).value).toMatchObject({
      state: 'succeeded',
      progress: { done: 1, total: 1, note: 'written' },
      notes: ['from a job'],
    })
  }, 60_000)
})

describe('an extension that cannot run apart from the CMS', () => {
  test('is left off, saying why, and the site starts without it', async () => {
    const dir = siteDeclaring('extension-isolation-off', {
      '@acme/bunny': {
        json: { exports: './index.js', crombolo: { id: 'bunny', name: 'Bunny', server: 'bunny' } },
        files: {
          'index.js': `export function bunny() { Bun.file('x'); return { id: 'bunny', section: 'settings', capabilities: [] } }\n`,
        },
      },
      '@acme/chain': {
        json: { exports: './index.js', crombolo: { id: 'chain', name: 'Chain', server: 'chain' } },
        files: {
          'index.js': `export function chain() { return { id: 'chain', section: 'settings', capabilities: [], middleware: () => undefined } }\n`,
        },
      },
    })
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        extensions: { bunny: { grant: [] }, chain: { grant: [] } },
      },
    })
    open.push(h)
    const listed = (await (
      await h.call(`${BACKOFFICE}/crombolo/api/bundles/installed`)
    ).json()) as {
      items: { id: string; couldNotStart?: string }[]
    }
    const reason = (id: string) => listed.items.find((item) => item.id === id)?.couldNotStart
    expect(reason('bunny')).toContain('Bun is not defined')
    expect(reason('chain')).toContain('middleware')
  }, 60_000)
})

describe('what the CMS runs of an extension’s queries', () => {
  test('one statement that reads or writes rows', () => {
    expect(extensionSqlProblem('select * from "note" where "id" = ?', 'sqlite')).toBeUndefined()
    expect(
      extensionSqlProblem('insert into "note" ("text") values ($1)', 'postgres'),
    ).toBeUndefined()
    expect(extensionSqlProblem("select 'ATTACH; RESET ROLE' as t", 'sqlite')).toBeUndefined()
  })

  test('not ATTACH, PRAGMA, a role change, set_config, or two statements', () => {
    for (const sql of [
      "ATTACH DATABASE 'x' AS y",
      'PRAGMA table_info(user)',
      'RESET ROLE',
      'SET ROLE crombolo',
      "select set_config('role', 'crombolo', true)",
      'select 1; drop table note',
      'DO $$ BEGIN RESET ROLE; END $$',
      '/* hi */ attach database $1 as y',
    ])
      expect(extensionSqlProblem(sql, 'postgres'), sql).toBeDefined()
  })
})
