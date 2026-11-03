/**
 * Story 252: the CLI describes a site in its own terms. A problem names its
 * definition, the part of it and the command that changes it; a file that does
 * not read is named by its file and line, and the problems it causes elsewhere
 * are dropped; `-o json` keeps the file and line. Then the commands on a SQLite
 * site: a hand edit applied and changed by command, `site show`, `init`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadSchemaDirectory,
  locateProblems,
  syntaxErrorLine,
  validateSchemaSet,
} from '@crombolo/schema'
import { ERROR_KINDS, OUTCOMES } from '../packages/cli/src/errors.ts'
import { describeLocated, problemsOf } from '../packages/cli/src/support/describe.ts'
import { nextMinor } from '../packages/cli/src/support/types.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const PAGE = `[content-type]
alias = "contentPage"
name = "Content page"
allow-at-root = true

[[tab]]
name = "Content"

[[tab.property]]
alias = "title"
name = "Title"
type = "textstring"

[[tab.property]]
alias = "body"
name = "Body"
type = "richtext"
`

const write = (root: string, files: Record<string, string>) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), body)
  }
}

const problemsIn = (schemaDir: string) => {
  const loaded = loadSchemaDirectory(schemaDir)
  return [...loaded.problems, ...validateSchemaSet(loaded.set)]
}

describe('where a problem is', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(process.cwd(), 'output', 'site-terms-'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const schema = (name: string, files: Record<string, string>) => {
    const dir = join(root, name, 'schema')
    write(dir, { 'schema.toml': '[schema]\nversion = "1.0.0"\n', ...files })
    return dir
  }

  test('a key a property does not take: its type, its property, its line and the command', () => {
    const dir = schema('unknown-key', {
      'content-types/content-page.toml': PAGE.replace(
        'type = "richtext"',
        'type = "richtext"\nwidth = 3',
      ),
    })
    const [problem, ...rest] = locateProblems(problemsIn(dir), dir)
    expect(rest).toEqual([])
    expect(problem).toMatchObject({
      file: 'schema/content-types/content-page.toml',
      line: 18,
      definition: { kind: 'content type', alias: 'contentPage', name: 'Content page' },
      part: { kind: 'property', name: 'body' },
      key: 'width',
    })
    const text = describeLocated(problem as never)
    expect(text).toStartWith(
      'The content type "Content page", its property "body": width: unknown key',
    )
    expect(text).toEndWith('(`crombolo types property update contentPage body`)')
    expect(text).not.toContain('.toml')
  })

  test('a whole-set problem names the part by its alias, and finds its line', () => {
    const dir = schema('unknown-type', {
      'content-types/content-page.toml': PAGE.replace('type = "richtext"', 'type = "nothing"'),
    })
    const [problem] = locateProblems(problemsIn(dir), dir)
    expect(problem).toMatchObject({
      definition: { kind: 'content type', alias: 'contentPage' },
      part: { kind: 'property', name: 'body' },
      line: 17,
    })
    expect(problem?.message).toBe('unknown data type "nothing"')
  })

  test('a file that does not read: its file and line, and what it breaks elsewhere dropped', () => {
    const dir = schema('broken', {
      'content-types/content-page.toml': `${PAGE}\n[[tab.property]]\nalias = "subtitle"\nname = "Subtitle"\ntype = "shortText"\n`,
      'data-types/short-text.toml':
        '[data-type]\nalias = "shortText"\nname = "Short text"\neditor = "Umbraco.TextBox"\nchoices = [\n',
    })
    const raw = problemsIn(dir)
    expect(raw.some((p) => p.message === 'unknown data type "shortText"')).toBe(true)
    const located = locateProblems(raw, dir)
    expect(located).toHaveLength(1)
    expect(located[0]).toMatchObject({ file: 'schema/data-types/short-text.toml', line: 5 })
    expect(located[0]?.definition).toBeUndefined()
    expect(describeLocated(located[0] as never)).toStartWith(
      'schema/data-types/short-text.toml, line 5 does not read: ',
    )
  })

  test('a check that names a file by its alias still finds the definition', () => {
    const dir = schema('by-alias', {
      'workflows/sign-off.toml': '[workflow]\nalias = "signOff"\nname = "Sign off"\n',
    })
    const [out] = problemsOf(
      [{ file: 'schema/workflows/signOff.toml', path: '', message: 'is covered already' }],
      dir,
    )
    expect(out?.definition).toEqual({ kind: 'workflow', alias: 'signOff', name: 'Sign off' })
    expect(out?.file).toBe('schema/workflows/sign-off.toml')
    expect(out?.text).toBe(
      'The workflow "Sign off": is covered already (`crombolo workflows update signOff`)',
    )
  })

  test('the line of a syntax error is not thrown off by a list over several lines', () => {
    expect(syntaxErrorLine('a = [\n  1,\n  2,\n]\nb = \n')).toBe(5)
    expect(syntaxErrorLine('[x]\ny = "open\n')).toBe(2)
  })

  test('a definition checked before its file is written is named all the same', () => {
    const [out] = problemsOf(
      [{ file: 'schema/forms/contact', path: 'form.name', message: 'is required' }],
      join(root, 'nowhere'),
    )
    expect(out?.text).toBe('The form "contact": is required (`crombolo forms update contact`)')
    expect(out?.file).toBe('schema/forms/contact')
  })
})

describe('the commands, in the site’s own terms', () => {
  let site: string
  const env = () => ({
    ...process.env,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
    CROMBOLO_MEDIA_DIR: join(site, 'media'),
    CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
    CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
    CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
    CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
    CROMBOLO_LOG_TO_CONSOLE: 'false',
  })
  const cli = (...args: string[]) => {
    const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: site, env: env(), stdin: 'ignore' })
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() }
  }
  const ok = (...args: string[]) => {
    const run = cli(...args)
    expect(run.code, run.out).toBe(0)
    return run
  }
  const pageFile = () => join(site, 'schema/content-types/content-page.toml')

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'site-terms-cli-'))
    write(site, {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/content-page.toml': PAGE,
    })
    ok('types', 'sync')
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('a hand edit is applied like a command’s, and the commands then work on it', () => {
    writeFileSync(
      pageFile(),
      `${PAGE}\n[[tab.property]]\nalias = "summary"\nname = "Summary"\ntype = "textarea"\n`,
    )
    ok('types', 'sync')
    ok('types', 'property', 'update', 'contentPage', 'summary', '--name', 'Short summary')
    expect(readFileSync(pageFile(), 'utf8')).toContain('name = "Short summary"')
    const shown = JSON.parse(ok('types', 'show', 'contentPage', '-o', 'json').out)
    expect(JSON.stringify(shown)).toContain('Short summary')
  }, 30_000)

  test('a problem is said by its definition, and -o json keeps its file and line', () => {
    const before = readFileSync(pageFile(), 'utf8')
    writeFileSync(pageFile(), before.replace('type = "richtext"', 'type = "nothing"'))
    try {
      const text = cli('types', 'check')
      expect(text.code).toBe(OUTCOMES.problems_found.code)
      expect(text.out).toContain(
        'The content type "Content page", its property "body": unknown data type "nothing"',
      )
      expect(text.out).not.toContain('.toml')
      const json = JSON.parse(cli('types', 'check', '-o', 'json').out)
      expect(json.problems[0]).toMatchObject({
        file: 'schema/content-types/content-page.toml',
        line: 17,
        definition: { kind: 'content type', alias: 'contentPage' },
        part: { kind: 'property', name: 'body' },
      })
      // A refusal prints the same words, never an object
      const refused = cli('types', 'property', 'update', 'contentPage', 'title', '--name', 'T')
      expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
      expect(refused.out).toContain('its property "body": unknown data type "nothing"')
      expect(refused.out).not.toContain('[object Object]')
    } finally {
      writeFileSync(pageFile(), before)
    }
  }, 30_000)

  test('a file that does not read is named by its file and line', () => {
    const before = readFileSync(pageFile(), 'utf8')
    writeFileSync(pageFile(), `${before}oops =\n`)
    try {
      const run = cli('types', 'check')
      expect(run.out).toContain('schema/content-types/content-page.toml, line ')
      expect(run.out).toContain(' does not read: ')
    } finally {
      writeFileSync(pageFile(), before)
    }
  }, 30_000)

  test('what new definitions say: what was added, not the file written', () => {
    const made = ok('types', 'new', 'data-type', 'shortText', '--editor', 'textstring')
    expect(made.out).toContain('added    the data type "Short Text"')
    expect(made.out).not.toContain('.toml')
    const form = ok('forms', 'new', 'contact', '--name', 'Contact us')
    expect(form.out).toContain('added    the form "Contact us"')
    expect(form.out).not.toContain('schema/')
    expect(ok('languages', 'list').out).toContain('The site is in English (en-US) only.')
  }, 60_000)

  test('site show: what the site is, each line with the command that shows more', () => {
    const text = ok('site', 'show').out
    expect(text).toContain('English (en-US) only')
    expect(text).toContain('the top-level page is left out')
    expect(text).toContain('`crombolo types list`')
    expect(text).toContain('contact "Contact us"')
    expect(text).toContain('`crombolo status`')
    expect(text).not.toContain('.toml')
    const json = JSON.parse(ok('site', 'show', '-o', 'json').out)
    expect(json.types.content).toBe(1)
    expect(json.types.data).toBe(1)
    expect(json.forms).toEqual([{ alias: 'contact', name: 'Contact us' }])
    expect(json.urls).toEqual({ hideTopLevel: true })
    expect(ok('status').out).toContain('`crombolo site show`')
  }, 30_000)

  test('a bundle build raises the version once when the definitions changed under it', () => {
    const schemaFile = join(site, 'schema/schema.toml')
    expect(readFileSync(schemaFile, 'utf8')).toContain('version = "1.0.0"')
    const first = ok('bundle', 'build', '.', '--out', join(site, 'out-1'))
    expect(first.out).toContain('version  1.0.0 → 1.1.0')
    expect(readFileSync(schemaFile, 'utf8')).toContain('version = "1.1.0"')
    // Nothing changed since 1.1.0 was applied: no second step
    const again = ok('bundle', 'build', '.', '--out', join(site, 'out-2'))
    expect(again.out).not.toContain('version  ')
    expect(readFileSync(schemaFile, 'utf8')).toContain('version = "1.1.0"')
  }, 60_000)
})

describe('the version, raised when the site is shipped', () => {
  test('a minor step', () => {
    expect(nextMinor('1.0.0')).toBe('1.1.0')
    expect(nextMinor('1.4.7')).toBe('1.5.0')
    expect(nextMinor('2')).toBe('2.1')
  })
})

describe('crombolo init', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(process.cwd(), 'output', 'site-terms-init-'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const init = (dir: string, ...args: string[]) => {
    mkdirSync(join(root, dir))
    const proc = Bun.spawnSync(['bun', BIN, 'init', ...args], {
      cwd: join(root, dir),
      stdin: 'ignore',
    })
    expect(proc.exitCode, proc.stderr.toString()).toBe(0)
    return proc.stdout.toString()
  }

  test('says what it set up and leads with commands, naming schema/ once', () => {
    const out = init('plain', '--name', 'Riverside Bakery')
    expect(out).toContain('A site called "Riverside Bakery", on SQLite.')
    expect(out).toContain('crombolo types new content-type page')
    expect(out).toContain('crombolo content new /Home --type page')
    expect(out).not.toContain('created  ')
    expect(out.match(/schema\//g)).toHaveLength(1)
    expect(out).not.toContain('.toml')
  })

  test('--verbose lists the files', () => {
    const out = init('verbose', '--verbose')
    expect(out).toContain('created  schema/schema.toml')
    expect(out).toContain('A site called "My Site"')
  })
})
