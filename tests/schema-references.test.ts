/**
 * Story 161: data types name types by alias, in their config and as
 * `[[data-type.block]]` tables. Sync resolves the aliases to the keys each
 * editor reads, `types check` refuses one that names nothing, and export writes
 * aliases and tables back.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashPassword, passwordConfigJson } from '@crombolo/auth'
import {
  ContentTypeRepository,
  DataTypeRepository,
  type Db,
  seedContent,
  seedIdentity,
} from '@crombolo/data'
import {
  aliasConfig,
  compileBlocks,
  decompileBlocks,
  exportSchemaSet,
  loadSchemaDirectory,
  parseDataType,
  resolveConfig,
  syncSchema,
  typeKeyFor,
  validateSchemaSet,
  writeDataType,
} from '@crombolo/schema'
import { dialectUnderTest, migratedDb } from './support/db.ts'

const open: Db[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

async function prepared(): Promise<Db> {
  const db = await migratedDb()
  open.push(db)
  await seedIdentity(db, {
    admin: { name: 'A', login: 'a@b.c', email: 'a@b.c', password: 'x' },
    hashPassword,
    passwordConfig: passwordConfigJson(),
  })
  await seedContent(db)
  return db
}

function schemaDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-references-'))
  dirs.push(dir)
  for (const sub of ['content-types', 'data-types', 'media-types'])
    mkdirSync(join(dir, sub), { recursive: true })
  writeFileSync(join(dir, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source)
  return dir
}

const ELEMENT = (alias: string) => `[content-type]
alias = "${alias}"
name = "${alias}"
is-element = true

[[property]]
alias = "heading"
name = "Heading"
type = "textstring"
`

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
`

const key = (alias: string) => typeKeyFor('document', alias)
const lookup = (alias: string) =>
  ['feature', 'quote', 'page'].includes(alias) ? key(alias) : undefined

describe('aliases in config', () => {
  test('every editor that names types resolves an alias to the key it reads', () => {
    expect(
      resolveConfig('Umbraco.ElementPicker', { allowedContentTypes: ['feature', 'quote'] }, lookup)
        .config,
    ).toEqual({ allowedContentTypes: `${key('feature')},${key('quote')}` })
    // A key is a key already, and passes through; a comma string reads as a list.
    const legacy = '2e4e319f-2627-43da-8200-27d6197aced7'
    expect(
      resolveConfig('Umbraco.ElementPicker', { allowedContentTypes: `feature, ${legacy}` }, lookup)
        .config,
    ).toEqual({ allowedContentTypes: `${key('feature')},${legacy}` })
    expect(
      resolveConfig('Umbraco.MediaPicker3', { filter: ['Image'] }, (a, kind) =>
        kind === 'media' && a === 'Image' ? 'image-key' : undefined,
      ).config,
    ).toEqual({ filter: 'image-key' })
    expect(
      resolveConfig(
        'Umbraco.MultiNodeTreePicker',
        { startNode: { type: 'content' }, filter: ['page'] },
        (a, kind) => (kind === 'document' ? lookup(a) : undefined),
      ).config.filter,
    ).toBe(key('page'))
    expect(
      resolveConfig(
        'Umbraco.BlockGrid',
        {
          blocks: [
            {
              contentElementTypeKey: 'feature',
              areas: [{ alias: 'main', specifiedAllowance: [{ elementTypeKey: 'quote' }] }],
            },
          ],
        },
        lookup,
      ).config,
    ).toEqual({
      blocks: [
        {
          contentElementTypeKey: key('feature'),
          areas: [{ alias: 'main', specifiedAllowance: [{ elementTypeKey: key('quote') }] }],
        },
      ],
    })
  })

  test('what it cannot resolve is reported with its path, and export writes keys as aliases', () => {
    const { problems } = resolveConfig(
      'Umbraco.ElementPicker',
      { allowedContentTypes: ['feature', 'nothing'] },
      lookup,
    )
    expect(problems).toEqual([{ path: 'allowedContentTypes', alias: 'nothing', kind: 'element' }])
    const reverse = (k: string) => (k === key('feature') ? 'feature' : undefined)
    expect(
      aliasConfig('Umbraco.ElementPicker', { allowedContentTypes: key('feature') }, reverse),
    ).toEqual({ allowedContentTypes: ['feature'] })
  })

  test('types check names an unknown alias, a non-element, and the wrong kind', () => {
    const dir = schemaDir({
      'content-types/feature.toml': ELEMENT('feature'),
      'content-types/page.toml': PAGE,
      'data-types/picker.toml':
        '[data-type]\nalias = "picker"\nname = "Picker"\neditor = "Umbraco.ElementPicker"\n\n[data-type.config]\nallowedContentTypes = ["feature", "page", "nothing"]\n',
      'data-types/images.toml':
        '[data-type]\nalias = "images"\nname = "Images"\neditor = "Umbraco.MediaPicker3"\n\n[data-type.config]\nfilter = ["page"]\n',
    })
    const loaded = loadSchemaDirectory(dir)
    const problems = validateSchemaSet(loaded.set).map((p) => `${p.file} ${p.path}: ${p.message}`)
    expect(problems).toContain(
      'schema/data-types/picker data-type.config.allowedContentTypes: "page" is not an element type',
    )
    expect(problems).toContain(
      'schema/data-types/picker data-type.config.allowedContentTypes: unknown element type "nothing"',
    )
    expect(problems).toContain(
      'schema/data-types/images data-type.config.filter: unknown media type "page"',
    )
  })
})

describe('block tables', () => {
  const TABLES = `[data-type]
alias = "pageBlocks"
name = "Page blocks"
editor = "Umbraco.BlockGrid"

[data-type.config]
validationLimit = { min = 1 }

[[data-type.block]]
element = "feature"
settings = "quote"
label = "{{heading}}"
size = "medium"
group = "Layout"
column-spans = [6, 12]

[[data-type.block.area]]
alias = "main"
column-span = 12
allow = ["quote", { group = "Layout", max = 2 }]

[[data-type.block]]
element = "quote"
group = "Layout"
`

  test('compile into the config the grid reads, groups and areas keyed the same everywhere', () => {
    const parsed = parseDataType('page-blocks', TABLES)
    expect(parsed.problems).toEqual([])
    const dataType = parsed.value
    if (!dataType?.blocks) throw new Error('no blocks parsed')
    const { config, problems } = compileBlocks('dt-key', dataType.blocks, lookup)
    expect(problems).toEqual([])
    const again = compileBlocks('dt-key', dataType.blocks, lookup).config
    expect(again).toEqual(config)
    const groups = config.blockGroups as Array<{ key: string; name: string }>
    expect(groups.map((g) => g.name)).toEqual(['Layout'])
    const blocks = config.blocks as Array<Record<string, unknown>>
    expect(blocks[0]).toMatchObject({
      contentElementTypeKey: key('feature'),
      settingsElementTypeKey: key('quote'),
      label: '{{heading}}',
      editorSize: 'medium',
      groupKey: groups[0]?.key,
      columnSpanOptions: [{ columnSpan: 6 }, { columnSpan: 12 }],
      areas: [
        {
          alias: 'main',
          columnSpan: 12,
          specifiedAllowance: [
            { elementTypeKey: key('quote') },
            { groupKey: groups[0]?.key, maxAllowed: 2 },
          ],
        },
      ],
    })
    // And back to tables, the same as written.
    const reverse = (k: string) =>
      ['feature', 'quote'].find((alias) => key(alias) === k.toLowerCase())
    expect(decompileBlocks(config, reverse)).toEqual(dataType.blocks)
  })

  test('nested config and tables survive a rewrite as TOML, not as JSON strings', () => {
    const dataType = parseDataType('page-blocks', TABLES).value
    if (!dataType) throw new Error('no data type')
    const written = writeDataType(dataType)
    expect(written).toContain('validationLimit = { min = 1 }')
    expect(written).toContain('[[data-type.block]]')
    expect(written).toContain('[[data-type.block.area]]')
    expect(parseDataType('page-blocks', written).value).toEqual(dataType)
  })

  test('raw config.blocks beside block tables is refused', () => {
    const both = TABLES.replace(
      'validationLimit = { min = 1 }',
      'validationLimit = { min = 1 }\nblocks = []',
    )
    expect(parseDataType('page-blocks', both).problems.map((p) => p.message)).toContain(
      'give blocks as [[data-type.block]] tables or as config.blocks, not both',
    )
  })
})

describe(`syncing aliases (${dialectUnderTest})`, () => {
  test('a data type naming a type this same change adds resolves it, and export writes it back', async () => {
    const db = await prepared()
    const dir = schemaDir({
      'content-types/feature.toml': ELEMENT('feature'),
      'content-types/quote.toml': ELEMENT('quote'),
      'data-types/picker.toml':
        '[data-type]\nalias = "picker"\nname = "Picker"\neditor = "Umbraco.ElementPicker"\n\n[data-type.config]\nallowedContentTypes = ["feature"]\n',
      'data-types/blocks.toml':
        '[data-type]\nalias = "blocks"\nname = "Blocks"\neditor = "Umbraco.BlockList"\n\n[[data-type.block]]\nelement = "quote"\nlabel = "Quote"\n',
    })
    const report = await syncSchema(
      db,
      loadSchemaDirectory(dir),
      { nodeId: 'n', version: '1.0.0', revision: '1' },
      { mode: 'production' },
    )
    expect(report.action).toBe('applied')
    const featureKey = (await new ContentTypeRepository(db).byAlias('feature'))?.key as string
    const picker = await new DataTypeRepository(db).byAlias('picker')
    expect(picker?.values.find((v) => v.alias === 'allowedContentTypes')?.value).toBe(featureKey)
    const blocks = await new DataTypeRepository(db).byAlias('blocks')
    expect(blocks?.values.find((v) => v.alias === 'blocks')?.value).toEqual([
      {
        contentElementTypeKey: (await new ContentTypeRepository(db).byAlias('quote'))?.key,
        label: 'Quote',
      },
    ])

    const exported = await exportSchemaSet(db, '1.0.0')
    const pickerFile = exported.dataTypes.find((d) => d.alias === 'picker')
    expect(pickerFile?.config).toEqual({ allowedContentTypes: ['feature'] })
    const blocksFile = exported.dataTypes.find((d) => d.alias === 'blocks')
    expect(blocksFile?.blocks).toEqual([{ element: 'quote', label: 'Quote' }])
    expect(blocksFile?.config.blocks).toBeUndefined()
  })
})
