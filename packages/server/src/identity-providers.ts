/**
 * External identity providers (story 031): typed presets a site's config lists,
 * one list for members and one for backoffice users. Each preset knows its
 * provider's issuer, scopes and claims; the rest says what a first sign-in may
 * do and how groups follow the account.
 *
 * ```ts
 * defineConfig({
 *   backofficeIdentityProviders: [entra({ tenantId, clientId, clientSecret, groups: { map: { … } } })],
 *   memberIdentityProviders: [awsIdentityCenter({ issuer, clientId, clientSecret })],
 * })
 * ```
 */
import type { OidcClaims, OidcProviderOptions } from '@crombolo/auth'
import { localReturnUrl } from '@crombolo/core'

/** What every preset takes besides the provider's own settings. */
export interface IdentityProviderOptions {
  /** The provider's id, in its URLs and in `external_login`; the preset's name by default. */
  id?: string
  /** What its sign-in button says: "Sign in with {name}". */
  name?: string
  /** Create a member or user for an account nobody has yet. On by default. */
  autoCreate?: boolean
  /**
   * Link a first sign-in to an existing member or user with the same email,
   * when the provider says the email is verified. Off by default: without it, an
   * email already taken is refused rather than merged.
   */
  linkByEmail?: boolean
  /**
   * Treat every email this provider sends as verified. For a provider whose
   * emails are the organisation's own, such as one Entra tenant, which sends no
   * `email_verified` claim.
   */
  emailsVerified?: boolean
  /**
   * Groups that follow the account: claim values mapped to member groups (for
   * members) or user group aliases (for users), made to match the claim on
   * every sign-in. Groups outside the map are left as they are.
   */
  groups?: { claim?: string; map: Record<string, string> }
  /** Groups a new member or user joins, besides the mapped ones. */
  defaultGroups?: readonly string[]
  /** Members only: the member type a new member is created as, by alias; `Member` by default. */
  memberType?: string
  /**
   * Takes no change from the back office (story 305): signs in by the config
   * alone. `CROMBOLO_LOCKED_IDENTITY_PROVIDERS` locks it too.
   */
  locked?: boolean
  /**
   * Back-office providers only (story 364): lets the remote exchange this
   * provider's tokens for a sign-in as the person they name. The token's `aud`
   * must be `audience`, the site's origin by default, and never a sign-in
   * client id. `CROMBOLO_REMOTE_EXCHANGE_PROVIDERS` turns it on too.
   * `actors` names the clients a token can be issued to, by client id, for the
   * history (story 366).
   */
  remoteExchange?: boolean | RemoteExchangeOptions
  /**
   * Members only (story 191): member properties, by alias, and the claim each
   * takes its value from, at creation and at every sign-in.
   */
  properties?: Readonly<Record<string, string>>
  /** The claim the account is linked by; `sub` by default. It must never change for a person. */
  subjectClaim?: string
  /** The page a cancelled sign-in goes to: a path on this site. */
  cancelUrl?: string
  /** The page a failed sign-in goes to: a path on this site. */
  failedUrl?: string
  /** Members only: signing out of the site ends the provider's session too. */
  signOut?: boolean
}

/** How a provider's tokens are exchanged at the remote (stories 364 and 366). */
export interface RemoteExchangeOptions {
  audience?: string
  /** The audience of a token exchanged for applying a change (story 394). */
  applyAudience?: string
  actors?: Readonly<Record<string, string>>
}

/** Which preset made a provider: what the Entra bundle looks for. */
export type IdentityProviderKind = 'entra' | 'aws' | 'b2c' | 'oidc'

/** A provider, ready for the config. */
export interface IdentityProvider {
  kind: IdentityProviderKind
  /** Entra only: the tenant its issuer is for, which an override may change. */
  tenantId?: string
  oidc: OidcProviderOptions
  autoCreate: boolean
  linkByEmail: boolean
  emailsVerified: boolean
  groupMap: Readonly<Record<string, string>>
  defaultGroups: readonly string[]
  memberType: string | undefined
  /** Declared `locked: true`. */
  locked: boolean
  /** Declared `remoteExchange`: the audience its exchanged tokens carry, and the actors it names. */
  remoteExchange: RemoteExchangeOptions | undefined
  /** Why it cannot sign anyone in as it stands, such as a new issuer with no secret of its own. */
  unavailable?: string
  /** Flows besides its sign-in, by name (story 191). */
  flows: Readonly<Record<string, OidcProviderOptions>>
  /** The start of the error description that means a forgotten password: `resetPassword` is started. */
  forgottenPassword?: string
  properties: Readonly<Record<string, string>>
  cancelUrl: string | undefined
  failedUrl: string | undefined
  signOut: boolean
}

/** The flow a provider has without naming any. */
export const SIGN_IN_FLOW = 'signIn'

/** A provider's flow by name; its sign-in for none. Pure. */
export function flowOf(
  provider: Pick<IdentityProvider, 'oidc' | 'flows'>,
  name: string | undefined,
): OidcProviderOptions | undefined {
  if (name === undefined || name === SIGN_IN_FLOW) return provider.oidc
  return Object.hasOwn(provider.flows, name) ? provider.flows[name] : undefined
}

/** What locks providers from the server's environment: their ids, or all of them. */
export type LockedIdentityProviders = readonly string[] | 'all'

/** Who locked a provider, if anyone: the site's config or the server's environment. Pure. */
export function lockOf(
  provider: IdentityProvider,
  locked: LockedIdentityProviders = [],
): 'config' | 'environment' | undefined {
  if (provider.locked) return 'config'
  if (locked === 'all' || locked.includes(provider.oidc.id)) return 'environment'
  return undefined
}

const ID = /^[a-z0-9][a-z0-9-]*$/
const FLOW = /^[A-Za-z][A-Za-z0-9]*$/

const originOfIssuer = (issuer: string, name: string) => {
  try {
    return new URL(issuer).origin
  } catch {
    throw new Error(`The ${name} identity provider's issuer "${issuer}" is not an address.`)
  }
}

/** A provider's other flows. Each is on the issuer's own address, where its secret may go (story 305). */
function flowsOf(
  oidc: OidcProviderOptions,
  issuers: Readonly<Record<string, string>>,
): Record<string, OidcProviderOptions> {
  const out: Record<string, OidcProviderOptions> = {}
  for (const [name, issuer] of Object.entries(issuers)) {
    if (!FLOW.test(name) || name === SIGN_IN_FLOW)
      throw new Error(
        `A flow's name is letters and digits, and not "${SIGN_IN_FLOW}": "${name}" is not.`,
      )
    if (originOfIssuer(issuer, oidc.name) !== originOfIssuer(oidc.issuer, oidc.name))
      throw new Error(
        `The ${oidc.name} identity provider's "${name}" flow is on another address than its sign-in.`,
      )
    out[name] = { ...oidc, issuer }
  }
  return out
}

/** Entra's issuer for a tenant. */
export const entraIssuer = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/v2.0`

function preset(
  kind: IdentityProviderKind,
  defaults: { id: string; name: string },
  provider: {
    issuer: string
    clientId: string
    clientSecret?: string
    scopes?: readonly string[]
    flows?: Readonly<Record<string, string>>
  },
  claims: OidcClaims,
  options: IdentityProviderOptions,
): IdentityProvider {
  const id = options.id ?? defaults.id
  if (!ID.test(id))
    throw new Error(`An identity provider's id is letters, digits and dashes: "${id}" is not.`)
  if (!provider.issuer) throw new Error(`The ${defaults.name} identity provider needs an issuer.`)
  if (!provider.clientId)
    throw new Error(`The ${defaults.name} identity provider needs a clientId.`)
  for (const field of ['cancelUrl', 'failedUrl'] as const) {
    const url = options[field]
    if (url !== undefined && !localReturnUrl(url))
      throw new Error(
        `The ${defaults.name} identity provider's ${field} is a path on this site: "${url}" is not.`,
      )
  }
  const oidc: OidcProviderOptions = {
    id,
    name: options.name ?? defaults.name,
    issuer: provider.issuer,
    clientId: provider.clientId,
    clientSecret: provider.clientSecret,
    scopes: provider.scopes ?? ['openid', 'profile', 'email'],
    // A group map with no claim named reads the usual `groups` claim.
    claims: {
      ...claims,
      groups: options.groups?.claim ?? claims.groups ?? (options.groups ? 'groups' : undefined),
    },
    ...(options.subjectClaim ? { subject: options.subjectClaim } : {}),
  }
  return {
    kind,
    oidc,
    flows: flowsOf(oidc, provider.flows ?? {}),
    properties: options.properties ?? {},
    cancelUrl: options.cancelUrl,
    failedUrl: options.failedUrl,
    signOut: options.signOut ?? false,
    autoCreate: options.autoCreate ?? true,
    linkByEmail: options.linkByEmail ?? false,
    emailsVerified: options.emailsVerified ?? false,
    groupMap: options.groups?.map ?? {},
    defaultGroups: options.defaultGroups ?? [],
    memberType: options.memberType,
    locked: options.locked === true,
    remoteExchange:
      options.remoteExchange === true
        ? {}
        : typeof options.remoteExchange === 'object'
          ? { ...options.remoteExchange }
          : undefined,
  }
}

/**
 * Microsoft Entra ID, for one tenant. Register a web app with a client secret
 * and the redirect URLs in `docs/operations.md`; for groups, add the `groups`
 * claim to its token configuration.
 */
export function entra(
  options: IdentityProviderOptions & { tenantId: string; clientId: string; clientSecret?: string },
): IdentityProvider {
  if (!options.tenantId) throw new Error('The Entra identity provider needs a tenantId.')
  const provider = preset(
    'entra',
    { id: 'entra', name: 'Microsoft' },
    {
      issuer: entraIssuer(options.tenantId),
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    },
    // Entra's `sub` differs for each app registration; `oid` is the person's in the tenant.
    { email: 'email', name: 'name', groups: 'groups', identity: 'oid' },
    options,
  )
  return { ...provider, tenantId: options.tenantId }
}

/**
 * AWS IAM Identity Center, through the OpenID Connect application its
 * instance issues; `issuer` is that instance's issuer URL.
 */
export function awsIdentityCenter(
  options: IdentityProviderOptions & { issuer: string; clientId: string; clientSecret?: string },
): IdentityProvider {
  return preset(
    'aws',
    { id: 'aws', name: 'AWS' },
    { issuer: options.issuer, clientId: options.clientId, clientSecret: options.clientSecret },
    { email: 'email', name: 'name', groups: 'groups' },
    options,
  )
}

/** Any OpenID Connect provider, by its issuer: Google, Okta, Auth0, Keycloak and the like. */
export function oidc(
  options: IdentityProviderOptions & {
    id: string
    name: string
    issuer: string
    clientId: string
    clientSecret?: string
    scopes?: readonly string[]
    claims?: Partial<OidcClaims>
    /** Flows besides its sign-in, by name, each with an issuer of its own (story 191). */
    flows?: Readonly<Record<string, string>>
  },
): IdentityProvider {
  return preset(
    'oidc',
    { id: options.id, name: options.name },
    {
      issuer: options.issuer,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scopes: options.scopes,
      flows: options.flows,
    },
    { email: 'email', name: 'name', ...options.claims },
    options,
  )
}

const GUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

/** The user flows of a B2C tenant, by policy name. */
export interface B2cFlows {
  signIn: string
  signUp?: string
  resetPassword?: string
  editProfile?: string
  [name: string]: string | undefined
}

/**
 * Azure AD B2C, by its user flows (story 191). `tenant` is `contoso` or
 * `contoso.onmicrosoft.com`, or the tenant's id with a custom `domain`.
 * docs/operations.md, "Azure AD B2C".
 */
export function b2c(
  options: IdentityProviderOptions & {
    tenant: string
    /** A custom domain; `<tenant>.b2clogin.com` by default. */
    domain?: string
    clientId: string
    clientSecret?: string
    flows: B2cFlows
    scopes?: readonly string[]
    claims?: Partial<OidcClaims>
  },
): IdentityProvider {
  if (!options.tenant) throw new Error('The Azure AD B2C identity provider needs a tenant.')
  if (!options.flows?.signIn)
    throw new Error('The Azure AD B2C identity provider needs a signIn flow.')
  if (GUID.test(options.tenant) && !options.domain)
    throw new Error('The Azure AD B2C identity provider needs a domain when its tenant is an id.')
  const path =
    GUID.test(options.tenant) || options.tenant.includes('.')
      ? options.tenant
      : `${options.tenant}.onmicrosoft.com`
  const domain = options.domain ?? `${options.tenant.split('.')[0]}.b2clogin.com`
  const issuerOf = (policy: string) => `https://${domain}/${path}/${policy}/v2.0`
  const { signIn, ...others } = options.flows
  const provider = preset(
    'b2c',
    { id: 'b2c', name: 'Azure AD B2C' },
    {
      issuer: issuerOf(signIn),
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      scopes: options.scopes ?? ['openid'],
      flows: Object.fromEntries(
        Object.entries(others).flatMap(([name, policy]) =>
          policy ? [[name, issuerOf(policy)]] : [],
        ),
      ),
    },
    { email: 'emails', name: 'name', ...options.claims },
    { ...options, signOut: options.signOut ?? true },
  )
  return { ...provider, forgottenPassword: 'AADB2C90118' }
}

/** Refuses two providers with one id in a list, which would share one set of URLs. */
export function checkIdentityProviders(
  list: readonly IdentityProvider[],
  label: string,
): readonly IdentityProvider[] {
  const seen = new Set<string>()
  for (const provider of list) {
    if (seen.has(provider.oidc.id))
      throw new Error(`Two ${label} identity providers have the id "${provider.oidc.id}".`)
    seen.add(provider.oidc.id)
    if (label !== 'member' && (Object.keys(provider.properties).length > 0 || provider.signOut))
      throw new Error(
        `The ${label} identity provider "${provider.oidc.id}" sets properties or signOut, which are for members only.`,
      )
  }
  return list
}

/** The back-office providers that exchange: those the config opts in, and those the server names. */
export function exchangingProviders(
  providers: readonly IdentityProvider[],
  fromServer: readonly string[],
): IdentityProvider[] {
  return providers.flatMap((provider) => {
    if (provider.remoteExchange) return [provider]
    return fromServer.includes(provider.oidc.id) ? [{ ...provider, remoteExchange: {} }] : []
  })
}

/** Exchanging providers whose audience is a client id a sign-in uses, which the boot refuses. Pure. */
export function exchangeAudienceClashes(
  exchanging: readonly IdentityProvider[],
  backoffice: readonly IdentityProvider[],
): string[] {
  return exchanging.flatMap((provider) => {
    const { audience, applyAudience } = provider.remoteExchange ?? {}
    const clash = audience ? backoffice.find((p) => p.oidc.clientId === audience) : undefined
    const applyClash = applyAudience
      ? backoffice.find((p) => p.oidc.clientId === applyAudience)
      : undefined
    return [
      ...(clash
        ? [
            `The ${provider.oidc.name} identity provider's remoteExchange audience is the client id ${clash.oidc.name} signs in with. Name the audience of an app used only for the remote, so a sign-in token can never be exchanged.`,
          ]
        : []),
      ...(applyClash
        ? [
            `The ${provider.oidc.name} identity provider's remoteExchange applyAudience is the client id ${applyClash.oidc.name} signs in with. Name the audience of an app used only for applying changes.`,
          ]
        : []),
      ...(applyAudience !== undefined && applyAudience === audience
        ? [
            `The ${provider.oidc.name} identity provider's remoteExchange applyAudience is its audience. Name another, so a token for applying changes is told apart from any other.`,
          ]
        : []),
    ]
  })
}
