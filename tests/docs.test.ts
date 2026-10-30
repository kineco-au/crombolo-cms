/**
 * The README is a summary plus getting started; everything else lives in `docs/`.
 * That arrangement only works while the index is true, and an index is exactly the
 * thing nobody notices has gone stale — so it is checked rather than maintained by
 * good intentions.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findTemplate, scaffoldFiles } from '../packages/cli/src/templates.ts'
import { listSites } from '../scripts/sites.ts'

const ROOT = join(import.meta.dir, '..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** Generated rather than written, so it is reference material and not part of the index. */
const GENERATED = new Set(['api-coverage.md'])

const docs = readdirSync(join(ROOT, 'docs'))
  .filter((file) => file.endsWith('.md'))
  .sort()

/** An anchor as GitHub derives it from a heading. */
const slug = (heading: string) =>
  heading
    .replace(/^#+\s*/, '')
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .replace(/ /g, '-')

describe('the README', () => {
  test('links every design document, so none is orphaned', () => {
    const missing = docs
      .filter((file) => !GENERATED.has(file))
      .filter((file) => !readme.includes(`docs/${file}`))
    expect(missing).toEqual([])
  })

  test('links nothing that is not there', () => {
    const linked = [...readme.matchAll(/\]\((docs\/[\w.-]+\.md)[^)]*\)/g)].map(
      (m) => m[1] as string,
    )
    expect(linked.length).toBeGreaterThan(10)
    const dangling = [...new Set(linked)].filter((path) => !existsSync(join(ROOT, path)))
    expect(dangling).toEqual([])
  })

  test('has no dead internal anchor', () => {
    // The split moved most sections out; a `(#...)` left pointing at one of them
    // reads as a working link and goes nowhere.
    const anchors = [...readme.matchAll(/\]\(#([\w-]+)\)/g)].map((m) => m[1] as string)
    const headings = new Set((readme.match(/^#{1,6} .*$/gm) ?? []).map((heading) => slug(heading)))
    expect([...new Set(anchors)].filter((anchor) => !headings.has(anchor))).toEqual([])
  })

  test('stays a summary rather than becoming the manual again', () => {
    // It was 1,538 lines before the detail moved into `docs/`. The number is a
    // smell test, not a budget: well past this and the split has quietly undone
    // itself.
    expect(readme.split('\n').length).toBeLessThan(600)
  })

  test('still tells a newcomer how to run it, both ways', () => {
    for (const command of ['bun run start:local', 'bun run docker:up', 'bun run db:up'])
      expect(readme).toContain(command)
  })
})

/** The README from one `## ` heading to the next. */
function section(heading: string): string {
  const start = readme.indexOf(`\n${heading}\n`)
  if (start === -1) throw new Error(`the README has no "${heading}"`)
  const end = readme.indexOf('\n## ', start + heading.length + 1)
  return readme.slice(start, end === -1 ? undefined : end)
}

/** Each step in a section's shell blocks: one per line and per `&&`, comments dropped. */
const stepsIn = (text: string): string[] =>
  [...text.matchAll(/```bash\n([\s\S]*?)```/g)]
    .flatMap((block) => (block[1] as string).split('\n'))
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .flatMap((line) => line.split('&&').map((step) => step.trim()))
    .filter((step) => step !== '')

const scriptsOf = (json: string): string[] =>
  Object.keys((JSON.parse(json) as { scripts?: Record<string, string> }).scripts ?? {})

describe('the README’s commands', () => {
  // A step that fails where the README says to run it is the first thing a
  // newcomer meets. `bun run site …`, a script of this repository's, once sat
  // among the steps for a new site, which has no such script.
  test('every step for a new site is one a new site can run', () => {
    const packageJson = (options: Parameters<typeof scaffoldFiles>[0]) =>
      scaffoldFiles(options).find((file) => file.path === 'package.json')?.text ?? '{}'
    const basic = findTemplate('basic')
    const scripts = new Set([
      ...scriptsOf(packageJson({})),
      ...(basic ? scriptsOf(packageJson({ template: basic })) : []),
    ])
    const commands = new Set(
      readdirSync(join(ROOT, 'packages/cli/src/commands')).map((name) => name.replace(/\.ts$/, '')),
    )
    const templates = new Set(['list', ...listSites().map((site) => site.id), 'basic', 'next'])
    const unrunnable: string[] = []
    const steps = stepsIn(section('## Getting started'))
    expect(steps.length).toBeGreaterThan(5)
    for (const step of steps) {
      if (/^(mkdir|cd|curl) /.test(step) || step === 'bun install') continue
      const script = /^bun (?:run )?(\S+)$/.exec(step)?.[1]
      if (script) {
        if (!scripts.has(script)) unrunnable.push(`${step}: a new site has no "${script}" script`)
        continue
      }
      const cli = /^bunx @crombolo\/cli (\S+)(.*)$/.exec(step)
      if (cli) {
        if (!commands.has(cli[1] as string)) unrunnable.push(`${step}: no such command`)
        const template = /--template (\S+)/.exec(cli[2] as string)?.[1]
        if (template && !templates.has(template)) unrunnable.push(`${step}: no such template`)
        continue
      }
      unrunnable.push(`${step}: not a step this test knows how to check`)
    }
    expect(unrunnable).toEqual([])
  })

  test('every command for crombolo development is a script of this repository', () => {
    const scripts = new Set(scriptsOf(readFileSync(join(ROOT, 'package.json'), 'utf8')))
    const missing = stepsIn(section('## Crombolo development'))
      .map((step) => /^bun run (\S+)/.exec(step)?.[1])
      .filter((script): script is string => script !== undefined && !scripts.has(script))
    expect(missing).toEqual([])
  })
})

describe('every design document', () => {
  for (const file of docs) {
    test(`${file} links nothing in docs/ that is missing`, () => {
      const text = readFileSync(join(ROOT, 'docs', file), 'utf8')
      const linked = [...text.matchAll(/\]\(([\w.-]+\.md)[^)]*\)/g)].map((m) => m[1] as string)
      const dangling = [...new Set(linked)].filter(
        (path) => !existsSync(join(ROOT, 'docs', path)) && !existsSync(join(ROOT, path)),
      )
      expect(dangling).toEqual([])
    })
  }
})
