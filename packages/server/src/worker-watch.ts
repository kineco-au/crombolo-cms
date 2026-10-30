/**
 * Whether anything is running the jobs a node left to a worker (story 223,
 * decision 4). Work queues safely while none is; this says so, in `/health`,
 * on the Background jobs screen and once in the log, and drains nothing.
 */
import { type Db, liveNodes } from '@crombolo/data'
import type { CromboloConfig } from './config.ts'
import { runsJobs } from './job-wake.ts'
import { logger } from './logging.ts'

/** A worker not seen in `server` for this long is not running. */
export const WORKER_GONE_AFTER_MS = 5 * 60_000

export interface JobsStatus {
  /** Whether this node runs the jobs itself. */
  here: boolean
  /** A live worker's node id, when this node leaves its jobs to one. */
  worker: string | null
  /** Since when no worker has been seen; null while one is, or where jobs run here. */
  waitingSince: string | null
}

export interface WorkerWatch {
  status(): JobsStatus
  /** Looks for a live worker now; the timer calls this too. */
  check(): Promise<JobsStatus>
  start(): void
  stop(): void
}

export function createWorkerWatch(options: {
  db: Db
  config: Pick<CromboloConfig, 'role' | 'runJobs'>
  intervalMs?: number
  now?: () => Date
}): WorkerWatch {
  const here = runsJobs(options.config)
  const now = options.now ?? (() => new Date())
  const log = logger('jobs')
  let status: JobsStatus = { here, worker: null, waitingSince: null }
  let timer: ReturnType<typeof setInterval> | undefined
  const watch: WorkerWatch = {
    status: () => status,
    async check() {
      if (here) return status
      const workers = (await liveNodes(options.db, { seenWithinMs: WORKER_GONE_AFTER_MS })).filter(
        (node) => node.role === 'worker',
      )
      const worker = workers[0]?.nodeId ?? null
      if (!worker && !status.waitingSince)
        log.warning(
          'Background work is waiting: this node leaves its jobs to a worker, and none has been seen for five minutes',
        )
      status = {
        here,
        worker,
        waitingSince: worker ? null : (status.waitingSince ?? now().toISOString()),
      }
      return status
    },
    start() {
      if (here || timer) return
      void watch.check().catch(() => {})
      timer = setInterval(() => void watch.check().catch(() => {}), options.intervalMs ?? 60_000)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
  return watch
}
