/**
 * What `{#name}` reads as in a culture, for what the search index holds (story
 * 297): the dictionary item's words, then its language's fallbacks', then the
 * default language's, then its name. The published cache does the same for pages.
 */
import { resolveDictionaryWords } from '@crombolo/core'
import type { Db } from './database.ts'
import { fromDbBool } from './dialect.ts'

/** Each culture's reader of a text's `{#name}`s. */
export type DictionaryWords = (culture: string | null) => (text: string) => string

const AS_WRITTEN: DictionaryWords = () => (text) => text

/** Read once, so an item indexed in many cultures asks the database once. */
export async function dictionaryWords(db: Db): Promise<DictionaryWords> {
  const rows = await db.q
    .selectFrom('dictionary_item as d')
    .leftJoin('dictionary_text as t', 't.dictionary_key', 'd.key')
    .leftJoin('language as l', 'l.id', 't.language_id')
    .select(['d.item_key', 'l.iso_code', 't.value'])
    .execute()
  if (rows.length === 0) return AS_WRITTEN
  const items = new Map<string, { name: string; words: Map<string, string> }>()
  for (const row of rows) {
    const name = String(row.item_key)
    const item = items.get(name.toLowerCase()) ?? { name, words: new Map() }
    if (row.iso_code && row.value)
      item.words.set(String(row.iso_code).toLowerCase(), String(row.value))
    items.set(name.toLowerCase(), item)
  }
  const languages = await db.q
    .selectFrom('language as l')
    .leftJoin('language as f', 'f.id', 'l.fallback_language_id')
    .select(['l.iso_code', 'l.is_default', 'f.iso_code as fallback'])
    .execute()
  const fallbackOf = new Map(
    languages.map((l) => [
      String(l.iso_code).toLowerCase(),
      l.fallback ? String(l.fallback) : null,
    ]),
  )
  const defaultCulture = languages.find((l) => fromDbBool(l.is_default))?.iso_code
  const chain = (culture: string | null): string[] => {
    const out: string[] = []
    let next = (culture ?? (defaultCulture ? String(defaultCulture) : null))?.toLowerCase()
    while (next && !out.includes(next)) {
      out.push(next)
      next = fallbackOf.get(next)?.toLowerCase()
    }
    if (defaultCulture) out.push(String(defaultCulture).toLowerCase())
    return out
  }
  return (culture) => {
    const order = chain(culture)
    const word = (name: string) => {
      const item = items.get(name.toLowerCase())
      if (!item) return undefined
      for (const c of order) {
        const text = item.words.get(c)
        if (text) return text
      }
      return item.name
    }
    return (text) => resolveDictionaryWords(text, word)
  }
}
