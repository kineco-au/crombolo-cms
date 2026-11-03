/**
 * Stories 256 and 257: every `crombolo` command line in the product site's
 * docs names a command the CLI has, and only flags that command takes, so a
 * guide cannot drift from the command line it teaches.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { buildManifest } from '../packages/cli/src/manifest.ts'
import { DOCS_DIR } from '../scripts/docs-site.ts'

const GLOBAL_FLAGS = new Set(['output', 'json', 'help'])

/** Words as a shell splits them: quotes kept together, a trailing comment dropped. */
function words(line: string): string[] {
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

const guides = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[])
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(dir, name))

describe('the command lines in the docs', () => {
  test('each names a real command and only flags it takes', async () => {
    const manifest = await buildManifest()
    const commands = manifest.commands
    const problems: string[] = []
    let checked = 0
    for (const file of guides(DOCS_DIR)) {
      for (const parts of commandLines(readFileSync(file, 'utf8'))) {
        const where = `${relative(DOCS_DIR, file)}: crombolo ${parts.join(' ')}`
        let id = ''
        for (let n = parts.length; n > 0; n--) {
          const candidate = parts.slice(0, n).join(':')
          if (commands[candidate]) {
            id = candidate
            break
          }
        }
        if (!id) {
          problems.push(`${where}\n    no such command`)
          continue
        }
        checked += 1
        const flags = commands[id]?.flags ?? {}
        for (const word of parts) {
          if (!word.startsWith('--')) continue
          const name = word.slice(2).split('=')[0] as string
          const negated = name.startsWith('no-') ? name.slice(3) : undefined
          const known =
            name in flags ||
            GLOBAL_FLAGS.has(name) ||
            (negated !== undefined && (flags[negated] as { allowNo?: boolean })?.allowNo === true)
          if (!known) problems.push(`${where}\n    "${commands[id]?.id}" takes no --${name}`)
        }
      }
    }
    expect(problems).toEqual([])
    expect(checked).toBeGreaterThan(20)
  }, 60_000)

  test('reads continued lines, quotes and comments as a shell does', () => {
    expect(
      commandLines(
        '```sh\nbunx crombolo content new "/Home/Visit us" \\\n  --set title="Visit us"  # a page\n```\n',
      ),
    ).toEqual([['content', 'new', '/Home/Visit us', '--set', 'title=Visit us']])
    expect(commandLines('```sh\nbunx @crombolo/cli@latest init --name "My Site"\n```')).toEqual([
      ['init', '--name', 'My Site'],
    ])
  })
})
