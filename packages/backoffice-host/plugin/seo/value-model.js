/**
 * What a search and sharing value's box suggests (story 317): typing `{` offers
 * the page type's properties, chosen as `{alias}`; `{#` is the dictionary's, which
 * `crombolo-form-word-input` offers. Pure, so it is tested on its own.
 */
const ROWS = 8
/** A property's alias being typed at the end of the text: after a `{` that is not `{{` or `{#`. */
const TYPING = /(?<!\{)\{(?!#)([^{}\s]*)$/

/** What has been typed of a property's alias at the end of the text, and where its `{` is. */
export function typedProperty(value) {
  const match = TYPING.exec(value ?? '')
  return match ? { typed: match[1] ?? '', start: match.index } : undefined
}

/** The properties to offer for what has been typed: aliases or names starting with it first. */
export function propertySuggestions(properties, value) {
  const at = typedProperty(value)
  if (!at) return []
  const typed = at.typed.toLowerCase()
  const starts = (p) =>
    p.alias.toLowerCase().startsWith(typed) || p.name.toLowerCase().startsWith(typed)
  const contains = (p) =>
    p.alias.toLowerCase().includes(typed) || p.name.toLowerCase().includes(typed)
  return [
    ...properties.filter(starts),
    ...properties.filter((p) => !starts(p) && contains(p)),
  ].slice(0, ROWS)
}

/** The text with the alias being typed at its end made `{alias}`. */
export function insertProperty(value, alias) {
  const at = typedProperty(value)
  const start = at ? at.start : (value ?? '').length
  return `${(value ?? '').slice(0, start)}{${alias}}`
}
