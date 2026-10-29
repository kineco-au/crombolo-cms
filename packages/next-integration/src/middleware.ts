/**
 * What runs before a page renders (story 208). A page cannot set cookies, so a
 * member's session is refreshed here: an expired access token is swapped for a
 * new one with the refresh token, and the page sees the new session at once.
 * And a page cannot change its status once Partial Prerendering has sent it, so
 * the CMS's redirects, misses and members-only refusals are answered here too.
 *
 * ```ts
 * // web/middleware.ts (proxy.ts in Next.js 16)
 * export default cromboloMiddleware(crombolo)
 * ```
 */
import {
  createDeliveryClient,
  DeliveryError,
  memoryConditionalStore,
} from '@crombolo/delivery-client'
import { NextResponse } from 'next/server'
import type { Crombolo } from './index.ts'
import { requestTokens } from './route-handlers.ts'
import {
  cookie,
  type MemberSession,
  PREVIEW_COOKIE,
  readCookie,
  SESSION_COOKIE,
  seal,
  sessionSecret,
  unseal,
} from './session.ts'

/** Refresh this long before the access token runs out, so a render never meets an expired one. */
const EARLY_MS = 30_000

/** A fresh session's cookie for this request, or undefined when nothing needs doing. */
export async function refreshedSession(
  crombolo: Crombolo,
  request: Request,
): Promise<{ value: string; setCookie: string } | { value: ''; setCookie: string } | undefined> {
  const secret = sessionSecret(crombolo.options.secret ?? process.env.CROMBOLO_NEXT_SECRET)
  const sealed = readCookie(request.headers.get('cookie'), SESSION_COOKIE)
  if (!sealed) return undefined
  const session = await unseal<MemberSession>(sealed, secret)
  const secure = new URL(request.url).protocol === 'https:'
  const forget = {
    value: '' as const,
    setCookie: cookie(SESSION_COOKIE, '', { secure, maxAge: 0 }),
  }
  if (!session) return forget
  if (session.expiresAt - EARLY_MS > Date.now()) return undefined
  if (!session.refreshToken) return forget
  const next = await requestTokens(crombolo, {
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
  })
  if (!next) return forget
  const value = await seal(next, secret)
  return { value, setCookie: cookie(SESSION_COOKIE, value, { secure, maxAge: 60 * 60 * 24 * 30 }) }
}

export interface MiddlewareOptions {
  /**
   * Look each page address up before it renders, so a redirect keeps its
   * status, a miss is a real 404 and a members-only page sends a visitor to
   * sign in. Default true.
   */
  routes?: boolean
  /** A route of the app's that calls `notFound()`, rewritten to for a miss. */
  notFoundPath?: string
  /** Where a visitor is sent to sign in, with `returnTo`. */
  signInPath?: string
}

/** Copies kept for the route lookups, revalidated with `If-None-Match` on every request. */
const routeCopies = memoryConditionalStore()

/** Whether a request is a page navigation the CMS answers, rather than an asset or an API call. */
function isPage(request: Request, path: string): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (path.startsWith('/api/') || path.startsWith('/_next/') || path.startsWith('/media/'))
    return false
  return !/\.[a-z0-9]+$/i.test(path)
}

/**
 * What the CMS answers at this address, before the page renders. With Partial
 * Prerendering a page's status is sent before its content streams, so a page
 * cannot turn itself into a redirect or a 404 any more; this can.
 */
async function routeAnswer(
  crombolo: Crombolo,
  request: Request,
  options: MiddlewareOptions,
  token: string | undefined,
): Promise<Response | undefined> {
  const url = new URL(request.url)
  if (!isPage(request, url.pathname) || readCookie(request.headers.get('cookie'), PREVIEW_COOKIE))
    return undefined
  const client = createDeliveryClient({
    baseUrl: crombolo.options.url,
    apiPath: crombolo.options.apiPath,
    apiKey: crombolo.options.apiKey,
    culture: crombolo.options.culture,
    startItem: crombolo.options.startItem,
    conditional: routeCopies,
    ...(token ? { memberToken: () => token } : {}),
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  })
  try {
    const answer = await client.route(url.pathname, { host: crombolo.options.host })
    if (answer.kind === 'page') return undefined
    if (answer.kind === 'redirect') {
      const target = new URL(answer.location, url)
      if (!target.search) target.search = url.search
      return NextResponse.redirect(target, answer.statusCode)
    }
    return NextResponse.rewrite(new URL(options.notFoundPath ?? '/crombolo/not-found', url), {
      status: 404,
    })
  } catch (error) {
    if (error instanceof DeliveryError && error.status === 401) {
      const signIn = new URL(options.signInPath ?? '/api/crombolo/sign-in', url)
      signIn.searchParams.set('returnTo', `${url.pathname}${url.search}`)
      return NextResponse.redirect(signIn, 307)
    }
    // A refusal for this member, or the CMS unreachable: the page has its say.
    return undefined
  }
}

/**
 * The app's middleware (`proxy.ts` in Next.js 16): refreshes the member's
 * session, then answers redirects, misses and members-only pages before a page
 * renders.
 */
export function cromboloMiddleware(crombolo: Crombolo, options: MiddlewareOptions = {}) {
  return async (request: Request): Promise<Response> => {
    const refreshed = await refreshedSession(crombolo, request).catch(() => undefined)
    let token: string | undefined
    if (options.routes !== false) {
      const secret = crombolo.options.secret ?? process.env.CROMBOLO_NEXT_SECRET
      const sealed = refreshed
        ? refreshed.value
        : readCookie(request.headers.get('cookie'), SESSION_COOKIE)
      const session =
        secret && secret.length >= 32 && sealed
          ? await unseal<MemberSession>(sealed, secret)
          : undefined
      token = session && session.expiresAt > Date.now() ? session.accessToken : undefined
      const answered = await routeAnswer(crombolo, request, options, token)
      if (answered) {
        if (refreshed) answered.headers.append('set-cookie', refreshed.setCookie)
        return answered
      }
    }
    if (!refreshed) return NextResponse.next()
    const headers = new Headers(request.headers)
    const others = (request.headers.get('cookie') ?? '')
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part && !part.startsWith(`${SESSION_COOKIE}=`))
    if (refreshed.value) others.push(`${SESSION_COOKIE}=${encodeURIComponent(refreshed.value)}`)
    headers.set('cookie', others.join('; '))
    const response = NextResponse.next({ request: { headers } })
    response.headers.append('set-cookie', refreshed.setCookie)
    return response
  }
}
