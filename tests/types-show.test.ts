/**
 * Story 247: the site's definitions read from the command line. `describe.ts`
 * over a schema with compositions, block lists and pickers; then `types list`
 * and `types show` through the CLI on a SQLite site, with no database, synced,
 * and changed since.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describeType, listTypes, loadSchemaDirectory, usesOf } from '@crombolo/schema'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
let site: string

const FILES: Record<string, string> = {
  'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
  'schema/content-types/seo.toml':
    '[content-type]\nalias = "seo"\nname = "SEO"\nis-element = true\n\n[[property]]\nalias = "metaTitle"\nname = "Meta title"\ntype = "textstring"\n',
  'schema/content-types/quote.toml':
    '[content-type]\nalias = "quote"\nname = "Quote"\nis-element = true\n\n[[property]]\nalias = "text"\nname = "Text"\ntype = "textarea"\nmandatory = true\n',
  'schema/content-types/article.toml':
    '[content-type]\nalias = "article"\nname = "Article"\nicon = "icon-document"\ncompositions = ["seo"]\ncomponents = ["article"]\ndefault-component = "article"\n\n[[tab]]\nname = "Content"\n\n[[tab.property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\nmandatory = true\n\n[[tab.property]]\nalias = "body"\nname = "Body"\ntype = "pageBlocks"\n',
  'schema/content-types/home.toml':
    '[content-type]\nalias = "home"\nname = "Home"\nallow-at-root = true\nallow-children = ["article"]\ncomponents = ["home"]\ndefault-component = "home"\n',
  'schema/data-types/page-blocks.toml':
    '[data-type]\nalias = "pageBlocks"\nname = "Page blocks"\neditor = "Umbraco.BlockList"\n\n[[data-type.block]]\nelement = "quote"\nlabel = "Quote"\n',
  'schema/data-types/article-picker.toml':
    '[data-type]\nalias = "articlePicker"\nname = "Article picker"\neditor = "Umbraco.MultiNodeTreePicker"\n\n[data-type.config]\nfilter = "article"\n',
  'components/article.tsx': 'export default () => <main />\n',
  'components/home.tsx': 'export default () => <main />\n',
}

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

function cli(...args: string[]) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: site, env: env(), stdin: 'ignore' })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}
const json = <T>(...args: string[]) => JSON.parse(cli(...args, '-o', 'json').out) as T

beforeAll(() => {
  site = mkdtempSync(join(process.cwd(), 'output', 'types-show-'))
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(join(site, path, '..'), { recursive: true })
    writeFileSync(join(site, path), text)
  }
})
afterAll(() => rmSync(site, { recursive: true, force: true }))

describe('describing a schema', () => {
  const set = () => loadSchemaDirectory(join(site, 'schema')).set

  test('lists each kind, built-in data types marked, and only the site’s own with own', () => {
    const rows = listTypes(set())
    expect(rows.filter((r) => r.kind === 'content').map((r) => r.alias)).toEqual([
      'article',
      'home',
    ])
    expect(rows.filter((r) => r.kind === 'element').map((r) => r.alias)).toEqual(['quote', 'seo'])
    expect(rows.find((r) => r.alias === 'textstring')).toMatchObject({
      kind: 'data',
      builtIn: true,
    })
    expect(listTypes(set(), { kind: 'data', own: true }).map((r) => r.alias)).toEqual([
      'articlePicker',
      'pageBlocks',
    ])
  })

  test('says what uses a definition: children, compositions, blocks, pickers and properties', () => {
    expect(usesOf(set(), 'article').map((u) => `${u.by}:${u.how}`)).toEqual([
      'home:allowed child',
      'articlePicker:picker allows',
    ])
    expect(usesOf(set(), 'seo').map((u) => `${u.by}:${u.how}`)).toEqual(['article:composition'])
    expect(usesOf(set(), 'quote').map((u) => `${u.by}:${u.how}`)).toEqual(['pageBlocks:block'])
    expect(usesOf(set(), 'pageBlocks')).toEqual([
      { by: 'article', byKind: 'content', property: 'body', how: 'property of this data type' },
    ])
  })

  test('shows a type’s properties by tab, and a data type’s settings with plain names', () => {
    const article = describeType(set(), 'article')
    expect(article.ok && article.found.kind === 'content' && article.found.properties).toEqual([
      expect.objectContaining({
        alias: 'title',
        tab: 'Content',
        dataType: 'textstring',
        mandatory: true,
      }),
      expect.objectContaining({
        alias: 'body',
        tab: 'Content',
        dataType: 'pageBlocks',
        from: null,
      }),
      // What its composition brings, and from where (story 255)
      expect.objectContaining({ alias: 'metaTitle', tab: null, from: 'seo', via: null }),
    ])
    const picker = describeType(set(), 'articlePicker')
    expect(picker.ok && picker.found.kind === 'data' && picker.found.settings).toEqual([
      { setting: 'filter', label: 'Allows', value: 'article' },
    ])
    expect(describeType(set(), 'nothing')).toEqual({ ok: false, reason: 'not-found' })
  })

  test('an alias two kinds share is not guessed', () => {
    writeFileSync(
      join(site, 'schema', 'data-types', 'home.toml'),
      '[data-type]\nalias = "home"\nname = "Home text"\neditor = "Umbraco.TextBox"\n',
    )
    try {
      expect(describeType(set(), 'home')).toEqual({
        ok: false,
        reason: 'ambiguous',
        kinds: ['content', 'data'],
      })
      expect(describeType(set(), 'home', 'data')).toMatchObject({
        ok: true,
        found: { kind: 'data' },
      })
      const refused = cli('types', 'show', 'home')
      expect(refused.code).toBe(ERROR_KINDS.usage.exitCode)
      expect(refused.out + refused.err).toContain('--kind content or --kind data')
    } finally {
      rmSync(join(site, 'schema', 'data-types', 'home.toml'))
    }
  })
})

describe('types list and types show', () => {
  test('with no database: what the site defines, saying counts are left out', () => {
    const run = cli('types', 'list')
    expect(run.code, run.err).toBe(0)
    expect(run.out).toContain('Content types')
    expect(run.out).toContain('the site has no database yet')
    const listed = json<{
      items: Array<{ alias: string; items: number | null }>
      database: string
    }>('types', 'list')
    expect(listed.items.find((i) => i.alias === 'article')?.items).toBeNull()
    expect(listed.database).toContain('no database')
  })

  test('once applied: item counts, and what has changed since', () => {
    expect(cli('types', 'sync').code).toBe(0)
    const article = json<{ items: number; applied: string; usedBy: unknown[] }>(
      'types',
      'show',
      'article',
    )
    expect(article).toMatchObject({ items: 0, applied: 'applied' })
    // A built-in data type is in every database, so it is applied, never waiting.
    const builtIn = json<{ items: Array<{ alias: string; applied: string }> }>('types', 'list')
    expect(builtIn.items.find((i) => i.alias === 'textstring')?.applied).toBe('applied')
    expect(article.usedBy).toHaveLength(2)

    writeFileSync(
      join(site, 'schema', 'content-types', 'home.toml'),
      `${FILES['schema/content-types/home.toml']}\n[[property]]\nalias = "tagline"\nname = "Tagline"\ntype = "textstring"\n`,
    )
    expect(json<{ applied: string }>('types', 'show', 'home').applied).toBe(
      'changed, not applied yet',
    )
    const fromDatabase = json<{ properties: unknown[] }>('types', 'show', 'home', '--from-database')
    expect(fromDatabase.properties).toHaveLength(0)
  })

  test('a data type with the properties using it, and nothing names a file', () => {
    const shown = cli('types', 'show', 'pageBlocks')
    expect(shown.code, shown.err).toBe(0)
    expect(shown.out).toContain('Data type "Page blocks" (pageBlocks)')
    expect(shown.out).toContain('block      Quote (quote)')
    expect(shown.out).toContain('article.body (content type): property of this data type')
    for (const run of [cli('types', 'list'), cli('types', 'show', 'article'), shown])
      expect(run.out).not.toMatch(/toml|schema\//i)
  })

  test('an alias that names nothing is refused, pointing at the list', () => {
    const run = cli('types', 'show', 'nothing')
    expect(run.code).toBe(ERROR_KINDS.not_found.exitCode)
    expect(run.out + run.err).toContain('crombolo types list')
  })
})
