/**
 * An OpenID Connect provider served by the test, for external sign-in (story
 * 031): discovery, signing keys, an authorize endpoint that signs whoever the
 * test says straight in, and a token endpoint issuing ID tokens signed with a
 * real RSA key. Each part can be told to misbehave, so the tests can show what
 * a forged, stale or misdirected token comes to.
 */
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose'

export interface FakeSignIn {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  groups?: string[]
  /** Any other claim. */
  [claim: string]: unknown
}

export interface FakeOidc {
  issuer: string
  /** Who signs in next. */
  as(person: FakeSignIn): void
  /** Changes the next ID token: a wrong audience, an expiry in the past, a key it was not signed with. */
  tamper(change: {
    audience?: string
    expired?: boolean
    foreignKey?: boolean
    nonce?: string
  }): void
  /** The last authorize request's parameters. */
  lastAuthorize(): URLSearchParams | undefined
  /** The policy of the last authorize request; empty for the issuer itself. */
  lastPolicy(): string
  /** What the next authorize request answers in place of a code. */
  refuse(error: string, description?: string): void
  /** A policy's own issuer address, as B2C's user flows have: its own metadata, keys and endpoints. */
  policy(name: string): string
  stop(): void
}

export async function startFakeOidc(
  clientId: string,
  options: { endSession?: boolean } = {},
): Promise<FakeOidc> {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const foreign = await generateKeyPair('RS256')
  // Every policy signs with a key of its own.
  const policyKeys = new Map<string, Awaited<ReturnType<typeof generateKeyPair>>>()
  const keyFor = async (policy: string) => {
    if (!policy) return { publicKey, privateKey }
    const found = policyKeys.get(policy) ?? (await generateKeyPair('RS256'))
    policyKeys.set(policy, found)
    return found
  }
  const jwk = { ...(await exportJWK(publicKey)), kid: 'fake-1', alg: 'RS256', use: 'sig' }
  let person: FakeSignIn = { sub: 'nobody' }
  let tamper: Parameters<FakeOidc['tamper']>[0] = {}
  let authorize: URLSearchParams | undefined
  let refusal: { error: string; description?: string } | undefined
  let lastPolicy = ''
  const codes = new Map<string, { nonce: string; person: FakeSignIn; policy: string }>()

  let issuer = ''
  const server: Bun.Server<undefined> = Bun.serve({
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      const policy = /^\/p\/([^/]+)(?=\/)/.exec(url.pathname)?.[1] ?? ''
      if (policy) url.pathname = url.pathname.slice(`/p/${policy}`.length)
      const base = policy ? `${issuer}/p/${policy}` : issuer
      if (url.pathname === '/.well-known/openid-configuration')
        return Response.json({
          issuer,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          jwks_uri: `${base}/jwks`,
          ...(options.endSession ? { end_session_endpoint: `${base}/logout` } : {}),
        })
      if (url.pathname === '/jwks')
        return Response.json({
          keys: [
            policy
              ? {
                  ...(await exportJWK((await keyFor(policy)).publicKey)),
                  kid: 'fake-1',
                  alg: 'RS256',
                  use: 'sig',
                }
              : jwk,
          ],
        })
      if (url.pathname === '/authorize') {
        authorize = url.searchParams
        lastPolicy = policy
        if (refusal) {
          const back = new URL(url.searchParams.get('redirect_uri') as string)
          back.searchParams.set('error', refusal.error)
          if (refusal.description) back.searchParams.set('error_description', refusal.description)
          back.searchParams.set('state', url.searchParams.get('state') ?? '')
          refusal = undefined
          return Response.redirect(back.href, 302)
        }
        const code = crypto.randomUUID()
        codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', person, policy })
        const back = new URL(url.searchParams.get('redirect_uri') as string)
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state') ?? '')
        return Response.redirect(back.href, 302)
      }
      if (url.pathname === '/token' && request.method === 'POST') {
        const form = new URLSearchParams(await request.text())
        const grant = codes.get(form.get('code') ?? '')
        if (
          !grant ||
          grant.policy !== policy ||
          form.get('client_id') !== clientId ||
          !form.get('code_verifier')
        )
          return Response.json({ error: 'invalid_grant' }, { status: 400 })
        codes.delete(form.get('code') as string)
        const claims: JWTPayload = { ...grant.person, nonce: tamper.nonce ?? grant.nonce }
        const now = Math.floor(Date.now() / 1000)
        const token = await new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid: 'fake-1' })
          .setIssuer(issuer)
          .setAudience(tamper.audience ?? clientId)
          .setIssuedAt(tamper.expired ? now - 7200 : now)
          .setExpirationTime(tamper.expired ? now - 3600 : now + 600)
          .sign(tamper.foreignKey ? foreign.privateKey : (await keyFor(policy)).privateKey)
        tamper = {}
        return Response.json({ id_token: token, access_token: 'opaque', token_type: 'Bearer' })
      }
      return new Response('Not found', { status: 404 })
    },
  })

  issuer = `http://localhost:${server.port}`
  return {
    issuer,
    as: (next) => {
      person = next
    },
    tamper: (change) => {
      tamper = change
    },
    lastAuthorize: () => authorize,
    lastPolicy: () => lastPolicy,
    refuse: (error, description) => {
      refusal = { error, description }
    },
    policy: (name) => `${issuer}/p/${name}`,
    stop: () => server.stop(true),
  }
}
