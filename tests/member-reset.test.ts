/**
 * Story 282: a member asks for a link and sets a new password on the site's own page. The
 * answer never says whether an address is known; a member who signs in through a provider is
 * told so instead; the link works once and for a day; a reset unlocks, ends sessions and
 * spends the other links. Asking, resetting and signing in are limited per address and IP.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  AuditLog,
  ExternalLoginRepository,
  externalLoginProvider,
  MemberRepository,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import type { EmailMessage, EmailPort } from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

function capturing(): EmailPort & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    description: 'test',
    provider: 'custom',
    async send(message) {
      sent.push(message)
      return { ok: true, id: 'x' }
    },
  }
}

async function until<T>(read: () => T, done: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = read()
    if (done(value)) return value
    await Bun.sleep(20)
  }
  return read()
}

async function server(
  members: Record<string, unknown> = {},
  email: EmailPort | null = capturing(),
) {
  const h = await signedInServer({
    config: {
      email,
      applicationUrl: 'https://site.example',
      members: { resetPasswordPage: '/account/reset-password', ...members },
    },
  })
  open.push(h)
  return { h, email: email as ReturnType<typeof capturing> }
}

async function member(h: Harness, name: string, password?: string) {
  const created = await h.post(`${V1}/member`, {
    memberType: { id: SYSTEM_MEMBER_TYPE.key },
    email: `${name}@example.test`,
    username: name,
    ...(password ? { password } : {}),
    isApproved: true,
    groups: [],
    values: [],
    variants: [{ culture: null, segment: null, name }],
  })
  expect(created.status, await created.clone().text()).toBe(201)
  return created.headers.get('umb-generated-resource') as string
}

const post = (h: Harness, path: string, body: Record<string, string>, ip = '203.0.113.9') =>
  h.server.fetch(
    new Request(`${ORIGIN}/umbraco/members/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify(body),
    }),
  )

const tokenIn = (message: EmailMessage | undefined) =>
  decodeURIComponent(/token=([^\s&]+)/.exec(message?.text ?? '')?.[1] ?? '')

describe(`a member resets their password (${dialectUnderTest})`, () => {
  test('asks by address, answered alike for anyone, and sets one on the site’s page', async () => {
    const { h, email } = await server()
    const key = await member(h, 'ana', 'an old password, long enough')
    const known = await post(h, 'forgot-password', { email: 'ANA@example.test' })
    const unknown = await post(h, 'forgot-password', { email: 'nobody@example.test' })
    expect(known.status).toBe(200)
    expect(await known.json()).toEqual(await unknown.json())
    const [message] = await until(
      () => email.sent,
      (sent) => sent.length > 0,
    )
    expect(email.sent).toHaveLength(1)
    expect(message?.to).toEqual([{ name: 'ana', email: 'ana@example.test' }])
    expect(message?.text).toContain('https://site.example/account/reset-password?token=')
    const token = tokenIn(message)

    expect(
      (await post(h, 'reset-password', { token, password: 'short' })).status,
      'a weak password keeps the link',
    ).toBe(400)
    expect(
      (await post(h, 'reset-password', { token, password: 'a brand new password' })).status,
    ).toBe(200)
    // Once only.
    expect(
      (await post(h, 'reset-password', { token, password: 'another new password' })).status,
    ).toBe(400)
    const signIn = await post(h, 'login', { username: 'ana', password: 'a brand new password' })
    expect(signIn.status).toBe(200)
    const audit = await new AuditLog(h.server.db).query({ entityKey: key })
    expect(audit.items.map((e) => e.action)).toContain('ResetPassword')
    expect(JSON.stringify(audit.items)).not.toContain(token)
  })

  test('works for a member with no password; unlocks, ends sessions and spends other links', async () => {
    const { h, email } = await server()
    const key = await member(h, 'bo')
    const repository = new MemberRepository(h.server.db)
    await repository.recordFailedLogin(key, 1)
    expect((await repository.byKey(key))?.isLockedOut).toBe(true)
    const stamp = (await repository.byKey(key))?.securityStamp

    await post(h, 'forgot-password', { email: 'bo@example.test' })
    await post(h, 'forgot-password', { email: 'bo@example.test' })
    const sent = await until(
      () => email.sent,
      (s) => s.length >= 2,
    )
    const [first, second] = sent.map(tokenIn)
    expect(
      (
        await post(h, 'reset-password', {
          token: second as string,
          password: 'bo has a password now',
        })
      ).status,
    ).toBe(200)
    const after = await repository.byKey(key)
    expect(after?.isLockedOut).toBe(false)
    expect(after?.securityStamp).not.toBe(stamp)
    expect(
      (
        await post(h, 'reset-password', {
          token: first as string,
          password: 'bo tries the first link',
        })
      ).status,
    ).toBe(400)
  })

  test('an expired link does nothing', async () => {
    const { h, email } = await server()
    await member(h, 'cy', 'cy has a password already')
    await post(h, 'forgot-password', { email: 'cy@example.test' })
    const [message] = await until(
      () => email.sent,
      (s) => s.length > 0,
    )
    await h.server.db.q
      .updateTable('member_reset_token')
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .execute()
    expect(
      (await post(h, 'reset-password', { token: tokenIn(message), password: 'too late for this' }))
        .status,
    ).toBe(400)
  })

  test('a member who signs in through a provider is told so, and gets no link', async () => {
    const { h, email } = await server()
    const key = await member(h, 'di')
    await new ExternalLoginRepository(h.server.db).link(
      key,
      externalLoginProvider('member', 'b2c'),
      'di-oid',
    )
    const answered = await post(h, 'forgot-password', { email: 'di@example.test' })
    expect(answered.status).toBe(200)
    const [message] = await until(
      () => email.sent,
      (s) => s.length > 0,
    )
    expect(message?.text).toContain('You sign in with b2c')
    expect(message?.text).not.toContain('token=')
    expect(await h.server.db.q.selectFrom('member_reset_token').selectAll().execute()).toEqual([])
  })

  test('the site may write the e-mail itself', async () => {
    const { h, email } = await server({
      resetPasswordEmail: (who: { name: string }, link: string) => ({
        subject: `Kia ora ${who.name}`,
        text: `Your link: ${link}`,
      }),
    })
    await member(h, 'ed', 'ed has a password already')
    await post(h, 'forgot-password', { email: 'ed@example.test' })
    const [message] = await until(
      () => email.sent,
      (s) => s.length > 0,
    )
    expect(message?.subject).toBe('Kia ora ed')
    expect(message?.text).toStartWith(
      'Your link: https://site.example/account/reset-password?token=',
    )
  })

  test('without a reset page or a way to send mail, reset is unavailable', async () => {
    const noPage = await signedInServer({ config: { email: capturing() } })
    open.push(noPage)
    expect((await post(noPage, 'forgot-password', { email: 'a@example.test' })).status).toBe(503)
    const { h } = await server({}, null)
    expect((await post(h, 'forgot-password', { email: 'a@example.test' })).status).toBe(503)
  })

  test('asking is limited per address quietly and per IP aloud; signing in per IP', async () => {
    const { h, email } = await server({
      rateLimits: { forgotPerAddressPerHour: 2, forgotPerIpPerHour: 4, signInPerIpPerMinute: 3 },
    })
    await member(h, 'fy', 'fy has a password already')
    for (let i = 0; i < 3; i++)
      expect((await post(h, 'forgot-password', { email: 'fy@example.test' })).status).toBe(200)
    await until(
      () => email.sent,
      (s) => s.length >= 2,
    )
    await Bun.sleep(100)
    expect(email.sent).toHaveLength(2)
    expect((await post(h, 'forgot-password', { email: 'x@example.test' })).status).toBe(200)
    const limited = await post(h, 'forgot-password', { email: 'y@example.test' })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBeTruthy()
    // Another address behind another IP is its own.
    expect(
      (await post(h, 'forgot-password', { email: 'y@example.test' }, '198.51.100.7')).status,
    ).toBe(200)

    for (let i = 0; i < 3; i++)
      expect(
        (await post(h, 'login', { username: 'fy', password: 'wrong' }, '192.0.2.1')).status,
      ).toBe(401)
    expect(
      (await post(h, 'login', { username: 'fy', password: 'wrong' }, '192.0.2.1')).status,
    ).toBe(429)
  })
})
