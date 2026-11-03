/**
 * Changes to a webhook kept in the site's files (story 251): its address,
 * events, content types, headers and whether it is on. Pure; the rules every
 * webhook is held to are `webhookProblems`'s, which the caller runs.
 */
import { envReference, type WebhookDefinition } from './webhook-files.ts'

export type WebhookEditResult =
  | { ok: true; webhook: WebhookDefinition }
  | { ok: false; reason: string }

export interface WebhookChanges {
  name?: string
  description?: string
  url?: string
  enabled?: boolean
  addEvents?: readonly string[]
  removeEvents?: readonly string[]
  /** Content types by alias, as a file names them. */
  addContentTypes?: readonly string[]
  removeContentTypes?: readonly string[]
  /** Header name to its value; in a file, only `env:NAME`. */
  setHeaders?: Readonly<Record<string, string>>
  removeHeaders?: readonly string[]
}

const added = (list: readonly string[], more: readonly string[] = []) => [
  ...list,
  ...more.filter((item) => !list.includes(item)),
]
const without = (list: readonly string[], less: readonly string[] = []) =>
  list.filter((item) => !less.includes(item))

export function updateWebhook(
  webhook: WebhookDefinition,
  changes: WebhookChanges,
): WebhookEditResult {
  for (const event of changes.removeEvents ?? [])
    if (!webhook.events.includes(event))
      return { ok: false, reason: `it is not sent on "${event}"` }
  for (const type of changes.removeContentTypes ?? [])
    if (!webhook.contentTypeKeys.includes(type))
      return { ok: false, reason: `it is not limited to the content type "${type}"` }
  for (const name of changes.removeHeaders ?? [])
    if (!(name in webhook.headers)) return { ok: false, reason: `it sends no header "${name}"` }
  for (const [name, value] of Object.entries(changes.setHeaders ?? {}))
    if (!envReference(value))
      return {
        ok: false,
        reason: `the header "${name}" would put its value in the site's files: give it as env:NAME and set NAME on the server`,
      }
  const headers = { ...webhook.headers, ...changes.setHeaders }
  for (const name of changes.removeHeaders ?? []) delete headers[name]
  return {
    ok: true,
    webhook: {
      ...webhook,
      ...(changes.name !== undefined ? { name: changes.name || null } : {}),
      ...(changes.description !== undefined ? { description: changes.description || null } : {}),
      ...(changes.url !== undefined ? { url: changes.url } : {}),
      ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
      events: without(added(webhook.events, changes.addEvents), changes.removeEvents),
      contentTypeKeys: without(
        added(webhook.contentTypeKeys, changes.addContentTypes),
        changes.removeContentTypes,
      ),
      headers,
    },
  }
}
