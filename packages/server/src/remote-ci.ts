/**
 * Signing in to a remote from CI (story 160): a GitHub Actions or GitLab job's
 * OIDC identity token, exchanged (RFC 8693) for a short-lived token that acts
 * as the trust rule it matched. No secret is stored anywhere: the provider signs
 * the identity token, and a rule an administrator made on this site says which
 * repository and branch, tag or environment it must come from, and what it may
 * do. docs/remote-protocol.md, "Signing in from CI".
 */
import type { Principal } from '@crombolo/api-management/domain'
import { RemotePermissions } from '@crombolo/core'
import {
  type CiToken,
  type Db,
  RemoteTrustRepository,
  type TrustRefKind,
  type TrustRule,
  type TrustRuleInput,
} from '@crombolo/data'
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose'
import { AttemptLimiter } from './setup.ts'

export const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'
export const GITLAB_ISSUER = 'https://gitlab.com'
export const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
export const JWT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:jwt'
export const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'

/** How long a CI token lasts. There is no refresh: the job exchanges again. */
export const CI_TOKEN_SECONDS = 15 * 60
/** An identity token valid for longer than this is refused. */
const MAX_IDENTITY_SECONDS = 60 * 60

/** The issuers a site trusts tokens from: GitHub's, gitlab.com's, and any it names. */
export function trustedIssuers(extra: readonly string[] = []): string[] {
  return [...new Set([GITHUB_ISSUER, GITLAB_ISSUER, ...extra.map((i) => i.replace(/\/+$/, ''))])]
}

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]'

/** An issuer is fetched over HTTPS; a local one only for a test or a developer's own GitLab. */
export function usableIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer)
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLocal(url.hostname))
  } catch {
    return false
  }
}

/** Where a CI run was, from its identity token, in the same words for either provider. */
export interface RunClaims {
  repository: string
  refType: 'branch' | 'tag' | undefined
  ref: string | undefined
  environment: string | undefined
  /** The run, for the audit log: GitHub's run id and attempt, GitLab's pipeline and job. */
  run: string | undefined
}

const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined)

/** A verified identity token's claims, as GitHub or GitLab put them. Pure. */
export function runClaims(issuer: string, payload: JWTPayload): RunClaims | undefined {
  const refType = text(payload.ref_type)
  const kind = refType === 'branch' || refType === 'tag' ? refType : undefined
  if (issuer === GITHUB_ISSUER) {
    const repository = text(payload.repository)
    if (!repository) return undefined
    const ref = text(payload.ref)
    const prefix = kind === 'tag' ? 'refs/tags/' : 'refs/heads/'
    const runId = text(payload.run_id)
    return {
      repository,
      refType: kind,
      ref: ref?.startsWith(prefix) ? ref.slice(prefix.length) : ref,
      environment: text(payload.environment),
      run: runId ? `${runId}/${text(payload.run_attempt) ?? '1'}` : undefined,
    }
  }
  // GitLab, whether gitlab.com or a self-managed instance a site names.
  const repository = text(payload.project_path)
  if (!repository) return undefined
  const pipeline = text(payload.pipeline_id)
  const job = text(payload.job_id)
  return {
    repository,
    refType: kind,
    ref: text(payload.ref),
    environment: text(payload.environment),
    run: pipeline ? `${pipeline}${job ? `/${job}` : ''}` : undefined,
  }
}

/** Whether a rule admits a run: its issuer, repository and ref exactly, no wildcards. Pure. */
export function ruleMatches(rule: TrustRule, issuer: string, claims: RunClaims): boolean {
  if (rule.disabled || rule.issuer !== issuer) return false
  // Owners and repositories are case-insensitive on both providers.
  if (rule.repository.toLowerCase() !== claims.repository.toLowerCase()) return false
  if (rule.refKind === 'environment') return claims.environment === rule.refValue
  return claims.refType === rule.refKind && claims.ref === rule.refValue
}

/** The remote verbs a rule may hold. */
export const TRUSTABLE_PERMISSIONS: readonly string[] = Object.values(RemotePermissions)

const REF_KINDS: readonly TrustRefKind[] = ['branch', 'tag', 'environment']

/** A rule as posted, checked: undefined and the reasons when it cannot be one. Pure. */
export function readRuleInput(
  body: unknown,
  issuers: readonly string[],
): { input?: TrustRuleInput; problems: string[] } {
  const b = (body ?? {}) as Record<string, unknown>
  const problems: string[] = []
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name || name.length > 255) problems.push('Give it a name of up to 255 characters.')
  const issuer = typeof b.issuer === 'string' ? b.issuer.trim().replace(/\/+$/, '') : ''
  if (!issuers.includes(issuer))
    problems.push(`The provider must be one of: ${issuers.join(', ')}.`)
  const repository = typeof b.repository === 'string' ? b.repository.trim() : ''
  if (!/^[\w.-]+(\/[\w.-]+)+$/.test(repository))
    problems.push(
      'The repository is owner/name (GitHub) or group/project (GitLab), with no wildcards.',
    )
  const refKind = REF_KINDS.find((k) => k === b.refKind)
  if (!refKind) problems.push('Say whether it matches a branch, a tag or an environment.')
  const refValue = typeof b.refValue === 'string' ? b.refValue.trim() : ''
  if (!refValue || /[*?[\]]/.test(refValue))
    problems.push('Name the branch, tag or environment exactly, with no wildcards.')
  const permissions = Array.isArray(b.permissions)
    ? [...new Set(b.permissions.filter((p): p is string => typeof p === 'string'))]
    : []
  if (permissions.length === 0) problems.push('Choose what it may do.')
  const unknown = permissions.filter((p) => !TRUSTABLE_PERMISSIONS.includes(p))
  if (unknown.length > 0) problems.push(`Not remote permissions: ${unknown.join(', ')}.`)
  if (problems.length > 0) return { problems }
  return {
    input: { name, issuer, repository, refKind: refKind as TrustRefKind, refValue, permissions },
    problems,
  }
}

/** The principal a CI token acts as: the rule, holding its remote permissions and nothing else. */
export function ciPrincipal(token: CiToken): Principal {
  const none = { root: false, keys: [] }
  return {
    id: token.rule.key,
    userName: token.rule.name,
    name: `CI: ${token.rule.name}`,
    email: '',
    isAdmin: false,
    languageIsoCode: undefined,
    avatarUrls: [],
    allowedSections: [],
    permissions: token.rule.permissions.filter((p) => TRUSTABLE_PERMISSIONS.includes(p)),
    groupKeys: [],
    hasAccessToAllLanguages: false,
    languages: [],
    startNodes: { document: none, media: none, element: none },
    groups: [],
    ci: { rule: token.rule.key, claims: token.claims },
  }
}

/** Whether a request came over HTTPS: directly, or through a proxy that says so. */
export function overHttps(request: Request, url: URL): boolean {
  if (url.protocol === 'https:') return true
  if (request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https') return true
  return isLocal(url.hostname)
}

export interface CiSignIn {
  /** What the discovery document says about signing in from CI. */
  discovery(origin: string, api: string): Record<string, unknown>
  /** The exchange: an identity token in, a CI token out, or a refusal that says nothing more. */
  exchange(request: Request, url: URL, ip: string | undefined): Promise<Response>
  /** The principal a bearer token is, when it is a CI token. */
  principalOf(request: Request): Promise<Principal | undefined>
  readonly issuers: readonly string[]
}

type Refusal = { reason: string; issuer?: string; repository?: string }

export function createCiSignIn(options: {
  db: Db
  issuers: readonly string[]
  /** Told of each exchange, accepted or refused, for the audit log. */
  onExchange(
    outcome: { ok: true; rule: TrustRule; claims: RunClaims } | ({ ok: false } & Refusal),
    request: Request,
  ): Promise<void>
}): CiSignIn {
  const rules = new RemoteTrustRepository(options.db)
  const issuers = options.issuers.filter(usableIssuer)
  const limiter = new AttemptLimiter({ max: 10, maxAll: 200, windowMs: 15 * 60_000 })
  const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

  /** The issuer's signing keys, from its OIDC discovery; cached, and failing closed. */
  const keysOf = async (issuer: string) => {
    const known = keySets.get(issuer)
    if (known) return known
    const response = await fetch(`${issuer}/.well-known/openid-configuration`)
    if (!response.ok) throw new Error(`the issuer's discovery answered ${response.status}`)
    const { jwks_uri: jwksUri } = (await response.json()) as { jwks_uri?: string }
    if (!jwksUri || !usableIssuer(new URL(jwksUri).origin))
      throw new Error('the issuer names no usable key set')
    const set = createRemoteJWKSet(new URL(jwksUri))
    keySets.set(issuer, set)
    return set
  }

  const refuse = async (request: Request, refusal: Refusal, ip: string | undefined) => {
    limiter.fail(`ip:${ip ?? 'unknown'}`)
    if (refusal.issuer) limiter.fail(`issuer:${refusal.issuer}`)
    await options.onExchange({ ok: false, ...refusal }, request)
    // The same answer whatever went wrong: the audit log has the reason, the caller does not.
    return Response.json(
      { error: 'invalid_grant', error_description: 'The identity token was not accepted.' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    )
  }

  const unverifiedIssuer = (token: string): string | undefined => {
    try {
      const body = token.split('.')[1]
      if (!body) return undefined
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JWTPayload
      return typeof payload.iss === 'string' ? payload.iss.replace(/\/+$/, '') : undefined
    } catch {
      return undefined
    }
  }

  return {
    issuers,

    discovery(origin, api) {
      return {
        tokenExchange: `${api}/token`,
        grantType: TOKEN_EXCHANGE_GRANT,
        subjectTokenType: JWT_TOKEN_TYPE,
        audience: origin,
        issuers,
      }
    },

    async exchange(request, url, ip) {
      const json = (body: unknown, status: number) =>
        Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
      if (!overHttps(request, url))
        return json(
          { error: 'invalid_request', error_description: 'Signing in from CI needs HTTPS.' },
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
      if (!issuer || !issuers.includes(issuer))
        return refuse(request, { reason: 'an issuer this site does not trust' }, ip)
      if (limiter.blocked(`issuer:${issuer}`))
        return json({ error: 'slow_down', error_description: 'Too many refused tokens.' }, 429)

      let payload: JWTPayload
      try {
        const verified = await jwtVerify(token, await keysOf(issuer), {
          issuer,
          audience: url.origin,
          requiredClaims: ['exp', 'iat', 'jti'],
        })
        payload = verified.payload
      } catch (error) {
        return refuse(
          request,
          {
            reason: `the token did not verify: ${error instanceof Error ? error.message : String(error)}`,
            issuer,
          },
          ip,
        )
      }
      if ((payload.exp as number) - (payload.iat as number) > MAX_IDENTITY_SECONDS)
        return refuse(request, { reason: 'the token is valid for too long', issuer }, ip)

      const claims = runClaims(issuer, payload)
      if (!claims) return refuse(request, { reason: 'the token names no repository', issuer }, ip)
      const rule = (await rules.liveFor(issuer)).find((candidate) =>
        ruleMatches(candidate, issuer, claims),
      )
      if (!rule)
        return refuse(
          request,
          { reason: 'no trust rule matches', issuer, repository: claims.repository },
          ip,
        )

      const recorded: Record<string, string> = { repository: claims.repository }
      if (claims.refType) recorded.refType = claims.refType
      if (claims.ref) recorded.ref = claims.ref
      if (claims.environment) recorded.environment = claims.environment
      if (claims.run) recorded.run = claims.run
      const issued = await rules.issue(
        rule,
        { issuer, jti: payload.jti as string, claims: recorded },
        CI_TOKEN_SECONDS,
      )
      if (!issued) return refuse(request, { reason: 'the token was already used', issuer }, ip)
      await options.onExchange({ ok: true, rule, claims }, request)
      return json(
        {
          access_token: issued.token,
          issued_token_type: ACCESS_TOKEN_TYPE,
          token_type: 'Bearer',
          expires_in: CI_TOKEN_SECONDS,
        },
        200,
      )
    },

    async principalOf(request) {
      const header = request.headers.get('authorization') ?? ''
      const match = /^Bearer\s+(crci_\S+)$/i.exec(header)
      if (!match) return undefined
      const token = await rules.resolve(match[1] as string)
      return token ? ciPrincipal(token) : undefined
    },
  }
}
