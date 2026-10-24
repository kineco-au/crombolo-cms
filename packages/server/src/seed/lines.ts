/**
 * Where a key sits in a seed file (story 163). `Bun.TOML` parses without
 * positions, so a finding's line is found by reading the file the way TOML is
 * laid out: a `[table]` header, then `key = value` lines under it. Good enough
 * for the shapes seeds use; anything it cannot place is line 1.
 */

const unquote = (part: string) =>
  part
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/^'(.*)'$/, '$1')

const splitDotted = (text: string): string[] => {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null
      current += char
    } else if (char === '"' || char === "'") {
      quote = char
      current += char
    } else if (char === '.') {
      parts.push(unquote(current))
      current = ''
    } else current += char
  }
  parts.push(unquote(current))
  return parts.filter((part) => part.length > 0)
}

/** The 1-based line of a dotted path (`['values', 'en-US', 'title']`) in a TOML text. */
export function lineOf(text: string, path: readonly string[]): number {
  if (path.length === 0) return 1
  const lines = text.split('\n')
  let table: string[] = []
  let best = 0
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim()
    if (line.startsWith('#') || line === '') continue
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line)
    if (header) {
      table = splitDotted(header[1] as string)
      if (table.length <= path.length && table.every((part, i) => part === path[i]))
        if (table.length === path.length) return index + 1
        else if (best === 0) best = index + 1
      continue
    }
    const assignment = /^((?:"[^"]*"|'[^']*'|[^=])+?)\s*=/.exec(line)
    if (!assignment) continue
    const full = [...table, ...splitDotted(assignment[1] as string)]
    if (full.length === path.length && full.every((part, i) => part === path[i])) return index + 1
    if (full.length < path.length && full.every((part, i) => part === path[i])) return index + 1
  }
  return best || 1
}
