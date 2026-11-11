/**
 * Who may grant what (story 324): an administrator grants an extension what it
 * asks for, at any level; Acts as you and Unrestricted also need a package
 * someone has vouched for; a host may keep Unrestricted to the site's config.
 * One that asks for nothing needs no grant, so Settings access installs it.
 * One function, so the panel, the API, the command line and a remote all refuse
 * alike. docs/bundles.md, "Levels".
 */
import { type AccessLevel, isUpperLevel } from '@crombolo/backoffice-host/registry'
import type { ProvenanceResult } from './provenance.ts'

/** Where Unrestricted may be granted from: the back office, or only the site's config. */
export type UnrestrictedFrom = 'backoffice' | 'config'

/** What a host's `CROMBOLO_UNRESTRICTED_EXTENSIONS` says, `backoffice` unless it says `config`. */
export const unrestrictedFrom = (value: string | undefined): UnrestrictedFrom =>
  value?.trim().toLowerCase() === 'config' ? 'config' : 'backoffice'

/** A package someone has vouched for: signed, vouched for by the host, or built here. */
export const vouchedFor = (provenance: ProvenanceResult | undefined): boolean =>
  provenance?.state === 'signed' || provenance?.state === 'vouched' || provenance?.state === 'local'

export const ADMINISTRATOR_GRANTS = 'An administrator can turn this on.'
export const NOBODY_VOUCHED =
  "Nobody has vouched for who built this, so it can't be turned on here."
export const CONFIG_GRANTS =
  'This site turns on Unrestricted extensions only in its configuration, which your developers change.'

/** What the person may do about one level, as the panel shows it. */
export type MayGrant = 'yes' | 'administrator' | 'config'

/** What a person may grant at each level here. */
export function mayGrant(isAdmin: boolean, from: UnrestrictedFrom): Record<AccessLevel, MayGrant> {
  return {
    limited: isAdmin ? 'yes' : 'administrator',
    'acts-as-you': isAdmin ? 'yes' : 'administrator',
    unrestricted: from === 'config' ? 'config' : isAdmin ? 'yes' : 'administrator',
  }
}

/**
 * Why this person may not grant this level of this package here, or undefined
 * when they may. `grants` is whether it asks for anything at all. Pure.
 */
export function grantRefusal(options: {
  level: AccessLevel
  grants: boolean
  isAdmin: boolean
  provenance: ProvenanceResult | undefined
  from: UnrestrictedFrom
}): string | undefined {
  if (!options.grants) return undefined
  if (options.level === 'unrestricted' && options.from === 'config') return CONFIG_GRANTS
  if (!options.isAdmin) return ADMINISTRATOR_GRANTS
  if (isUpperLevel(options.level) && !vouchedFor(options.provenance)) return NOBODY_VOUCHED
  return undefined
}
