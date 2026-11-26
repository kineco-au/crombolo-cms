/**
 * Story 191: a member provider with several flows, as Azure AD B2C's user flows
 * are, against a fake issuer serving each policy's own metadata and keys.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMemberTicket, signMemberTicket } from '@crombolo/auth'
import { externalSignInUrl } from '@crombolo/crombolo'
import {
  ExternalLoginRepository,
  externalLoginProvider,
  MemberRepository,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import {
  b2c,
  type CromboloConfig,
  checkIdentityProviders,
  claimAsStored,
  effectiveProvider,
  IdentityProviderOverrides,
  oidc,
} from '@crombolo/server'
import { type FakeOidc, startFakeOidc } from './support/fake-oidc.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Array<Pick<Harness, 'db'>> = []
const fakes: FakeOidc[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (fakes.length > 0) fakes.pop()?.stop()
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const CLIENT_ID = 'crombolo-site'
const KEY = 'a-secret-key-for-sealing-client-secrets-191'

describe('the b2c preset', () => {
  const given = { clientId: 'c', clientSecret: 's' }

  test('builds an issuer per policy', () => {
    const provider = b2c({
      ...given,
      tenant: 'contoso',
      flows: { signIn: 'B2C_1_susi', signUp: 'B2C_1_up', resetPassword: 'B2C_1_reset' },
    })
    expect(provider.oidc).toMatchObject({
      id: 'b2c',
      issuer: 'https://contoso.b2clogin.com/contoso.onmicrosoft.com/B2C_1_susi/v2.0',
      scopes: ['openid'],
      claims: { email: 'emails', name: 'name' },
    })
    expect(provider.flows.resetPassword).toMatchObject({
      issuer: 'https://contoso.b2clogin.com/contoso.onmicrosoft.com/B2C_1_reset/v2.0',
      clientSecret: 's',
    })
    expect(Object.keys(provider.flows)).toEqual(['signUp', 'resetPassword'])
    expect([provider.linkByEmail, provider.signOut]).toEqual([false, true])
  })

  test('takes a full tenant name, or an id with a custom domain', () => {
    const flows = { signIn: 'B2C_1_susi' }
    expect(b2c({ ...given, tenant: 'contoso.onmicrosoft.com', flows }).oidc.issuer).toBe(
      'https://contoso.b2clogin.com/contoso.onmicrosoft.com/B2C_1_susi/v2.0',
    )
    const id = '11111111-2222-3333-4444-555555555555'
    expect(b2c({ ...given, tenant: id, domain: 'login.example', flows }).oidc.issuer).toBe(
      `https://login.example/${id}/B2C_1_susi/v2.0`,
    )
    expect(() => b2c({ ...given, tenant: id, flows })).toThrow('domain')
  })

  test('refuses missing settings, a page elsewhere, and a flow on another address', () => {
    const flows = { signIn: 'B2C_1_susi' }
    expect(() => b2c({ ...given, tenant: '', flows })).toThrow('tenant')
    expect(() => b2c({ ...given, tenant: 'x', flows: { signIn: '' } })).toThrow('signIn')
    for (const url of ['https://evil.example/', '//evil.example', '/\\evil.example'])
      expect(() => b2c({ ...given, tenant: 'x', flows, cancelUrl: url })).toThrow('cancelUrl')
    const base = { ...given, id: 'x', name: 'X', issuer: 'https://a.example/s' }
    expect(() => oidc({ ...base, flows: { reset: 'https://b.example/r' } })).toThrow('address')
    expect(() => oidc({ ...base, flows: { signIn: 'https://a.example/r' } })).toThrow('flow')
  })

  test('is refused in the back office with what only members have', () => {
    const provider = b2c({ ...given, tenant: 'x', flows: { signIn: 'a' } })
    expect(() => checkIdentityProviders([provider], 'backoffice')).toThrow('members only')
    expect(() => checkIdentityProviders([provider], 'member')).not.toThrow()
  })
})

test("an override of the client reaches every flow, and the issuer stays the config's", () => {
  const code = b2c({
    tenant: 'contoso',
    clientId: 'c',
    clientSecret: 's',
    flows: { signIn: 'a', resetPassword: 'r' },
  })
  const changed = effectiveProvider(code, {
    clientId: 'other',
    clientSecret: 'theirs',
    issuer: 'https://evil.example',
  })
  expect(changed.oidc).toMatchObject({ issuer: code.oidc.issuer, clientId: 'other' })
  expect(changed.flows.resetPassword).toMatchObject({
    issuer: code.flows.resetPassword?.issuer,
    clientId: 'other',
    clientSecret: 'theirs',
  })
})

test('a claim is stored as its property keeps it, or not at all', () => {
  expect(claimAsStored(true, 'Integer')).toBe(1)
  expect(claimAsStored('False', 'Integer')).toBe(0)
  expect(claimAsStored('42', 'Integer')).toBe(42)
  expect(claimAsStored('lots', 'Integer')).toBeUndefined()
  expect(claimAsStored('1.5', 'Decimal')).toBe(1.5)
  expect(claimAsStored('', 'Decimal')).toBeUndefined()
  expect(claimAsStored('yesterday', 'Date')).toBeUndefined()
  expect(claimAsStored('Dr', 'Nvarchar')).toBe('Dr')
  expect(claimAsStored({ a: 1 }, 'Ntext')).toBeUndefined()
})

test('a link names its flow', () => {
  expect(externalSignInUrl('b2c', '/me', { flow: 'editProfile' })).toBe(
    '/umbraco/members/external/b2c?flow=editProfile&returnUrl=%2Fme',
  )
  expect(externalSignInUrl('b2c', '/me')).toBe('/umbraco/members/external/b2c?returnUrl=%2Fme')
  expect(externalSignInUrl('b2c')).toBe('/umbraco/members/external/b2c')
})

const MEMBER_TYPE = `[member-type]
alias = "recorder"
name = "Recorder"

[[property]]
alias = "title"
name = "Title"
type = "textstring"

[[property]]
alias = "adult"
name = "Adult"
type = "trueFalse"

[[property]]
alias = "note"
name = "Note"
type = "textstring"
`

async function site(
  options: Partial<Parameters<typeof oidc>[0]> = {},
  config: Partial<CromboloConfig> = {},
  issuer: { endSession?: boolean } = {},
) {
  const fake = await startFakeOidc(CLIENT_ID, issuer)
  fakes.push(fake)
  const root = mkdtempSync(join(process.cwd(), 'output', 'member-user-flows-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'member-types'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'member-types', 'recorder.toml'), MEMBER_TYPE)
  const provider = {
    ...oidc({
      id: 'b2c',
      name: 'B2C',
      issuer: fake.policy('susi'),
      clientId: CLIENT_ID,
      clientSecret: 'shh',
      scopes: ['openid'],
      claims: { email: 'emails' },
      flows: {
        signUp: fake.policy('up'),
        resetPassword: fake.policy('reset'),
        editProfile: fake.policy('edit'),
      },
      memberType: 'recorder',
      ...options,
    }),
    forgottenPassword: 'AADB2C90118',
  }
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), memberIdentityProviders: [provider], ...config },
  })
  open.push(h)
  const visit = (path: string, init: RequestInit = {}) =>
    h.server.fetch(new Request(`http://localhost${path}`, { redirect: 'manual', ...init }))
  const flowCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0] as string)
      .find((c) => c.startsWith('crombolo-external-member=') && !c.endsWith('='))
  const memberCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0] as string)
      .find((c) => /^(__Host-)?umbMember/.test(c) && !c.endsWith('='))
  /** Goes to the provider a redirect names and comes back from it. */
  const through = async (left: Response) => {
    const at = await fetch(left.headers.get('location') as string, { redirect: 'manual' })
    const callback = new URL(at.headers.get('location') as string)
    return visit(`${callback.pathname}${callback.search}`, {
      headers: { cookie: flowCookie(left) as string },
    })
  }
  const start = (flow?: string, returnUrl = '/me') =>
    visit(externalSignInUrl('b2c', returnUrl, flow ? { flow } : {}))
  const signIn = async (flow?: string) => {
    const back = await through(await start(flow))
    return { location: back.headers.get('location') ?? '', member: memberCookie(back) }
  }
  const members = new MemberRepository(h.server.db)
  const valuesOf = async (email: string) => {
    const member = await members.byEmail(email)
    const stored = await h.json<{ values: Array<{ alias: string; value: unknown }> }>(
      `${V1}/member/${member?.key}`,
    )
    return Object.fromEntries(stored.values.map((v) => [v.alias, v.value]))
  }
  return { h, fake, visit, start, through, signIn, members, valuesOf, memberCookie }
}

describe(`members and a provider's flows (${process.env.CROMBOLO_DB ?? 'sqlite'})`, () => {
  test('each flow is started by name, and an unknown one is not found', async () => {
    const { fake, signIn, start, members } = await site()
    fake.as({ sub: 'ada-1', emails: ['Ada@example.test', 'other@example.test'], name: 'Ada' })
    expect((await signIn()).location).toBe('/me')
    expect(fake.lastPolicy()).toBe('susi')
    expect((await members.byEmail('ada@example.test'))?.contentTypeAlias).toBe('recorder')
    for (const [flow, policy] of [
      ['signIn', 'susi'],
      ['signUp', 'up'],
      ['editProfile', 'edit'],
    ] as const) {
      expect((await signIn(flow)).member).toBeDefined()
      expect(fake.lastPolicy()).toBe(policy)
    }
    expect((await members.filter({ skip: 0, take: 10 })).total).toBe(1)
    for (const flow of ['nope', 'constructor', '__proto__'])
      expect((await start(flow)).status).toBe(404)
  })

  test('a forgotten password starts the reset, which ends signed in where they were going', async () => {
    const { fake, start, through, memberCookie } = await site()
    fake.as({ sub: 'ada-1', emails: ['ada@example.test'] })
    fake.refuse('access_denied', 'AADB2C90118: The user has forgotten their password.')
    const reset = await through(await start())
    expect(reset.headers.get('location')).toStartWith(`${fake.policy('reset')}/authorize`)
    const back = await through(reset)
    expect(back.headers.get('location')).toBe('/me')
    expect(memberCookie(back)).toBeDefined()
    expect(fake.lastPolicy()).toBe('reset')
  })

  test('the reset answering the same never starts itself again', async () => {
    const { fake, start, through } = await site()
    fake.refuse('access_denied', 'AADB2C90118: again')
    const back = await through(await start('resetPassword'))
    expect(back.headers.get('location')).toContain('memberLoginFailed=1')
  })

  test('cancelling and failing go to the pages the site names', async () => {
    const { fake, start, through } = await site({ cancelUrl: '/cancelled', failedUrl: '/trouble' })
    fake.refuse('access_denied', 'AADB2C90091: The user has cancelled.')
    expect((await through(await start())).headers.get('location')).toBe('/cancelled')
    fake.refuse('server_error', 'AADB2C: broken')
    expect((await through(await start())).headers.get('location')).toStartWith(
      '/trouble?memberLoginFailed=1',
    )
  })

  test('without those pages both go back with the reason, as before', async () => {
    const { fake, start, through } = await site()
    for (const error of ['access_denied', 'server_error']) {
      fake.refuse(error, 'no')
      expect((await through(await start())).headers.get('location')).toStartWith(
        '/me?memberLoginFailed=1',
      )
    }
  })

  test('an error from a flow this browser did not start moves nobody', async () => {
    const { start, visit } = await site({ cancelUrl: '/cancelled' })
    const left = await start()
    const cookie = left.headers.getSetCookie()[0]?.split(';')[0] as string
    const forged = await visit(
      '/umbraco/members/external/b2c/callback?error=access_denied&error_description=AADB2C90118&state=forged',
      { headers: { cookie } },
    )
    expect(forged.headers.get('location')).toStartWith('/me?memberLoginFailed=1')
  })

  test('mapped claims fill a new member and follow every flow after', async () => {
    const { h, fake, signIn, members, valuesOf } = await site({
      properties: { title: 'extension_Title', adult: 'extension_Adult' },
    })
    const ada = { sub: 'ada-1', emails: ['ada@example.test'], name: 'Ada' }
    fake.as({ ...ada, extension_Title: ['Dr'], extension_Adult: true })
    await signIn('signUp')
    expect(await valuesOf('ada@example.test')).toMatchObject({ title: 'Dr', adult: true })

    const member = await members.byEmail('ada@example.test')
    const edited = await h.put(`${V1}/member/${member?.key}`, {
      email: 'ada@example.test',
      username: 'ada@example.test',
      isApproved: true,
      isLockedOut: false,
      isTwoFactorEnabled: false,
      groups: [],
      values: [
        { alias: 'title', culture: null, segment: null, value: 'Dr' },
        { alias: 'adult', culture: null, segment: null, value: true },
        { alias: 'note', culture: null, segment: null, value: 'Kept' },
      ],
      variants: [{ culture: null, segment: null, name: 'Ada L' }],
    })
    expect(edited.status).toBe(200)

    // A claim left out leaves its property; another changed is written; the rest is kept.
    fake.as({ ...ada, extension_Title: 'Prof' })
    expect((await signIn('editProfile')).member).toBeDefined()
    expect(await valuesOf('ada@example.test')).toMatchObject({
      title: 'Prof',
      adult: true,
      note: 'Kept',
    })
    expect((await members.byEmail('ada@example.test'))?.name).toBe('Ada L')

    // Nothing changed, so nothing is saved.
    const before = (await members.content.byKey(member?.key as string))?.revision
    await signIn()
    expect((await members.content.byKey(member?.key as string))?.revision).toBe(before as string)
  })

  test('a property the member type lacks stops the boot, named', async () => {
    await expect(site({ properties: { missing: 'extension_Missing' } })).rejects.toThrow(
      'The identity provider "b2c" maps the claim "extension_Missing" to "missing", which the member type "recorder" does not have.',
    )
  })

  test("a member is linked by the provider's id, never by an email that matches", async () => {
    const { h, fake, signIn } = await site({ subjectClaim: 'oid' })
    await h.post(`${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: 'ada@example.test',
      username: 'ada',
      isApproved: true,
      groups: [],
      values: [],
      variants: [{ culture: null, segment: null, name: 'Ada' }],
    })
    fake.as({ sub: 'x', oid: 'ada-oid', emails: ['ada@example.test'], email_verified: true })
    expect((await signIn()).member).toBeUndefined()

    fake.as({ sub: 'x', oid: 'grace-oid', emails: ['grace@example.test'] })
    expect((await signIn()).member).toBeDefined()
    const logins = new ExternalLoginRepository(h.server.db)
    expect(await logins.find(externalLoginProvider('member', 'b2c'), 'grace-oid')).toBeDefined()
    fake.as({ sub: 'y', emails: ['nobody@example.test'] })
    expect((await signIn()).member).toBeUndefined()
  })

  test("the issuer of a provider with flows is the config's", async () => {
    const { h, fake } = await site({}, { secretKey: KEY })
    const store = new IdentityProviderOverrides(h.server.db, KEY)
    const code = oidc({
      id: 'b2c',
      name: 'B2C',
      issuer: fake.policy('susi'),
      clientId: CLIENT_ID,
      flows: { resetPassword: fake.policy('reset') },
    })
    expect(
      await store.update('member', code, { issuer: 'https://evil.example', clientSecret: 's' }),
    ).toMatchObject({ ok: false, error: expect.stringContaining('cannot be changed here') })
  })
})

describe('signing out', () => {
  const logout = (
    visit: (path: string, init?: RequestInit) => Promise<Response>,
    cookie: string,
    json = false,
  ) =>
    visit('/umbraco/members/logout', {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://localhost',
        'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded',
      },
      body: json ? JSON.stringify({ returnUrl: '/bye' }) : 'returnUrl=%2Fbye',
    })

  test("ends the site's session and then the provider's", async () => {
    const { fake, signIn, visit } = await site({ signOut: true }, {}, { endSession: true })
    fake.as({ sub: 'ada-1', emails: ['ada@example.test'] })
    const { member } = await signIn()
    const form = await logout(visit, member as string)
    expect(form.status).toBe(303)
    const url = new URL(form.headers.get('location') as string)
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.policy('susi')}/logout`)
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost/bye')
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(form.headers.getSetCookie().some((c) => /umbMember[^=]*=;/.test(c))).toBe(true)

    const json = await logout(visit, member as string, true)
    expect(((await json.json()) as { signOutUrl: string }).signOutUrl).toBe(url.href)
  })

  test('stays here when the provider has nowhere to go, or was not asked to', async () => {
    const without = await site({ signOut: true })
    without.fake.as({ sub: 'ada-1', emails: ['ada@example.test'] })
    const first = await without.signIn()
    const answer = await logout(without.visit, first.member as string)
    expect(answer.headers.get('location')).toBe('/bye')
    await without.h.db.close()
    open.pop()

    const off = await site({}, {}, { endSession: true })
    off.fake.as({ sub: 'ada-1', emails: ['ada@example.test'] })
    const second = await off.signIn()
    expect((await logout(off.visit, second.member as string)).headers.get('location')).toBe('/bye')
  })

  test('a ticket from before providers were remembered is still one', async () => {
    const expires = Math.floor(Date.now() / 1000) + 60
    const ticket = await signMemberTicket('k', { id: 'm', stamp: 's', expires })
    expect(await readMemberTicket('k', ticket)).toEqual({ id: 'm', stamp: 's', expires })
  })
})
