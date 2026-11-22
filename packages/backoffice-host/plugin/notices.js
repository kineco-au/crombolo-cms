/**
 * Notices a host left for the person signed in (story 395), such as whether what they
 * published went live: each shown once, as a success or a failure, when the back office
 * opens and while it stays open.
 */
import { UmbContextConsumerController } from '@umbraco-cms/backoffice/context-api'
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification'

const EVERY_MS = 15_000

const base = () =>
  (document.querySelector('base')?.getAttribute('href') ?? '/umbraco/').replace(/\/$/, '')

/** How a notice is shown: its colour, and its words with the link, if it has one. Pure. */
export const shownAs = (notice) => ({
  color: notice.kind === 'failure' ? 'danger' : 'positive',
  data: {
    headline: notice.kind === 'failure' ? 'Not live yet' : 'Live',
    message: notice.link ? `${notice.message} ${notice.link}` : notice.message,
  },
})

/** The person's notices not yet seen; none when the site cannot say. */
export const takeNotices = async (fetcher = fetch) => {
  const response = await fetcher(`${base()}/crombolo/api/notices/mine`, {
    credentials: 'include',
  }).catch(() => undefined)
  if (!response?.ok) return []
  const body = await response.json().catch(() => undefined)
  return Array.isArray(body?.items) ? body.items : []
}

export const onInit = (host) => {
  new UmbContextConsumerController(host, UMB_NOTIFICATION_CONTEXT, (notifications) => {
    if (!notifications) return
    const show = async () => {
      for (const notice of await takeNotices()) {
        const { color, data } = shownAs(notice)
        notifications.peek(color, { data })
      }
    }
    void show()
    setInterval(() => void show(), EVERY_MS)
  })
}
