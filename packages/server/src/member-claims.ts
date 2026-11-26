/**
 * Member properties that follow a provider's claims (story 191): written when a
 * member is created and at every sign-in after. docs/operations.md.
 */
import { claimValue, type OidcIdentity } from '@crombolo/auth'
import { type DocumentValue, dateFromText } from '@crombolo/core'
import {
  type ContentTypeRepository,
  DataTypeRepository,
  type Db,
  type MemberRepository,
} from '@crombolo/data'
import type { IdentityProvider } from './identity-providers.ts'

/** A claim as a property of this storage keeps it; undefined for one it cannot hold. Pure. */
export function claimAsStored(claim: unknown, storage: string): unknown {
  if (typeof claim !== 'string' && typeof claim !== 'number' && typeof claim !== 'boolean')
    return undefined
  const text = String(claim)
  switch (storage) {
    case 'Integer': {
      if (/^(true|false)$/i.test(text)) return text.toLowerCase() === 'true' ? 1 : 0
      return /^[+-]?\d+$/.test(text) ? Number(text) : undefined
    }
    case 'Decimal':
      return text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined
    case 'Date':
      return dateFromText(text) ? text : undefined
    default:
      return text
  }
}

const same = (a: unknown, b: unknown, storage: string): boolean => {
  const plain = (value: unknown) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (storage === 'Decimal') return String(Number(value))
    if (storage === 'Date') return String(dateFromText(String(value))?.getTime())
    return String(value)
  }
  return plain(a) === plain(b)
}

export class MemberClaims {
  #members: MemberRepository
  #types: ContentTypeRepository
  #dataTypes: DataTypeRepository
  #log: ((message: string) => void) | undefined

  constructor(
    db: Db,
    members: MemberRepository,
    types: ContentTypeRepository,
    log?: (message: string) => void,
  ) {
    this.#members = members
    this.#types = types
    this.#dataTypes = new DataTypeRepository(db)
    this.#log = log
  }

  async #wanted(typeKey: string, provider: IdentityProvider, identity: OidcIdentity) {
    const mapped = Object.entries(provider.properties)
    if (mapped.length === 0) return []
    const byAlias = new Map((await this.#types.resolveProperties(typeKey)).map((p) => [p.alias, p]))
    const out: Array<{ alias: string; value: unknown; storage: string }> = []
    for (const [alias, claim] of mapped) {
      const given = claimValue(identity.claims, claim)
      const property = byAlias.get(alias)
      // A claim the token leaves out leaves its property as it is.
      if (given === undefined || given === null || !property) continue
      const storage = (await this.#dataTypes.byKey(property.dataTypeKey))?.dbType ?? 'Ntext'
      const value = claimAsStored(given, storage)
      if (value === undefined)
        this.#log?.(`${provider.oidc.name}: the claim ${claim} does not fit the property ${alias}.`)
      else out.push({ alias, value, storage })
    }
    return out
  }

  /** A new member's values. */
  async valuesFor(
    typeKey: string,
    provider: IdentityProvider,
    identity: OidcIdentity,
  ): Promise<DocumentValue[]> {
    return (await this.#wanted(typeKey, provider, identity)).map(({ alias, value }) => ({
      alias,
      culture: null,
      segment: null,
      value,
    }))
  }

  /** Brings a member to what the claims say, saving only when something changed. */
  async sync(key: string, provider: IdentityProvider, identity: OidcIdentity): Promise<void> {
    const member = await this.#members.byKey(key)
    const stored = member ? await this.#members.content.byKey(key) : undefined
    if (!member || !stored) return
    const shared = (value: DocumentValue, alias: string) =>
      value.alias === alias && !value.culture && !value.segment && !value.environment
    const changed = (await this.#wanted(member.contentTypeKey, provider, identity)).filter(
      ({ alias, value, storage }) =>
        !same(stored.values.find((v) => shared(v, alias))?.value, value, storage),
    )
    if (changed.length === 0) return
    const kept = stored.values.filter((v) => !changed.some(({ alias }) => shared(v, alias)))
    try {
      await this.#members.update(
        key,
        {
          key,
          contentTypeKey: member.contentTypeKey,
          componentKey: null,
          parentKey: null,
          values: [
            ...kept,
            ...changed.map(({ alias, value }) => ({ alias, culture: null, segment: null, value })),
          ],
          variants: [{ culture: null, segment: null, name: member.name }],
          expectedRevision: stored.revision,
        },
        {
          email: member.email,
          username: member.username,
          isApproved: member.isApproved,
          isLockedOut: member.isLockedOut,
        },
      )
    } catch (error) {
      // Someone saved the member meanwhile, or this node is behind the database:
      // the sign-in stands, and the next one writes them.
      this.#log?.(
        `${provider.oidc.name}: a member's properties were not updated: ${(error as Error).message}`,
      )
    }
  }
}

/** Mapped properties their member type lacks, which the boot refuses. */
export async function unknownClaimProperties(
  types: ContentTypeRepository,
  providers: readonly IdentityProvider[],
  registrationType: string,
): Promise<string[]> {
  const problems: string[] = []
  for (const provider of providers) {
    const mapped = Object.entries(provider.properties)
    if (mapped.length === 0) continue
    const alias = provider.memberType ?? registrationType
    const type = await types.byAlias(alias)
    const known = new Set(type ? (await types.resolveProperties(type.key)).map((p) => p.alias) : [])
    for (const [property, claim] of mapped)
      if (!known.has(property))
        problems.push(
          `The identity provider "${provider.oidc.id}" maps the claim "${claim}" to "${property}", which the member type "${alias}" does not have.`,
        )
  }
  return problems
}
