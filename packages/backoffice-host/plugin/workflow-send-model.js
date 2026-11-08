/**
 * What the bottom bar's "Send for approval" and "Request unpublish" decide
 * (`workflow-send.js`). Pure, so each is tested on its own.
 */
import { fromLocalInput } from './workflow-time.js'

/** What the reader may send now: `publish`, `unpublish`, both or neither. Pure. */
export function maySend(approval, action) {
  if (!approval?.ok || !approval.workflow || approval.request) return false
  return action === 'unpublish'
    ? approval.can?.requestUnpublish === true
    : approval.can?.send === true
}

/** The schedule a request carries for the times given, or undefined for none. Pure. */
export function scheduleFor(action, publishAt, unpublishAt) {
  const publishTime = action === 'publish' ? fromLocalInput(publishAt) : null
  const unpublishTime = fromLocalInput(unpublishAt)
  return publishTime || unpublishTime ? [{ culture: null, publishTime, unpublishTime }] : undefined
}
