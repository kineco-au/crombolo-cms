/**
 * A site's route handlers (story 211): the contract from `@crombolo/common`,
 * bound to crombolo's types, and `fromRouteModule`, which takes a Next.js-style
 * route module (exports `GET`, `POST`, …) as one route.
 */
import {
  type RouteContext as CommonRouteContext,
  type RouteHandler as CommonRouteHandler,
  type SiteRoute as CommonSiteRoute,
  route as commonRoute,
  ROUTE_METHODS,
  type RouteMethod,
  type RouteOptions,
} from '@crombolo/common'
import type { RequestMember, SiteServices } from '@crombolo/render'

export {
  type CookieOptions,
  type FieldError,
  Outcome,
  ok,
  ROUTE_METHODS,
  type RouteMethod,
  type RouteOptions,
} from '@crombolo/common'

/** What a site's handler is given: `site()` gives its services, `member()` the signed-in member. */
export type RouteContext = CommonRouteContext<SiteServices, RequestMember>
export type RouteHandler = CommonRouteHandler<SiteServices, RequestMember>
export type SiteRoute = CommonSiteRoute<SiteServices, RequestMember>

/** A route on this site: `route('/api/records/:species', { GET: list, POST: add })`. */
export function route(
  path: string,
  handlers: Partial<Record<RouteMethod, RouteHandler>>,
  options: RouteOptions = {},
): SiteRoute {
  return commonRoute<SiteServices, RequestMember>(path, handlers, options)
}

/** A Next.js route module's handler: the request, and `{ params }` as a promise. */
type NextRouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Response | Promise<Response>

/**
 * A Next.js-style route module as a route: each exported method becomes its
 * handler, given `{ params }` as Next.js does. `export const csrf = false` and
 * the other options may be exported beside them, or passed here.
 */
export function fromRouteModule(
  path: string,
  module: Partial<Record<RouteMethod, NextRouteHandler>> & Record<string, unknown>,
  options: RouteOptions = {},
): SiteRoute {
  const handlers: Partial<Record<RouteMethod, RouteHandler>> = {}
  for (const method of ROUTE_METHODS) {
    const handler = module[method]
    if (typeof handler === 'function')
      handlers[method] = (request, context) =>
        (handler as NextRouteHandler)(request, { params: Promise.resolve(context.params) })
  }
  const exported: RouteOptions = {
    ...(typeof module.csrf === 'boolean' ? { csrf: module.csrf } : {}),
    ...(module.rateLimit !== undefined
      ? { rateLimit: module.rateLimit as RouteOptions['rateLimit'] }
      : {}),
    ...(module.members !== undefined ? { members: module.members as RouteOptions['members'] } : {}),
  }
  return commonRoute<SiteServices, RequestMember>(path, handlers, { ...exported, ...options })
}
