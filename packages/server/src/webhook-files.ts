/**
 * A webhook as a file, `schema/webhooks/<alias>.toml`, and the rules every
 * webhook is held to. Pure: reading and writing the directory is `webhooks.ts`'s
 * job. docs/webhooks.md.
 *
 * Since story 161 a webhook file names itself by alias, carries no key unless
 * one differs from the one its alias derives, and names its content types by
 * alias. A legacy `<key>.toml` with keys still reads.
 */
import { WEBHOOK_EVENT_ALIASES } from '@crombolo/api-management/domain'
import { derivedKey } from '@crombolo/core'

export type WebhookStore = 'files' | 'database'

export interface WebhookDefinition {
  key: string
  /** A file's name for it (story 161); absent on a webhook kept in the database. */
  alias?: string
  name: string | null
  description: string | null
  url: string
  enabled: boolean
  events: string[]
  /** In memory, keys; in a file, aliases (a uuid-shaped value is a key). */
  contentTypeKeys: string[]
  /** A value is either `env:NAME` or, kept in the database only, the secret itself. */
  headers: Record<string, string>
  /**
   * What is posted: Umbraco's Minimal `{ Id }`, or `crombolo`, which adds the
   * item's content type and its ancestors' keys (story 208). Set in the file only.
   */
  payload?: WebhookPayload
}

export type WebhookPayload = 'minimal' | 'crombolo'

const ENV_REFERENCE = /^env:([A-Za-z_][A-Za-z0-9_]*)$/
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
/** Set on every delivery, so a webhook may not set them itself. */
const RESERVED = new Set([
  'content-type',
  'content-length',
  'host',
  'webhook-event',
  'webhook-retry-count',
  'webhook-id',
  'webhook-delivery',
])

/** The variable an `env:NAME` value names, or undefined for a typed-in value. */
export function envReference(value: string): string | undefined {
  return ENV_REFERENCE.exec(value)?.[1]
}

/** Every reason this webhook cannot be kept in `store`, said as an editor reads it. Pure. */
export function webhookProblems(webhook: WebhookDefinition, store: WebhookStore): string[] {
  const problems: string[] = []
  if (!/^https?:\/\/[^\s/]+/.test(webhook.url))
    problems.push('The URL must be a web address starting http:// or https://.')
  if (webhook.events.length === 0) problems.push('Choose at least one event.')
  if (webhook.payload === 'crombolo' && store === 'database')
    problems.push(
      "This webhook sends Crombolo's payload, which is set in its file, so it stays with the site's files.",
    )
  for (const event of webhook.events)
    if (!WEBHOOK_EVENT_ALIASES.has(event))
      problems.push(`"${event}" is not an event this site raises.`)
  for (const [name, value] of Object.entries(webhook.headers)) {
    if (!HEADER_NAME.test(name)) problems.push(`"${name}" is not a header name.`)
    else if (RESERVED.has(name.toLowerCase()))
      problems.push(`The header "${name}" is set on every delivery, so it cannot be set here.`)
    if (store === 'files' && !envReference(value))
      problems.push(
        `The header "${name}" would put its value in the site's files. Give it as env:NAME and set NAME on the server.`,
      )
  }
  return problems
}

const quote = (value: string) => JSON.stringify(value)
const list = (values: readonly string[]) => `[${values.map(quote).join(', ')}]`
const key = (name: string) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : quote(name))

/** The key a webhook's alias derives, so a file need not carry one (story 161). */
export const webhookKeyFor = (alias: string) => derivedKey('webhook', alias)

/** An alias from a name, as a file takes one: `Order placed` → `orderPlaced`. */
export function webhookAliasFor(name: string | null, key: string): string {
  const words = (name ?? '').split(/[^A-Za-z0-9]+/).filter(Boolean)
  const camel = words
    .map((w, i) =>
      i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join('')
  return /^[A-Za-z]/.test(camel) ? camel : `webhook${key.replaceAll('-', '').slice(0, 8)}`
}

/**
 * Canonical TOML, so a backoffice edit is a small diff. `contentTypes` is what
 * the file names them by — aliases — and defaults to the keys.
 */
export function writeWebhookFile(
  webhook: WebhookDefinition,
  contentTypes: readonly string[] = webhook.contentTypeKeys,
): string {
  const alias = webhook.alias ?? webhookAliasFor(webhook.name, webhook.key)
  const out = ['[webhook]']
  if (webhook.key.toLowerCase() !== webhookKeyFor(alias)) out.push(`key = ${quote(webhook.key)}`)
  out.push(`alias = ${quote(alias)}`)
  if (webhook.name) out.push(`name = ${quote(webhook.name)}`)
  if (webhook.description) out.push(`description = ${quote(webhook.description)}`)
  out.push(`url = ${quote(webhook.url)}`)
  if (!webhook.enabled) out.push('enabled = false')
  out.push(`events = ${list(webhook.events)}`)
  if (contentTypes.length > 0) out.push(`content-types = ${list(contentTypes)}`)
  if (webhook.payload === 'crombolo') out.push('payload = "crombolo"')
  const headers = Object.keys(webhook.headers).sort()
  if (headers.length > 0) {
    out.push('', '[webhook.headers]')
    for (const name of headers) out.push(`${key(name)} = ${quote(webhook.headers[name] as string)}`)
  }
  return `${out.join('\n')}\n`
}

const KEYS = new Set([
  'key',
  'alias',
  'name',
  'description',
  'url',
  'enabled',
  'events',
  'content-types',
  'headers',
  'payload',
])

/** A file back to a webhook, or what is wrong with it. Unknown keys are refused, as in every schema file. */
export function parseWebhookFile(
  file: string,
  source: string,
): { webhook?: WebhookDefinition; problems: string[] } {
  let root: Record<string, unknown>
  try {
    root = Bun.TOML.parse(source) as Record<string, unknown>
  } catch (error) {
    return { problems: [`${file}: ${error instanceof Error ? error.message : String(error)}`] }
  }
  const t = root.webhook
  if (!t || typeof t !== 'object' || Array.isArray(t))
    return { problems: [`${file}: a [webhook] table is required`] }
  const table = t as Record<string, unknown>
  const problems: string[] = []
  for (const name of Object.keys(table))
    if (!KEYS.has(name)) problems.push(`${file}: webhook.${name} is not a webhook setting`)
  const text = (name: string): string | null =>
    typeof table[name] === 'string' ? (table[name] as string) : null
  const strings = (name: string): string[] =>
    Array.isArray(table[name])
      ? ((table[name] as unknown[]).filter((v) => typeof v === 'string') as string[])
      : []
  const headers: Record<string, string> = {}
  if (table.headers && typeof table.headers === 'object')
    for (const [name, value] of Object.entries(table.headers as Record<string, unknown>))
      if (typeof value === 'string') headers[name] = value
      else problems.push(`${file}: webhook.headers.${name} must be text`)
  const payload = text('payload')
  if (table.payload !== undefined && payload !== 'minimal' && payload !== 'crombolo')
    problems.push(`${file}: webhook.payload must be "minimal" or "crombolo"`)
  const webhookAlias = text('alias') ?? undefined
  const written = text('key')
  if (written !== null && !/^[0-9a-f-]{36}$/i.test(written))
    problems.push(`${file}: webhook.key must be a key`)
  if (!written && !webhookAlias) problems.push(`${file}: webhook.alias is required`)
  const webhookKey = written ?? (webhookAlias ? webhookKeyFor(webhookAlias) : '')
  const webhook: WebhookDefinition = {
    key: webhookKey.toLowerCase(),
    ...(webhookAlias ? { alias: webhookAlias } : {}),
    name: text('name'),
    description: text('description'),
    url: text('url') ?? '',
    enabled: table.enabled !== false,
    events: strings('events'),
    contentTypeKeys: strings('content-types').map((value) =>
      /^[0-9a-f-]{36}$/i.test(value) ? value.toLowerCase() : value,
    ),
    headers,
    ...(payload === 'crombolo' ? { payload } : {}),
  }
  problems.push(...webhookProblems(webhook, 'files').map((message) => `${file}: ${message}`))
  return problems.length > 0 ? { problems } : { webhook, problems }
}
