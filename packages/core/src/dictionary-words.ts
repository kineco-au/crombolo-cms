/**
 * `{#key}`: a dictionary item named in a text, in a form or a page's value
 * (story 297). It reads as the item's words in the reader's language, then its
 * fallbacks, then as the item's name; a key that names no item shows as written.
 * `docs/forms.md`, "Words from the dictionary".
 */

const WORD = /\{#([^{}\s]+)\}/g
const ONLY_WORD = /^\{#([^{}\s]+)\}$/
/** The form texts story 293 wrote: a whole text of `#key`. Read for one release. */
const BARE_WORD = /^#(\S+)$/

/** The text with each `{#key}` as `word` gives it; a key it has nothing for stays as written. */
export function resolveDictionaryWords(
  text: string,
  word: (name: string) => string | undefined,
): string {
  if (!text.includes('{#')) return text
  return text.replace(WORD, (whole, name: string) => word(name) ?? whole)
}

/** The item a text names when the whole of it is one `{#key}`, else undefined. */
export function onlyDictionaryWord(text: string): string | undefined {
  return ONLY_WORD.exec(text.trim())?.[1]
}

/** Each item a text names with `{#key}`, in order, once each. */
export function dictionaryWordNames(text: string): string[] {
  if (!text.includes('{#')) return []
  return [...new Set([...text.matchAll(WORD)].map((match) => match[1] as string))]
}

/** The item a whole text of `#key` names, the way forms wrote it before `{#key}`. */
export function bareDictionaryWord(text: string): string | undefined {
  return BARE_WORD.exec(text)?.[1]
}

/** `{#key}` for an item's name. */
export const dictionaryWord = (name: string): string => `{#${name}}`

/** As `resolveDictionaryWords`, for markup: rich text holds `{#key}` among its tags, so the words are escaped. */
export function resolveDictionaryWordsInMarkup(
  markup: string,
  word: (name: string) => string | undefined,
): string {
  return resolveDictionaryWords(markup, (name) => {
    const found = word(name)
    return found === undefined ? undefined : escapeMarkup(found)
  })
}

const escapeMarkup = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  )
