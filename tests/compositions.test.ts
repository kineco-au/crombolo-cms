/**
 * Story 255: a composed type shows the properties it takes from its
 * compositions, a property whose alias a composition already has is refused
 * everywhere, and `types new` gives a type a title only where it wants one.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  composedProperties,
  type SchemaContentType,
  type SchemaSet,
  validateSchemaSet,
} from '@crombolo/schema'
import { ERROR_KINDS, OUTCOMES } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const prop = (alias: string) => ({
  alias,
  name: alias,
  type: 'textstring',
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
const set = (...contentTypes: SchemaContentType[]): SchemaSet => ({
  version: '1.0.0',
  languages: [],
  contentTypes,
  dataTypes: [],
})

describe('what a type takes from its compositions', () => {
  test('each property once, with the type defining it and the one it comes through', () => {
    const s = set(
      type('meta', { properties: [prop('summary')] }),
      type('contentPage', {
        compositions: ['meta'],
        tabs: [{ name: 'Content', properties: [prop('title')], groups: [] }],
      }),
      type('homePage', { compositions: ['contentPage', 'seoFields'] }),
    )
    const composed = composedProperties(s, s.contentTypes[2] as SchemaContentType)
    expect(composed.map((p) => [p.property.alias, p.from, p.via ?? null, p.tab])).toEqual([
      ['title', 'contentPage', null, 'Content'],
      ['summary', 'meta', 'contentPage', null],
      ...composed
        .filter((p) => p.from === 'seoFields')
        .map((p) => [p.property.alias, 'seoFields', null, p.tab]),
    ])
    expect(composed.some((p) => p.from === 'seoFields')).toBe(true)
  })

  test('an own property, or two compositions, with one alias are refused', () => {
    const own = validateSchemaSet(
      set(
        type('contentPage', { properties: [prop('title')] }),
        type('homePage', { compositions: ['contentPage'], properties: [prop('Title')] }),
      ),
    )
    expect(own).toContainEqual({
      file: 'schema/content-types/homePage',
      path: 'property "Title"',
      message:
        '"contentPage" has a property "Title" already; `crombolo types property remove homePage Title` takes this one away',
    })
    const both = validateSchemaSet(
      set(
        type('a', { properties: [prop('title')] }),
        type('b', { properties: [prop('title')] }),
        type('page', { compositions: ['a', 'b'] }),
      ),
    )
    expect(both.map((p) => p.message)).toContain('"a" and "b" both have a property "title"')
    // One composition reached two ways is not a clash
    const diamond = validateSchemaSet(
      set(
        type('base', { properties: [prop('title')] }),
        type('a', { compositions: ['base'] }),
        type('b', { compositions: ['base'] }),
        type('page', { compositions: ['a', 'b'] }),
      ),
    )
    expect(diamond.filter((p) => p.message.includes('both have'))).toEqual([])
  })
})

describe('the commands', () => {
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
  const shown = (alias: string) =>
    JSON.parse(ok('types', 'show', alias, '-o', 'json').out) as {
      library: boolean
      properties: Array<{ alias: string; tab: string | null; from: string | null }>
    }

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'compositions-'))
    mkdirSync(join(site, 'schema'), { recursive: true })
    writeFileSync(join(site, 'schema/schema.toml'), '[schema]\nversion = "1.0.0"\n')
    ok('types', 'new', 'content-type', 'contentPage', '--name', 'Content page', '--no-view')
    ok('types', 'property', 'add', 'contentPage', 'body', '--type', 'richtext', '--name', 'Body')
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('composed: no title of its own, and show lists what it takes, from where', () => {
    ok('types', 'new', 'content-type', 'homePage', '--at-root', '--compose', 'contentPage')
    const home = shown('homePage')
    expect(home.properties.map((p) => [p.alias, p.tab, p.from])).toEqual([
      ['title', 'Content', 'contentPage'],
      ['body', 'Content', 'contentPage'],
    ])
    const text = ok('types', 'show', 'homePage').out
    expect(text).toContain('from contentPage')
    expect(text).not.toContain('No properties')
  }, 60_000)

  test('a clash is refused by property add, by update --compose and by a hand edit', () => {
    const added = cli('types', 'property', 'add', 'homePage', 'body', '--type', 'textarea')
    expect(added.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(added.out).toContain('"contentPage" has a property "body" already')

    ok('types', 'new', 'content-type', 'note', '--no-view')
    const composed = cli('types', 'update', 'note', '--compose', 'contentPage')
    expect(composed.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(composed.out).toContain('its property "title": "contentPage" has a property "title"')

    const file = join(site, 'schema/content-types/home-page.toml')
    const before = readFileSync(file, 'utf8')
    writeFileSync(
      file,
      `${before}\n[[property]]\nalias = "body"\nname = "Body"\ntype = "textarea"\n`,
    )
    try {
      const checked = cli('types', 'check')
      expect(checked.code).toBe(OUTCOMES.problems_found.code)
      expect(checked.out).toContain('`crombolo types property remove homePage body`')
      expect(cli('types', 'sync').code).toBe(ERROR_KINDS.refused.exitCode)
    } finally {
      writeFileSync(file, before)
    }
    ok('types', 'sync')
  }, 60_000)

  test('--no-title, and an element type that starts with nothing', () => {
    ok('types', 'new', 'content-type', 'bare', '--no-title', '--no-view')
    expect(shown('bare').properties).toEqual([])
    ok('types', 'new', 'content-type', 'quote', '--element', '--no-view')
    const quote = shown('quote')
    expect(quote.properties).toEqual([])
    expect(quote.library).toBe(false)
    ok('types', 'new', 'content-type', 'card', '--element', '--title', '--library', '--no-view')
    const card = shown('card')
    expect(card.properties.map((p) => p.alias)).toEqual(['title'])
    expect(card.library).toBe(true)
  }, 60_000)
})
