/**
 * Background jobs, as Umbraco runs them: scheduled publishing every minute and
 * version cleanup every hour when it is enabled, plus the search indexer
 * draining its queue, the audit log ageing out old entries hourly, and the
 * form, webhook and content notification queues. Each run can also be called
 * directly, which is how tests drive them. Every node that owns writes (`all`
 * and `api`) runs them; each schedule and queued item is claimed atomically, so
 * it runs once.
 */

import { type DocumentOperations, systemActor } from '@crombolo/content'
import type { NodeSchemaState } from '@crombolo/data'
import {
  AuditLog,
  ContentEventRepository,
  type Db,
  DocumentRepository,
  ExtensionActivityLog,
  pruneCacheInstructions,
  SearchIndex,
  WebhookDeliveryRepository,
} from '@crombolo/data'
import type { PublishedCache } from '@crombolo/render'
import { auditRetainedSince } from './adapters/audit.ts'
import { createElementPort } from './adapters/elements.ts'
import type { Approvals } from './approvals.ts'
import type { ContentDispatcher } from './content-dispatch.ts'
import type {
  ContentNotificationRunner,
  ContentNotificationRunReport,
} from './content-notifications.ts'
import type { WorkflowRunner, WorkflowRunReport } from './form-workflows.ts'
import { logger } from './logging.ts'
import type { MediaFileStore } from './media-files.ts'
import { tracedJob } from './telemetry.ts'
import type { WebhookService } from './webhooks.ts'

/** The most rows of activity kept for one extension, oldest deleted first (story 327). */
export const ACTIVITY_CAP = 100_000

export interface JobsOptions {
  db: Db
  cache: PublishedCache
  nodeState: NodeSchemaState
  nodeId: string
  /** Told about each document a job changed, for the server event hub. */
  onDocumentChanged?: (key: string) => void
  scheduledPublishingMs?: number
  versionCleanup: {
    enabled: boolean
    keepAllVersionsNewerThanDays: number
    keepLatestVersionPerDayForDays: number
  }
  /** Temporary uploads past their lifetime are dropped hourly. */
  mediaFiles?: MediaFileStore
  /**
   * Drains the form workflow queue. Absent on a node that should not run them,
   * which is the same rule the other jobs follow.
   */
  formWorkflows?: WorkflowRunner
  formWorkflowsMs?: number
  /** Drains the delivery queue. */
  webhooks?: Pick<WebhookService, 'runDue'>
  webhooksMs?: number
  /** Turns recorded content events into deliveries and notifications (story 171). */
  dispatcher?: ContentDispatcher
  dispatcherMs?: number
  /** Days delivered webhooks, their log and dispatched events are kept; failed work stays. */
  eventRetentionDays?: number
  /** How often the search indexer looks for queued items; a write here also starts it at once. */
  searchIndexingMs?: number
  /** Days the audit log keeps an entry; 0 or absent keeps them forever. */
  auditRetentionDays?: number
  /** How many days extension activity is kept (story 327); 0 keeps none. */
  extensionActivityDays?: number
  /** Content notifications (story 045): queued by changes, sent here. Absent without e-mail. */
  contentNotifications?: ContentNotificationRunner
  contentNotificationsMs?: number
  /** Told what scheduled publishing did, for the approval requests waiting on it (story 029). */
  approvals?: Pick<Approvals, 'scheduleFired' | 'sweepScheduled'>
  /**
   * Publishes what a schedule says, as the site (story 170): recorded, tracked and
   * announced as an editor's publish is.
   */
  operations: DocumentOperations
}

/** A delivery a node took and never finished is retried after this long: that node died. */
export const WEBHOOK_STALE_AFTER_MS = 15 * 60_000

export interface ScheduledRun {
  published: string[]
  unpublished: string[]
  failed: Array<{ key: string; reason: string }>
}

export interface BackgroundJobs {
  runScheduledPublishing(now?: Date): Promise<ScheduledRun>
  /** Runs the form workflows that are due; a no-op when none are configured. */
  runFormWorkflows(now?: Date): Promise<WorkflowRunReport>
  /** Delivers the webhook and bundle events that are due. */
  runWebhooks(now?: Date): Promise<WorkflowRunReport>
  /** Dispatches the content events waiting in the outbox (story 171). */
  runEvents(now?: Date): Promise<WorkflowRunReport>
  /** Releases claims left by a node that died, and prunes delivered work. */
  runQueueUpkeep(now?: Date): Promise<void>
  /** Sends the content notifications that are due (story 045). */
  runContentNotifications(now?: Date): Promise<ContentNotificationRunReport>
  /** Indexes every queued item, and returns how many. docs/search.md. */
  runSearchIndexing(): Promise<number>
  /** Something was queued here: index it shortly, rather than at the next tick. */
  kickSearchIndexing(): void
  /** Deletes audit entries older than the retention period, and returns how many. */
  runAuditRetention(now?: Date): Promise<number>
  /** Deletes extension activity older than the window, and past each extension's cap (story 327). */
  runActivityRetention(now?: Date): Promise<number>
  /** Runs whether or not the hourly job is enabled; the policy decides what goes. */
  runVersionCleanup(now?: Date): Promise<{ nodes: number; versionsDeleted: number }>
  start(): void
  /**
   * Disarms the timers, then waits for a run already going to finish, so a
   * server closing next never takes the database from under it.
   */
  stop(): Promise<void>
  /** Whether the timers are armed; false on a node whose role is not to run them. */
  started(): boolean
}

export function createBackgroundJobs(options: JobsOptions): BackgroundJobs {
  const documents = new DocumentRepository(options.db, {
    nodeState: options.nodeState,
    nodeId: options.nodeId,
  })
  const elementRows = new DocumentRepository(options.db, {
    nodeState: options.nodeState,
    nodeId: options.nodeId,
    kind: 'element',
  })
  const elements = createElementPort(options.db, {
    nodeState: options.nodeState,
    nodeId: options.nodeId,
    onChange: () => options.cache.invalidate(),
  })
  const timers: Array<ReturnType<typeof setInterval>> = []
  const search = new SearchIndex(options.db)
  let indexing: Promise<number> | undefined
  let kicked: ReturnType<typeof setTimeout> | undefined
  /** Runs the timers started and have not finished, for `stop` to wait on. */
  const inFlight = new Set<Promise<unknown>>()
  const tracked = <T>(run: Promise<T>): Promise<T> => {
    inFlight.add(run)
    void run.finally(() => inFlight.delete(run)).catch(() => {})
    return run
  }

  async function runScheduledPublishingUntraced(now = new Date()): Promise<ScheduledRun> {
    const run: ScheduledRun = { published: [], unpublished: [], failed: [] }
    for (const due of await documents.dueSchedules(now)) {
      if (!(await documents.claimSchedule(due.id))) continue
      const cultures = due.culture ? [due.culture] : null
      const release = due.action === 'Release'
      const actor = systemActor('The schedule', {
        note: `scheduled${due.culture ? ` (${due.culture})` : ''}`,
      })
      const result = release
        ? await options.operations.publish(actor, due.key, { cultures })
        : await options.operations.unpublish(actor, due.key, cultures)
      if (result.ok) (release ? run.published : run.unpublished).push(due.key)
      else run.failed.push({ key: due.key, reason: result.reason })
      await options.approvals?.scheduleFired(
        due.key,
        due.culture,
        due.action,
        result.ok ? { ok: true } : { ok: false, reason: result.reason },
      )
    }
    // Library elements: no approvals and no redirects, so the port publishes them directly.
    for (const due of await elementRows.dueSchedules(now)) {
      if (!(await elementRows.claimSchedule(due.id))) continue
      const cultures = due.culture ? [due.culture] : null
      const result =
        due.action === 'Release'
          ? await elements.publish(due.key, cultures)
          : await elements.unpublish(due.key, cultures)
      if (result.ok) (due.action === 'Release' ? run.published : run.unpublished).push(due.key)
      else run.failed.push({ key: due.key, reason: result.reason })
    }
    await options.approvals?.sweepScheduled(now.getTime())
    // The operations recorded, announced and refreshed what they did themselves.
    return run
  }

  async function runEventsUntraced(now?: Date): Promise<WorkflowRunReport> {
    // A run a commit already started finishes first, so this sees what it left.
    await options.dispatcher?.settled()
    return (
      (await options.dispatcher?.runDue(notBefore(now))) ?? {
        claimed: 0,
        done: 0,
        retrying: 0,
        failed: 0,
      }
    )
  }

  /**
   * Hourly: claims left by a node that died go back in their queues, and what
   * was delivered long enough ago goes (story 171). Failed work stays until
   * someone retries it.
   */
  async function runQueueUpkeep(now = new Date()): Promise<void> {
    const staleBefore = new Date(now.getTime() - WEBHOOK_STALE_AFTER_MS)
    const deliveries = new WebhookDeliveryRepository(options.db)
    await deliveries.releaseStale(staleBefore)
    const days = options.eventRetentionDays ?? 30
    if (days > 0) {
      const before = new Date(now.getTime() - days * 86_400_000)
      await deliveries.prune(before)
      await new ContentEventRepository(options.db).prune(before)
    }
    // Every node starts from the newest instruction at boot, so a day's history is plenty.
    await pruneCacheInstructions(options.db, new Date(now.getTime() - 86_400_000))
  }

  async function runContentNotificationsUntraced(
    now = new Date(),
  ): Promise<ContentNotificationRunReport> {
    // What is waiting in the outbox is queued first, so it goes in this run.
    await runEvents(now)
    const runner = options.contentNotifications
    return runner ? runner.runDue(now) : { claimed: 0, sent: 0, skipped: 0, retrying: 0, failed: 0 }
  }

  async function runAuditRetentionUntraced(now = new Date()): Promise<number> {
    const before = auditRetainedSince(options.auditRetentionDays ?? 0, now)
    return before ? new AuditLog(options.db).prune(before) : 0
  }

  async function runActivityRetentionUntraced(now = new Date()): Promise<number> {
    const store = new ExtensionActivityLog(options.db)
    const days = options.extensionActivityDays ?? 14
    // Nothing kept is everything older than now.
    let removed = await store.prune(new Date(now.getTime() - days * 86_400_000))
    for (const id of await store.extensions()) removed += await store.cap(id, ACTIVITY_CAP)
    return removed
  }

  async function runVersionCleanupUntraced(now = new Date()) {
    return documents.cleanupVersions(now, options.versionCleanup)
  }

  /** The later of the time asked for and now: what was queued a moment ago is due too. */
  const notBefore = (asked: Date | undefined) =>
    new Date(Math.max(asked?.getTime() ?? 0, Date.now()))

  async function runWebhooksUntraced(now?: Date): Promise<WorkflowRunReport> {
    await runEvents(now)
    return (
      (await options.webhooks?.runDue(notBefore(now))) ?? {
        claimed: 0,
        done: 0,
        retrying: 0,
        failed: 0,
      }
    )
  }

  async function runFormWorkflowsUntraced(now = new Date()): Promise<WorkflowRunReport> {
    return (
      (await options.formWorkflows?.runDue(now)) ?? {
        claimed: 0,
        done: 0,
        retrying: 0,
        failed: 0,
      }
    )
  }

  // Its own guard rather than `guarded`: indexing a big rebuild must not hold up
  // a scheduled publish, and a kick while it runs joins the run in progress.
  function runSearchIndexing(): Promise<number> {
    indexing ??= search.indexAll().finally(() => {
      indexing = undefined
    })
    return indexing
  }

  const indexQuietly = () =>
    tracked(runSearchIndexing()).catch((error: unknown) => {
      logger('jobs').error('Search indexing failed', { error })
    })

  // One guard per job: a slow webhook run skips its own next tick, never a
  // scheduled publish's.
  const guarded = (job: () => Promise<unknown>) => {
    let running = false
    return async () => {
      if (running) return
      running = true
      try {
        await tracked(job())
      } catch (error) {
        logger('jobs').error('A background job failed', { error })
      } finally {
        running = false
      }
    }
  }

  const every = (ms: number, job: () => Promise<unknown>) => {
    const timer = setInterval(guarded(job), ms)
    timer.unref()
    timers.push(timer)
  }

  // Story 262: each run a span and a count, on the role that ran it. The search
  // indexing tick and the queue's upkeep, every few seconds whether or not there
  // is work, are left out, so a quiet site sends nothing.
  const runScheduledPublishing = tracedJob('scheduled publishing', runScheduledPublishingUntraced)
  const runEvents = tracedJob('events', runEventsUntraced)
  const runContentNotifications = tracedJob(
    'content notifications',
    runContentNotificationsUntraced,
  )
  const runAuditRetention = tracedJob('audit retention', runAuditRetentionUntraced)
  const runActivityRetention = tracedJob(
    'extension activity retention',
    runActivityRetentionUntraced,
  )
  const runVersionCleanup = tracedJob('version cleanup', runVersionCleanupUntraced)
  const runWebhooks = tracedJob('webhooks', runWebhooksUntraced)
  const runFormWorkflows = tracedJob('form workflows', runFormWorkflowsUntraced)

  return {
    runScheduledPublishing,
    runVersionCleanup,
    runAuditRetention,
    runActivityRetention,
    runFormWorkflows,
    runWebhooks,
    runEvents,
    runQueueUpkeep,
    runContentNotifications,
    runSearchIndexing,
    kickSearchIndexing() {
      if (timers.length === 0 || kicked) return
      kicked = setTimeout(() => {
        kicked = undefined
        void indexQuietly()
      }, 250)
      kicked.unref()
    },
    start() {
      every(options.scheduledPublishingMs ?? 60_000, runScheduledPublishing)
      // The queue is shared, so this also picks up what other nodes wrote.
      const searchTimer = setInterval(indexQuietly, options.searchIndexingMs ?? 5_000)
      searchTimer.unref()
      timers.push(searchTimer)
      // More often than the other jobs: somebody waiting on a form notification
      // notices a minute, and a queue row is cheap to look for.
      if (options.formWorkflows) every(options.formWorkflowsMs ?? 15_000, runFormWorkflows)
      // As often, for the same reason: a receiver that is waiting notices a minute.
      if (options.webhooks) every(options.webhooksMs ?? 15_000, runWebhooks)
      // A commit nudges the dispatcher at once; this picks up what another node,
      // the command line or a crash left behind.
      if (options.dispatcher) every(options.dispatcherMs ?? 15_000, runEvents)
      every(60 * 60_000, runQueueUpkeep)
      // A digest waits a minute anyway; this is how soon after that it goes.
      const notifications = options.contentNotifications
      if (notifications) {
        every(options.contentNotificationsMs ?? 15_000, runContentNotifications)
        every(60 * 60_000, () => notifications.prune(new Date(Date.now() - 30 * 86_400_000)))
      }
      if (options.versionCleanup.enabled) every(60 * 60_000, runVersionCleanup)
      if (options.auditRetentionDays) every(60 * 60_000, runAuditRetention)
      every(60 * 60_000, runActivityRetention)
      const files = options.mediaFiles
      if (files) every(60 * 60_000, () => files.cleanupExpired())
    },
    async stop() {
      for (const timer of timers.splice(0)) clearInterval(timer)
      if (kicked) clearTimeout(kicked)
      kicked = undefined
      await Promise.allSettled([...inFlight])
    },
    started() {
      return timers.length > 0
    },
  }
}
