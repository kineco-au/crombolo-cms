/**
 * The committed types of crombolo's tables match what the migrations make on
 * both engines (story 221). Postgres runs only in the dialect suite, so the
 * check runs there, with a SQLite database beside it.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { generateTableTypes, TABLES_FILE } from '../scripts/db-types.ts'
import { dialectUnderTest } from './support/db.ts'

const url = Bun.env.CROMBOLO_POSTGRES_URL ?? Bun.env.DATABASE_URL

describe.skipIf(dialectUnderTest !== 'postgres' || !url)('the table types', () => {
  test(`${TABLES_FILE} is what \`bun run db:types\` writes today`, async () => {
    const committed = readFileSync(TABLES_FILE, 'utf8')
    const generated = await generateTableTypes(url as string)
    if (committed !== generated) {
      const a = committed.split('\n')
      const b = generated.split('\n')
      const at = b.findIndex((line, i) => line !== a[i])
      throw new Error(
        `${TABLES_FILE} is out of date from line ${at + 1} (\`${b[at]}\`). ` +
          'Run `docker compose run --rm cms-test bun run db:types`.',
      )
    }
    expect(committed).toBe(generated)
  }, 60_000)
})
