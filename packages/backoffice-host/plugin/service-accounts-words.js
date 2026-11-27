/**
 * Service accounts' words and their one API (story 433). Pure but for `accountsApi`, so
 * the unit tests read them outside a browser.
 */

export const HEADLINE = 'Service accounts'
export const INTRO = 'Custom credentials for connecting external systems and services.'
export const NONE = 'There are no service accounts yet.'
export const SHOWN_ONCE =
  'Copy this secret now: it is not shown again. Give it to whatever signs in as this account.'

/** When the old secret stops, as the choice offers it. */
export const OLD_STOPS = [
  { value: 'now', label: 'At once' },
  { value: 'day', label: 'In a day' },
  { value: 'week', label: 'In a week' },
]

const when = (iso, now = Date.now()) => {
  if (!iso) return 'never'
  const minutes = Math.round((now - Date.parse(iso)) / 60000)
  if (minutes < 60) return 'within the hour'
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** "Last used 3 days ago", "Never used"; at most an hour out, as it is written hourly. */
export const lastUsedLine = (iso, now) => (iso ? `Last used ${when(iso, now)}` : 'Never used')

/** What an account or client id is used for, or that nothing here names it. */
export const usedForLine = (uses) =>
  uses.length === 0 ? 'Not named in the site’s settings' : uses.join(' · ')

/** The question before taking away something an account is used for. */
export function stopQuestion(action, what, uses) {
  const headline = `${action} ${what}?`
  if (uses.length === 0) return { headline, content: 'Nothing in the site’s settings uses it.' }
  return {
    headline,
    content: `These will stop working: ${uses.join('; ')}. Change the site's settings to name another account first, or go on and they stop now.`,
  }
}

/** While a replaced secret still works. */
export const oldSecretLine = (iso) =>
  iso ? `The old secret works until ${new Date(iso).toLocaleString()}` : ''

const base = () =>
  `${(document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')}/crombolo/api/service-accounts`

/** Calls the service accounts API; a refusal throws with the server's words. */
export async function accountsApi(method, path = '', body) {
  const response = await fetch(`${base()}${path}`, {
    method,
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.message ?? 'That did not work. Try again.')
  return result
}

/** The screen's address for one account. */
export const accountHref = (key) =>
  `section/settings/dashboard/service-accounts?account=${encodeURIComponent(key)}`
