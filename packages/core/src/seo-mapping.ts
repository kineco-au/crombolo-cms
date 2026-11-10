/**
 * A search and sharing value as a type or a page sets it (story 317): fixed text,
 * `{alias}` for a property of the page, `{#key}` for a dictionary item, or a mix.
 * `{{` and `}}` write a brace. `docs/seo.md`, "Where a type's values come from".
 */

const TOKEN = /\{\{|\}\}|\{(#?)([^{}\s]+)\}/g

export type SeoToken = { kind: 'property'; alias: string } | { kind: 'word'; key: string }

/** The properties and dictionary items a value names, in order. */
export function seoTokens(text: string): SeoToken[] {
  const tokens: SeoToken[] = []
  for (const match of text.matchAll(TOKEN)) {
    const name = match[2]
    if (!name) continue
    tokens.push(match[1] ? { kind: 'word', key: name } : { kind: 'property', alias: name })
  }
  return tokens
}

/**
 * The value with its tokens read; undefined when it is empty, or when it names
 * something and everything it names reads empty, so the next source answers.
 */
export function expandSeoValue(
  text: string | undefined,
  read: { property(alias: string): string; word(key: string): string | undefined },
): string | undefined {
  if (!text?.trim()) return undefined
  let named = 0
  let filled = 0
  const out = text.replace(TOKEN, (whole, hash: string, name: string | undefined) => {
    if (whole === '{{') return '{'
    if (whole === '}}') return '}'
    named++
    const value = (hash ? read.word(name as string) : read.property(name as string))?.trim() ?? ''
    if (value) filled++
    return value
  })
  if (named > 0 && filled === 0) return undefined
  const trimmed = out.replace(/\s+/g, ' ').trim()
  return trimmed || undefined
}
