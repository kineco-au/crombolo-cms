/**
 * The outbox dispatcher (story 171): turns each recorded content event into
 * webhook deliveries and content notifications, and marks it dispatched in the
 * same transaction. A crash anywhere repeats the step; the queues' unique keys
 * absorb the repeat. An event that keeps failing is kept as failed, for
 * `crombolo events retry`.
 */
import { ContentEventRepository, type Db } from '@crombolo/data'
import type { ContentNotifier, NotificationFacts } from './content-notifications.ts'
import { retryAfter, type WorkflowRunReport } from './form-workflows.ts'
import { logger } from './logging.ts'
import type { WebhookFacts, WebhookService } from './webhooks.ts'

const log = logger('Events')

/** An event a node took and never finished is retried after this long: that node died. */
export const EVENT_STALE_AFTER_MS = 15 * 60_000

export interface ContentDispatcherOptions {
  db: Db
  webhooks?: Pick<WebhookService, 'enqueueFor'>
  notifier?: Pick<ContentNotifier, 'enqueueFor'>
}

export interface ContentDispatcher {
  runDue(now?: Date, limit?: number): Promise<WorkflowRunReport>
  /** Dispatches soon, once, however many changes ask: a commit just left work. */
  nudge(): void
  /** Resolves when a nudged run has finished: for tests and an orderly shutdown. */
  settled(): Promise<void>
}

export function createContentDispatcher(options: ContentDispatcherOptions): ContentDispatcher {
  const events = new ContentEventRepository(options.db)
  let running: Promise<unknown> | undefined
  let again = false

  const runDue = async (at = new Date(), limit = 50): Promise<WorkflowRunReport> => {
    const report: WorkflowRunReport = { claimed: 0, done: 0, retrying: 0, failed: 0 }
    await events.releaseStale(new Date(at.getTime() - EVENT_STALE_AFTER_MS))
    for (const id of await events.due(at, limit)) {
      const event = await events.claim(id)
      if (!event) continue
      report.claimed++
      try {
        await options.db.transaction(async (tx) => {
          const webhook = event.facts.webhook as WebhookFacts | undefined
          const notification = event.facts.notification as NotificationFacts | undefined
          if (webhook) await options.webhooks?.enqueueFor(tx, event.id, webhook)
          if (notification) await options.notifier?.enqueueFor(tx, event.id, notification)
          await new ContentEventRepository(tx).dispatched(event.id)
        })
        report.done++
      } catch (error) {
        const again = retryAfter(event.attempts, at)
        await events.fail(event.id, error instanceof Error ? error.message : String(error), again)
        if (again) report.retrying++
        else report.failed++
        log.warning('Could not dispatch the {kind} event {id}: {error}', {
          kind: event.kind,
          id: event.id,
          error,
        })
      }
    }
    return report
  }

  const nudge = () => {
    if (running) {
      again = true
      return
    }
    running = (async () => {
      do {
        again = false
        await runDue().catch((error: unknown) =>
          log.error('The event dispatcher stopped: {error}', { error }),
        )
      } while (again)
    })().finally(() => {
      running = undefined
    })
  }

  return { runDue, nudge, settled: async () => void (await running) }
}
