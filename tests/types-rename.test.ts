/**
 * Story 250: renames that keep their content. The renames in `rename.ts` and
 * the content-file rewrite on their own, then `types rename` and
 * `types property rename` through the CLI on a SQLite site with a page, a
 * block and a view: refused while anything names the old alias, and with
 * --everywhere renamed in all of them, the values kept.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from '@crombolo/data'
import {
  propertyKeyFor,
  renameDataType,
  renameProperty,
  renameType,
  type SchemaContentType,
  type SchemaSet,
  typeKeyFor,
} from '@crombolo/schema'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { rewriteContentFile } from '../packages/cli/src/support/rename-references.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const prop = (alias: string, type = 'textstring') => ({
  alias,
  name: alias,
  type,
  mandatory: false,
  variesByCulture: false,
  variesBySegment: false,
  labelOnTop: false,
})
const type = (alias: string, more: Partial<SchemaContentType> = {}): SchemaContentType => ({
  alias,
  name: alias,
  icon: 'icon-document',
  allowAtRoot: false,
  isElement: false,
  allowInLibrary: false,
  variesByCulture: false,
  variesBySegment: false,
  compositions: [],
  allowChildren: [],
  components: [],
  cleanup: { prevent: false },
  properties: [],
  tabs: [],
  ...more,
})
const set = (): SchemaSet => ({
  version: '1.0.0',
  languages: [],
  contentTypes: [
    type('quote', { isElement: true, properties: [prop('text')] }),
    type('page', {
      allowChildren: ['page', 'quote'],
      properties: [prop('title'), prop('blocks', 'pageBlocks')],
    }),
  ],
  dataTypes: [
    {
      alias: 'pageBlocks',
      name: 'Page blocks',
      editor: 'Umbraco.BlockList',
      config: {},
      blocks: [{ element: 'quote', label: '{= text | truncate:30}' }],
    },
  ],
  workflows: [
    {
      alias: 'review',
      name: 'Review',
      appliesTo: { contentTypes: ['quote'] },
      stages: [],
    } as never,
  ],
})

describe('the renames', () => {
  test('a type keeps its key, and every definition naming it follows', () => {
    const result = renameType(set(), 'document', 'quote', 'pullQuote')
    if (!result.ok) throw new Error(result.reason)
    const renamed = result.set.contentTypes.find((t) => t.alias === 'pullQuote')
    expect(renamed?.key).toBe(typeKeyFor('document', 'quote'))
    expect(result.set.contentTypes.find((t) => t.alias === 'page')?.allowChildren).toEqual([
      'page',
      'pullQuote',
    ])
    expect(result.set.dataTypes[0]?.blocks?.[0]?.element).toBe('pullQuote')
    expect(result.set.workflows?.[0]?.appliesTo.contentTypes).toEqual(['pullQuote'])
    expect(result.references.map((r) => r.how).sort()).toEqual([
      'allowed child',
      'applies to',
      'block',
    ])
  })

  test('refused: no such type, a taken or wrong alias, a type every site has', () => {
    expect(renameType(set(), 'document', 'nothing', 'x')).toMatchObject({ ok: false })
    expect(renameType(set(), 'document', 'quote', 'Page')).toMatchObject({ ok: false })
    expect(renameType(set(), 'document', 'quote', '1st')).toMatchObject({ ok: false })
  })

  test('a property keeps its key, and a block label naming it follows', () => {
    const result = renameProperty(set(), 'document', 'quote', 'text', 'body')
    if (!result.ok) throw new Error(result.reason)
    const quote = result.set.contentTypes.find((t) => t.alias === 'quote')
    expect(quote?.properties[0]).toMatchObject({
      alias: 'body',
      key: propertyKeyFor(typeKeyFor('document', 'quote'), 'text'),
    })
    expect(quote?.key).toBeUndefined()
    expect(result.set.dataTypes[0]?.blocks?.[0]?.label).toBe('{= body | truncate:30}')
    expect(renameProperty(set(), 'document', 'quote', 'text', 'text')).toMatchObject({ ok: true })
    expect(renameProperty(set(), 'document', 'page', 'title', 'blocks')).toMatchObject({
      ok: false,
    })
  })

  test('a data type keeps its key, and the properties using it follow', () => {
    const result = renameDataType(set(), 'pageBlocks', 'sections')
    if (!result.ok) throw new Error(result.reason)
    expect(result.set.contentTypes[1]?.properties[1]?.type).toBe('sections')
    expect(result.references).toEqual([{ in: 'content type "page"', how: 'property "blocks"' }])
    expect(renameDataType(set(), 'textstring', 'words')).toMatchObject({ ok: false })
  })
})

describe('a content file rewritten', () => {
  const page = [
    'type = "page"',
    'name = "Home"',
    '',
    '[values]',
    'title = "Welcome"',
    'blocks = [',
    '  { type = "quote", values = { text = "Hello", title = "Not the page’s" } },',
    ']',
    '',
    '[values.en-US]',
    'title = "Welcome, in English"',
    '',
  ].join('\n')

  test('a property: only where it is the type’s, the rest of the file as it was', () => {
    const result = rewriteContentFile(page, {
      what: 'property',
      kind: 'document',
      type: 'page',
      from: 'title',
      to: 'headline',
    })
    expect(result).toEqual({
      next: page
        .replace('title = "Welcome"', 'headline = "Welcome"')
        .replace('title = "Welcome, in', 'headline = "Welcome, in'),
    })
  })

  test('a type, at the top and in its blocks', () => {
    const result = rewriteContentFile(page, {
      what: 'type',
      kind: 'document',
      from: 'quote',
      to: 'pullQuote',
    })
    expect(result).toEqual({ next: page.replace('type = "quote"', 'type = "pullQuote"') })
    expect(
      rewriteContentFile(page, { what: 'type', kind: 'document', from: 'nothing', to: 'x' }),
    ).toBeUndefined()
  })

  test('written in a way it cannot follow: said, not guessed', () => {
    const odd = 'type = "page"\n\n[values]\n"ti\\u0074le" = "Welcome"\n'
    expect(
      rewriteContentFile(odd, {
        what: 'property',
        kind: 'document',
        type: 'page',
        from: 'title',
        to: 'headline',
      }),
    ).toMatchObject({ unsafe: expect.any(String) })
  })
})

describe('the commands, on a site with a page, a block and a view', () => {
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
  const read = (path: string) => readFileSync(join(site, path), 'utf8')
  /** The current values of a property, by its alias, from the site's database. */
  const values = async (alias: string) => {
    const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
    try {
      const rows = await db.q
        .selectFrom('property_value as pv')
        .innerJoin('property_type as pt', 'pt.id', 'pv.property_type_id')
        .select(['pv.varchar_value', 'pv.text_value'])
        .where('pt.alias', '=', alias)
        .where('pv.is_current', '=', db.dialect.boolValue(true))
        .execute()
      return rows.map((r) => r.varchar_value ?? r.text_value)
    } finally {
      await db.close()
    }
  }

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'types-rename-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/quote.toml':
        '[content-type]\nalias = "quote"\nname = "Quote"\nis-element = true\n\n[[property]]\nalias = "text"\nname = "Text"\ntype = "textarea"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n\n[[property]]\nalias = "blocks"\nname = "Blocks"\ntype = "pageBlocks"\n',
      'schema/data-types/page-blocks.toml':
        '[data-type]\nalias = "pageBlocks"\nname = "Page blocks"\neditor = "Umbraco.BlockList"\n\n[[data-type.block]]\nelement = "quote"\n',
      'components/page.tsx':
        "export default ({ model }) => <main class={model.contentType.alias === 'page' ? 'page' : ''}>{model.text('title')}</main>\n",
      'content/pages/home.toml':
        'type = "page"\nname = "Home"\n\n[values]\ntitle = "Welcome"\nblocks = [\n  { type = "quote", values = { text = "Hello" } },\n]\n',
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

  test('types show says where a type is used in content files and views', () => {
    const shown = JSON.parse(cli('types', 'show', 'page', '-o', 'json').out) as {
      usedInContentFiles: string[]
      usedInViews: string[]
    }
    expect(shown.usedInContentFiles).toEqual(['page /home'])
    expect(shown.usedInViews).toEqual(['components/page.tsx: tests for it, reads title'])
  })

  test('refused while anything names it, listing each, with nothing written', () => {
    const before = read('schema/content-types/page.toml')
    const refused = cli('types', 'property', 'rename', 'page', 'title', 'headline')
    expect(refused.code, refused.out).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('page /home')
    expect(refused.out).toContain('view components/page.tsx')
    expect(refused.out).toContain('--everywhere')
    expect(read('schema/content-types/page.toml')).toBe(before)
  })

  test('a property renamed everywhere: definition, content file and view, its values kept', async () => {
    const run = cli('types', 'property', 'rename', 'page', 'title', 'headline', '--everywhere')
    expect(run.code, run.out).toBe(0)
    expect(run.out).toContain(
      '"title" of content type "page" is renamed "headline", keeping its values',
    )
    expect(read('schema/content-types/page.toml')).toContain('alias = "headline"')
    expect(read('content/pages/home.toml')).toContain('headline = "Welcome"')
    expect(read('components/page.tsx')).toContain("model.text('headline')")
    expect(await values('headline')).toEqual(['Welcome'])
    expect(await values('title')).toEqual([])
  })

  test('a type renamed everywhere: its file follows, its block and its items kept', async () => {
    const run = cli('types', 'rename', 'quote', 'pullQuote', '--everywhere')
    expect(run.code, run.out).toBe(0)
    expect(run.out).toContain('content type "quote" is renamed "pullQuote"')
    expect(existsSync(join(site, 'schema/content-types/quote.toml'))).toBe(false)
    expect(read('schema/content-types/pull-quote.toml')).toContain('alias = "pullQuote"')
    expect(read('schema/data-types/page-blocks.toml')).toContain('element = "pullQuote"')
    expect(read('content/pages/home.toml')).toContain('type = "pullQuote"')
    const page = JSON.parse(cli('types', 'show', 'page', '-o', 'json').out) as { items: number }
    expect(page.items).toBe(1)
    expect(cli('types', 'show', 'pullQuote', '-o', 'json').code).toBe(0)
  })

  test('a data type renamed: refused while properties use it, then renamed with them', () => {
    const refused = cli('types', 'rename', 'pageBlocks', 'sections')
    expect(refused.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('property "blocks"')
    const run = cli('types', 'rename', 'pageBlocks', 'sections', '--everywhere')
    expect(run.code, run.out).toBe(0)
    expect(read('schema/content-types/page.toml')).toContain('type = "sections"')
    expect(read('schema/data-types/sections.toml')).toContain('alias = "sections"')
  })

  test('a dry run writes nothing, and no output names a definition file', () => {
    const before = read('schema/content-types/page.toml')
    const dry = cli('types', 'rename', 'page', 'landing', '--everywhere', '--dry-run')
    expect(dry.code, dry.out).toBe(0)
    expect(dry.out).toContain('Nothing was changed (--dry-run)')
    expect(read('schema/content-types/page.toml')).toBe(before)
    expect(read('components/page.tsx')).toContain("=== 'page'")
    expect(dry.out).not.toMatch(/\.toml|schema\//i)
  })
})
