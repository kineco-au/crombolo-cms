/**
 * What a document write did, as the operation reports it (story 170). An
 * operation reports to an `EventSink`; the server and the command line each wire
 * one to the same database-backed steps — the audit log, webhooks, change
 * notifications — and the server adds live backoffice refresh. The mappings here
 * are pure, so every transport turns one event into the same entries.
 */
import type { Db } from '@crombolo/data'
import { type Actor, actorName, actorNote, actorUserKey } from './actor.ts'

export type DocumentEvent =
  | { type: 'created'; key: string }
  | { type: 'saved'; key: string }
  | { type: 'createdAndPublished'; key: string; cultures: readonly string[] | null }
  | { type: 'savedAndPublished'; key: string; cultures: readonly string[] | null }
  /** `scheduled`: it set or cleared a time as well (story 417). */
  | { type: 'published'; key: string; cultures: readonly string[] | null; scheduled?: true }
  /** Only scheduled: nothing is published until the schedule fires. */
  | { type: 'scheduled'; key: string }
  /** A page and the pages below it: `published` names each one that went live. */
  | { type: 'branchPublished'; key: string; published: readonly string[] }
  | { type: 'unpublished'; key: string; cultures: readonly string[] | null }
  | { type: 'trashed'; key: string }
  /**
   * `name` is read before it went, since it cannot be read after. `was`: the page as it
   * stood, when it was deleted from outside the recycle bin (story 411).
   */
  /** `fromBin`: deleted by emptying the bin, which says so once for all of them (story 440). */
  | { type: 'deleted'; key: string; name: string | null; was?: object; fromBin?: boolean }
  | { type: 'restored'; key: string }
  /** Story 440: every item the emptying deleted, by key. */
  | { type: 'binEmptied'; keys: string[] }
  /** `from`: where it was before, as its change carries it (story 411). */
  | { type: 'moved'; key: string; from?: { parentKey: string | null; trashed: boolean } }
  | { type: 'copied'; key: string; copyKey: string }
  /** `parentKey` null: the top level. `before`: the children's order before (story 411). */
  | { type: 'sorted'; parentKey: string | null; before?: readonly string[] }
  | { type: 'rolledBack'; key: string; versionId: string }
  | { type: 'domainsAssigned'; key: string }
  | { type: 'publicAccessChanged'; key: string; change: 'added' | 'set' | 'removed' }

/**
 * Where an operation reports what it did (story 171). `record` runs inside the
 * change's own transaction, so what must not be lost — the audit entry, the
 * announcement waiting to go out — commits with the change or not at all.
 * `afterCommit` is for what only a running server does once it has.
 */
export interface EventSink {
  record(tx: Db, event: DocumentEvent, actor: Actor): Promise<void>
  afterCommit?(event: DocumentEvent, actor: Actor): void
  /** Story 397: a publish in a person's own workspace merged its page, recorded as `changeId`. */
  ownPublished?(
    tx: Db,
    published: {
      changeId: string
      key: string
      /** Story 411: what the page's merge did, other than a publish. */
      kind?: 'unpublish' | 'move' | 'reorder' | 'delete' | 'schedule'
      page?: { key: string; name: string | null }
      /** Story 417: the times the merge set, per language, in UTC; empty when cleared. */
      schedule?: ReadonlyArray<{
        culture: string | null
        publishTime: string | null
        unpublishTime: string | null
      }>
    },
    actor: Actor,
  ): Promise<void>
}

/** A sink that hears nothing: for tests and tools that announce nothing. */
export const SILENT: EventSink = { record: async () => {} }

/** Several sinks heard in turn. */
export const both = (...sinks: EventSink[]): EventSink => ({
  async record(tx, event, actor) {
    for (const sink of sinks) await sink.record(tx, event, actor)
  },
  async ownPublished(tx, published, actor) {
    for (const sink of sinks) await sink.ownPublished?.(tx, published, actor)
  },
  afterCommit(event, actor) {
    for (const sink of sinks) sink.afterCommit?.(event, actor)
  },
})

/** The audit entry an event writes: the same whichever transport started it. Pure. */
export function auditFor(event: DocumentEvent): {
  category: 'content' | 'permission'
  action: string
  entityType: string
  entityKey: string | null
  detail?: string
} {
  const doc = (action: string, key: string | null) => ({
    category: 'content' as const,
    action,
    entityType: 'Document',
    entityKey: key,
  })
  switch (event.type) {
    case 'created':
      return doc('Create', event.key)
    case 'saved':
      return doc('Save', event.key)
    case 'createdAndPublished':
      return doc('CreateAndPublish', event.key)
    case 'savedAndPublished':
      return doc('SaveAndPublish', event.key)
    case 'published':
    case 'scheduled':
      return doc('Publish', event.key)
    case 'branchPublished':
      return doc('PublishWithDescendants', event.key)
    case 'unpublished':
      return doc('Unpublish', event.key)
    case 'trashed':
      return doc('Trash', event.key)
    case 'deleted':
      return doc('Delete', event.key)
    case 'restored':
      return doc('Restore', event.key)
    case 'binEmptied':
      return doc('EmptyRecycleBin', null)
    case 'moved':
      return doc('Move', event.key)
    case 'copied':
      return doc('Copy', event.key)
    case 'sorted':
      return doc('Sort', event.parentKey)
    case 'rolledBack':
      return { ...doc('Rollback', event.versionId), entityType: 'DocumentVersion' }
    case 'domainsAssigned':
      return doc('AssignDomains', event.key)
    case 'publicAccessChanged':
      return {
        ...doc(
          event.change === 'added'
            ? 'AddPublicAccess'
            : event.change === 'set'
              ? 'SetPublicAccess'
              : 'RemovePublicAccess',
          event.key,
        ),
        category: 'permission',
      }
  }
}

/** The webhook an event raises, by Umbraco's alias, and the page it names. Pure. */
export function webhookFor(
  event: DocumentEvent,
): { alias: string; key: string; keys?: string[] } | undefined {
  switch (event.type) {
    case 'created':
    case 'saved':
      return { alias: 'Crombolo.ContentSaved', key: event.key }
    case 'createdAndPublished':
    case 'savedAndPublished':
    case 'published':
    case 'branchPublished':
      return { alias: 'Crombolo.ContentPublish', key: event.key }
    case 'unpublished':
      return { alias: 'Crombolo.ContentUnpublish', key: event.key }
    case 'deleted':
      // Emptying the bin says so once, for every item it took (story 440).
      return event.fromBin ? undefined : { alias: 'Crombolo.ContentDelete', key: event.key }
    case 'trashed':
      return { alias: 'Crombolo.ContentMovedToRecycleBin', key: event.key }
    // Out of the bin is a move, as Umbraco raises it.
    case 'moved':
    case 'restored':
      return { alias: 'Crombolo.ContentMoved', key: event.key }
    case 'copied':
      return { alias: 'Crombolo.ContentCopied', key: event.copyKey }
    case 'sorted':
      return event.parentKey ? { alias: 'Crombolo.ContentSorted', key: event.parentKey } : undefined
    case 'rolledBack':
      return { alias: 'Crombolo.ContentRolledBack', key: event.key }
    case 'binEmptied':
      return event.keys.length > 0
        ? { alias: 'Crombolo.ContentEmptiedRecycleBin', key: '', keys: event.keys }
        : undefined
    // A schedule publishes nothing yet: the job raises it when it fires.
    case 'scheduled':
    case 'domainsAssigned':
    case 'publicAccessChanged':
      return undefined
  }
}

/** The change people subscribed to a page hear of (story 045), if any. Pure. */
export function notificationFor(event: DocumentEvent):
  | {
      actions: string[]
      key: string
      keyKind: 'document' | 'version'
      withDescendants?: boolean
    }
  | undefined {
  const of = (actions: string[], key: string) => ({ actions, key, keyKind: 'document' as const })
  switch (event.type) {
    case 'created':
      return of(['Umb.Document.Create'], event.key)
    case 'saved':
      return of(['Umb.Document.Update'], event.key)
    case 'createdAndPublished':
      return of(['Umb.Document.Create', 'Umb.Document.Publish'], event.key)
    case 'savedAndPublished':
      return of(['Umb.Document.Update', 'Umb.Document.Publish'], event.key)
    case 'published':
      return of(['Umb.Document.Publish'], event.key)
    case 'branchPublished':
      return { ...of(['Umb.Document.Publish'], event.key), withDescendants: true }
    case 'trashed':
      return of(['Umb.Document.Delete'], event.key)
    case 'moved':
      return of(['Umb.Document.Move'], event.key)
    // Notified on the original, as Umbraco does.
    case 'copied':
      return of(['Umb.Document.Duplicate'], event.key)
    // On the parent whose children were sorted; sorting the top level notifies nobody.
    case 'sorted':
      return event.parentKey ? of(['Umb.Document.Sort'], event.parentKey) : undefined
    case 'rolledBack':
      return { actions: ['Umb.Document.Rollback'], key: event.versionId, keyKind: 'version' }
    case 'restored':
      return of(['Umb.DocumentRecycleBin.Restore'], event.key)
    case 'publicAccessChanged':
      return of(['Umb.Document.PublicAccess'], event.key)
    case 'scheduled':
    case 'unpublished':
    case 'deleted':
    case 'binEmptied':
    case 'domainsAssigned':
      return undefined
  }
}

/**
 * The live events an open backoffice drops its cached copy on, by Umbraco's
 * names: one per page the change touched. Pure.
 */
export function liveEventsFor(event: DocumentEvent): Array<{
  eventSource: string
  eventType: 'Created' | 'Updated' | 'Deleted' | 'Trashed'
  key: string
}> {
  const source = 'Umbraco:CMS:Document'
  const one = (eventType: 'Created' | 'Updated' | 'Deleted' | 'Trashed', key: string) => [
    { eventSource: source, eventType, key },
  ]
  switch (event.type) {
    case 'created':
    case 'createdAndPublished':
      return one('Created', event.key)
    case 'copied':
      return one('Created', event.copyKey)
    case 'trashed':
      return one('Trashed', event.key)
    case 'deleted':
      return one('Deleted', event.key)
    case 'branchPublished':
      return [...new Set([event.key, ...event.published])].map((key) => ({
        eventSource: source,
        eventType: 'Updated' as const,
        key,
      }))
    case 'sorted':
      return event.parentKey ? one('Updated', event.parentKey) : []
    case 'binEmptied':
      return []
    default:
      return one('Updated', event.key)
  }
}

/**
 * The whole audit entry an event writes, as every transport writes it: the
 * entry, who acted and from where. An operator who skipped approval is said to
 * have. The item's name is the transport's to look up. Pure.
 */
export function auditEntryFor(event: DocumentEvent, actor: Actor) {
  const entry = auditFor(event)
  const skipped =
    (actor.kind === 'operator' || actor.kind === 'user') && actor.skipApproval === true
  return {
    ...entry,
    source: actor.origin.source,
    userKey: actorUserKey(actor),
    userName: actorName(actor),
    ipAddress: actor.origin.ipAddress ?? null,
    forwardedFor: actor.origin.forwardedFor ?? null,
    detail: skipped
      ? 'Approval skipped from the command line'
      : (sentence(actorNote(actor)) ?? entry.detail ?? null),
  }
}

/** A note as the audit log writes it: a capital first, as its entries read. */
const sentence = (note: string | undefined) =>
  note ? note.charAt(0).toUpperCase() + note.slice(1) : undefined

/** What a Library write did (story 361): an element, or one of the folders they sit in. */
export type ElementEvent =
  | { type: 'created'; key: string }
  | { type: 'saved'; key: string }
  | { type: 'createdAndPublished'; key: string }
  | { type: 'savedAndPublished'; key: string }
  /** Published now, or only scheduled to be. */
  | { type: 'published'; key: string }
  | { type: 'unpublished'; key: string }
  | { type: 'trashed'; key: string }
  | { type: 'moved'; key: string }
  | { type: 'copied'; key: string; copyKey: string }
  /** Story 440: deleted for good, restored from the bin, the bin emptied, rolled back. */
  | { type: 'deleted'; key: string }
  | { type: 'restored'; key: string }
  | { type: 'binEmptied'; keys: string[] }
  | { type: 'rolledBack'; key: string }
  | { type: 'folderCreated'; key: string }
  | { type: 'folderRenamed'; key: string }
  | { type: 'folderMoved'; key: string }
  | { type: 'folderTrashed'; key: string }

/** Where a Library operation records what it did, inside the change's transaction. */
export interface ElementEventSink {
  record(tx: Db, event: ElementEvent, actor: Actor): Promise<void>
  afterCommit?(event: ElementEvent, actor: Actor): void
}

/**
 * The audit entry a Library event writes: the category and action names the
 * back office has always written for it. A copy is entered against the original.
 * Pure.
 */
export function elementAuditFor(event: ElementEvent): {
  category: 'content'
  action: string
  entityType: 'Element' | 'ElementFolder'
  entityKey: string
} {
  const element = (action: string) => ({
    category: 'content' as const,
    action,
    entityType: 'Element' as const,
    entityKey: 'key' in event ? event.key : '',
  })
  const folder = (action: string) => ({ ...element(action), entityType: 'ElementFolder' as const })
  switch (event.type) {
    case 'created':
      return element('Create')
    case 'saved':
      return element('Save')
    case 'createdAndPublished':
      return element('CreateAndPublish')
    case 'savedAndPublished':
      return element('SaveAndPublish')
    case 'published':
      return element('Publish')
    case 'unpublished':
      return element('Unpublish')
    case 'trashed':
      return element('Trash')
    case 'moved':
      return element('Move')
    case 'copied':
      return element('Copy')
    case 'deleted':
      return element('Delete')
    case 'restored':
      return element('Restore')
    case 'binEmptied':
      return element('EmptyRecycleBin')
    case 'rolledBack':
      return element('RollBack')
    case 'folderCreated':
      return folder('Create')
    case 'folderRenamed':
      return folder('Save')
    case 'folderMoved':
      return folder('Move')
    case 'folderTrashed':
      return folder('Trash')
  }
}

/**
 * Story 440: the webhook a Library event raises, by Umbraco's word for its elements; a
 * folder's raises none. Pure.
 */
export function elementWebhookFor(
  event: ElementEvent,
): { alias: string; key: string; keys?: string[] } | undefined {
  switch (event.type) {
    case 'created':
    case 'saved':
      return { alias: 'Crombolo.ElementSaved', key: event.key }
    case 'createdAndPublished':
    case 'savedAndPublished':
    case 'published':
      return { alias: 'Crombolo.ElementPublish', key: event.key }
    case 'unpublished':
      return { alias: 'Crombolo.ElementUnpublish', key: event.key }
    case 'trashed':
      return { alias: 'Crombolo.ElementMovedToRecycleBin', key: event.key }
    case 'moved':
    case 'restored':
      return { alias: 'Crombolo.ElementMoved', key: event.key }
    case 'copied':
      return { alias: 'Crombolo.ElementCopied', key: event.copyKey }
    case 'deleted':
      return { alias: 'Crombolo.ElementDelete', key: event.key }
    case 'rolledBack':
      return { alias: 'Crombolo.ElementRolledBack', key: event.key }
    case 'binEmptied':
      return event.keys.length > 0
        ? { alias: 'Crombolo.ElementEmptiedRecycleBin', key: '', keys: event.keys }
        : undefined
    default:
      return undefined
  }
}

/** The whole audit entry a Library event writes, with who acted and from where. Pure. */
export function elementAuditEntryFor(event: ElementEvent, actor: Actor) {
  return {
    ...elementAuditFor(event),
    source: actor.origin.source,
    userKey: actorUserKey(actor),
    userName: actorName(actor),
    ipAddress: actor.origin.ipAddress ?? null,
    forwardedFor: actor.origin.forwardedFor ?? null,
    detail: sentence(actorNote(actor)) ?? null,
  }
}
