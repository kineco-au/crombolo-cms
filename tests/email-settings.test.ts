/**
 * Story 340: e-mail set up in Settings, used only when the configuration sets
 * none, its key sealed and bound to where it was entered for, and taking
 * effect without a restart.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { Db } from '@crombolo/data'
import {
  configuredEmail,
  createEmailSettings,
  type EmailPort,
  emailAvailability,
  emailReady,
  logEmail,
  siteEmail,
} from '@crombolo/server'
import { migratedDb } from './support/db.ts'

const SECRET = 'a-secret-key-that-is-long-enough-to-use'
const ADMIN = { id: null, name: 'Mia', email: 'mia@example.org' }
const NO_ENV = {}

const dbs: Db[] = []
const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()?.close()
  while (servers.length > 0) servers.pop()?.stop(true)
})

async function site(
  config: { secretKey?: string; development?: boolean; email?: EmailPort | null } = {},
) {
  const db = await migratedDb()
  dbs.push(db)
  const site = { secretKey: SECRET, ...config }
  const port = await siteEmail(db, site, { env: NO_ENV })
  const settings = createEmailSettings(db, site, { port: () => port, env: NO_ENV })
  return { db, site, port, settings }
}

/** A custom endpoint on this machine, recording what it is sent. */
function endpoint() {
  const received: { authorization: string | null; body: { subject?: string } }[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        authorization: request.headers.get('authorization'),
        body: (await request.json()) as { subject?: string },
      })
      return Response.json({ id: 'sent-1' })
    },
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}/send`, received }
}

describe('where e-mail is set (story 340)', () => {
  test('the configuration wins, and "none" turns it off', () => {
    expect(configuredEmail({}, {})).toBeUndefined()
    expect(configuredEmail({}, { CROMBOLO_EMAIL_PROVIDER: 'resend' })).toBe('config')
    expect(configuredEmail({}, { CROMBOLO_EMAIL_PROVIDER: 'none' })).toBe('off')
    expect(configuredEmail({ email: null }, {})).toBe('off')
    expect(configuredEmail({ email: logEmail() }, {})).toBe('config')
  })

  test('with e-mail in the configuration, the card is read-only and a save is refused', async () => {
    const { settings } = await site({ email: logEmail() })
    expect((await settings.view()).source).toBe('config')
    const saved = await settings.save(ADMIN, {
      provider: 'resend',
      from: 'a@example.org',
      key: 'k',
    })
    expect(saved).toMatchObject({ ok: false, status: 409 })
  })

  test('with nothing set up, there is no e-mail, or the log in development', async () => {
    const production = await site()
    expect(emailReady(production.port)).toBe(false)
    expect(emailAvailability(production.port).available).toBe(false)
    expect((await production.settings.view()).source).toBe('none')
    const development = await site({ development: true })
    expect(development.port?.provider).toBe('log')
  })
})

describe('saving e-mail settings (story 340)', () => {
  test('takes effect at once, and sends through what was saved', async () => {
    const { port, settings } = await site()
    const { url, received } = endpoint()
    const saved = await settings.save(ADMIN, {
      provider: 'custom',
      from: 'no-reply@example.org',
      url,
      key: 'token-1',
    })
    expect(saved).toEqual({ ok: true })
    expect(emailReady(port)).toBe(true)
    expect(emailAvailability(port).available).toBe(true)
    expect(await settings.test(ADMIN)).toEqual({ ok: true })
    expect(received[0]?.authorization).toBe('Bearer token-1')
    expect(received[0]?.body.subject).toBe('A test e-mail from your site')
  })

  test('the key is sealed, never shown, and kept while the provider and address stay', async () => {
    const { db, settings } = await site()
    const { url, received } = endpoint()
    await settings.save(ADMIN, { provider: 'custom', from: 'a@example.org', url, key: 'token-1' })
    const row = await db.q
      .selectFrom('key_value')
      .select('value')
      .where('key', '=', 'crombolo:email')
      .executeTakeFirstOrThrow()
    expect(row.value).not.toContain('token-1')
    const view = await settings.view()
    expect(view).toMatchObject({ source: 'settings', provider: 'custom', keyKept: true })
    expect(JSON.stringify(view)).not.toContain('token-1')

    expect(await settings.save(ADMIN, { provider: 'custom', from: 'b@example.org', url })).toEqual({
      ok: true,
    })
    await settings.test(ADMIN)
    expect(received.at(-1)?.authorization).toBe('Bearer token-1')
  })

  test('a kept key does not follow a new provider or address', async () => {
    const { settings } = await site()
    const first = endpoint()
    const second = endpoint()
    await settings.save(ADMIN, {
      provider: 'custom',
      from: 'a@example.org',
      url: first.url,
      key: 'k',
    })
    // A custom endpoint needs no key, so it saves, without the old one.
    await settings.save(ADMIN, { provider: 'custom', from: 'a@example.org', url: second.url })
    expect((await settings.view()).keyKept).toBe(false)
    await settings.test(ADMIN)
    expect(second.received[0]?.authorization).toBeNull()

    const resend = await settings.save(ADMIN, { provider: 'resend', from: 'a@example.org' })
    expect(resend).toMatchObject({ ok: false, status: 400 })
  })

  test('a key needs the site secret key to be kept', async () => {
    const { settings } = await site({ secretKey: undefined })
    expect((await settings.view()).canKeepKeys).toBe(false)
    const saved = await settings.save(ADMIN, {
      provider: 'resend',
      from: 'a@example.org',
      key: 'k',
    })
    expect(saved).toMatchObject({ ok: false, status: 400 })
  })

  test('refuses what cannot be used', async () => {
    const { settings } = await site()
    expect(
      await settings.save(ADMIN, { provider: 'carrier-pigeon' as 'resend', from: 'a@example.org' }),
    ).toMatchObject({ ok: false, message: 'Choose a provider.' })
    expect(
      await settings.save(ADMIN, { provider: 'resend', from: 'not an address', key: 'k' }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await settings.save(ADMIN, { provider: 'ses', from: 'a@example.org', key: 'k' }),
    ).toMatchObject({ ok: false, message: 'Enter the Amazon SES region.' })
    expect(
      await settings.save(ADMIN, {
        provider: 'custom',
        from: 'a@example.org',
        url: 'http://mail.example.org',
      }),
    ).toMatchObject({ ok: false, status: 400 })
  })

  test('saving and removing are audited, without the key', async () => {
    const { db, port, settings } = await site()
    const { url } = endpoint()
    await settings.save(ADMIN, { provider: 'custom', from: 'a@example.org', url, key: 'token-1' })
    await settings.clear(ADMIN)
    expect(emailReady(port)).toBe(false)
    const audit = await db.q
      .selectFrom('audit_entry')
      .select(['action', 'detail'])
      .where('entity_type', '=', 'E-mail')
      .orderBy('id')
      .execute()
    expect(audit.map((entry) => entry.action)).toEqual(['Save', 'Clear'])
    expect(JSON.stringify(audit)).not.toContain('token-1')
  })

  test('another node picks up a change once its copy is stale', async () => {
    const { db, site: config, settings } = await site()
    const other = await siteEmail(db, config, { env: NO_ENV, ttlMs: 0 })
    expect(emailReady(other)).toBe(false)
    const { url } = endpoint()
    await settings.save(ADMIN, { provider: 'custom', from: 'a@example.org', url })
    const result = await other?.send({
      to: [{ email: 'b@example.org' }],
      subject: 'Hi',
      text: 'Hi',
    })
    expect(result?.ok).toBe(true)
    expect(emailReady(other)).toBe(true)
  })
})
