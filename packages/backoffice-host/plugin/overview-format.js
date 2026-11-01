/**
 * The Overview's words (story 236): a page's state, how long ago, initials for
 * an avatar, and a line for each activity. Pure, so the unit tests read it.
 */

export const STATES = {
  published: 'Published',
  changed: 'Changes not published',
  draft: 'Draft',
}

const VERBS = {
  Create: 'created %',
  Save: 'saved %',
  CreateAndPublish: 'created and published %',
  SaveAndPublish: 'published %',
  Publish: 'published %',
  PublishWithDescendants: 'published % and the pages below it',
  Unpublish: 'unpublished %',
  Trash: 'moved % to the recycle bin',
  Restore: 'restored %',
  Move: 'moved %',
  Copy: 'copied %',
  Revert: 'rolled back %',
}

/** The first word of a name, for the greeting. */
export const firstName = (name) =>
  String(name ?? '')
    .trim()
    .split(/\s+/)[0] ?? ''

/** Up to two initials. */
export function initials(name) {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0]?.[0] ?? ''
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** "just now", "5m ago", "2h ago", "3d ago", then the date. */
export function ago(when, now = new Date()) {
  const then = new Date(when)
  const seconds = Math.max(0, (now.getTime() - then.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "You published "Home"" or "Jordan Wu saved "About"". */
export function activityLine(entry) {
  const who = entry.mine ? 'You' : entry.who || 'Someone'
  const verb = VERBS[entry.action] ?? `${entry.action.toLowerCase()} %`
  return `${who} ${verb.replace('%', `“${entry.name}”`)}`
}

/** How many soft colours an avatar can take; `avatarHue` picks one per name. */
export const AVATAR_HUES = 6

/** The same name always gets the same colour, so a person is recognisable down a list. */
export function avatarHue(name) {
  let hash = 0
  for (const char of String(name ?? '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0
  return hash % AVATAR_HUES
}
