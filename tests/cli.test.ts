/**
 * The CLI as a script drives it (story 150): arguments parsed per command, help
 * that runs nothing, exit codes from one table, a JSON envelope on failure, and
 * `crombolo schema` valid against clispec v0.3.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Writable } from 'node:stream'
import Ajv2020 from 'ajv/dist/2020'
import { ERROR_KINDS, OUTCOMES } from '../packages/cli/src/errors.ts'
import { drained } from '../packages/cli/src/main.ts'
import { buildManifest } from '../packages/cli/src/manifest.ts'
import { ROOT, sharedVersion } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crombolo-cli-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function run(args: string[], stdin?: string, env: Record<string, string> = {}) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], {
    cwd: dir,
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    env: { ...process.env, NO_COLOR: '1', ...env },
  })
  const err = proc.stderr.toString()
  return {
    code: proc.exitCode,
    out: proc.stdout.toString(),
    err,
    /** The JSON envelope: the last line of stderr. */
    envelope: () =>
      (JSON.parse(err.trim().split('\n').at(-1) ?? '{}') as { error?: Record<string, unknown> })
        .error ?? {},
  }
}

describe('arguments', () => {
  test('--help prints that command’s help and runs nothing', () => {
    const result = run(['upgrade', '--help'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('--plan')
    expect(result.out).not.toContain('maintenance')
  })

  test('the root help lists the commands, schema among them', () => {
    const result = run(['--help'])
    expect(result.code).toBe(0)
    expect(result.out).toContain('schema')
    expect(result.out).toContain('types')
  })

  test('--version prints the version', () => {
    expect(run(['--version']).out).toContain(sharedVersion())
  })

  test('an unknown flag is a usage error, exit 2, before anything runs', () => {
    const result = run(['import', 'site.tgz', '--dyr-run'])
    expect(result.code).toBe(2)
    expect(result.err).toContain('--dyr-run')
  })

  test('an unknown command exits 2', () => {
    expect(run(['nonsense']).code).toBe(2)
  })

  test("a flag's value is never an argument", () => {
    // `prod` belongs to --env; the URL is still the second argument, and the
    // failure is about reaching it.
    const result = run([
      'remote',
      'add',
      '--env',
      'prod',
      'origin',
      'http://127.0.0.1:9',
      '-o',
      'json',
    ])
    expect(result.code).toBe(ERROR_KINDS.unavailable.exitCode)
    expect(result.envelope()).toMatchObject({ kind: 'unavailable' })
    expect(String(result.envelope().message)).toContain('127.0.0.1:9')
  })
})

describe('failures and outcomes', () => {
  test('in JSON mode a failure ends stderr with one envelope line, and stdout is empty', () => {
    const result = run(['content', 'import', '-o', 'json'])
    expect(result.code).toBe(2)
    expect(result.out).toBe('')
    expect(result.envelope()).toMatchObject({ kind: 'usage' })
  })

  test('in text mode a failure says what to do, and a pipe still ends with the envelope', () => {
    const result = run(['content', 'import'])
    expect(result.code).toBe(2)
    expect(result.err).toContain('bundle')
    expect(result.err).toContain('--help')
    expect(result.envelope()).toMatchObject({ kind: 'usage', exit_code: 2 })
  })

  test('an unknown command fails the same way, before any command runs', () => {
    const result = run(['__nonexistent_command__'])
    expect(result.code).toBe(2)
    expect(result.envelope()).toMatchObject({ kind: 'usage' })
  })

  test('a different URL for a remote already named is a conflict, decided before any network', () => {
    writeFileSync(join(dir, 'remotes.toml'), '[remotes.origin]\nurl = "https://one.example"\n')
    const result = run(['remote', 'add', 'origin', 'https://two.example', '--json'])
    expect(result.code).toBe(ERROR_KINDS.conflict.exitCode)
    expect(result.envelope()).toMatchObject({ kind: 'conflict' })
    expect(readFileSync(join(dir, 'remotes.toml'), 'utf8')).toContain('one.example')
  })

  test('removing a remote that is not there changes nothing, and says so', () => {
    const result = run(['remote', 'remove', 'nowhere', '-o', 'json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.out)).toEqual({ name: 'nowhere', changed: false })
  })

  test('a list is an items envelope', () => {
    const result = run(['remote', 'list', '-o', 'json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.out)).toEqual({ items: [] })
  })

  test('a renamed command still runs under its old name, and says it is deprecated', () => {
    const result = run(['schema', 'check'])
    expect(result.err).toContain('types check')
    expect(result.code).toBe(ERROR_KINDS.not_found.exitCode)
  })

  test('content export still runs under its old name, and points at bundle export', () => {
    const result = run(['content', 'export'])
    // oclif wraps the warning, so its words are matched across the break.
    expect(result.err.replace(/\s*›?\s+/g, ' ')).toContain('Use "bundle export" instead')
    expect(result.code).toBe(ERROR_KINDS.usage.exitCode)
  })

  test('a check that finds problems exits with its outcome, its findings on stdout and no envelope', () => {
    // An empty folder has no database yet: status reports it as a problem.
    const result = run(['status', '-o', 'json'])
    const report = JSON.parse(result.out) as { problems: string[] }
    if (report.problems.length > 0) {
      expect(result.code).toBe(OUTCOMES.problems_found.code)
      expect(result.err).not.toContain('"kind"')
    } else expect(result.code).toBe(0)
  }, 30_000)

  test('a confirmation with no terminal refuses at once, naming the flag that answers it', () => {
    const result = run(['bundle', 'purge', 'demo', '-o', 'json'], '')
    expect(result.code).toBe(ERROR_KINDS.confirmation_required.exitCode)
    expect(result.envelope()).toMatchObject({ kind: 'confirmation_required' })
    expect(String(result.envelope().hint)).toContain('--yes')
  })

  test('--dry-run on a purge says what it would drop and drops nothing', () => {
    const result = run(['bundle', 'purge', 'demo', '--dry-run', '-o', 'json'])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.out)).toMatchObject({ id: 'demo', dropped: [], changed: false })
  })
})

describe('output on a slow pipe', () => {
  test('the CLI waits for what it wrote to drain before it ends', async () => {
    // A pipe that takes its time, as a busy CI runner's reader does: written
    // output queues, and a process ending now would lose what is queued.
    const taken: string[] = []
    const slow = new Writable({
      highWaterMark: 16,
      write(chunk, _encoding, done) {
        setTimeout(() => {
          taken.push(String(chunk))
          done()
        }, 5)
      },
    })
    for (let i = 0; i < 20; i++) slow.write(`line ${i}\n`)
    expect(taken.length).toBeLessThan(20)
    await drained([slow])
    expect(taken.join('')).toContain('line 19')
  })
})

describe('crombolo schema', () => {
  const schema = () => {
    const result = run(['schema'])
    expect(result.code).toBe(0)
    return JSON.parse(result.out) as {
      commands: Array<{ name: string; args?: Array<{ name: string }>; [key: string]: unknown }>
      errors: Array<{ kind: string; exit_code: number }>
      outcomes: Array<{ name: string; code: number }>
      global_args: Array<{ name: string }>
    }
  }

  test('describes the commands that write schema files (story 161)', () => {
    const names = schema().commands.map((c) => c.name)
    for (const name of [
      'languages add',
      'languages list',
      'forms new',
      'workflows new',
      'webhooks new',
    ])
      expect(names, name).toContain(name)
  })

  test('validates against clispec v0.3, in a folder with no site', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false })
    const validate = ajv.compile(
      JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/clispec-v0.3.json'), 'utf8')),
    )
    const document = schema()
    expect(validate(document), JSON.stringify(validate.errors, null, 2)).toBe(true)
  })

  test('keeps the rules JSON Schema cannot: unique codes and names, and every reference declared', () => {
    const document = schema()
    const outcomeCodes = document.outcomes.map((o) => o.code)
    const errorCodes = document.errors.map((e) => e.exit_code)
    expect(outcomeCodes.filter((code) => errorCodes.includes(code))).toEqual([])
    expect(new Set(outcomeCodes).size).toBe(outcomeCodes.length)
    const names = document.commands.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
    const kinds = new Set(document.errors.map((e) => e.kind))
    const outcomes = new Set(document.outcomes.map((o) => o.name))
    const globals = new Set(document.global_args.map((a) => a.name))
    for (const command of document.commands) {
      for (const kind of (command.errors as string[]) ?? [])
        expect(kinds.has(kind), `${command.name}: ${kind}`).toBe(true)
      for (const name of (command.outcomes as string[]) ?? []) expect(outcomes.has(name)).toBe(true)
      const declared = new Set([...(command.args ?? []).map((a) => a.name), ...globals])
      for (const key of ['confirmation_bypass_arg', 'fields_arg'])
        if (command[key])
          expect(declared.has(command[key] as string), `${command.name}: ${key}`).toBe(true)
      const pagination = command.pagination as Record<string, string> | undefined
      for (const arg of Object.entries(pagination ?? {}).filter(([k]) => k.endsWith('_arg')))
        expect(declared.has(arg[1]), `${command.name}: ${arg[0]}`).toBe(true)
      if (command.confirmation_bypass_arg)
        expect(command.errors as string[]).toContain('confirmation_required')
    }
  })

  test('declares an explicit JSON flag globally, and text as the piped default', () => {
    const document = schema() as unknown as {
      output: { piped: string }
      global_args: Array<{ name: string; enum?: string[] }>
    }
    expect(document.output.piped).toBe('text')
    expect(document.global_args.find((a) => a.name === '--output')?.enum).toContain('json')
  })

  test('narrows to a command path, and refuses one that is not there', () => {
    const narrowed = JSON.parse(run(['schema', 'content', 'import']).out) as {
      commands: { name: string }[]
    }
    expect(narrowed.commands.map((c) => c.name)).toEqual(['content import'])
    expect(run(['schema', 'nothing', 'here']).code).toBe(ERROR_KINDS.not_found.exitCode)
  })

  test('every command has a description and declares its effects', () => {
    for (const command of schema().commands) {
      expect(String(command.description).length, command.name).toBeGreaterThan(0)
      expect(['read_only', 'idempotent', 'non_idempotent']).toContain(command.effects as string)
    }
  })
})

describe('the oclif manifest', () => {
  test('caches every command with its clispec spec, at the package version', async () => {
    const manifest = await buildManifest()
    expect(manifest.version).toBe(sharedVersion())
    const ids = Object.keys(manifest.commands)
    for (const id of ['start', 'types:check', 'content:import', 'push', 'schema'])
      expect(ids).toContain(id)
    for (const [id, command] of Object.entries(manifest.commands))
      expect((command as { spec?: { effects?: string } }).spec?.effects, id).toBeDefined()
  })
})

describe('init', () => {
  test('scaffolds into an empty directory, or one holding only a fresh repository', () => {
    mkdirSync(join(dir, '.git'))
    const result = run(['init', '--name', 'Empty'])
    expect(result.code, result.err).toBe(0)
    expect(existsSync(join(dir, 'package.json'))).toBe(true)
  })

  test('refuses a directory that is not empty, writing nothing, unless --force', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"mine"}')
    const refused = run(['init', '--template', 'basic', '--json'])
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.envelope()).toMatchObject({ kind: 'refused' })
    expect(String(refused.envelope().message)).toContain('package.json')
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{"name":"mine"}')
    expect(existsSync(join(dir, 'crombolo.config.ts'))).toBe(false)

    const forced = run(['init', '--name', 'Forced', '--force'])
    expect(forced.code, forced.err).toBe(0)
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).not.toBe('{"name":"mine"}')
  })

  test('lists the templates in any directory', () => {
    writeFileSync(join(dir, 'notes.txt'), 'here')
    const result = run(['init', '--template', 'list'])
    expect(result.code, result.err).toBe(0)
    expect(result.out).toContain('basic')
  })
})

describe('components new', () => {
  test("writes an e-mail template when a form's Send email names the alias", () => {
    mkdirSync(join(dir, 'schema', 'forms'), { recursive: true })
    writeFileSync(join(dir, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(
      join(dir, 'schema', 'forms', 'contact-us.toml'),
      `[form]
alias = "contactUs"
name = "Contact us"

[[page]]

  [[page.group]]

    [[page.group.field]]
    alias = "email"
    type = "email"
    caption = "Email"

[[workflow]]
type = "sendEmail"
name = "Tell the team"

  [workflow.settings]
  to = "team@example.com"
  subject = "Hello"
  template = "emails/receipt"
`,
    )
    const email = run(['components', 'new', 'emails/receipt', '-o', 'json'])
    expect(email.code).toBe(0)
    const result = JSON.parse(email.out) as { created: string }
    expect(result).toMatchObject({ template: false, email: true })
    // Wherever the environment puts components/: the suite's own container moves it.
    expect(result.created).toEndWith('emails/receipt.tsx')
    const written = readFileSync(resolve(dir, result.created), 'utf8')
    expect(written).toContain("import type { EmailProps } from '@crombolo/crombolo'")
    expect(written).toContain('export default function Receipt(')

    const plain = run(['components', 'new', 'shared/header', '-o', 'json'])
    expect(JSON.parse(plain.out)).toMatchObject({ template: false, email: false })

    // The folder alone is enough, before any form names it.
    const unnamed = run(['components', 'new', 'emails/welcome', '-o', 'json'])
    expect(JSON.parse(unnamed.out)).toMatchObject({ template: false, email: true })
  })
})

describe('writing schema from the command line (story 161)', () => {
  test('types, data types, languages, forms, workflows and webhooks, each refusing what would not apply', () => {
    mkdirSync(join(dir, 'schema'), { recursive: true })
    writeFileSync(join(dir, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    // A database of this test's own, whichever dialect the suite runs on.
    const env = { CROMBOLO_DB: 'sqlite', CROMBOLO_SQLITE_FILE: join(dir, 'site.db') }
    const cli = (...args: string[]) => run([...args, '-o', 'json'], undefined, env)
    const ok = (...args: string[]) => {
      const result = cli(...args)
      expect(result.code, `${args.join(' ')}\n${result.err}`).toBe(0)
      return JSON.parse(result.out) as Record<string, unknown>
    }
    const refused = (kind: string, ...args: string[]) => {
      const result = cli(...args)
      expect(result.envelope(), args.join(' ')).toMatchObject({ kind })
      return result
    }
    const file = (path: string) => readFileSync(join(dir, 'schema', path), 'utf8')

    ok('types', 'new', 'content-type', 'feature', '--element')
    expect(
      ok('types', 'new', 'data-type', 'pageBlocks', '--editor', 'block-list', '--block', 'feature')
        .created,
    ).toEqual(['schema/data-types/page-blocks.toml'])
    expect(file('data-types/page-blocks.toml')).toContain(
      '[[data-type.block]]\nelement = "feature"',
    )
    refused('conflict', 'types', 'new', 'data-type', 'pageBlocks', '--editor', 'block-list')
    refused(
      'refused',
      'types',
      'new',
      'data-type',
      'flag',
      '--editor',
      'toggle',
      '--max-chars',
      '3',
    )
    refused(
      'refused',
      'types',
      'new',
      'data-type',
      'picker',
      '--editor',
      'element-picker',
      '--allow',
      'nothing',
    )

    // An alias that names nothing is refused before anything is written.
    refused('refused', 'types', 'new', 'content-type', 'page', '--compose', 'nothing')
    expect(existsSync(join(dir, 'schema', 'content-types', 'page.toml'))).toBe(false)
    ok(
      'types',
      'new',
      'content-type',
      'page',
      '--at-root',
      '--allow-child',
      'page',
      '--list-view',
      '--vary-by-culture',
    )
    const page = file('content-types/page.toml')
    expect(page).toContain('collection = "listViewContent"')
    expect(page).toContain('allow-children = ["page"]')
    expect(page).not.toContain('key =')

    ok('languages', 'add', 'fr-FR', '--fallback', 'en-US')
    expect(ok('languages', 'list').languages).toEqual([
      {
        iso: 'en-US',
        name: 'English (United States)',
        default: true,
        mandatory: false,
        fallback: null,
      },
      {
        iso: 'fr-FR',
        name: 'French (France)',
        default: false,
        mandatory: false,
        fallback: 'en-US',
      },
    ])
    refused('conflict', 'languages', 'add', 'fr-FR')
    refused('refused', 'languages', 'add', 'de-DE', '--fallback', 'it-IT')

    ok('forms', 'new', 'contact')
    expect(file('forms/contact.toml')).toContain('type = "email"')
    refused('conflict', 'forms', 'new', 'contact')

    ok('workflows', 'new', 'signOff', '--content-type', 'page')
    refused('refused', 'workflows', 'new', 'other', '--content-type', 'nothing')

    ok(
      'webhooks',
      'new',
      'searchIndex',
      '--url',
      'https://search.example/hook',
      '--event',
      'Umbraco.ContentPublish',
      '--content-type',
      'page',
    )
    const hook = file('webhooks/searchIndex.toml')
    expect(hook).toContain('content-types = ["page"]')
    expect(hook).not.toContain('key =')
    refused(
      'conflict',
      'webhooks',
      'new',
      'searchIndex',
      '--url',
      'https://x.example/',
      '--event',
      'Umbraco.ContentPublish',
    )
    refused('refused', 'webhooks', 'new', 'bad', '--url', 'ftp://x', '--event', 'Nope')

    expect(cli('types', 'check', '--static').code).toBe(0)
  }, 120_000)
})

describe('block components (story 184)', () => {
  test('components new --block writes a typed block component for an element type only', () => {
    mkdirSync(join(dir, 'schema', 'content-types'), { recursive: true })
    writeFileSync(join(dir, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(
      join(dir, 'schema', 'content-types', 'quote.toml'),
      '[content-type]\nalias = "quote"\nname = "Quote"\nis-element = true\n\n[[property]]\nalias = "said"\nname = "Said"\ntype = "textstring"\n',
    )
    writeFileSync(
      join(dir, 'schema', 'content-types', 'page.toml'),
      '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\n',
    )
    const made = run(['components', 'new', '--block', 'quote', '-o', 'json'])
    expect(made.code, made.err).toBe(0)
    const result = JSON.parse(made.out) as { created: string; block: boolean }
    expect(result.block).toBe(true)
    expect(result.created).toEndWith('blocks/quote.tsx')
    const written = readFileSync(resolve(dir, result.created), 'utf8')
    expect(written).toContain("import type { BlockProps } from '@crombolo/crombolo'")
    expect(written).toContain("import type { Quote } from '../../schema/content-types'")
    expect(written).toContain("content.text('said')")

    expect(run(['components', 'new', '--block', 'page']).envelope()).toMatchObject({
      kind: 'usage',
    })
    expect(run(['components', 'new', '--block', 'nothing']).envelope()).toMatchObject({
      kind: 'usage',
    })
    expect(run(['components', 'new', '--block', 'quote']).envelope()).toMatchObject({
      kind: 'conflict',
    })

    // A block component that names no element type is reported, and breaks nothing.
    writeFileSync(resolve(dir, result.created, '..', 'ghost.tsx'), 'export default () => <p />\n')
    const checked = JSON.parse(run(['components', 'check', '-o', 'json']).out) as {
      orphanBlocks: string[]
    }
    expect(checked.orphanBlocks).toEqual(['blocks/ghost'])
  }, 60_000)
})

describe('generate --delivery (story 052)', () => {
  test('needs --out, because the types belong in the app', () => {
    const result = run(['generate', '--delivery'])
    expect(result.code).toBe(2)
    expect(result.envelope()).toMatchObject({ kind: 'usage' })
    expect(result.err).toContain('--out')
  })

  test('writes the Delivery API types from another schema directory', () => {
    const schema = join(ROOT, 'sites/harbourstone/schema')
    const result = run(['generate', '--delivery', '--schema', schema, '--out', 'app/cms-types.ts'])
    expect(result.code).toBe(0)
    const written = readFileSync(join(dir, 'app/cms-types.ts'), 'utf8')
    expect(written).toContain('export interface DeliveryTypes {')
    expect(written).toContain("from '@crombolo/delivery-client'")
  })
})
