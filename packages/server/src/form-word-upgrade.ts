/**
 * Forms wrote a dictionary item as a whole text of `#key` (story 293); they write
 * `{#key}` now (story 297). On a site whose schema it may write, the server
 * rewrites each such text that names an item, in place, so a file keeps its
 * layout and comments. A `#` naming no item is only text, and is left alone.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Db, DictionaryRepository } from '@crombolo/data'

/** The keys a form file holds words under: a choice's value is compared, never read. */
const WORD_KEYS = [
  'caption',
  'help-text',
  'placeholder',
  'content',
  'mandatory-message',
  'pattern-message',
  'submit-label',
  'next-label',
  'previous-label',
  'message-on-submit',
]

/** `key = "#name"`, the whole string `#name`, in either kind of quotes. */
const BARE = new RegExp(
  `^(\\s*(?:${WORD_KEYS.join('|')})\\s*=\\s*)(["'])#([^\\s"'{}]+)\\2(\\s*(?:#.*)?)$`,
  'gm',
)

/** The file's text with each word written `"#key"` that names an item as `"{#key}"`. Pure. */
export function braceFormWords(text: string, isItem: (name: string) => boolean): string {
  return text.replace(BARE, (whole, start: string, quote: string, name: string, end: string) =>
    isItem(name) ? `${start}${quote}{#${name}}${quote}${end}` : whole,
  )
}

function tomlFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  return entries.flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return tomlFiles(path)
    return name.endsWith('.toml') ? [path] : []
  })
}

/** Rewrites the forms under `schemaDir`; the files it changed. */
export async function upgradeFormWords(db: Db, schemaDir: string): Promise<string[]> {
  const files = tomlFiles(join(schemaDir, 'forms'))
  if (files.length === 0) return []
  const names = new Set(
    (await new DictionaryRepository(db).outline()).map((item) => item.name.toLowerCase()),
  )
  if (names.size === 0) return []
  const changed: string[] = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const next = braceFormWords(text, (name) => names.has(name.toLowerCase()))
    if (next === text) continue
    writeFileSync(file, next)
    changed.push(file)
  }
  return changed
}
