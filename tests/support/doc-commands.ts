/** The command lines a docs page's shell blocks hold, as a shell would split them. */

/** Words as a shell splits them: quotes kept together, a trailing comment dropped. */
export function words(line: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const char of line) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (char === '#' && !started && current === '') break
    else if (/\s/.test(char)) {
      if (started) out.push(current)
      current = ''
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) out.push(current)
  return out
}

/** Each `crombolo …` command in a guide's shell blocks, continuation lines joined. */
export function commandLines(markdown: string): string[][] {
  const out: string[][] = []
  for (const block of markdown.matchAll(/```(?:sh|bash|shell)\n([\s\S]*?)```/g)) {
    const joined = (block[1] as string).replaceAll(/\\\n\s*/g, ' ')
    for (const line of joined.split('\n')) {
      const parts = words(line)
      const at = parts.findIndex((w) => w === 'crombolo' || /^@crombolo\/cli(@.*)?$/.test(w))
      if (at >= 0 && (at === 0 || parts[at - 1] === 'bunx')) out.push(parts.slice(at + 1))
    }
  }
  return out
}
