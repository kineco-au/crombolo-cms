/**
 * What a user may do to a document (story 170): the verbs each write needs, where
 * it needs them, the languages it touches and the properties it changes. One
 * table: the Management API's router builds its own early checks from it, and the
 * operations apply it to every user actor, whatever started the write.
 */
import {
  DocumentPermissions as D,
  hasPathAccess,
  permissionsForPath,
  propertyValuePermissions,
  sectionKey,
} from '@crombolo/core'
import type { ContentPrincipal } from './actor.ts'

/** The verbs each document write needs, on the page it names (and, where stated, a target). */
export const WRITE_VERBS = {
  create: [D.Create],
  save: [D.Update],
  publish: [D.Publish],
  unpublish: [D.Unpublish],
  trash: [D.Delete],
  delete: [D.Delete],
  move: [D.Move],
  /** Where a moved or copied page lands. */
  intoTarget: [D.Create],
  copy: [D.Duplicate],
  sort: [D.Sort],
  rollback: [D.Rollback],
  domains: [D.CultureAndHostnames],
  publicAccess: [D.PublicAccess],
  /** The recycle bin: restoring moves a page out of it. */
  restore: [D.Move],
  emptyBin: [D.Delete],
} as const satisfies Record<string, readonly string[]>

export type WriteKind = keyof typeof WRITE_VERBS

/** Whether the user holds a section, named in either vocabulary. Pure. */
export const holdsSection = (principal: ContentPrincipal, section: string): boolean =>
  principal.allowedSections.some((alias) => sectionKey(alias) === sectionKey(section))

/**
 * Whether the user may act on a page at `chain` (its ancestors' keys, then its
 * own, root first), or on the root (`[]`) or the recycle bin. Pure.
 */
export function mayAt(
  principal: ContentPrincipal,
  verbs: readonly string[],
  place: readonly string[] | 'root' | 'bin',
  trashed = false,
): boolean {
  const start = principal.startNodes.document
  if (place === 'root' || place === 'bin') {
    if (!start.root) return false
    const granted = permissionsForPath(principal.groups, [])
    return verbs.every((verb) => granted.has(verb))
  }
  if (!hasPathAccess(start, place, trashed)) return false
  const granted = permissionsForPath(principal.groups, place)
  return verbs.every((verb) => granted.has(verb))
}

/** Whether the user may work in every culture named. Pure. */
export function mayUseCultures(principal: ContentPrincipal, cultures: readonly string[]): boolean {
  if (principal.hasAccessToAllLanguages) return true
  const allowed = new Set(principal.languages.map((l) => l.toLowerCase()))
  return cultures.every((c) => allowed.has(c.toLowerCase()))
}

/** One property value as a save carries it. */
export interface PropertyValueRef {
  alias: string
  culture: string | null
  segment: string | null
  value: unknown
}

/** JSON with object keys in order, so equal values compare equal however they were built. */
const canonical = (value: unknown): string =>
  JSON.stringify(value ?? null, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )

/** Each property's values by culture and segment, nulls left out: what a save would leave stored. */
function valuesByAlias(values: readonly PropertyValueRef[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const v of values) {
    if (v.value === null || v.value === undefined) continue
    const alias = v.alias.toLowerCase()
    const variants = out.get(alias) ?? new Map<string, string>()
    const where = `${v.culture?.toLowerCase() ?? ''}|${v.segment ?? ''}`
    if (!variants.has(where)) variants.set(where, canonical(v.value))
    out.set(alias, variants)
  }
  return out
}

/** Whether some group writes every property, so there is nothing to check per property. Pure. */
export const writesEveryProperty = (principal: ContentPrincipal): boolean =>
  principal.groups.some(
    (group) => !group.properties?.size && group.defaults.includes(D.PropertyValueWrite),
  )

/**
 * The first property a save would change that the user's groups may not write
 * (`Umb.Document.PropertyValue.Write`, per property type), or undefined. A value
 * sent back as it was is not a change; one left out that was stored is. Pure.
 */
export function deniedPropertyWrite<P extends { alias: string; key: string }>(
  principal: Pick<ContentPrincipal, 'groups'>,
  properties: readonly P[],
  before: readonly PropertyValueRef[],
  after: readonly PropertyValueRef[],
): P | undefined {
  const old = valuesByAlias(before)
  const next = valuesByAlias(after)
  for (const property of properties) {
    const alias = property.alias.toLowerCase()
    const a = old.get(alias) ?? new Map<string, string>()
    const b = next.get(alias) ?? new Map<string, string>()
    const changed = a.size !== b.size || [...a].some(([where, value]) => b.get(where) !== value)
    if (!changed) continue
    if (!propertyValuePermissions(principal.groups, property.key).has(D.PropertyValueWrite))
      return property
  }
  return undefined
}
