/**
 * Umbraco's notifications dialog, on a site that cannot send e-mail (story
 * 045): a banner saying so, and every toggle disabled, rather than choices
 * saved for e-mails that never come. The dialog asks the fork's
 * `notificationsUnavailable` seam, which this answers. The server refuses a new
 * subscription regardless.
 */
export const UNAVAILABLE =
  "This site can't send e-mail yet, so it can't tell you when this page changes. Ask an administrator to set up e-mail, then come back to choose what to hear about."

/** Whether this site can send notification e-mails; asked once per page load. */
let answer
export function canSendNotifications(fetcher = fetch) {
  answer ??= (async () => {
    const href = document.querySelector('base')?.getAttribute('href') ?? '/umbraco/'
    const response = await fetcher(`${href.replace(/\/$/, '')}/crombolo/api/email`, {
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
    // Unknown is not unavailable: Umbraco's dialog stays as it is.
    if (!response.ok) return true
    return (await response.json()).canSendNotifications !== false
  })().catch(() => true)
  return answer
}

/** Why the dialog's choices are off, or undefined when this site can send them. */
export async function notificationsUnavailable(fetcher = fetch) {
  return (await canSendNotifications(fetcher)) ? undefined : UNAVAILABLE
}

export const onInit = async () => {
  const { umbCromboloHooks } = await import('@umbraco-cms/backoffice/extension-registry')
  umbCromboloHooks.notificationsUnavailable = () => notificationsUnavailable()
}
