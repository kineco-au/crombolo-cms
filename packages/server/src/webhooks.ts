/**
 * Webhooks: kept with the site's files or in this environment, raised by
 * changes, delivered by a background job with retries, and every attempt
 * logged. A server bundle's event handlers ride the same queue. docs/webhooks.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type RaisedWebhookEvent, WEBHOOK_EVENT_ALIASES } from '@crombolo/api-management'
import {
  ContentTypeRepository,
  type Db,
  type WebhookDelivery,
  WebhookDeliveryRepository,
  type WebhookLogEntry,
  WebhookRepository,
  type WebhookRow,
} from '@crombolo/data'
import { retryAfter, type WorkflowRunReport } from './form-workflows.ts'
import { logger } from './logging.ts'
import { openSecret, SECRET_KEY_VARIABLE, sealSecret, usableSecretKey } from './secrets.ts'
import {
  envReference,
  parseWebhookFile,
  type WebhookDefinition,
  type WebhookStore,
  webhookAliasFor,
  webhookProblems,
  writeWebhookFile,
} from './webhook-files.ts'

const log = logger('webhooks')

/** What the backoffice shows instead of a typed-in secret, and sends back to keep it. */
export const MASKED = '********'

/** How long a delivery may take before it counts as failed and is retried. */
const DELIVERY_TIMEOUT_MS = 30_000

export interface WebhookView extends WebhookDefinition {
  store: WebhookStore
}

/** What a bundle's event handler is given: the event, and narrow capabilities. */
export interface BundleEventContext {
  event: string
  /** Umbraco's Minimal payload: the item's key. */
  payload: { Id: string }
  deliveryId: string
  /** From 1; the queue makes up to five. */
  attempt: number
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>
  log: {
    info(message: string, properties?: Record<string, unknown>): void
    warn(message: string, properties?: Record<string, unknown>): void
    error(message: string, properties?: Record<string, unknown>): void
  }
  signal: AbortSignal
}

/** Done, or failed: `retry` tries again on the back-off; a throw counts as retryable. */
export type BundleEventResult = { ok: true } | { ok: false; error: string; retry: boolean }

export type BundleEventHandler = (
  context: BundleEventContext,
) => BundleEventResult | Promise<BundleEventResult>

/** Event aliases to handlers, as a server bundle declares them. */
export type BundleEvents = Readonly<Record<string, BundleEventHandler>>

const BUNDLE = 'bundle:'

/** Why these bundles' event declarations cannot be accepted. Pure. */
export function bundleEventProblems(
  bundles: readonly { id: string; events?: BundleEvents }[],
): string[] {
  const problems: string[] = []
  for (const bundle of bundles)
    for (const [alias, handler] of Object.entries(bundle.events ?? {})) {
      if (!WEBHOOK_EVENT_ALIASES.has(alias))
        problems.push(
          `The bundle "${bundle.id}" handles "${alias}", which is not an event this site raises.`,
        )
      if (typeof handler !== 'function')
        problems.push(`The bundle "${bundle.id}"'s handler for "${alias}" is not a function.`)
    }
  return problems
}

/** Who should hear about an event: the matching webhooks, then the bundles. Pure. */
export function subscribersFor(
  event: RaisedWebhookEvent,
  contentTypeKey: string | undefined,
  webhooks: readonly WebhookDefinition[],
  bundles: readonly { id: string; events?: BundleEvents }[],
): string[] {
  const out: string[] = []
  for (const webhook of webhooks) {
    if (!webhook.enabled || !webhook.events.includes(event.alias)) continue
    // A deleted item's type cannot be read back, and a missed delete is worse
    // than an extra one, so an unknown type is not filtered out.
    if (
      webhook.contentTypeKeys.length > 0 &&
      contentTypeKey !== undefined &&
      !webhook.contentTypeKeys.includes(contentTypeKey)
    )
      continue
    out.push(webhook.key)
  }
  for (const bundle of bundles) if (bundle.events?.[event.alias]) out.push(`${BUNDLE}${bundle.id}`)
  return out
}

/** What the "Where it's kept" panel shows: where it is, and whether it may move. Pure. */
export function webhookStoreView(
  store: WebhookStore,
  available: { files: boolean; database: boolean },
) {
  return {
    store,
    available,
    unavailable: {
      files: available.files ? null : "This server cannot change the site's files.",
      database: available.database
        ? null
        : `Keeping it in this environment needs ${SECRET_KEY_VARIABLE} set on the server.`,
    },
  }
}

export type WebhookWriteResult =
  | { ok: true; key: string }
  | { ok: false; status: 400 | 404 | 409; reason: string; problems?: string[] }

export interface WebhookServiceOptions {
  db: Db
  schemaDir: string
  /** Whether this node may write the site's files. */
  filesWritable: boolean
  secretKey?: string
  bundles?: readonly { id: string; events?: BundleEvents }[]
  fetch?: typeof fetch
  /** Publishes the schema directory to a shared store, when there is one. */
  onFilesChanged?: () => Promise<void>
  now?: () => Date
}

/** An event as a webhook delivers it, with the item's type as it was when it happened. */
export interface WebhookFacts extends RaisedWebhookEvent {
  contentTypeKey?: string
}

export interface WebhookService {
  /** Which stores a new or moved webhook may use on this node. */
  stores(): { files: boolean; database: boolean }
  list(): Promise<WebhookView[]>
  get(key: string): Promise<WebhookView | undefined>
  create(definition: WebhookDefinition, store?: WebhookStore): Promise<WebhookWriteResult>
  update(key: string, definition: WebhookDefinition): Promise<WebhookWriteResult>
  remove(key: string): Promise<boolean>
  move(key: string, store: WebhookStore): Promise<WebhookWriteResult>
  /** What a delivery needs to know about the item, read on `db` — the change's transaction. */
  factsFor(db: Db, event: RaisedWebhookEvent): Promise<WebhookFacts>
  /** Queues a delivery per subscriber, once per event however often it is repeated. */
  enqueueFor(db: Db, eventId: string | undefined, facts: WebhookFacts): Promise<number>
  /** Facts and queue at once, outside any outbox. Never throws into the caller. */
  raise(event: RaisedWebhookEvent): Promise<number>
  runDue(now?: Date, limit?: number): Promise<WorkflowRunReport>
  logs(
    subscriber: string | undefined,
    paging: { skip: number; take: number },
  ): Promise<{ total: number; items: WebhookLogEntry[] }>
}

const unavailable = (store: WebhookStore): WebhookWriteResult => ({
  ok: false,
  status: 400,
  reason:
    store === 'database'
      ? `Keeping a webhook in this environment needs ${SECRET_KEY_VARIABLE} set on the server.`
      : "This server cannot change the site's files, so a webhook cannot be kept with them here.",
})

export function createWebhookService(options: WebhookServiceOptions): WebhookService {
  const rows = new WebhookRepository(options.db)
  const deliveries = new WebhookDeliveryRepository(options.db)
  const dir = join(options.schemaDir, 'webhooks')
  const secret = usableSecretKey(options.secretKey)
  const bundles = options.bundles ?? []
  const now = options.now ?? (() => new Date())

  const stores = () => ({ files: options.filesWritable, database: secret !== undefined })

  /** Each webhook file, by its file name, as written: content types still aliases. */
  const filesOnDisk = (): Array<{ name: string; webhook: WebhookDefinition }> => {
    if (!existsSync(dir)) return []
    const out: Array<{ name: string; webhook: WebhookDefinition }> = []
    for (const name of readdirSync(dir)
      .filter((file) => file.endsWith('.toml'))
      .sort()) {
      const parsed = parseWebhookFile(
        `schema/webhooks/${name}`,
        readFileSync(join(dir, name), 'utf8'),
      )
      if (parsed.webhook) out.push({ name, webhook: parsed.webhook })
      else log.warning('A webhook file was skipped: {problems}', { problems: parsed.problems })
    }
    return out
  }

  /**
   * The files' webhooks with their content types as keys (story 161). An alias
   * no type has is logged and kept as a filter nothing matches, so a webhook
   * meant for some types never widens to every type.
   */
  const fromFiles = async (): Promise<WebhookDefinition[]> => {
    const types = new ContentTypeRepository(options.db)
    const out: WebhookDefinition[] = []
    for (const { name, webhook } of filesOnDisk()) {
      const keys: string[] = []
      for (const value of webhook.contentTypeKeys) {
        if (/^[0-9a-f-]{36}$/i.test(value)) keys.push(value)
        else {
          const found = await types.byAlias(value)
          if (found) keys.push(found.key.toLowerCase())
          else {
            log.warning('Webhook {file} names a content type {alias} this site has not got', {
              file: `schema/webhooks/${name}`,
              alias: value,
            })
            keys.push(`unknown:${value}`)
          }
        }
      }
      out.push({ ...webhook, contentTypeKeys: keys })
    }
    return out
  }

  const headersOf = (row: WebhookRow): Record<string, string> => {
    if (!row.sealedHeaders) return {}
    if (!secret)
      throw new Error(
        `${SECRET_KEY_VARIABLE} is not set, so this webhook's headers cannot be read.`,
      )
    return JSON.parse(openSecret(row.sealedHeaders, secret)) as Record<string, string>
  }

  const fromDatabase = async (): Promise<WebhookDefinition[]> =>
    (await rows.all()).map((row) => {
      let headers: Record<string, string> = {}
      try {
        headers = headersOf(row)
      } catch {
        headers = {}
      }
      const { sealedHeaders: _, ...rest } = row
      return { ...rest, headers }
    })

  const all = async (): Promise<WebhookView[]> => [
    ...(await fromFiles()).map((webhook) => ({ ...webhook, store: 'files' as const })),
    ...(await fromDatabase()).map((webhook) => ({ ...webhook, store: 'database' as const })),
  ]

  /** Content types by alias, as a file names them; a key no type has stays a key. */
  const contentTypeAliases = async (keys: readonly string[]) => {
    const types = new ContentTypeRepository(options.db)
    const out: string[] = []
    for (const key of keys) out.push((await types.byKey(key))?.alias ?? key)
    return out
  }
  /** The files that hold a webhook, legacy `<key>.toml` among them. */
  const filesFor = (key: string) =>
    filesOnDisk()
      .filter(({ webhook }) => webhook.key === key.toLowerCase())
      .map(({ name }) => name)
  const writeFile = async (webhook: WebhookDefinition) => {
    mkdirSync(dir, { recursive: true })
    const alias = webhook.alias ?? webhookAliasFor(webhook.name, webhook.key)
    const name = `${alias}.toml`
    // Renamed, or a legacy `<key>.toml`: the old file goes, so one webhook is one file.
    for (const old of filesFor(webhook.key))
      if (old !== name) rmSync(join(dir, old), { force: true })
    writeFileSync(
      join(dir, name),
      writeWebhookFile({ ...webhook, alias }, await contentTypeAliases(webhook.contentTypeKeys)),
      'utf8',
    )
    await options.onFilesChanged?.()
  }
  const removeFile = async (key: string) => {
    for (const name of filesFor(key)) rmSync(join(dir, name), { force: true })
    await options.onFilesChanged?.()
  }
  const writeRow = async (webhook: WebhookDefinition) => {
    const headers = Object.keys(webhook.headers).length > 0 ? webhook.headers : undefined
    if (headers && !secret) throw new Error('unreachable: a database write without a key')
    await rows.save({
      ...webhook,
      sealedHeaders: headers && secret ? sealSecret(JSON.stringify(headers), secret) : null,
    })
  }

  const store = async (
    webhook: WebhookDefinition,
    where: WebhookStore,
  ): Promise<WebhookWriteResult> => {
    if (!stores()[where]) return unavailable(where)
    const problems = webhookProblems(webhook, where)
    if (problems.length > 0)
      return { ok: false, status: 400, reason: 'The webhook is not valid.', problems }
    if (where === 'files') await writeFile(webhook)
    else await writeRow(webhook)
    return { ok: true, key: webhook.key }
  }

  /** A masked value sent back means "keep what is stored". */
  const unmask = (incoming: Record<string, string>, stored: Record<string, string>) => {
    const out: Record<string, string> = {}
    for (const [name, value] of Object.entries(incoming))
      out[name] = value === MASKED ? (stored[name] ?? '') : value
    return out
  }

  const resolveHeaders = (headers: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [name, value] of Object.entries(headers)) {
      const variable = envReference(value)
      if (!variable) {
        out[name] = value
        continue
      }
      const found = Bun.env[variable]
      if (found === undefined)
        throw new Error(`The header "${name}" names ${variable}, which is not set on the server.`)
      out[name] = found
    }
    return out
  }

  const deliverToWebhook = async (
    delivery: WebhookDelivery,
    webhook: WebhookDefinition,
  ): Promise<{ ok: true } | { ok: false; error: string; retry: boolean }> => {
    const body = JSON.stringify(delivery.payload)
    const fixed = {
      'Content-Type': 'application/json',
      'Webhook-Event': delivery.eventAlias,
      'Webhook-Retry-Count': String(delivery.attempts - 1),
      'Webhook-Id': webhook.key,
      'Webhook-Delivery': delivery.id,
      // The change itself, the same for every webhook it reaches (story 171).
      ...(delivery.eventId ? { 'Webhook-Event-Id': delivery.eventId } : {}),
    }
    // The log shows which headers were sent, never what their values were.
    const logged = JSON.stringify({
      ...fixed,
      ...Object.fromEntries(Object.keys(webhook.headers).map((name) => [name, MASKED])),
    })
    const entry = {
      deliveryId: delivery.id,
      subscriber: webhook.key,
      eventAlias: delivery.eventAlias,
      url: webhook.url,
      retryCount: delivery.attempts - 1,
      requestHeaders: logged,
      requestBody: body,
    }
    let headers: Record<string, string>
    try {
      headers = { ...resolveHeaders(webhook.headers), ...fixed }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await deliveries.log({
        ...entry,
        statusCode: null,
        success: false,
        exception: true,
        responseHeaders: '{}',
        responseBody: message,
      })
      return { ok: false, error: message, retry: false }
    }
    try {
      const response = await (options.fetch ?? fetch)(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        redirect: 'manual',
      })
      const responseBody = await response.text().catch(() => '')
      await deliveries.log({
        ...entry,
        statusCode: response.status,
        success: response.ok,
        exception: false,
        responseHeaders: JSON.stringify(Object.fromEntries(response.headers)),
        responseBody,
      })
      if (response.ok) return { ok: true }
      // A refusal will refuse again; a fault or a busy receiver may not last.
      const retry = response.status >= 500 || response.status === 408 || response.status === 429
      return { ok: false, error: `The receiver answered ${response.status}.`, retry }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await deliveries.log({
        ...entry,
        statusCode: null,
        success: false,
        exception: true,
        responseHeaders: '{}',
        responseBody: message,
      })
      return { ok: false, error: message, retry: true }
    }
  }

  const deliverToBundle = async (
    delivery: WebhookDelivery,
    bundleId: string,
  ): Promise<{ ok: true } | { ok: false; error: string; retry: boolean }> => {
    const handler = bundles.find((bundle) => bundle.id === bundleId)?.events?.[delivery.eventAlias]
    const entry = {
      deliveryId: delivery.id,
      subscriber: `${BUNDLE}${bundleId}`,
      eventAlias: delivery.eventAlias,
      url: `${BUNDLE}${bundleId}`,
      retryCount: delivery.attempts - 1,
      requestHeaders: '{}',
      requestBody: JSON.stringify(delivery.payload),
      statusCode: null,
      responseHeaders: '{}',
    }
    if (!handler) {
      const message = `The bundle "${bundleId}" no longer handles ${delivery.eventAlias}.`
      await deliveries.log({ ...entry, success: false, exception: false, responseBody: message })
      return { ok: false, error: message, retry: false }
    }
    const named = logger('webhooks', bundleId)
    const signal = AbortSignal.timeout(DELIVERY_TIMEOUT_MS)
    let result: BundleEventResult
    try {
      result = await handler({
        event: delivery.eventAlias,
        payload: delivery.payload as { Id: string },
        deliveryId: delivery.id,
        attempt: delivery.attempts,
        fetch: (input, init) => (options.fetch ?? fetch)(input, { signal, ...init }),
        log: {
          info: (message, properties) => named.info(message, properties),
          warn: (message, properties) => named.warn(message, properties),
          error: (message, properties) => named.error(message, properties),
        },
        signal,
      })
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        retry: true,
      }
    }
    await deliveries.log({
      ...entry,
      success: result.ok,
      exception: false,
      responseBody: result.ok ? '' : result.error,
    })
    return result
  }

  return {
    stores,
    list: all,
    async get(key) {
      return (await all()).find((webhook) => webhook.key === key.toLowerCase())
    },
    async create(definition, where) {
      const key = definition.key.toLowerCase()
      if (await this.get(key))
        return { ok: false, status: 409, reason: 'A webhook with that key exists.' }
      // A new webhook starts in this environment when it can, so a typed-in
      // secret is never written to the files by default.
      const chosen = where ?? (stores().database ? 'database' : 'files')
      if (!stores().database && !stores().files)
        return {
          ok: false,
          status: 400,
          reason: `Webhooks cannot be added on this server: set ${SECRET_KEY_VARIABLE}, or add them where the site's files can be changed.`,
        }
      return store({ ...definition, key }, chosen)
    },
    async update(key, definition) {
      const existing = await this.get(key)
      if (!existing) return { ok: false, status: 404, reason: 'The webhook could not be found.' }
      const next = {
        ...definition,
        key: existing.key,
        headers: unmask(definition.headers, existing.headers),
      }
      return store(next, existing.store)
    },
    async remove(key) {
      const existing = await this.get(key)
      if (!existing) return false
      if (existing.store === 'files') {
        if (!options.filesWritable) return false
        await removeFile(existing.key)
      } else await rows.remove(existing.key)
      return true
    },
    async move(key, where) {
      const existing = await this.get(key)
      if (!existing) return { ok: false, status: 404, reason: 'The webhook could not be found.' }
      if (existing.store === where) return { ok: true, key: existing.key }
      const { store: _, ...definition } = existing
      const written = await store(definition, where)
      if (!written.ok) return written
      if (existing.store === 'files') await removeFile(existing.key)
      else await rows.remove(existing.key)
      return written
    },
    async factsFor(db, event) {
      const contentTypeKey = await itemType(db, event.key)
      return contentTypeKey ? { ...event, contentTypeKey } : { ...event }
    },
    async enqueueFor(db, eventId, facts) {
      const subscribers = subscribersFor(facts, facts.contentTypeKey, await all(), bundles)
      if (subscribers.length === 0) return 0
      const queued = await new WebhookDeliveryRepository(db).enqueue(
        subscribers.map((subscriber) => ({
          subscriber,
          eventAlias: facts.alias,
          payload: { Id: facts.key },
          eventId,
        })),
        now(),
      )
      return queued.length
    },
    async raise(event) {
      try {
        return await this.enqueueFor(options.db, undefined, await this.factsFor(options.db, event))
      } catch (error) {
        log.error('Could not queue {event} for {key}: {error}', { ...event, error })
        return 0
      }
    },
    async runDue(at = now(), limit = 25) {
      const report: WorkflowRunReport = { claimed: 0, done: 0, retrying: 0, failed: 0 }
      for (const due of await deliveries.due(at, limit)) {
        const delivery = await deliveries.claim(due.id)
        if (!delivery) continue
        report.claimed++
        let result: { ok: true } | { ok: false; error: string; retry: boolean }
        if (delivery.subscriber.startsWith(BUNDLE))
          result = await deliverToBundle(delivery, delivery.subscriber.slice(BUNDLE.length))
        else {
          const webhook = await this.get(delivery.subscriber)
          result = webhook
            ? await deliverToWebhook(delivery, webhook)
            : { ok: false, error: 'The webhook no longer exists.', retry: false }
        }
        if (result.ok) {
          await deliveries.succeed(delivery.id)
          report.done++
          continue
        }
        const again = result.retry ? retryAfter(delivery.attempts, at) : undefined
        await deliveries.fail(delivery.id, result.error, again)
        if (again) report.retrying++
        else report.failed++
      }
      return report
    },
    logs: (subscriber, paging) => deliveries.logs({ subscriber, ...paging }),
  }
}

/** An item's type, while it still exists. */
async function itemType(db: Db, key: string): Promise<string | undefined> {
  const rows = await db.query<{ type_key: string }>(
    `SELECT tn.unique_id AS type_key FROM node n
       JOIN content c ON c.node_id = n.id
       JOIN node tn ON tn.id = c.content_type_id
      WHERE n.unique_id = ?`,
    [key],
  )
  return rows[0] ? String(rows[0].type_key).toLowerCase() : undefined
}
