/**
 * `site().content`'s values (story 298): by alias, `{ title: 'Hello' }`, and by
 * culture for a property that varies, `{ title: { 'en-GB': 'Hello' } }`, to and
 * from the stored shape the document operations take. Pure.
 */
import type { DocumentAggregate, DocumentValue, FieldError } from '@crombolo/core'

/** What the conversion needs of a property: its alias, and whether it varies by culture. */
export interface ValueProperty {
  alias: string
  variesByCulture: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Site code's values as the operations store them, laid over what the page
 * already holds; or, when a value cannot be placed, the fields that say why.
 *
 * - A property that does not vary takes its value as it is.
 * - One that varies takes a culture-keyed object, or a plain value with `culture`.
 */
export function toDocumentValues(
  given: Readonly<Record<string, unknown>>,
  properties: readonly ValueProperty[],
  options: { culture?: string; existing?: readonly DocumentValue[] } = {},
): { values: DocumentValue[] } | { errors: FieldError[] } {
  const byAlias = new Map(properties.map((p) => [p.alias, p]))
  const errors: FieldError[] = []
  const set = new Map<string, DocumentValue>()
  const keyOf = (alias: string, culture: string | null) => `${alias}|${culture ?? ''}`
  for (const value of options.existing ?? []) {
    if (value.segment) continue
    set.set(keyOf(value.alias, value.culture), value)
  }
  for (const [alias, value] of Object.entries(given)) {
    const property = byAlias.get(alias)
    if (!property) {
      errors.push({ field: alias, message: `The content type has no property "${alias}".` })
      continue
    }
    if (!property.variesByCulture) {
      set.set(keyOf(alias, null), { alias, culture: null, segment: null, value })
      continue
    }
    if (
      isRecord(value) &&
      Object.keys(value).every((key) => /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(key))
    ) {
      for (const [culture, inCulture] of Object.entries(value))
        set.set(keyOf(alias, culture), { alias, culture, segment: null, value: inCulture })
      continue
    }
    if (!options.culture) {
      errors.push({
        field: alias,
        message: `"${alias}" varies by culture: give it by culture, { "en-GB": … }, or say which culture.`,
      })
      continue
    }
    set.set(keyOf(alias, options.culture), {
      alias,
      culture: options.culture,
      segment: null,
      value,
    })
  }
  return errors.length > 0 ? { errors } : { values: [...set.values()] }
}

/** A page's stored values by alias, by culture where its property varies. */
export function fromDocumentValues(
  values: readonly DocumentValue[],
  properties: readonly ValueProperty[],
): Record<string, unknown> {
  const varies = new Map(properties.map((p) => [p.alias, p.variesByCulture]))
  const out: Record<string, unknown> = {}
  for (const value of values) {
    if (value.segment) continue
    if (varies.get(value.alias) && value.culture) {
      const byCulture = (out[value.alias] ?? {}) as Record<string, unknown>
      byCulture[value.culture] = value.value
      out[value.alias] = byCulture
    } else if (!value.culture) out[value.alias] = value.value
  }
  return out
}

/** A page's name: one, or one per culture where its type varies. */
export function documentName(
  document: Pick<DocumentAggregate, 'variants'>,
): string | Record<string, string> {
  const named = document.variants.filter((v) => !v.segment)
  if (named.length === 1 && !named[0]?.culture) return named[0]?.name ?? ''
  return Object.fromEntries(named.map((v) => [v.culture ?? '', v.name]))
}
