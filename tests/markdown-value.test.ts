/**
 * Story 357: a Markdown value reaches a template and the Delivery API as HTML, as
 * Umbraco's value converter gives it, on a page and in a block; empty is nothing;
 * and search still reads the Markdown's words.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { markdownToHtml, toPublishedValue } from '@crombolo/core'
import { ComponentRepository, ContentTypeRepository, SiteSearch } from '@crombolo/data'
import { presetDataType, writeDataType } from '@crombolo/schema'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const MARKDOWN = [
  '## Harbour notes',
  '',
  'Read the [tide tables](https://example.com/tides) before *sailing*.',
  '',
  '- moorings',
  '- slipway',
  '',
  '```',
  'const knots = 12',
  '```',
].join('\n')

const expectHtml = (html: unknown) => {
  expect(html).toContain('<h2>Harbour notes</h2>')
  expect(html).toContain('<a href="https://example.com/tides">tide tables</a>')
  expect(html).toContain('<em>sailing</em>')
  expect(html).toContain('<li>moorings</li>')
  expect(html).toContain('<pre><code>const knots = 12')
}

describe('a Markdown value', () => {
  test('is HTML for a template, GitHub-flavoured; nothing when empty', () => {
    expectHtml(toPublishedValue('Umbraco.MarkdownEditor', MARKDOWN))
    expect(markdownToHtml('| a | b |\n| - | - |\n| 1 | 2 |')).toContain('<table>')
    expect(toPublishedValue('Umbraco.MarkdownEditor', '')).toBeNull()
    expect(toPublishedValue('Umbraco.MarkdownEditor', '   ')).toBeNull()
    expect(toPublishedValue('Umbraco.MarkdownEditor', null)).toBeNull()
    expect(toPublishedValue('Umbraco.TextArea', MARKDOWN)).toBe(MARKDOWN)
  })
})

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

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "notes"
name = "Notes"
type = "notes"

[[property]]
alias = "asides"
name = "Asides"
type = "asides"
`
const ASIDE = `[content-type]
alias = "aside"
name = "Aside"
is-element = true

[[property]]
alias = "text"
name = "Text"
type = "notes"
`
const VIEW = `export default function Page({ model }) {
  const [aside] = model.value('asides') ?? []
  return <main><div id="notes">{model.html('notes')}</div><div id="aside">{aside?.content.html('text')}</div></main>
}
`

describe('a Markdown property on a page', () => {
  test('renders and is delivered as HTML, in a block too, and search reads its words', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'markdown-value-'))
    dirs.push(root)
    const schema = join(root, 'schema')
    for (const dir of ['content-types', 'data-types'])
      mkdirSync(join(schema, dir), { recursive: true })
    mkdirSync(join(root, 'components'), { recursive: true })
    writeFileSync(join(schema, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(join(schema, 'content-types', 'page.toml'), PAGE)
    writeFileSync(join(schema, 'content-types', 'aside.toml'), ASIDE)
    const dataTypes: Array<[string, string, Parameters<typeof presetDataType>[2]]> = [
      ['notes', 'markdown', {}],
      ['asides', 'block-list', { block: ['aside'] }],
    ]
    for (const [alias, preset, options] of dataTypes) {
      const built = presetDataType(alias, preset, options)
      if (!built.ok) throw new Error(built.reason)
      writeFileSync(join(schema, 'data-types', `${alias}.toml`), writeDataType(built.dataType))
    }
    writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
    const h = await signedInServer({
      config: {
        schemaDir: schema,
        componentsDir: join(root, 'components'),
        mediaDir: join(root, 'media'),
        deliveryApi: { enabled: true },
      },
    })
    open.push(h)
    const types = new ContentTypeRepository(h.server.db)
    const typeKey = (await types.byAlias('page'))?.key as string
    const asideKey = (await types.byAlias('aside'))?.key as string
    const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
    const block = crypto.randomUUID()
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [
        { alias: 'notes', culture: null, segment: null, value: MARKDOWN },
        {
          alias: 'asides',
          culture: null,
          segment: null,
          value: {
            layout: { 'Umbraco.BlockList': [{ contentKey: block }] },
            contentData: [
              {
                key: block,
                contentTypeKey: asideKey,
                values: [
                  {
                    alias: 'text',
                    editorAlias: 'Umbraco.MarkdownEditor',
                    culture: null,
                    segment: null,
                    value: 'A **strong** aside',
                  },
                ],
              },
            ],
            settingsData: [],
            expose: [{ contentKey: block, culture: null, segment: null }],
          },
        },
      ],
      variants: [{ culture: null, segment: null, name: 'Harbour' }],
    })
    expect(created.status, await created.clone().text()).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    const read = await h.json<{ values: Array<{ alias: string; value: unknown }> }>(
      `${V1}/document/${key}`,
    )
    expect(read.values.find((v) => v.alias === 'notes')?.value).toBe(MARKDOWN)
    expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(
      200,
    )

    const html = await (await h.call('/')).text()
    expectHtml(/<div id="notes">([\s\S]*?)<\/div><div id="aside">/.exec(html)?.[1])
    expect(html).toContain('<div id="aside"><p>A <strong>strong</strong> aside</p>')

    const delivered = (await (
      await h.server.fetch(
        new Request(`http://localhost/umbraco/delivery/api/v2/content/item/${key}`),
      )
    ).json()) as {
      properties: {
        notes: string
        asides: { items: Array<{ content: { properties: { text: string } } }> }
      }
    }
    expectHtml(delivered.properties.notes)
    expect(delivered.properties.asides.items[0]?.content.properties.text).toContain(
      '<strong>strong</strong>',
    )

    await h.server.jobs.runSearchIndexing()
    const search = (term: string) =>
      new SiteSearch(h.server.db).query(term, {
        culture: 'en-us',
        access: { denied: [], allowed: [] },
        skip: 0,
        take: 10,
      })
    expect((await search('slipway')).items.map((item) => item.key)).toEqual([key])
    expect((await search('h2')).total).toBe(0)
  }, 30_000)
})
