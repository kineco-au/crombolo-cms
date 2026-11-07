/**
 * Story 253: pages written from the command line. Block aliases on their own —
 * a view's `byAlias`, the check a save makes — then `content new`, `content
 * update`, `content show` and `content block` through the CLI on a SQLite site,
 * and a page they made exported to a content file and read back.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deliveryValue, type OutputContext } from '@crombolo/api-delivery'
import { duplicateBlockAlias } from '@crombolo/content'
import { type BlockListValue, convertValue } from '@crombolo/render'
import { seedKey } from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import { bootServer, ORIGIN } from './support/harness.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')

const blockValue = (...aliases: Array<string | undefined>) => ({
  layout: {
    'Umbraco.BlockList': aliases.map((alias, i) => ({
      contentKey: `k${i}`,
      ...(alias ? { alias } : {}),
    })),
  },
  contentData: aliases.map((_, i) => ({ key: `k${i}`, contentTypeKey: 't', values: [] })),
})

describe('block aliases', () => {
  test('a view picks a block out by its alias, in any case', () => {
    const list = convertValue('Umbraco.BlockList', blockValue('hero', undefined, 'footer'), {
      content: () => undefined,
      urlOf: () => '',
      contentTypeAlias: () => 'quote',
    }) as BlockListValue
    expect(list.map((b) => b.alias)).toEqual(['hero', null, 'footer'])
    expect(list.byAlias('Footer')?.contentKey).toBe('k2')
    expect(list.byAlias('nothing')).toBeUndefined()
  })

  test('the Delivery API gives a block its alias, only where it has one', async () => {
    const stored = blockValue('hero', undefined)
    const converted = convertValue('Umbraco.BlockList', stored, {
      content: () => undefined,
      urlOf: () => '',
      contentTypeAlias: () => 'quote',
    })
    const ctx = {
      route: () => undefined,
      content: () => undefined,
      allowedType: () => true,
      access: () => 'full',
    } as unknown as OutputContext
    const out = (await deliveryValue(
      {
        alias: 'blocks',
        editorAlias: 'Umbraco.BlockList',
        culture: null,
        segment: null,
        value: stored,
      },
      converted,
      ctx,
      undefined,
      undefined,
    )) as { items: Array<{ alias?: string }> }
    expect(out.items.map((i) => i.alias)).toEqual(['hero', undefined])
  })

  test('a save is refused when two blocks of one list share an alias', () => {
    const value = (v: unknown) => [{ alias: 'blocks', culture: null, segment: null, value: v }]
    expect(duplicateBlockAlias(value(blockValue('hero', 'footer')))).toBeUndefined()
    expect(duplicateBlockAlias(value(blockValue('hero', 'Hero')))).toEqual({
      property: 'blocks',
      alias: 'Hero',
    })
  })
})

describe('the commands, on a site with page types and a block list', () => {
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
  type Shown = {
    key: string
    variants: Array<{ name: string; state: string }>
    values: Array<{ property: string; value: unknown }>
  }
  const shown = (page: string) => JSON.parse(ok('content', 'show', page, '-o', 'json').out) as Shown
  const valueIn = (page: string, property: string) =>
    shown(page).values.find((v) => v.property === property)?.value
  const blocksOf = (page: string) =>
    (valueIn(page, 'blocks') ?? []) as Array<{
      type: string
      alias?: string
      key: string
      values: Record<string, unknown>
    }>

  beforeAll(() => {
    site = mkdtempSync(join(process.cwd(), 'output', 'content-pages-'))
    const files: Record<string, string> = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/highlight.toml':
        '[content-type]\nalias = "highlight"\nname = "Highlight"\nis-element = true\n\n[[property]]\nalias = "heading"\nname = "Heading"\ntype = "textstring"\n\n[[property]]\nalias = "detail"\nname = "Detail"\ntype = "textarea"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\nallow-children = ["page"]\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n\n[[property]]\nalias = "body"\nname = "Body"\ntype = "richtext"\n\n[[property]]\nalias = "related"\nname = "Related"\ntype = "contentPicker"\n\n[[property]]\nalias = "featured"\nname = "Featured"\ntype = "trueFalse"\n\n[[property]]\nalias = "blocks"\nname = "Blocks"\ntype = "pageBlocks"\n',
      'schema/content-types/note.toml':
        '[content-type]\nalias = "note"\nname = "Note"\ncomponents = ["page"]\ndefault-component = "page"\n',
      'schema/data-types/page-blocks.toml':
        '[data-type]\nalias = "pageBlocks"\nname = "Page blocks"\neditor = "Umbraco.BlockList"\n\n[[data-type.block]]\nelement = "highlight"\n',
      'components/page.tsx':
        "export default ({ model }) => <main><h1>{model.text('title')}</h1><p>{model.value('blocks')?.byAlias?.('sourdough')?.content.text('heading')}</p></main>\n",
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(site, path, '..'), { recursive: true })
      writeFileSync(join(site, path), body)
    }
    ok('types', 'sync')
  }, 120_000)
  afterAll(() => rmSync(site, { recursive: true, force: true }))

  test('a page made with its values, a draft, with the key its content file would have', () => {
    const made = ok(
      'content',
      'new',
      '/Home',
      '--type',
      'page',
      '--set',
      'title=Welcome',
      '--set',
      'body=Bread, **daily**.',
      '--set',
      'featured=true',
      '-o',
      'json',
    )
    expect(JSON.parse(made.out).key).toBe(seedKey('content/home'))
    const home = shown('/Home')
    expect(home.variants).toEqual([{ culture: null, name: 'Home', state: 'Draft' } as never])
    expect(valueIn('/Home', 'title')).toBe('Welcome')
    expect(valueIn('/Home', 'body')).toEqual({
      html: '<p>Bread, <strong>daily</strong>.</p>\n',
    })
    expect(valueIn('/Home', 'featured')).toBe(true)
  }, 30_000)

  test('a page under another, a picked page by its path, and --publish', () => {
    // Not while the page above it is a draft: nothing is made.
    const early = cli('content', 'new', '/Home/Visit us', '--type', 'page', '--publish')
    expect(early.code).toBe(ERROR_KINDS.refused.exitCode)
    ok('content', 'publish', '/Home')
    ok('content', 'new', '/Home/Visit us', '--type', 'page', '--set', 'related=/Home', '--publish')
    expect(valueIn('/Home/Visit us', 'related')).toBe('/Home')
    expect(shown('/Home/Visit us').variants[0]?.state).toBe('Published')
  }, 30_000)

  test('refused, with nothing made: a taken name, a place the type is not allowed, a bad value', () => {
    const refused = ERROR_KINDS.refused.exitCode
    expect(cli('content', 'new', '/Home/Visit us', '--type', 'page').code).toBe(refused)
    const placed = cli('content', 'new', '/Home/Aside', '--type', 'note')
    expect(placed.code).toBe(refused)
    expect(placed.out).toContain('--allow-child note')
    const bad = cli('content', 'new', '/Home/Gone', '--type', 'page', '--set', 'related=/Nowhere')
    expect(bad.code).toBe(refused)
    expect(bad.out).toContain('"/Nowhere" is not a page')
    expect(cli('content', 'new', '/Home/Gone', '--type', 'page', '--set', 'nope=1').code).toBe(
      refused,
    )
    const found = JSON.parse(ok('content', 'find', '-o', 'json').out) as { total: number }
    expect(found.total).toBe(2)
  }, 30_000)

  test('values changed and taken away, and the name; a dry run changes nothing', () => {
    ok('content', 'update', '/Home', '--set', 'title=Hello', '--unset', 'featured')
    expect(valueIn('/Home', 'title')).toBe('Hello')
    expect(valueIn('/Home', 'featured')).toBeUndefined()
    ok('content', 'update', '/Home', '--set', 'title=Not this', '--dry-run')
    expect(valueIn('/Home', 'title')).toBe('Hello')
    const draft = cli('content', 'update', '/Home', '--set', 'body=x', '--culture', 'fr-FR')
    expect(draft.code).toBe(ERROR_KINDS.refused.exitCode)
  }, 30_000)

  test('blocks added, named, changed, moved and taken off, each by its alias or key', () => {
    ok(
      'content',
      'block',
      'add',
      '/Home',
      'blocks',
      '--type',
      'highlight',
      '--alias',
      'sourdough',
      '--set',
      'heading=Sourdough',
    )
    const rye = JSON.parse(
      ok(
        'content',
        'block',
        'add',
        '/Home',
        'blocks',
        '--type',
        'highlight',
        '--first',
        '-o',
        'json',
      ).out,
    ) as { block: { key: string } }
    expect(blocksOf('/Home').map((b) => b.alias ?? b.key)).toEqual([rye.block.key, 'sourdough'])

    ok(
      'content',
      'block',
      'update',
      '/Home',
      'blocks',
      rye.block.key,
      '--alias',
      'rye',
      '--set',
      'heading=Rye',
    )
    ok('content', 'block', 'move', '/Home', 'blocks', 'rye', '--after', 'sourdough')
    ok('content', 'block', 'update', '/Home', 'blocks', 'Sourdough', '--set', 'detail=Three days.')
    expect(blocksOf('/Home')).toEqual([
      {
        type: 'highlight',
        alias: 'sourdough',
        key: expect.any(String),
        values: { heading: 'Sourdough', detail: 'Three days.' },
      },
      { type: 'highlight', alias: 'rye', key: rye.block.key, values: { heading: 'Rye' } },
    ])

    ok('content', 'block', 'remove', '/Home', 'blocks', 'rye')
    expect(blocksOf('/Home').map((b) => b.alias)).toEqual(['sourdough'])
  }, 30_000)

  test('a block refused: an alias another block has, a type the list does not offer, one not there', () => {
    const add = (...more: string[]) =>
      cli('content', 'block', 'add', '/Home', 'blocks', '--type', 'highlight', ...more)
    expect(add('--alias', 'SOURDOUGH').code).toBe(ERROR_KINDS.refused.exitCode)
    expect(add('--alias', '2nd').code).toBe(ERROR_KINDS.usage.exitCode)
    expect(cli('content', 'block', 'add', '/Home', 'blocks', '--type', 'page').code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
    expect(cli('content', 'block', 'remove', '/Home', 'blocks', 'nothing').code).toBe(
      ERROR_KINDS.not_found.exitCode,
    )
    expect(cli('content', 'block', 'add', '/Home', 'title', '--type', 'highlight').code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
  }, 30_000)

  test('exported as a content file, aliases and all, and read back the same', () => {
    ok('bundle', 'export', '--source', '--root', '/Home')
    const file = readFileSync(join(site, 'content/pages/home.toml'), 'utf8')
    expect(file).toContain('alias = "sourdough"')
    expect(file).not.toMatch(/^key = /m)
    ok('content', 'block', 'update', '/Home', 'blocks', 'sourdough', '--set', 'heading=Changed')
    // Changed here since: the file wins only when told to.
    expect(cli('bundle', 'apply').code).toBe(ERROR_KINDS.refused.exitCode)
    ok('bundle', 'apply', '--resolve-all=take-bundle')
    expect(blocksOf('/Home')[0]).toMatchObject({
      alias: 'sourdough',
      values: { heading: 'Sourdough' },
    })
  }, 30_000)

  test('published, the page renders, its view picking its block out by alias', async () => {
    ok('content', 'publish', '/Home')
    const server = await bootServer({
      keepDatabase: true,
      config: {
        dialect: 'sqlite',
        sqliteFile: join(site, 'site.sqlite'),
        siteDir: site,
        schemaDir: join(site, 'schema'),
        componentsDir: join(site, 'components'),
        development: true,
      },
    })
    try {
      const html = await (await server.fetch(new Request(`${ORIGIN}/`))).text()
      expect(html).toContain('<h1>Hello</h1>')
      expect(html).toContain('<p>Sourdough</p>')
    } finally {
      await server.close()
    }
  }, 30_000)

  test('a content file whose blocks share an alias is refused', () => {
    writeFileSync(
      join(site, 'content/pages/twice.toml'),
      'type = "page"\n\n[values]\nblocks = [\n  { type = "highlight", alias = "a", values = { heading = "1" } },\n  { type = "highlight", alias = "A", values = { heading = "2" } },\n]\n',
    )
    const run = cli('bundle', 'apply')
    expect(run.code).not.toBe(0)
    expect(run.out).toContain('two blocks are called "A"')
    rmSync(join(site, 'content/pages/twice.toml'))
  }, 30_000)
})
