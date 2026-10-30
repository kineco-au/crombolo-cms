/**
 * Background and scheduled work for the site and its bundles (story 187): cron
 * in a timezone, the queue's claims, retries and limits, schedules that run once
 * across nodes, stopping, and what a job is given. docs/rendering.md,
 * "Background jobs"; docs/bundles.md, "Jobs".
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { route } from '@crombolo/common'
import {
  cromboloPlan,
  type Db,
  defineSiteTables,
  JobRepository,
  migrate,
  sql,
} from '@crombolo/data'
import {
  type BundleRedirects,
  createJobRunner,
  createServerBundles,
  isTimezone,
  type JobOwner,
  JobPayloadTooLargeError,
  jobProblems,
  nextOccurrence,
  parseCron,
  retryDelayMs,
  type ServerBundle,
  siteJobProblems,
  UnknownJobError,
  VERSION,
} from '@crombolo/server'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { dialectUnderTest, freshDb } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
const dbs: Db[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dbs.length > 0)
    await dbs
      .pop()
      ?.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const at = (iso: string) => new Date(iso)

describe('cron', () => {
  test('reads the five fields, steps, ranges, lists and names', () => {
    const cron = parseCron('*/15 9-17 * jan,jul mon-fri')
    expect([...cron.minutes]).toEqual([0, 15, 30, 45])
    expect(cron.hours.size).toBe(9)
    expect([...cron.months]).toEqual([1, 7])
    expect([...cron.weekdays]).toEqual([1, 2, 3, 4, 5])
    expect([...parseCron('0 0 * * 7').weekdays]).toEqual([0])
    for (const bad of ['* * * *', '60 * * * *', '* 24 * * *', '5-1 * * * *', '*/0 * * * *'])
      expect(() => parseCron(bad), bad).toThrow()
  })

  test('the next occurrence follows the named zone, daylight saving included', () => {
    const nightly = parseCron('0 2 * * *')
    // London is UTC+0 in winter and UTC+1 in summer: 02:00 local each time.
    expect(nextOccurrence(nightly, 'Europe/London', at('2026-01-10T12:00:00Z'))).toEqual(
      at('2026-01-11T02:00:00Z'),
    )
    expect(nextOccurrence(nightly, 'Europe/London', at('2026-07-10T12:00:00Z'))).toEqual(
      at('2026-07-11T01:00:00Z'),
    )
    expect(nextOccurrence(nightly, 'UTC', at('2026-07-11T02:00:00Z'))).toEqual(
      at('2026-07-12T02:00:00Z'),
    )
    // Weekdays at 07:00 in Sydney, from a Friday evening there: the Monday.
    expect(
      nextOccurrence(parseCron('0 7 * * 1-5'), 'Australia/Sydney', at('2026-10-30T09:00:00Z')),
    ).toEqual(at('2026-11-01T20:00:00Z'))
    // Only 29 February: found years ahead.
    expect(nextOccurrence(parseCron('0 0 29 2 *'), 'UTC', at('2026-03-01T00:00:00Z'))).toEqual(
      at('2028-02-29T00:00:00Z'),
    )
    expect(isTimezone('Europe/London')).toBe(true)
    expect(isTimezone('Mars/Olympus')).toBe(false)
  })
})

describe('declarations', () => {
  const run = async () => {}
  test('a job is a function, used once; a schedule names a job, a cron and a zone', () => {
    const problems = jobProblems('Bundle "acme"', { one: run, two: run, three: 3 }, [
      { job: 'missing', cron: '0 * * * *' },
      { job: 'one', cron: 'every day' },
      { job: 'one', cron: '0 2 * * *', timezone: 'Mars/Olympus' },
      { job: 'one', cron: '0 2 * * *', missed: 'later' as never },
      { job: 'one', cron: '0 2 * * *', timezone: 'Europe/London', missed: 'skip' },
    ]).join('\n')
    expect(problems).toContain('the job "two" is the same function as "one"')
    expect(problems).toContain('the job "three" is not a function')
    expect(problems).toContain('names no job of its own')
    expect(problems).toContain('not the five of minute')
    expect(problems).toContain('"Mars/Olympus" is not a timezone')
    expect(problems).toContain('"missed" is "run" or "skip"')
    expect(problems.split('\n')).toHaveLength(6)
  })

  test("the site's jobs are module.export, from modules", () => {
    expect(siteJobProblems({ jobs: { imports: { runBatch: run } } })).toEqual([])
    expect(
      siteJobProblems({
        jobs: { imports: { runBatch: run } },
        schedules: [{ job: 'imports.runBatch', cron: '0 3 * * *' }],
      }),
    ).toEqual([])
    expect(siteJobProblems({ jobs: { 'bad-name': { a: run } } }).join('\n')).toContain(
      'is not a name',
    )
  })
})

async function db(): Promise<Db> {
  const d = await freshDb()
  dbs.push(d)
  await migrate(d, cromboloPlan)
  return d
}

function owner(
  id: string,
  handlers: Record<string, JobOwner['handlers'] extends ReadonlyMap<string, infer H> ? H : never>,
  more: Partial<JobOwner> = {},
): JobOwner {
  return {
    id,
    handlers: new Map(Object.entries(handlers)),
    schedules: [],
    context: () => ({ given: id }),
    on: () => true,
    ...more,
  }
}

describe(`the queue (${dialectUnderTest})`, () => {
  test('runs a job with its payload and context, and its owner reads its progress', async () => {
    const d = await db()
    const seen: unknown[] = []
    const runner = createJobRunner({
      db: d,
      nodeId: 'a',
      owners: () => [
        owner('site', {
          'imports.runBatch': async (payload, context) => {
            seen.push(payload, context.given, context.job.attempt, context.job.queuedBy)
            await context.job.progress(40, 100, 'species checked')
          },
        }),
      ],
    })
    const id = await runner
      .jobsFor('site', 'member jo')
      .enqueue('imports.runBatch', { batchId: 42 })
    expect((await runner.jobsFor('site', null).status(id))?.state).toBe('queued')
    expect(await runner.runDue()).toBe(1)
    expect(seen).toEqual([{ batchId: 42 }, 'site', 1, 'member jo'])
    const status = await runner.jobsFor('site', null).status(id)
    expect(status).toMatchObject({
      state: 'succeeded',
      progress: { done: 40, total: 100, note: 'species checked' },
      queuedBy: 'member jo',
    })
    // Another owner does not see it.
    expect(await runner.jobsFor('acme', null).status(id)).toBeUndefined()
  })

  test('refuses a job it does not have, and a payload past 64 KB, naming both', async () => {
    const d = await db()
    const runner = createJobRunner({
      db: d,
      nodeId: 'a',
      owners: () => [owner('site', { 'a.b': () => {} })],
    })
    await expect(runner.jobsFor('site', null).enqueue('a.c')).rejects.toBeInstanceOf(
      UnknownJobError,
    )
    const error = await runner
      .jobsFor('site', null)
      .enqueue('a.b', { rows: 'x'.repeat(70_000) })
      .catch((e) => e)
    expect(error).toBeInstanceOf(JobPayloadTooLargeError)
    expect((error as Error).message).toContain('a.b')
    expect((error as Error).message).toContain('70011 bytes')
    expect((await new JobRepository(d).list()).total).toBe(0)
  })

  test('retries with back-off, stops after the limit with its error, and is run again by hand', async () => {
    const d = await db()
    let clock = at('2026-10-30T00:00:00Z')
    let fails = true
    const runner = createJobRunner({
      db: d,
      nodeId: 'a',
      now: () => clock,
      owners: () => [
        owner('site', {
          'a.b': () => {
            if (fails) throw new Error('the registry is down')
          },
        }),
      ],
    })
    const id = await runner.jobsFor('site', null).enqueue('a.b')
    const repo = new JobRepository(d)
    for (let attempt = 1; attempt <= 5; attempt++) {
      // Due now, then not again until its back-off has passed.
      const job = await repo.get(id)
      clock = job?.nextAttemptAt && job.nextAttemptAt > clock ? job.nextAttemptAt : clock
      expect(await runner.runDue()).toBe(1)
      expect(await runner.runDue()).toBe(0)
    }
    const failed = await repo.get(id)
    expect(failed).toMatchObject({
      state: 'failed',
      attempts: 5,
      lastError: 'the registry is down',
    })
    expect(retryDelayMs(1)).toBe(30_000)
    expect(retryDelayMs(3)).toBe(120_000)
    expect(retryDelayMs(20)).toBe(60 * 60_000)

    fails = false
    expect(await repo.retry(id)).toBe(true)
    expect(await runner.runDue()).toBe(1)
    expect((await repo.get(id))?.state).toBe('succeeded')
  })

  test('two nodes claiming at once run each job once', async () => {
    const d = await db()
    const ran: string[] = []
    const handlers = { 'a.b': async (payload: { n: number }) => void ran.push(String(payload.n)) }
    const a = createJobRunner({ db: d, nodeId: 'a', owners: () => [owner('site', handlers)] })
    const b = createJobRunner({ db: d, nodeId: 'b', owners: () => [owner('site', handlers)] })
    for (let n = 0; n < 6; n++) await a.jobsFor('site', null).enqueue('a.b', { n })
    await Promise.all([a.runDue(), b.runDue()])
    expect(ran.sort()).toEqual(['0', '1', '2', '3', '4', '5'])
  })

  test('a stopping node aborts its job’s signal and releases what has not finished', async () => {
    const d = await db()
    let started!: () => void
    const begun = new Promise<void>((resolve) => {
      started = resolve
    })
    const runner = createJobRunner({
      db: d,
      nodeId: 'a',
      graceMs: 50,
      owners: () => [
        owner('site', {
          'a.b': (_payload, context) =>
            new Promise((_resolve, reject) => {
              started()
              context.job.signal.addEventListener('abort', () =>
                setTimeout(() => reject(new Error('stopped')), 10),
              )
            }),
        }),
      ],
    })
    const id = await runner.jobsFor('site', null).enqueue('a.b')
    const running = runner.runDue()
    await begun
    await runner.stop()
    await running
    expect(await new JobRepository(d).get(id)).toMatchObject({ state: 'queued', attempts: 0 })
  })

  test('a bundle that is off keeps its jobs waiting', async () => {
    const d = await db()
    let on = false
    const ran: string[] = []
    const runner = createJobRunner({
      db: d,
      nodeId: 'a',
      owners: () => [owner('acme', { sweep: () => void ran.push('sweep') }, { on: () => on })],
    })
    await runner.jobsFor('acme', null).enqueue('sweep')
    expect(await runner.runDue()).toBe(0)
    on = true
    expect(await runner.runDue()).toBe(1)
    expect(ran).toEqual(['sweep'])
  })
})

describe(`schedules (${dialectUnderTest})`, () => {
  const hourly = { job: 'a.b', cron: '0 * * * *' }
  const runners = (d: Db, schedules: JobOwner['schedules']) =>
    ['a', 'b'].map((nodeId) =>
      createJobRunner({
        db: d,
        nodeId,
        owners: () => [owner('site', { 'a.b': () => {} }, { schedules })],
      }),
    )

  test('a new schedule waits for its next occurrence, which exactly one node queues', async () => {
    const d = await db()
    const [a, b] = runners(d, [hourly]) as [
      ReturnType<typeof createJobRunner>,
      ReturnType<typeof createJobRunner>,
    ]
    expect(await a.runSchedules(at('2026-10-30T09:30:00Z'))).toBe(0)
    expect(await b.runSchedules(at('2026-10-30T09:45:00Z'))).toBe(0)
    const both = await Promise.all([
      a.runSchedules(at('2026-10-30T10:00:10Z')),
      b.runSchedules(at('2026-10-30T10:00:20Z')),
    ])
    expect(both.reduce((x, y) => x + y, 0)).toBe(1)
    expect((await new JobRepository(d).list()).items.map((job) => job.queuedBy)).toEqual([
      'schedule 0 * * * *',
    ])
  })

  test('after downtime a missed occurrence runs once, or not at all with missed: skip', async () => {
    const d = await db()
    const [a] = runners(d, [hourly, { job: 'a.b', cron: '30 * * * *', missed: 'skip' }])
    await a?.runSchedules(at('2026-10-30T09:00:30Z'))
    // Down for a day: dozens of each were missed.
    expect(await a?.runSchedules(at('2026-10-31T09:10:00Z'))).toBe(1)
    expect(await a?.runSchedules(at('2026-10-31T09:20:00Z'))).toBe(0)
    // Back on the timetable: the skipped one runs at its next occurrence.
    expect(await a?.runSchedules(at('2026-10-31T09:30:30Z'))).toBe(1)
  })
})

/** A site with a job of its own, and a bundle's job that tries what it may not. */
function jobsSite() {
  const dir = siteDeclaring('background-jobs', {
    '@acme/sweeper': {
      json: {
        version: '1.0.0',
        crombolo: {
          id: 'sweeper',
          server: 'sweeper',
          permissions: ['redirects.read'],
        },
      },
    },
  })
  dirs.push(dir)
  const seen: Record<string, unknown> = {}
  const bundle: ServerBundle = {
    id: 'sweeper',
    section: 'settings',
    capabilities: ['redirects'],
    jobs: {
      async sweep(payload, { bundle, job }) {
        seen.queuedBy = job.queuedBy
        seen.payload = payload
        seen.redirects = (await (bundle as { redirects: BundleRedirects }).redirects.list()).total
        await job.progress(1, 1, 'done')
      },
    },
    routes: [
      route<
        unknown,
        unknown,
        {
          bundle: {
            jobs: {
              enqueue(n: string, p?: unknown): Promise<string>
              status(id: string): Promise<unknown>
            }
          }
        }
      >('/sweeper', {
        async POST(_request, { bundle }) {
          return Response.json({ id: await bundle.jobs.enqueue('sweep', { since: 'yesterday' }) })
        },
      }),
      route<unknown, unknown, { bundle: { jobs: { status(id: string): Promise<unknown> } } }>(
        '/sweeper/:id',
        {
          async GET(_request, { bundle, params }) {
            return Response.json(await bundle.jobs.status(params.id as string))
          },
        },
      ),
    ] as never,
  }
  const tables = defineSiteTables([
    {
      name: 'notes',
      release: '1.0.0',
      up: (s) => s.createTable('note', { id: s.integer().primaryKey(), text: s.text() }),
    },
  ])
  const imports = {
    async note(
      payload: { id: number },
      context: { db: never; site: { members: Record<string, unknown> } },
    ) {
      const db = context.db as unknown as import('@crombolo/data').TablesDatabase<typeof tables>
      await db.insertInto('note').values({ id: payload.id, text: 'from a job' }).execute()
      // Nothing acts as the site: crombolo's own tables are out of reach.
      seen.coreTables = await sql`select * from key_value`.execute(db).then(
        () => 'read',
        () => 'refused',
      )
    },
  }
  const enqueue = route('/notes/:id', {
    async POST(_request, { params, site }) {
      const id = await (
        site() as { jobs: { enqueue(n: string, p: unknown): Promise<string> } }
      ).jobs.enqueue('imports.note', { id: Number(params.id) })
      return Response.json({ id })
    },
  })
  return { dir, bundle, tables, imports, enqueue, seen }
}

describe("a bundle job's capabilities", () => {
  test('are built for a job, which a capability acting for the caller treats as the public', () => {
    const callers: string[] = []
    const bundle = {
      id: 'sweeper',
      section: 'settings',
      capabilities: ['redirects', 'media'],
      media: { folders: ['/Sweeper'], maxBytes: 1_000_000 },
      jobs: { sweep: () => {} },
    } as unknown as ServerBundle
    const mounted = createServerBundles({
      bundles: [bundle],
      packages: [
        stubBundlePackage('sweeper', {
          field: {
            id: 'sweeper',
            server: 'sweeper',
            schemaVersion: 3,
            permissions: ['redirects.read', 'media.write', 'member.delegate'],
          },
        }),
      ],
      coreVersion: VERSION,
      pluginApiPath: '/umbraco/crombolo/api',
      host: { redirects: {} as never } as never,
      callerHost: {
        media: (caller) => {
          callers.push(caller.kind)
          return {} as never
        },
      },
      log: () => ({ info() {}, warn() {}, error() {} }),
    })
    mounted.jobContext('sweeper')
    expect(callers).toEqual(['job'])
  })
})

describe(`jobs on a running site (${dialectUnderTest})`, () => {
  test("a bundle's job gets what a public route gets, a site's job its tables, and nothing acts as the site", async () => {
    const { dir, bundle, tables, imports, enqueue, seen } = jobsSite()
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        bundles: [bundle],
        database: { tables },
        jobs: { imports },
        routes: [enqueue],
      },
    })
    open.push(h)

    const queued = (await (await h.call('/sweeper', { method: 'POST' })).json()) as { id: string }
    await h.server.backgroundJobs.runDue()
    expect(seen).toMatchObject({
      queuedBy: 'a visitor',
      payload: { since: 'yesterday' },
      redirects: 0,
    })
    const status = (await (await h.call(`/sweeper/${queued.id}`)).json()) as {
      state: string
      progress: unknown
    }
    expect(status).toMatchObject({
      state: 'succeeded',
      progress: { done: 1, total: 1, note: 'done' },
    })

    expect((await h.call('/notes/7', { method: 'POST' })).status).toBe(200)
    await h.server.backgroundJobs.runDue()
    expect(seen.coreTables).toBe('refused')

    // Administrators see every owner's jobs.
    const listed = await h.json<{ items: { owner: string; name: string; state: string }[] }>(
      `${BACKOFFICE}/crombolo/api/jobs`,
    )
    expect(listed.items.map((job) => `${job.owner}/${job.name} ${job.state}`).sort()).toEqual([
      'site/imports.note succeeded',
      'sweeper/sweep succeeded',
    ])
  })

  test('a bad job or schedule refuses the boot', async () => {
    const { dir } = jobsSite()
    const refused = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        jobs: { imports: { note: 3 } as never },
        schedules: [{ job: 'imports.missing', cron: '0 2 * * *' }],
      },
    }).catch((error: Error) => error)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toContain('the job "imports.note" is not a function')
    expect((refused as Error).message).toContain('names no job of its own')
  })
})
