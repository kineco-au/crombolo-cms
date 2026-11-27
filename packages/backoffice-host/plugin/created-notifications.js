/**
 * A create's toast ("Member group created", "Document created"). The back office
 * rebuilds an answer naming a generated resource keeping only its `X-` headers, so the
 * server's `Umb-Notifications` never reaches the toasts and a first save says nothing.
 * The server repeats them as `X-Crombolo-Notifications`, shown here only when the
 * original didn't survive, so nothing shows twice.
 */
import { UmbContextConsumerController } from '@umbraco-cms/backoffice/context-api'
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification'

export const CREATED_HEADER = 'x-crombolo-notifications'

const COLOR = { Success: 'positive', Error: 'danger', Warning: 'warning', Info: 'default' }

/** The messages a header carries, or none. Pure. */
export const messagesIn = (value) => {
  try {
    const parsed = JSON.parse(value ?? '')
    return Array.isArray(parsed) ? parsed.filter((m) => typeof m?.message === 'string') : []
  } catch {
    return []
  }
}

export const onInit = async (host) => {
  const { umbHttpClient } = await import('@umbraco-cms/backoffice/http-client')
  let notifications
  new UmbContextConsumerController(host, UMB_NOTIFICATION_CONTEXT, (context) => {
    notifications = context
  })
  umbHttpClient.interceptors.response.use((response) => {
    if (response.headers.has('umb-notifications')) return response
    for (const m of messagesIn(response.headers.get(CREATED_HEADER)))
      notifications?.peek(COLOR[m.type] ?? 'default', {
        data: { headline: m.category, message: m.message },
      })
    return response
  })
}
