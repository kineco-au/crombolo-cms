/**
 * The browser site's block editors (story 456): a Block List with settings and limits,
 * one edited inline, a Block Grid with areas, a Single Block, rich text with blocks,
 * and a page that varies by culture holding a block that does too. `serve.ts` writes
 * them into the throwaway site; the journeys under `blocks/` drive them.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BLOCK_KEYS = {
  card: 'b10c4560-0456-4000-8000-000000000001',
  cardSettings: 'b10c4560-0456-4000-8000-000000000002',
  note: 'b10c4560-0456-4000-8000-000000000003',
  columns: 'b10c4560-0456-4000-8000-000000000004',
  quote: 'b10c4560-0456-4000-8000-000000000005',
  caption: 'b10c4560-0456-4000-8000-000000000006',
  left: 'b10c4560-0456-4000-8000-0000000000a1',
  right: 'b10c4560-0456-4000-8000-0000000000a2',
} as const

/** What the journeys find these by. */
export const BLOCKS_PAGE = 'Blocks page'
export const BLOCKS_VARIANT_PAGE = 'Blocks variant page'
export const CARD_TITLE_MESSAGE = 'A card needs a title'
/** A draft saved before the rules: its second card has no title, which a save now refuses. */
export const STORED_PROBLEM_PAGE = 'Blocks saved before the rules'
/** The page it sits below. */
export const STORED_PROBLEM_HOLDER = 'Blocks kept from before'

const element = (file: string, key: string, alias: string, name: string, body: string) => [
  `schema/content-types/${file}.toml`,
  `[content-type]\nkey = "${key}"\nalias = "${alias}"\nname = "${name}"\nis-element = true\n${body}`,
]

const RICH_TEXT_EXTENSIONS = [
  'Umb.Tiptap.RichTextEssentials',
  'Umb.Tiptap.Block',
  'Umb.Tiptap.Bold',
  'Umb.Tiptap.Italic',
  'Umb.Tiptap.TrailingNode',
]

export function writeBlockSite(root: string): void {
  const k = BLOCK_KEYS
  const files: string[][] = [
    element(
      'block-card',
      k.card,
      'blockCard',
      'Card',
      `\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\nmandatory = true\nmandatory-message = "${CARD_TITLE_MESSAGE}"\n`,
    ),
    element(
      'block-card-settings',
      k.cardSettings,
      'blockCardSettings',
      'Card settings',
      '\n[[property]]\nalias = "theme"\nname = "Theme"\ntype = "textstring"\n',
    ),
    element(
      'block-note',
      k.note,
      'blockNote',
      'Note',
      '\n[[property]]\nalias = "text"\nname = "Text"\ntype = "textstring"\n',
    ),
    element('block-columns', k.columns, 'blockColumns', 'Columns', ''),
    element(
      'block-quote',
      k.quote,
      'blockQuote',
      'Quote',
      '\n[[property]]\nalias = "text"\nname = "Text"\ntype = "textstring"\n',
    ),
    element(
      'block-caption',
      k.caption,
      'blockCaption',
      'Caption',
      'varies-by-culture = true\n\n[[property]]\nalias = "caption"\nname = "Caption"\ntype = "textstring"\nvaries-by-culture = true\n',
    ),
    [
      'schema/data-types/block-cards.toml',
      `[data-type]\nalias = "blockCards"\nname = "Block cards"\neditor = "Umbraco.BlockList"\neditor-ui = "Umb.PropertyEditorUi.BlockList"\n\n[data-type.config.validationLimit]\nmin = 1\nmax = 3\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.card}"\nsettingsElementTypeKey = "${k.cardSettings}"\nlabel = "Card {=title}"\n`,
    ],
    [
      'schema/data-types/block-notes.toml',
      `[data-type]\nalias = "blockNotes"\nname = "Block notes"\neditor = "Umbraco.BlockList"\neditor-ui = "Umb.PropertyEditorUi.BlockList"\n\n[data-type.config]\nuseInlineEditingAsDefault = true\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.note}"\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.card}"\nsettingsElementTypeKey = "${k.cardSettings}"\nlabel = "Card {=title}"\n`,
    ],
    [
      'schema/data-types/block-layout.toml',
      `[data-type]\nalias = "blockLayout"\nname = "Block layout"\neditor = "Umbraco.BlockGrid"\neditor-ui = "Umb.PropertyEditorUi.BlockGrid"\n\n[data-type.config]\ngridColumns = 12\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.columns}"\nareaGridColumns = 12\nallowAtRoot = true\nallowInAreas = false\n\n[[data-type.config.blocks.areas]]\nkey = "${k.left}"\nalias = "left"\ncolumnSpan = 6\nrowSpan = 1\nmaxAllowed = 1\n\n[[data-type.config.blocks.areas.specifiedAllowance]]\nelementTypeKey = "${k.quote}"\n\n[[data-type.config.blocks.areas]]\nkey = "${k.right}"\nalias = "right"\ncolumnSpan = 6\nrowSpan = 1\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.card}"\nlabel = "Card {=title}"\nallowAtRoot = true\nallowInAreas = true\n\n[[data-type.config.blocks.columnSpanOptions]]\ncolumnSpan = 6\n\n[[data-type.config.blocks.columnSpanOptions]]\ncolumnSpan = 12\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.quote}"\nlabel = "Quote {=text}"\nallowAtRoot = false\nallowInAreas = true\n`,
    ],
    [
      'schema/data-types/block-hero.toml',
      `[data-type]\nalias = "blockHero"\nname = "Block hero"\neditor = "Umbraco.SingleBlock"\neditor-ui = "Umb.PropertyEditorUi.BlockSingle"\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.card}"\nlabel = "Card {=title}"\n`,
    ],
    [
      'schema/data-types/block-rich-text.toml',
      `[data-type]\nalias = "blockRichText"\nname = "Block rich text"\neditor = "Umbraco.RichText"\neditor-ui = "Umb.PropertyEditorUi.Tiptap"\n\n[data-type.config]\nextensions = ${JSON.stringify(RICH_TEXT_EXTENSIONS)}\ntoolbar = [[["Umb.Tiptap.Toolbar.Bold", "Umb.Tiptap.Toolbar.Italic"], ["Umb.Tiptap.Toolbar.BlockPicker"]]]\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.quote}"\nlabel = "Quote {=text}"\n`,
    ],
    [
      'schema/data-types/block-captions.toml',
      `[data-type]\nalias = "blockCaptions"\nname = "Block captions"\neditor = "Umbraco.BlockList"\neditor-ui = "Umb.PropertyEditorUi.BlockList"\n\n[[data-type.config.blocks]]\ncontentElementTypeKey = "${k.caption}"\nlabel = "Caption {=caption}"\n`,
    ],
    [
      'schema/content-types/blocks-page.toml',
      `[content-type]\nalias = "blocksPage"\nname = "${BLOCKS_PAGE}"\nallow-at-root = true\ncomponents = ["blocksPage"]\ndefault-component = "blocksPage"\n\n[[group]]\nname = "Blocks"\n\n[[group.property]]\nalias = "cards"\nname = "Cards"\ntype = "blockCards"\n\n[[group.property]]\nalias = "notes"\nname = "Notes"\ntype = "blockNotes"\n\n[[group.property]]\nalias = "layout"\nname = "Layout"\ntype = "blockLayout"\n\n[[group.property]]\nalias = "hero"\nname = "Hero"\ntype = "blockHero"\n\n[[group.property]]\nalias = "body"\nname = "Body"\ntype = "blockRichText"\n`,
    ],
    [
      'schema/content-types/blocks-holder.toml',
      '[content-type]\nalias = "blocksHolder"\nname = "Blocks holder"\nallow-at-root = true\nallow-children = ["blocksPage"]\n',
    ],
    [
      'schema/content-types/blocks-variant-page.toml',
      `[content-type]\nalias = "blocksVariantPage"\nname = "${BLOCKS_VARIANT_PAGE}"\nallow-at-root = true\ncomponents = ["blocksVariantPage"]\ndefault-component = "blocksVariantPage"\nvaries-by-culture = true\n\n[[group]]\nname = "Blocks"\n\n[[group.property]]\nalias = "captions"\nname = "Captions"\ntype = "blockCaptions"\n`,
    ],
    [
      'components/blocksPage.tsx',
      `const Card = ({ content }) => <li class="card">{content.text('title')}</li>
const Note = ({ content }) => <li class="note">{content.text('text')}</li>
const Quote = ({ content }) => <q class="quote">{content.text('text')}</q>
const Columns = () => <span class="columns" />

export default async function BlocksPage({ model }) {
  const hero = model.value('hero')
  const body = await model.value('body')
  return (
    <main>
      <ul class="cards">{(model.value('cards') ?? []).map((item) => <Card content={item.content} />)}</ul>
      <ul class="notes">{(model.value('notes') ?? []).map((item) => item.content.contentType.alias === 'blockNote' ? <Note content={item.content} /> : <Card content={item.content} />)}</ul>
      <div class="hero">{hero ? hero.content.text('title') : ''}</div>
      <div class="body">{(body?.blocks ?? []).map((item) => <Quote content={item.content} />)}</div>
      <div class="layout">{(model.value('layout') ?? []).flatMap((item) => [item.content.contentType.alias, ...item.areas.flatMap((area) => area.items.map((inner) => area.alias + ':' + (inner.content.text('text') || inner.content.text('title'))))]).join(' ')}</div>
    </main>
  )
}
`,
    ],
    [
      'components/blocksVariantPage.tsx',
      `export default function BlocksVariantPage({ model }) {
  return <main><ol>{(model.value('captions') ?? []).map((item) => <li class="caption">{item.content.text('caption')}</li>)}</ol></main>
}
`,
    ],
  ]
  for (const [path, body] of files) writeFileSync(join(root, path as string), body as string)
}
