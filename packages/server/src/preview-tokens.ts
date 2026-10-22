/**
 * Preview tokens (story 053): what lets an app in the browser read drafts
 * without the API key, on behalf of the editor who pressed Preview. A token is
 * signed, names its editor and an expiry, and carries a digest of their security
 * stamp, so changing the password ends every token they hold. Who it is and what
 * they may read are checked again on every request. docs/delivery-api.md,
 * "Preview".
 */
import type { Db } from '@crombolo/data'
import { ensureKeyValue, fromDbBool } from '@crombolo/data'

const SIGNING_KEY = 'crombolo/previewTokenKey'

export interface PreviewTokenClaims {
  /** The editor's user id. */
  user: number
  /** A digest of their security stamp when it was issued. */
  stamp: string
  /** Milliseconds since the epoch. */
  expires: number
}

/** The per-site signing key, created once and shared by every node through the database. */
export function previewSigningSecret(db: Db): Promise<string> {
  return ensureKeyValue(db, SIGNING_KEY, () => crypto.randomUUID())
}

function hmac(secret: string, payload: string): string {
  const hasher = new Bun.CryptoHasher('sha256', secret)
  hasher.update(payload)
  return hasher.digest('base64url')
}

function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return difference === 0
}

/** A short digest of a security stamp: enough to notice it changed, nothing of the stamp itself. */
export function stampDigest(stamp: string | null): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(stamp ?? '')
  return hasher.digest('base64url').slice(0, 16)
}

export function signPreviewToken(secret: string, claims: PreviewTokenClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${hmac(secret, payload)}`
}

/** The claims of a token signed here and not yet expired; undefined for anything else. */
export function readPreviewToken(
  secret: string,
  token: string,
  now = Date.now(),
): PreviewTokenClaims | undefined {
  const [payload, signature, ...rest] = token.split('.')
  if (!payload || !signature || rest.length > 0) return undefined
  if (!sameSignature(hmac(secret, payload), signature)) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as PreviewTokenClaims
    if (
      typeof claims.user !== 'number' ||
      typeof claims.stamp !== 'string' ||
      typeof claims.expires !== 'number'
    )
      return undefined
    return claims.expires > now ? claims : undefined
  } catch {
    return undefined
  }
}

/** The editor's standing now: undefined once they are gone, locked out or not approved. */
export async function previewUser(
  db: Db,
  where: { id: number } | { key: string },
): Promise<{ id: number; stamp: string } | undefined> {
  const rows = await db.query<{
    id: number
    security_stamp: string | null
    is_locked_out: unknown
    is_approved: unknown
  }>(
    `SELECT id, security_stamp, is_locked_out, is_approved FROM user_account WHERE ${
      'id' in where ? 'id' : 'key'
    } = ?`,
    ['id' in where ? where.id : where.key],
  )
  const row = rows[0]
  if (!row || fromDbBool(row.is_locked_out) || !fromDbBool(row.is_approved)) return undefined
  return { id: Number(row.id), stamp: stampDigest(row.security_stamp) }
}
