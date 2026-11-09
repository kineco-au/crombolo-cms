/**
 * Story 249: data types changed from the command line. `updateDataType` on its
 * own, then `types update`, `types remove` and `types editors` through the CLI on
 * a SQLite site with a page that uses a block list.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type SchemaDataType, updateDataType } from '@crombolo/schema'
import { seedKey } from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const text = (): SchemaDataType => ({
  alias: 'shortText',
  name: 'Short text',
  editor: 'Umbraco.TextBox',
  config: { maxChars: 100 },
})
const blocks = (): SchemaDataType => ({
  alias: 'pageBlocks',
  name: 'Page blocks',
  editor: 'Umbraco.BlockList',
  config: {},
  blocks: [{ element: 'quote' }],
})

describe('updateDataType', () => {
  test('stores any setting as given, and takes one away', () => {
    const changed = updateDataType(text(), { set: { inputType: 'email', notAThing: 3 } })
    expect(changed.ok && changed.dataType.config).toEqual({
      maxChars: 100,
      inputType: 'email',
      notAThing: 3,
    })
    const unset = updateDataType(text(), { unset: ['maxChars'] })
    expect(unset.ok && unset.dataType.config).toEqual({})
    expect(updateDataType(text(), { unset: ['nothing'] })).toMatchObject({ ok: false })
  })

  test('a preset flag writes its own setting, and leaves the rest', () => {
    const changed = updateDataType(text(), { options: { maxChars: 40 } })
    expect(changed.ok && changed.dataType.config).toEqual({ maxChars: 40 })
    const wrong = updateDataType(text(), { options: { rows: 4 } })
    expect(wrong).toMatchObject({ ok: false })
    expect(!wrong.ok && wrong.reason).toContain('--rows does not apply to textstring')
  })

  test('blocks added and removed, only on an editor that has them', () => {
    const added = updateDataType(blocks(), { addBlock: { element: 'feature', label: 'Feature' } })
    expect(added.ok && added.dataType.blocks).toEqual([
      { element: 'quote' },
      { element: 'feature', label: 'Feature' },
    ])
    expect(updateDataType(blocks(), { addBlock: { element: 'quote' } })).toMatchObject({
      ok: false,
    })
    expect(updateDataType(blocks(), { removeBlock: 'nothing' })).toMatchObject({ ok: false })
    expect(updateDataType(text(), { addBlock: { element: 'quote' } })).toMatchObject({ ok: false })
  })

  test('a start node set and taken away', () => {
    const picker: SchemaDataType = {
      alias: 'p',
      name: 'P',
      editor: 'Umbraco.MultiNodeTreePicker',
      config: { startNode: { type: 'content' } },
    }
    const set = updateDataType(picker, { startNode: 'k-1' })
    expect(set.ok && set.dataType.config.startNode).toEqual({ type: 'content', id: 'k-1' })
    const cleared = updateDataType(set.ok ? set.dataType : picker, { startNode: null })
    expect(cleared.ok && cleared.dataType.config.startNode).toEqual({ type: 'content' })
  })
})

describe('the commands, on a site with a page', () => {
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
  const file = (name: string) => readFileSync(join(site, 'schema', 'data-types', name), 'utf8')

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'data-types-edit-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/quote.toml':
        '[content-type]\nalias = "quote"\nname = "Quote"\nis-element = true\n\n[[property]]\nalias = "text"\nname = "Text"\ntype = "textarea"\n',
      'schema/content-types/feature.toml':
        '[content-type]\nalias = "feature"\nname = "Feature"\nis-element = true\n\n[[property]]\nalias = "heading"\nname = "Heading"\ntype = "textstring"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\nallow-children = ["page"]\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "shortText"\n\n[[property]]\nalias = "blocks"\nname = "Blocks"\ntype = "pageBlocks"\n\n[[property]]\nalias = "related"\nname = "Related"\ntype = "pagePicker"\n',
      'schema/data-types/short-text.toml':
        '[data-type]\nalias = "shortText"\nname = "Short text"\neditor = "Umbraco.TextBox"\n\n[data-type.config]\nmaxChars = 100\n',
      'schema/data-types/page-blocks.toml':
        '[data-type]\nalias = "pageBlocks"\nname = "Page blocks"\neditor = "Umbraco.BlockList"\n\n[[data-type.block]]\nelement = "quote"\n',
      'schema/data-types/page-picker.toml':
        '[data-type]\nalias = "pagePicker"\nname = "Page picker"\neditor = "Umbraco.MultiNodeTreePicker"\n\n[data-type.config]\nstartNode = { type = "content" }\n',
      'schema/data-types/unused.toml':
        '[data-type]\nalias = "unused"\nname = "Unused"\neditor = "Umbraco.TextArea"\n',
      'components/page.tsx': 'export default () => <main />\n',
      'content/pages/home.toml': 'type = "page"\nname = "Home"\n\n[values]\ntitle = "Welcome"\n',
      'content/pages/home/news.toml': 'type = "page"\nname = "News"\n\n[values]\ntitle = "News"\n',
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(site, path, '..'), { recursive: true })
      writeFileSync(join(site, path), body)
    }
    expect(cli('types', 'sync').code).toBe(0)
    const applied = cli('site', 'apply')
    expect(applied.code, applied.out).toBe(0)
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('a named setting, and any setting stored as given', () => {
    const named = cli('types', 'update', 'shortText', '--max-chars', '80')
    expect(named.code, named.out).toBe(0)
    expect(file('short-text.toml')).toContain('maxChars = 80')
    const stored = cli(
      'types',
      'update',
      'shortText',
      '--set',
      'inputType=email',
      '--set',
      'notAThing=true',
    )
    expect(stored.code, stored.out).toBe(0)
    expect(file('short-text.toml')).toContain('inputType = "email"')
    expect(file('short-text.toml')).toContain('notAThing = true')
    expect(cli('types', 'update', 'shortText', '--unset', 'notAThing').code).toBe(0)
    expect(file('short-text.toml')).not.toContain('notAThing')
  })

  test('a block added and taken away', () => {
    expect(
      cli('types', 'update', 'pageBlocks', '--add-block', 'feature', '--block-label', 'Feature')
        .code,
    ).toBe(0)
    const shown = JSON.parse(cli('types', 'show', 'pageBlocks', '-o', 'json').out) as {
      blocks: Array<{ element: string }>
    }
    expect(shown.blocks.map((b) => b.element)).toEqual(['quote', 'feature'])
    expect(cli('types', 'update', 'pageBlocks', '--remove-block', 'feature').code).toBe(0)
    const unknown = cli('types', 'update', 'pageBlocks', '--add-block', 'nothingLikeIt')
    expect(unknown.code).toBe(ERROR_KINDS.refused.exitCode)
  })

  test('a start node by a content file’s path, the same key everywhere', () => {
    const run = cli('types', 'update', 'pagePicker', '--start-at', '/Home/News')
    expect(run.code, run.out).toBe(0)
    expect(file('page-picker.toml')).toContain(seedKey('content/home/news'))
    expect(cli('types', 'update', 'pagePicker', '--start-at', 'none').code).toBe(0)
    expect(file('page-picker.toml')).not.toContain(seedKey('content/home/news'))
    expect(cli('types', 'update', 'pagePicker', '--start-at', '/Nowhere').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
  })

  test('a built-in data type is not changed; a flag for the other kind is refused', () => {
    const builtIn = cli('types', 'update', 'textstring', '--set', 'maxChars=10')
    expect(builtIn.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(builtIn.out).toContain('types new data-type')
    const wrong = cli('types', 'update', 'shortText', '--allow-child', 'page')
    expect(wrong.code).toBe(ERROR_KINDS.usage.exitCode)
    expect(wrong.out).toContain('--allow-child is for types')
    const other = cli('types', 'update', 'page', '--max-chars', '3')
    expect(other.code).toBe(ERROR_KINDS.usage.exitCode)
  })

  test('removed when nothing uses it; refused, naming the properties, when something does', () => {
    const used = cli('types', 'remove', 'shortText')
    expect(used.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(used.out).toContain('page.title')
    const removed = cli('types', 'remove', 'unused')
    expect(removed.code, removed.out).toBe(0)
    expect(cli('types', 'show', 'unused').code).toBe(ERROR_KINDS.not_found.exitCode)
  })

  test('types editors lists them with their flags, and nothing names a file', () => {
    const editors = cli('types', 'editors')
    expect(editors.code).toBe(0)
    expect(editors.out).toContain('textstring')
    expect(editors.out).toContain('--max-chars')
    expect(editors.out).toContain('--set <setting>=<value>')
    expect(cli('types', 'editors', 'nothing').code).toBe(ERROR_KINDS.not_found.exitCode)
    for (const run of [editors, cli('types', 'update', 'shortText', '--max-chars', '70')])
      expect(run.out).not.toMatch(/\.toml|schema\//i)
  })
})
