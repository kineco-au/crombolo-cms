/**
 * The site's background jobs from the command line (story 359), as Settings →
 * Background jobs shows them: on this site's database through the core the
 * dashboard uses, or, with --profile, on a hosted site through the remote
 * protocol's routes. A retry is audited as the person signed in.
 */
import {
  type BackgroundJob,
  BackgroundJobError,
  bootstrapDatabase,
  JOB_PREFIX_LENGTH,
  JOB_STATE_WORDS,
  type JobPage,
  type JobQuery,
  jobOf,
  listJobs,
  retryJob,
} from '@crombolo/server'
import { Flags } from '@oclif/core'
import { CliError } from '../errors.ts'
import { commandActorName } from '../operations/commands.ts'
import { type HostedSite, hostedOrHere, type ProfileFlagValues } from '../profiles/choose.ts'
import { commandActor } from './acting.ts'
import { connectSite, needEnvironment } from './remote.ts'
import { siteConfig } from './site.ts'
import { ago } from './undo.ts'

export type { BackgroundJob }

/** The states as the command line names them, the dashboard's words. */
export const STATE_FLAGS = {
  waiting: 'queued',
  running: 'running',
  failed: 'failed',
  done: 'succeeded',
} as const

export const stateFlag = Flags.string({
  summary: 'only the jobs in this state',
  options: Object.keys(STATE_FLAGS),
})

export interface JobSite {
  hosted: boolean
  /** A page of jobs, and, on a hosted site, since when nothing has been running them. */
  list(query: JobQuery): Promise<JobPage & { waitingSince: string | null }>
  show(id: string): Promise<BackgroundJob>
  retry(id: string): Promise<{ job: BackgroundJob; message: string }>
}

const refusal = (error: BackgroundJobError): CliError =>
  new CliError(error.kind, error.message, error.hint ? { hint: error.hint } : undefined)

/** Who a retry is made as: the signed-in person, or the command line. */
function retrier() {
  const actor = commandActor()
  return actor.kind === 'user'
    ? { key: actor.principal.id, name: actor.principal.name, source: 'cli' as const }
    : { name: commandActorName(), source: 'cli' as const }
}

/** Runs `work` on the site chosen: this one, a folder profile's, or a hosted one. */
export async function withJobs<T>(
  flags: ProfileFlagValues,
  work: (site: JobSite) => Promise<T>,
): Promise<T> {
  const hosted = hostedOrHere(flags)
  try {
    if (hosted) return await work(await hostedJobs(hosted))
    const { db } = await bootstrapDatabase(await siteConfig())
    try {
      return await work({
        hosted: false,
        list: async (query) => ({ ...(await listJobs(db, query)), waitingSince: null }),
        show: (id) => jobOf(db, id),
        retry: (id) => retryJob(db, id, retrier()),
      })
    } finally {
      await db.close()
    }
  } catch (error) {
    throw error instanceof BackgroundJobError ? refusal(error) : error
  }
}

async function hostedJobs(site: HostedSite): Promise<JobSite> {
  const { discovery, client, environment } = await connectSite(site)
  if (!discovery.capabilities?.includes('background-jobs'))
    throw new CliError('refused', 'This site needs a newer crombolo to show its background jobs.', {
      hint: `${discovery.name} has to be upgraded first.`,
    })
  const env = `environments/${needEnvironment(environment, discovery)}/background-jobs`
  const named = (id: string) => {
    if (id.trim().length < JOB_PREFIX_LENGTH)
      throw new CliError(
        'usage',
        `A job is named by its id, or at least the first ${JOB_PREFIX_LENGTH} characters of it.`,
        { hint: 'crombolo jobs list gives each one.' },
      )
    return encodeURIComponent(id.trim())
  }
  return {
    hosted: true,
    list: (query) => {
      const asked = new URLSearchParams()
      if (query.state) asked.set('state', query.state)
      if (query.owner) asked.set('owner', query.owner)
      asked.set('skip', String(query.skip ?? 0))
      asked.set('take', String(query.take ?? 50))
      return client.json(`${env}?${asked}`)
    },
    show: (id) => client.json(`${env}/${named(id)}`),
    retry: (id) => client.json(`${env}/${named(id)}/retry`, { method: 'POST' }),
  }
}

/** "The site", or the bundle's id, as the dashboard says whose a job is. */
export const ownerWord = (owner: string): string => (owner === 'site' ? 'The site' : owner)

export const stateWord = (job: Pick<BackgroundJob, 'state'>): string => JOB_STATE_WORDS[job.state]

/** "40 of 100: species checked", or none. */
export function progressWords(job: Pick<BackgroundJob, 'progress'>): string | undefined {
  const p = job.progress
  if (!p) return undefined
  const count = p.total ? `${p.done} of ${p.total}` : `${p.done}`
  return p.note ? `${count}: ${p.note}` : count
}

/** "1a2b3c4d  queued 3 hours ago  The site  imports.run  Failed  tried 5 of 5". */
export function jobLine(job: BackgroundJob, now = Date.now()): string {
  const progress = job.state === 'running' ? progressWords(job) : undefined
  return [
    `  ${job.id.slice(0, JOB_PREFIX_LENGTH)}`,
    `queued ${ago(job.createdAt, now)}`.padEnd(24),
    ownerWord(job.owner).padEnd(16),
    job.name.padEnd(24),
    stateWord(job).padEnd(8),
    progress ?? `tried ${job.attempts} of ${job.maxAttempts}`,
  ].join('  ')
}

/** What `jobs show` says of a job, a line each. */
export function jobDetails(job: BackgroundJob, now = Date.now()): string[] {
  const progress = progressWords(job)
  return [
    `  ${job.name}  (${job.id})`,
    `  from      ${ownerWord(job.owner)}`,
    `  state     ${stateWord(job)}`,
    `  queued    ${job.createdAt} (${ago(job.createdAt, now)})${job.queuedBy ? ` by ${job.queuedBy}` : ''}`,
    `  tried     ${job.attempts} of ${job.maxAttempts}`,
    ...(job.state === 'queued' ? [`  next try  ${job.nextAttemptAt}`] : []),
    ...(progress ? [`  progress  ${progress}`] : []),
    ...(job.finishedAt ? [`  finished  ${job.finishedAt}`] : []),
    ...(job.error ? ['  error', ...job.error.split('\n').map((line) => `    ${line}`)] : []),
  ]
}

/** What the dashboard warns of when nothing is running the jobs. */
export const WAITING_WARNING =
  "Background work is waiting: nothing is running it. Queued jobs, scheduled publishing and notifications will go out once the site's background worker is running again."

export const jobFields = [
  { name: 'id', type: 'string' },
  { name: 'owner', type: 'string', description: '`site`, or the bundle’s id' },
  { name: 'name', type: 'string' },
  { name: 'state', type: 'string', enum: ['queued', 'running', 'succeeded', 'failed'] },
  { name: 'attempts', type: 'integer' },
  { name: 'maxAttempts', type: 'integer' },
  { name: 'nextAttemptAt', type: 'string' },
  {
    name: 'progress',
    type: 'object',
    nullable: true,
    fields: [
      { name: 'done', type: 'integer' },
      { name: 'total', type: 'integer', nullable: true },
      { name: 'note', type: 'string', nullable: true },
    ],
  },
  { name: 'error', type: 'string', nullable: true },
  { name: 'queuedBy', type: 'string', nullable: true },
  { name: 'createdAt', type: 'string' },
  { name: 'finishedAt', type: 'string', nullable: true },
] as const
