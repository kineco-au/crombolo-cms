/**
 * Cookies the integration keeps (story 208): a member's tokens and a sign-in in
 * progress, sealed with AES-GCM under `CROMBOLO_NEXT_SECRET`, and the editor's
 * preview token. Web Crypto only, so it runs in Node and at the edge alike.
 */

export const SESSION_COOKIE = 'crombolo_member'
export const SIGN_IN_COOKIE = 'crombolo_sign_in'
export const PREVIEW_COOKIE = 'crombolo_preview'

export interface MemberSession {
  accessToken: string
  refreshToken?: string
  /** When the access token stops working, in milliseconds since the epoch. */
  expiresAt: number
}

export interface SignInState {
  state: string
  verifier: string
  returnTo: string
}

/** The secret sessions are sealed with; refused when shorter than 32 characters. */
export function sessionSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32)
    throw new Error(
      'CROMBOLO_NEXT_SECRET must be set to at least 32 characters to keep members signed in.',
    )
  return secret
}

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const text = atob(value.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
  return bytes
}

async function keyFor(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** A value sealed so only a holder of the secret can read or forge it. */
export async function seal(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await keyFor(secret),
    encoder.encode(JSON.stringify(value)),
  )
  return `${base64url(iv)}.${base64url(new Uint8Array(sealed))}`
}

/** The value back, or undefined when it was tampered with or sealed under another secret. */
export async function unseal<T>(
  sealed: string | undefined,
  secret: string,
): Promise<T | undefined> {
  if (!sealed) return undefined
  const [iv, data] = sealed.split('.')
  if (!iv || !data) return undefined
  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64url(iv) },
      await keyFor(secret),
      fromBase64url(data),
    )
    return JSON.parse(new TextDecoder().decode(opened)) as T
  } catch {
    return undefined
  }
}

/** A random value for PKCE and `state`. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** PKCE's S256 challenge for a verifier. */
export async function challengeFor(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
}

/** Whether two secrets match, taking the same time whatever they hold. */
export async function sameSecret(given: string | null, expected: string): Promise<boolean> {
  if (!given) return false
  const [a, b] = await Promise.all(
    [given, expected].map(
      async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(v))),
    ),
  )
  const left = a as Uint8Array
  const right = b as Uint8Array
  let difference = 0
  for (let i = 0; i < left.length; i++) difference |= (left[i] as number) ^ (right[i] as number)
  return difference === 0
}

/** A cookie's value from a `Cookie` header. */
export function readCookie(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const at = part.indexOf('=')
    if (at > 0 && part.slice(0, at).trim() === name)
      return decodeURIComponent(part.slice(at + 1).trim())
  }
  return undefined
}

/** A `Set-Cookie` value: http-only, `SameSite=Lax`, and `Secure` unless on plain http. */
export function cookie(
  name: string,
  value: string,
  options: { maxAge?: number; secure?: boolean; path?: string } = {},
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? '/'}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  if (options.secure !== false) parts.push('Secure')
  return parts.join('; ')
}
