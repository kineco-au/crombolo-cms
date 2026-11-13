/**
 * Story 345: the Single Block saves, renders, types and travels as a Block List
 * does, as one block rather than a list of one.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deliveryValue, type OutputContext } from '@crombolo/api-delivery'
import { duplicateBlockAlias } from '@crombolo/content'
import { toEditorValue } from '@crombolo/core'
import { valueText } from '@crombolo/data'
import { type BlockItem, Blocks, convertValue } from '@crombolo/render'
import {
  generateDeliveryTypes,
  generateTypes,
  loadSchemaDirectory,
  validateSchemaSet,
} from '@crombolo/schema'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const SINGLE = 'Umbraco.SingleBlock'

const single = (heading?: string) =>
  heading === undefined
    ? { layout: { [SINGLE]: [] }, contentData: [], settingsData: [] }
    : {
        layout: { [SINGLE]: [{ contentKey: 'c1', alias: 'hero' }] },
        contentData: [
          {
            key: 'c1',
            contentTypeKey: 'hero-type',
            values: [{ alias: 'heading', editorAlias: 'Umbraco.TextBox', value: heading }],
          },
        ],
        settingsData: [],
      }

const context = { content: () => undefined, urlOf: () => '', contentTypeAlias: () => 'hero' }

describe('a Single Block value (story 345)', () => {
  test('is parsed when stored, and reads as one block, or null when empty', () => {
    const stored = JSON.stringify(single('Fresh bread'))
    expect(toEditorValue(SINGLE, stored)).toEqual(single('Fresh bread'))
    const block = convertValue(SINGLE, single('Fresh bread'), context) as BlockItem
    expect(block.alias).toBe('hero')
    expect(block.content.value('heading')).toBe('Fresh bread')
    expect(convertValue(SINGLE, single(), context)).toBeNull()
  })

  test('renders through <Blocks>, one block or nothing', async () => {
    const block = convertValue(SINGLE, single('Fresh bread'), context) as BlockItem
    const components = {
      hero: ({ content }: { content: BlockItem['content'] }) => String(content.value('heading')),
    }
    expect((await Blocks({ items: block, components })).value).toBe('Fresh bread')
    expect((await Blocks({ items: null, components })).value).toBe('')
  })

  test('the Delivery API gives one item, or null', async () => {
    const ctx = {
      route: () => undefined,
      content: () => undefined,
      allowedType: () => true,
      access: () => 'full',
    } as unknown as OutputContext
    const out = async (value: unknown) =>
      deliveryValue(
        { alias: 'hero', editorAlias: SINGLE, culture: null, segment: null, value },
        convertValue(SINGLE, value, context),
        ctx,
        undefined,
        undefined,
      )
    expect(await out(single('Fresh bread'))).toMatchObject({
      content: { contentType: 'hero', properties: { heading: 'Fresh bread' } },
      alias: 'hero',
    })
    expect(await out(single())).toBeNull()
  })

  test('its text is indexed for search, as a list’s is', () => {
    expect(valueText(JSON.stringify(single('Fresh bread')))).toEqual(['Fresh bread'])
  })

  test('two of its blocks may not share an alias, as two of a list’s may not', () => {
    const twice = {
      layout: {
        [SINGLE]: [
          { contentKey: 'a', alias: 'x' },
          { contentKey: 'b', alias: 'X' },
        ],
      },
    }
    expect(
      duplicateBlockAlias([{ alias: 'hero', culture: null, segment: null, value: twice }]),
    ).toEqual({ property: 'hero', alias: 'X' })
  })
})

describe('a Single Block in the schema (story 345)', () => {
  let dir: string
  beforeAll(() => {
    mkdirSync(join(ROOT, 'output'), { recursive: true })
    dir = mkdtempSync(join(ROOT, 'output', 'single-block-schema-'))
    const files: Record<string, string> = {
      'schema.toml': '[schema]\nversion = "1.0.0"\n',
      'content-types/hero.toml':
        '[content-type]\nalias = "hero"\nname = "Hero"\nis-element = true\n\n[[property]]\nalias = "heading"\nname = "Heading"\ntype = "textstring"\n',
      'content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\n\n[[property]]\nalias = "hero"\nname = "Hero"\ntype = "heroBlock"\n',
      'data-types/hero-block.toml':
        '[data-type]\nalias = "heroBlock"\nname = "Hero block"\neditor = "Umbraco.SingleBlock"\n\n[[data-type.block]]\nelement = "hero"\n',
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), body)
    }
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('is typed by `generate` and `generate --delivery` as one block or null', () => {
    const { set } = loadSchemaDirectory(dir)
    expect(generateTypes(set)).toContain(
      '"hero"?: (BlockItem & { content: TypedElement<Hero>; settings: PublishedElement | null }) | null',
    )
    expect(generateDeliveryTypes(set)).toContain(
      'hero: ApiBlockListItem<ApiElement<"hero", HeroProperties>, Element> | null\n',
    )
  })

  test('its element types are checked as its data type’s references', () => {
    const { set } = loadSchemaDirectory(dir)
    expect(validateSchemaSet(set)).toEqual([])
    const notElement = {
      ...set,
      contentTypes: set.contentTypes.map((t) =>
        t.alias === 'hero' ? { ...t, isElement: false } : t,
      ),
    }
    expect(validateSchemaSet(notElement).map((p) => p.message)).toContain(
      '"hero" is not an element type',
    )
  })
})

describe('a Single Block from the command line and in content files (story 345)', () => {
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
  const heroOf = (page: string) =>
    (
      JSON.parse(ok('content', 'show', page, '-o', 'json').out) as {
        values: Array<{ property: string; value: unknown }>
      }
    ).values.find((v) => v.property === 'hero')?.value as
      | { type: string; alias?: string; values: Record<string, unknown> }
      | null
      | undefined
  const add = (...more: string[]) =>
    ok('content', 'block', 'add', '/Home', 'hero', '--type', 'hero', ...more)

  beforeAll(() => {
    site = mkdtempSync(join(ROOT, 'output', 'single-block-site-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/hero.toml':
        '[content-type]\nalias = "hero"\nname = "Hero"\nis-element = true\n\n[[property]]\nalias = "heading"\nname = "Heading"\ntype = "textstring"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\n\n[[property]]\nalias = "hero"\nname = "Hero"\ntype = "heroBlock"\n\n[[property]]\nalias = "grid"\nname = "Grid"\ntype = "heroGrid"\n',
      'schema/data-types/hero-grid.toml':
        '[data-type]\nalias = "heroGrid"\nname = "Hero grid"\neditor = "Umbraco.BlockGrid"\n\n[[data-type.block]]\nelement = "hero"\n',
      'schema/data-types/hero-block.toml':
        '[data-type]\nalias = "heroBlock"\nname = "Hero block"\neditor = "Umbraco.SingleBlock"\n\n[[data-type.block]]\nelement = "hero"\n',
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(site, path, '..'), { recursive: true })
      writeFileSync(join(site, path), body)
    }
    ok('types', 'sync')
    ok('content', 'new', '/Home', '--type', 'page')
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('add puts one block there, and adding again replaces it', () => {
    add('--set', 'heading=First')
    expect(heroOf('/Home')).toMatchObject({ type: 'hero', values: { heading: 'First' } })
    add('--alias', 'banner', '--set', 'heading=Second')
    expect(heroOf('/Home')).toMatchObject({ alias: 'banner', values: { heading: 'Second' } })
  }, 60_000)

  test('update changes it, move is refused, remove takes it off', () => {
    ok('content', 'block', 'update', '/Home', 'hero', 'banner', '--set', 'heading=Third')
    expect(heroOf('/Home')).toMatchObject({ values: { heading: 'Third' } })
    const moved = cli('content', 'block', 'move', '/Home', 'hero', 'banner', '--first')
    expect(moved.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(moved.out).toContain('holds one block')
    ok('content', 'block', 'remove', '/Home', 'hero', 'banner')
    expect(heroOf('/Home') ?? null).toBeNull()
  }, 60_000)

  test('a content file writes it as one block, not a list, and reads it back', () => {
    add('--alias', 'banner', '--set', 'heading=Exported')
    ok('content', 'export', '--root', '/Home')
    const file = readFileSync(join(site, 'content/pages/home.toml'), 'utf8')
    expect(file).toMatch(/hero = \{/)
    expect(file).not.toMatch(/hero = \[/)
    ok('content', 'block', 'update', '/Home', 'hero', 'banner', '--set', 'heading=Changed')
    ok('site', 'apply', '--resolve-all=take-bundle')
    expect(heroOf('/Home')).toMatchObject({ alias: 'banner', values: { heading: 'Exported' } })
  }, 60_000)

  test('a content file holding two blocks for it is refused', () => {
    writeFileSync(
      join(site, 'content/pages/twice.toml'),
      'type = "page"\n\n[values]\nhero = [\n  { type = "hero", values = { heading = "1" } },\n  { type = "hero", values = { heading = "2" } },\n]\n',
    )
    const run = cli('site', 'apply')
    expect(run.code).not.toBe(0)
    expect(run.out).toContain('a Single Block holds one block')
    rmSync(join(site, 'content/pages/twice.toml'))
  }, 60_000)

  test('a grid block’s areas are written and read back as blocks of their own', () => {
    writeFileSync(
      join(site, 'content/pages/grid.toml'),
      'type = "page"\n\n[values]\ngrid = [\n  { type = "hero", values = { heading = "Outer" }, areas = [ { key = "main", blocks = [ { type = "hero", values = { heading = "Inner" } } ] } ] },\n]\n',
    )
    ok('site', 'apply')
    const shown = JSON.parse(ok('content', 'show', '/Grid', '-o', 'json').out) as {
      values: Array<{ property: string; value: unknown }>
    }
    expect(shown.values.find((v) => v.property === 'grid')?.value).toMatchObject([
      {
        type: 'hero',
        values: { heading: 'Outer' },
        areas: [{ key: 'main', blocks: [{ type: 'hero', values: { heading: 'Inner' } }] }],
      },
    ])
  }, 60_000)
})
