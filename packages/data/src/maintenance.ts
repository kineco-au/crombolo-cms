/**
 * A cluster-wide pause on editing, held in `key_value` so every node sees it on
 * its next write rather than its next poll. Readers are never affected; the
 * write gate (`assertNodeMayWrite`) refuses editor writes while it is set.
 * Story 409: a pause may carry when it ends; past that, by the reading node's own
 * clock, it is no pause, so nothing has to run for it to end.
 */
import type { Db } from './database.ts'
import { readKeyValue, writeKeyValue } from './migrations.ts'

export const WRITES_PAUSED_KEY = 'Crombolo.Operations.WritesPaused'

export interface WritesPaused {
  reason: string
  by: string | null
  at: string
  /** When it ends, as an ISO time; null for a pause that lasts until resumed. */
  until: string | null
}

/** Whether a pause read back is over by now: it had an end, and that has passed. Pure. */
export const pauseEnded = (paused: { until: string | null }, now = new Date()): boolean =>
  paused.until !== null && Date.parse(paused.until) <= now.getTime()

/** The pause a stored value holds, or undefined for none, or one whose time has passed. */
export function parseWritesPaused(
  value: string | null | undefined,
  now = new Date(),
): WritesPaused | undefined {
  if (!value) return undefined
  let paused: WritesPaused
  try {
    const parsed = JSON.parse(value) as Partial<WritesPaused>
    paused = {
      reason: String(parsed.reason ?? ''),
      by: parsed.by ?? null,
      at: String(parsed.at ?? ''),
      // A pause stored before story 409 has no end: it lasts until resumed.
      until: typeof parsed.until === 'string' && parsed.until ? parsed.until : null,
    }
  } catch {
    return { reason: '', by: null, at: '', until: null }
  }
  return pauseEnded(paused, now) ? undefined : paused
}

export async function readWritesPaused(
  db: Db,
  now = new Date(),
): Promise<WritesPaused | undefined> {
  return parseWritesPaused(await readKeyValue(db, WRITES_PAUSED_KEY), now)
}

/**
 * Pauses editing, until `until` or until resumed. Pausing again for the same reason keeps
 * who paused and when, and moves the end; another reason replaces the pause.
 */
export async function pauseWrites(
  db: Db,
  options: { reason: string; by?: string | null; until?: Date | null },
  now = new Date(),
): Promise<WritesPaused> {
  const before = await readWritesPaused(db, now)
  const same = before !== undefined && before.reason === options.reason
  const paused: WritesPaused = {
    reason: options.reason,
    by: same ? before.by : (options.by ?? null),
    at: same ? before.at : now.toISOString(),
    until: options.until ? options.until.toISOString() : null,
  }
  await writeKeyValue(db, WRITES_PAUSED_KEY, JSON.stringify(paused))
  return paused
}

/** An empty value rather than a deleted row, so the key keeps its history in `update_date`. */
export async function resumeWrites(db: Db): Promise<void> {
  await writeKeyValue(db, WRITES_PAUSED_KEY, '')
}
