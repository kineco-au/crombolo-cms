/**
 * Checks a content type's `[seo]` table (story 317): each `{alias}` it names is
 * a property of the type or its compositions, and `image` is a media picker's,
 * or a media item's key.
 */
import { seoTokens } from '@crombolo/core'
import { effectiveProperties } from './compositions.ts'
import { dataTypeOf } from './generate.ts'
import type { SchemaContentType, SchemaSet } from './model.ts'

const MEDIA_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The properties a type's values may name, its compositions' included, and which are media pickers. */
export function seoMappingProperties(
  set: SchemaSet,
  type: SchemaContentType,
): Array<{ alias: string; name: string; mediaPicker: boolean }> {
  return effectiveProperties(set, type).map((p) => ({
    alias: p.alias,
    name: p.name,
    mediaPicker: dataTypeOf(set, p.type).editor === 'Umbraco.MediaPicker3',
  }))
}

export function seoMappingProblems(
  set: SchemaSet,
  type: SchemaContentType,
): Array<{ path: string; message: string }> {
  const seo = type.seo
  if (!seo) return []
  const problems: Array<{ path: string; message: string }> = []
  const properties = new Map(effectiveProperties(set, type).map((p) => [p.alias, p]))
  for (const field of ['title', 'description', 'canonical'] as const) {
    const value = seo[field]
    if (!value) continue
    for (const token of seoTokens(value))
      if (token.kind === 'property' && !properties.has(token.alias))
        problems.push({
          path: `seo.${field}`,
          message: `"${type.alias}" has no property "${token.alias}"`,
        })
  }
  // A fixed image is a media item's key.
  if (seo.image && !MEDIA_KEY.test(seo.image)) {
    const property = properties.get(seo.image)
    if (!property)
      problems.push({
        path: 'seo.image',
        message: `"${type.alias}" has no property "${seo.image}"`,
      })
    else if (dataTypeOf(set, property.type).editor !== 'Umbraco.MediaPicker3')
      problems.push({
        path: 'seo.image',
        message: `"${seo.image}" is not a media picker, so it cannot be the sharing image`,
      })
  }
  return problems
}
