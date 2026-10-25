/**
 * Story 184: blocks render their own components. `<Blocks>` renders each block
 * of a Block List or Block Grid with `components/blocks/<element alias>.tsx`, or
 * a template's own mapping; a missing component shows only in preview; a grid
 * is Umbraco's block-grid markup.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type BlockComponentLoader,
  type BlockItem,
  type BlockProps,
  Blocks,
  convertValue,
  type PageProps,
  Renderer,
  renderScope,
} from '@crombolo/render'
import { renderToString } from '@crombolo/render/jsx-runtime'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const TYPES: Record<string, string> = { 't-text': 'text', 't-quote': 'quote', 't-row': 'row' }
const context = {
  content: () => undefined,
  urlOf: () => '',
  contentTypeAlias: (key: string) => TYPES[key],
}

const data = (key: string, type: string, values: Record<string, unknown> = {}) => ({
  key,
  contentTypeKey: type,
  values: Object.entries(values).map(([alias, value]) => ({ alias, value })),
})

const list = convertValue(
  'Umbraco.BlockList',
  {
    layout: {
      'Umbraco.BlockList': [{ contentKey: 'a' }, { contentKey: 'b' }, { contentKey: 'c' }],
    },
    contentData: [
      data('a', 't-text', { body: 'Hello' }),
      data('b', 't-quote', { said: 'Fair winds' }),
      data('c', 't-row'),
    ],
  },
  context,
) as BlockItem[]

const Text = ({ content }: BlockProps<{ body: string }>) => <p>{content.text('body')}</p>

/**
 * Renders as a page would: with a loader for `components/blocks/`, in preview or
 * not. A thunk, because this runtime renders a component as the expression is
 * evaluated, and that has to happen inside the page's scope.
 */
function render(
  node: () => unknown,
  options: { loader?: BlockComponentLoader; preview?: boolean } = {},
) {
  const loader: BlockComponentLoader =
    options.loader ?? (async (alias) => (alias === 'text' ? (Text as never) : undefined))
  return renderScope({} as PageProps, () => renderToString(node() as never), {
    blockComponent: loader,
    preview: options.preview,
  })
}

describe('a block list', () => {
  test('renders each block with its own component, in order', async () => {
    const html = await render(() => (
      <Blocks
        items={list}
        components={{ quote: ({ content }) => <blockquote>{content.text('said')}</blockquote> }}
      />
    ))
    // `row` has no component: visitors see nothing for it.
    expect(html).toBe('<p>Hello</p><blockquote>Fair winds</blockquote>')
  })

  test('a template’s own mapping wins over the file, here only', async () => {
    const html = await render(() => (
      <Blocks items={list} components={{ text: () => <em>mine</em> }} />
    ))
    expect(html).toBe('<em>mine</em>')
  })

  test('a missing component shows a placeholder in preview, naming the file', async () => {
    const html = await render(() => <Blocks items={list} />, { preview: true })
    expect(html).toContain('<p>Hello</p>')
    expect(html).toContain('No component renders the “quote” block')
    expect(html).toContain('components/blocks/quote.tsx')
  })

  test('nothing renders for no blocks', async () => {
    expect(await render(() => <Blocks items={null} />)).toBe('')
  })
})

describe('a block grid', () => {
  const grid = convertValue(
    'Umbraco.BlockGrid',
    {
      layout: {
        'Umbraco.BlockGrid': [
          {
            contentKey: 'r',
            columnSpan: 12,
            rowSpan: 1,
            areas: [{ key: 'area-main', items: [{ contentKey: 'a', columnSpan: 6, rowSpan: 1 }] }],
          },
        ],
      },
      contentData: [data('r', 't-row'), data('a', 't-text', { body: 'Inside' })],
    },
    context,
    {
      gridColumns: 12,
      blocks: [
        {
          contentElementTypeKey: 't-row',
          areaGridColumns: 6,
          areas: [{ key: 'area-main', alias: 'main', columnSpan: 6, rowSpan: 1 }],
        },
      ],
    },
  ) as BlockItem[]

  test('is Umbraco’s markup, with each area’s blocks resolved the same way', async () => {
    const html = (await render(() => (
      <Blocks items={grid} components={{ row: ({ children }) => <section>{children}</section> }} />
    ))) as string
    expect(html).toStartWith(
      '<div class="umb-block-grid" data-grid-columns="12" style="--umb-block-grid--grid-columns: 12;"><div class="umb-block-grid__layout-container">',
    )
    expect(html).toContain('data-content-element-type-alias="row"')
    expect(html).toContain('--umb-block-grid--item-column-span: 12;')
    expect(html).toContain(
      '<section><div class="umb-block-grid__area-container" style="--umb-block-grid--area-grid-columns: 6;">',
    )
    expect(html).toContain('data-area-alias="main"')
    expect(html).toContain('--umb-block-grid--area-column-span: 6;')
    expect(html).toContain('data-content-element-type-alias="text"')
    expect(html).toContain('<p>Inside</p>')
  })
})

describe('finding a block’s component', () => {
  test('only under components/blocks/, by a plain alias', async () => {
    const root = mkdtempSync(join(process.cwd(), 'output', 'blocks-'))
    dirs.push(root)
    mkdirSync(join(root, 'blocks'), { recursive: true })
    writeFileSync(join(root, 'blocks', 'text.tsx'), 'export default () => <p>block</p>\n')
    writeFileSync(join(root, 'evil.tsx'), 'export default () => <p>outside</p>\n')
    const renderer = new Renderer({ cache: undefined as never, componentsDir: root })
    expect(typeof (await renderer.blockComponent('text'))).toBe('function')
    expect(await renderer.blockComponent('missing')).toBeUndefined()
    for (const alias of ['../evil', 'blocks/../../evil', '/etc/passwd', 'a/b', ''])
      expect(await renderer.blockComponent(alias), alias).toBeUndefined()
  })
})
