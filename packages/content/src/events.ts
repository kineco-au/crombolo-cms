/**
 * What a document write did, as the operation reports it (story 170). An
 * operation reports to an `EventSink`; the server and the command line each wire
 * one to the same database-backed steps — the audit log, webhooks, change
 * notifications — and the server adds live backoffice refresh. The mappings here
 * are pure, so every transport turns one event into the same entries.
 */
import { type Actor, actorName, actorNote, actorUserKey } from './actor.ts'

export type DocumentEvent =
  | { type: 'created'; key: string }
  | { type: 'saved'; key: string }
  | { type: 'createdAndPublished'; key: string; cultures: readonly string[] | null }
  | { type: 'savedAndPublished'; key: string; cultures: readonly string[] | null }
  | { type: 'published'; key: string; cultures: readonly string[] | null }
  /** Only scheduled: nothing is published until the schedule fires. */
  | { type: 'scheduled'; key: string }
  /** A page and the pages below it: `published` names each one that went live. */
  | { type: 'branchPublished'; key: string; published: readonly string[] }
  | { type: 'unpublished'; key: string; cultures: readonly string[] | null }
  | { type: 'trashed'; key: string }
  /** `name` is read before it went, since it cannot be read after. */
  | { type: 'deleted'; key: string; name: string | null }
  | { type: 'restored'; key: string }
  | { type: 'binEmptied' }
  | { type: 'moved'; key: string }
  | { type: 'copied'; key: string; copyKey: string }
  /** `parentKey` null: the top level. */
  | { type: 'sorted'; parentKey: string | null }
  | { type: 'rolledBack'; key: string; versionId: string }
  | { type: 'domainsAssigned'; key: string }
  | { type: 'publicAccessChanged'; key: string; change: 'added' | 'set' | 'removed' }

/** Where an operation reports what it did, once the change has committed. */
export interface EventSink {
  emit(event: DocumentEvent, actor: Actor): Promise<void>
}

/** A sink that hears nothing: for tests and tools that announce nothing. */
export const SILENT: EventSink = { emit: async () => {} }

/** Several sinks heard in turn. */
export const both = (...sinks: EventSink[]): EventSink => ({
  async emit(event, actor) {
    for (const sink of sinks) await sink.emit(event, actor)
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
export function webhookFor(event: DocumentEvent): { alias: string; key: string } | undefined {
  switch (event.type) {
    case 'created':
    case 'saved':
      return { alias: 'Umbraco.ContentSaved', key: event.key }
    case 'createdAndPublished':
    case 'savedAndPublished':
    case 'published':
    case 'branchPublished':
      return { alias: 'Umbraco.ContentPublish', key: event.key }
    case 'unpublished':
      return { alias: 'Umbraco.ContentUnpublish', key: event.key }
    case 'deleted':
      return { alias: 'Umbraco.ContentDelete', key: event.key }
    case 'trashed':
      return { alias: 'Umbraco.ContentMovedToRecycleBin', key: event.key }
    // Out of the bin is a move, as Umbraco raises it.
    case 'moved':
    case 'restored':
      return { alias: 'Umbraco.ContentMoved', key: event.key }
    case 'copied':
      return { alias: 'Umbraco.ContentCopied', key: event.copyKey }
    case 'sorted':
      return event.parentKey ? { alias: 'Umbraco.ContentSorted', key: event.parentKey } : undefined
    case 'rolledBack':
      return { alias: 'Umbraco.ContentRolledBack', key: event.key }
    // A schedule publishes nothing yet: the job raises it when it fires.
    case 'scheduled':
    case 'binEmptied':
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
  const skipped = actor.kind === 'operator' && actor.skipApproval === true
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
