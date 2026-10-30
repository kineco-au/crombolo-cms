/**
 * Background and scheduled work for the site and its bundles (story 187): one
 * queue in crombolo's own tables, one runner on every node that owns writes,
 * and schedules each occurrence of which exactly one node runs. A job sees what
 * its owner's public route sees, and nothing acts as the site.
 * docs/rendering.md, "Background jobs"; docs/bundles.md, "Jobs".
 */
import {
  type Db,
  type JobProgress,
  JobRepository,
  type JobRow,
  type JobState,
} from '@crombolo/data'
import { type Cron, isTimezone, nextOccurrence, parseCron } from './cron.ts'
import { logger } from './logging.ts'

/** The largest payload a job may carry, as JSON. */
export const MAX_PAYLOAD_BYTES = 64 * 1024
/** How many times a job runs before it is failed for good, unless it says otherwise. */
export const DEFAULT_ATTEMPTS = 5
const MAX_NOTE = 1024
const MAX_ERROR = 4096

/** What a schedule says: run this job on this timetable. */
export interface JobSchedule {
  /** The job: `module.export` for the site, the job's name for a bundle. */
  job: string
  /** Five fields: minute, hour, day, month, weekday. */
  cron: string
  /** An IANA zone, such as `Europe/London`; UTC when not given. */
  timezone?: string
  /** After downtime, `run` (the default) runs a missed occurrence once; `skip` drops it. */
  missed?: 'run' | 'skip'
  /** The payload each occurrence carries. */
  payload?: unknown
}

/** What every job is given, whoever owns it. */
export interface JobInfo {
  readonly id: string
  /** From 1. */
  readonly attempt: number
  /** Who queued it, shown to administrators; it grants nothing. */
  readonly queuedBy: string | null
  /** Aborts when the node is stopping: finish soon, or throw and be run again. */
  readonly signal: AbortSignal
  /** Saves how far it has got, for its owner's routes to show. */
  progress(done: number, total?: number, note?: string): Promise<void>
  /** Queues another of its owner's jobs. */
  enqueue(name: string, payload?: unknown): Promise<string>
}

/** A job as its owner's routes read it. */
export interface JobStatus {
  id: string
  name: string
  state: JobState
  attempts: number
  progress: JobProgress | null
  error: string | null
  queuedBy: string | null
  createdAt: string
  finishedAt: string | null
}

/** An owner's jobs: queue one, and read how one is going. */
export interface OwnerJobs {
  enqueue(name: string, payload?: unknown): Promise<string>
  /** One of this owner's jobs; another owner's is not found. */
  status(id: string): Promise<JobStatus | undefined>
}

/** A payload too big to queue: nothing was queued. */
export class JobPayloadTooLargeError extends Error {
  constructor(
    readonly job: string,
    readonly bytes: number,
  ) {
    super(
      `The job ${job}'s payload is ${bytes} bytes of JSON, past the ${MAX_PAYLOAD_BYTES} a job may carry: keep the data in your own tables and pass its key.`,
    )
  }
}

export class UnknownJobError extends Error {
  constructor(owner: string, name: string) {
    super(
      `${owner === 'site' ? 'The site' : `The bundle "${owner}"`} has no job "${name}" to queue.`,
    )
  }
}

// biome-ignore lint/suspicious/noExplicitAny: a job's payload and context are its owner's to type
export type JobHandler = (payload: any, context: any) => unknown

/** One owner's jobs as the runner holds them. */
export interface JobOwner {
  /** `site`, or the bundle's id. */
  id: string
  handlers: ReadonlyMap<string, JobHandler>
  schedules: readonly JobSchedule[]
  /** What a handler is given besides `job`: the owner's handles, with no caller. */
  context(): Record<string, unknown>
  /** Whether it may run now: a bundle that is off waits (story 222). */
  on(): boolean
}

/** Every reason a set of handlers and schedules cannot be used. */
export function jobProblems(
  label: string,
  handlers: Record<string, unknown> | undefined,
  schedules: readonly JobSchedule[] | undefined,
): string[] {
  const problems: string[] = []
  const names = new Set<string>()
  const seen = new Map<unknown, string>()
  for (const [name, handler] of Object.entries(handlers ?? {})) {
    if (typeof handler !== 'function')
      problems.push(`${label}: the job "${name}" is not a function`)
    else if (seen.has(handler))
      problems.push(`${label}: the job "${name}" is the same function as "${seen.get(handler)}"`)
    else seen.set(handler, name)
    names.add(name)
  }
  for (const [index, schedule] of (schedules ?? []).entries()) {
    const which = `${label}: schedule ${index + 1} (${schedule?.job ?? 'no job'})`
    if (!schedule || typeof schedule.job !== 'string' || !names.has(schedule.job)) {
      problems.push(`${which} names no job of its own`)
      continue
    }
    try {
      const cron = parseCron(String(schedule.cron))
      const zone = schedule.timezone ?? 'UTC'
      if (!isTimezone(zone)) problems.push(`${which}: "${zone}" is not a timezone`)
      else nextOccurrence(cron, zone, new Date())
    } catch (error) {
      problems.push(`${which}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (schedule.missed !== undefined && schedule.missed !== 'run' && schedule.missed !== 'skip')
      problems.push(`${which}: "missed" is "run" or "skip"`)
    if (schedule.payload !== undefined) {
      const size = payloadSize(schedule.payload)
      if (size > MAX_PAYLOAD_BYTES)
        problems.push(`${which}: its payload is ${size} bytes, past ${MAX_PAYLOAD_BYTES}`)
    }
  }
  return problems.map((problem) => `${problem}.`)
}

const payloadSize = (payload: unknown): number =>
  Buffer.byteLength(JSON.stringify(payload ?? null) ?? 'null')

/** When to try again after this many attempts: 30 s, doubling, at most an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000)
}

const statusOf = (job: JobRow): JobStatus => ({
  id: job.id,
  name: job.name,
  state: job.state,
  attempts: job.attempts,
  progress: job.progress,
  error: job.lastError,
  queuedBy: job.queuedBy,
  createdAt: job.createdAt.toISOString(),
  finishedAt: job.finishedAt?.toISOString() ?? null,
})

/** A schedule's key in `job_schedule`: its owner, its job and its timetable. */
const scheduleKey = (owner: string, schedule: JobSchedule) =>
  `${owner}:${schedule.job}:${schedule.cron}:${schedule.timezone ?? 'UTC'}`.slice(0, 200)

export interface JobRunner {
  /** An owner's queue, recording `queuedBy` on what it queues. */
  jobsFor(owner: string, queuedBy: string | null): OwnerJobs
  /** Queues each occurrence that has fallen due, on this node only if it wins the claim. */
  runSchedules(now?: Date): Promise<number>
  /** Claims and runs due jobs until none is left or `limit` have run; what tests drive. */
  runDue(limit?: number): Promise<number>
  /** Starts the timer: schedules, then due jobs, every `intervalMs`. */
  start(): void
  /** Runs a tick now rather than at the next, on a started runner: something was queued. */
  wake(): void
  /** The job this node is running, and when it last claimed one; what a worker's `/health` says. */
  state(): { running: string | null; lastClaimAt: string | null }
  /** Aborts the running job's signal, waits for it a while, and releases it if it has not finished. */
  stop(): Promise<void>
}

export function createJobRunner(options: {
  db: Db
  nodeId: string
  owners: () => readonly JobOwner[]
  intervalMs?: number
  /** How long a stopping node waits for its running job before releasing it. */
  graceMs?: number
  now?: () => Date
  /** Told after each job is queued, so whoever runs them can start on it. */
  onEnqueued?: () => void
}): JobRunner {
  const jobs = new JobRepository(options.db)
  const log = logger('jobs')
  const now = options.now ?? (() => new Date())
  const crons = new Map<string, Cron>()
  let timer: ReturnType<typeof setInterval> | undefined
  let stopping = new AbortController()
  let running: { id: string; done: Promise<void> } | undefined
  let staleAt = 0
  let lastClaimAt: Date | null = null

  const ownerOf = (id: string) => options.owners().find((owner) => owner.id === id)

  const enqueue = async (
    owner: string,
    name: string,
    payload: unknown,
    queuedBy: string | null,
  ) => {
    if (!ownerOf(owner)?.handlers.has(name)) throw new UnknownJobError(owner, name)
    const json = JSON.stringify(payload ?? null) ?? 'null'
    const bytes = Buffer.byteLength(json)
    if (bytes > MAX_PAYLOAD_BYTES)
      throw new JobPayloadTooLargeError(owner === 'site' ? name : `${owner}/${name}`, bytes)
    const id = await jobs.enqueue({
      owner,
      name,
      payload: json,
      maxAttempts: DEFAULT_ATTEMPTS,
      queuedBy,
    })
    options.onEnqueued?.()
    return id
  }

  const jobsFor = (owner: string, queuedBy: string | null): OwnerJobs =>
    Object.freeze({
      enqueue: (name: string, payload?: unknown) => enqueue(owner, name, payload, queuedBy),
      async status(id: string) {
        const job = await jobs.get(id).catch(() => undefined)
        return job && job.owner === owner ? statusOf(job) : undefined
      },
    })

  const run = async (job: JobRow): Promise<void> => {
    const owner = ownerOf(job.owner)
    const handler = owner?.handlers.get(job.name)
    if (!owner || !handler) {
      // Its owner is no longer wired, or no longer has the job: it waits, and says why.
      await jobs.fail(job.id, `Nothing here runs ${job.owner}'s job "${job.name}".`, undefined)
      return
    }
    const signal = stopping.signal
    const heartbeat = setInterval(() => void jobs.heartbeat(job.id).catch(() => {}), 30_000)
    const info: JobInfo = Object.freeze({
      id: job.id,
      attempt: job.attempts,
      queuedBy: job.queuedBy,
      signal,
      progress: (done: number, total?: number, note?: string) =>
        jobs.heartbeat(job.id, {
          done,
          ...(total !== undefined ? { total } : {}),
          ...(note ? { note: String(note).slice(0, MAX_NOTE) } : {}),
        }),
      enqueue: (name: string, payload?: unknown) =>
        enqueue(owner.id, name, payload, `job ${job.id}`),
    })
    try {
      await handler(job.payload, { ...owner.context(), job: info })
      await jobs.succeed(job.id)
    } catch (error) {
      if (signal.aborted) {
        await jobs.release(job.id)
        return
      }
      const message = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR)
      const retryAt =
        job.attempts < job.maxAttempts
          ? new Date(now().getTime() + retryDelayMs(job.attempts))
          : undefined
      await jobs.fail(job.id, message, retryAt)
      log.warning('The job {job} failed on attempt {attempt}{retry}: {error}', {
        job: `${job.owner}/${job.name}`,
        attempt: job.attempts,
        retry: retryAt ? '' : ', for the last time',
        error: message,
      })
    } finally {
      clearInterval(heartbeat)
    }
  }

  let busy = false
  /** Schedules, then due jobs; a tick while one runs is dropped, as the next catches up. */
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      await runner.runSchedules()
      await runner.runDue()
    } catch (error) {
      log.error('Background jobs could not run: {error}', {
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      busy = false
    }
  }

  const runner: JobRunner = {
    jobsFor,

    async runSchedules(at = now()) {
      let queued = 0
      for (const owner of options.owners()) {
        if (!owner.on()) continue
        for (const schedule of owner.schedules) {
          const key = scheduleKey(owner.id, schedule)
          let cron = crons.get(key)
          if (!cron) {
            cron = parseCron(schedule.cron)
            crons.set(key, cron)
          }
          const since = await jobs.scheduleSince(key, at)
          const due = nextOccurrence(cron, schedule.timezone ?? 'UTC', since)
          if (due > at) continue
          // Of the nodes that saw it due, the one whose claim lands queues it.
          if (!(await jobs.advanceSchedule(key, since, at))) continue
          const late = at.getTime() - due.getTime() > 90_000
          if (late && schedule.missed === 'skip') continue
          await enqueue(owner.id, schedule.job, schedule.payload, `schedule ${schedule.cron}`)
          queued++
        }
      }
      return queued
    },

    async runDue(limit = 25) {
      if (Date.now() - staleAt > 60_000) {
        staleAt = Date.now()
        // A running job beats every 30 s; two minutes of silence is a node that died.
        const released = await jobs.releaseStale(new Date(now().getTime() - 120_000))
        if (released > 0)
          log.info('{count} job(s) whose node stopped were queued again', { count: released })
        await jobs.pruneSucceeded(new Date(now().getTime() - 7 * 24 * 60 * 60_000))
      }
      let ran = 0
      while (ran < limit && !stopping.signal.aborted) {
        const owners = options
          .owners()
          .filter((owner) => owner.on())
          .map((owner) => owner.id)
        if (owners.length === 0) break
        const job = await jobs.claimNext(options.nodeId, now(), owners)
        if (!job) break
        const done = run(job)
        lastClaimAt = now()
        running = { id: job.id, done }
        await done
        running = undefined
        ran++
      }
      return ran
    },

    start() {
      if (timer) return
      stopping = new AbortController()
      timer = setInterval(tick, options.intervalMs ?? 5_000)
    },

    wake() {
      if (timer) void tick()
    },

    state() {
      return { running: running?.id ?? null, lastClaimAt: lastClaimAt?.toISOString() ?? null }
    },

    async stop() {
      if (timer) clearInterval(timer)
      timer = undefined
      stopping.abort()
      const current = running
      if (!current) return
      const grace = new Promise<'late'>((resolve) =>
        setTimeout(() => resolve('late'), options.graceMs ?? 10_000),
      )
      if ((await Promise.race([current.done.then(() => 'done' as const), grace])) === 'late')
        await jobs.release(current.id)
    },
  }
  return runner
}

/** The site's jobs by `module.export`, from the modules its config lists. */
export function siteJobHandlers(
  modules: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined,
): Map<string, JobHandler> {
  const out = new Map<string, JobHandler>()
  for (const [module, exports] of Object.entries(modules ?? {}))
    for (const [name, handler] of Object.entries(exports ?? {}))
      if (typeof handler === 'function') out.set(`${module}.${name}`, handler as JobHandler)
  return out
}

/** Every reason the site's jobs and schedules cannot be used. */
export function siteJobProblems(config: {
  jobs?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  schedules?: readonly JobSchedule[]
}): string[] {
  const problems: string[] = []
  const handlers: Record<string, unknown> = {}
  for (const [module, exports] of Object.entries(config.jobs ?? {})) {
    if (!/^[A-Za-z_$][\w$]*$/.test(module))
      problems.push(`The site: the job module "${module}" is not a name: letters, digits, _ and $.`)
    if (!exports || typeof exports !== 'object') {
      problems.push(
        `The site: jobs.${module} is not a module: list it as \`import * as ${module} from …\`.`,
      )
      continue
    }
    for (const [name, handler] of Object.entries(exports)) handlers[`${module}.${name}`] = handler
  }
  return [...problems, ...jobProblems('The site', handlers, config.schedules)]
}
