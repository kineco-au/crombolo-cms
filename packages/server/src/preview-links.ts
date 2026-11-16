/**
 * Preview links (story 368): one page's draft in any browser for a few
 * minutes, without a back-office sign-in in it. A link carries a signed,
 * single-use token that the site swaps on first use for an httpOnly cookie
 * naming the person and the page, then redirects away from, so the token is
 * never left where the page's own scripts could read it. The person's
 * standing and read rights are checked again on every request.
 * docs/rendering.md, "Preview".
 */
import { hmac, sameSignature } from './preview-tokens.ts'

/** The query parameter a link carries its token in. */
export const PREVIEW_LINK_PARAM = 'crombolo-preview'
/** The cookie a used link leaves. */
export const PREVIEW_LINK_COOKIE = 'crombolo_preview_link'
/** How long a link waits for its first use. */
export const PREVIEW_LINK_SECONDS = 5 * 60
/** How long the cookie shows the draft. */
export const PREVIEW_LINK_COOKIE_SECONDS = 30 * 60
/** The issuer a link's id is used under, among single-use tokens. */
export const PREVIEW_LINK_ISSUER = 'crombolo:preview-link'

export interface PreviewLinkClaims {
  /** The person's user id. */
  user: number
  /** A digest of their security stamp when it was issued. */
  stamp: string
  /** The document's key. */
  document: string
  culture: string | null
  /** Milliseconds since the epoch. */
  expires: number
}

type Purpose = 'link' | 'cookie'

/**
 * A key for one purpose, derived from the preview key, so a link, its cookie
 * and a Delivery API preview token (053) never verify as one another.
 */
const keyFor = (secret: string, purpose: Purpose) => hmac(secret, `crombolo/preview-${purpose}`)

const sign = (secret: string, purpose: Purpose, claims: object) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${hmac(keyFor(secret, purpose), payload)}`
}

function read(secret: string, purpose: Purpose, token: string, now: number) {
  const [payload, signature, ...rest] = token.split('.')
  if (!payload || !signature || rest.length > 0) return undefined
  if (!sameSignature(hmac(keyFor(secret, purpose), payload), signature)) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >
    if (
      typeof claims.user !== 'number' ||
      typeof claims.stamp !== 'string' ||
      typeof claims.document !== 'string' ||
      (claims.culture !== null && typeof claims.culture !== 'string') ||
      typeof claims.expires !== 'number' ||
      claims.expires <= now
    )
      return undefined
    return claims
  } catch {
    return undefined
  }
}

/** A link's token: the claims and a single-use id. */
export function signPreviewLink(secret: string, claims: PreviewLinkClaims & { id: string }) {
  return sign(secret, 'link', claims)
}

export function readPreviewLink(
  secret: string,
  token: string,
  now = Date.now(),
): (PreviewLinkClaims & { id: string }) | undefined {
  const claims = read(secret, 'link', token, now)
  return claims && typeof claims.id === 'string'
    ? (claims as unknown as PreviewLinkClaims & { id: string })
    : undefined
}

/** The cookie a used link leaves, with the claims and a fresh expiry. */
export function signPreviewCookie(secret: string, claims: PreviewLinkClaims) {
  return sign(secret, 'cookie', claims)
}

export function readPreviewCookie(
  secret: string,
  value: string,
  now = Date.now(),
): PreviewLinkClaims | undefined {
  return read(secret, 'cookie', value, now) as PreviewLinkClaims | undefined
}

/** The `Set-Cookie` value for a used link, or for clearing one. */
export function previewLinkCookie(value: string | null, secure: boolean): string {
  const age = value === null ? 0 : PREVIEW_LINK_COOKIE_SECONDS
  return `${PREVIEW_LINK_COOKIE}=${value ?? ''}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}
