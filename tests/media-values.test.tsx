/**
 * Story 197: values that can name media are read asynchronously, through the
 * media cache, and render what they rendered before: a picker's crops, focal
 * point and alt text, rich text's links, tree and link pickers, blocks and
 * menus. Plus `crombolo components check` finding a view that does not wait.
 */
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MENU_ALIAS_PROPERTY } from '@crombolo/core'
import {
  type BlockItem,
  Blocks,
  type CultureView,
  type Link,
  MediaCache,
  type MediaSource,
  MediaWithCrops,
  menusIn,
  PublishedContent,
  PublishedElement,
  PublishedMedia,
  type PublishedMediaNode,
  RawHtml,
  type ValueContext,
} from '@crombolo/render'
import { renderToString } from '@crombolo/render/jsx-runtime'
import { checkComponents, unawaitedMedia, withAwaitHint } from '@crombolo/server'

const HERO = '11111111-1111-4111-8111-111111111111'
const DOC = '22222222-2222-4222-8222-222222222222'
const PAGE = '33333333-3333-4333-8333-333333333333'

const heroNode: PublishedMediaNode = {
  key: HERO,
  id: 2001,
  name: 'Harbour at dusk',
  mediaTypeAlias: 'Image',
  properties: [
    {
      alias: 'umbracoFile',
      editorAlias: 'Umbraco.ImageCropper',
      culture: null,
      segment: null,
      value: {
        src: '/media/abc/hero.jpg',
        focalPoint: { left: 0.2, top: 0.3 },
        crops: [{ alias: 'wide', width: 1600, height: 900, coordinates: null }],
      },
    },
  ],
}
const docNode: PublishedMediaNode = {
  key: DOC,
  id: 2002,
  name: 'Brochure',
  mediaTypeAlias: 'File',
  properties: [
    {
      alias: 'umbracoFile',
      editorAlias: 'Umbraco.UploadField',
      culture: null,
      segment: null,
      value: '/media/def/brochure.pdf',
    },
  ],
}

function cached() {
  const queries: string[][] = []
  const source: MediaSource = {
    loadMediaByKeys: async (keys) => {
      queries.push([...keys])
      return [heroNode, docNode].filter((m) => keys.includes(m.key))
    },
    loadMediaByUrls: async () => [],
  }
  return { media: new MediaCache(source), queries }
}

const about = new PublishedContent({
  key: PAGE,
  id: 1100,
  name: 'About',
  contentTypeAlias: 'page',
  urlSegment: 'about',
  url: '/about/',
  level: 1,
  path: '-1,1100',
  sortOrder: 0,
  createDate: new Date(0),
  updateDate: new Date(0),
  componentAlias: null,
  cultures: [],
  properties: [],
  variationCulture: null,
})

function context(media: MediaCache): ValueContext<PublishedContent, PublishedMedia> {
  return {
    content: (key) => (key === PAGE ? about : undefined),
    media: (key) => media.byKey(key),
    urlOf: (content) => content.url,
    mediaUrlOf: (item) => item.url,
  }
}

const udi = (kind: string, key: string) => `umb://${kind}/${key.replaceAll('-', '')}`

function page(values: Record<string, { editor: string; value: unknown; config?: object }>) {
  const { media, queries } = cached()
  const content = new PublishedContent({
    ...about,
    key: '44444444-4444-4444-8444-444444444444',
    id: 1200,
    name: 'Home',
    contentTypeAlias: 'page',
    urlSegment: '',
    url: '/',
    path: '-1,1200',
    componentAlias: null,
    cultures: [],
    level: 1,
    sortOrder: 1,
    createDate: new Date(0),
    updateDate: new Date(0),
    variationCulture: null,
    properties: Object.entries(values).map(([alias, v]) => ({
      alias,
      editorAlias: v.editor,
      culture: null,
      segment: null,
      value: v.value,
      config: v.config as Record<string, unknown> | undefined,
    })),
  }).withValueContext(context(media) as ValueContext<PublishedContent>)
  return { content, media, queries }
}

describe('media values, read asynchronously', () => {
  test('a media picker gives each image with its crops, focal point and alt text', async () => {
    const { content, queries } = page({
      hero: {
        editor: 'Umbraco.MediaPicker3',
        value: [{ key: 'p1', mediaKey: HERO, focalPoint: { left: 0.8, top: 0.5 }, crops: [] }],
        config: { multiple: false },
      },
      gallery: {
        editor: 'Umbraco.MediaPicker3',
        value: [
          { key: 'p2', mediaKey: HERO },
          { key: 'p3', mediaKey: crypto.randomUUID() },
          { key: 'p4', mediaKey: DOC },
        ],
      },
    })
    const single = content.value('hero')
    expect(single).toBeInstanceOf(Promise)
    const hero = (await single) as MediaWithCrops
    expect(hero).toBeInstanceOf(MediaWithCrops)
    expect(hero.name).toBe('Harbour at dusk')
    expect(hero.focalPoint).toEqual({ left: 0.8, top: 0.5 })
    expect(hero.cropUrl('wide')).toBe('/media/abc/hero.jpg?rxy=0.8%2C0.5&width=1600&height=900')
    const gallery = await content.media('gallery')
    expect(gallery.map((m) => m.name)).toEqual(['Harbour at dusk', 'Brochure'])
    expect(gallery[0]?.focalPoint).toEqual({ left: 0.2, top: 0.3 })
    // One lookup for the picks read together, and the held one not looked up again
    expect(queries.flat().filter((key) => key === HERO)).toHaveLength(1)
    expect(await content.media('hero')).toHaveLength(1)
  })

  test('rich text: a page link resolves at once; a media link is looked up, and html() waits for it', async () => {
    const pageOnly = `<a href="/{localLink:${udi('document', PAGE)}}">About</a>`
    const withMedia = `${pageOnly} <a href="/{localLink:${udi('media', DOC)}}">Brochure</a> <a href="/{localLink:${crypto.randomUUID()}}">Gone</a>`
    const { content } = page({
      plain: { editor: 'Umbraco.RichText', value: pageOnly },
      linked: { editor: 'Umbraco.RichText', value: withMedia },
    })
    const now = content.html('plain')
    expect(now).toBeInstanceOf(RawHtml)
    expect((now as RawHtml).value).toBe('<a href="/about/">About</a>')
    const later = content.html('linked')
    expect(later).toBeInstanceOf(Promise)
    expect((await later).value).toBe(
      '<a href="/about/">About</a> <a href="/media/def/brochure.pdf">Brochure</a> <a href="#">Gone</a>',
    )
    // text() never waits: the page link resolves, a media link it would have to look up is #
    expect(content.text('linked')).toBe(
      '<a href="/about/">About</a> <a href="#">Brochure</a> <a href="#">Gone</a>',
    )
    // And JSX renders the promise as it is
    expect(await renderToString(<div>{content.html('linked')}</div>)).toContain(
      'href="/media/def/brochure.pdf"',
    )
  })

  test('a tree picker gives pages and media in order; a link picker resolves a media link', async () => {
    const { content } = page({
      related: {
        editor: 'Umbraco.MultiNodeTreePicker',
        value: `${udi('media', DOC)},${udi('document', PAGE)},${udi('media', crypto.randomUUID())}`,
      },
      links: {
        editor: 'Umbraco.MultiUrlPicker',
        value: [
          { name: 'Brochure', type: 'media', unique: DOC, queryString: '?v=2' },
          { name: 'About', type: 'document', unique: PAGE },
          { name: 'Gone', type: 'media', unique: crypto.randomUUID() },
          { name: 'Out', type: 'external', url: 'https://example.com' },
        ],
      },
    })
    const related = (await content.value('related')) as Array<PublishedContent | PublishedMedia>
    expect(related.map((r) => r.name)).toEqual(['Brochure', 'About'])
    expect(related[0]).toBeInstanceOf(PublishedMedia)
    const links = (await content.value('links')) as Link[]
    expect(links.map((l) => [l.name, l.url, l.type])).toEqual([
      ['Brochure', '/media/def/brochure.pdf?v=2', 'media'],
      ['About', '/about/', 'document'],
      ['Out', 'https://example.com', 'external'],
    ])
    expect(content.text('links')).toBe('')
  })

  test('a block reads its media in its own async component', async () => {
    const { media } = cached()
    const element = new PublishedElement(
      {
        key: 'b1',
        contentTypeKey: 'ct',
        contentTypeAlias: 'imageBlock',
        properties: [
          {
            alias: 'image',
            editorAlias: 'Umbraco.MediaPicker3',
            culture: null,
            segment: null,
            value: [{ key: 'p', mediaKey: HERO }],
          },
        ],
      },
      context(media) as ValueContext,
    )
    const item: BlockItem = {
      contentKey: 'b1',
      content: element,
      settingsKey: null,
      settings: null,
    }
    const html = await renderToString(
      Blocks({
        items: [item],
        components: {
          imageBlock: async ({ content }) => {
            const [image] = await content.media('image')
            return <img src={image?.url} alt={image?.name} />
          },
        },
      }),
    )
    expect(html).toBe('<img src="/media/abc/hero.jpg" alt="Harbour at dusk" />')
  })

  test('menus read their media in one lookup, before the page renders', async () => {
    const { media, queries } = cached()
    const entry = (link: unknown, label = '') => ({
      key: crypto.randomUUID(),
      values: [
        { alias: 'link', value: JSON.stringify([link]) },
        { alias: 'label', value: label },
      ],
    })
    const items = [
      entry({ unique: PAGE, type: 'document' }),
      entry({ unique: DOC, type: 'media' }, 'Our brochure'),
      entry({ unique: HERO, type: 'media' }),
    ]
    const menu = new PublishedElement({
      key: 'm1',
      contentTypeKey: 'menu',
      contentTypeAlias: 'menu',
      properties: [
        {
          alias: MENU_ALIAS_PROPERTY,
          editorAlias: 'Umbraco.TextBox',
          culture: null,
          segment: null,
          value: 'main',
        },
        {
          alias: 'items',
          editorAlias: 'Umbraco.BlockList',
          culture: null,
          segment: null,
          value: {
            layout: { 'Umbraco.BlockList': items.map((i) => ({ contentKey: i.key })) },
            contentData: items,
          },
        },
      ],
    })
    const view = {
      culture: null,
      byId: new Map(),
      byKey: new Map([[PAGE, about]]),
      elements: new Map([['m1', menu]]),
      childrenOf: new Map(),
      roots: [],
      parentIdOf: new Map(),
      settings: new Map(),
      settingsKeys: new Set(),
    } as CultureView
    const menus = await menusIn(view, media)
    expect(menus.get('main')?.items.map((i) => [i.label, i.url, i.kind])).toEqual([
      ['About', '/about/', 'page'],
      ['Our brochure', '/media/def/brochure.pdf', 'media'],
      ['Harbour at dusk', '/media/abc/hero.jpg', 'media'],
    ])
    expect(queries).toEqual([[DOC, HERO]])
  })
})

describe('`crombolo components check` and a view that does not wait', () => {
  test('flags media() indexed, read, destructured or iterated without await', () => {
    const view = `export default function Page({ model, nav }) {
  const hero = model.media('hero')[0]
  const [first] = model.media('gallery')
  const count = model.media('gallery').length
  for (const m of model.media('gallery')) console.log(m)
  const fine = await model.media('hero')
  const alsoFine = (await model.media('hero'))[0]
  const passed = model.media('hero')
  return model.media('hero').then((m) => m)
}`
    const found = unawaitedMedia(view)
    expect(found.map((f) => f.line)).toEqual([2, 3, 4, 5])
    expect(found[0]?.message).toContain("(await model.media('hero'))")
    expect(found[0]?.message).toContain('async component')
  })

  test('reports such a view as a problem, naming the file, the line and the change', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'unawaited-'))
    try {
      mkdirSync(join(root, 'components', 'pages'), { recursive: true })
      writeFileSync(
        join(root, 'components', 'pages', 'home.tsx'),
        `export default function Home({ model }) {
  const hero = model.media('hero')[0]
  return <img src={hero?.url} />
}
`,
      )
      writeFileSync(
        join(root, 'components', 'pages', 'fixed.tsx'),
        `export default async function Fixed({ model }) {
  const [hero] = await model.media('hero')
  return <img src={hero?.url} />
}
`,
      )
      const report = await checkComponents({
        componentsDir: join(root, 'components'),
        siteDir: root,
      })
      expect(report.problems).toEqual([
        {
          file: join('components', 'pages', 'home.tsx:2'),
          message: expect.stringContaining("(await model.media('hero'))"),
        },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("adds the change to make to the type checker's message", () => {
    const line =
      "components/home.tsx(4,9): error TS2339: Property 'url' does not exist on type 'Promise<MediaWithCrops[]>'."
    expect(withAwaitHint(line)).toContain('await them in an async component')
    expect(withAwaitHint('components/home.tsx(1,1): error TS1005')).toBe(
      'components/home.tsx(1,1): error TS1005',
    )
  })
})
