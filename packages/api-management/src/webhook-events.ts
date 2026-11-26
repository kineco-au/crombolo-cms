/**
 * The webhook events this site raises, and which Management API operation
 * raises each. Aliases are Umbraco's, so the backoffice's event picker and an
 * imported site's choices mean the same thing. docs/webhooks.md.
 */

export type WebhookEventType = 'Content' | 'Media' | 'Element'

export interface WebhookEventInfo {
  alias: string
  eventName: string
  eventType: WebhookEventType
}

const event = (alias: string, eventName: string, eventType: WebhookEventType) => ({
  alias: `Crombolo.${alias}`,
  eventName,
  eventType,
})

/**
 * Story 440: every event is `Crombolo.` and Umbraco's word for it. Pages, media and
 * Library items (Umbraco's elements), then this site's own.
 */
export const WEBHOOK_EVENTS: readonly WebhookEventInfo[] = [
  event('ContentSaved', 'Content Saved', 'Content'),
  event('ContentPublish', 'Content Published', 'Content'),
  event('ContentUnpublish', 'Content Unpublished', 'Content'),
  event('ContentDelete', 'Content Deleted', 'Content'),
  event('ContentMovedToRecycleBin', 'Content Moved to Recycle Bin', 'Content'),
  event('ContentMoved', 'Content Moved', 'Content'),
  event('ContentCopied', 'Content Copied', 'Content'),
  event('ContentSorted', 'Content Sorted', 'Content'),
  event('ContentRolledBack', 'Content Rolled Back', 'Content'),
  event('ContentEmptiedRecycleBin', 'Content Recycle Bin Emptied', 'Content'),
  event('MediaSave', 'Media Saved', 'Media'),
  event('MediaDelete', 'Media Deleted', 'Media'),
  event('MediaMoved', 'Media Moved', 'Media'),
  event('MediaMovedToRecycleBin', 'Media Moved to Recycle Bin', 'Media'),
  event('MediaSorted', 'Media Sorted', 'Media'),
  event('MediaEmptiedRecycleBin', 'Media Recycle Bin Emptied', 'Media'),
  event('ElementSaved', 'Library Item Saved', 'Element'),
  event('ElementPublish', 'Library Item Published', 'Element'),
  event('ElementUnpublish', 'Library Item Unpublished', 'Element'),
  event('ElementDelete', 'Library Item Deleted', 'Element'),
  event('ElementCopied', 'Library Item Copied', 'Element'),
  event('ElementMoved', 'Library Item Moved', 'Element'),
  event('ElementMovedToRecycleBin', 'Library Item Moved to Recycle Bin', 'Element'),
  event('ElementEmptiedRecycleBin', 'Library Recycle Bin Emptied', 'Element'),
  event('ElementRolledBack', 'Library Item Rolled Back', 'Element'),
  event('ApprovalSent', 'Sent for Approval', 'Content'),
  event('ApprovalStageReached', 'Approval Stage Reached', 'Content'),
  event('ApprovalApproved', 'Approved', 'Content'),
  event('ApprovalSentBack', 'Sent Back', 'Content'),
  event('ApprovalWithdrawn', 'Approval Withdrawn', 'Content'),
  event('ApprovalStalled', 'Approval Stalled', 'Content'),
  event('ApprovalFinished', 'Approval Finished', 'Content'),
  event('ChangePublished', 'Change Published', 'Content'),
  event('WorkspaceOpened', 'Workspace Opened', 'Content'),
  event('WorkspaceMerged', 'Workspace Merged', 'Content'),
  event('WorkspaceDiscarded', 'Workspace Discarded', 'Content'),
  event('WorkspaceConflicted', 'Workspace In Conflict With Shared', 'Content'),
]

/**
 * Story 440: each name an event had before, Umbraco's own among them, and its name now. An
 * old name is refused wherever it is written, naming this one; a stored webhook's are
 * renamed by migration 104.
 */
export const RENAMED_EVENTS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    [
      'ContentSaved',
      'ContentPublish',
      'ContentUnpublish',
      'ContentDelete',
      'ContentMovedToRecycleBin',
      'ContentMoved',
      'ContentCopied',
      'ContentSorted',
      'ContentRolledBack',
      'ContentEmptiedRecycleBin',
      'MediaSave',
      'MediaDelete',
      'ElementSaved',
      'ElementPublish',
      'ElementUnpublish',
      'ElementDelete',
      'ElementCopied',
      'ElementMoved',
      'ElementMovedToRecycleBin',
      'ElementEmptiedRecycleBin',
      'ElementRolledBack',
    ].map((name) => [`Umbraco.${name}`, `Crombolo.${name}`]),
  ),
  mediaMoved: 'Crombolo.MediaMoved',
  mediaMovedToRecycleBin: 'Crombolo.MediaMovedToRecycleBin',
  mediaEmptiedRecycleBin: 'Crombolo.MediaEmptiedRecycleBin',
}

/** Why an event name cannot be used, said as whoever wrote it reads it; undefined when it can. */
export function eventNameProblem(alias: string): string | undefined {
  if (WEBHOOK_EVENT_ALIASES.has(alias)) return undefined
  const renamed = RENAMED_EVENTS[alias]
  return renamed
    ? `"${alias}" is now "${renamed}": every event is named "Crombolo." and its word.`
    : `"${alias}" is not an event this site raises.`
}

/** Raised when a publish finishes a person's change (story 388), naming it. */
export const CHANGE_PUBLISHED = 'Crombolo.ChangePublished'

export const WEBHOOK_EVENT_ALIASES: ReadonlySet<string> = new Set(
  WEBHOOK_EVENTS.map((event) => event.alias),
)

/** Something happened to one item: what, and to which. */
export interface RaisedWebhookEvent {
  alias: string
  key: string
  /** Story 440: a bin emptied, every item it deleted. */
  keys?: string[]
}
