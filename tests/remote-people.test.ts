/**
 * Story 364: a person signed in through a provider reaches the remote. A token
 * one of the site's back-office providers issued for the remote's audience is
 * exchanged for a fifteen-minute sign-in as the person it names, found by the
 * claim their last sign-in recorded. A test issuer here signs the tokens.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { AuthStore, DeviceStore } from '@crombolo/auth'
import {
  AuditLog,
  auditRecord,
  detailInContext,
  ExternalLoginRepository,
  externalLoginProvider,
  SingleUseTokens,
  UserRepository,
} from '@crombolo/data'
import {
  actorOf,
  entra,
  exchangeAudienceClashes,
  exchangingProviders,
  type IdentityProvider,
  JWT_TOKEN_TYPE,
  loadConfig,
  oidc,
  REMOTE_API_PATH,
  REMOTE_DISCOVERY_PATH,
  TOKEN_EXCHANGE_GRANT,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const API = `${ORIGIN}${REMOTE_API_PATH}`
const AUDIENCE = 'api://crombolo-remote'
const CLIENT_ID = 'back-office-app'

let issuer = ''
let server: ReturnType<typeof Bun.serve>
let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/.well-known/openid-configuration')
        return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
      if (pathname === '/jwks') return Response.json({ keys: [jwk] })
      return new Response('Not Found', { status: 404 })
    },
  })
  issuer = `http://localhost:${server.port}`
})
afterAll(() => server.stop(true))

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

/** A token the provider issued for the remote, naming the person by `oid`. */
async function providerToken(
  claims: Record<string, unknown> = {},
  options: { audience?: string; seconds?: number; jti?: string | null; issuer?: string } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const jwt = new SignJWT({ oid: 'oid-1', sub: 'pairwise-for-the-api', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + (options.seconds ?? 600))
  if (options.jti !== null) jwt.setJti(options.jti ?? randomUUID())
  return jwt.sign(privateKey)
}

const provider = (over: Record<string, unknown> = {}) =>
  oidc({
    id: 'corp',
    name: 'Corp',
    issuer,
    clientId: CLIENT_ID,
    claims: { identity: 'oid' },
    groups: { map: { 'cms-editors': 'editor' } },
    remoteExchange: { audience: AUDIENCE },
    ...over,
  })

async function site(
  over: Record<string, unknown> = {},
  remote: 'on' | 'off' = 'on',
  shape: (p: IdentityProvider) => IdentityProvider = (p) => p,
) {
  const h = await signedInServer({
    config: {
      remote: {
        enabled: remote === 'on',
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
      },
      backofficeIdentityProviders: [shape(provider(over))],
    },
  })
  open.push(h)
  const groups = await h.json<{ items: { id: string; alias: string }[] }>(
    `${V1}/user-group?take=100`,
  )
  const writer = groups.items.find((g) => g.alias === 'writer')?.id as string
  const created = await h.post(`${V1}/user`, {
    kind: 'Default',
    email: 'pat@example.com',
    userName: 'pat@example.com',
    name: 'Pat',
    userGroupIds: [{ id: writer }],
  })
  const key = created.headers.get('umb-generated-resource') as string
  const logins = new ExternalLoginRepository(h.server.db)
  const link = (value = 'oid-1', from = issuer) =>
    logins.link(key, externalLoginProvider('user', 'corp'), 'sign-in-sub', { value, issuer: from })
  const exchange = (token: string) =>
    h.server.fetch(
      new Request(`${API}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: token,
          subject_token_type: JWT_TOKEN_TYPE,
        }),
      }),
    )
  const signIn = async (token: string) => {
    const response = await exchange(token)
    expect(response.status).toBe(200)
    return ((await response.json()) as { access_token: string }).access_token
  }
  const as = (token: string, url: string, init: RequestInit = {}) =>
    h.server.fetch(
      new Request(url.startsWith('/') ? `${ORIGIN}${url}` : url, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers as Record<string, string>),
          authorization: `Bearer ${token}`,
        },
      }),
    )
  const audit = async () =>
    h.server.db.query<{ action: string; detail: string | null; user_key: string | null }>(
      "SELECT action, detail, user_key FROM audit_entry WHERE action LIKE 'RemoteExchange%' ORDER BY id",
    )
  const refusedFor = async (token: string) => {
    const response = await exchange(token)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'The identity token was not accepted.',
    })
    return (await audit()).at(-1)?.detail
  }
  return { h, key, link, exchange, signIn, as, audit, refusedFor }
}

describe('which providers exchange', () => {
  test('those the config opts in, and those the server names', () => {
    const declared = provider({ remoteExchange: undefined })
    expect(exchangingProviders([declared], [])).toEqual([])
    expect(exchangingProviders([declared], ['corp'])[0]?.remoteExchange).toEqual({})
    expect(exchangingProviders([provider()], [])[0]?.remoteExchange).toEqual({
      audience: AUDIENCE,
    })
  })

  test('Entra names a person by oid, whose sub differs for each app; the others by sub', () => {
    const tenant = { tenantId: 't', clientId: 'c' }
    expect(entra(tenant).oidc.claims.identity).toBe('oid')
    expect(oidc({ id: 'o', name: 'O', issuer, clientId: 'c' }).oidc.claims.identity).toBeUndefined()
  })

  test('an audience a sign-in uses is refused at boot', () => {
    const clashing = provider({ remoteExchange: { audience: CLIENT_ID } })
    expect(exchangeAudienceClashes([clashing], [clashing])[0]).toContain('client id Corp signs in')
    expect(exchangeAudienceClashes([provider()], [provider()])).toEqual([])
    expect(() => loadConfig({ backofficeIdentityProviders: [clashing] })).toThrow(
      /remoteExchange audience/,
    )
  })
})

describe(`exchanging a provider's token for a person (${process.env.CROMBOLO_DB ?? 'sqlite'})`, () => {
  test('discovery names the providers that exchange, with their audience', async () => {
    const { h } = await site()
    const discovery = (await (
      await h.server.fetch(new Request(`${ORIGIN}${REMOTE_DISCOVERY_PATH}`))
    ).json()) as { auth: { people?: Record<string, unknown> } }
    expect(discovery.auth.people).toEqual({
      tokenExchange: `${API}/token`,
      grantType: TOKEN_EXCHANGE_GRANT,
      subjectTokenType: JWT_TOKEN_TYPE,
      audience: ORIGIN,
      providers: [{ id: 'corp', name: 'Corp', issuer, audience: AUDIENCE }],
    })
  })

  test('a linked person is signed in as a device of their own, with their groups matched', async () => {
    const { h, key, link, signIn, as, audit } = await site()
    await link()
    const token = await signIn(await providerToken({ groups: ['cms-editors'] }))

    const me = (await (await as(token, `${API}/me`)).json()) as { name: string; kind: string }
    expect(me).toMatchObject({ name: 'Pat', kind: 'person' })
    const current = await as(token, `${V1}/user/current`)
    expect(current.status).toBe(200)
    const groups = (await current.json()) as { userGroupIds: { id: string }[] }
    expect(groups.userGroupIds.length).toBe(2)

    const user = await new UserRepository(h.server.db).byKey(key)
    const devices = await new DeviceStore(h.server.db).signedIn(user?.id as number)
    expect(devices.map((d) => d.clientName)).toEqual(['Signed in through Corp'])
    expect((await audit()).map((row) => [row.action, row.user_key])).toEqual([
      ['RemoteExchangeSignIn', key],
    ])
  })

  test("Entra's uti stands in for jti", async () => {
    const { link, signIn } = await site()
    await link()
    await signIn(await providerToken({ uti: randomUUID() }, { jti: null }))
  })

  test('a token is refused for its audience, a nonce, its one-time id or its lifetime', async () => {
    const { link, refusedFor } = await site()
    await link()
    expect(await refusedFor(await providerToken({}, { audience: CLIENT_ID }))).toContain(
      'did not verify',
    )
    expect(await refusedFor(await providerToken({ nonce: 'n' }))).toContain('nonce')
    expect(await refusedFor(await providerToken({}, { jti: null }))).toContain('one-time id')
    expect(await refusedFor(await providerToken({}, { seconds: 91 * 60 }))).toContain('too long')
  })

  test('a token is used once', async () => {
    const { link, signIn, refusedFor } = await site()
    await link()
    const token = await providerToken()
    await signIn(token)
    expect(await refusedFor(token)).toContain('already used')
  })

  test('nobody is made, a link from another issuer counts for nothing, and a locked person is refused', async () => {
    const { h, key, link, refusedFor } = await site({ autoCreate: true })
    expect(await refusedFor(await providerToken())).toContain('sign in to the back office once')
    await link('oid-1', 'https://elsewhere.example')
    expect(await refusedFor(await providerToken())).toContain('sign in to the back office once')
    await link()
    await h.server.db.q
      .updateTable('user_account')
      .set({ is_locked_out: h.server.db.dialect.boolValue(true) })
      .where('key', '=', key)
      .execute()
    expect(await refusedFor(await providerToken())).toContain('locked out')
  })

  test('linked ahead of a first sign-in, a provider naming people by sub finds them by the link', async () => {
    const { h, key, signIn, refusedFor } = await site({ claims: { identity: 'sub' } })
    const logins = new ExternalLoginRepository(h.server.db)
    const corp = externalLoginProvider('user', 'corp')
    // As `PUT users/{key}/logins` links them, with no identity yet (story 404).
    await logins.link(key, corp, 'pairwise-for-the-api')
    await signIn(await providerToken())
    // The identity is recorded from it, so the link is found as any other from now on.
    expect((await logins.find(corp, 'pairwise-for-the-api'))?.identity).toEqual({
      value: 'pairwise-for-the-api',
      issuer,
    })
    // A subject from another issuer is still nobody.
    expect(await refusedFor(await providerToken({ sub: 'someone-else' }))).toContain(
      'sign in to the back office once',
    )
  })

  test('a provider naming people by another claim never takes a link’s subject for it', async () => {
    const { h, key, refusedFor } = await site()
    await new ExternalLoginRepository(h.server.db).link(
      key,
      externalLoginProvider('user', 'corp'),
      'oid-1',
    )
    expect(await refusedFor(await providerToken())).toContain('sign in to the back office once')
  })

  test('it makes nothing that outlives it, and signing the device out ends it', async () => {
    const { h, key, link, signIn, as } = await site()
    await link()
    const token = await signIn(await providerToken())
    const post = (url: string, body: unknown) =>
      as(token, url, { method: 'POST', body: JSON.stringify(body) })

    expect(
      (
        await post(`${V1}/user/current/change-password`, {
          newPassword: 'another-password-1',
          oldPassword: 'x',
        })
      ).status,
    ).toBe(403)
    expect((await post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'kept' })).status).toBe(403)
    expect((await post(`${BACKOFFICE}/crombolo/api/view-as`, { groups: [] })).status).toBe(403)

    const user = await new UserRepository(h.server.db).byKey(key)
    const store = new DeviceStore(h.server.db)
    const [device] = await store.signedIn(user?.id as number)
    const row = await store.byId(device?.id as number)
    await new AuthStore(h.server.db).endSession(row?.sessionId as string)
    expect((await as(token, `${API}/me`)).status).toBe(401)
  })
})

describe(`a person's exchange with the remote off (${process.env.CROMBOLO_DB ?? 'sqlite'})`, () => {
  test('signs the person in to the back office, and opens nothing of the remote', async () => {
    const { h, link, signIn, as, exchange } = await site({}, 'off')
    await link()
    const token = await signIn(await providerToken())
    expect((await as(token, `${V1}/user/current`)).status).toBe(200)

    const notEnabled = async (response: Response) => {
      expect(response.status).toBe(404)
      expect(((await response.json()) as { code: string }).code).toBe('not-enabled')
    }
    await notEnabled(await as(token, `${API}/me`))
    await notEnabled(await as(token, `${API}/environments`))
    expect((await h.server.fetch(new Request(`${ORIGIN}${REMOTE_DISCOVERY_PATH}`))).status).toBe(
      404,
    )

    // A token from any other issuer, CI's among them, is told the site is no remote.
    const now = Math.floor(Date.now() / 1000)
    const ci = await new SignJWT({ repository: 'acme/site' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('https://token.actions.githubusercontent.com')
      .setAudience(ORIGIN)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey)
    await notEnabled(await exchange(ci))
  })

  test('without a provider that exchanges, the token endpoint is not there either', async () => {
    const { exchange } = await site({ remoteExchange: undefined }, 'off')
    const response = await exchange(await providerToken())
    expect(response.status).toBe(404)
    expect(((await response.json()) as { code: string }).code).toBe('not-enabled')
  })
})

describe('where the remote is', () => {
  test('under /crombolo, and nothing answers where it was', async () => {
    const { link, signIn, as } = await site()
    await link()
    const token = await signIn(await providerToken())
    expect(REMOTE_API_PATH).toBe('/crombolo/remote/v1')
    expect((await as(token, `${API}/me`)).status).toBe(200)
    const old = await as(token, `${ORIGIN}/umbraco/remote/v1/me`)
    expect(old.status).toBe(404)
    expect(await old.text()).not.toContain('not-enabled')
  })
})

describe('spending one-time ids', () => {
  test('an id is spent once, and forgotten once its token expires', async () => {
    const { h } = await site()
    const ids = new SingleUseTokens(h.server.db)
    const soon = new Date(Date.now() + 60_000)
    expect(await ids.use('https://i', 'a', soon)).toBe(true)
    expect(await ids.use('https://i', 'a', soon)).toBe(false)
    expect(await ids.use('https://other', 'a', soon)).toBe(true)
    expect(await ids.use('https://i', 'a', soon, new Date(Date.now() + 120_000))).toBe(true)
  })
})

describe('what an exchanged sign-in writes', () => {
  test('says it came through the provider', () => {
    const key = randomUUID()
    expect(
      detailInContext(
        { userKey: key, detail: 'Saved' },
        { exchange: { userKey: key, provider: 'Corp' } },
      ),
    ).toBe('Saved, signed in through Corp')
  })
})

describe('the actor a token names (366)', () => {
  test("is its act, else the client it was issued to, named by the provider's actors", () => {
    const actors = { 'console-app': 'Acme console' }
    expect(actorOf({ act: { sub: 'agent-7', name: 'Claude Code on\u0007 Ada’s laptop' } })).toEqual(
      { id: 'agent-7', name: 'Claude Code on Ada’s laptop' },
    )
    expect(actorOf({ act: { sub: 'console-app', act: { sub: 'x' } } }, actors)).toEqual({
      id: 'console-app',
      name: 'Acme console',
    })
    expect(actorOf({ azp: 'console-app' }, actors)).toEqual({
      id: 'console-app',
      name: 'Acme console',
    })
    expect(actorOf({ appid: 'other-app' }, actors)).toEqual({ id: 'other-app', name: null })
    expect(actorOf({ azp: 'toString' }, actors)).toEqual({ id: 'toString', name: null })
    expect(actorOf({})).toBeUndefined()
    expect(actorOf({ act: 'agent' })).toBe('malformed')
    expect(actorOf({ act: { name: 'nameless' } })).toBe('malformed')
    expect(actorOf({ act: { sub: 7 } })).toBe('malformed')
    expect(
      (
        actorOf({ act: { sub: 'a'.repeat(300), name: 'n'.repeat(300) } }) as {
          id: string
          name: string
        }
      ).id,
    ).toHaveLength(200)
  })

  test('the device, the sign-in and everything the token does name it', async () => {
    const { h, key, link, signIn, as, audit } = await site({
      groups: { map: { 'cms-admins': 'admin' } },
      remoteExchange: { audience: AUDIENCE, actors: { 'console-app': 'Acme console' } },
    })
    await link()
    const token = await signIn(await providerToken({ azp: 'console-app', groups: ['cms-admins'] }))

    const user = await new UserRepository(h.server.db).byKey(key)
    const devices = await new DeviceStore(h.server.db).signedIn(user?.id as number)
    expect(devices.map((d) => d.clientName)).toEqual(['Signed in through Corp, by Acme console'])
    expect((await audit()).at(-1)?.detail).toBe(
      'Signed in through Corp, by Acme console, by exchange at the remote',
    )

    const made = await as(token, `${V1}/dictionary`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Greeting', parent: null, translations: [] }),
    })
    expect(made.status).toBe(201)
    const { items } = await new AuditLog(h.server.db).page({ userKey: key }, { limit: 50 })
    const written = items.filter((e) => !e.action.startsWith('RemoteExchange'))
    expect(written.length).toBeGreaterThan(0)
    for (const entry of written) {
      expect(entry.detail).toMatch(/signed in through Corp, by Acme console/i)
      expect(auditRecord(entry).actor).toEqual({ id: 'console-app', name: 'Acme console' })
    }
    const signedIn = items.find((e) => e.action === 'RemoteExchangeSignIn')
    expect(signedIn && auditRecord(signedIn).actor).toEqual({
      id: 'console-app',
      name: 'Acme console',
    })
  })

  test('a malformed act is refused, and a token naming no actor is as before', async () => {
    const { h, key, link, signIn, refusedFor } = await site()
    await link()
    expect(await refusedFor(await providerToken({ act: { name: 'nameless' } }))).toContain(
      'act claim',
    )
    await signIn(await providerToken())
    const user = await new UserRepository(h.server.db).byKey(key)
    const devices = await new DeviceStore(h.server.db).signedIn(user?.id as number)
    expect(devices.map((d) => d.clientName)).toEqual(['Signed in through Corp'])
  })

  test("Entra's v1 token is refused, saying which setting makes it v2", async () => {
    const { refusedFor } = await site({}, 'on', (p) => ({
      ...p,
      kind: 'entra',
      tenantId: 'tenant-1',
    }))
    expect(
      await refusedFor(await providerToken({}, { issuer: 'https://sts.windows.net/tenant-1/' })),
    ).toContain('requestedAccessTokenVersion')
  })
})
