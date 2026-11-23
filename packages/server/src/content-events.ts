/**
 * Where document operations record what they did (stories 170 and 171). Inside
 * the change's own transaction: its audit entry, and — when anyone may hear of
 * it — an outbox event holding the facts as they were. After the commit: the
 * live backoffice, and a nudge so the dispatcher sends it now rather than at
 * its next tick. The command line wires the same sink without the live part.
 */

import { CHANGE_PUBLISHED } from '@crombolo/api-management'
import {
  type Actor,
  actorMemberKey,
  actorName,
  actorNote,
  actorUserKey,
  auditEntryFor,
  type DocumentEvent,
  type ElementEventSink,
  type EventSink,
  elementAuditEntryFor,
  liveEventsFor,
  type MediaActor,
  type MediaEventSink,
  mediaAuditEntryFor,
  mediaWebhookFor,
  notificationFor,
  webhookFor,
} from '@crombolo/content'
import {
  AuditLog,
  ChangeRepository,
  ContentEventRepository,
  currentAuditContext,
  type Db,
  DocumentRepository,
} from '@crombolo/data'
import type { ContentNotifier } from './content-notifications.ts'
import { neededBy, servedView } from './served-schema.ts'
import type { WebhookService } from './webhooks.ts'

export interface ContentEventSinkOptions {
  webhooks?: Pick<WebhookService, 'factsFor'>
  notifier?: Pick<ContentNotifier, 'factsFor'>
  /** Tells an open backoffice what changed: a server's event hub; absent on the command line. */
  live?(event: ReturnType<typeof liveEventsFor>[number]): void
  /** Called after a commit that left work in the outbox. */
  nudge?(): void
  /**
   * Story 388: a person's own saves join their change, and a publish closes it and
   * raises `Crombolo.ChangePublished` naming it, for a host to pass on.
   */
  changes?: boolean
}

const SAVES = new Set(['created', 'saved', 'createdAndPublished', 'savedAndPublished'])
const PUBLISHES = new Set([
  'published',
  'createdAndPublished',
  'savedAndPublished',
  'branchPublished',
])

/** The page an event is about, for the outbox row. */
const subjectOf = (event: DocumentEvent): string | null =>
  'key' in event ? event.key : 'parentKey' in event ? event.parentKey : null

/** The cultures an event was about, when it was about some. */
const culturesOf = (event: DocumentEvent): string[] | null =>
  'cultures' in event && event.cultures ? [...event.cultures] : null

/** The site code a change came through (story 298), when it did. */
const viaOf = (actor: MediaActor): { via?: string } =>
  actor.kind !== 'member' && actor.origin.via ? { via: actor.origin.via } : {}

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

/** A page's schedule as a change carries it: per language, when it goes live and comes down. */
export const scheduleEntries = (
  rows: ReadonlyArray<{ culture: string | null; action: 'Release' | 'Expire'; date: Date }>,
) => {
  const byCulture = new Map<
    string | null,
    { culture: string | null; publishTime: string | null; unpublishTime: string | null }
  >()
  for (const row of rows) {
    const entry = byCulture.get(row.culture) ?? {
      culture: row.culture,
      publishTime: null,
      unpublishTime: null,
    }
    if (row.action === 'Release') entry.publishTime = row.date.toISOString()
    else entry.unpublishTime = row.date.toISOString()
    byCulture.set(row.culture, entry)
  }
  return [...byCulture.values()]
}

/** Story 395: a person, or a tool acting for one (a sign-in exchanged with an actor, 364). */
async function madeBy(): Promise<{ by: 'person' | 'tool'; tool?: { id: string; name: string } }> {
  const actor = currentAuditContext()?.exchange?.actor
  return actor
    ? { by: 'tool', tool: { id: actor.id, name: actor.name ?? actor.id } }
    : { by: 'person' }
}

/** Story 395: the unserved changes a page needs, once a host reports what is served. */
async function needsOf(tx: Db, key: string) {
  const view = await servedView(tx)
  if (!view) return {}
  const page = await new DocumentRepository(tx).byKey(key)
  return page ? { needs: neededBy(view, page) } : {}
}

export function createContentEventSink(options: ContentEventSinkOptions): EventSink {
  /** A person's own write in the back office or the API, not a merge's nor the site's code. */
  const ownEdit = (actor: Actor) => actor.kind === 'user' && !actor.origin.via

  /** Story 388: the page in its writer's change, and on a publish the change closed and announced. */
  async function recordInChange(tx: Db, event: DocumentEvent, actor: Actor) {
    const key = subjectOf(event)
    const userKey = actorUserKey(actor)
    if (!key || !userKey || !ownEdit(actor)) return
    const changes = new ChangeRepository(tx)
    if (SAVES.has(event.type)) await changes.pageSavedBy(userKey, { key, kind: 'document' })
    // Story 395: setting or clearing a schedule is passed on as a publish is.
    const scheduled = event.type === 'scheduled'
    if (!PUBLISHES.has(event.type) && !scheduled) return
    const schedule = await new DocumentRepository(tx).schedules(key)
    if (scheduled || schedule.length > 0)
      await changes.scheduleOf(userKey, { key, kind: 'document' }, scheduleEntries(schedule))
    const closed = await changes.publishedBy(userKey, { key, kind: 'document' })
    if (closed) await announceChange(tx, key, closed, actor)
  }

  /** `Crombolo.ChangePublished` for a page's change, as an outbox event in its transaction. */
  async function announceChange(
    tx: Db,
    key: string,
    closed: { key: string; name: string | null; from?: 'own-workspace' },
    actor: Actor,
  ) {
    const change = { ...closed, ...(await madeBy()), ...(await needsOf(tx, key)) }
    const hook = { alias: CHANGE_PUBLISHED, key }
    await new ContentEventRepository(tx).record({
      kind: 'change-published',
      entityType: 'Document',
      entityKey: key,
      facts: {
        v: 1,
        ...(options.webhooks
          ? { webhook: { ...(await options.webhooks.factsFor(tx, hook)), change } }
          : {}),
      },
      actor: outboxActor(actor),
    })
  }

  return {
    async ownPublished(tx, published, actor) {
      if (!options.changes) return
      const change = await new ChangeRepository(tx).byId(published.changeId)
      if (!change) return
      await announceChange(
        tx,
        published.key,
        { key: change.key, name: change.name, from: 'own-workspace' },
        actor,
      )
    },
    async record(tx: Db, event, actor) {
      if (options.changes) await recordInChange(tx, event, actor as Actor)
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
        hook && options.webhooks
          ? {
              ...(await options.webhooks.factsFor(tx, hook)),
              // For the site's own handlers (story 298): what it was about, and who did it.
              cultures: culturesOf(event),
              actor: { kind: actor.kind, name: actorName(actor), ...viaOf(actor) },
              ...viaOf(actor),
            }
          : undefined
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

/**
 * Where Library operations record what they did (story 361): the audit entry, in
 * the change's own transaction, as the back office has always written it.
 */
export function createElementEventSink(): ElementEventSink {
  return {
    async record(tx: Db, event, actor) {
      const entry = elementAuditEntryFor(event, actor)
      const audit = new AuditLog(tx)
      const subject = await audit.describe(entry.entityType, entry.entityKey)
      await audit.record({
        ...entry,
        entityType: subject.entityType,
        entityKey: subject.entityKey,
        entityName: subject.entityName,
      })
    },
  }
}

/** A workspace's Library writes (story 390): audited, naming the workspace, and announced nowhere else. */
export function workspaceElementEventSink(name: string): ElementEventSink {
  return {
    async record(tx: Db, event, actor) {
      const entry = elementAuditEntryFor(event, actor)
      const audit = new AuditLog(tx)
      const subject = await audit.describe(entry.entityType, entry.entityKey)
      const where = `In the workspace "${name}"`
      await audit.record({
        ...entry,
        entityType: subject.entityType,
        entityKey: subject.entityKey,
        entityName: subject.entityName,
        detail: entry.detail ? `${where}. ${entry.detail}` : where,
      })
    },
  }
}
