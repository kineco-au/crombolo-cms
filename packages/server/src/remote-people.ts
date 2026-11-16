/**
 * A person signed in through a provider reaches the remote (story 364): a token
 * one of the site's own back-office providers issued for the remote, exchanged
 * (RFC 8693) at the same endpoint as CI's for a fifteen-minute sign-in as the
 * person it names. The provider must opt in from the config or the server, the
 * token's `aud` must be the audience it names and never a sign-in client id,
 * and the person is found by the claim that names them across the provider's
 * apps, as their last sign-in recorded it. docs/remote-protocol.md, "Signing
 * in as a person through a provider".
 */
import {
  type Db,
  ExternalLoginRepository,
  externalLoginProvider,
  RemoteExchangeIds,
} from '@crombolo/data'
import { type JWTPayload, jwtVerify } from 'jose'
import { type ExternalAccount, syncedGroups } from './external-sign-in.ts'
import type { IdentityProvider } from './identity-providers.ts'
import {
  ACCESS_TOKEN_TYPE,
  issuerKeys,
  JWT_TOKEN_TYPE,
  overHttps,
  TOKEN_EXCHANGE_GRANT,
  unverifiedIssuer,
  usableIssuer,
} from './remote-ci.ts'
import { AttemptLimiter } from './setup.ts'

/** How long an exchanged sign-in lasts. There is no refresh: the holder exchanges again. */
export const PERSON_TOKEN_SECONDS = 15 * 60
/** A provider's token valid for longer than this is refused; Entra's last 60 to 90 minutes. */
export const MAX_PROVIDER_TOKEN_SECONDS = 90 * 60

const ASYMMETRIC = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512']

const text = (claims: JWTPayload, name: string | undefined): string | undefined => {
  const value = name ? claims[name] : undefined
  return typeof value === 'string' && value !== '' ? value : undefined
}

const list = (claims: JWTPayload, name: string | undefined): string[] => {
  const value = name ? claims[name] : undefined
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  return typeof value === 'string' && value !== '' ? [value] : []
}

/** The person-side of the site the exchange needs: back-office users, as sign-in finds them. */
export interface ExchangeAccounts {
  byKey(key: string): Promise<ExternalAccount | undefined>
  byEmail(email: string): Promise<ExternalAccount | undefined>
  setGroups(account: ExternalAccount, groups: string[]): Promise<void>
  /** Why the person may not sign in now: locked out, disabled, or with no back-office section. */
  refusal(key: string): Promise<string | undefined>
  /** Signs them in as a device of their own, or says why not. */
  signIn(
    key: string,
    provider: { id: string; name: string },
    seconds: number,
    ip: string | undefined,
  ): Promise<{ accessToken: string } | { refused: string }>
}

export type PeopleExchangeOutcome =
  | { ok: true; provider: IdentityProvider; account: ExternalAccount }
  | { ok: false; reason: string; provider?: IdentityProvider }

export interface PeopleExchange {
  /** What the discovery document says, when any provider exchanges. */
  discovery(origin: string, api: string): Promise<Record<string, unknown> | undefined>
  /** Whether a token's issuer is an exchanging provider's, so this exchange answers it. */
  handles(issuer: string): Promise<boolean>
  exchange(request: Request, url: URL, ip: string | undefined): Promise<Response>
}

export function createPeopleExchange(options: {
  db: Db
  /** The providers that exchange, as declared. */
  providers: readonly IdentityProvider[]
  /** Every back-office provider, as declared: none of their client ids is ever an audience. */
  backoffice: readonly IdentityProvider[]
  /** A provider as sign-in uses it, with an administrator's overrides (033). */
  resolve(provider: IdentityProvider): Promise<IdentityProvider>
  accounts: ExchangeAccounts
  /** Told of each exchange, accepted or refused, for the audit log. */
  onExchange(outcome: PeopleExchangeOutcome, request: Request): Promise<void>
}): PeopleExchange {
  const logins = new ExternalLoginRepository(options.db)
  const ids = new RemoteExchangeIds(options.db)
  const keysOf = issuerKeys()
  const limiter = new AttemptLimiter({ max: 10, maxAll: 200, windowMs: 15 * 60_000 })

  const effective = () =>
    Promise.all(
      options.providers.map(async (declared) => {
        const provider = await options.resolve(declared).catch(() => declared)
        return { ...provider, remoteExchange: declared.remoteExchange }
      }),
    )
  const issuerOf = (provider: IdentityProvider) => provider.oidc.issuer.replace(/\/+$/, '')
  const audienceOf = (provider: IdentityProvider, origin: string) =>
    provider.remoteExchange?.audience ?? origin
  const usable = (provider: IdentityProvider) =>
    !provider.unavailable && usableIssuer(issuerOf(provider))

  const json = (body: unknown, status: number) =>
    Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

  const refuse = async (
    request: Request,
    ip: string | undefined,
    reason: string,
    provider?: IdentityProvider,
  ) => {
    limiter.fail(`ip:${ip ?? 'unknown'}`)
    if (provider) limiter.fail(`issuer:${issuerOf(provider)}`)
    await options.onExchange({ ok: false, reason, provider }, request)
    // The same answer whatever went wrong: the audit log has the reason, the caller does not.
    return json(
      { error: 'invalid_grant', error_description: 'The identity token was not accepted.' },
      400,
    )
  }

  /** The account the token names: by its recorded identity, else by email where allowed. */
  const accountFor = async (
    provider: IdentityProvider,
    issuer: string,
    claims: JWTPayload,
  ): Promise<ExternalAccount | string> => {
    const loginProvider = externalLoginProvider('user', provider.oidc.id)
    const value = text(claims, provider.oidc.claims.identity ?? 'sub')
    if (!value) return 'the token names no person'
    const linked = await logins.findByIdentity(loginProvider, { value, issuer })
    if (linked) {
      const account = await options.accounts.byKey(linked.ownerKey)
      return account ?? 'the person it is linked to no longer exists'
    }
    // Story 364, D5: never an account made, and a link is only ever made by a sign-in.
    const email = text(claims, provider.oidc.claims.email)?.toLowerCase()
    const verified = claims.email_verified === true || claims.email_verified === 'true'
    if (!provider.linkByEmail || !email || !(verified || provider.emailsVerified))
      return 'nobody is linked to this person; they sign in to the back office once first'
    const sameEmail = await options.accounts.byEmail(email)
    if (!sameEmail) return 'nobody here has their email address, and an exchange makes no account'
    const links = await logins.forOwner(sameEmail.key)
    if (links.some((l) => l.loginProvider === loginProvider))
      return 'the account with their email is linked to someone else at this provider'
    return sameEmail
  }

  return {
    async discovery(origin, api) {
      const providers = (await effective()).filter(usable)
      if (providers.length === 0) return undefined
      return {
        tokenExchange: `${api}/token`,
        grantType: TOKEN_EXCHANGE_GRANT,
        subjectTokenType: JWT_TOKEN_TYPE,
        audience: origin,
        providers: providers.map((p) => ({
          id: p.oidc.id,
          name: p.oidc.name,
          issuer: issuerOf(p),
          audience: audienceOf(p, origin),
        })),
      }
    },

    async handles(issuer) {
      return (await effective()).some((p) => usable(p) && issuerOf(p) === issuer)
    },

    async exchange(request, url, ip) {
      if (!overHttps(request, url))
        return json(
          { error: 'invalid_request', error_description: 'Signing in from elsewhere needs HTTPS.' },
          400,
        )
      if (limiter.blocked(`ip:${ip ?? 'unknown'}`))
        return json({ error: 'slow_down', error_description: 'Too many refused tokens.' }, 429)
      const form = new URLSearchParams(await request.text())
      if (form.get('grant_type') !== TOKEN_EXCHANGE_GRANT)
        return json({ error: 'unsupported_grant_type' }, 400)
      if (form.get('subject_token_type') !== JWT_TOKEN_TYPE)
        return json({ error: 'invalid_request', error_description: 'A JWT is expected.' }, 400)
      const token = form.get('subject_token') ?? ''

      const issuer = unverifiedIssuer(token)
      const provider = (await effective()).find((p) => usable(p) && issuerOf(p) === issuer)
      if (!issuer || !provider)
        return refuse(request, ip, 'an issuer that is not an exchanging provider')
      if (limiter.blocked(`issuer:${issuer}`))
        return json({ error: 'slow_down', error_description: 'Too many refused tokens.' }, 429)

      const audience = audienceOf(provider, url.origin)
      const signInClients = await Promise.all(
        options.backoffice.map(
          async (p) => (await options.resolve(p).catch(() => p)).oidc.clientId,
        ),
      )
      if (signInClients.includes(audience))
        return refuse(request, ip, 'its audience is a sign-in client id', provider)

      let claims: JWTPayload
      try {
        ;({ payload: claims } = await jwtVerify(token, await keysOf(issuer), {
          issuer,
          audience,
          algorithms: ASYMMETRIC,
          requiredClaims: ['exp', 'iat'],
        }))
      } catch (error) {
        return refuse(
          request,
          ip,
          `the token did not verify: ${error instanceof Error ? error.message : String(error)}`,
          provider,
        )
      }
      if (claims.nonce !== undefined)
        return refuse(request, ip, 'it is a sign-in ID token, which carries a nonce', provider)
      const exp = claims.exp as number
      if (exp - (claims.iat as number) > MAX_PROVIDER_TOKEN_SECONDS)
        return refuse(request, ip, 'the token is valid for too long', provider)
      // Entra calls its one-time id `uti`.
      const tokenId = text(claims, 'jti') ?? text(claims, 'uti')
      if (!tokenId) return refuse(request, ip, 'the token has no one-time id', provider)
      if (!(await ids.spend(issuer, tokenId, new Date(exp * 1000))))
        return refuse(request, ip, 'the token was already used', provider)

      const found = await accountFor(provider, issuer, claims)
      if (typeof found === 'string') return refuse(request, ip, found, provider)
      const refusal = await options.accounts.refusal(found.key)
      if (refusal) return refuse(request, ip, refusal, provider)

      let account = found
      if (Object.keys(provider.groupMap).length > 0) {
        const groups = syncedGroups(
          account.groups,
          list(claims, provider.oidc.claims.groups),
          provider.groupMap,
        )
        if (groups.join('\n') !== account.groups.join('\n')) {
          await options.accounts.setGroups(account, groups)
          account = { ...account, groups }
        }
      }
      const signedIn = await options.accounts.signIn(
        account.key,
        { id: provider.oidc.id, name: provider.oidc.name },
        PERSON_TOKEN_SECONDS,
        ip,
      )
      if ('refused' in signedIn) return refuse(request, ip, signedIn.refused, provider)
      await options.onExchange({ ok: true, provider, account }, request)
      return json(
        {
          access_token: signedIn.accessToken,
          issued_token_type: ACCESS_TOKEN_TYPE,
          token_type: 'Bearer',
          expires_in: PERSON_TOKEN_SECONDS,
        },
        200,
      )
    },
  }
}
