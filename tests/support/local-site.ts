/**
 * A site folder for the command line's sign-in (story 350): SQLite in a file
 * of its own whatever the dialect under test, its sign-ins in a credentials
 * file of its own, the CLI run in it, and a server for it in this process.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuthService, AuthStore, REMOTE_CLIENT_ID } from '@crombolo/auth'
import { connect, type Db } from '@crombolo/data'
import { type CromboloConfig, fileKeychain, loadConfig } from '@crombolo/server'
import { type SiteSignIn, signInName } from '../../packages/cli/src/support/local-sign-in.ts'
import { ROOT } from '../../scripts/packages.ts'
import { ADMIN, bootServer, type Harness, signIn } from './harness.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const SECRET_KEY = 'a-test-secret-key-that-is-long-enough-to-use'

export interface LocalSite {
  dir: string
  config: CromboloConfig
  /** Where its CLI keeps sign-ins. */
  credentials: string
  env(extra?: Record<string, string>): Record<string, string>
}

export function localSite(name: string): LocalSite {
  const dir = mkdtempSync(join(process.cwd(), 'output', `${name}-`))
  for (const folder of ['schema', 'components', 'css', 'scripts', 'media'])
    mkdirSync(join(dir, folder), { recursive: true })
  writeFileSync(join(dir, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(dir, 'crombolo.config.ts'), 'export default {}\n')
  const folders = {
    siteDir: dir,
    schemaDir: join(dir, 'schema'),
    componentsDir: join(dir, 'components'),
    stylesheetsDir: join(dir, 'css'),
    scriptsDir: join(dir, 'scripts'),
    mediaDir: join(dir, 'media'),
  }
  const credentials = join(dir, 'credentials')
  const config = loadConfig(
    { ...folders, dialect: 'sqlite', sqliteFile: join(dir, 'site.sqlite'), development: true },
    dir,
  )
  return {
    dir,
    config,
    credentials,
    env: (extra = {}) => ({
      ...(process.env as Record<string, string>),
      CROMBOLO_DB: 'sqlite',
      CROMBOLO_SQLITE_FILE: config.sqliteFile,
      CROMBOLO_SCHEMA_DIR: folders.schemaDir,
      CROMBOLO_COMPONENTS_DIR: folders.componentsDir,
      CROMBOLO_MEDIA_DIR: folders.mediaDir,
      CROMBOLO_ADMIN_LOGIN: ADMIN.username,
      CROMBOLO_SECRET_KEY: SECRET_KEY,
      CROMBOLO_CREDENTIALS: 'file',
      CROMBOLO_CREDENTIALS_FILE: credentials,
      ...extra,
    }),
  }
}

/** The CLI in the site's folder. */
export function cli(site: LocalSite, args: string[], extra: Record<string, string> = {}) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], {
    cwd: site.dir,
    env: site.env(extra),
    stdin: 'ignore',
  })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}

/** The site's server in this process, its administrator signed in. */
export async function serveSite(site: LocalSite): Promise<Harness> {
  const server = await bootServer({
    keepDatabase: true,
    config: {
      siteDir: site.config.siteDir,
      schemaDir: site.config.schemaDir,
      componentsDir: site.config.componentsDir,
      stylesheetsDir: site.config.stylesheetsDir,
      scriptsDir: site.config.scriptsDir,
      mediaDir: site.config.mediaDir,
      dialect: 'sqlite',
      sqliteFile: site.config.sqliteFile,
      secretKey: SECRET_KEY,
    },
  })
  return signIn(server, ADMIN)
}

export async function withSiteDb<T>(site: LocalSite, use: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect({ dialect: 'sqlite', file: site.config.sqliteFile })
  try {
    return await use(db)
  } finally {
    await db.close()
  }
}

/** A device sign-in for `login`, approved as they would approve it, made in the database. */
export function sessionFor(site: LocalSite, login: string): Promise<SiteSignIn> {
  return withSiteDb(site, async (db) => {
    const store = new AuthStore(db)
    const auth = new AuthService(store)
    const user = await store.findUserByLogin(login)
    if (!user) throw new Error(`There is no user ${login}.`)
    const started = await auth.startDeviceAuthorization(REMOTE_CLIENT_ID, 'crombolo in a test')
    await auth.decideDevice(started.userCode, user.id, true)
    const polled = await auth.pollDevice(started.deviceCode, REMOTE_CLIENT_ID)
    if (!polled.ok) throw new Error(polled.description)
    return {
      accessToken: polled.grant.accessToken,
      refreshToken: polled.grant.refreshToken,
      expiresAt: Date.now() + polled.grant.expiresIn * 1000,
      clientId: REMOTE_CLIENT_ID,
      user: user.userName,
    }
  })
}

/** Keeps a sign-in where the site's CLI finds it. */
export const keepSignIn = (site: LocalSite, signedIn: SiteSignIn) =>
  fileKeychain(site.credentials).set(signInName(site.config), JSON.stringify(signedIn))

export async function storedSignIn(site: LocalSite): Promise<SiteSignIn | undefined> {
  const stored = await fileKeychain(site.credentials).get(signInName(site.config))
  return stored ? (JSON.parse(stored) as SiteSignIn) : undefined
}
