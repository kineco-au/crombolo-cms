/**
 * Story 163: a site's starting content as seed files — compiled against the
 * site's schema into the bundle format, and applied through the import.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { ObjectTypes } from '@crombolo/core'
import { DocumentRepository, NodeRepository, resolveNodeRef } from '@crombolo/data'
import {
  compileSeed,
  exportSeed,
  installBundleContent,
  lineOf,
  MediaFileStore,
  pickKey,
  type SeedBuild,
  seedKey,
} from '@crombolo/server'
import type { BundleNode } from '@crombolo/transfer'
import { writeSeedPackage } from '../packages/cli/src/support/seed.ts'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const CARD_KEY = '7c2e9a14-5b3d-4f61-8e27-1a9d4c6b2e01'
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

const SCHEMA: Record<string, string> = {
  'schema.toml': '[schema]\nversion = "1.0.0"\n',
  'languages.toml':
    '[[language]]\niso = "en-US"\nname = "English"\ndefault = true\n\n[[language]]\niso = "fr-FR"\nname = "French"\n',
  'data-types/card-picker.toml': `[data-type]
alias = "cardPicker"
name = "Card Picker"
editor = "Umbraco.ElementPicker"
editor-ui = "Umb.PropertyEditorUi.ElementPicker"
config = { allowedContentTypes = "${CARD_KEY}" }
`,
  'data-types/card-blocks.toml': `[data-type]
alias = "cardBlocks"
name = "Card Blocks"
editor = "Umbraco.BlockList"
editor-ui = "Umb.PropertyEditorUi.BlockList"
config = { blocks = [{ contentElementTypeKey = "${CARD_KEY}" }] }
`,
  'content-types/card.toml': `[content-type]
key = "${CARD_KEY}"
alias = "card"
name = "Card"
is-element = true
allow-in-library = true

[[property]]
alias = "heading"
name = "Heading"
type = "textstring"
`,
  'content-types/page.toml': `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"

[[property]]
alias = "body"
name = "Body"
type = "richtext"

[[property]]
alias = "related"
name = "Related"
type = "contentPicker"

[[property]]
alias = "hero"
name = "Hero"
type = "imageMediaPicker"

[[property]]
alias = "keywords"
name = "Keywords"
type = "tags"

[[property]]
alias = "featured"
name = "Featured"
type = "trueFalse"

[[property]]
alias = "rank"
name = "Rank"
type = "numeric"

[[property]]
alias = "links"
name = "Links"
type = "multiUrlPicker"

[[property]]
alias = "card"
name = "Card"
type = "cardPicker"

[[property]]
alias = "cards"
name = "Cards"
type = "cardBlocks"
`,
  'content-types/localised.toml': `[content-type]
alias = "localised"
name = "Localised"
allow-at-root = true
varies-by-culture = true
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
varies-by-culture = true
`,
}

const SEED: Record<string, string | Buffer> = {
  'content/home.toml': `type = "page"
name = "Home"

[values]
title = "Welcome"
body = "Read [about us](/home/about), or **not**."
keywords = ["whisky", "harbour"]
featured = true
rank = 3
hero = "/logos/mark.png"
links = ["/home/about", { url = "https://example.com", name = "Example" }]
card = "hero-card"
cards = [{ type = "card", values = { heading = "One" } }]
`,
  'content/home/about.toml': `type = "page"
order = 2

[values]
title = "About us"
related = "/home"
`,
  'content/home/contact.toml': `type = "page"
order = 1
published = false
`,
  'content/bonjour.toml': `type = "localised"
name = { "en-US" = "Hello", "fr-FR" = "Bonjour" }

[values.en-US]
title = "Hello"

[values.fr-FR]
title = "Bonjour"
`,
  'library/hero-card.toml': 'type = "card"\n\n[values]\nheading = "The hero"\n',
  'media/logos/mark.png': PIXEL,
  'media/logos/mark.png.toml': 'name = "Mark"\nfocalPoint = { left = 0.5, top = 0.25 }\n',
}

function write(root: string, files: Record<string, string | Buffer>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
}

async function site(seed: Record<string, string | Buffer> = SEED) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'seed-'))
  dirs.push(root)
  write(join(root, 'schema'), SCHEMA)
  write(join(root, 'seed'), seed)
  write(root, { 'components/page.tsx': 'export default () => <main />\n' })
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
    },
  })
  open.push(h)
  const docs = new DocumentRepository(h.server.db, { nodeState: h.server.schema.nodeState })
  const compile = () => compileSeed(h.server.db, h.server.config)
  const apply = async (build: SeedBuild, options: Record<string, unknown> = {}) => {
    const dir = mkdtempSync(join(process.cwd(), 'output', 'seed-package-'))
    dirs.push(dir)
    writeSeedPackage(build, dir)
    return installBundleContent(h.server.db, h.server.config, {
      bundle: dir,
      withoutSchema: true,
      withoutFiles: true,
      backupTaken: true,
      ...options,
    })
  }
  const value = async (key: string, alias: string, culture: string | null = null) =>
    (await docs.byKey(key))?.values.find((v) => v.alias === alias && v.culture === culture)?.value
  return { h, root, docs, compile, apply, value }
}

const nodeAt = (build: SeedBuild, path: string) =>
  build.set?.nodes.find((n) => n.key === seedKey(path)) as BundleNode
const stored = (node: BundleNode, alias: string, culture: string | null = null) =>
  node.values.find((v) => v.property === alias && v.culture === culture)?.value

describe(`compiling a seed (${dialectUnderTest})`, () => {
  test('every shorthand becomes its editor’s stored shape', async () => {
    const { compile } = await site()
    const build = await compile()
    expect(build.findings).toEqual([])
    const home = nodeAt(build, 'content/home')
    const about = seedKey('content/home/about')
    const mark = seedKey('media/logos/mark.png')
    expect(stored(home, 'title')).toBe('Welcome')
    expect((stored(home, 'body') as { markup: string }).markup).toContain(
      `href="/{localLink:${about}}"`,
    )
    expect((stored(home, 'body') as { markup: string }).markup).toContain('<strong>not</strong>')
    expect(stored(home, 'keywords')).toEqual(['whisky', 'harbour'])
    expect(stored(home, 'featured')).toBe(true)
    expect(stored(home, 'rank')).toBe(3)
    expect(stored(home, 'hero')).toEqual([
      {
        key: pickKey(mark),
        mediaKey: mark,
        mediaTypeAlias: 'Image',
        crops: [],
        focalPoint: null,
      },
    ])
    expect(stored(home, 'links')).toEqual([
      { unique: about, type: 'document', name: '', target: null },
      { unique: null, type: 'external', name: 'Example', target: null, url: 'https://example.com' },
    ])
    expect(stored(home, 'card')).toEqual([seedKey('library/hero-card')])
    const cards = stored(home, 'cards') as {
      layout: Record<string, Array<{ contentKey: string }>>
      contentData: Array<{ key: string; contentTypeKey: string; values: unknown[] }>
    }
    expect(cards.layout['Umbraco.BlockList']?.[0]?.contentKey).toBe(
      cards.contentData[0]?.key as string,
    )
    expect(cards.contentData[0]).toMatchObject({
      contentTypeKey: CARD_KEY,
      values: [{ alias: 'heading', value: 'One' }],
    })
    expect(stored(nodeAt(build, 'content/home/about'), 'related')).toBe(
      `umb://document/${seedKey('content/home').replaceAll('-', '')}`,
    )
  })

  test('cultures, order, publish state, and media with its sidecar', async () => {
    const { compile } = await site()
    const build = await compile()
    const bonjour = nodeAt(build, 'content/bonjour')
    expect(bonjour.variants.map((v) => [v.culture, v.name])).toEqual([
      ['en-US', 'Hello'],
      ['fr-FR', 'Bonjour'],
    ])
    expect(stored(bonjour, 'title', 'fr-FR')).toBe('Bonjour')
    expect(nodeAt(build, 'content/home/contact').sortOrder).toBe(0)
    expect(nodeAt(build, 'content/home/about').sortOrder).toBe(1)
    expect(nodeAt(build, 'content/home/contact').variants[0]?.published).toBe(false)
    expect(nodeAt(build, 'content/home').template).toBe('page')

    const mark = nodeAt(build, 'media/logos/mark.png')
    const folder = nodeAt(build, 'media/logos')
    expect(mark.parent).toBe(folder.key)
    expect(mark.variants[0]?.name).toBe('Mark')
    expect(stored(mark, 'umbracoFile')).toMatchObject({
      src: `/media/${mark.key.replaceAll('-', '').slice(0, 8)}/mark.png`,
      focalPoint: { left: 0.5, top: 0.25 },
    })
    expect(stored(mark, 'umbracoWidth')).toBe(1)
    expect(build.blobs.get(`${mark.key.replaceAll('-', '').slice(0, 8)}/mark.png`)?.length).toBe(
      PIXEL.length,
    )
  })

  test('what is wrong is named with its file and line', async () => {
    const { compile } = await site({
      'content/home.toml':
        'type = "page"\n\n[values]\ntitle = "Home"\nnope = 1\nrank = "three"\nrelated = "/nowhere"\n',
      'content/home/loose.toml': 'type = "localised"\n',
      'content/other.toml': 'type = "nothing"\n',
      'content/twin.toml': `type = "page"\nkey = "${seedKey('content/home')}"\n`,
      'content/greek.toml': 'type = "localised"\n\n[values.el-GR]\ntitle = "Γεια"\n',
      'content/broken.toml': 'type = "page"\nname = \n',
    })
    const build = await compile()
    const found = (code: string) => build.findings.find((f) => f.code === code)
    expect(found('unknown-property')).toMatchObject({ file: 'seed/content/home.toml', line: 5 })
    expect(found('bad-value')).toMatchObject({ line: 6 })
    expect(found('bad-value')?.message).toContain('rank')
    expect(build.findings.some((f) => f.message.includes('"/nowhere" is not a page'))).toBe(true)
    expect(found('not-allowed-here')?.message).toBe(`"Localised" isn't allowed under "Page"`)
    expect(found('unknown-type')).toMatchObject({ file: 'seed/content/other.toml', line: 1 })
    expect(found('duplicate-key')).toMatchObject({ file: 'seed/content/twin.toml', line: 2 })
    expect(found('language-missing')).toMatchObject({ file: 'seed/content/greek.toml', line: 3 })
    expect(found('syntax')).toMatchObject({ file: 'seed/content/broken.toml', line: 2 })
    expect(build.set).toBeUndefined()
  })

  test('a line is found under its table', () => {
    const text = 'type = "x"\n\n[values]\ntitle = "a"\n\n[values.fr-FR]\ntitle = "b"\n'
    expect(lineOf(text, ['type'])).toBe(1)
    expect(lineOf(text, ['values', 'title'])).toBe(4)
    expect(lineOf(text, ['values', 'fr-FR', 'title'])).toBe(7)
    expect(lineOf(text, ['values', 'fr-FR'])).toBe(6)
  })
})

describe(`applying a seed (${dialectUnderTest})`, () => {
  test('lands as the import lands a bundle, files and all, and an unchanged seed changes nothing', async () => {
    const { h, compile, apply, value, docs } = await site()
    const first = await apply(await compile(), { publish: true })
    expect(first.runId).toBeDefined()
    const home = seedKey('content/home')
    expect(await value(home, 'title')).toBe('Welcome')
    const mark = seedKey('media/logos/mark.png')
    expect(
      existsSync(
        join(h.server.config.mediaDir, `${mark.replaceAll('-', '').slice(0, 8)}/mark.png`),
      ),
    ).toBe(true)
    expect((await docs.byKeyPublished(home))?.key).toBe(home)
    expect(await docs.byKeyPublished(seedKey('content/home/contact'))).toBeUndefined()

    const versions = (await docs.versions(home)).length
    const again = await apply(await compile())
    expect(again.runId).toBeDefined()
    expect(again.check.counts.update).toBe(0)
    expect((await docs.versions(home)).length).toBe(versions)
  })

  test('a change to the seed is taken, and an edit made here is kept', async () => {
    const { root, compile, apply, value, docs } = await site()
    await apply(await compile())
    const home = seedKey('content/home')
    const about = seedKey('content/home/about')
    const page = await docs.byKey(about)
    await docs.update({
      ...(page as NonNullable<typeof page>),
      values: (page?.values ?? []).map((v) =>
        v.alias === 'title' ? { ...v, value: 'Edited in the back office' } : v,
      ),
    })
    writeFileSync(
      join(root, 'seed', 'content', 'home.toml'),
      readFileSync(join(root, 'seed', 'content', 'home.toml'), 'utf8').replace(
        'Welcome',
        'Welcome back',
      ),
    )
    const result = await apply(await compile())
    expect(result.check.outstanding).toEqual([])
    expect(await value(home, 'title')).toBe('Welcome back')
    expect(await value(about, 'title')).toBe('Edited in the back office')
  })

  test('everything exported, Library and media with their files, builds the same bundle', async () => {
    const source = await site()
    const first = await source.compile()
    await source.apply(first, { publish: true })
    const all = await new NodeRepository(source.h.server.db).children(
      -1,
      ObjectTypes.Document,
      0,
      100,
    )
    const elsewhere = mkdtempSync(join(process.cwd(), 'output', 'seed-export-all-'))
    dirs.push(elsewhere)
    await exportSeed(source.h.server.db, elsewhere, {
      pages: all.items,
      library: true,
      media: true,
      files: new MediaFileStore(source.h.server.config.mediaDir),
    })
    const files: Record<string, string | Buffer> = {}
    const walk = (dir: string, prefix: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path, `${prefix}${name}/`)
        else files[`${prefix}${name}`] = readFileSync(path)
      }
    }
    walk(join(elsewhere, 'seed'), '')
    // Read as a person would: shorthand where there is one.
    const home = String(files['content/home.toml'])
    expect(home).toContain('hero = "/logos/mark.png"')
    expect(home).toContain('card = "hero-card"')
    expect(home).toContain('{ type = "card"')

    const target = await site(files)
    const second = await target.compile()
    expect(second.findings).toEqual([])
    const byKey = (build: SeedBuild) => new Map((build.set?.nodes ?? []).map((n) => [n.key, n]))
    const before = byKey(first)
    const after = byKey(second)
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort())
    for (const [key, node] of before) {
      const again = after.get(key) as BundleNode
      const sorted = (n: BundleNode) =>
        n.values
          .map((v) => [`${v.property}|${v.culture ?? ''}`, v.value] as const)
          .sort(([a], [b]) => a.localeCompare(b))
      expect(sorted(again)).toEqual(sorted(node))
      expect(again.variants).toEqual(node.variants)
      expect(again.parent).toBe(node.parent)
      expect(again.sortOrder).toBe(node.sortOrder)
    }
  })

  test('a media folder named .. is exported inside seed/media, never above it', async () => {
    const source = await site()
    await source.apply(await source.compile())
    const logos = await resolveNodeRef(source.h.server.db, [ObjectTypes.Media], '/logos')
    if (!logos.ok) throw new Error('no logos folder')
    await new NodeRepository(source.h.server.db).rename(logos.node.id, '..')
    const elsewhere = mkdtempSync(join(process.cwd(), 'output', 'seed-export-dots-'))
    dirs.push(elsewhere)
    const exported = await exportSeed(source.h.server.db, elsewhere, {
      pages: [],
      media: true,
      files: new MediaFileStore(source.h.server.config.mediaDir),
    })
    expect(exported.written).toContain('seed/media/item/mark.png')
    for (const file of exported.written) expect(file.startsWith('seed/media/item/')).toBe(true)
    expect(existsSync(join(elsewhere, 'seed', 'mark.png'))).toBe(false)
    expect(readFileSync(join(elsewhere, 'seed', 'media', 'item', 'mark.png'))).toEqual(PIXEL)
  })

  test('exported from one site, applied to an empty one, names the same pages', async () => {
    const source = await site()
    await source.apply(await source.compile())
    const homeNode = await resolveNodeRef(source.h.server.db, [ObjectTypes.Document], '/Home')
    if (!homeNode.ok) throw new Error('no Home')
    const elsewhere = mkdtempSync(join(process.cwd(), 'output', 'seed-export-'))
    dirs.push(elsewhere)
    const exported = await exportSeed(source.h.server.db, elsewhere, { pages: [homeNode.node] })
    expect(exported.written).toContain('seed/content/home.toml')

    const files: Record<string, string> = {}
    for (const file of exported.written)
      files[file.slice('seed/'.length)] = readFileSync(join(elsewhere, file), 'utf8')
    // Pickers that point outside what was exported stay as the keys they were.
    const target = await site({
      ...files,
      'library/hero-card.toml': SEED['library/hero-card.toml'] as string,
      'media/logos/mark.png': PIXEL,
      'media/logos/mark.png.toml': SEED['media/logos/mark.png.toml'] as string,
    })
    const build = await target.compile()
    expect(build.findings).toEqual([])
    await target.apply(build)
    const home = seedKey('content/home')
    expect(await target.value(home, 'title')).toBe('Welcome')
    expect(await target.value(seedKey('content/home/about'), 'title')).toBe('About us')
    const nodes = new NodeRepository(target.h.server.db)
    expect((await nodes.byKey(home))?.text).toBe('Home')
  })
})
