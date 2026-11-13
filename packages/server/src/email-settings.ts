/**
 * E-mail set up in Settings (story 340): kept in `key_value`, its key sealed by
 * `CROMBOLO_SECRET_KEY`, and used only when the site's configuration sets no
 * e-mail. The configuration wins, because whoever sets e-mail decides where
 * password-reset links go. docs/configuration.md, "E-mail".
 */
import { isValidEmail } from '@crombolo/core'
import { type Db, now } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import {
  type EmailAvailability,
  type EmailMessage,
  type EmailPort,
  emailAvailability,
  emailFromEnvironment,
  logEmail,
  resolveEmailPort,
} from './email.ts'
import { logger } from './logging.ts'
import { openSecret, sealSecret, usableSecretKey } from './secrets.ts'

const KEY = 'crombolo:email'
/** How stale another node's copy may be before it reads again. */
export const EMAIL_SETTINGS_TTL_MS = 30_000

export const STORED_PROVIDERS = ['resend', 'postmark', 'ses', 'custom'] as const
export type StoredProvider = (typeof STORED_PROVIDERS)[number]

interface Stored {
  provider: StoredProvider
  from: string
  fromName?: string
  url?: string
  postmarkStream?: string
  sesRegion?: string
  sesAccessKeyId?: string
  /** The API key, or SES's secret access key. */
  keySealed?: string
  /** Where the key was entered for; it goes nowhere else (as story 305's client secret). */
  keyFor?: string
}

/** What an administrator sends; `key` is set only when a new one is entered. */
export type EmailSettingsInput = Partial<Omit<Stored, 'keySealed' | 'keyFor'>> & { key?: string }

interface Site {
  email?: EmailPort | null
  development?: boolean
  secretKey?: string
}

type Env = Record<string, string | undefined>

/** `config` when the site's configuration sets e-mail, `off` when it turns it off. */
export function configuredEmail(config: Site, env: Env = Bun.env): 'config' | 'off' | undefined {
  if (config.email === null) return 'off'
  if (config.email) return 'config'
  const kind = (env.CROMBOLO_EMAIL_PROVIDER ?? '').trim().toLowerCase()
  if (kind === 'none') return 'off'
  return kind ? 'config' : undefined
}

const targetOf = (s: Pick<Stored, 'provider' | 'url' | 'sesAccessKeyId'>) =>
  [s.provider, s.url ?? '', s.sesAccessKeyId ?? ''].join('|')

async function read(db: Db): Promise<Stored | undefined> {
  const row = await db.q
    .selectFrom('key_value')
    .select('value')
    .where('key', '=', KEY)
    .executeTakeFirst()
  try {
    return row?.value ? (JSON.parse(row.value) as Stored) : undefined
  } catch {
    return undefined
  }
}

async function write(db: Db, stored: Stored | undefined): Promise<void> {
  if (!stored) {
    await db.q.deleteFrom('key_value').where('key', '=', KEY).execute()
    return
  }
  const value = JSON.stringify(stored)
  const updated = await db.q
    .updateTable('key_value')
    .set({ value, update_date: now(db) })
    .where('key', '=', KEY)
    .returning('key')
    .execute()
  if (updated.length === 0)
    await db.q
      .insertInto('key_value')
      .values({ key: KEY, value, update_date: now(db) })
      .execute()
}

function keyOf(stored: Stored, secretKey: string | undefined): string {
  const key = usableSecretKey(secretKey)
  if (!stored.keySealed || !key || stored.keyFor !== targetOf(stored)) return ''
  try {
    return openSecret(stored.keySealed, key)
  } catch {
    return ''
  }
}

/** The adapter stored settings describe, through the same checks as the environment's. */
function portOf(
  stored: Stored | undefined,
  secretKey: string | undefined,
  log: { warning(message: string, properties?: Record<string, unknown>): void } = logger('email'),
): EmailPort | undefined {
  if (!stored) return undefined
  const key = keyOf(stored, secretKey)
  return emailFromEnvironment(
    {
      CROMBOLO_EMAIL_PROVIDER: stored.provider,
      CROMBOLO_EMAIL_FROM: stored.from,
      CROMBOLO_EMAIL_FROM_NAME: stored.fromName,
      CROMBOLO_EMAIL_URL: stored.url,
      CROMBOLO_EMAIL_POSTMARK_STREAM: stored.postmarkStream,
      CROMBOLO_EMAIL_SES_REGION: stored.sesRegion,
      CROMBOLO_EMAIL_SES_ACCESS_KEY_ID: stored.sesAccessKeyId,
      ...(stored.provider === 'ses'
        ? { CROMBOLO_EMAIL_SES_SECRET_ACCESS_KEY: key }
        : { CROMBOLO_EMAIL_API_KEY: key }),
    },
    log,
  )
}

/** The site's e-mail, read again from Settings as it changes. */
export interface LiveEmail extends EmailPort {
  /** Reads the settings now, on the node that saved them. */
  refresh(): Promise<void>
}

/**
 * The port a site sends through. The configuration's when it sets e-mail;
 * otherwise one that follows Settings, re-read when older than the TTL, so a
 * change reaches every node without a restart. With nothing set up it reports
 * `none`, or is the console in development.
 */
export async function siteEmail(
  db: Db,
  config: Site,
  options: { env?: Env; ttlMs?: number } = {},
): Promise<EmailPort | undefined> {
  const env = options.env ?? Bun.env
  if (configuredEmail(config, env)) return resolveEmailPort(config, env)
  const ttl = options.ttlMs ?? EMAIL_SETTINGS_TTL_MS
  const fallback = config.development ? logEmail() : undefined
  let current: EmailPort | undefined
  let readAt = 0
  let reading: Promise<void> | undefined
  const load = () => {
    reading ??= read(db)
      .then((stored) => {
        current = portOf(stored, config.secretKey) ?? fallback
        readAt = Date.now()
      })
      .catch(() => {})
      .finally(() => {
        reading = undefined
      })
    return reading
  }
  // A stale copy answers at once while the next read is under way.
  const fresh = () => {
    if (Date.now() - readAt >= ttl) void load()
    return current
  }
  await load()
  const live: LiveEmail = {
    get description() {
      return fresh()?.description ?? 'not set up'
    },
    get provider() {
      return fresh()?.provider ?? 'none'
    },
    async send(message: EmailMessage) {
      if (Date.now() - readAt >= ttl) await load()
      return current
        ? current.send(message)
        : { ok: false as const, error: 'This site has no e-mail set up.' }
    },
    refresh: load,
  }
  return live
}

/** What the card shows: never a key, only whether one is kept. */
export interface EmailSettingsView {
  /** `config`/`off`: set by the site's configuration, read-only here. */
  source: 'config' | 'off' | 'settings' | 'none'
  provider: string | null
  from: string | null
  fromName: string | null
  url: string | null
  postmarkStream: string | null
  sesRegion: string | null
  sesAccessKeyId: string | null
  keyKept: boolean
  /** Whether a key can be kept at all: the site has a secret key to seal it with. */
  canKeepKeys: boolean
  status: EmailAvailability
}

export interface EmailActor {
  id: string | null
  name: string
  email: string | null
  ipAddress?: string | null
}

export type EmailOutcome = { ok: true } | { ok: false; status: number; message: string }

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** Settings → E-mail, as an administrator uses it. */
export function createEmailSettings(
  db: Db,
  config: Site,
  options: { port: () => EmailPort | undefined; env?: Env },
) {
  const env = options.env ?? Bun.env
  const audit = (actor: EmailActor, action: string, detail: string) =>
    recordAudit(db, {
      category: 'settings',
      action,
      entityType: 'E-mail',
      entityName: 'E-mail',
      detail,
      source: 'request',
      userKey: actor.id,
      userName: actor.name,
      ipAddress: actor.ipAddress ?? null,
      forwardedFor: null,
    })
  const refresh = async () => {
    const port = options.port() as Partial<LiveEmail> | undefined
    await port?.refresh?.()
  }
  const locked = (): EmailOutcome | undefined =>
    configuredEmail(config, env)
      ? {
          ok: false,
          status: 409,
          message: "E-mail is set by the site's configuration, so it can't be changed here.",
        }
      : undefined

  return {
    async view(): Promise<EmailSettingsView> {
      const status = emailAvailability(options.port())
      const canKeepKeys = Boolean(usableSecretKey(config.secretKey))
      const fixed = configuredEmail(config, env)
      if (fixed) {
        const fromEnv = !config.email && fixed === 'config'
        return {
          source: fixed,
          provider:
            fixed === 'off' ? null : (config.email?.provider ?? text(env.CROMBOLO_EMAIL_PROVIDER)),
          from: fromEnv ? text(env.CROMBOLO_EMAIL_FROM) || null : null,
          fromName: fromEnv ? text(env.CROMBOLO_EMAIL_FROM_NAME) || null : null,
          url: fromEnv ? text(env.CROMBOLO_EMAIL_URL) || null : null,
          postmarkStream: null,
          sesRegion: fromEnv ? text(env.CROMBOLO_EMAIL_SES_REGION) || null : null,
          sesAccessKeyId: null,
          keyKept: false,
          canKeepKeys,
          status,
        }
      }
      const stored = await read(db)
      return {
        source: stored ? 'settings' : 'none',
        provider: stored?.provider ?? null,
        from: stored?.from ?? null,
        fromName: stored?.fromName ?? null,
        url: stored?.url ?? null,
        postmarkStream: stored?.postmarkStream ?? null,
        sesRegion: stored?.sesRegion ?? null,
        sesAccessKeyId: stored?.sesAccessKeyId ?? null,
        keyKept: Boolean(stored && keyOf(stored, config.secretKey)),
        canKeepKeys,
        status,
      }
    },

    async save(actor: EmailActor, input: EmailSettingsInput): Promise<EmailOutcome> {
      const refused = locked()
      if (refused) return refused
      const provider = text(input.provider) as StoredProvider
      if (!STORED_PROVIDERS.includes(provider))
        return { ok: false, status: 400, message: 'Choose a provider.' }
      const from = text(input.from)
      if (!isValidEmail(from))
        return { ok: false, status: 400, message: 'Enter the address e-mail is sent from.' }
      const next: Stored = {
        provider,
        from,
        ...(text(input.fromName) ? { fromName: text(input.fromName) } : {}),
      }
      if (provider === 'custom' || text(input.url)) {
        const url = text(input.url)
        if (provider === 'custom' && !url)
          return { ok: false, status: 400, message: 'Enter the address messages are sent to.' }
        if (url) next.url = url
      }
      if (provider === 'postmark' && text(input.postmarkStream))
        next.postmarkStream = text(input.postmarkStream)
      if (provider === 'ses') {
        next.sesRegion = text(input.sesRegion)
        next.sesAccessKeyId = text(input.sesAccessKeyId)
        if (!next.sesRegion)
          return { ok: false, status: 400, message: 'Enter the Amazon SES region.' }
        if (!next.sesAccessKeyId)
          return { ok: false, status: 400, message: 'Enter the access key ID.' }
      }

      const key = text(input.key)
      const secretKey = usableSecretKey(config.secretKey)
      if (key) {
        if (!secretKey)
          return {
            ok: false,
            status: 400,
            message:
              "This site can't keep e-mail keys until whoever hosts it gives it a secret key.",
          }
        next.keySealed = sealSecret(key, secretKey)
        next.keyFor = targetOf(next)
      } else {
        const before = await read(db)
        // A kept key stays only while it is for the same provider and address.
        if (before?.keySealed && before.keyFor === targetOf(next)) {
          next.keySealed = before.keySealed
          next.keyFor = before.keyFor
        } else if (provider !== 'custom')
          return {
            ok: false,
            status: 400,
            message: before?.keySealed
              ? 'Enter the key again: a key is only used with the provider and address it was entered for.'
              : 'Enter the key from your provider.',
          }
      }

      const problems: string[] = []
      const built = portOf(next, config.secretKey, {
        warning: (_message, properties) => problems.push(String(properties?.detail ?? '')),
      })
      if (!built)
        return {
          ok: false,
          status: 400,
          message: `Those settings can't be used. ${problems.filter(Boolean).join(' ')}`.trim(),
        }

      await write(db, next)
      await audit(actor, 'Save', `${provider}, from ${from}${key ? ', key changed' : ''}`)
      await refresh()
      return { ok: true }
    },

    async clear(actor: EmailActor): Promise<EmailOutcome> {
      const refused = locked()
      if (refused) return refused
      await write(db, undefined)
      await audit(actor, 'Clear', 'e-mail settings removed')
      await refresh()
      return { ok: true }
    },

    /** A message to the administrator, through whatever is in force now. */
    async test(actor: EmailActor): Promise<EmailOutcome> {
      if (!actor.email || !isValidEmail(actor.email))
        return { ok: false, status: 400, message: 'Your account has no e-mail address to send to.' }
      const port = options.port()
      if (!port || port.provider === 'none')
        return { ok: false, status: 409, message: 'Set up e-mail first.' }
      const result = await port.send({
        to: [{ email: actor.email, name: actor.name }],
        subject: 'A test e-mail from your site',
        text: 'This message shows that your site can send e-mail.',
      })
      return result.ok
        ? { ok: true }
        : { ok: false, status: 502, message: `The test e-mail was not sent: ${result.error}` }
    },
  }
}
