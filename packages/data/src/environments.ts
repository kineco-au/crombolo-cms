/**
 * The environments a site's values may vary for (story 387): the copies of the site
 * that exist, as `[environments] names` in `schema/schema.toml` lists them. Synced
 * with the schema, so every copy edits the same set. docs/environments.md.
 */
import type { Db } from './database.ts'
import { now } from './query.ts'

export const ENVIRONMENTS_KEY = 'crombolo:environments'

/** The environments the schema names, in its order; none when it names none. */
export async function readEnvironments(db: Db): Promise<string[]> {
  const rows = await db.q
    .selectFrom('key_value')
    .select('value')
    .where('key', '=', ENVIRONMENTS_KEY)
    .execute()
  try {
    const parsed = JSON.parse(String(rows[0]?.value ?? '[]')) as unknown
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

/** Stores the list; answers what it was before. */
export async function writeEnvironments(db: Db, names: readonly string[]): Promise<string[]> {
  return db.transaction(async (tx) => {
    const before = await readEnvironments(tx)
    const value = JSON.stringify([...names])
    const updated = await tx.q
      .updateTable('key_value')
      .set({ value, update_date: now(tx) })
      .where('key', '=', ENVIRONMENTS_KEY)
      .returning('key')
      .execute()
    if (updated.length === 0)
      await tx.q
        .insertInto('key_value')
        .values({ key: ENVIRONMENTS_KEY, value, update_date: now(tx) })
        .execute()
    return before
  })
}
