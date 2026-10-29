/**
 * `bun run db:types`: migrates a fresh SQLite and a fresh Postgres database
 * and writes the types of crombolo's tables from them (story 221). Needs
 * Postgres, so it runs in the test container:
 * `docker compose run --rm cms-test bun run db:types`.
 */
import { connect, cromboloPlan, migrate, tableTypes } from '@crombolo/data'

export const TABLES_FILE = 'packages/data/src/tables.gen.ts'

/** The generated file's text, from databases made and dropped for the purpose. */
export async function generateTableTypes(baseUrl: string): Promise<string> {
  const { SQL } = await import('bun')
  const url = new URL(baseUrl)
  const name = `crombolo_types_${crypto.randomUUID().slice(0, 8)}`
  const admin = new SQL({ url: baseUrl, max: 1 })
  await admin.unsafe(`CREATE DATABASE "${name}"`)
  url.pathname = `/${name}`
  const postgres = await connect({ dialect: 'postgres', url: url.toString() })
  const sqlite = await connect({ dialect: 'sqlite', file: ':memory:' })
  try {
    await migrate(sqlite, cromboloPlan)
    await migrate(postgres, cromboloPlan)
    return await tableTypes(sqlite, postgres)
  } finally {
    await sqlite.close()
    await postgres.close()
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.close()
  }
}

if (import.meta.main) {
  const base = Bun.env.CROMBOLO_POSTGRES_URL ?? Bun.env.DATABASE_URL
  if (!base) {
    console.error('Set CROMBOLO_POSTGRES_URL, or run it in the test container.')
    process.exit(1)
  }
  await Bun.write(TABLES_FILE, await generateTableTypes(base))
  console.log(`Wrote ${TABLES_FILE}`)
}
