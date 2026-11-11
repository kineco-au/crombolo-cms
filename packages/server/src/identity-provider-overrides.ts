/**
 * Settings an administrator changed for an identity provider the config
 * declares (story 033): kept in `key_value`, one row per provider and audience,
 * with the client secret sealed by `CROMBOLO_SECRET_KEY`. The config's preset is
 * the provider; these are only the fields changed, put on top of it at every
 * sign-in, so a change reaches every node with nothing to invalidate.
 */
import { type Db, type ExternalLoginAudience, now } from '@crombolo/data'
import {
  entraIssuer,
  type IdentityProvider,
  type LockedIdentityProviders,
  lockOf,
} from './identity-providers.ts'
import { type OutboundOptions, OutboundRefused, pinnedFetch } from './outbound-address.ts'
import { openSecret, SECRET_KEY_VARIABLE, sealSecret, usableSecretKey } from './secrets.ts'

/** The fields an override may change. */
export interface ProviderOverrides {
  name?: string
  tenantId?: string
  issuer?: string
  clientId?: string
  autoCreate?: boolean
  linkByEmail?: boolean
  emailsVerified?: boolean
  groupMap?: Record<string, string>
  defaultGroups?: string[]
}

/** What an administrator sends: the fields to change, and a client secret to set (`null` clears it). */
export interface ProviderOverrideInput extends ProviderOverrides {
  clientSecret?: string | null
}

/** The issuer and client id a kept secret was set for (story 305): it goes nowhere else. */
interface SecretFor {
  issuer: string
  clientId: string
}

interface Stored extends ProviderOverrides {
  clientSecretSealed?: string
  secretFor?: SecretFor
}

const OVERRIDABLE: readonly (keyof ProviderOverrides)[] = [
  'name',
  'tenantId',
  'issuer',
  'clientId',
  'autoCreate',
  'linkByEmail',
  'emailsVerified',
  'groupMap',
  'defaultGroups',
]

const keyOf = (audience: ExternalLoginAudience, id: string) =>
  `crombolo:identity-provider:${audience}:${id}`

/** Where a provider sends its sign-ins with these changes: its issuer and client id. Pure. */
function targetOf(code: IdentityProvider, overrides: ProviderOverrides): SecretFor {
  return {
    issuer:
      overrides.issuer ??
      (code.kind === 'entra' && overrides.tenantId
        ? entraIssuer(overrides.tenantId)
        : code.oidc.issuer),
    clientId: overrides.clientId ?? code.oidc.clientId,
  }
}

const sameTarget = (a: SecretFor, b: SecretFor) =>
  a.issuer === b.issuer && a.clientId === b.clientId

/**
 * The provider the config declares, with an administrator's changes on top.
 * A kept secret goes only to the issuer and client id it was set for, and the
 * config's only to the config's own (story 305); left with neither when the
 * config gave one, the provider is unavailable rather than signing in without.
 * A kept secret from before 305, with nothing to say where it was set for, is
 * taken as set for where the provider now sends. Pure.
 */
export function effectiveProvider(
  code: IdentityProvider,
  overrides: ProviderOverrides & { clientSecret?: string; secretFor?: SecretFor },
): IdentityProvider {
  const tenantId = overrides.tenantId ?? code.tenantId
  const target = targetOf(code, overrides)
  const kept =
    overrides.clientSecret && (!overrides.secretFor || sameTarget(overrides.secretFor, target))
      ? overrides.clientSecret
      : undefined
  const ownTarget = sameTarget(target, { issuer: code.oidc.issuer, clientId: code.oidc.clientId })
  const clientSecret = kept ?? (ownTarget ? code.oidc.clientSecret : undefined)
  const name = overrides.name ?? code.oidc.name
  return {
    ...code,
    ...(tenantId ? { tenantId } : {}),
    ...(code.oidc.clientSecret && !clientSecret
      ? {
          unavailable: `${name} sends to ${target.issuer}, which the config did not name, and has no client secret of its own for it: set one in its settings.`,
        }
      : {}),
    oidc: {
      ...code.oidc,
      name,
      issuer: target.issuer,
      clientId: target.clientId,
      clientSecret,
    },
    autoCreate: overrides.autoCreate ?? code.autoCreate,
    linkByEmail: overrides.linkByEmail ?? code.linkByEmail,
    emailsVerified: overrides.emailsVerified ?? code.emailsVerified,
    groupMap: overrides.groupMap ?? code.groupMap,
    defaultGroups: overrides.defaultGroups ?? code.defaultGroups,
  }
}

export class IdentityProviderOverrides {
  #db: Db
  #secretKey: string | undefined
  #locked: LockedIdentityProviders

  constructor(db: Db, secretKey: string | undefined, locked: LockedIdentityProviders = []) {
    this.#db = db
    this.#secretKey = usableSecretKey(secretKey)
    this.#locked = locked
  }

  /** Who locked a provider against changes here, if anyone (story 305). */
  lockOf(code: IdentityProvider): 'config' | 'environment' | undefined {
    return lockOf(code, this.#locked)
  }

  async #read(audience: ExternalLoginAudience, id: string): Promise<Stored> {
    const rows = await this.#db.q
      .selectFrom('key_value')
      .select('value')
      .where('key', '=', keyOf(audience, id))
      .execute()
    try {
      return rows[0]?.value ? (JSON.parse(rows[0].value) as Stored) : {}
    } catch {
      return {}
    }
  }

  /** The fields changed, with whether a client secret is kept here; never the secret itself. */
  async get(
    audience: ExternalLoginAudience,
    id: string,
  ): Promise<{ overrides: ProviderOverrides; hasClientSecret: boolean }> {
    const { clientSecretSealed, secretFor: _, ...overrides } = await this.#read(audience, id)
    return { overrides, hasClientSecret: Boolean(clientSecretSealed) }
  }

  /** A provider as a sign-in uses it: the config's, with the changes and a kept secret on top. */
  async apply(audience: ExternalLoginAudience, code: IdentityProvider): Promise<IdentityProvider> {
    // A locked provider is the config's, whatever was stored before it was locked.
    if (this.lockOf(code)) return code
    const { clientSecretSealed, secretFor, ...overrides } = await this.#read(audience, code.oidc.id)
    if (Object.keys(overrides).length === 0 && !clientSecretSealed) return code
    let clientSecret: string | undefined
    if (clientSecretSealed && this.#secretKey) {
      try {
        clientSecret = openSecret(clientSecretSealed, this.#secretKey)
      } catch {
        clientSecret = undefined
      }
    }
    return effectiveProvider(code, { ...overrides, clientSecret, secretFor })
  }

  /**
   * Changes some fields. An empty string or an empty value clears a field back
   * to the config's. A locked provider takes none (story 305), and a change of
   * where it signs in comes with a secret of its own, or goes back to the
   * config's issuer, whose secret then applies. Answers the fields changed.
   */
  async update(
    audience: ExternalLoginAudience,
    code: IdentityProvider,
    input: ProviderOverrideInput,
  ): Promise<{ ok: true; changed: string[] } | { ok: false; error: string }> {
    const lock = this.lockOf(code)
    if (lock)
      return {
        ok: false,
        error:
          lock === 'config'
            ? `${code.oidc.name} is locked by the site's configuration, so it cannot be changed here.`
            : `${code.oidc.name} is locked by the server's CROMBOLO_LOCKED_IDENTITY_PROVIDERS, so it cannot be changed here.`,
      }
    const id = code.oidc.id
    const stored = await this.#read(audience, id)
    const before = stored.secretFor ?? targetOf(code, stored)
    const changed: string[] = []
    for (const field of OVERRIDABLE) {
      if (!(field in input)) continue
      const value = input[field]
      if (JSON.stringify(value ?? '') !== JSON.stringify(stored[field] ?? '')) changed.push(field)
      if (value === undefined || value === null || value === '') delete stored[field]
      else (stored as Record<string, unknown>)[field] = value
    }
    const after = targetOf(code, stored)
    const own = sameTarget(after, { issuer: code.oidc.issuer, clientId: code.oidc.clientId })
    const newSecret = typeof input.clientSecret === 'string' && input.clientSecret !== ''
    if (!sameTarget(before, after) && !newSecret) {
      if (!own && (code.oidc.clientSecret || stored.clientSecretSealed))
        return {
          ok: false,
          error: `A new issuer needs its own secret: give ${code.oidc.name} the client secret for ${after.issuer} in the same save.`,
        }
      if (own && stored.clientSecretSealed) {
        delete stored.clientSecretSealed
        delete stored.secretFor
        changed.push('clientSecret')
      }
    }
    if (input.clientSecret === null || input.clientSecret === '') {
      if (stored.clientSecretSealed) changed.push('clientSecret')
      delete stored.clientSecretSealed
      delete stored.secretFor
    } else if (newSecret) {
      if (!this.#secretKey)
        return {
          ok: false,
          error: `Keeping a client secret here needs ${SECRET_KEY_VARIABLE} set on the server.`,
        }
      stored.clientSecretSealed = sealSecret(input.clientSecret as string, this.#secretKey)
      stored.secretFor = after
      changed.push('clientSecret')
    } else if (stored.clientSecretSealed && !stored.secretFor) stored.secretFor = after
    await this.#write(audience, id, stored)
    return { ok: true, changed: [...new Set(changed)] }
  }

  /** Puts a provider back to what the config says. */
  async reset(audience: ExternalLoginAudience, id: string): Promise<void> {
    await this.#db.q.deleteFrom('key_value').where('key', '=', keyOf(audience, id)).execute()
  }

  async #write(audience: ExternalLoginAudience, id: string, stored: Stored): Promise<void> {
    const key = keyOf(audience, id)
    if (Object.keys(stored).length === 0) {
      await this.#db.q.deleteFrom('key_value').where('key', '=', key).execute()
      return
    }
    const value = JSON.stringify(stored)
    const updated = await this.#db.q
      .updateTable('key_value')
      .set({ value, update_date: now(this.#db) })
      .where('key', '=', key)
      .returning('key')
      .execute()
    if (updated.length === 0)
      await this.#db.q
        .insertInto('key_value')
        .values({ key, value, update_date: now(this.#db) })
        .execute()
  }
}

/** A provider as a bundle sees it: its effective settings and which of them were changed. */
export interface BundleIdentityProvider {
  audience: ExternalLoginAudience
  id: string
  kind: IdentityProvider['kind']
  name: string
  tenantId: string | null
  issuer: string
  clientId: string
  /** Whether there is a client secret, from the config or kept here. Never the secret. */
  hasClientSecret: boolean
  autoCreate: boolean
  linkByEmail: boolean
  emailsVerified: boolean
  groupMap: Record<string, string>
  defaultGroups: string[]
  /** The fields an administrator changed, `clientSecret` among them when one is kept here. */
  overridden: string[]
  /** The path to register with the provider as the redirect URL, after the site's address. */
  callbackPath: string
  /** Who locked it against changes here (story 305), or null. */
  locked: 'config' | 'environment' | null
  /** Changes stored before it was locked, which it now ignores. */
  ignored: string[]
  /** It sends somewhere the config did not name with no secret of its own, so it signs nobody in. */
  missingSecret: boolean
}

/** The `identityProviders` bundle capability (story 033): edit, never declare. */
export interface BundleIdentityProviders {
  list(): Promise<BundleIdentityProvider[]>
  update(
    audience: ExternalLoginAudience,
    id: string,
    input: ProviderOverrideInput,
  ): Promise<{ ok: true } | { ok: false; error: string }>
  /** Back to the config, a locked provider included: how its ignored changes are cleared. */
  reset(audience: ExternalLoginAudience, id: string): Promise<boolean>
  /** Whether the provider's discovery document answers, with what it says if not. */
  test(audience: ExternalLoginAudience, id: string): Promise<{ ok: boolean; message: string }>
  /** The groups a mapping can name: user groups by alias, member groups by name. */
  groups(audience: ExternalLoginAudience): Promise<Array<{ value: string; name: string }>>
}

export function createBundleIdentityProviders(options: {
  overrides: IdentityProviderOverrides
  members: readonly IdentityProvider[]
  backoffice: readonly IdentityProvider[]
  memberCallbackPath: string
  backofficeCallbackPath: string
  groups(audience: ExternalLoginAudience): Promise<Array<{ value: string; name: string }>>
  /** Where the test may reach (story 304). */
  outbound?: OutboundOptions
  /** Records a change for the audit log (story 305): never a secret. */
  audit?: (
    action: 'identity provider changed' | 'identity provider reset',
    provider: { audience: ExternalLoginAudience; id: string; name: string },
    detail: string | null,
  ) => Promise<void>
}): BundleIdentityProviders {
  const declared = (audience: ExternalLoginAudience, id: string) =>
    (audience === 'member' ? options.members : options.backoffice).find((p) => p.oidc.id === id)

  const describe = async (
    audience: ExternalLoginAudience,
    code: IdentityProvider,
  ): Promise<BundleIdentityProvider> => {
    const effective = await options.overrides.apply(audience, code)
    const { overrides, hasClientSecret } = await options.overrides.get(audience, code.oidc.id)
    const stored = [...Object.keys(overrides), ...(hasClientSecret ? ['clientSecret'] : [])]
    const locked = options.overrides.lockOf(code) ?? null
    const base = audience === 'member' ? options.memberCallbackPath : options.backofficeCallbackPath
    return {
      audience,
      id: code.oidc.id,
      kind: code.kind,
      name: effective.oidc.name,
      tenantId: effective.tenantId ?? null,
      issuer: effective.oidc.issuer,
      clientId: effective.oidc.clientId,
      hasClientSecret: Boolean(effective.oidc.clientSecret),
      autoCreate: effective.autoCreate,
      linkByEmail: effective.linkByEmail,
      emailsVerified: effective.emailsVerified,
      groupMap: { ...effective.groupMap },
      defaultGroups: [...effective.defaultGroups],
      overridden: locked ? [] : stored,
      callbackPath: `${base}/${code.oidc.id}/callback`,
      locked,
      ignored: locked ? stored : [],
      missingSecret: Boolean(effective.unavailable),
    }
  }

  return {
    async list() {
      return Promise.all([
        ...options.members.map((p) => describe('member', p)),
        ...options.backoffice.map((p) => describe('user', p)),
      ])
    },
    async update(audience, id, input) {
      const code = declared(audience, id)
      if (!code) return { ok: false, error: 'The config declares no such identity provider.' }
      const outcome = await options.overrides.update(audience, code, input)
      if (!outcome.ok) return outcome
      if (outcome.changed.length > 0)
        await options.audit?.(
          'identity provider changed',
          { audience, id, name: code.oidc.name },
          outcome.changed
            .map((field) =>
              field === 'clientSecret'
                ? typeof input.clientSecret === 'string' && input.clientSecret !== ''
                  ? 'client secret set'
                  : 'client secret cleared'
                : field,
            )
            .join(', '),
        )
      return { ok: true }
    },
    async reset(audience, id) {
      const code = declared(audience, id)
      if (!code) return false
      await options.overrides.reset(audience, id)
      await options.audit?.('identity provider reset', { audience, id, name: code.oidc.name }, null)
      return true
    },
    groups: (audience) => options.groups(audience),
    async test(audience, id) {
      const code = declared(audience, id)
      if (!code) return { ok: false, message: 'The config declares no such identity provider.' }
      const effective = await options.overrides.apply(audience, code)
      const issuer = effective.oidc.issuer
      const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
      // Story 304: only whether it answered, never its status or what it said,
      // so the test cannot read back a page from wherever the issuer points.
      const notDiscovery = {
        ok: false,
        message: `${issuer} did not answer with an OpenID Connect discovery document.`,
      }
      let response: Response
      try {
        response = await pinnedFetch(
          url,
          { headers: { accept: 'application/json' } },
          options.outbound,
        )
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof OutboundRefused
              ? `${issuer} could not be reached: ${error.message}`
              : `${issuer} could not be reached.`,
        }
      }
      if (!response.ok) return notDiscovery
      try {
        const document = (await response.json()) as { authorization_endpoint?: unknown }
        return typeof document.authorization_endpoint === 'string'
          ? { ok: true, message: `${effective.oidc.name} answered at ${issuer}.` }
          : notDiscovery
      } catch {
        return notDiscovery
      }
    },
  }
}
