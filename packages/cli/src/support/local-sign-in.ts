/**
 * Signing in to this folder's site (story 350): a back-office session of the
 * site's own, made by the device grant through its running server and kept
 * where a hosted site's sign-in is, under the site's database. A command checks
 * it against that database, renewing it while it is still valid, so it needs
 * no server once someone is signed in.
 */
import { existsSync } from 'node:fs'
import type { Principal } from '@crombolo/api-management/domain'
import {
  AuthService,
  AuthStore,
  type CliTokenRefusal,
  CliTokens,
  DEVICE_CODE_GRANT,
  REMOTE_CLIENT_ID,
} from '@crombolo/auth'
import { managementApiPath } from '@crombolo/core'
import { connect, type Db } from '@crombolo/data'
import { type CromboloConfig, describeDatabase, principalOf, recordAudit } from '@crombolo/server'
import type { RemoteSignIn } from '@crombolo/server/remote-credentials'
import { keychain } from './remote.ts'
import { readSupervisor } from './supervise.ts'

export type SiteSignIn = Omit<RemoteSignIn, 'tokenUrl'>

/** The keychain entry for a site: its database, so two folders on one share it. */
export const signInName = (config: CromboloConfig): string =>
  `crombolo-site ${describeDatabase(config)}`

export async function readSiteSignIn(config: CromboloConfig): Promise<SiteSignIn | undefined> {
  const stored = await keychain().get(signInName(config))
  if (!stored) return undefined
  try {
    return JSON.parse(stored) as SiteSignIn
  } catch {
    return undefined
  }
}

export const saveSiteSignIn = (config: CromboloConfig, signIn: SiteSignIn) =>
  keychain().set(signInName(config), JSON.stringify(signIn))

export const forgetSiteSignIn = (config: CromboloConfig) => keychain().delete(signInName(config))

async function withSiteDb<T>(config: CromboloConfig, use: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect({ dialect: config.dialect, file: config.sqliteFile })
  try {
    return await use(db)
  } finally {
    await db.close()
  }
}

const noDatabase = (config: CromboloConfig) =>
  config.dialect === 'sqlite' &&
  (config.sqliteFile === ':memory:' || !existsSync(config.sqliteFile))

export type Resolved = { person: Principal } | 'ended'

/**
 * The person a stored sign-in is, checked against the site's database: renewed
 * by its refresh token when the access token has run out, and `ended` once the
 * session has, or was signed out or revoked.
 */
export async function resolveSiteSignIn(
  config: CromboloConfig,
  stored: SiteSignIn,
): Promise<Resolved> {
  if (noDatabase(config)) return 'ended'
  return withSiteDb(config, async (db) => {
    const auth = new AuthService(new AuthStore(db))
    let identity =
      stored.expiresAt - Date.now() > 60_000
        ? await auth.resolveAccessToken(stored.accessToken)
        : undefined
    if (!identity) {
      const renewed = await auth.refresh(stored.refreshToken, stored.clientId)
      if (!renewed.ok) return 'ended'
      identity = await auth.resolveAccessToken(renewed.grant.accessToken)
      if (!identity) return 'ended'
      await saveSiteSignIn(config, {
        ...stored,
        accessToken: renewed.grant.accessToken,
        refreshToken: renewed.grant.refreshToken,
        expiresAt: Date.now() + renewed.grant.expiresIn * 1000,
      })
    }
    return { person: await principalOf(db, identity) }
  })
}

/** The site's command-line tokens, as its settings have them. */
export const siteCliTokens = (config: CromboloConfig, db: Db) =>
  new CliTokens(db, { enabled: config.cliTokens, maxDays: config.cliTokenMaxDays })

export const withSiteDatabase = withSiteDb

/**
 * The person a command-line token acts as (story 351), checked against the
 * site's database with their permissions as they are now, or why it may not.
 * Its first use is audited under them.
 */
export async function resolveSiteToken(
  config: CromboloConfig,
  token: string,
): Promise<{ person: Principal } | { refused: CliTokenRefusal }> {
  if (noDatabase(config)) return { refused: 'unknown' }
  return withSiteDb(config, async (db) => {
    const tokens = siteCliTokens(config, db)
    const resolved = await tokens.resolve(token)
    if (!resolved.ok) return { refused: resolved.reason }
    const identity = await new AuthService(new AuthStore(db)).identityOf(resolved.user.id)
    if (!identity) return { refused: resolved.user.isLockedOut ? 'locked' : 'disabled' }
    if (resolved.firstUse)
      await recordAudit(db, {
        category: 'user',
        action: 'FirstUseOfToken',
        source: 'cli',
        userKey: resolved.user.key,
        userName: resolved.user.userName,
        entityType: 'User',
        entityKey: resolved.user.key,
        entityName: resolved.user.userName,
        detail: `"${resolved.token.name}"`,
      })
    return {
      person: await principalOf(db, identity, {
        key: resolved.token.key,
        name: resolved.token.name,
      }),
    }
  })
}

/** Ends the stored session in the database, as a revoked device's is, and forgets it. */
export async function endSiteSignIn(config: CromboloConfig): Promise<boolean> {
  const stored = await readSiteSignIn(config)
  if (!stored) return false
  if (!noDatabase(config))
    await withSiteDb(config, (db) =>
      new AuthService(new AuthStore(db)).revokeAccessToken(stored.accessToken),
    )
  await forgetSiteSignIn(config)
  return true
}

/** The address of this site's running server: `crombolo start`'s, then the configured port's. */
export async function runningServer(
  config: CromboloConfig,
  http: typeof fetch = fetch,
): Promise<string | undefined> {
  const ports = [readSupervisor(config.siteDir)?.port, config.port].filter(
    (port, i, all): port is number => typeof port === 'number' && all.indexOf(port) === i,
  )
  for (const port of ports) {
    const origin = `http://localhost:${port}`
    try {
      const response = await http(`${origin}/health`, { signal: AbortSignal.timeout(2_000) })
      const body = (await response.json()) as { ok?: unknown }
      if (typeof body.ok === 'boolean') return origin
    } catch {
      // Nothing there, or not a crombolo server.
    }
  }
  return undefined
}

/** The device grant's endpoints on a site's own server. */
export function deviceEndpoints(config: CromboloConfig, origin: string) {
  const security = `${origin}${managementApiPath(config.backOfficePath.replace(/\/+$/, ''))}/security/back-office`
  return {
    deviceAuthorization: `${security}/device`,
    token: `${security}/token`,
    clientId: REMOTE_CLIENT_ID,
    grantType: DEVICE_CODE_GRANT,
  }
}
