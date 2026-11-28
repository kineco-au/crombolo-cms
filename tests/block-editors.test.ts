/**
 * Story 456: the block editors refuse what Umbraco's refuse, on validate and on save,
 * at Umbraco's paths and in its words; what was stored before keeps rendering and is
 * listed ahead of its next save; imports are held to the same rules before anything is
 * written; and a block that varies by culture saves, publishes, reads and renders per
 * culture.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ComponentRepository,
  ContentTypeRepository,
  DataTypeRepository,
  DocumentRepository,
  type NodeRow,
  storedBlockProblems,
  TransferRunRepository,
} from '@crombolo/data'
import { type ContentSet, exportBundle, importBundle } from '@crombolo/transfer'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const CARD = 'c4a9d1f0-0456-4000-8000-000000000001'
const CARD_SETTINGS = 'c4a9d1f0-0456-4000-8000-000000000002'
const QUOTE = 'c4a9d1f0-0456-4000-8000-000000000003'
const COLUMNS = 'c4a9d1f0-0456-4000-8000-000000000004'
const CAPTION = 'c4a9d1f0-0456-4000-8000-000000000005'
const LEFT = 'c4a9d1f0-0456-4000-8000-0000000000a1'

const element = (key: string, alias: string, properties: string, varies = false) => `[content-type]
key = "${key}"
alias = "${alias}"
name = "${alias[0]?.toUpperCase()}${alias.slice(1)}"
is-element = true
${varies ? 'varies-by-culture = true\n' : ''}
${properties}`

const files: Record<string, string> = {
  'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
  'schema/content-types/card.toml': element(
    CARD,
    'card',
    `[[property]]
alias = "title"
name = "Title"
type = "textstring"
mandatory = true
mandatory-message = "A card needs a title"

[[property]]
alias = "code"
name = "Code"
type = "textstring"
regex = "^[A-Z]+$"
`,
  ),
  'schema/content-types/card-settings.toml': element(
    CARD_SETTINGS,
    'cardSettings',
    `[[property]]
alias = "theme"
name = "Theme"
type = "textstring"
mandatory = true
`,
  ),
  'schema/content-types/quote.toml': element(
    QUOTE,
    'quote',
    `[[property]]
alias = "text"
name = "Text"
type = "textstring"
`,
  ),
  'schema/content-types/columns.toml': element(COLUMNS, 'columns', ''),
  'schema/content-types/caption.toml': element(
    CAPTION,
    'caption',
    `[[property]]
alias = "caption"
name = "Caption"
type = "textstring"
mandatory = true
varies-by-culture = true
`,
    true,
  ),
  'schema/data-types/cards.toml': `[data-type]
alias = "cards"
name = "Cards"
editor = "Umbraco.BlockList"
editor-ui = "Umb.PropertyEditorUi.BlockList"

[data-type.config.validationLimit]
min = 1
max = 2

[[data-type.config.blocks]]
contentElementTypeKey = "${CARD}"
settingsElementTypeKey = "${CARD_SETTINGS}"
`,
  'schema/data-types/layout.toml': `[data-type]
alias = "layout"
name = "Layout"
editor = "Umbraco.BlockGrid"
editor-ui = "Umb.PropertyEditorUi.BlockGrid"

[data-type.config]
gridColumns = 12

[[data-type.config.blocks]]
contentElementTypeKey = "${COLUMNS}"

[[data-type.config.blocks.areas]]
key = "${LEFT}"
alias = "left"
columnSpan = 6
rowSpan = 1
maxAllowed = 1

[[data-type.config.blocks.areas.specifiedAllowance]]
elementTypeKey = "${QUOTE}"

[[data-type.config.blocks]]
contentElementTypeKey = "${QUOTE}"
allowAtRoot = false
`,
  'schema/data-types/captions.toml': `[data-type]
alias = "captions"
name = "Captions"
editor = "Umbraco.BlockList"
editor-ui = "Umb.PropertyEditorUi.BlockList"

[[data-type.config.blocks]]
contentElementTypeKey = "${CAPTION}"
`,
  'schema/data-types/body.toml': `[data-type]
alias = "body"
name = "Body"
editor = "Umbraco.RichText"
editor-ui = "Umb.PropertyEditorUi.Tiptap"

[[data-type.config.blocks]]
contentElementTypeKey = "${QUOTE}"
`,
  'schema/content-types/page.toml': `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
varies-by-culture = true

[[property]]
alias = "cards"
name = "Cards"
type = "cards"

[[property]]
alias = "layout"
name = "Layout"
type = "layout"

[[property]]
alias = "captions"
name = "Captions"
type = "captions"

[[property]]
alias = "body"
name = "Body"
type = "body"
`,
  'components/page.tsx': `export default function Page({ model }) {
  return (
    <main>
      <ul>{(model.value('cards') ?? []).map((c) => <li class="card">{c.content.text('title')}</li>)}</ul>
      <ol>{(model.value('captions') ?? []).map((c) => <li class="caption">{c.content.text('caption')}</li>)}</ol>
      <div class="body">{model.html('body')}</div>
      <div class="quotes">{(model.value('body')?.blocks ?? []).map((b) => <q>{b.content.text('text')}</q>)}</div>
    </main>
  )
}
`,
}

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

const value = (alias: string, v: unknown, culture: string | null = null) => ({
  alias,
  culture,
  segment: null,
  value: v,
})

type Data = { key: string; contentTypeKey: string; values: ReturnType<typeof value>[] }

const data = (contentTypeKey: string, values: Record<string, unknown>): Data => ({
  key: crypto.randomUUID(),
  contentTypeKey,
  values: Object.entries(values).map(([alias, v]) => ({
    ...value(alias, v),
    editorAlias: 'Umbraco.TextBox',
  })),
})

const list = (contents: Data[], settings: Array<Data | undefined> = []) => ({
  layout: {
    'Umbraco.BlockList': contents.map((c, i) => ({
      contentKey: c.key,
      settingsKey: settings[i]?.key ?? null,
    })),
  },
  contentData: contents,
  settingsData: settings.filter((s): s is Data => s !== undefined),
  expose: contents.map((c) => ({ contentKey: c.key, culture: null, segment: null })),
})

const card = (title?: string, extra: Record<string, unknown> = {}) =>
  data(CARD, { ...(title === undefined ? {} : { title }), ...extra })
const theme = (t?: string) => data(CARD_SETTINGS, t === undefined ? {} : { theme: t })

const inner = (path: string, alias: string, culture: string | null = null) =>
  `${path}.values[?(@.alias == '${alias}' && @.culture == ${culture === null ? 'null' : `'${culture}'`} && @.segment == null)].value`

async function site(extraLanguage = false) {
  while (open.length > 0) await open.pop()?.db.close()
  const root = mkdtempSync(join(process.cwd(), 'output', 'block-editors-'))
  dirs.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      deliveryApi: { enabled: true },
    },
  })
  open.push(h)
  if (extraLanguage)
    expect(
      (
        await h.post(`${V1}/language`, {
          isoCode: 'da-DK',
          name: 'Danish',
          isDefault: false,
          isMandatory: false,
          fallbackIsoCode: null,
        })
      ).status,
    ).toBe(201)
  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const cultures = extraLanguage ? ['en-US', 'da-DK'] : ['en-US']
  const body = (values: unknown[], name = 'Home') => ({
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values,
    variants: cultures.map((culture) => ({ culture, segment: null, name: `${name} ${culture}` })),
  })
  const create = async (values: unknown[], name = 'Home') => {
    const response = await h.post(`${V1}/document`, body(values, name))
    if (response.status !== 201)
      throw new Error(`create ${response.status}: ${await response.text()}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const problem = async (response: Response) => {
    expect(response.status).toBe(400)
    return ((await response.json()) as { errors: Record<string, string[]> }).errors
  }
  const publish = (key: string) =>
    h.put(`${V1}/document/${key}/publish`, {
      publishSchedules: cultures.map((culture) => ({ culture })),
    })
  return { h, body, create, problem, publish, typeKey, componentKey }
}

describe(`the block editors refuse what Umbraco's refuse (${dialectUnderTest})`, () => {
  test('too few and too many blocks, on validate and save, in Umbraco’s words', async () => {
    const { h, body, create, problem } = await site()
    const three = list([card('A'), card('B'), card('C')], [theme('x'), theme('x'), theme('x')])
    expect(
      await problem(await h.post(`${V1}/document/validate`, body([value('cards', three)]))),
    ).toEqual({
      '$.values[0].value': ['Maximum 2 entries, 1 too many.'],
    })
    expect(await problem(await h.post(`${V1}/document`, body([value('cards', three)])))).toEqual({
      '$.values[0].value': ['Maximum 2 entries, 1 too many.'],
    })
    const key = await create([value('cards', list([card('A')], [theme('x')]))])
    const empty = list([])
    expect(
      await problem(await h.put(`${V1}/document/${key}`, body([value('cards', empty)]))),
    ).toEqual({ '$.values[0].value': ['Minimum 1 entries, requires 1 more.'] })
    expect(
      await problem(
        await h.put(`${V1.replace(/v1$/, 'v1.1')}/document/${key}/validate`, {
          ...body([value('cards', empty)]),
          cultures: null,
        }),
      ),
    ).toEqual({ '$.values[0].value': ['Minimum 1 entries, requires 1 more.'] })
    // Nothing was saved by the refusals.
    const doc = await h.json<{
      values: Array<{ alias: string; value: { contentData: unknown[] } }>
    }>(`${V1}/document/${key}`)
    expect(doc.values.find((v) => v.alias === 'cards')?.value.contentData).toHaveLength(1)
  })

  test('a mandatory field and a pattern inside a block, in content and settings, at Umbraco’s paths', async () => {
    const { h, body, problem } = await site()
    const cards = list([card('Fine'), card(undefined, { code: 'lower' })], [theme('x'), theme()])
    const errors = await problem(
      await h.post(`${V1}/document/validate`, body([value('cards', cards)])),
    )
    expect(errors).toEqual({
      [inner('$.values[0].value.contentData[1]', 'title')]: ['A card needs a title'],
      [inner('$.values[0].value.contentData[1]', 'code')]: [
        'Value is invalid, it does not match the correct pattern',
      ],
      [inner('$.values[0].value.settingsData[1]', 'theme')]: ['Value cannot be empty'],
    })
    // A field left empty at the top level stays a publish rule; inside a block, a save is refused too.
    expect(await problem(await h.post(`${V1}/document`, body([value('cards', cards)])))).toEqual(
      errors,
    )
  })

  test('a block type the property does not offer, and a grid area’s allowance, are refused', async () => {
    const { h, body, problem } = await site()
    const quote = data(QUOTE, { text: 'Quoted' })
    expect(
      await problem(await h.post(`${V1}/document/validate`, body([value('cards', list([quote]))]))),
    ).toEqual({ '$.values[0].value.contentData[0]': ['Quote is not allowed at this spot.'] })

    const columns = data(COLUMNS, {})
    const grid = (inArea: Data[], atRoot: Data[] = []) => ({
      layout: {
        'Umbraco.BlockGrid': [
          {
            contentKey: columns.key,
            columnSpan: 12,
            rowSpan: 1,
            areas: [
              {
                key: LEFT,
                items: inArea.map((b) => ({ contentKey: b.key, columnSpan: 6, rowSpan: 1 })),
              },
            ],
          },
          ...atRoot.map((b) => ({ contentKey: b.key, columnSpan: 12, rowSpan: 1, areas: [] })),
        ],
      },
      contentData: [columns, ...inArea, ...atRoot],
      settingsData: [],
    })
    const valid = [value('cards', list([card('A')], [theme('x')]))]
    expect(
      (await h.post(`${V1}/document/validate`, body([...valid, value('layout', grid([quote]))])))
        .status,
    ).toBe(200)
    expect(
      await problem(
        await h.post(
          `${V1}/document/validate`,
          body([...valid, value('layout', grid([quote, data(QUOTE, { text: 'Two' })]))]),
        ),
      ),
    ).toEqual({
      '$.values[1].value.contentData[0]': [
        'The content amount requirements are not met for one or more areas.',
      ],
    })
    expect(
      await problem(
        await h.post(
          `${V1}/document/validate`,
          body([...valid, value('layout', grid([], [quote]))]),
        ),
      ),
    ).toEqual({ '$.values[1].value.contentData[1]': ['Quote is not allowed at this spot.'] })
  })

  test('stored content keeps rendering and stays published; its next save is refused, and it is listed ahead', async () => {
    const { h, body, create, publish, problem } = await site()
    const two = list([card('One'), card('Two')], [theme('x'), theme('x')])
    const key = await create([value('cards', two)])
    expect((await publish(key)).status).toBe(200)
    expect(await storedBlockProblems(h.server.db)).toEqual([])

    // The rules tighten under it, as an upgrade's do: one card at most.
    const dataTypes = new DataTypeRepository(h.server.db)
    const cards = await dataTypes.byAlias('cards')
    if (!cards) throw new Error('no cards data type')
    await dataTypes.save({
      ...cards,
      values: [
        ...cards.values.filter((v) => v.alias !== 'validationLimit'),
        { alias: 'validationLimit', value: { min: 1, max: 1 } },
      ],
    })

    const page = await h.server.fetch(new Request('http://localhost/'))
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<li class="card">Two</li>')

    const listed = await storedBlockProblems(h.server.db)
    expect(listed).toEqual([
      {
        kind: 'document',
        key,
        name: expect.any(String),
        errors: [
          {
            alias: 'cards',
            culture: null,
            segment: null,
            messages: ['Maximum 1 entries, 1 too many.'],
          },
        ],
      },
    ])
    const health = JSON.stringify(
      await (await h.post(`${V1}/health-check-group/Content/check`, {})).json(),
    )
    expect(health).toContain('hold blocks their next save would refuse')
    expect(health).toContain(
      `at $.values[?(@.alias == 'cards' && @.culture == null && @.segment == null)].value: Maximum 1 entries, 1 too many.`,
    )

    expect(
      await problem(await h.put(`${V1}/document/${key}`, body([value('cards', two)]))),
    ).toEqual({
      '$.values[0].value': ['Maximum 1 entries, 1 too many.'],
    })
    const fixed = list([card('One')], [theme('x')])
    expect((await h.put(`${V1}/document/${key}`, body([value('cards', fixed)]))).status).toBe(200)
    expect(await storedBlockProblems(h.server.db)).toEqual([])
  })

  test('an import is held to the same rules before anything is written, naming page, property and path', async () => {
    const source = await site()
    const key = await source.create([value('cards', list([card('One')], [theme('x')]))], 'Imported')
    const node = (await new DocumentRepository(source.h.server.db).nodes.byKey(key)) as NodeRow
    const { set } = await exportBundle(source.h.server.db, {
      roots: [node],
      asGiven: [key],
      descendants: true,
      snapshot: 'drafts',
      blueprints: false,
      withBlobs: false,
      siteName: 'Source',
      nodeId: 'source',
    })
    const broken: ContentSet = {
      ...set,
      nodes: set.nodes.map((n) => ({
        ...n,
        values: n.values.map((v) =>
          v.property === 'cards'
            ? { ...v, value: list([card('A'), card(undefined)], [theme('x'), theme('x')]) }
            : v,
        ),
      })),
    }
    const target = await site()
    const result = await importBundle(target.h.server.db, broken, { nodeId: 'target' })
    expect(result.runId).toBeUndefined()
    const refused = result.check.outstanding.filter((f) => f.code === 'invalid-blocks')
    expect(refused).toHaveLength(1)
    expect(refused[0]).toMatchObject({ kind: 'blocking', subjectKey: key, propertyAlias: 'cards' })
    expect(refused[0]?.message).toContain('"Imported en-US"')
    expect(refused[0]?.message).toContain(
      inner(
        "$.values[?(@.alias == 'cards' && @.culture == null && @.segment == null)].value.contentData[1]",
        'title',
      ),
    )
    expect(refused[0]?.message).toContain('A card needs a title')
    // Nothing was applied.
    expect(await new DocumentRepository(target.h.server.db).nodes.byKey(key)).toBeUndefined()
    expect(await new TransferRunRepository(target.h.server.db).recent()).toEqual([])
  })
})

describe(`a block that varies by culture (${dialectUnderTest})`, () => {
  test('saves, publishes, reads and renders per culture, as Umbraco 13+', async () => {
    const { h, create, publish, body, problem } = await site(true)
    const both = {
      key: crypto.randomUUID(),
      contentTypeKey: CAPTION,
      values: [
        { ...value('caption', 'Hello', 'en-US'), editorAlias: 'Umbraco.TextBox' },
        { ...value('caption', 'Hej', 'da-DK'), editorAlias: 'Umbraco.TextBox' },
      ],
    }
    const english = {
      key: crypto.randomUUID(),
      contentTypeKey: CAPTION,
      values: [{ ...value('caption', 'Only in English', 'en-US'), editorAlias: 'Umbraco.TextBox' }],
    }
    const captions = {
      layout: { 'Umbraco.BlockList': [{ contentKey: both.key }, { contentKey: english.key }] },
      contentData: [both, english],
      settingsData: [],
      expose: [
        { contentKey: both.key, culture: 'en-US', segment: null },
        { contentKey: both.key, culture: 'da-DK', segment: null },
        { contentKey: english.key, culture: 'en-US', segment: null },
      ],
    }
    const cards = value('cards', list([card('Card')], [theme('x')]))

    // A culture it is exposed in must have its mandatory value; one it is not, need not.
    const missingDanish = {
      ...captions,
      contentData: [{ ...both, values: [both.values[0]] }, english],
    }
    expect(
      await problem(
        await h.post(`${V1}/document/validate`, body([cards, value('captions', missingDanish)])),
      ),
    ).toEqual({
      [inner('$.values[1].value.contentData[0]', 'caption', 'da-DK')]: ['Value cannot be empty'],
    })

    const key = await create([cards, value('captions', captions)])
    expect((await publish(key)).status).toBe(200)
    expect(
      (
        await h.put(`${V1}/document/${key}/domains`, {
          defaultIsoCode: null,
          domains: [
            { domainName: 'en.example.com', isoCode: 'en-US' },
            { domainName: 'da.example.com', isoCode: 'da-DK' },
          ],
        })
      ).status,
    ).toBe(200)

    // Read back as saved, every culture's values in the one invariant property.
    const saved = await h.json<{ values: Array<{ alias: string; value: typeof captions }> }>(
      `${V1}/document/${key}`,
    )
    expect(saved.values.find((v) => v.alias === 'captions')?.value.expose).toEqual(captions.expose)

    const render = async (host: string) =>
      [
        ...(await (await h.server.fetch(new Request(`http://${host}/`))).text()).matchAll(
          /<li class="caption">([^<]*)<\/li>/g,
        ),
      ].map((m) => m[1])
    expect(await render('en.example.com')).toEqual(['Hello', 'Only in English'])
    expect(await render('da.example.com')).toEqual(['Hej'])

    const delivered = async (culture: string) => {
      const response = await h.server.fetch(
        new Request(`http://localhost/umbraco/delivery/api/v2/content/item/${key}`, {
          headers: { 'Accept-Language': culture },
        }),
      )
      expect(response.status).toBe(200)
      const json = (await response.json()) as {
        properties: { captions: { items: Array<{ content: { properties: { caption: string } } }> } }
      }
      return json.properties.captions.items.map((i) => i.content.properties.caption)
    }
    expect(await delivered('en-US')).toEqual(['Hello', 'Only in English'])
    expect(await delivered('da-DK')).toEqual(['Hej'])
  })
})

describe(`rich text’s blocks (${dialectUnderTest})`, () => {
  test('are delivered and rendered with the page, as Umbraco delivers them', async () => {
    const { h, create, publish } = await site()
    const quote = data(QUOTE, { text: 'Quoted' })
    const key = await create([
      value('cards', list([card('Card')], [theme('x')])),
      value('body', {
        markup: `<p>Before</p><umb-rte-block data-content-key="${quote.key}"></umb-rte-block>`,
        blocks: {
          layout: { 'Umbraco.RichText': [{ contentKey: quote.key }] },
          contentData: [quote],
          settingsData: [],
          expose: [{ contentKey: quote.key, culture: null, segment: null }],
        },
      }),
    ])
    expect((await publish(key)).status).toBe(200)
    const delivered = (await (
      await h.server.fetch(
        new Request(`http://localhost/umbraco/delivery/api/v2/content/item/${key}`),
      )
    ).json()) as {
      properties: {
        body: { blocks: Array<{ content: { id: string; properties: { text: string } } }> }
      }
    }
    expect(
      delivered.properties.body.blocks.map((b) => [b.content.id, b.content.properties.text]),
    ).toEqual([[quote.key, 'Quoted']])
    const html = await (await h.server.fetch(new Request('http://localhost/'))).text()
    expect(html).toContain('<div class="quotes"><q>Quoted</q></div>')
    expect(html).toContain('<p>Before</p>')
  })
})
