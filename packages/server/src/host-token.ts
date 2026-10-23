/**
 * A host token (story 178): the back office's signed statement, for a service
 * the host runs elsewhere, of who is signed in. Short-lived, addressed to the
 * one host origin configured, and signed with a key the host holds.
 * docs/bundles.md, "Tools a host provides".
 */
import { SignJWT } from 'jose'

/** The installation's host, from `crombolo.config.ts` only. */
export interface HostConfig {
  /** The host service's origin, which every token is addressed to. */
  origin: string
  /** The HS256 key, at least 32 bytes; it both signs and verifies. */
  signingKey: string
  /** Names the key in each token's header, for a host running many installations. */
  keyId: string
}

/** How long a token lasts, in seconds. */
export const HOST_TOKEN_SECONDS = 300

/** Refuses a `host` that could not be used, naming the field. */
export function checkHost(host: HostConfig | undefined): void {
  if (!host) return
  let url: URL | undefined
  try {
    url = new URL(host.origin)
  } catch {
    url = undefined
  }
  const local = url?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (!url || (url.protocol !== 'https:' && !local) || url.origin !== host.origin)
    throw new Error(
      `host.origin "${host.origin}" must be an https origin with no path, such as https://tools.example.com.`,
    )
  if (new TextEncoder().encode(host.signingKey ?? '').length < 32)
    throw new Error('host.signingKey must be at least 32 bytes.')
  if (typeof host.keyId !== 'string' || host.keyId.trim() === '')
    throw new Error('host.keyId must name the key.')
}

/** Who the token is about, and which site says so. */
export interface HostTokenSubject {
  user: { key: string; name: string }
  groups: readonly string[]
  sections: readonly string[]
  site: { name: string; nodeId: string; url?: string }
}

export async function issueHostToken(
  host: HostConfig,
  subject: HostTokenSubject,
  now = new Date(),
): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000)
  const token = new SignJWT({
    name: subject.user.name,
    groups: [...subject.groups],
    sections: [...subject.sections],
    site: { name: subject.site.name, nodeId: subject.site.nodeId },
  })
    .setProtectedHeader({ alg: 'HS256', kid: host.keyId, typ: 'JWT' })
    .setSubject(subject.user.key)
    .setAudience(host.origin)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + HOST_TOKEN_SECONDS)
  if (subject.site.url) token.setIssuer(subject.site.url)
  return token.sign(new TextEncoder().encode(host.signingKey))
}
