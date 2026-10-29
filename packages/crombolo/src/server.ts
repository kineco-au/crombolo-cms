/**
 * The site's own services for page code (story 206): `site()`, acting as the
 * visitor, and the `Result` its services return.
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
  type SiteMedia,
  type SiteMembers,
  type SiteServices,
  type SiteSql,
  site,
} from '@crombolo/render'

// Decision 8 of story 209: a browser that loads this has been handed server code.
if (typeof document !== 'undefined')
  throw new Error(
    "@crombolo/crombolo/server only runs on the server; a 'use client' component cannot import it.",
  )
