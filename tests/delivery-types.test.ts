/**
 * Story 052: `crombolo generate --delivery` types a site's Delivery API JSON,
 * and an app using them with `@crombolo/delivery-client` type-checks.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateDeliveryTypes, loadSchemaDirectory } from '@crombolo/schema'
import { ROOT } from '../scripts/packages.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const HERO_KEY = '6f1d2c3b-0000-4000-8000-000000000001'

const SCHEMA: Record<string, string> = {
  'schema.toml': '[schema]\nversion = "1.0.0"\n',
  'content-types/page.toml': `[content-type]
alias = "page"
name = "Page"
description = "A page of prose"
allow-at-root = true
compositions = ["seo"]

[[property]]
alias = "title"
name = "Title"
type = "textstring"
mandatory = true
description = "The heading"

[[property]]
alias = "body"
name = "Body"
type = "richtext"

[[property]]
alias = "count"
name = "Count"
type = "numeric"

[[property]]
alias = "visible"
name = "Visible"
type = "trueFalse"

[[property]]
alias = "published"
name = "Published"
type = "datePicker"

[[property]]
alias = "tags"
name = "Tags"
type = "tags"

[[property]]
alias = "choice"
name = "Choice"
type = "dropdown"

[[property]]
alias = "choices"
name = "Choices"
type = "dropdownMultiple"

[[property]]
alias = "colour"
name = "Colour"
type = "approvedColor"

[[property]]
alias = "image"
name = "Image"
type = "mediaPicker"

[[property]]
alias = "related"
name = "Related"
type = "contentPicker"

[[property]]
alias = "links"
name = "Links"
type = "multiUrlPicker"

[[property]]
alias = "files"
name = "Files"
type = "mediaTree"

[[property]]
alias = "blocks"
name = "Blocks"
type = "heroBlocks"

[[property]]
alias = "member"
name = "Member"
type = "memberPicker"
`,
  'content-types/seo.toml': `[content-type]
alias = "seo"
name = "SEO"

[[property]]
alias = "metaTitle"
name = "Meta title"
type = "textstring"
`,
  'content-types/settings.toml': `[content-type]
alias = "settings"
name = "Settings"
allow-at-root = true

[[property]]
alias = "phone"
name = "Phone"
type = "textstring"
`,
  'content-types/hero.toml': `[content-type]
key = "${HERO_KEY}"
alias = "hero"
name = "Hero"
is-element = true

[[property]]
alias = "heading"
name = "Heading"
type = "textstring"
`,
  'data-types/hero-blocks.toml': `[data-type]
alias = "heroBlocks"
name = "Hero blocks"
editor = "Umbraco.BlockList"
editor-ui = "Umb.PropertyEditorUi.BlockList"
config = { blocks = [{ contentElementTypeKey = "${HERO_KEY}" }] }
`,
  'data-types/media-tree.toml': `[data-type]
alias = "mediaTree"
name = "Media tree"
editor = "Umbraco.MultiNodeTreePicker"
editor-ui = "Umb.PropertyEditorUi.ContentPicker"
config = { startNode = { type = "media" } }
`,
}

function schemaDir(): string {
  const root = mkdtempSync(join(ROOT, 'output', 'delivery-types-'))
  dirs.push(root)
  const dir = join(root, 'schema')
  for (const [file, text] of Object.entries(SCHEMA)) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), text)
  }
  return dir
}

function generated(serves?: (alias: string) => boolean): string {
  const loaded = loadSchemaDirectory(schemaDir())
  expect(loaded.problems).toEqual([])
  return generateDeliveryTypes(loaded.set, { serves })
}

describe('generateDeliveryTypes', () => {
  test('types each property as the Delivery API writes it, every one nullable', () => {
    const text = generated()
    const page = /export interface PageProperties \{([^}]*)\}/.exec(text)?.[1] ?? ''
    for (const line of [
      '/** The heading */',
      'title: string | null',
      'body: ApiRichText | null',
      'count: number | null',
      'visible: boolean | null',
      'published: string | null',
      'tags: string[] | null',
      'choice: string | null',
      'choices: string[] | null',
      'colour: ApiColor | null',
      'image: Array<MediaWithCrops> | null',
      'related: ContentReference | null',
      'links: ApiLink[] | null',
      'files: MediaReference[] | null',
      'blocks: ApiBlockList<ApiElement<"hero", HeroProperties>, Element> | null',
      "member: '(unsupported)' | null",
      'metaTitle: string | null',
    ])
      expect(page).toContain(line)
  })

  test('lists pages, elements and media by alias, the built-in media types included', () => {
    const text = generated()
    expect(text).toContain('export interface DeliveryTypes {')
    expect(text).toMatch(
      /content: \{\n {4}page: PageProperties\n {4}seo: SeoProperties\n {4}settings: SettingsProperties\n {2}\}/,
    )
    expect(text).toContain('elements: {\n    hero: HeroProperties\n  }')
    expect(text).toContain('Image: ImageMediaProperties')
    expect(text).toContain('export interface ImageMediaProperties {\n}')
    expect(text).toContain(
      "import type { ApiBlockList, ApiColor, ApiContentReference, ApiElement, ApiLink, ApiMediaReference, ApiMediaWithCrops, ApiRichText, ContentItem, MediaItem } from '@crombolo/delivery-client'",
    )
  })

  test('leaves out the page types the API does not serve', () => {
    const text = generated((alias) => alias !== 'settings')
    expect(text).not.toContain('SettingsProperties')
    expect(text).toContain('PageProperties')
  })

  test('writes the same file from the same schema', () => {
    expect(generated()).toBe(generated())
  })

  test('types the demo site as it is', () => {
    const loaded = loadSchemaDirectory(join(ROOT, 'sites/harbourstone/schema'))
    const text = generateDeliveryTypes(loaded.set)
    expect(text).toContain('highlights: Array<ApiElement<"highlight", HighlightProperties>> | null')
  })
})

/** An app using the generated types: what must compile, and what must not. */
const APP = `import { createDeliveryClient, isExpanded } from '@crombolo/delivery-client'
import type { Content, DeliveryTypes } from './cms-types'

const cms = createDeliveryClient<DeliveryTypes>({ baseUrl: 'https://cms.example.com' })

export async function heading(id: string): Promise<string> {
  const item = await cms.item(id, { expand: 'properties[related]' })
  if (!item) return ''
  if (item.contentType === 'page') {
    const title: string | null = item.properties.title
    const related = item.properties.related
    if (related && isExpanded(related) && related.contentType === 'page')
      return related.properties.title ?? ''
    // @ts-expect-error a reference's properties may be empty until it is expanded
    if (related) return related.properties.title ?? ''
    for (const block of item.properties.blocks?.items ?? []) {
      const words: string | null | undefined = block.content?.properties.heading
      if (words) return words
    }
    return title ?? ''
  }
  // @ts-expect-error settings has no title
  return item.properties.title
}

export async function narrowed(id: string) {
  const item = await cms.item(id, { fields: 'properties[title]' })
  if (item?.contentType !== 'page') return
  const title: string | null | undefined = item.properties.title
  return title
}

export async function listed(): Promise<Content[]> {
  const page = await cms.content({ fetch: 'children:/', sort: 'name:asc', take: 5 })
  const total: number = page.total
  const hits = await cms.search('whisky', { contentType: 'page' })
  const excerpt: string | undefined = hits.items[0]?.excerpt
  void total
  void excerpt
  // @ts-expect-error not a content type alias the site has
  if (page.items[0]?.contentType === 'article') return []
  return page.items
}
`

describe('an app using the generated types', () => {
  test('type-checks, and refuses what the API would not send', () => {
    const app = mkdtempSync(join(ROOT, 'output', 'delivery-app-'))
    dirs.push(app)
    writeFileSync(join(app, 'cms-types.ts'), generated())
    writeFileSync(join(app, 'app.ts'), APP)
    const check = Bun.spawnSync(
      [
        'bun',
        'x',
        'tsc',
        '--noEmit',
        '--ignoreConfig',
        '--strict',
        '--target',
        'es2022',
        '--module',
        'esnext',
        '--moduleResolution',
        'bundler',
        '--allowImportingTsExtensions',
        '--lib',
        'es2022,dom',
        '--skipLibCheck',
        join(app, 'app.ts'),
      ],
      { cwd: app, stdout: 'pipe', stderr: 'pipe' },
    )
    expect(`${check.stdout}${check.stderr}`).toBe('')
    expect(check.exitCode).toBe(0)
    expect(readFileSync(join(app, 'cms-types.ts'), 'utf8')).toStartWith('// Generated by')
  })
})
