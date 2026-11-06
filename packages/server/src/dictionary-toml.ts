/**
 * The dictionary as a TOML file a person can write (story 168). A table is an
 * item, named by its whole name; inside it, a string is a translation and a
 * table is a child, so nothing needs a reserved word.
 * docs/content-transfer.md, "The dictionary as a file".
 */
import type { DictionaryEntry } from './dictionary-transfer.ts'

export interface DictionaryFileProblem {
  /** The tables leading to it, for a seed finding's line. */
  path: string[]
  message: string
}

const isTable = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)

/** The items a file holds, and everything wrong with it. A file with problems is not applied. */
export function readDictionaryToml(text: string): {
  entries: DictionaryEntry[]
  problems: DictionaryFileProblem[]
} {
  let root: unknown
  try {
    root = Bun.TOML.parse(text)
  } catch (error) {
    const message = `not valid TOML: ${error instanceof Error ? error.message : String(error)}`
    return { entries: [], problems: [{ path: [], message }] }
  }
  const problems: DictionaryFileProblem[] = []
  const seen = new Set<string>()
  const item = (name: string, table: Record<string, unknown>, path: string[]): DictionaryEntry => {
    // Names are unique across the dictionary, not within a parent.
    if (seen.has(name)) problems.push({ path, message: `"${name}" appears twice` })
    seen.add(name)
    const entry: DictionaryEntry = { name, translations: [], children: [] }
    for (const [key, value] of Object.entries(table)) {
      if (typeof value === 'string') entry.translations.push({ isoCode: key, translation: value })
      else if (isTable(value)) entry.children.push(item(key, value, [...path, key]))
      else
        problems.push({
          path: [...path, key],
          message: `"${key}" under "${name}" is neither a translation nor a child item`,
        })
    }
    return entry
  }
  const entries: DictionaryEntry[] = []
  for (const [name, value] of Object.entries(root as Record<string, unknown>)) {
    if (isTable(value)) entries.push(item(name, value, [name]))
    else problems.push({ path: [name], message: `"${name}" belongs to no item: give it a table` })
  }
  return { entries, problems }
}

const keyOf = (name: string) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name))

/** The items as a file, sorted so a diff means something. Reads back as the same items. */
export function writeDictionaryToml(entries: readonly DictionaryEntry[]): string {
  const blocks: string[] = []
  const write = (entry: DictionaryEntry, parents: string[]) => {
    const path = [...parents, keyOf(entry.name)]
    const lines = [...entry.translations]
      .sort((a, b) => a.isoCode.localeCompare(b.isoCode))
      .map((t) => `${keyOf(t.isoCode)} = ${JSON.stringify(t.translation)}`)
    blocks.push([`[${path.join('.')}]`, ...lines].join('\n'))
    for (const child of [...entry.children].sort((a, b) => a.name.localeCompare(b.name)))
      write(child, path)
  }
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) write(entry, [])
  return `${blocks.join('\n\n')}\n`
}
