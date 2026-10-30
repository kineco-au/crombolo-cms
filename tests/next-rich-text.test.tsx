/** @jsxImportSource react */
/**
 * Story 216: rich text as the Delivery API's tree in an app. The client's
 * `walkRichText` and `decodeEntities`, and the Next integration's `<RichText>`
 * rendering the tree with components per tag and per block.
 */
import { describe, expect, mock, test } from 'bun:test'
import { richTextTree } from '@crombolo/api-delivery'
import { decodeEntities, type RichTextValue, walkRichText } from '@crombolo/delivery-client'
import type { PublishedContent } from '@crombolo/render'
import type { ReactElement, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

mock.module('next/headers', () => ({ draftMode: async () => ({ isEnabled: false }) }))
mock.module('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => (
    <a data-next-link="" href={href} {...rest}>
      {children}
    </a>
  ),
}))
const { RichText } = await import('@crombolo/next-integration/components')

const PAGE = 'eed5fc6b-96fd-45a5-a0f1-b1adfb483c2f'
const BLOCK = '1c2d3e4f-5a6b-4c7d-8e9f-a0b1c2d3e4f5'

/** A tree as the Delivery API writes it, with one page to link to. */
const tree = async (markup: string, blocks: unknown[] = []) =>
  (await richTextTree(markup, blocks, {
    content: (key) =>
      key === PAGE
        ? ({ key, contentType: { alias: 'article' } } as unknown as PublishedContent)
        : undefined,
    route: () => ({
      path: '/news/story/',
      queryString: null,
      startItem: { id: PAGE, path: 'home' },
    }),
    media: async () => [],
  })) as unknown as RichTextValue

/** The markup, without the preload hints React DOM adds for images. */
const html = (node: ReactElement) =>
  renderToStaticMarkup(node).replace(/<link rel="preload"[^>]*>/g, '')

describe('decodeEntities', () => {
  test('named and numbered entities become characters; unknown ones stay', () => {
    expect(decodeEntities('Fish &amp; chips&nbsp;&#8212;&#x2014; &lt;b&gt; &bogus; &')).toBe(
      'Fish & chips —— <b> &bogus; &',
    )
  })
})

describe('walkRichText', () => {
  test('folds the tree children first, tags through their own visitor, blocks by content-id', async () => {
    const value = await tree(
      `<p>Read <a href="/{localLink:umb://document/${PAGE.replaceAll('-', '')}}">this</a></p><umb-rte-block data-content-key="${BLOCK}"></umb-rte-block><umb-rte-block data-content-key="${crypto.randomUUID()}"></umb-rte-block>`,
      [{ content: { id: BLOCK, contentType: 'quote', properties: {} }, settings: null }],
    )
    const out = walkRichText<string>(value, {
      text: (node) => node.text,
      element: (node, children) => `<${node.tag}>${children.join('')}</${node.tag}>`,
      block: (item, node) => `[${item?.content?.contentType ?? 'none'} ${node.tag}]`,
      tags: { a: (node, children) => `{${node.attributes.route?.path} ${children.join('')}}` },
    })
    expect(out).toEqual([
      '<p>Read {/news/story/ this}</p>',
      '[quote umb-rte-block]',
      '[none umb-rte-block]',
    ])
  })
})

describe('<RichText>', () => {
  test('renders each tag, with text and attributes decoded, and nothing for no value', async () => {
    const value = await tree(
      '<h2 class="lead" style="font-weight: bold; --accent: red">Fish &amp; chips</h2><p>One<br>two <img src="/x.jpg?a=1&amp;b=2" alt="A &quot;b&quot;" onerror="alert(1)"></p>',
    )
    expect(html(<RichText value={value} className="prose" />)).toBe(
      '<div class="prose"><h2 class="lead" style="font-weight:bold;--accent:red">Fish &amp; chips</h2><p>One<br/>two <img src="/x.jpg?a=1&amp;b=2" alt="A &quot;b&quot;"/></p></div>',
    )
    expect(html(<RichText value={null} />)).toBe('')
  })

  test('a link to a page is a Next link to its route; media and elsewhere are plain links', async () => {
    const value = await tree(
      `<p><a href="/{localLink:umb://document/${PAGE.replaceAll('-', '')}}#part" title="Go">story</a> <a href="https://example.com/" target="_blank">out</a></p>`,
    )
    expect(html(<RichText value={value} />)).toBe(
      '<div><p><a data-next-link="" href="/news/story/#part" title="Go">story</a> <a href="https://example.com/" target="_blank">out</a></p></div>',
    )
  })

  test('a tag through its own component, and a block through its element type', async () => {
    const value = await tree(
      `<p>See <a href="https://example.com/">this</a></p><umb-rte-block data-content-key="${BLOCK}"></umb-rte-block>`,
      [
        {
          content: { id: BLOCK, contentType: 'quote', properties: { text: 'Hi' } },
          settings: null,
        },
      ],
    )
    const out = html(
      <RichText
        value={value}
        components={{
          a: ({ node, children }) => <span data-href={node.attributes.href}>{children}</span>,
        }}
        blocks={{
          quote: ({ content }: { content: { properties: { text: string } } }) => (
            <blockquote>{content.properties.text}</blockquote>
          ),
        }}
      />,
    )
    expect(out).toBe(
      '<div><p>See <span data-href="https://example.com/">this</span></p><blockquote>Hi</blockquote></div>',
    )
  })
})
