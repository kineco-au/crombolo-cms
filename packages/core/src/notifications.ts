/**
 * The `Umb-Notifications` response header. Note the name: it is NOT
 * `Umbraco-Notifications`. The backoffice reads it, renders toasts, and strips
 * it. Umbraco never sets it on GET.
 */
export const NOTIFICATIONS_HEADER = 'Umb-Notifications'

export type EventMessageType = 'Default' | 'Info' | 'Error' | 'Success' | 'Warning'

export interface EventMessage {
  message: string
  category: string
  type: EventMessageType
}

export function notificationsHeaderValue(messages: readonly EventMessage[]): string {
  return JSON.stringify(messages)
}

/**
 * The same messages again on an answer naming a generated resource. The back office
 * rebuilds such an answer keeping only `X-` headers, so `Umb-Notifications` never
 * reaches its toasts: a create's "created" was lost. The plugin shows this one instead.
 */
export const CREATED_NOTIFICATIONS_HEADER = 'X-Crombolo-Notifications'

export function applyNotifications(
  headers: Headers,
  method: string,
  messages: readonly EventMessage[],
): void {
  if (method.toUpperCase() === 'GET') return
  if (messages.length === 0) return
  headers.set(NOTIFICATIONS_HEADER, notificationsHeaderValue(messages))
  if (headers.has('Umb-Generated-Resource'))
    headers.set(CREATED_NOTIFICATIONS_HEADER, notificationsHeaderValue(messages))
}
