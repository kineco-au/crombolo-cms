/**
 * Story 223: a worker role that runs only the jobs. What it accepts and
 * refuses, what it mounts, and one `api` node leaving its jobs to one worker
 * on one database: every job run once, a worker stopped or killed mid-job,
 * and what is said while no worker is running.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DbDate, JobRepository } from '@crombolo/data'
import {
  type CromboloConfig,
  createServer,
  createWorker,
  createWorkerWatch,
  loadConfig,
  runsJobs,
  type ServerHandle,
  type WorkerHandle,
} from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const dirs: string[] = []
const open: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('the role and CROMBOLO_JOBS', () => {
  test('a worker runs jobs and needs Postgres; jobs off is for an api or all node', () => {
    expect(runsJobs({ role: 'worker', runJobs: true })).toBe(true)
    expect(runsJobs({ role: 'all', runJobs: true })).toBe(true)
    expect(runsJobs({ role: 'api', runJobs: false })).toBe(false)
    expect(runsJobs({ role: 'web', runJobs: true })).toBe(false)
    expect(() => loadConfig({ role: 'worker', dialect: 'sqlite' })).toThrow(
      'A worker needs Postgres',
    )
    expect(() => loadConfig({ role: 'web', runJobs: false })).toThrow(
      'CROMBOLO_JOBS=off applies to an api or all node; a web node never runs jobs.',
    )
    expect(() => loadConfig({ role: 'worker', dialect: 'postgres', runJobs: false })).toThrow(
      'a worker node only runs jobs',
    )
    expect(loadConfig({ role: 'api', runJobs: false }).runJobs).toBe(false)
  })

  test('CROMBOLO_JOBS is on or off, and anything else is refused', () => {
    const before = Bun.env.CROMBOLO_JOBS
    try {
      Bun.env.CROMBOLO_JOBS = 'off'
      expect(loadConfig().runJobs).toBe(false)
      Bun.env.CROMBOLO_JOBS = 'on'
      expect(loadConfig().runJobs).toBe(true)
      Bun.env.CROMBOLO_JOBS = 'no'
      expect(() => loadConfig()).toThrow("CROMBOLO_JOBS must be on or off, not 'no'.")
    } finally {
      if (before === undefined) delete Bun.env.CROMBOLO_JOBS
      else Bun.env.CROMBOLO_JOBS = before
    }
  })

  test('createServer will not build a site for a worker', async () => {
    const refused = await createServer({
      ...loadConfig({ dialect: 'postgres' }),
      role: 'worker',
    } as CromboloConfig).catch((error: Error) => error)
    expect((refused as Error).message).toContain('start it with createWorker')
  })
})

/** What the site's job saw, and a gate a test can hold a run at. */
interface Seen {
  runs: unknown[]
  hold?: Promise<void>
}

/** A site with one job, `imports.note`, that records each run and can be held. */
function jobsSite(seen: Seen): Partial<CromboloConfig> {
  const dir = mkdtempSync(join(process.cwd(), 'output', 'worker-'))
  dirs.push(dir)
  return {
    siteDir: dir,
    jobs: {
      imports: {
        async note(payload: unknown, context: { job: { signal: AbortSignal } }) {
          if (seen.hold) {
            const held = seen.hold
            await new Promise<void>((resolve, reject) => {
              context.job.signal.addEventListener('abort', () => reject(new Error('stopped')))
              void held.then(resolve)
            })
          }
          seen.runs.push(payload)
        },
      },
    },
  }
}

/** Waits until `check` holds, or fails after `ms`. */
async function until(check: () => Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out')
    await Bun.sleep(50)
  }
}

describe.skipIf(dialectUnderTest !== 'postgres')('an api node and a worker (postgres)', () => {
  const api = async (site: Partial<CromboloConfig>): Promise<Harness> => {
    const h = await signedInServer({ config: { ...site, runJobs: false, nodeId: 'node-api' } })
    open.push(h.server)
    return h
  }
  const worker = async (site: Partial<CromboloConfig>, nodeId = 'node-worker') => {
    const handle = await createWorker(loadConfig({ ...site, role: 'worker', nodeId }))
    open.push(handle)
    return handle
  }
  const queue = (server: ServerHandle | WorkerHandle) => new JobRepository(server.db as never)

  test('the worker answers /health alone, and runs the jobs the api node queues', async () => {
    const seen: Seen = { runs: [] }
    const site = jobsSite(seen)
    const h = await api(site)
    const w = await worker(site)

    expect(h.server.health().jobs).toMatchObject({ here: false })
    expect((await w.fetch(new Request('http://localhost/'))).status).toBe(404)
    expect((await w.fetch(new Request(`http://localhost${BACKOFFICE}`))).status).toBe(404)
    expect(
      (await w.fetch(new Request('http://localhost/umbraco/delivery/api/v2/content'))).status,
    ).toBe(404)
    const health = await w.fetch(new Request('http://localhost/health'))
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      ok: true,
      role: 'worker',
      nodeId: 'node-worker',
      jobs: { running: null },
    })

    // Queued on the api node, which runs nothing: the worker is woken and runs it.
    const id = await h.server.backgroundJobs
      .jobsFor('site', 'a test')
      .enqueue('imports.note', { from: 'api' })
    await until(async () => (await queue(h.server).get(id))?.state === 'succeeded')
    expect(await queue(h.server).get(id)).toMatchObject({ queuedBy: 'a test', attempts: 1 })
    expect(seen.runs).toEqual([{ from: 'api' }])
    // The worker claimed it; the api node, which leaves its jobs, claimed nothing.
    expect(w.health().jobs.lastClaimAt).not.toBeNull()
    expect(h.server.backgroundJobs.state().lastClaimAt).toBeNull()
  }, 60_000)

  test('a worker stopped mid-job releases it, and the next runs it once', async () => {
    let release = () => {}
    const seen: Seen = { runs: [], hold: new Promise<void>((resolve) => (release = resolve)) }
    const site = jobsSite(seen)
    const h = await api(site)
    const first = await worker(site, 'node-worker-1')
    const id = await h.server.backgroundJobs.jobsFor('site', null).enqueue('imports.note', 1)
    await until(async () => (await queue(h.server).get(id))?.state === 'running')
    expect(first.health().jobs.running).toBe(id)

    await first.close()
    expect(await queue(h.server).get(id)).toMatchObject({ state: 'queued', claimedBy: null })

    release()
    seen.hold = undefined
    const second = await worker(site, 'node-worker-2')
    await until(async () => (await queue(h.server).get(id))?.state === 'succeeded')
    expect(second.health().jobs.lastClaimAt).not.toBeNull()
    expect(seen.runs).toHaveLength(1)
  }, 60_000)

  test('a job claimed by a worker that died is run again, once, by the next', async () => {
    const seen: Seen = { runs: [] }
    const site = jobsSite(seen)
    const h = await api(site)
    const jobs = queue(h.server)
    const id = await h.server.backgroundJobs.jobsFor('site', null).enqueue('imports.note', 2)
    // Claimed ten minutes ago by a node that never answered again.
    await jobs.claimNext('node-dead', new Date(), ['site'])
    await h.server.db.q
      .updateTable('job')
      .set({ claimed_at: DbDate.toDb(new Date(Date.now() - 10 * 60_000)) })
      .where('id', '=', id)
      .execute()
    expect(await jobs.get(id)).toMatchObject({ state: 'running', claimedBy: 'node-dead' })

    const w = await worker(site)
    await until(async () => (await jobs.get(id))?.state === 'succeeded')
    expect(w.health().jobs.lastClaimAt).not.toBeNull()
    expect(seen.runs).toHaveLength(1)
  }, 60_000)

  test('with no worker running, the api node says work is waiting and drains nothing', async () => {
    const site = jobsSite({ runs: [] })
    const h = await api(site)
    const watch = createWorkerWatch({ db: h.server.db, config: h.server.config })
    const waiting = await watch.check()
    expect(waiting).toMatchObject({ here: false, worker: null })
    expect(waiting.waitingSince).not.toBeNull()
    // The node's own watch checks at boot: /health stays ok and says so.
    type Health = {
      ok: boolean
      jobs: { here: boolean; worker: string | null; waitingSince: string | null }
    }
    const read = async () =>
      (await (await h.server.fetch(new Request('http://localhost/health'))).json()) as Health
    await until(async () => (await read()).jobs.waitingSince !== null)
    const health = await read()
    expect(health.ok).toBe(true)
    expect(health.jobs).toMatchObject({ here: false, worker: null })
    expect(health.jobs.waitingSince).not.toBeNull()
    const listed = await h.json<{ waitingSince: string | null }>(`${BACKOFFICE}/crombolo/api/jobs`)
    expect(listed.waitingSince).not.toBeNull()

    const w = await worker(site)
    await w.poll()
    expect(await watch.check()).toEqual({ here: false, worker: 'node-worker', waitingSince: null })
  }, 60_000)
})
