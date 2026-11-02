/**
 * Story 160: signing in to a remote from CI. A CI job's identity token, signed
 * by its provider, is exchanged for a token that acts as the site's trust rule
 * it matches, holding that rule's remote permissions and nothing else. A test
 * issuer here signs the tokens, served from this machine as a self-managed
 * GitLab would be.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { AuditLog, DbDate, RemoteTrustRepository, type TrustRule } from '@crombolo/data'
import {
  GITHUB_ISSUER,
  GITLAB_ISSUER,
  JWT_TOKEN_TYPE,
  REMOTE_API_PATH,
  REMOTE_DISCOVERY_PATH,
  readRuleInput,
  ruleMatches,
  runClaims,
  TOKEN_EXCHANGE_GRANT,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ciIdentityToken, ciTokenSource, inCiWithIdentity } from '../packages/cli/src/remote/ci.ts'
import { discover, RemoteClient, RemoteError } from '../packages/cli/src/remote/client.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const API = `${ORIGIN}${REMOTE_API_PATH}`
const TRUST = `${BACKOFFICE}/crombolo/api/remote-trust`

let issuer = ''
let server: ReturnType<typeof Bun.serve>
let privateKey: CryptoKey
let otherKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
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

/** An identity token as a GitLab job carries it, for `claims` over a project on `main`. */
async function identity(
  claims: Record<string, unknown> = {},
  options: { key?: CryptoKey; audience?: string; seconds?: number; iat?: number } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const iat = options.iat ?? now
  return new SignJWT({
    project_path: 'acme/site',
    ref: 'main',
    ref_type: 'branch',
    pipeline_id: '42',
    job_id: '7',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(issuer)
    .setAudience(options.audience ?? ORIGIN)
    .setIssuedAt(iat)
    .setExpirationTime(iat + (options.seconds ?? 300))
    .setJti(randomUUID())
    .sign(options.key ?? privateKey)
}

async function site(remote: Record<string, unknown> = {}) {
  const h = await signedInServer({
    config: {
      remote: {
        enabled: true,
        environment: 'production',
        protected: true,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
        oidcIssuers: [issuer],
        ...remote,
      },
    },
  })
  open.push(h)
  const rules = new RemoteTrustRepository(h.server.db)
  const rule = (permissions: string[], over: Partial<TrustRule> = {}) =>
    rules.create(
      {
        name: 'Deploys',
        issuer,
        repository: 'acme/site',
        refKind: 'branch',
        refValue: 'main',
        permissions,
        ...over,
      },
      'test',
    )
  const exchange = (token: string, headers: Record<string, string> = {}) =>
    h.server.fetch(
      new Request(`${API}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: token,
          subject_token_type: JWT_TOKEN_TYPE,
        }),
      }),
    )
  const as = (token: string, path: string, init: RequestInit = {}) =>
    h.server.fetch(
      new Request(`${API}/${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` },
      }),
    )
  const ciToken = async (claims: Record<string, unknown> = {}) => {
    const response = await exchange(await identity(claims))
    expect(response.status).toBe(200)
    return ((await response.json()) as { access_token: string }).access_token
  }
  return { h, rules, rule, exchange, as, ciToken }
}

describe('reading a run from its identity token', () => {
  test('GitHub and GitLab say where a run was in their own words, read as one', () => {
    expect(
      runClaims(GITHUB_ISSUER, {
        repository: 'acme/site',
        ref: 'refs/heads/main',
        ref_type: 'branch',
        run_id: '9',
        run_attempt: '2',
      }),
    ).toEqual({
      repository: 'acme/site',
      refType: 'branch',
      ref: 'main',
      environment: undefined,
      run: '9/2',
    })
    expect(
      runClaims(GITHUB_ISSUER, { repository: 'acme/site', ref: 'refs/tags/v1', ref_type: 'tag' })
        ?.ref,
    ).toBe('v1')
    expect(
      runClaims(GITLAB_ISSUER, {
        project_path: 'acme/site',
        ref: 'main',
        ref_type: 'branch',
        environment: 'production',
      }),
    ).toMatchObject({ repository: 'acme/site', ref: 'main', environment: 'production' })
    expect(runClaims(GITHUB_ISSUER, { ref: 'refs/heads/main' })).toBeUndefined()
  })

  test('a rule matches its repository and ref exactly, and nothing near it', () => {
    const rule = {
      key: 'k',
      name: 'n',
      issuer: GITHUB_ISSUER,
      repository: 'Acme/Site',
      refKind: 'branch',
      refValue: 'main',
      permissions: [],
      disabled: false,
    } as unknown as TrustRule
    const run = (over: Partial<ReturnType<typeof runClaims> & object> = {}) => ({
      repository: 'acme/site',
      refType: 'branch' as const,
      ref: 'main',
      environment: undefined,
      run: undefined,
      ...over,
    })
    expect(ruleMatches(rule, GITHUB_ISSUER, run())).toBe(true)
    expect(ruleMatches(rule, GITLAB_ISSUER, run())).toBe(false)
    expect(ruleMatches(rule, GITHUB_ISSUER, run({ repository: 'acme/site-fork' }))).toBe(false)
    expect(ruleMatches(rule, GITHUB_ISSUER, run({ ref: 'main-2' }))).toBe(false)
    expect(ruleMatches(rule, GITHUB_ISSUER, run({ refType: 'tag' }))).toBe(false)
    expect(ruleMatches({ ...rule, disabled: true }, GITHUB_ISSUER, run())).toBe(false)
    const env = { ...rule, refKind: 'environment', refValue: 'production' } as TrustRule
    expect(ruleMatches(env, GITHUB_ISSUER, run({ environment: 'production' }))).toBe(true)
    expect(ruleMatches(env, GITHUB_ISSUER, run({ environment: 'staging' }))).toBe(false)
  })

  test('a rule as posted is refused with reasons: wildcards, unknown providers and permissions', () => {
    const { problems } = readRuleInput(
      {
        name: '',
        issuer: 'https://evil.example',
        repository: 'acme/*',
        refKind: 'branch',
        refValue: 'release-*',
        permissions: ['Crombolo.Remote.Pull', 'Umb.Document.Delete'],
      },
      [GITHUB_ISSUER],
    )
    expect(problems.join(' ')).toContain('name')
    expect(problems.join(' ')).toContain('provider')
    expect(problems.join(' ')).toContain('no wildcards')
    expect(problems.join(' ')).toContain('Umb.Document.Delete')
  })
})

describe('signing in from CI', () => {
  test('the discovery document says how, and to which audience', async () => {
    const { h } = await site()
    const discovery = await (
      await h.server.fetch(new Request(`${ORIGIN}${REMOTE_DISCOVERY_PATH}`))
    ).json()
    expect(discovery.capabilities).toContain('ci-sign-in')
    expect(discovery.auth.ci).toEqual({
      tokenExchange: `${API}/token`,
      grantType: TOKEN_EXCHANGE_GRANT,
      subjectTokenType: JWT_TOKEN_TYPE,
      audience: ORIGIN,
      issuers: [GITHUB_ISSUER, GITLAB_ISSUER, issuer],
    })
  })

  test('a matching job acts as its rule, with its permissions and nothing more', async () => {
    const { h, rule, as, ciToken } = await site()
    await rule(['Crombolo.Remote.Pull'])
    const token = await ciToken()
    const me = await (await as(token, 'me')).json()
    expect(me).toMatchObject({
      name: 'CI: Deploys',
      kind: 'ci',
      permissions: ['Crombolo.Remote.Pull'],
    })
    const [env] = await (await as(token, 'environments')).json()
    expect(env.may).toMatchObject({ pull: true, pullFull: false, push: false })
    // Only the remote's routes take it: the back office's API does not.
    expect((await as(token, '../../management/api/v1/user/current')).status).toBe(401)
    const outside = await h.server.fetch(
      new Request(`${ORIGIN}${V1}/user/current`, { headers: { authorization: `Bearer ${token}` } }),
    )
    expect(outside.status).toBe(401)

    // A pull it starts is audited as CI, with the run it came from.
    const pull = await as(token, 'environments/production/pulls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase: 'a passphrase long enough to use', media: 'omitted' }),
    })
    expect(pull.status).toBe(202)
    const { items } = await new AuditLog(h.server.db).page({}, { limit: 50 })
    const pulled = items.find((row) => row.action === 'RemotePull')
    expect(pulled?.userName).toBe('CI: Deploys')
    expect(pulled?.detail).toContain('CI: acme/site branch main, run 42/7')
    expect(items.some((row) => row.action === 'RemoteCiSignIn')).toBe(true)
  })

  test('without PushProtected a job may not push to a protected site', async () => {
    const { rule, as, ciToken } = await site()
    await rule(['Crombolo.Remote.Push'])
    const plain = await ciToken()
    expect((await (await as(plain, 'environments')).json())[0].may.push).toBe(false)
  })

  test('with PushProtected a job may push to a protected site', async () => {
    const { rule, as, ciToken } = await site()
    // A whole-site push changes structure too (story 167).
    await rule([
      'Crombolo.Remote.Push',
      'Crombolo.Remote.PushProtected',
      'Crombolo.Remote.ApplyStructure',
    ])
    const token = await ciToken()
    expect((await (await as(token, 'environments')).json())[0].may.push).toBe(true)
  })

  test('CI never approves a push, whatever its rule holds', async () => {
    const { rule, as, ciToken } = await site()
    await rule(['Crombolo.Remote.Push', 'Crombolo.Remote.PushProtected'])
    const token = await ciToken()
    const approve = await as(token, `jobs/${randomUUID()}/approve`, { method: 'POST' })
    expect(approve.status).toBe(403)
    expect((await approve.json()).code).toBe('ci-cannot-approve')
  })

  test('each refusal says only that it was refused, and the audit log says why', async () => {
    const { h, rule, exchange } = await site()
    await rule(['Crombolo.Remote.Pull'])
    const refusals = [
      await identity({}, { key: otherKey }),
      await identity({}, { audience: 'https://elsewhere.example' }),
      await identity({ project_path: 'acme/other' }),
      await identity({ ref: 'feature' }),
      await identity({}, { iat: Math.floor(Date.now() / 1000) - 1000, seconds: 600 }),
      await identity({}, { seconds: 2 * 60 * 60 }),
      'not.a.token',
    ]
    for (const token of refusals) {
      const response = await exchange(token)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body).toEqual({
        error: 'invalid_grant',
        error_description: 'The identity token was not accepted.',
      })
      expect(JSON.stringify(body)).not.toContain(token)
    }
    const { items } = await new AuditLog(h.server.db).page({}, { limit: 50 })
    const refused = items.filter((row) => row.action === 'RemoteCiSignInRefused')
    expect(refused.length).toBe(refusals.length)
    expect(refused.map((row) => row.detail).join(' ')).toContain('no trust rule matches')
  })

  test('an identity token is good once', async () => {
    const { rule, exchange } = await site()
    await rule(['Crombolo.Remote.Pull'])
    const token = await identity()
    expect((await exchange(token)).status).toBe(200)
    expect((await exchange(token)).status).toBe(400)
  })

  test('disabling a rule stops its tokens at once, and enabling it needs a new sign-in', async () => {
    const { rules, rule, as, ciToken } = await site()
    const made = await rule(['Crombolo.Remote.Pull'])
    const token = await ciToken()
    expect((await as(token, 'me')).status).toBe(200)
    await rules.setDisabled(made.key, true)
    expect((await as(token, 'me')).status).toBe(401)
    await rules.setDisabled(made.key, false)
    expect((await as(token, 'me')).status).toBe(401)
  })

  test('a CI token runs out, with no way to renew it', async () => {
    const { h, rule, as, ciToken } = await site()
    await rule(['Crombolo.Remote.Pull'])
    const token = await ciToken()
    await h.server.db.q
      .updateTable('remote_ci_token')
      .set({ expires_at: DbDate.toDb(new Date(Date.now() - 1000)) })
      .execute()
    expect((await as(token, 'me')).status).toBe(401)
  })

  test('too many refusals from one address are slowed down', async () => {
    const { exchange } = await site()
    for (let i = 0; i < 10; i++)
      expect((await exchange('not.a.token', { 'x-forwarded-for': '203.0.113.9' })).status).toBe(400)
    expect((await exchange('not.a.token', { 'x-forwarded-for': '203.0.113.9' })).status).toBe(429)
    expect((await exchange('not.a.token', { 'x-forwarded-for': '203.0.113.10' })).status).toBe(400)
  })

  test('the exchange is refused over plain HTTP from anywhere but this machine', async () => {
    const { h } = await site()
    const response = await h.server.fetch(
      new Request('http://cms.example.com/umbraco/remote/v1/token', {
        method: 'POST',
        body: new URLSearchParams({ grant_type: TOKEN_EXCHANGE_GRANT }),
      }),
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error_description).toContain('HTTPS')
  })
})

describe('managing CI access', () => {
  test('an administrator adds, disables and deletes a rule, and each change is audited', async () => {
    const { h } = await site()
    const added = await h.post(TRUST, {
      name: 'Deploys',
      issuer,
      repository: 'acme/site',
      refKind: 'branch',
      refValue: 'main',
      permissions: ['Crombolo.Remote.Pull'],
    })
    expect(added.status).toBe(201)
    const rule = (await added.json()) as { key: string }
    const listed = await h.json<{
      items: Array<{ key: string; disabled: boolean }>
      remoteEnabled: boolean
    }>(TRUST)
    expect(listed.remoteEnabled).toBe(true)
    expect(listed.items.map((r) => r.key)).toEqual([rule.key])
    expect((await h.post(`${TRUST}/${rule.key}/disable`, {})).status).toBe(200)
    expect((await h.json<{ items: Array<{ disabled: boolean }> }>(TRUST)).items[0]?.disabled).toBe(
      true,
    )
    expect((await h.del(`${TRUST}/${rule.key}`)).status).toBe(204)
    const { items } = await new AuditLog(h.server.db).page({}, { limit: 50 })
    expect(items.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'RemoteTrustRuleAdded',
        'RemoteTrustRuleDisabled',
        'RemoteTrustRuleDeleted',
      ]),
    )

    const refused = await h.post(TRUST, {
      name: 'x',
      issuer: 'https://evil.example',
      repository: 'a/*',
    })
    expect(refused.status).toBe(400)
    expect(((await refused.json()) as { items: string[] }).items.length).toBeGreaterThan(0)
  })

  test('only an administrator manages it, and CI never does', async () => {
    const { h, rule, as, ciToken } = await site()
    const writer = await signInAsGroup(h)
    expect((await writer.call(TRUST)).status).toBe(403)
    await rule(['Crombolo.Remote.Pull', 'Crombolo.Remote.Push', 'Crombolo.Remote.PushProtected'])
    expect((await as(await ciToken(), 'trust')).status).toBe(403)
  })
})

describe('the CLI in a CI job', () => {
  test('finds GitHub’s identity token by asking for it, and GitLab’s in its variable', async () => {
    const asked: string[] = []
    const http = (async (url: URL | string, init?: RequestInit) => {
      asked.push(String(url))
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer runner-secret')
      return Response.json({ value: 'github-identity' })
    }) as typeof fetch
    const github = {
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://pipelines.example/token?x=1',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'runner-secret',
    }
    expect(inCiWithIdentity(github)).toBe(true)
    expect(await ciIdentityToken('https://site.example', github, http)).toBe('github-identity')
    expect(asked[0]).toContain('audience=https%3A%2F%2Fsite.example')
    expect(await ciIdentityToken('a', { CROMBOLO_ID_TOKEN: 'gitlab-identity' })).toBe(
      'gitlab-identity',
    )
    expect(inCiWithIdentity({})).toBe(false)
    expect(await ciIdentityToken('a', {})).toBeUndefined()
  })

  test('exchanges it in memory, acts as the rule, and keeps the token out of its errors', async () => {
    const { h, rule } = await site()
    await rule(['Crombolo.Remote.Pull'])
    const http = ((url: URL | string, init?: RequestInit) =>
      h.server.fetch(new Request(String(url), init))) as typeof fetch
    const discovery = await discover(ORIGIN, http)
    const client = new RemoteClient(
      discovery,
      { get: async () => null, set: async () => {}, delete: async () => {} },
      http,
      ciTokenSource(discovery, () => identity(), http),
    )
    expect(client.ci).toBe(true)
    expect((await client.json<{ kind: string }>('me')).kind).toBe('ci')

    const stranger = await identity({ project_path: 'acme/other' })
    const refusedClient = new RemoteClient(
      discovery,
      {} as never,
      http,
      ciTokenSource(discovery, async () => stranger, http),
    )
    const error = await refusedClient.json('me').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RemoteError)
    expect((error as RemoteError).problem.code).toBe('ci-sign-in-refused')
    expect(String((error as RemoteError).message)).not.toContain(stranger)
  })

  test('a remote is reached over HTTPS, or on this machine', async () => {
    const error = await discover('http://cms.example.com').catch((e: unknown) => e)
    expect((error as RemoteError).problem.code).toBe('insecure-remote')
  })
})
