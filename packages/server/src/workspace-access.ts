/**
 * Who may look at a workspace's site, and which workspace a request is for
 * (story 379). A workspace is named by the host a request arrives on, from the
 * site's pattern (`CROMBOLO_WORKSPACES_HOST`, such as
 * `{workspace}.preview.example.com`, the workspace's key as 32 hex digits), or,
 * where no pattern is set, by a cookie on the site's own host.
 *
 * A member gets in by a single-use handoff: "Open" answers a link carrying a
 * signed token, used once within five minutes and swapped for a host-only
 * cookie that names them, checked again on every request. Anyone else gets in by
 * a link a member made: reusable until it expires or is withdrawn, its secret in
 * the address once (then a cookie), or in `Crombolo-Workspace-Link` on a Delivery
 * API call.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const WORKSPACE_HANDOFF_PARAM = 'crombolo-workspace'
export const WORKSPACE_LINK_PARAM = 'crombolo-workspace-link'
export const WORKSPACE_LINK_HEADER = 'crombolo-workspace-link'
export const WORKSPACE_COOKIE = 'crombolo_workspace'
export const WORKSPACE_HANDOFF_ISSUER = 'crombolo:workspace-handoff'
export const WORKSPACE_HANDOFF_SECONDS = 5 * 60
/** How long a member's cookie lasts before they open the workspace again. */
export const WORKSPACE_COOKIE_SECONDS = 8 * 60 * 60

/** What the cookie carries: a member, or a link. */
export type WorkspaceAccess =
  /** `admin`: opened by an administrator not in it, who asked to (story 401). */
  | { workspace: string; user: number; stamp: string; expires: number; admin?: boolean }
  | { workspace: string; link: number; expires: number }

const hmac = (key: string, text: string) =>
  createHmac('sha256', key).update(text).digest('base64url')

/** What a signed value is for: one is never accepted as another (story 447 adds Shared's). */
export type SignedPurpose = 'handoff' | 'cookie' | 'shared-handoff' | 'shared-cookie'

const keyFor = (secret: string, purpose: SignedPurpose) =>
  hmac(secret, `crombolo/workspace-${purpose}`)

export function sign(secret: string, purpose: SignedPurpose, claims: object): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${hmac(keyFor(secret, purpose), payload)}`
}

export function read(
  secret: string,
  purpose: SignedPurpose,
  token: string,
  now: number,
): Record<string, unknown> | undefined {
  const [payload, signature, ...rest] = token.split('.')
  if (!payload || !signature || rest.length > 0) return undefined
  const expected = Buffer.from(hmac(keyFor(secret, purpose), payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      unknown
    >
    if (typeof claims.workspace !== 'string' || typeof claims.expires !== 'number') return undefined
    return claims.expires > now ? claims : undefined
  } catch {
    return undefined
  }
}

/** A member's handoff: their user id and stamp, the workspace, and a single-use id. */
export function signHandoff(
  secret: string,
  claims: {
    workspace: string
    user: number
    stamp: string
    id: string
    expires: number
    admin?: boolean
  },
): string {
  return sign(secret, 'handoff', claims)
}

export function readHandoff(secret: string, token: string, now = Date.now()) {
  const claims = read(secret, 'handoff', token, now)
  return claims &&
    typeof claims.user === 'number' &&
    typeof claims.stamp === 'string' &&
    typeof claims.id === 'string'
    ? (claims as {
        workspace: string
        user: number
        stamp: string
        id: string
        expires: number
        admin?: boolean
      })
    : undefined
}

export function signAccess(secret: string, access: WorkspaceAccess): string {
  return sign(secret, 'cookie', access)
}

export function readAccess(secret: string, value: string, now = Date.now()) {
  const claims = read(secret, 'cookie', value, now)
  if (!claims) return undefined
  if (typeof claims.user === 'number' && typeof claims.stamp === 'string')
    return claims as unknown as WorkspaceAccess
  if (typeof claims.link === 'number') return claims as unknown as WorkspaceAccess
  return undefined
}

/** The `Set-Cookie` value for access, host-only, or for clearing it. */
export function accessCookie(value: string | null, secure: boolean): string {
  const age = value === null ? 0 : WORKSPACE_COOKIE_SECONDS
  return `${WORKSPACE_COOKIE}=${value ?? ''}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** A link's secret as it is stored: its SHA-256, so the table never holds one that opens anything. */
export const linkSecretHash = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex')

/** A workspace key as a host label: its 32 hex digits. */
export const hostLabel = (key: string): string => key.replaceAll('-', '').toLowerCase()

/** The key back from its label. */
export function keyFromLabel(label: string): string | undefined {
  if (!/^[0-9a-f]{32}$/i.test(label)) return undefined
  const l = label.toLowerCase()
  return `${l.slice(0, 8)}-${l.slice(8, 12)}-${l.slice(12, 16)}-${l.slice(16, 20)}-${l.slice(20)}`
}

/**
 * The site's host pattern as a matcher: the workspace's label from a host, and a
 * host for a workspace. `{host}` stands for a site host the pattern lays the
 * workspace over, so a site with several hostnames keeps each.
 */
export function workspaceHosts(pattern: string | undefined) {
  if (!pattern) return undefined
  // Each token a group, everything else as written.
  let source = '^'
  const order: Array<'workspace' | 'host'> = []
  for (const part of pattern.split(/(\{workspace\}|\{host\})/)) {
    if (part === '{workspace}') {
      source += '([0-9a-f]{32})'
      order.push('workspace')
    } else if (part === '{host}') {
      source += '(.+)'
      order.push('host')
    } else source += part.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')
  }
  const matcher = new RegExp(`${source}$`, 'i')
  return {
    /** The workspace a request's host names, and the site host under it, if any. */
    parse(host: string): { key: string; host: string | undefined } | undefined {
      const bare = host.replace(/:\d+$/, '')
      const match = matcher.exec(bare)
      if (!match) return undefined
      const at = (name: 'workspace' | 'host') => match[order.indexOf(name) + 1]
      const key = keyFromLabel(at('workspace') ?? '')
      if (!key) return undefined
      return { key, host: pattern.includes('{host}') ? at('host') : undefined }
    },
    /** The host a workspace is served at, over one of the site's hosts. */
    hostFor(key: string, siteHost?: string): string {
      return pattern.replace('{workspace}', hostLabel(key)).replace('{host}', siteHost ?? '')
    },
  }
}
