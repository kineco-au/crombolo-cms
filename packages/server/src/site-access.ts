/**
 * A site open only to its back-office users (story 446): who a request signs in
 * as, read from the back office's own cookies without refreshing anything, and
 * what someone not signed in is answered. docs/configuration.md, "Site access".
 */
import {
  type AuthService,
  type CookieNames,
  isSafeMethod,
  isSameOrigin,
  parseCookies,
  REDACTED,
} from '@crombolo/auth'
import { localReturnUrl, problemResponse, unauthorized } from '@crombolo/core'
import { SHARED_COOKIE } from './shared-access.ts'

export const ROBOTS_DISALLOW_ALL = 'User-agent: *\nDisallow: /\n'

/** The back office's own cookies, which the site's code is never shown. */
export function backOfficeCookieNames(names: CookieNames): string[] {
  return [names.accessToken, names.refreshToken, names.session, names.twoFactorPending]
}

/**
 * The headers without the back office's cookies, or Shared's way in (story 447); the
 * same object when it carried none.
 */
export function withoutBackOfficeCookies(headers: Headers, names: CookieNames): Headers {
  const cookie = headers.get('cookie')
  if (!cookie) return headers
  const hidden = new Set([...backOfficeCookieNames(names), SHARED_COOKIE])
  const parts = cookie.split(';')
  const kept = parts.filter((part) => {
    const index = part.indexOf('=')
    return !hidden.has((index < 0 ? part : part.slice(0, index)).trim())
  })
  if (kept.length === parts.length) return headers
  const out = new Headers(headers)
  if (kept.length === 0) out.delete('cookie')
  else out.set('cookie', kept.map((part) => part.trim()).join('; '))
  return out
}

/** The request as the site's code sees it: the same one when it carried no back-office cookie. */
export function siteSeenRequest(request: Request, names: CookieNames): Request {
  const headers = withoutBackOfficeCookies(request.headers, names)
  if (headers === request.headers) return request
  const seen = new Request(request, { headers, signal: request.signal })
  // Bun keeps the original's cookie when the headers given carry none at all.
  if (!headers.has('cookie')) seen.headers.delete('cookie')
  return seen
}

/** Where someone not signed in signs in, coming back to the path they asked for. */
export function signInLocation(backOfficePath: string, url: URL): string {
  const back = localReturnUrl(`${url.pathname}${url.search}`) ?? '/'
  return `${backOfficePath}/login?returnUrl=${encodeURIComponent(back)}`
}

/** A browser opening an address, as opposed to a script calling an API. */
export function isBrowserNavigation(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  if (request.headers.has('authorization')) return false
  const mode = request.headers.get('sec-fetch-mode')
  if (mode) return mode === 'navigate' || mode === 'no-cors'
  const accept = request.headers.get('accept') ?? ''
  return !/application\/(?:[\w.+-]*\+)?json/i.test(accept) || /text\/html/i.test(accept)
}

/** What someone not signed in is answered: the sign-in for a browser, else a 401. */
export function notSignedIn(
  request: Request,
  backOfficePath: string,
  options: { api?: boolean } = {},
): Response {
  const url = new URL(request.url)
  const signIn = `${backOfficePath}/login`
  if (!options.api && isBrowserNavigation(request) && url.pathname !== signIn)
    return new Response(null, {
      status: 303,
      headers: { location: signInLocation(backOfficePath, url), 'cache-control': 'no-store' },
    })
  return problemResponse(unauthorized('This site is open only to people signed in to it.'), {
    'cache-control': 'no-store',
  })
}

/**
 * Every answer of a closed site: kept by nobody but the browser it went to, and
 * never indexed, whatever the page said of itself.
 */
export function privateAnswer(response: Response): Response {
  const headers = new Headers(response.headers)
  const own = (headers.get('cache-control') ?? '')
    .split(',')
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^(?:public|private|s-maxage=.*)$/i.test(directive))
  headers.set('cache-control', ['private', ...own].join(', '))
  headers.set('x-robots-tag', 'noindex, nofollow')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export interface SiteGateOptions {
  auth: AuthService
  names: CookieNames
  applicationUrl?: string
  /** Told about a refused cross-site write; never the token. */
  refused?: (request: Request) => void
}

/**
 * Whether a request carries a back-office user, in any group: an access token,
 * else a live refresh token or session read as they stand. Nothing is refreshed,
 * so a page's parallel requests cannot spend a token another of them needs.
 */
export function createSiteGate(options: SiteGateOptions) {
  const { auth, names } = options
  return async function signedIn(request: Request): Promise<boolean> {
    const header = request.headers.get('authorization')
    const bearer = header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : undefined
    if (bearer && bearer !== REDACTED) return Boolean(await auth.resolveAccessToken(bearer))
    const cookies = parseCookies(request.headers.get('cookie'))
    const access = cookies.get(names.accessToken)
    const refresh = cookies.get(names.refreshToken)
    const session = cookies.get(names.session)
    if (!access && !refresh && !session) return false
    if (!isSafeMethod(request.method) && !isSameOrigin(request, options.applicationUrl)) {
      options.refused?.(request)
      return false
    }
    if (access && (await auth.resolveAccessToken(access))) return true
    if (refresh && (await auth.resolveRefreshToken(refresh))) return true
    return Boolean(session && (await auth.resolveActiveSession(session)))
  }
}

/** The host a domain names, from `example.com`, `https://example.com/en` or `example.com/en`. */
function hostOf(domain: string): string | undefined {
  try {
    return new URL(/^[a-z][\w+.-]*:\/\//i.test(domain) ? domain : `http://${domain}`).host
  } catch {
    return undefined
  }
}

/**
 * Why the back office's cookies would not reach the site: the application URL's
 * host is not one the site answers on. A site with no hostnames answers on any.
 */
export function sameHostProblem(
  applicationUrl: string,
  domainNames: readonly string[],
): string | undefined {
  const hosts = domainNames
    .filter((name) => !name.startsWith('*'))
    .map(hostOf)
    .filter((host): host is string => Boolean(host))
  if (hosts.length === 0) return undefined
  const own = hostOf(applicationUrl)
  if (own && hosts.some((host) => host.toLowerCase() === own.toLowerCase())) return undefined
  return `CROMBOLO_SITE_ACCESS=users needs the site and its back office on one host, but ${own ?? applicationUrl} is not among the site's hostnames (${hosts.join(', ')}): the back office's sign-in will not reach the site.`
}
