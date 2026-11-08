/**
 * The site's own content event handlers (story 298): the config's `events`, by
 * the names webhooks use. The outbox dispatcher queues a site job per event
 * (`SITE_EVENT_JOB`), so a handler runs on a node that owns writes, retried as
 * jobs are, with the site's tables and `site()`. docs/rendering.md, "Content events".
 */
import { WEBHOOK_EVENT_ALIASES } from '@crombolo/api-management/domain'
import type { SiteContentEvent, SiteServices } from '@crombolo/render'
import type { JobHandler, JobInfo } from './owner-jobs.ts'
import { withSiteWrites } from './site-content.ts'

/** What a site's event handler is given besides the event. */
export interface SiteEventContext {
  /** The site's own tables, when it has any. */
  db?: unknown
  site: SiteServices
  /** The job the event runs as: its id, its attempt, and how to report progress. */
  job: JobInfo
}

export type SiteEventHandler = (event: SiteContentEvent, context: SiteEventContext) => unknown

/** The site job each content event runs as. Not a `module.export`, so no site job can take it. */
export const SITE_EVENT_JOB = 'crombolo:event'

/** Why the config's `events` cannot be used. Pure. */
export function siteEventProblems(events: Readonly<Record<string, unknown>> | undefined): string[] {
  const problems: string[] = []
  for (const [alias, handler] of Object.entries(events ?? {})) {
    if (!WEBHOOK_EVENT_ALIASES.has(alias))
      problems.push(`The site handles "${alias}", which is not an event this site raises.`)
    if (typeof handler !== 'function')
      problems.push(`The site's handler for "${alias}" is not a function.`)
  }
  return problems
}

/** What a handler's own write is said to come from, so its event does not call it again. */
export const eventVia = (alias: string, key: string): string => `event ${alias} ${key}`

/**
 * Whether an event comes from a site event handler's write to the very page the
 * handler was called for: the site does not hear of that, so a handler that
 * updates its page is not called again for its own change. Pure.
 */
export function isOwnChange(event: { key: string; via?: string }): boolean {
  const own = /^event \S+ (\S+)$/.exec(event.via ?? '')
  return own !== null && (own[1] ?? '').toLowerCase() === event.key.toLowerCase()
}

/** The job that calls the site's handler for an event, as the event names the write. */
export function siteEventJob(events: Readonly<Record<string, SiteEventHandler>>): JobHandler {
  return async (payload: SiteContentEvent, context: SiteEventContext) => {
    const handler = events[payload.alias]
    // A handler taken out of the config since: nothing to call, and nothing to retry.
    if (!handler) return
    await withSiteWrites({ via: eventVia(payload.alias, payload.key), source: 'job' }, () =>
      handler(payload, {
        ...(context.db !== undefined ? { db: context.db } : {}),
        site: context.site,
        job: context.job,
      }),
    )
  }
}
