/**
 * Where document operations announce what they did (story 170): the audit log,
 * webhooks, the people subscribed to a page, and — on a server — the live
 * backoffice. The command line wires the same sink without the live part, so a
 * change records and raises the same things wherever it was started.
 */
import {
  actorName,
  actorNote,
  actorUserKey,
  auditEntryFor,
  type EventSink,
  liveEventsFor,
  notificationFor,
  webhookFor,
} from '@crombolo/content'
import { AuditLog, type Db } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import type { ContentNotifier } from './content-notifications.ts'
import { logger } from './logging.ts'
import type { WebhookService } from './webhooks.ts'

const log = logger('Content')

export interface ContentEventSinkOptions {
  db: Db
  webhooks?: Pick<WebhookService, 'raise'>
  notifier?: Pick<ContentNotifier, 'raise'>
  /** Tells an open backoffice what changed: a server's event hub; absent on the command line. */
  live?(event: ReturnType<typeof liveEventsFor>[number]): void
}

export function createContentEventSink(options: ContentEventSinkOptions): EventSink {
  const audit = new AuditLog(options.db)
  const nameOf = async (entityType: string, key: string) => {
    try {
      return await audit.describe(entityType, key)
    } catch {
      return { entityType, entityKey: key, entityName: null }
    }
  }
  return {
    async emit(event, actor) {
      const entry = auditEntryFor(event, actor)
      // A deleted page cannot be named after it went: the operation read its name first.
      const subject =
        event.type === 'deleted'
          ? { entityType: entry.entityType, entityKey: event.key, entityName: event.name }
          : entry.entityKey
            ? await nameOf(entry.entityType, entry.entityKey)
            : undefined
      await recordAudit(options.db, {
        ...entry,
        entityType: subject?.entityType ?? entry.entityType,
        entityKey: subject?.entityKey ?? entry.entityKey,
        entityName: subject?.entityName ?? null,
      })
      // Queued and sent after: a slow receiver or an e-mail never holds the change up.
      const hook = webhookFor(event)
      if (hook)
        void options.webhooks
          ?.raise(hook)
          .catch((error: unknown) =>
            log.error('Could not queue the {alias} webhook: {error}', { alias: hook.alias, error }),
          )
      const change = notificationFor(event)
      if (change)
        void options.notifier
          ?.raise(change, { key: actorUserKey(actor), name: actorName(actor) }, actorNote(actor))
          .catch((error: unknown) =>
            log.error('Could not queue change notifications: {error}', { error }),
          )
      for (const live of liveEventsFor(event)) options.live?.(live)
    },
  }
}
