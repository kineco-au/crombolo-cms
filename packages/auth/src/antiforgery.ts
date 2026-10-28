/**
 * The anti-forgery token a member's browser sends with a cookie-authenticated
 * write to a bundle's site route (story 186).
 *
 * An HMAC over the member ticket's member, security stamp and expiry, so
 * nothing is stored: any node holding the signing key can check it, and it
 * stops matching when the session ends or the stamp rotates. Another site can
 * make the browser send the cookie but cannot read the page to learn the token.
 */
import type { MemberTicket } from './member-session.ts'

const ENCODER = new TextEncoder()
/** Keeps a token from ever matching another HMAC made with the same key. */
const PURPOSE = 'crombolo-antiforgery'

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const fromBase64url = (value: string): Uint8Array => {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

const hmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', ENCODER.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])

const material = (ticket: MemberTicket) =>
  ENCODER.encode(`${PURPOSE}\n${ticket.id.toLowerCase()}\n${ticket.stamp}\n${ticket.expires}`)

/** The token for a member's session. */
export async function antiforgeryToken(secret: string, ticket: MemberTicket): Promise<string> {
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), material(ticket))
  return base64url(new Uint8Array(signature))
}

/** Whether `token` was made for this session; compared in constant time. */
export async function verifyAntiforgery(
  secret: string,
  ticket: MemberTicket,
  token: string | null | undefined,
): Promise<boolean> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    fromBase64url(token) as unknown as ArrayBuffer,
    material(ticket),
  )
}
