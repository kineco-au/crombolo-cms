/**
 * Navigation menus (story 141): a Menu element from the Library, built into the
 * tree a header or footer draws. Each item is a page, a media item, an address or
 * a label, with items below it. A page is read as it is now, so a renamed or
 * moved page follows; one unpublished or in the bin drops out, with the items
 * below it. docs/rendering.md, "Menus".
 */
import { keyFromReference, MENU_ALIAS_PROPERTY } from '@crombolo/core'
import type { PublishedMedia } from './media.ts'
import type { PublishedContent } from './model.ts'
import type { PublishedElement } from './values.ts'

export interface MenuItem {
  /** The item's own label, else the page's or media item's name, else the link's text or address. */
  label: string
  /** Where it goes; null for a label that only holds the items below it. */
  url: string | null
  /** `_blank` and the like, as the editor set it. */
  target: string | null
  kind: 'page' | 'media' | 'external' | 'label'
  /** The page or media item it links to. */
  key: string | null
  /** The page, for `aria-current` and the like. */
  content: PublishedContent | undefined
  children: MenuItem[]
}

export interface Menu {
  key: string
  alias: string
  items: MenuItem[]
}

/** What a menu's links resolve against: one culture's pages, and the media. */
export interface MenuLookup {
  content(key: string): PublishedContent | undefined
  media(key: string): PublishedMedia | undefined
}

interface StoredBlocks {
  layout?: Record<string, Array<{ contentKey?: string }> | undefined>
  contentData?: Array<{ key: string; values?: Array<{ alias: string; value: unknown }> }>
}

const parsed = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

function items(value: unknown, lookup: MenuLookup): MenuItem[] {
  const blocks = parsed(value) as StoredBlocks | undefined
  if (!blocks || typeof blocks !== 'object') return []
  const data = new Map((blocks.contentData ?? []).map((d) => [d.key, d]))
  return (blocks.layout?.['Umbraco.BlockList'] ?? []).flatMap((layout) => {
    const block = data.get(layout.contentKey ?? '')
    if (!block) return []
    const own = (alias: string) => block.values?.find((v) => v.alias === alias)?.value
    const item = menuItem(own('link'), text(own('label')), lookup)
    if (!item) return []
    return [{ ...item, children: items(own('children'), lookup) }]
  })
}

/** One item without its children; undefined when it links to something no longer there. */
function menuItem(
  storedLink: unknown,
  label: string,
  lookup: MenuLookup,
): Omit<MenuItem, 'children'> | undefined {
  const links = parsed(storedLink)
  const link = Array.isArray(links) ? (links[0] as Record<string, unknown> | undefined) : undefined
  if (!link)
    return label
      ? { label, url: null, target: null, kind: 'label', key: null, content: undefined }
      : undefined
  const target = text(link.target) || null
  const query = text(link.queryString)
  const key = keyFromReference(link.unique ?? link.udi)
  if (key && link.type !== 'media') {
    const content = lookup.content(key)
    if (!content?.url || content.url === '#') return undefined
    return {
      label: label || content.name,
      url: `${content.url}${query}`,
      target,
      kind: 'page',
      key: content.key,
      content,
    }
  }
  if (key) {
    const media = lookup.media(key)
    if (!media?.url) return undefined
    return {
      label: label || media.name,
      url: media.url,
      target,
      kind: 'media',
      key: media.key,
      content: undefined,
    }
  }
  const url = text(link.url)
  if (!url || !isSafe(url)) return undefined
  return {
    label: label || text(link.name) || url,
    url: `${url}${query}`,
    target,
    kind: 'external',
    key: null,
    content: undefined,
  }
}

/** An address an editor typed, unless it would run script: `javascript:` and the like. */
function isSafe(url: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return true
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

/** A Menu element as the tree it describes. Pure. */
export function buildMenu(element: PublishedElement, lookup: MenuLookup): Menu {
  const own = (alias: string) => element.properties.find((p) => p.alias === alias)?.value
  return {
    key: element.key,
    alias: text(own(MENU_ALIAS_PROPERTY)),
    items: items(own('items'), lookup),
  }
}
