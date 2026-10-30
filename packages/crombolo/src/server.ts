/**
 * The site's own services for page code (story 206): `site()`, acting as the
 * visitor, and the `Result` its services return. And what a site's named
 * queries are written against (story 189).
 */
export {
  assertSafeLocation,
  type FieldError,
  isOk,
  isOutcome,
  type MatchHandlers,
  Ok,
  Outcome,
  type OutcomeStatus,
  ok,
  type RedirectStatus,
  type RefusalStatus,
  Result,
} from '@crombolo/core'
export {
  type NamedQuery,
  type QueriesOf,
  type QueryCaller,
  type Register,
  type SiteJobStatus,
  type SiteJobs,
  type SiteMedia,
  type SiteMembers,
  type SiteQueries,
  type SiteServices,
  site,
} from '@crombolo/render'
export type { JobInfo, JobSchedule } from '@crombolo/server'

// Decision 8 of story 209: a browser that loads this has been handed server code.
if (typeof document !== 'undefined')
  throw new Error(
    "@crombolo/crombolo/server only runs on the server; a 'use client' component cannot import it.",
  )
