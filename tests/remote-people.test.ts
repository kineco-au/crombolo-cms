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
  detailInContext,
  ExternalLoginRepository,
  externalLoginProvider,
  RemoteExchangeIds,
  UserRepository,
} from '@crombolo/data'
import {
  entra,
  exchangeAudienceClashes,
  exchangingProviders,
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
  options: { audience?: string; seconds?: number; jti?: string | null } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const jwt = new SignJWT({ oid: 'oid-1', sub: 'pairwise-for-the-api', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
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

async function site(over: Record<string, unknown> = {}) {
  const h = await signedInServer({
    config: {
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
      },
      backofficeIdentityProviders: [provider(over)],
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

describe('spending one-time ids', () => {
  test('an id is spent once, and forgotten once its token expires', async () => {
    const { h } = await site()
    const ids = new RemoteExchangeIds(h.server.db)
    const soon = new Date(Date.now() + 60_000)
    expect(await ids.spend('https://i', 'a', soon)).toBe(true)
    expect(await ids.spend('https://i', 'a', soon)).toBe(false)
    expect(await ids.spend('https://other', 'a', soon)).toBe(true)
    expect(await ids.spend('https://i', 'a', soon, new Date(Date.now() + 120_000))).toBe(true)
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
