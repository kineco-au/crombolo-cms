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
import { normaliseUuid } from '@crombolo/core'
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

/** Story 411: what a change did, as `Change.Kind` says; a publish or a schedule says none. */
export type ChangeKind = 'unpublish' | 'move' | 'reorder' | 'delete' | 'schedule'

/** A schedule's times as the event carries them (story 417). */
type ScheduleTimes = ReturnType<typeof scheduleEntries>

/**
 * Story 411: an unpublish, move, reorder, restore or delete straight in Shared, put in the
 * person's change with where the page stood; what to announce, or undefined for any other.
 */
async function placeInChange(
  tx: Db,
  changes: ChangeRepository,
  userKey: string,
  event: DocumentEvent,
): Promise<
  | { key: string | null; says: { kind: ChangeKind; page?: { key: string; name: string | null } } }
  | undefined
> {
  const docs = new DocumentRepository(tx)
  const page = (key: string) => ({ key, kind: 'document' })
  switch (event.type) {
    case 'sorted': {
      if (!event.before) return undefined
      const after = (await docs.children(event.parentKey, 0, 10_000)).items.map((n) =>
        normaliseUuid(n.key),
      )
      if (after.join() === event.before.join()) return undefined
      await changes.ordered(userKey, event.parentKey, event.before, after)
      return { key: event.parentKey ?? after[0] ?? null, says: { kind: 'reorder' } }
    }
    case 'unpublished': {
      const doc = await docs.byKey(event.key)
      if (!doc) return undefined
      const at = { parentKey: doc.parentKey, published: doc.published }
      if (!(await changes.placed(userKey, page(event.key), { ...at, published: true }, at)))
        return undefined
      return { key: event.key, says: { kind: 'unpublish' } }
    }
    case 'moved':
    case 'restored': {
      const doc = await docs.byKey(event.key)
      if (!doc) return undefined
      const from =
        event.type === 'restored'
          ? { parentKey: null, trashed: true }
          : (event.from ?? { parentKey: doc.parentKey, trashed: false })
      const before = {
        parentKey: from.parentKey,
        published: doc.published,
        ...(from.trashed ? { trashed: true } : {}),
      }
      const after = { parentKey: doc.parentKey, published: doc.published }
      if (!(await changes.placed(userKey, page(event.key), before, after))) return undefined
      return { key: event.key, says: { kind: 'move' } }
    }
    case 'trashed': {
      const doc = await docs.byKey(event.key)
      if (!doc) return undefined
      await changes.removedBy(userKey, page(event.key), doc)
      const name = (doc.variants.find((v) => v.culture === null) ?? doc.variants[0])?.name ?? null
      return { key: event.key, says: { kind: 'delete', page: { key: event.key, name } } }
    }
    case 'deleted': {
      // From the bin, it went when it was moved there: emptying it says nothing more.
      if (!event.was) return undefined
      await changes.removedBy(userKey, page(event.key), event.was)
      return {
        key: event.key,
        says: { kind: 'delete', page: { key: event.key, name: event.name } },
      }
    }
    default:
      return undefined
  }
}

export function createContentEventSink(options: ContentEventSinkOptions): EventSink {
  /** A person's own write in the back office or the API, not a merge's nor the site's code. */
  const ownEdit = (actor: Actor) => actor.kind === 'user' && !actor.origin.via

  /** Story 388: the page in its writer's change, and on a publish the change closed and announced. */
  async function recordInChange(tx: Db, event: DocumentEvent, actor: Actor) {
    const key = subjectOf(event)
    const userKey = actorUserKey(actor)
    if (!userKey || !ownEdit(actor)) return
    const changes = new ChangeRepository(tx)
    // Story 411: an unpublish, a move, a reorder and a delete close the change as a publish does.
    const passedOn = await placeInChange(tx, changes, userKey, event)
    if (passedOn) {
      const closed = await changes.closeOpen(userKey)
      if (closed) await announceChange(tx, passedOn.key, { ...closed, ...passedOn.says }, actor)
      return
    }
    if (!key) return
    if (SAVES.has(event.type)) await changes.pageSavedBy(userKey, { key, kind: 'document' })
    // Story 395: setting or clearing a schedule is passed on as a publish is.
    const scheduled = event.type === 'scheduled'
    if (!PUBLISHES.has(event.type) && !scheduled) return
    const schedule = await new DocumentRepository(tx).schedules(key)
    const times = scheduleEntries(schedule)
    // Story 417: a publish that cleared a time carries the clearing too.
    const setTimes =
      scheduled || schedule.length > 0 || ('scheduled' in event && event.scheduled === true)
    if (setTimes) await changes.scheduleOf(userKey, { key, kind: 'document' }, times)
    const closed = await changes.publishedBy(userKey, { key, kind: 'document' })
    // Story 414: the schedule names the change that set it, for when it fires.
    if (closed && setTimes) await new DocumentRepository(tx).scheduleSetBy(key, closed.key)
    // Story 417: one that only scheduled says so; a publish that also set a time carries it.
    if (closed)
      await announceChange(
        tx,
        key,
        {
          ...closed,
          ...(scheduled ? { kind: 'schedule' as const } : {}),
          ...(setTimes ? { schedule: times } : {}),
        },
        actor,
      )
  }

  /** `Crombolo.ChangePublished` for a page's change, as an outbox event in its transaction. */
  async function announceChange(
    tx: Db,
    key: string | null,
    closed: {
      key: string
      name: string | null
      from?: 'own-workspace'
      kind?: ChangeKind
      page?: { key: string; name: string | null }
      schedule?: ScheduleTimes
      approvedBy?: { key: string; name: string }
      workflow?: string
    },
    actor: Actor,
  ) {
    const change = {
      ...closed,
      ...(await madeBy()),
      ...(key && closed.kind !== 'delete' ? await needsOf(tx, key) : {}),
    }
    const hook = { alias: CHANGE_PUBLISHED, key: key ?? '' }
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

  /**
   * Story 413: what an approval did, passed on as the editor's change: the newest that
   * holds the page, closed if open, announced naming the approver and the workflow. A
   * time it set is kept in that change and names it.
   */
  async function passOnApproval(
    tx: Db,
    event: DocumentEvent,
    actor: Actor,
    approval: { editorKey: string; workflow: string },
  ) {
    if (event.type !== 'published' && event.type !== 'unpublished' && event.type !== 'scheduled')
      return
    const changes = new ChangeRepository(tx)
    const held = await changes.closeHolding(approval.editorKey, event.key)
    if (!held) return
    const docs = new DocumentRepository(tx)
    const timed = event.type === 'scheduled' || (event.type === 'published' && event.scheduled)
    const times = timed ? scheduleEntries(await docs.schedules(event.key)) : undefined
    if (times) {
      await changes.scheduleIn(held.id, event.key, times)
      await docs.scheduleSetBy(event.key, held.key)
    }
    const by = actor.kind === 'system' ? actor.user : undefined
    await announceChange(
      tx,
      event.key,
      {
        key: held.key,
        name: held.name,
        ...(held.merged ? { from: 'own-workspace' as const } : {}),
        ...(event.type === 'unpublished' ? { kind: 'unpublish' as const } : {}),
        ...(event.type === 'scheduled' ? { kind: 'schedule' as const } : {}),
        ...(times ? { schedule: times } : {}),
        ...(by ? { approvedBy: { key: by.id, name: by.name } } : {}),
        workflow: approval.workflow,
      },
      actor,
    )
  }

  return {
    async ownPublished(tx, published, actor) {
      if (!options.changes) return
      const change = await new ChangeRepository(tx).byId(published.changeId)
      if (!change) return
      await announceChange(
        tx,
        published.key,
        {
          key: change.key,
          name: change.name,
          from: 'own-workspace',
          ...(published.kind ? { kind: published.kind } : {}),
          ...(published.page ? { page: published.page } : {}),
          ...(published.schedule ? { schedule: [...published.schedule] } : {}),
        },
        actor,
      )
    },
    async record(tx: Db, event, actor) {
      if (options.changes) await recordInChange(tx, event, actor as Actor)
      // Story 413: an approval's publish, unpublish or times pass the editor's change on.
      const approval = actor.kind === 'system' ? actor.approval : undefined
      if (options.changes && approval) await passOnApproval(tx, event, actor as Actor, approval)
      // Story 414: a schedule firing names the change that set it.
      const fired = actor.kind === 'system' ? actor.change : undefined
      if (options.changes && fired && (event.type === 'published' || event.type === 'unpublished'))
        await announceChange(
          tx,
          event.key,
          {
            key: fired.key,
            name: fired.name,
            ...(event.type === 'unpublished' ? { kind: 'unpublish' as const } : {}),
          },
          actor as Actor,
        )
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
