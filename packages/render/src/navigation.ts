/**
 * Ending a page early, as `next/navigation` does: each function throws an
 * outcome from any component, layout or block, and the page answers its status
 * (story 206). The page renders whole before it answers, so a throw at any
 * depth never meets a half-sent response.
 */
import { type FieldError, isOutcome, Outcome } from '@crombolo/core'

/** 307: sends the visitor on, keeping the request's method. */
export function redirect(url: string): never {
  throw Outcome.redirect(url)
}

/** 308: the page has moved for good. */
export function permanentRedirect(url: string): never {
  throw Outcome.permanentRedirect(url)
}

/** 404, rendered by the site's not-found page with `message` in `usePage().outcome`. */
export function notFound(message?: string): never {
  throw Outcome.notFound(message)
}

/** 403, rendered by the site's error page. */
export function forbidden(message?: string): never {
  throw Outcome.forbidden(message)
}

/** 401, rendered by the site's unauthorized page. */
export function unauthorized(message?: string): never {
  throw Outcome.unauthorized(message)
}

/** 302: the everyday redirect, as `umbracoRedirect` answers. */
export function foundAt(url: string): never {
  throw Outcome.foundAt(url)
}

/** 301: the page has moved for good. */
export function movedPermanentlyTo(url: string): never {
  throw Outcome.movedPermanentlyTo(url)
}

/** 303: after a POST, look at this address. */
export function seeOther(url: string): never {
  throw Outcome.seeOther(url)
}

/** 400: a request the page cannot use. */
export function badRequest(message?: string, errors?: readonly FieldError[]): never {
  throw Outcome.badRequest(message, errors)
}

/** 410: the page is gone for good. */
export function gone(message?: string): never {
  throw Outcome.gone(message)
}

/** 422: well-formed input that failed validation. */
export function unprocessableContent(errors: readonly FieldError[], message?: string): never {
  throw Outcome.unprocessableContent(errors, message)
}

/**
 * For code that catches errors for its own reasons: rethrows an outcome so the
 * page still answers it, and returns for anything else.
 */
export function rethrow(error: unknown): void {
  if (isOutcome(error)) throw error
}
