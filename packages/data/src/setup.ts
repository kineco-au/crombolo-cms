/**
 * Whether a site still waits for its owner to set it up from the browser. Kept
 * in the database, not in memory, so a restart can never reopen it.
 */
import type { Db } from './database.ts'
import { Locks } from './locks.ts'
import { now } from './query.ts'
import { insertSuperUser, type SeedAdmin, type SeedOptions } from './schema/seed.ts'

export const SETUP_STATE_KEY = 'crombolo:setup'

/** `none` is every database set up before this existed, or seeded with an administrator. */
export type SetupState = 'pending' | 'complete' | 'none'

export async function readSetupState(db: Db): Promise<SetupState> {
  const row = await db.q
    .selectFrom('key_value')
    .select('value')
    .where('key', '=', SETUP_STATE_KEY)
    .executeTakeFirst()
  const value = row?.value
  return value === 'pending' || value === 'complete' ? value : 'none'
}

async function writeSetupState(db: Db, state: 'pending' | 'complete'): Promise<void> {
  const updated = await db.q
    .updateTable('key_value')
    .set({ value: state, update_date: now(db) })
    .where('key', '=', SETUP_STATE_KEY)
    .returning('key')
    .execute()
  if (updated.length === 0)
    await db.q
      .insertInto('key_value')
      .values({ key: SETUP_STATE_KEY, value: state, update_date: now(db) })
      .execute()
}

/** Opens setup on a database that has just been created with no administrator. */
export function markSetupPending(db: Db): Promise<void> {
  return writeSetupState(db, 'pending')
}

/**
 * Creates the administrator and closes setup for good, or answers `closed` when
 * it was already done. Under a lock, so two attempts at once cannot both win.
 */
export function completeSetup(
  db: Db,
  admin: SeedAdmin,
  options: Pick<SeedOptions, 'hashPassword' | 'passwordConfig'>,
): Promise<'created' | 'closed'> {
  return db.locks.withLock(Locks.KeyValues, () =>
    db.transaction(async (tx) => {
      if ((await readSetupState(tx)) !== 'pending') return 'closed'
      await insertSuperUser(tx, { ...options, admin })
      await writeSetupState(tx, 'complete')
      return 'created'
    }),
  )
}

/**
 * Closes setup without creating an administrator: a machine can administer the
 * site instead (story 034's seeded API client). Answers whether it was pending.
 */
export function closeSetup(db: Db): Promise<boolean> {
  return db.locks.withLock(Locks.KeyValues, () =>
    db.transaction(async (tx) => {
      if ((await readSetupState(tx)) !== 'pending') return false
      await writeSetupState(tx, 'complete')
      return true
    }),
  )
}
