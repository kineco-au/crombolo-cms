/**
 * Rich text as the Delivery API's tree (story 216): the cases of Umbraco's
 * `RichTextParserTests`, ported, against `richTextTree`. docs/delivery-api.md,
 * "Rich text".
 */
import { describe, expect, test } from 'bun:test'
import {
  type RichTextGeneric,
  type RichTextLinks,
  type RichTextNode,
  type RichTextRoot,
  richTextTree,
} from '@crombolo/api-delivery'
import type { PublishedContent, PublishedMedia } from '@crombolo/render'

const CONTENT = 'eed5fc6b-96fd-45a5-a0f1-b1adfb483c2f'
const ROOT = '7a3b1c55-6e1f-4f0b-9b2a-1c2d3e4f5a6b'
const MEDIA = '03b9a872-1c47-49a9-a702-6033ec78d860'
const hex = (key: string) => key.replaceAll('-', '')

const links: RichTextLinks = {
  content: (key) =>
    key === CONTENT
      ? ({ key: CONTENT, contentType: { alias: 'someAlias' } } as unknown as PublishedContent)
      : undefined,
  route: () => ({
    path: '/some-content-path',
    queryString: null,
    startItem: { id: ROOT, path: 'the-root-path' },
  }),
  media: async (keys) =>
    keys.includes(MEDIA)
      ? [{ key: MEDIA, url: '/some-media-url', mediaType: { alias: 'Image' } } as PublishedMedia]
      : [],
}

const parse = async (markup: string, blocks: unknown[] = []) =>
  (await richTextTree(markup, blocks, links)) as RichTextRoot
const generic = (node: RichTextNode | undefined) => node as RichTextGeneric
/** The only element of the only element: `<p><x/></p>` gives `x`. */
const inner = async (markup: string) =>
  generic(generic((await parse(markup)).elements[0]).elements[0])

describe('the tree', () => {
  test('the document element is called #root, and carries no $type', async () => {
    const root = await parse('<p>Hello</p>')
    expect(root.tag).toBe('#root')
    expect(root).not.toHaveProperty('$type')
    expect(root.attributes).toEqual({})
    expect(root.blocks).toEqual([])
  })

  test('a simple paragraph has a single text element, each with its $type', async () => {
    const root = await parse('<p>Some text paragraph</p>')
    expect(root.elements).toEqual([
      {
        $type: 'RichTextGenericElement',
        tag: 'p',
        attributes: {},
        elements: [{ $type: 'RichTextTextElement', text: 'Some text paragraph', tag: '#text' }],
      },
    ])
  })

  test('a paragraph with line breaks wraps its text in elements', async () => {
    const p = generic(
      (await parse('<p>Some text<br/>More text<br/>Even more text</p>')).elements[0],
    )
    expect(
      p.elements.map((e) => (e.tag === '#text' ? (e as { text: string }).text : e.tag)),
    ).toEqual(['Some text', 'br', 'More text', 'br', 'Even more text'])
    expect(generic(p.elements[1]).elements).toEqual([])
  })

  test('data attributes lose their prefix, and do not overwrite one already there', async () => {
    const span = await inner(
      '<p><span data-something="the data-something value">Text in a data-something SPAN</span></p>',
    )
    expect(span.attributes).toEqual({ something: 'the data-something value' })
    const kept = await inner(
      '<p><span something="the original something" data-something="the data something">x</span></p>',
    )
    expect(kept.attributes).toEqual({ something: 'the original something' })
  })

  test('comments are dropped', async () => {
    const p = generic((await parse('<p>some text<!-- a comment -->some more text</p>')).elements[0])
    expect(p.elements.map((e) => (e as { text: string }).text)).toEqual([
      'some text',
      'some more text',
    ])
  })

  test('nothing in it is null', async () => {
    expect(await richTextTree('', [], links)).toBeNull()
    expect(await richTextTree('   ', [], links)).toBeNull()
  })
})

describe('links', () => {
  for (const postfix of ['', '#some-anchor', '?something=true'])
    test(`a content link${postfix ? ` with ${postfix}` : ''} loses href and gains its destination and route`, async () => {
      for (const href of [
        `/{localLink:umb://document/${hex(CONTENT)}}${postfix}`,
        `/{localLink:${CONTENT}}${postfix}`,
      ]) {
        const a = await inner(`<p><a href="${href}" type="document"></a></p>`)
        expect(a.tag).toBe('a')
        expect(a.attributes).toMatchObject({
          destinationId: CONTENT,
          destinationType: 'someAlias',
          linkType: 'Content',
          route: {
            path: '/some-content-path',
            queryString: postfix || null,
            startItem: { id: ROOT, path: 'the-root-path' },
          },
        })
        expect(a.attributes).not.toHaveProperty('href')
      }
    })

  test('a content link with a historic PascalCase type still resolves', async () => {
    const a = await inner(`<p><a href="/{localLink:${hex(CONTENT)}}" type="Document"></a></p>`)
    expect(a.attributes.linkType).toBe('Content')
  })

  test('a media link has href set to the media URL, first, with its destination', async () => {
    const a = await inner(`<p><a href="/{localLink:umb://media/${hex(MEDIA)}}"></a></p>`)
    expect(Object.keys(a.attributes)).toEqual([
      'href',
      'destinationId',
      'destinationType',
      'linkType',
    ])
    expect(a.attributes).toEqual({
      href: '/some-media-url',
      destinationId: MEDIA,
      destinationType: 'Image',
      linkType: 'Media',
    })
  })

  test('a link elsewhere is left as it is, its text wrapped in a text element', async () => {
    for (const postfix of ['', '#some-anchor', '?something=true']) {
      const a = await inner(
        `<p><a href="https://some.where/else/${postfix}">This is the link text</a></p>`,
      )
      expect(a.attributes).toEqual({ href: `https://some.where/else/${postfix}` })
      expect(a.elements).toEqual([
        { $type: 'RichTextTextElement', text: 'This is the link text', tag: '#text' },
      ])
    }
  })

  test('a local link to nothing yields an empty link', async () => {
    for (const href of [
      '{localLink:umb://document/fe5bf80d37db4373adb9b206896b4a3b}',
      '{localLink:umb://media/03b9a8721c4749a9a7026033ec78d861}',
    ])
      expect((await inner(`<p><a href="/${href}"></a></p>`)).attributes).toEqual({})
  })
})

describe('images and blocks', () => {
  test('an image from the media library gets its URL, keeping its query', async () => {
    const img = await inner(
      `<p><img src="/media/whatever/something.png?rmode=max&amp;width=500" data-udi="umb://media/${hex(MEDIA)}"></p>`,
    )
    expect(img.attributes).toEqual({ src: '/some-media-url?rmode=max&amp;width=500' })
  })

  test('an image from elsewhere is left as it is', async () => {
    const img = await inner(
      '<p><img src="https://some.where/something.png?rmode=max&amp;width=500"></p>',
    )
    expect(img.attributes).toEqual({
      src: 'https://some.where/something.png?rmode=max&amp;width=500',
    })
  })

  for (const inline of [true, false])
    test(`a${inline ? 'n inline' : ''} block is its content-id, with nothing inside`, async () => {
      const tag = `umb-rte-block${inline ? '-inline' : ''}`
      const id = crypto.randomUUID()
      const block = await inner(
        `<p><${tag} data-content-key="${hex(id)}"><!--Umbraco-Block--></${tag}></p>`,
      )
      expect(block).toEqual({
        $type: 'RichTextGenericElement',
        tag,
        attributes: { 'content-id': id },
        elements: [],
      })
    })

  test('blocks inline and at block level, and the blocks list beside them', async () => {
    const [a, b] = [crypto.randomUUID(), crypto.randomUUID()]
    const items = [{ content: { id: a } }, { content: { id: b } }]
    const root = await parse(
      `<p><umb-rte-block-inline data-content-key="${hex(a)}"><!--Umbraco-Block--></umb-rte-block-inline></p><umb-rte-block data-content-key="${hex(b)}"><!--Umbraco-Block--></umb-rte-block>`,
      items,
    )
    expect(root.elements.map((e) => e.tag)).toEqual(['p', 'umb-rte-block'])
    expect(generic(generic(root.elements[0]).elements[0]).attributes).toEqual({ 'content-id': a })
    expect(generic(root.elements[1]).attributes).toEqual({ 'content-id': b })
    expect(root.blocks).toBe(items)
  })
})

describe('whitespace', () => {
  const PARAGRAPH =
    'What follows from <strong>here</strong> <em>is</em> <a href="#">just</a> a bunch of text.'
  const shape = (p: RichTextGeneric) =>
    p.elements.map((e) =>
      e.tag === '#text'
        ? (e as { text: string }).text
        : `${e.tag}:${((e as RichTextGeneric).elements[0] as { text: string }).text}`,
    )
  const expected = [
    'What follows from ',
    'strong:here',
    ' ',
    'em:is',
    ' ',
    'a:just',
    ' a bunch of text.',
  ]

  test('whitespace between inline elements is kept', async () => {
    expect(shape(generic((await parse(`<p>${PARAGRAPH}</p>`)).elements[0]))).toEqual(expected)
  })

  for (const n of [1, 2])
    for (const nl of ['\n', '\r', '\r\n']) {
      const sep = nl.repeat(n)
      test(`new lines (${JSON.stringify(sep)}) around a table's structure are dropped`, async () => {
        const table = generic(
          (await parse(`<table>${sep}<tr>${sep}<td>${PARAGRAPH}</td>${sep}</tr>${sep}</table>`))
            .elements[0],
        )
        const row = generic(table.elements[0])
        expect(table.elements).toHaveLength(1)
        expect(row.elements).toHaveLength(1)
        expect(shape(generic(row.elements[0]))).toEqual(expected)
      })

      test(`new lines (${JSON.stringify(sep)}) between paragraphs are dropped`, async () => {
        const div = generic(
          (
            await parse(
              `<div><p>${PARAGRAPH}</p>${sep}<p></p>${sep}<p>&nbsp;</p>${sep}<p>${PARAGRAPH}</p></div>`,
            )
          ).elements[0],
        )
        expect(div.elements).toHaveLength(4)
        expect(shape(generic(div.elements[0]))).toEqual(expected)
        expect(shape(generic(div.elements[3]))).toEqual(expected)
      })
    }
})
