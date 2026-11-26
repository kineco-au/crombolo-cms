/**
 * Story 085: the database an integration test's site runs on. `CROMBOLO_INTEGRATION_DB`
 * chooses it: SQLite files by default, or on Postgres a database of its own for each
 * site, made from `CROMBOLO_POSTGRES_URL`'s server and dropped afterwards.
 */
import { join } from 'node:path'

export const INTEGRATION_DIALECT: 'sqlite' | 'postgres' =
  Bun.env.CROMBOLO_INTEGRATION_DB === 'postgres' ? 'postgres' : 'sqlite'

export const onPostgres = INTEGRATION_DIALECT === 'postgres'

export interface SiteDatabase {
  /** What a site's process is given to reach it. */
  env: Record<string, string>
  /** A Postgres database's address, or a SQLite file's path. */
  where: string
  drop(): Promise<void>
}

const made: SiteDatabase[] = []

function serverUrl(): string {
  const url = Bun.env.CROMBOLO_POSTGRES_URL
  if (!url) throw new Error('CROMBOLO_INTEGRATION_DB=postgres needs CROMBOLO_POSTGRES_URL.')
  return url
}

async function admin<T>(work: (sql: InstanceType<typeof Bun.SQL>) => Promise<T>): Promise<T> {
  const sql = new Bun.SQL({ url: serverUrl(), max: 1 })
  try {
    return await work(sql)
  } finally {
    await sql.close()
  }
}

/** A database for one site: `<dir>/<name>.sqlite`, or a fresh Postgres database. */
export async function siteDatabase(dir: string, name: string): Promise<SiteDatabase> {
  if (!onPostgres) {
    const file = join(dir, `${name}.sqlite`)
    return {
      env: { CROMBOLO_DB: 'sqlite', CROMBOLO_SQLITE_FILE: file },
      where: file,
      drop: async () => {},
    }
  }
  const database = `it_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`
  await admin((sql) => sql.unsafe(`CREATE DATABASE ${database}`))
  const url = new URL(serverUrl())
  url.pathname = `/${database}`
  const site: SiteDatabase = {
    env: { CROMBOLO_DB: 'postgres', CROMBOLO_POSTGRES_URL: url.toString() },
    where: url.toString(),
    drop: () =>
      admin((sql) => sql.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)).then(() => {}),
  }
  made.push(site)
  return site
}

/**
 * A second site's database, begun as a copy of `from`'s, as copying the site's folder
 * copies its SQLite file. Nothing may be connected to `from` meanwhile.
 */
export async function copySiteDatabase(from: SiteDatabase, name: string): Promise<SiteDatabase> {
  if (!onPostgres) throw new Error('A SQLite site is copied with its folder.')
  const database = `it_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${crypto.randomUUID().slice(0, 8)}`
  const source = new URL(from.where).pathname.slice(1)
  await admin((sql) => sql.unsafe(`CREATE DATABASE ${database} TEMPLATE ${source}`))
  const url = new URL(serverUrl())
  url.pathname = `/${database}`
  const site: SiteDatabase = {
    env: { CROMBOLO_DB: 'postgres', CROMBOLO_POSTGRES_URL: url.toString() },
    where: url.toString(),
    drop: () =>
      admin((sql) => sql.unsafe(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`)).then(() => {}),
  }
  made.push(site)
  return site
}

/** What a site's process is given: its Postgres database, or nothing for the site's own file. */
export const postgresEnv = (database: SiteDatabase | undefined): Record<string, string> =>
  onPostgres && database ? database.env : {}

/** Drops every database this file made, for its `afterAll`. */
export async function dropSiteDatabases(): Promise<void> {
  while (made.length > 0)
    await made
      .pop()
      ?.drop()
      .catch(() => {})
}
