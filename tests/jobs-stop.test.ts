/**
 * Stopping the background jobs waits for a run already going, so a server that
 * closes its database next never takes it from under a job. Closing without
 * waiting left a job's row locks behind, which deadlocked the next user of the
 * database (a Postgres CI run, v0.30.1).
 */
import { expect, test } from 'bun:test'
import { connect } from '@crombolo/data'
import { createBackgroundJobs } from '@crombolo/server'

test('stop waits for a run in progress, and starts no more', async () => {
  const db = await connect({ dialect: 'sqlite', file: ':memory:' })
  const runs: string[] = []
  const jobs = createBackgroundJobs({
    db,
    cache: undefined as never,
    operations: undefined as never,
    nodeState: { version: '1.0.0', revision: '0' },
    nodeId: 'node',
    versionCleanup: {
      enabled: false,
      keepAllVersionsNewerThanDays: 0,
      keepLatestVersionPerDayForDays: 0,
    },
    scheduledPublishingMs: 3_600_000,
    searchIndexingMs: 3_600_000,
    webhooksMs: 10,
    webhooks: {
      runDue: async () => {
        runs.push('started')
        await Bun.sleep(80)
        runs.push('finished')
        return { claimed: 0, done: 0, retrying: 0, failed: 0 }
      },
    },
  })
  jobs.start()
  await Bun.sleep(30)
  expect(runs).toEqual(['started'])
  await jobs.stop()
  expect(runs).toEqual(['started', 'finished'])
  await Bun.sleep(40)
  expect(runs).toEqual(['started', 'finished'])
  await db.close()
})
