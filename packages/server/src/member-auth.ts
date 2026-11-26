/**
 * Member authentication on the front end, and the public-access check that
 * depends on it.
 *
 * Umbraco has no fixed URLs for this: a site writes a surface controller and
 * posts to it. There is no surface-controller equivalent here, so these four
 * endpoints are ours, under the fixed `/umbraco` namespace rather than the
 * movable backoffice path, because they belong to the framework and not to the
 * editor.
 *
 *   POST /umbraco/members/login     username, password, rememberMe?, returnUrl?
 *   POST /umbraco/members/logout
 *   POST /umbraco/members/register  name, email, username, password, returnUrl?
 *   GET  /umbraco/members/current
 *   POST /umbraco/members/login/2fa  code, returnUrl?   the second step, when 2FA is on
 *   GET  /umbraco/members/2fa                           the signed-in member's 2FA state
 *   POST /umbraco/members/2fa/setup | enable | disable   turning it on and off (story 032)
 *   POST /umbraco/members/forgot-password  email, returnUrl?   a link to set a password (story 282)
 *   POST /umbraco/members/reset-password   token, password, returnUrl?
 *
 * A form post is answered with a redirect, a JSON post with JSON, so the same
 * endpoint serves a plain `<form>` in a TSX template and a fetch from the page.
 *
 * Registration is refused unless the site turns it on: an endpoint that creates
 * accounts is a decision a site makes, not one a framework makes for it.
 */
import {
  antiforgeryToken,
  expireCookie,
  hashPassword,
  hashToken,
  isNativeHash,
  isSameOrigin,
  memberCookieName,
  passwordConfigJson,
  readCookie,
  readMemberTicket,
  readShortLived,
  serializeCookie,
  signMemberTicket,
  signShortLived,
  verifyAntiforgery,
  verifyPassword,
} from '@crombolo/auth'
import {
  DEFAULT_PASSWORD_CONFIGURATION,
  isValidPassword,
  localReturnUrl,
  memberMayOpen,
  ObjectTypes,
} from '@crombolo/core'
import {
  ContentTypeRepository,
  type Db,
  ensureKeyValue,
  type MemberRecord,
  MemberRepository,
  type NodeSchemaState,
  PublicAccessRepository,
} from '@crombolo/data'
import {
  type AccessDecision,
  MEMBER_EXTERNAL_SIGN_IN_PATH,
  type PublishedContent,
  type RequestMember,
} from '@crombolo/render'
import { recordAudit } from './adapters/audit.ts'
import { type CromboloConfig, DEFAULT_MEMBER_RATE_LIMITS } from './config.ts'
import type { EmailPort } from './email.ts'
import { createExternalSignIn, type ExternalAccount } from './external-sign-in.ts'
import { IdentityProviderOverrides } from './identity-provider-overrides.ts'
import { logger } from './logging.ts'
import { MemberClaims } from './member-claims.ts'
import { createMemberResetLinks, type ResetLinkOutcome } from './member-reset.ts'
import { SharedRateLimiter } from './shared-rate-limit.ts'
import { MEMBER_TWO_FACTOR_PROVIDER, TwoFactorService } from './two-factor.ts'

/** The key member tickets are signed with, generated once and shared by every node. */
const SIGNING_KEY = 'crombolo/memberCookieKey'

export const MEMBER_ROUTE_PREFIX = '/umbraco/members'

/** How long a member has to enter their code after their password. */
const TWO_FACTOR_PENDING_SECONDS = 5 * 60

/** How long which properties a member may see of themselves is held. */
const VIEWABLE_MS = 5_000

export interface MemberAuthOptions {
  /** The schema state this node runs at; a registration is refused without it. */
  nodeState?: NodeSchemaState
  nodeId?: string
  log?: (message: string) => void
  /** Story 282: the site's e-mail, asked each time as Settings can change it. */
  email?: () => EmailPort | undefined
}

export { MEMBER_RESET_HOURS } from './member-reset.ts'

/** A member signed in by the site's cookie, with that session's anti-forgery token. */
export interface MemberSession {
  member: RequestMember
  /** For `<AntiforgeryMeta />`. */
  antiforgery: string
  /** Whether a request's `Crombolo-Antiforgery` value belongs to this session. */
  verify(token: string | null): Promise<boolean>
}

export interface MemberAuth {
  /** The member this request carries, or undefined. */
  resolve(request: Request): Promise<RequestMember | undefined>
  /** The member this request's cookie carries, and its anti-forgery token (story 186). */
  session(request: Request): Promise<MemberSession | undefined>
  /**
   * Whether a member may see a page, and what to render instead when not. The
   * answer is Umbraco's: the login page for a visitor who is not signed in, the
   * error page for one who is signed in but not allowed.
   */
  decide(content: PublishedContent, member: RequestMember | undefined): Promise<AccessDecision>
  /** A member by key, as a page sees them, for previewing as them (story 264). */
  byKey(key: string): Promise<RequestMember | undefined>
  /**
   * Handles the member endpoints, or undefined when the path is not one. `caller` is the
   * address the request came from, for the rate limits (story 282).
   */
  handle(request: Request, pathname: string, caller?: string): Promise<Response | undefined>
  /** Story 282: a reset link for the member, sent or, without e-mail, handed back. */
  sendResetLink(
    member: { key: string; name: string; email: string; username: string },
    options?: { origin?: string },
  ): Promise<ResetLinkOutcome>
  /** The `Set-Cookie` value that ends a member's site session. */
  signOutCookie(): string
  /**
   * Where a "Sign in with …" link for a member identity provider goes, by its
   * id; undefined for a provider the site does not configure.
   */
  externalSignInUrl(providerId: string, returnUrl?: string): string | undefined
}

const isFormPost = (request: Request) =>
  (request.headers.get('content-type') ?? '').includes('form')

async function readInput(request: Request): Promise<Record<string, string>> {
  if (isFormPost(request)) {
    const form = await request.formData().catch(() => undefined)
    if (!form) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of form.entries()) if (typeof value === 'string') out[key] = value
    return out
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(body ?? {}))
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      out[key] = String(value)
  return out
}

/**
 * A `returnUrl` must be a path on this site. An absolute URL would let a login
 * form bounce a visitor somewhere else, which is the open-redirect this closes.
 *
 * `localReturnUrl` rather than a prefix test: a browser reads `/\evil.com` as
 * protocol-relative, so the leading single slash it appears to have is not a
 * guarantee of anything.
 */
const safeReturnUrl = (value: string | undefined): string | undefined => localReturnUrl(value)

/** The page a form was posted from, on this site; `/` when not known. */
const backFrom = (request: Request): string => {
  const referer = request.headers.get('referer')
  if (!referer) return '/'
  const from = new URL(referer, request.url)
  return from.origin === new URL(request.url).origin
    ? (safeReturnUrl(`${from.pathname}${from.search}`) ?? '/')
    : '/'
}

export function createMemberAuth(
  db: Db,
  config: CromboloConfig,
  options: MemberAuthOptions = {},
): MemberAuth {
  // A registration is a write, so it is refused unless the repository is told
  // which schema state this node runs at.
  const members = new MemberRepository(db, { nodeState: options.nodeState, nodeId: options.nodeId })
  const access = new PublicAccessRepository(db)
  const memberTypes = new ContentTypeRepository(db, { kind: 'member' })
  const cookie = memberCookieName({
    siteName: config.siteName,
    securePrefix: config.secureCookies,
  })
  // Read once and held: every front-end request resolves a member, and that must
  // not cost a query for the key each time.
  let signingKey: Promise<string> | undefined
  const secret = () => {
    signingKey ??= ensureKeyValue(db, SIGNING_KEY, () => crypto.randomUUID())
    return signingKey
  }

  const twoFactor = new TwoFactorService(db, {
    secretKey: config.secretKey,
    issuer: config.siteName,
  })
  const pendingCookie = `${cookie}TwoFactor`
  const flagged = (url: string, flags: string) => `${url}${url.includes('?') ? '&' : '?'}${flags}`

  const asRequestMember = (member: {
    key: string
    name: string
    username: string
    email: string
    roles: string[]
  }): RequestMember => ({
    key: member.key,
    name: member.name,
    username: member.username,
    email: member.email,
    roles: member.roles,
  })

  // Asked on every request a member makes, so held briefly: a type's own change
  // reaches it within the time.
  const viewable = new Map<string, { aliases: ReadonlySet<string>; until: number }>()
  const viewableOf = async (typeKey: string) => {
    const held = viewable.get(typeKey)
    if (held && held.until > Date.now()) return held.aliases
    const aliases = new Set(
      (await memberTypes.resolveProperties(typeKey))
        .filter((p) => p.memberCanView === true)
        .map((p) => p.alias),
    )
    viewable.set(typeKey, { aliases, until: Date.now() + VIEWABLE_MS })
    return aliases
  }

  /** With what their member type lets them see of themselves (story 207). */
  const withProperties = async (member: MemberRecord): Promise<RequestMember> => {
    const aliases = await viewableOf(member.contentTypeKey)
    const stored = aliases.size > 0 ? await members.content.byKey(member.key) : undefined
    return {
      ...asRequestMember(member),
      properties: Object.fromEntries(
        (stored?.values ?? [])
          .filter((v) => aliases.has(v.alias) && !v.culture && !v.segment && !v.environment)
          .map((v) => [v.alias, v.value]),
      ),
    }
  }

  const issue = async (key: string, stamp: string | null, persist: boolean, via?: string) => {
    const expires = Math.floor(Date.now() / 1000) + config.memberSessionMinutes * 60
    const ticket = await signMemberTicket(await secret(), {
      id: key,
      stamp: stamp ?? '',
      expires,
      ...(via ? { via } : {}),
    })
    return serializeCookie({
      name: cookie,
      value: ticket,
      secure: config.secureCookies,
      // Without "remember me" the cookie lasts the browser session, though the
      // ticket inside it still expires.
      maxAgeSeconds: persist ? config.memberSessionMinutes * 60 : undefined,
    })
  }

  /** Member group keys by name, for the names a registration or a provider names. */
  const groupKeysFor = async (names: readonly string[]): Promise<string[]> => {
    const keys: string[] = []
    for (const groupName of names) {
      const rows = await db.q
        .selectFrom('node')
        .select('unique_id')
        .where('text', '=', groupName)
        .where('node_object_type', '=', ObjectTypes.MemberGroup)
        .execute()
      if (rows[0]) keys.push(String(rows[0].unique_id))
    }
    return keys
  }

  const asAccount = (member: { key: string; email: string; roles: string[] }): ExternalAccount => ({
    key: member.key,
    email: member.email,
    groups: member.roles,
  })

  const claims = new MemberClaims(db, members, memberTypes, options.log)

  const MEMBER_EXTERNAL_PATH = MEMBER_EXTERNAL_SIGN_IN_PATH
  const external =
    config.memberIdentityProviders.length === 0
      ? undefined
      : createExternalSignIn(
          db,
          {
            audience: 'member',
            providers: config.memberIdentityProviders,
            basePath: MEMBER_EXTERNAL_PATH,
            byKey: async (key) => {
              const member = await members.byKey(key)
              return member ? asAccount(member) : undefined
            },
            byEmail: async (email) => {
              const member = await members.byEmail(email)
              return member ? asAccount(member) : undefined
            },
            create: async (identity, provider, groups) => {
              const alias = provider.memberType ?? config.memberRegistrationType
              const type = await memberTypes.byAlias(alias)
              if (!type) throw new Error(`The member type "${alias}" does not exist.`)
              const email = identity.email as string
              // The email is the username, as registration makes it, unless
              // someone already signs in with that name.
              const username = (await members.taken('username', email))
                ? `${provider.oidc.id}-${identity.subject}`
                : email
              const created = await members.create(
                {
                  key: crypto.randomUUID(),
                  contentTypeKey: type.key,
                  componentKey: null,
                  parentKey: null,
                  values: await claims.valuesFor(type.key, provider, identity),
                  variants: [{ culture: null, segment: null, name: identity.name || email }],
                },
                {
                  email,
                  username,
                  isApproved: true,
                  isLockedOut: false,
                  groupKeys: await groupKeysFor(groups),
                },
              )
              return asAccount(created)
            },
            setGroups: async (account, groups) => {
              await members.setGroups(account.key, await groupKeysFor(groups))
            },
            setProperties: (account, identity, provider) =>
              claims.sync(account.key, provider, identity),
            signIn: async (account, _request, provider) => {
              const member = await members.byKey(account.key)
              if (!member?.isApproved || member.isLockedOut)
                return { refused: 'This account cannot sign in at the moment.' }
              await members.recordLogin(member.key)
              return {
                cookies: [await issue(member.key, member.securityStamp, false, provider.oidc.id)],
              }
            },
            failed: (returnUrl, reason) =>
              `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}memberLoginFailed=1&memberLoginError=${encodeURIComponent(reason)}`,
          },
          {
            applicationUrl: config.applicationUrl,
            secureCookies: config.secureCookies,
            log: options.log,
            resolve: (provider) =>
              new IdentityProviderOverrides(
                db,
                config.secretKey,
                config.lockedIdentityProviders,
              ).apply('member', provider),
          },
        )

  const session: MemberAuth['session'] = async (request) => {
    const key = await secret()
    const ticket = await readMemberTicket(key, readCookie(request, cookie))
    if (!ticket) return undefined
    const member = await members.byKey(ticket.id)
    if (!member) return undefined
    // The stamp is what makes revocation immediate: a password change or a
    // lockout rotates it, and every ticket issued before it is now worthless.
    if ((member.securityStamp ?? '') !== ticket.stamp) return undefined
    if (!member.isApproved || member.isLockedOut) return undefined
    return {
      member: await withProperties(member),
      antiforgery: await antiforgeryToken(key, ticket),
      verify: (token) => verifyAntiforgery(key, ticket, token),
    }
  }

  const resolve: MemberAuth['resolve'] = async (request) => (await session(request))?.member

  const decide: MemberAuth['decide'] = async (content, member) => {
    const entry = await access.entryFor(content.key)
    if (!entry) return { status: 'allowed' }
    const here = content.key.toLowerCase()
    // The login and error pages must render even when they sit inside the
    // branch they serve, or the substitution would never terminate.
    if (here === entry.loginNodeKey || here === entry.errorNodeKey) return { status: 'allowed' }
    if (!member) return { status: 'substitute', contentKey: entry.loginNodeKey }
    return memberMayOpen(entry, { username: member.username, groups: member.roles })
      ? { status: 'allowed' }
      : { status: 'substitute', contentKey: entry.errorNodeKey }
  }

  const answer = (
    request: Request,
    result: { ok: true; body?: unknown } | { ok: false; status: number; error: string },
    options: { returnUrl?: string; cookies?: string[] } = {},
  ): Response => {
    const headers = new Headers()
    for (const value of options.cookies ?? []) headers.append('set-cookie', value)
    if (isFormPost(request)) {
      headers.set('location', options.returnUrl ?? '/')
      // 303 so the browser follows with GET rather than re-posting.
      return new Response(null, { status: 303, headers })
    }
    headers.set('content-type', 'application/json')
    return new Response(
      JSON.stringify(result.ok ? (result.body ?? { ok: true }) : { error: result.error }),
      { status: result.ok ? 200 : result.status, headers },
    )
  }

  const login = async (request: Request): Promise<Response> => {
    const input = await readInput(request)
    const returnUrl = safeReturnUrl(input.returnUrl)
    const username = (input.username ?? '').trim()
    const member = username ? await members.byUsername(username) : undefined
    // A failed form post lands back where it came from, with a flag the login
    // template can read; a failed fetch gets a 401.
    const back = returnUrl ?? '/'
    const failed = () =>
      answer(
        request,
        { ok: false, status: 401, error: 'The username or password is not correct.' },
        { returnUrl: `${back}${back.includes('?') ? '&' : '?'}memberLoginFailed=1` },
      )
    if (!member) {
      // Spend the same time as a real verification would, so a missing username
      // is not distinguishable by how quickly it fails.
      await verifyPassword(input.password ?? '', await hashPassword(crypto.randomUUID()))
      return failed()
    }
    // Checked before the password, so the answer never depends on whether the
    // password was right; the same throwaway verify as above keeps the time taken
    // from saying what the response does not.
    // A member with no password signs in only through a provider (story 035).
    // Refused like a wrong password, in the same time, and not counted: a
    // stranger's guesses must not lock out the provider sign-in, nor say that
    // the account has no password.
    if (member.isLockedOut || !member.isApproved || !member.passwordHash) {
      await verifyPassword(input.password ?? '', await hashPassword(crypto.randomUUID()))
      return failed()
    }
    if (
      !(await verifyPassword(input.password ?? '', member.passwordHash, {
        passwordConfig: member.passwordConfig,
        forMember: true,
      }))
    ) {
      await members.recordFailedLogin(member.key, config.maxFailedPasswordAttempts)
      return failed()
    }
    // An imported Umbraco hash is replaced now the password is known to match it.
    if (!isNativeHash(member.passwordHash))
      await members.rehashPassword(
        member.key,
        await hashPassword(input.password ?? ''),
        passwordConfigJson(),
      )
    if ((await twoFactor.providers(member.key)).includes(MEMBER_TWO_FACTOR_PROVIDER)) {
      const pending = await signShortLived(
        await secret(),
        { sub: member.key, persist: input.rememberMe === 'true' ? 1 : 0 },
        TWO_FACTOR_PENDING_SECONDS,
      )
      return answer(
        request,
        { ok: true, body: { twoFactorRequired: true } },
        {
          returnUrl: flagged(back, 'memberTwoFactorRequired=1'),
          cookies: [
            serializeCookie({
              name: pendingCookie,
              value: pending,
              secure: config.secureCookies,
              maxAgeSeconds: TWO_FACTOR_PENDING_SECONDS,
            }),
          ],
        },
      )
    }
    await members.recordLogin(member.key)
    return answer(
      request,
      { ok: true, body: { member: asRequestMember(member) } },
      {
        returnUrl: returnUrl ?? '/',
        cookies: [await issue(member.key, member.securityStamp, input.rememberMe === 'true')],
      },
    )
  }

  /** The second step: the code from the app, or a recovery code, after the password. */
  const verifyTwoFactor = async (request: Request): Promise<Response> => {
    const input = await readInput(request)
    const back = safeReturnUrl(input.returnUrl) ?? '/'
    const pending = await readShortLived(await secret(), readCookie(request, pendingCookie))
    const key = typeof pending?.sub === 'string' ? pending.sub : undefined
    const member = key ? await members.byKey(key) : undefined
    if (!member || member.isLockedOut || !member.isApproved)
      return answer(
        request,
        { ok: false, status: 401, error: 'Sign in again.' },
        {
          returnUrl: flagged(back, 'memberLoginFailed=1'),
          cookies: [expireCookie(pendingCookie, config.secureCookies)],
        },
      )
    if (!(await twoFactor.verify(member.key, MEMBER_TWO_FACTOR_PROVIDER, input.code ?? ''))) {
      await members.recordFailedLogin(member.key, config.maxFailedPasswordAttempts)
      return answer(
        request,
        { ok: false, status: 400, error: 'That code is not right.' },
        { returnUrl: flagged(back, 'memberTwoFactorRequired=1&memberLoginFailed=1') },
      )
    }
    await members.recordLogin(member.key)
    return answer(
      request,
      { ok: true, body: { member: asRequestMember(member) } },
      {
        returnUrl: back,
        cookies: [
          await issue(member.key, member.securityStamp, pending?.persist === 1),
          expireCookie(pendingCookie, config.secureCookies),
        ],
      },
    )
  }

  /** The signed-in member's own two-factor settings; JSON, as the recovery codes must be shown. */
  const manageTwoFactor = async (request: Request, step: string): Promise<Response> => {
    const member = await resolve(request)
    if (!member) return Response.json({ error: 'Sign in first.' }, { status: 401 })
    const refused = (message: string, status = 400) => Response.json({ error: message }, { status })
    if (step === '') {
      if (request.method !== 'GET') return new Response(null, { status: 405 })
      return Response.json({
        available: twoFactor.available,
        enabled: (await twoFactor.providers(member.key)).includes(MEMBER_TWO_FACTOR_PROVIDER),
        recoveryCodesLeft: await twoFactor.recoveryCodesLeft(member.key),
      })
    }
    if (request.method !== 'POST') return new Response(null, { status: 405 })
    if (!isSameOrigin(request, config.applicationUrl || undefined))
      return new Response('Forbidden', { status: 403 })
    const input = await readInput(request)
    switch (step) {
      case 'setup': {
        const setup = twoFactor.setup(member.email || member.username)
        return setup.ok ? Response.json(setup.value) : refused(setup.message)
      }
      case 'enable': {
        const enabled = await twoFactor.enable(
          member.key,
          MEMBER_TWO_FACTOR_PROVIDER,
          input.secret ?? '',
          input.code ?? '',
        )
        return enabled.ok ? Response.json(enabled.value) : refused(enabled.message)
      }
      case 'disable': {
        const disabled = await twoFactor.disable(
          member.key,
          MEMBER_TWO_FACTOR_PROVIDER,
          input.code ?? '',
        )
        return disabled.ok ? Response.json({ ok: true }) : refused(disabled.message)
      }
      default:
        return new Response(null, { status: 404 })
    }
  }

  const logout = async (request: Request): Promise<Response> => {
    const input = await readInput(request)
    const returnUrl = safeReturnUrl(input.returnUrl) ?? '/'
    const ticket = await readMemberTicket(await secret(), readCookie(request, cookie))
    const signOutUrl = ticket?.via
      ? await external?.signOutUrl(request, ticket.via, returnUrl)
      : undefined
    return answer(
      request,
      { ok: true, ...(signOutUrl ? { body: { ok: true, signOutUrl } } : {}) },
      {
        returnUrl: signOutUrl ?? returnUrl,
        cookies: [expireCookie(cookie, config.secureCookies)],
      },
    )
  }

  const register = async (request: Request): Promise<Response> => {
    if (!config.allowMemberRegistration)
      return answer(request, {
        ok: false,
        status: 404,
        error: 'Member registration is not enabled on this site.',
      })
    const input = await readInput(request)
    const email = (input.email ?? '').trim()
    const username = (input.username ?? '').trim() || email
    const name = (input.name ?? '').trim() || username
    const password = input.password ?? ''
    if (!email || !username || !password)
      return answer(request, {
        ok: false,
        status: 400,
        error: 'A name, e-mail address and password are required.',
      })
    // The configured type, and only that: `memberRegistrationType` is the site's
    // statement of what a visitor may create, so honouring a type named in the
    // request would let them register as any member type the site defines.
    const alias = config.memberRegistrationType
    const type = await memberTypes.byAlias(alias)
    if (!type)
      return answer(request, {
        ok: false,
        status: 400,
        error: `The member type "${alias}" does not exist.`,
      })
    if ((await members.taken('username', username)) || (await members.taken('email', email)))
      return answer(request, {
        ok: false,
        status: 409,
        error: 'That username or e-mail address is already registered.',
      })
    // Members were held to no policy at all while backoffice users were; after
    // uniqueness, as ASP.NET Identity orders its own validators.
    if (!isValidPassword(password))
      return answer(request, {
        ok: false,
        status: 400,
        error: `A password must be at least ${DEFAULT_PASSWORD_CONFIGURATION.minimumPasswordLength} characters.`,
      })
    const groupKeys = await groupKeysFor(config.memberRegistrationGroups)
    const created = await members.create(
      {
        key: crypto.randomUUID(),
        contentTypeKey: type.key,
        componentKey: null,
        parentKey: null,
        values: [],
        variants: [{ culture: null, segment: null, name }],
      },
      {
        email,
        username,
        isApproved: true,
        isLockedOut: false,
        passwordHash: await hashPassword(password),
        passwordConfig: passwordConfigJson(),
        groupKeys,
      },
    )
    return answer(
      request,
      { ok: true, body: { member: asRequestMember(created) } },
      {
        returnUrl: safeReturnUrl(input.returnUrl) ?? '/',
        cookies: [await issue(created.key, created.securityStamp, false)],
      },
    )
  }

  // ------------------------------------------------------------ story 282: password reset
  const limits = { ...DEFAULT_MEMBER_RATE_LIMITS, ...config.members?.rateLimits }
  const limiter = new SharedRateLimiter(db)
  const MINUTE = 60_000
  const HOUR = 60 * MINUTE
  const tooMany = (request: Request, seconds: number, back: string) => {
    const response = answer(
      request,
      { ok: false, status: 429, error: `Too many attempts. Try again in ${seconds} seconds.` },
      { returnUrl: flagged(back, 'memberTooMany=1') },
    )
    response.headers.set('retry-after', String(seconds))
    return response
  }
  const signInLimit = (caller: string | undefined) =>
    limiter.take(`member-sign-in:${caller ?? 'unknown'}`, limits.signInPerIpPerMinute, MINUTE)

  const resets = createMemberResetLinks(db, config, () => options.email?.())
  const { mailer, providerOf, providerWords, sendResetLink } = resets

  const forgotPassword = async (
    request: Request,
    caller: string | undefined,
  ): Promise<Response> => {
    const input = await readInput(request)
    const back = safeReturnUrl(input.returnUrl) ?? '/'
    if (!config.members?.resetPasswordPage || !mailer())
      return answer(
        request,
        { ok: false, status: 503, error: 'Resetting a password is not available on this site.' },
        { returnUrl: flagged(back, 'memberResetUnavailable=1') },
      )
    const wait = await limiter.take(
      `member-forgot:${caller ?? 'unknown'}`,
      limits.forgotPerIpPerHour,
      HOUR,
    )
    if (wait) return tooMany(request, wait, back)
    const email = (input.email ?? '').trim().toLowerCase()
    const sent = answer(
      request,
      {
        ok: true,
        body: {
          ok: true,
          message: 'If that address has an account here, a message is on its way to it.',
        },
      },
      { returnUrl: flagged(back, 'memberResetSent=1') },
    )
    if (!email.includes('@')) return sent
    // Past an address's limit the answer is the same, and nothing more is sent.
    if (await limiter.take(`member-forgot-address:${email}`, limits.forgotPerAddressPerHour, HOUR))
      return sent
    const origin = new URL(request.url).origin
    // Sent after answering, so how long the answer takes says nothing of the address.
    void (async () => {
      const member = await members.byEmail(email)
      if (!member) return
      const provider = await providerOf(member.key)
      if (provider) {
        await mailer()?.(
          { name: member.name, email: member.email },
          providerWords(member.name, provider),
        )
        return
      }
      await sendResetLink(member, { origin })
    })().catch((error) =>
      logger('members').error('Could not send a password reset e-mail: {error}', { error }),
    )
    return sent
  }

  const resetPassword = async (request: Request, caller: string | undefined): Promise<Response> => {
    const input = await readInput(request)
    const back = safeReturnUrl(input.returnUrl) ?? '/'
    const page = config.members?.resetPasswordPage ?? '/'
    const token = input.token ?? ''
    const again = (flag: string, keepToken: boolean) =>
      flagged(
        keepToken && token ? flagged(page, `token=${encodeURIComponent(token)}`) : page,
        `memberResetFailed=${flag}`,
      )
    const wait = await signInLimit(caller)
    if (wait) return tooMany(request, wait, page)
    const password = input.password ?? ''
    if (!isValidPassword(password))
      return answer(
        request,
        {
          ok: false,
          status: 400,
          error: `A password must be at least ${DEFAULT_PASSWORD_CONFIGURATION.minimumPasswordLength} characters.`,
        },
        { returnUrl: again('password', true) },
      )
    const expired = () =>
      answer(
        request,
        {
          ok: false,
          status: 400,
          error: 'This link has expired or has already been used. Ask for a new one.',
        },
        { returnUrl: again('expired', false) },
      )
    const key = token ? await members.takeResetToken(hashToken(token)) : undefined
    const member = key ? await members.byKey(key) : undefined
    if (!member || (await providerOf(member.key))) return expired()
    await members.resetPassword(member.key, await hashPassword(password), passwordConfigJson())
    await recordAudit(db, {
      category: 'member',
      action: 'ResetPassword',
      source: 'request',
      entityType: 'Member',
      entityKey: member.key,
      entityName: member.name,
      detail: 'From a reset link',
      ipAddress: caller ?? null,
    })
    return answer(
      request,
      { ok: true, body: { ok: true } },
      { returnUrl: flagged(back, 'memberPasswordReset=1') },
    )
  }

  return {
    resolve,
    session,
    decide,
    sendResetLink,
    async byKey(key) {
      const member = await members.byKey(key)
      return member ? withProperties(member) : undefined
    },
    signOutCookie: () => expireCookie(cookie, config.secureCookies),
    externalSignInUrl: (providerId, returnUrl) =>
      config.memberIdentityProviders.some((p) => p.oidc.id === providerId)
        ? external?.startUrl(providerId, returnUrl)
        : undefined,
    async handle(request, pathname, caller) {
      if (!pathname.startsWith(`${MEMBER_ROUTE_PREFIX}/`)) return undefined
      if (pathname.startsWith(`${MEMBER_EXTERNAL_PATH}/`))
        return external?.handle(request, pathname) ?? undefined
      const action = pathname.slice(MEMBER_ROUTE_PREFIX.length + 1)
      if (action === 'current') {
        if (request.method !== 'GET') return new Response(null, { status: 405 })
        const member = await resolve(request)
        return member ? Response.json({ member }) : Response.json({ member: null }, { status: 401 })
      }
      if (action === '2fa' || action.startsWith('2fa/'))
        return manageTwoFactor(request, action.slice(4))
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      // SameSite=Lax still lets a sibling subdomain post here, signing a visitor
      // into an account the attacker holds, or out of their own.
      if (!isSameOrigin(request, config.applicationUrl || undefined))
        return new Response('Forbidden', { status: 403 })
      switch (action) {
        case 'login':
        case 'login/2fa': {
          const wait = await signInLimit(caller)
          // A form is sent back where it came from, as a wrong password is.
          if (wait) return tooMany(request, wait, backFrom(request))
          return action === 'login' ? login(request) : verifyTwoFactor(request)
        }
        case 'forgot-password':
          return forgotPassword(request, caller)
        case 'reset-password':
          return resetPassword(request, caller)
        case 'logout':
          return logout(request)
        case 'register':
          return register(request)
        default:
          return undefined
      }
    },
  }
}
