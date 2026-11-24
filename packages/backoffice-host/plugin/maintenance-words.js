/** What the back office tells editors while editing is paused (story 409). Pure. */

/**
 * When saving is back, as the person's own clock and calendar write it: "10:10" today,
 * "Tue 25 Nov, 10:10" another day.
 * @param {string} iso
 * @param {Date} [now]
 * @param {string} [locale]
 * @returns {string}
 */
export function backAt(iso, now = new Date(), locale) {
  const at = new Date(iso)
  const time = at.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return time
  const day = at.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day}, ${time}`
}

/**
 * The banner's words: "Editing is paused for maintenance: Deploying. You can save again at 10:10."
 * @param {{ reason: string | null, until: string | null }} paused
 * @param {Date} [now]
 * @param {string} [locale]
 * @returns {string}
 */
export function pausedLabel(paused, now = new Date(), locale) {
  const why = paused.reason ? `: ${paused.reason}` : ''
  const when = paused.until
    ? `You can save again at ${backAt(paused.until, now, locale)}.`
    : 'You can save again once it is resumed.'
  return `Editing is paused for maintenance${why}. ${when}`
}

/**
 * How long until a pause's end, for the banner to take itself away; null for none.
 * @param {{ until: string | null }} paused
 * @param {Date} [now]
 * @returns {number | null}
 */
export function msUntilBack(paused, now = new Date()) {
  return paused.until ? Math.max(0, new Date(paused.until).getTime() - now.getTime()) : null
}
