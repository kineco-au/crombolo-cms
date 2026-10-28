/**
 * Where document operations record what they did (stories 170 and 171). Inside
 * the change's own transaction: its audit entry, and — when anyone may hear of
 * it — an outbox event holding the facts as they were. After the commit: the
 * live backoffice, and a nudge so the dispatcher sends it now rather than at
 * its next tick. The command line wires the same sink without the live part.
 */
import {
  actorMemberKey,
  actorName,
  actorNote,
  actorUserKey,
  auditEntryFor,
  type DocumentEvent,
  type EventSink,
  liveEventsFor,
  type MediaActor,
  type MediaEventSink,
  mediaAuditEntryFor,
  mediaWebhookFor,
  notificationFor,
  webhookFor,
} from '@crombolo/content'
import { AuditLog, ContentEventRepository, type Db } from '@crombolo/data'
import type { ContentNotifier } from './content-notifications.ts'
import type { WebhookService } from './webhooks.ts'

export interface ContentEventSinkOptions {
  webhooks?: Pick<WebhookService, 'factsFor'>
  notifier?: Pick<ContentNotifier, 'factsFor'>
  /** Tells an open backoffice what changed: a server's event hub; absent on the command line. */
  live?(event: ReturnType<typeof liveEventsFor>[number]): void
  /** Called after a commit that left work in the outbox. */
  nudge?(): void
}

/** The page an event is about, for the outbox row. */
const subjectOf = (event: DocumentEvent): string | null =>
  'key' in event ? event.key : 'parentKey' in event ? event.parentKey : null

/** Who made a change, as the outbox keeps it: enough to name them and leave them out. */
export const outboxActor = (actor: MediaActor) => {
  const memberKey = actorMemberKey(actor)
  return {
    kind: actor.kind,
    name: actorName(actor),
    userKey: actorUserKey(actor),
    ...(memberKey ? { memberKey } : {}),
  }
}

export function createContentEventSink(options: ContentEventSinkOptions): EventSink {
  return {
    async record(tx: Db, event, actor) {
      const entry = auditEntryFor(event, actor)
      const audit = new AuditLog(tx)
      // A deleted page cannot be named after it went: the operation read its name first.
      const subject =
        event.type === 'deleted'
          ? { entityType: entry.entityType, entityKey: event.key, entityName: event.name }
          : entry.entityKey
            ? await audit.describe(entry.entityType, entry.entityKey)
            : undefined
      await audit.record({
        ...entry,
        entityType: subject?.entityType ?? entry.entityType,
        entityKey: subject?.entityKey ?? entry.entityKey,
        entityName: subject?.entityName ?? null,
      })
      const hook = webhookFor(event)
      const change = notificationFor(event)
      const webhook =
        hook && options.webhooks ? await options.webhooks.factsFor(tx, hook) : undefined
      const notification =
        change && options.notifier
          ? await options.notifier.factsFor(
              tx,
              change,
              { key: actorUserKey(actor), name: actorName(actor) },
              actorNote(actor),
            )
          : undefined
      if (!webhook && !notification) return
      await new ContentEventRepository(tx).record({
        kind: event.type,
        entityType: 'Document',
        entityKey: subjectOf(event),
        facts: { v: 1, ...(webhook ? { webhook } : {}), ...(notification ? { notification } : {}) },
        actor: outboxActor(actor),
      })
    },
    afterCommit(event) {
      for (const live of liveEventsFor(event)) options.live?.(live)
      if (webhookFor(event) || notificationFor(event)) options.nudge?.()
    },
  }
}

/**
 * Where media operations record what they did (story 165): the audit entry and,
 * for a save or a delete, the webhook event, in the change's own transaction.
 */
export function createMediaEventSink(options: {
  webhooks?: Pick<WebhookService, 'factsFor'>
  nudge?(): void
}): MediaEventSink {
  return {
    async record(tx: Db, event, actor) {
      const entry = mediaAuditEntryFor(event, actor)
      const audit = new AuditLog(tx)
      const subject =
        event.type === 'deleted'
          ? { entityType: entry.entityType, entityKey: event.key, entityName: event.name }
          : entry.entityKey
            ? await audit.describe(entry.entityType, entry.entityKey)
            : undefined
      await audit.record({
        ...entry,
        entityType: subject?.entityType ?? entry.entityType,
        entityKey: subject?.entityKey ?? entry.entityKey,
        entityName: subject?.entityName ?? null,
      })
      const hook = mediaWebhookFor(event)
      const webhook =
        hook && options.webhooks ? await options.webhooks.factsFor(tx, hook) : undefined
      if (!webhook || !hook) return
      await new ContentEventRepository(tx).record({
        kind: event.type === 'deleted' ? 'mediaDeleted' : 'mediaSaved',
        entityType: 'Media',
        entityKey: hook.key,
        facts: { v: 1, webhook },
        actor: outboxActor(actor),
      })
    },
    afterCommit(event) {
      if (mediaWebhookFor(event)) options.nudge?.()
    },
  }
}
