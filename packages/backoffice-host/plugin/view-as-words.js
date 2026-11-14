/** What the back office says while an administrator views it as user groups (story 314). Pure. */

/**
 * The groups' names as a list: "Editors, Writers".
 * @param {Array<{ name: string }>} groups
 * @returns {string}
 */
export function groupNames(groups) {
  return groups.map((g) => g.name).join(', ')
}

/**
 * The time of day a view ends, as the browser writes times: "14:32".
 * @param {string} iso
 * @param {string} [locale]
 * @returns {string}
 */
export function endsAt(iso, locale) {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

/**
 * The banner's words: "Viewing as Editors, Writers until 14:32".
 * @param {{ groups: Array<{ name: string }>, until: string }} viewing
 * @param {string} [locale]
 * @returns {string}
 */
export function viewingLabel(viewing, locale) {
  return `Viewing as ${groupNames(viewing.groups)} until ${endsAt(viewing.until, locale)}`
}

/**
 * Whether Start may be pressed, and what it says.
 * @param {string[]} chosen the keys ticked
 * @returns {{ enabled: boolean, label: string }}
 */
export function startButton(chosen) {
  return chosen.length === 0
    ? { enabled: false, label: 'Choose a group' }
    : { enabled: true, label: chosen.length === 1 ? 'View as this group' : 'View as these groups' }
}

/** What the panel says it does. */
export const PANEL_NOTE =
  'For the next hour, the back office in this browser shows and allows only what the groups ' +
  'you choose can do. Your other devices are not affected. Anything you change is recorded as you.'

/**
 * Milliseconds until the view ends, never less than zero.
 * @param {string} iso
 * @param {number} [now]
 * @returns {number}
 */
export function msUntil(iso, now = Date.now()) {
  return Math.max(0, Date.parse(iso) - now)
}
