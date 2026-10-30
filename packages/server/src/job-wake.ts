/**
 * Where the background jobs run (story 223): on an owning node unless it is
 * told to leave them (`CROMBOLO_JOBS=off`), and on a worker always. A node that
 * leaves them wakes the worker over `NOTIFY` when a write leaves it work.
 */
import { type Db, JOBS_CHANNEL, type JobWake } from '@crombolo/data'
import type { CromboloConfig } from './config.ts'

export function runsJobs(config: Pick<CromboloConfig, 'role' | 'runJobs'>): boolean {
  if (config.role === 'worker') return true
  return config.role !== 'web' && config.runJobs
}

/** Calls `onWork` for each wake a writer sends; resolves to the way to stop listening. */
export async function listenForJobs(
  db: Db,
  onWork: (work: JobWake) => void,
): Promise<(() => Promise<void>) | undefined> {
  if (!db.listen) return undefined
  return db.listen(JOBS_CHANNEL, (payload) => {
    if (payload === 'events' || payload === 'search' || payload === 'jobs') onWork(payload)
  })
}
