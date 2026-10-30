/**
 * Rich text as a tree of elements (story 216), as Umbraco's
 * `ApiRichTextElementParser` writes it with `RichTextOutputAsJson` on: the
 * only form this Delivery API answers rich text in. docs/delivery-api.md,
 * "Rich text".
 *
 * Text and attribute values are kept as the stored markup has them, entities
 * and all, as Umbraco's HTML parser keeps them.
 */
import type { PublishedContent, PublishedMedia } from '@crombolo/render'
import type { ApiRoute } from './output.ts'

export interface RichTextText {
  $type?: 'RichTextTextElement'
  text: string
  tag: '#text'
}

export interface RichTextGeneric {
  $type?: 'RichTextGenericElement'
  tag: string
  attributes: Record<string, unknown>
  elements: RichTextNode[]
}

export type RichTextNode = RichTextGeneric | RichTextText

export interface RichTextRoot {
  tag: '#root'
  attributes: Record<string, unknown>
  elements: RichTextNode[]
  blocks: unknown[]
}

/** What resolving a rich text's links and images needs. */
export interface RichTextLinks {
  content(key: string): PublishedContent | undefined
  route(content: PublishedContent): ApiRoute | undefined
  /** Media by key, looked up together; missing ones are left out. */
  media(keys: readonly string[]): Promise<PublishedMedia[]>
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
/** Elements whose content is text until their closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title'])

interface ParsedElement {
  tag: string
  attributes: Array<[string, string]>
  children: Parsed[]
}
type Parsed = ParsedElement | { text: string }

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function attributesOf(source: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = (match[1] as string).toLowerCase()
    if (out.some(([existing]) => existing === name)) continue
    out.push([name, match[2] ?? match[3] ?? match[4] ?? ''])
  }
  return out
}

/** Markup as a tree, forgiving as a browser's parser is: unclosed tags close with their parent. */
export function parseMarkup(markup: string): ParsedElement {
  const root: ParsedElement = { tag: '#root', attributes: [], children: [] }
  const stack: ParsedElement[] = [root]
  const top = () => stack[stack.length - 1] as ParsedElement
  let at = 0
  while (at < markup.length) {
    const lt = markup.indexOf('<', at)
    if (lt === -1) {
      top().children.push({ text: markup.slice(at) })
      break
    }
    if (lt > at) top().children.push({ text: markup.slice(at, lt) })
    if (markup.startsWith('<!--', lt)) {
      const end = markup.indexOf('-->', lt + 4)
      at = end === -1 ? markup.length : end + 3
      continue
    }
    if (markup.startsWith('<!', lt) || markup.startsWith('<?', lt)) {
      const end = markup.indexOf('>', lt)
      at = end === -1 ? markup.length : end + 1
      continue
    }
    const close = /^<\/\s*([A-Za-z][\w:-]*)[^>]*>/.exec(markup.slice(lt))
    if (close) {
      const name = (close[1] as string).toLowerCase()
      const index = stack.map((e) => e.tag).lastIndexOf(name)
      if (index > 0) stack.length = index
      at = lt + close[0].length
      continue
    }
    const open = /^<([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(markup.slice(lt))
    if (!open) {
      top().children.push({ text: '<' })
      at = lt + 1
      continue
    }
    const tag = (open[1] as string).toLowerCase()
    const rest = open[2] as string
    const selfClosing = rest.trimEnd().endsWith('/')
    const element: ParsedElement = {
      tag,
      attributes: attributesOf(selfClosing ? rest.trimEnd().slice(0, -1) : rest),
      children: [],
    }
    top().children.push(element)
    at = lt + open[0].length
    if (RAW_TEXT.has(tag)) {
      const end = markup.toLowerCase().indexOf(`</${tag}`, at)
      const stop = end === -1 ? markup.length : end
      if (stop > at) element.children.push({ text: markup.slice(at, stop) })
      const gt = end === -1 ? -1 : markup.indexOf('>', end)
      at = gt === -1 ? markup.length : gt + 1
      continue
    }
    if (!selfClosing && !VOID.has(tag)) stack.push(element)
  }
  return root
}

/**
 * Kept unless empty or nothing but line breaks: whitespace between inline
 * elements stays, the new lines between a table's rows do not.
 */
const keeps = (text: string) => text.trim() !== '' || /[^\r\n]/.test(text)

const LOCAL_LINK =
  /^\/?(?:\{|%7B)localLink:(?:umb:\/\/(document|media)\/)?([0-9a-fA-F-]{32,36})(?:\}|%7D)(.*)$/i
const MEDIA_UDI = /^umb:\/\/media\/([0-9a-fA-F-]{32,36})$/i

/** A key in its dashed form, as Umbraco writes a GUID. */
function dashed(key: string): string | undefined {
  const hex = key.replaceAll('-', '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) return undefined
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Every media key the markup's links and images name, to look up together. */
function mediaKeys(element: ParsedElement, out = new Set<string>()): Set<string> {
  const attrs = new Map(element.attributes)
  const href = attrs.get('href')
  const link = href ? LOCAL_LINK.exec(href) : null
  if (link) {
    const key = dashed(link[2] as string)
    if (key) out.add(key)
  }
  const udi = element.tag === 'img' ? MEDIA_UDI.exec(attrs.get('data-udi') ?? '') : null
  if (udi) {
    const key = dashed(udi[1] as string)
    if (key) out.add(key)
  }
  for (const child of element.children) if ('tag' in child) mediaKeys(child, out)
  return out
}

/** A link's `href` resolved as Umbraco resolves it, or removed when it names nothing. */
function resolveLink(
  attributes: Record<string, unknown>,
  links: RichTextLinks,
  media: ReadonlyMap<string, PublishedMedia>,
): void {
  const href = attributes.href
  if (typeof href !== 'string') return
  const match = LOCAL_LINK.exec(href)
  if (!match) return
  const kind = (match[1] ?? String(attributes.type ?? '')).toLowerCase()
  const key = dashed(match[2] as string) ?? ''
  const postfix = (match[3] as string) || ''
  const page = kind === 'media' ? undefined : links.content(key)
  const route = page ? links.route(page) : undefined
  if (page && route) {
    attributes.destinationId = page.key
    attributes.destinationType = page.contentType.alias
    attributes.linkType = 'Content'
    attributes.route = { ...route, queryString: postfix || null }
    delete attributes.href
    return
  }
  const item = kind === 'document' ? undefined : media.get(key)
  if (item?.url) {
    attributes.href = item.url
    attributes.destinationId = item.key
    attributes.destinationType = item.mediaType.alias
    attributes.linkType = 'Media'
    return
  }
  delete attributes.href
}

function toNode(
  element: ParsedElement,
  links: RichTextLinks,
  media: ReadonlyMap<string, PublishedMedia>,
): Record<string, unknown> {
  const attributes: Record<string, unknown> = Object.fromEntries(element.attributes)
  resolveLink(attributes, links, media)
  if (element.tag === 'img' && typeof attributes['data-udi'] === 'string') {
    const udi = MEDIA_UDI.exec(attributes['data-udi'] as string)
    const item = udi ? media.get(dashed(udi[1] as string) ?? '') : undefined
    if (item?.url) {
      const query = String(attributes.src ?? '').split('?')[1]
      attributes.src = query ? `${item.url}?${query}` : item.url
      delete attributes['data-udi']
    }
  }
  if (
    element.tag.startsWith('umb-rte-block') &&
    typeof attributes['data-content-key'] === 'string'
  ) {
    const key = dashed(attributes['data-content-key'] as string)
    if (key) {
      attributes['content-id'] = key
      delete attributes['data-content-key']
    }
  }
  // `data-*` loses its prefix, unless an attribute of that name is already there.
  for (const name of Object.keys(attributes)) {
    if (!name.startsWith('data-')) continue
    const bare = name.slice('data-'.length)
    if (!(bare in attributes)) attributes[bare] = attributes[name]
    delete attributes[name]
  }
  const elements = element.children.flatMap((child): RichTextNode[] => {
    if ('text' in child)
      return keeps(child.text)
        ? [{ $type: 'RichTextTextElement', text: child.text, tag: '#text' }]
        : []
    return [
      {
        $type: 'RichTextGenericElement',
        ...(toNode(child, links, media) as Omit<RichTextGeneric, '$type'>),
      },
    ]
  })
  return { tag: element.tag, attributes, elements }
}

/**
 * Stored markup as the Delivery API's tree, with `blocks` beside it, or `null`
 * when there is nothing in it.
 */
export async function richTextTree(
  markup: string,
  blocks: unknown[],
  links: RichTextLinks,
): Promise<RichTextRoot | null> {
  if (markup.trim() === '' && blocks.length === 0) return null
  const parsed = parseMarkup(markup)
  const keys = [...mediaKeys(parsed)]
  const found = keys.length > 0 ? await links.media(keys) : []
  const media = new Map(found.map((item) => [item.key.toLowerCase(), item]))
  const root = toNode(parsed, links, media) as Omit<RichTextRoot, 'blocks'>
  return { tag: '#root', attributes: {}, elements: root.elements, blocks }
}
