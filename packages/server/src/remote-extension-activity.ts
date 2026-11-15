/**
 * The remote protocol's routes for what an extension did (story 362): a page of
 * its activity, the counts and the people it acted for, and the same as a CSV
 * file, as Installed's Activity view reads them, through the core the command
 * line uses. They need the Settings section; CI is refused, since these show
 * who did what.
 */
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import type { Db } from '@crombolo/data'
import { type ActivitySource, activityPath, answerActivity } from './extension-activity.ts'

interface Problem {
  code: string
  title: string
  detail?: string
}

export interface ExtensionActivityRouteOptions {
  db: Db
  problem(status: number, body: Problem): Response
  /** How to flush the recorder, and how many days the counts cover. */
  activity: ActivitySource
}

export function createExtensionActivityRoutes(options: ExtensionActivityRouteOptions) {
  const { db, problem } = options
  return {
    /** The capability these routes add to discovery. */
    capabilities: ['extension-activity'],

    /** Whether a principal may read it: the Settings section, as the Activity view. */
    may: (principal: Principal) => !principal.ci && hasSection(principal, 'settings'),

    /** Answers one of these routes, or undefined when `what` is none of them. */
    async handle(
      request: Request,
      url: URL,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const route = activityPath(what)
      if (!route) return undefined
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      if (principal.ci)
        return problem(403, {
          code: 'ci-cannot-read-activity',
          title: 'Reading what an extension did needs a person',
          detail: 'Sign in as yourself: CI cannot do this.',
        })
      if (!hasSection(principal, 'settings'))
        return problem(403, {
          code: 'forbidden',
          title: 'You may not see what extensions did here',
        })
      return answerActivity(
        db,
        options.activity,
        route.id,
        route.part,
        url.searchParams,
        (status, title) =>
          problem(status, { code: status === 404 ? 'not-found' : 'bad-request', title }),
      )
    },
  }
}
