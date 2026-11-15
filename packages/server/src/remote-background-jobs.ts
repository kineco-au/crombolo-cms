/**
 * The remote protocol's routes for background jobs (story 359): a page of the
 * site's jobs, one of them, and a failed one run again, as Settings →
 * Background jobs does, through the core the command line uses. They need the
 * Settings section; CI is refused, since these act for a person.
 */
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import type { Db } from '@crombolo/data'
import { BackgroundJobError, jobOf, listJobs, readJobQuery, retryJob } from './background-jobs.ts'

interface Problem {
  code: string
  title: string
  detail?: string
}

export interface BackgroundJobRouteOptions {
  db: Db
  problem(status: number, body: Problem): Response
  /** A refusal when the site's remote access level takes no changes. */
  levelRefusal(): Response | undefined
  /** When this node began waiting for a worker that is not running, or null. */
  waitingSince?: () => string | null
}

const STATUS: Record<BackgroundJobError['kind'], [number, string]> = {
  not_found: [404, 'not-found'],
  usage: [400, 'bad-request'],
  conflict: [409, 'conflict'],
}

export function createBackgroundJobRoutes(options: BackgroundJobRouteOptions) {
  const { db, problem } = options
  const refused = (error: unknown): Response => {
    if (!(error instanceof BackgroundJobError)) throw error
    const [status, code] = STATUS[error.kind]
    return problem(status, {
      code,
      title: error.message,
      ...(error.hint ? { detail: error.hint } : {}),
    })
  }

  return {
    /** The capability these routes add to discovery. */
    capabilities: ['background-jobs'],

    /** Whether a principal may see and retry jobs: the Settings section, as the dashboard. */
    may: (principal: Principal) => !principal.ci && hasSection(principal, 'settings'),

    /** Answers one of these routes, or undefined when `what` is none of them. */
    async handle(
      request: Request,
      url: URL,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const route = /^background-jobs(?:\/([^/]+)(?:\/(retry))?)?$/.exec(what)
      if (!route) return undefined
      if (principal.ci)
        return problem(403, {
          code: 'ci-cannot-manage-jobs',
          title: 'Background jobs need a person',
          detail: 'Sign in as yourself: CI cannot do this.',
        })
      if (!hasSection(principal, 'settings'))
        return problem(403, { code: 'forbidden', title: 'You may not see background jobs here' })
      const [, named, retry] = route
      try {
        if (!named) {
          if (request.method !== 'GET') return new Response(null, { status: 405 })
          const listed = await listJobs(db, readJobQuery(url.searchParams))
          return Response.json({
            total: listed.total,
            waitingSince: options.waitingSince?.() ?? null,
            items: listed.items,
          })
        }
        const id = decodeURIComponent(named)
        if (!retry) {
          if (request.method !== 'GET') return new Response(null, { status: 405 })
          return Response.json(await jobOf(db, id))
        }
        if (request.method !== 'POST') return new Response(null, { status: 405 })
        const level = options.levelRefusal()
        if (level) return level
        const done = await retryJob(db, id, {
          key: principal.id,
          name: principal.name,
          source: 'request',
          address: { forwardedFor: request.headers.get('x-forwarded-for') },
        })
        return Response.json({ ok: true, ...done })
      } catch (error) {
        return refused(error)
      }
    },
  }
}
