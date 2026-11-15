/** What the back office says about command-line tokens (story 351). Pure. */

export const HEADLINE = 'Command-line tokens'

/** What the profile box says the tokens are for. */
export const INTRO =
  'A token lets a script or an automated job run commands as you, with your permissions. ' +
  'Treat it like a password.'

/** What the user's screen says, for an administrator looking at someone else's. */
export const OTHERS_INTRO =
  'Tokens this person made so scripts can run commands as them. Revoking one stops it working straight away.'

export const NONE = 'No tokens.'

/** Shown above a new token, the one time it can be seen. */
export const SHOWN_ONCE = "Copy this token now. You won't be able to see it again."

/** The group editor's words for the permission. */
export const PERMISSION_LABEL = 'Command-line tokens'
export const PERMISSION_DESCRIPTION = 'Create tokens that let scripts run commands as you'

/**
 * A date as the browser writes dates: "14 Dec 2026".
 * @param {string} iso
 * @param {string} [locale]
 * @returns {string}
 */
export function day(iso, locale) {
  return new Date(iso).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * The line under a token's name: when it stops working and when it was last used.
 * @param {{ expiresAt: string, lastUsedAt: string | null }} token
 * @param {string} [locale]
 * @returns {string}
 */
export function tokenLine(token, locale) {
  const used = token.lastUsedAt ? `last used ${day(token.lastUsedAt, locale)}` : 'not used yet'
  return `Works until ${day(token.expiresAt, locale)}, ${used}`
}

/**
 * How long a new token may last, as choices: the usual lengths up to the site's limit, and the limit.
 * @param {number} maxDays
 * @returns {Array<{ days: number, label: string }>}
 */
export function expiryChoices(maxDays) {
  const days = [...new Set([7, 30, 60, 90].filter((d) => d < maxDays).concat(maxDays))]
  return days.map((d) => ({ days: d, label: d === 1 ? '1 day' : `${d} days` }))
}

/**
 * Whether Create may be pressed, and what it says.
 * @param {string} name
 * @returns {{ enabled: boolean, label: string }}
 */
export function createButton(name) {
  return name.trim() === ''
    ? { enabled: false, label: 'Give it a name' }
    : { enabled: true, label: 'Create token' }
}

/**
 * The question before revoking.
 * @param {string} name
 * @returns {string}
 */
export const revokeQuestion = (name) => `Revoke "${name}"? Anything using it will stop working.`
