/**
 * The site's background jobs as Settings → Background jobs shows them (story
 * 187), shared by its dashboard, the command line and the remote protocol (story
 * 359): a page of jobs, one job named by its id or a prefix of it, and a failed
 * one run again, audited as the dashboard audits it.
 */
import {
  type AuditSource,
  type Db,
  type JobProgress,
  JobRepository,
  type JobRow,
  type JobState,
} from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'

export const JOB_STATES: readonly JobState[] = ['queued', 'running', 'succeeded', 'failed']

/** Each state as the dashboard words it. */
export const JOB_STATE_WORDS: Record<JobState, string> = {
  queued: 'Waiting',
  running: 'Running',
  failed: 'Failed',
  succeeded: 'Done',
}

/** The shortest prefix of an id that names a job. */
export const JOB_PREFIX_LENGTH = 8

export interface BackgroundJob {
  id: string
  /** `site`, or the bundle's id. */
  owner: string
  name: string
  state: JobState
  attempts: number
  maxAttempts: number
  nextAttemptAt: string
  progress: JobProgress | null
  error: string | null
  queuedBy: string | null
  createdAt: string
  finishedAt: string | null
}

export interface JobPage {
  total: number
  items: BackgroundJob[]
}

export interface JobQuery {
  owner?: string
  state?: JobState
  skip?: number
  take?: number
}

export type BackgroundJobErrorKind = 'not_found' | 'usage' | 'conflict'

/** Why a job could not be found or run again, in words for a person. */
export class BackgroundJobError extends Error {
  constructor(
    readonly kind: BackgroundJobErrorKind,
    message: string,
    readonly hint?: string,
  ) {
    super(message)
  }
}

/** Who runs a job again, for its audit entry. */
export interface JobRetrier {
  key?: string | null
  name: string
  source: AuditSource
  address?: { ipAddress?: string | null; forwardedFor?: string | null }
}

export const jobView = (job: JobRow): BackgroundJob => ({
  id: job.id,
  owner: job.owner,
  name: job.name,
  state: job.state,
  attempts: job.attempts,
  maxAttempts: job.maxAttempts,
  nextAttemptAt: job.nextAttemptAt.toISOString(),
  progress: job.progress,
  error: job.lastError,
  queuedBy: job.queuedBy,
  createdAt: job.createdAt.toISOString(),
  finishedAt: job.finishedAt?.toISOString() ?? null,
})

/** A list's query as a request gives it, read as the dashboard reads it. */
export function readJobQuery(params: URLSearchParams): JobQuery {
  const state = params.get('state')
  return {
    owner: params.get('owner') || undefined,
    state: JOB_STATES.includes(state as JobState) ? (state as JobState) : undefined,
    skip: Math.max(0, Number(params.get('skip')) || 0),
    take: Math.min(200, Math.max(1, Number(params.get('take')) || 50)),
  }
}

/** A page of jobs, the newest first. */
export async function listJobs(db: Db, query: JobQuery = {}): Promise<JobPage> {
  const listed = await new JobRepository(db).list(query)
  return { total: listed.total, items: listed.items.map(jobView) }
}

async function find(db: Db, named: string): Promise<JobRow> {
  const wanted = named.trim().toLowerCase()
  if (wanted.length < JOB_PREFIX_LENGTH || !/^[0-9a-f-]+$/.test(wanted))
    throw new BackgroundJobError(
      'usage',
      `A job is named by its id, or at least the first ${JOB_PREFIX_LENGTH} characters of it.`,
      'crombolo jobs list gives each one.',
    )
  const found = await new JobRepository(db).byPrefix(wanted)
  if (found.length === 0) throw new BackgroundJobError('not_found', `There is no job ${named}.`)
  const exact = found.find((job) => job.id === wanted)
  if (exact) return exact
  if (found.length > 1)
    throw new BackgroundJobError(
      'conflict',
      `${named} names more than one job: ${found.map((job) => `${job.id} (${job.name})`).join(', ')}.`,
      'Give more of its id.',
    )
  return found[0] as JobRow
}

/** One job, by its id or a prefix of it that names only it. */
export async function jobOf(db: Db, named: string): Promise<BackgroundJob> {
  return jobView(await find(db, named))
}

/** Runs a failed job again from its first attempt, and audits it as the dashboard does. */
export async function retryJob(
  db: Db,
  named: string,
  by: JobRetrier,
): Promise<{ job: BackgroundJob; message: string }> {
  const job = await find(db, named)
  const queue = new JobRepository(db)
  if (job.state !== 'failed' || !(await queue.retry(job.id))) {
    const now = (await queue.get(job.id))?.state ?? job.state
    throw new BackgroundJobError(
      'conflict',
      'Only a job that has failed can be run again.',
      `${job.name} is ${JOB_STATE_WORDS[now].toLowerCase()}.`,
    )
  }
  await recordAudit(db, {
    category: 'system',
    action: 'Retry',
    entityType: 'Job',
    entityName: `${job.owner}/${job.name}`,
    detail: job.lastError ? `after: ${job.lastError.slice(0, 200)}` : null,
    source: by.source,
    userKey: by.key ?? null,
    userName: by.name,
    ipAddress: by.address?.ipAddress ?? null,
    forwardedFor: by.address?.forwardedFor ?? null,
  })
  const retried = await queue.get(job.id)
  return {
    job: jobView(retried ?? job),
    message: `${job.name} is queued to run again.`,
  }
}
