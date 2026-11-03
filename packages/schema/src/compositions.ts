/**
 * What a type takes from its compositions (story 255): each property with the
 * type that defines it, so `types show` can say where it comes from and the
 * check can refuse a property whose alias a composition already has.
 */
import { BUILT_IN_MEDIA_TYPES, SYSTEM_CONTENT_TYPES } from '@crombolo/data'
import { builtInContentTypeSchema, builtInMediaTypeSchema } from './builtin.ts'
import type { SchemaContentType, SchemaProperty, SchemaSet } from './model.ts'

export interface PlacedProperty {
  property: SchemaProperty
  tab: string | null
  group: string | null
}

export interface ComposedProperty extends PlacedProperty {
  /** The type that defines it. */
  from: string
  /** The composition it comes through, when that is not the type defining it. */
  via?: string
}

/** A type's own properties, each with its tab and group, in editor order. */
export function placedProperties(type: SchemaContentType): PlacedProperty[] {
  return [
    ...type.properties.map((property) => ({ property, tab: null, group: null })),
    ...(type.groups ?? []).flatMap((group) =>
      group.properties.map((property) => ({ property, tab: null, group: group.name })),
    ),
    ...type.tabs.flatMap((tab) => [
      ...tab.properties.map((property) => ({ property, tab: tab.name, group: null })),
      ...tab.groups.flatMap((group) =>
        group.properties.map((property) => ({ property, tab: tab.name, group: group.name })),
      ),
    ]),
  ]
}

/** The type a composition names: the site's own, or a built-in one such as `seoFields`. */
export function compositionType(set: SchemaSet, alias: string): SchemaContentType | undefined {
  const shipped = SYSTEM_CONTENT_TYPES.find((t) => t.alias === alias)
  const shippedMedia = BUILT_IN_MEDIA_TYPES.find((t) => t.alias === alias)
  return (
    set.contentTypes.find((t) => t.alias === alias) ??
    set.mediaTypes?.find((t) => t.alias === alias) ??
    (shipped ? builtInContentTypeSchema(shipped) : undefined) ??
    (shippedMedia ? builtInMediaTypeSchema(shippedMedia) : undefined)
  )
}

/** Every property a type takes from its compositions, each once, with where it comes from. */
export function composedProperties(set: SchemaSet, type: SchemaContentType): ComposedProperty[] {
  const out: ComposedProperty[] = []
  const seen = new Set<string>([type.alias])
  const walk = (alias: string, via: string | undefined) => {
    if (seen.has(alias)) return
    seen.add(alias)
    const composed = compositionType(set, alias)
    if (!composed) return
    for (const placed of placedProperties(composed))
      out.push({ ...placed, from: composed.alias, ...(via ? { via } : {}) })
    for (const next of composed.compositions) walk(next, via ?? alias)
  }
  for (const alias of type.compositions) walk(alias, undefined)
  return out
}

/** Every property a type carries, including those from its compositions. */
export function effectiveProperties(set: SchemaSet, type: SchemaContentType): SchemaProperty[] {
  return [
    ...placedProperties(type).map((p) => p.property),
    ...composedProperties(set, type).map((p) => p.property),
  ]
}
