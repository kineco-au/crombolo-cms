/**
 * A way to look at Shared, the site as it serves itself (story 447): `open`'s single-use
 * hand-off, or a link someone made, swapped on first use for a host-only cookie at the
 * site's own address. A closed site's gate (story 446) lets the cookie in to the site,
 * never to its back office or Management API, with the rights it carries.
 * docs/workspaces.md, "Shared".
 */
import { readCookie } from '@crombolo/auth'
import { problemResponse, unauthorized } from '@crombolo/core'
import { read, sign, WORKSPACE_COOKIE_SECONDS } from './workspace-access.ts'

export const SHARED_HANDOFF_PARAM = 'crombolo-shared'
export const SHARED_LINK_PARAM = 'crombolo-shared-link'
export const SHARED_COOKIE = 'crombolo-shared'
export const SHARED_HANDOFF_ISSUER = 'crombolo:shared-handoff'

/** What the cookie carries: the person who opened Shared, or a link. */
export type SharedAccess =
  | { workspace: 'shared'; user: number; stamp: string; expires: number }
  | { workspace: 'shared'; link: number; expires: number }

export function signSharedHandoff(
  secret: string,
  claims: { user: number; stamp: string; id: string; expires: number },
): string {
  return sign(secret, 'shared-handoff', { workspace: 'shared', ...claims })
}

export function readSharedHandoff(secret: string, token: string, now = Date.now()) {
  const claims = read(secret, 'shared-handoff', token, now)
  return claims &&
    claims.workspace === 'shared' &&
    typeof claims.user === 'number' &&
    typeof claims.stamp === 'string' &&
    typeof claims.id === 'string'
    ? (claims as { user: number; stamp: string; id: string; expires: number })
    : undefined
}

export function signSharedAccess(secret: string, access: SharedAccess): string {
  return sign(secret, 'shared-cookie', access)
}

export function readSharedAccess(
  secret: string,
  value: string,
  now = Date.now(),
): SharedAccess | undefined {
  const claims = read(secret, 'shared-cookie', value, now)
  if (claims?.workspace !== 'shared') return undefined
  if (typeof claims.user === 'number' && typeof claims.stamp === 'string')
    return claims as unknown as SharedAccess
  if (typeof claims.link === 'number') return claims as unknown as SharedAccess
  return undefined
}

/** The `Set-Cookie` value for Shared's access, host-only, or for clearing it. */
export function sharedCookie(value: string | null, secure: boolean): string {
  const age = value === null ? 0 : WORKSPACE_COOKIE_SECONDS
  return `${SHARED_COOKIE}=${value ?? ''}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** The cookie a request carries, if any. */
export const sharedCookieOf = (request: Request): string | undefined =>
  readCookie(request, SHARED_COOKIE)

/** What a request that only looks may not do: anything but GET and HEAD. */
export const onlyLooks = (method: string): boolean => method === 'GET' || method === 'HEAD'

/** The answer to a write by someone a link or `open` only lets look. */
export const lookOnly = (): Response =>
  problemResponse(
    unauthorized(
      'The link you came by only lets you look at this site. Sign in to its back office to do more.',
    ),
    { 'cache-control': 'no-store' },
  )
