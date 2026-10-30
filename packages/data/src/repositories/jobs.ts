/**
 * The background job queue (story 187): every owner's jobs in one table,
 * claimed by one node at a time, and each schedule's last occurrence.
 * docs/rendering.md, "Background jobs".
 */
import { randomUUID } from 'node:crypto'
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed'

export interface JobProgress {
  done: number
  total?: number
  note?: string
}

export interface JobRow {
  id: string
  /** `site`, or the bundle's id. */
  owner: string
  name: string
  payload: unknown
  state: JobState
  attempts: number
  maxAttempts: number
  nextAttemptAt: Date
  claimedBy: string | null
  claimedAt: Date | null
  progress: JobProgress | null
  lastError: string | null
  queuedBy: string | null
  createdAt: Date
  finishedAt: Date | null
}

const date = (value: unknown): Date | null => DbDate.fromDb(value) ?? null

const parse = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) return null
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return null
  }
}

// biome-ignore lint/suspicious/noExplicitAny: a row as the driver hands it back
function rowOf(row: any): JobRow {
  return {
    id: String(row.id).toLowerCase(),
    owner: row.owner,
    name: row.name,
    payload: parse(row.payload),
    state: row.state as JobState,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: date(row.next_attempt_at) ?? new Date(0),
    claimedBy: row.claimed_by ?? null,
    claimedAt: date(row.claimed_at),
    progress: parse<JobProgress>(row.progress),
    lastError: row.last_error ?? null,
    queuedBy: row.queued_by ?? null,
    createdAt: date(row.created_at) ?? new Date(0),
    finishedAt: date(row.finished_at),
  }
}

export class JobRepository {
  constructor(private readonly db: Db) {}

  async enqueue(job: {
    owner: string
    name: string
    payload: string
    maxAttempts: number
    queuedBy: string | null
    runAt?: Date
  }): Promise<string> {
    const id = randomUUID()
    const now = DbDate.toDb(new Date())
    await this.db.q
      .insertInto('job')
      .values({
        id,
        owner: job.owner,
        name: job.name,
        payload: job.payload,
        state: 'queued',
        attempts: 0,
        max_attempts: job.maxAttempts,
        next_attempt_at: DbDate.toDb(job.runAt ?? new Date()),
        claimed_by: null,
        claimed_at: null,
        progress: null,
        last_error: null,
        queued_by: job.queuedBy,
        created_at: now,
        finished_at: null,
      })
      .execute()
    return id
  }

  async get(id: string): Promise<JobRow | undefined> {
    const row = await this.db.q
      .selectFrom('job')
      .selectAll()
      .where('id', '=', id.toLowerCase())
      .executeTakeFirst()
    return row ? rowOf(row) : undefined
  }

  /** The newest first, for the administrators' view; `owner` and `state` narrow it. */
  async list(
    options: { owner?: string; state?: JobState; skip?: number; take?: number } = {},
  ): Promise<{ total: number; items: JobRow[] }> {
    let query = this.db.q.selectFrom('job')
    if (options.owner) query = query.where('owner', '=', options.owner)
    if (options.state) query = query.where('state', '=', options.state)
    const counted = await query.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst()
    const rows = await query
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(options.take ?? 50)
      .offset(options.skip ?? 0)
      .execute()
    return { total: Number(counted?.n ?? 0), items: rows.map(rowOf) }
  }

  /**
   * Claims the job due soonest, or none. Two nodes asking at once take
   * different jobs: the claim is an update that only lands while it is queued.
   */
  async claimNext(
    nodeId: string,
    now = new Date(),
    owners?: readonly string[],
  ): Promise<JobRow | undefined> {
    if (owners && owners.length === 0) return undefined
    for (let tries = 0; tries < 5; tries++) {
      let candidates = this.db.q.selectFrom('job').select('id').where('state', '=', 'queued')
      if (owners) candidates = candidates.where('owner', 'in', [...owners])
      const due = await candidates
        .where('next_attempt_at', '<=', DbDate.toDb(now))
        .orderBy('next_attempt_at')
        .orderBy('created_at')
        .limit(1)
        .executeTakeFirst()
      if (!due) return undefined
      const claimed = await this.db.q
        .updateTable('job')
        .set((eb) => ({
          state: 'running',
          attempts: eb('attempts', '+', 1),
          claimed_by: nodeId,
          claimed_at: DbDate.toDb(now),
        }))
        .where('id', '=', due.id)
        .where('state', '=', 'queued')
        .returning('id')
        .execute()
      if (claimed.length > 0) return this.get(due.id)
    }
    return undefined
  }

  /** A running job says it is still alive, so it is not taken for one a dead node left. */
  async heartbeat(id: string, progress?: JobProgress): Promise<void> {
    await this.db.q
      .updateTable('job')
      .set({
        claimed_at: DbDate.toDb(new Date()),
        ...(progress ? { progress: JSON.stringify(progress) } : {}),
      })
      .where('id', '=', id)
      .where('state', '=', 'running')
      .execute()
  }

  async succeed(id: string): Promise<void> {
    await this.db.q
      .updateTable('job')
      .set({
        state: 'succeeded',
        claimed_by: null,
        claimed_at: null,
        finished_at: DbDate.toDb(new Date()),
      })
      .where('id', '=', id)
      .execute()
  }

  /** A failed attempt: queued again at `retryAt`, or failed for good without one. */
  async fail(id: string, error: string, retryAt: Date | undefined): Promise<void> {
    await this.db.q
      .updateTable('job')
      .set({
        state: retryAt ? 'queued' : 'failed',
        last_error: error,
        claimed_by: null,
        claimed_at: null,
        ...(retryAt
          ? { next_attempt_at: DbDate.toDb(retryAt) }
          : { finished_at: DbDate.toDb(new Date()) }),
      })
      .where('id', '=', id)
      .execute()
  }

  /** Back in the queue without counting the attempt: its node stopped before it could finish. */
  async release(id: string): Promise<void> {
    await this.db.q
      .updateTable('job')
      .set((eb) => ({
        state: 'queued',
        attempts: eb('attempts', '-', 1),
        claimed_by: null,
        claimed_at: null,
        next_attempt_at: DbDate.toDb(new Date()),
      }))
      .where('id', '=', id)
      .where('state', '=', 'running')
      .execute()
  }

  /** Jobs whose node stopped answering go back in the queue; returns how many. */
  async releaseStale(before: Date): Promise<number> {
    const rows = await this.db.q
      .updateTable('job')
      .set({ state: 'queued', claimed_by: null, claimed_at: null })
      .where('state', '=', 'running')
      .where('claimed_at', '<', DbDate.toDb(before))
      .returning('id')
      .execute()
    return rows.length
  }

  /** An administrator runs a failed job again, from its first attempt. */
  async retry(id: string): Promise<boolean> {
    const rows = await this.db.q
      .updateTable('job')
      .set({
        state: 'queued',
        attempts: 0,
        last_error: null,
        finished_at: null,
        next_attempt_at: DbDate.toDb(new Date()),
      })
      .where('id', '=', id.toLowerCase())
      .where('state', '=', 'failed')
      .returning('id')
      .execute()
    return rows.length > 0
  }

  /** Drops finished jobs older than `before`; failed ones stay until retried or cleared. */
  async pruneSucceeded(before: Date): Promise<void> {
    await this.db.q
      .deleteFrom('job')
      .where('state', '=', 'succeeded')
      .where('finished_at', '<', DbDate.toDb(before))
      .execute()
  }

  /** When a schedule last ran, made now when it is new, so a new schedule has nothing to catch up. */
  async scheduleSince(key: string, now: Date): Promise<Date> {
    await this.db.q
      .insertInto('job_schedule')
      .values({ schedule_key: key, last_occurrence: DbDate.toDb(now) })
      .onConflict((oc) => oc.column('schedule_key').doNothing())
      .execute()
    const row = await this.db.q
      .selectFrom('job_schedule')
      .select('last_occurrence')
      .where('schedule_key', '=', key)
      .executeTakeFirst()
    return date(row?.last_occurrence) ?? now
  }

  /**
   * Moves a schedule on from `from` to `to`, only if it is still at `from`: of
   * the nodes that saw the same occurrence due, exactly one gets true.
   */
  async advanceSchedule(key: string, from: Date, to: Date): Promise<boolean> {
    const rows = await this.db.q
      .updateTable('job_schedule')
      .set({ last_occurrence: DbDate.toDb(to) })
      .where('schedule_key', '=', key)
      .where('last_occurrence', '=', DbDate.toDb(from))
      .returning('schedule_key')
      .execute()
    return rows.length > 0
  }
}
