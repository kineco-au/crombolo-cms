/**
 * An extension component's HTML with what can run script taken out (story
 * 330), by the HTML Sanitizer API's safe baseline (`safe-html-lists.ts`): the
 * elements it removes with what is inside them, every event handler attribute,
 * and a `javascript:` URL on a navigating or animating attribute. Everything
 * else, classes, styles and images included, is kept as written.
 *
 * One pass over the string that builds no tree: tags and their attributes are
 * read, text is copied as it is. A `<` that opens no tag the browser would
 * close is written as `&lt;`, so markup cut short cannot run on into the page's
 * own. docs/extensions.md, "Components".
 */
import {
  ANIMATING_URL_ATTRIBUTES,
  BASELINE_REMOVE_ELEMENTS,
  EVENT_HANDLER_ATTRIBUTES,
  HTML_NS,
  MATHML_NS,
  NAVIGATING_URL_ATTRIBUTES,
  SVG_NS,
} from './safe-html-lists.ts'

/** What was taken out, for the log: an element, or an attribute on one. */
export type SafeHtmlReport = (kind: 'element' | 'attribute', name: string) => void

const HANDLERS = new Set(EVENT_HANDLER_ATTRIBUTES)
const REMOVED = new Set(BASELINE_REMOVE_ELEMENTS.map((entry) => `${entry.namespace} ${entry.name}`))
const NAVIGATING = new Set(
  NAVIGATING_URL_ATTRIBUTES.map(
    (entry) => `${entry.namespace} ${entry.element} ${entry.attribute}`,
  ),
)
const ANIMATING = new Set(
  ANIMATING_URL_ATTRIBUTES.map(
    (entry) => `${entry.element.toLowerCase()} ${entry.attribute.toLowerCase()}`,
  ),
)
/** Elements whose content is text up to their end tag, not markup. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'noembed',
  'noframes',
  'iframe',
  'noscript',
  'plaintext',
])
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

const NAMED: Readonly<Record<string, string>> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  sol: '/',
  lpar: '(',
  rpar: ')',
}

/** An attribute's value as the browser reads it: character references decoded. */
function decodeReferences(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code =
        ref[1]?.toLowerCase() === 'x' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return NAMED[ref.toLowerCase()] ?? whole
  })
}

/** Whether a URL is a `javascript:` one, as the URL parser would read it. */
export function isJavascriptUrl(value: string): boolean {
  let read = decodeReferences(value)
  // The parser strips leading and trailing C0 controls and spaces, and every tab and newline.
  let start = 0
  let end = read.length
  while (start < end && read.charCodeAt(start) <= 0x20) start++
  while (end > start && read.charCodeAt(end - 1) <= 0x20) end--
  read = read.slice(start, end).replace(/[\t\n\r]/g, '')
  return /^javascript:/i.test(read)
}

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

interface Tag {
  name: string
  /** As written, up to and including its `>`. */
  raw: string
  end: number
  closing: boolean
  selfClosing: boolean
  attributes: { name: string; value: string | undefined; raw: string }[]
}

/** A tag starting at `at`, or undefined when what is there is not one the browser would close. */
function readTag(html: string, at: number): Tag | undefined {
  const match = /^<(\/?)([A-Za-z][^\s/>]*)/.exec(html.slice(at, at + 256))
  if (!match) return undefined
  let i = at + match[0].length
  let quote: string | undefined
  for (; i < html.length; i++) {
    const c = html[i]
    if (quote) {
      if (c === quote) quote = undefined
    } else if (c === '"' || c === "'") {
      // Only a quote after `=` opens a value.
      if (/=\s*$/.test(html.slice(Math.max(at, i - 32), i))) quote = c
    } else if (c === '>') break
  }
  if (i >= html.length) return undefined
  const raw = html.slice(at, i + 1)
  const inside = raw.slice(match[0].length, -1)
  const attributes: Tag['attributes'] = []
  for (const found of inside.matchAll(ATTRIBUTE)) {
    const value = found[2] ?? found[3] ?? found[4]
    attributes.push({ name: (found[1] as string).toLowerCase(), value, raw: found[0] })
  }
  return {
    name: (match[2] as string).toLowerCase(),
    raw,
    end: i + 1,
    closing: match[1] === '/',
    selfClosing: /\/\s*$/.test(inside),
    attributes,
  }
}

/** Where the end tag of a raw-text element starts, or the end of the string. */
function rawEnd(html: string, from: number, name: string): number {
  const found = html.slice(from).search(new RegExp(`</${name}[\\s/>]`, 'i'))
  return found === -1 ? html.length : from + found
}

/** Where the element opened at `from` ends, its own end tag included, counting nested ones. */
function elementEnd(html: string, from: number, name: string): number {
  let depth = 1
  const pattern = new RegExp(`<(/?)${name}(?=[\\s/>])[^>]*>`, 'gi')
  pattern.lastIndex = from
  for (let found = pattern.exec(html); found; found = pattern.exec(html)) {
    if (found[1] === '/') depth--
    else if (!/\/\s*>$/.test(found[0])) depth++
    if (depth === 0) return found.index + found[0].length
  }
  return html.length
}

export function sanitiseHtml(html: string, report: SafeHtmlReport = () => {}): string {
  let out = ''
  let i = 0
  /** Foreign content, innermost last: SVG and MathML change what a name means. */
  const foreign: string[] = []
  const namespace = () => foreign.at(-1) ?? HTML_NS
  while (i < html.length) {
    const next = html.indexOf('<', i)
    if (next === -1) {
      out += html.slice(i)
      break
    }
    out += html.slice(i, next)
    i = next
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4)
      const stop = close === -1 ? html.length : close + 3
      out += html.slice(i, stop)
      i = stop
      continue
    }
    if (/^<[!?]/.test(html.slice(i, i + 2))) {
      const close = html.indexOf('>', i)
      const stop = close === -1 ? html.length : close + 1
      out += html.slice(i, stop)
      i = stop
      continue
    }
    const tag = readTag(html, i)
    if (!tag) {
      out += '&lt;'
      i += 1
      continue
    }
    const ns = tag.name === 'svg' ? SVG_NS : tag.name === 'math' ? MATHML_NS : namespace()
    if (tag.closing) {
      if ((tag.name === 'svg' || tag.name === 'math') && foreign.at(-1) === tag.name) foreign.pop()
      out += tag.raw
      i = tag.end
      continue
    }
    if (REMOVED.has(`${ns} ${tag.name}`)) {
      report('element', tag.name)
      i =
        VOID.has(tag.name) || tag.selfClosing
          ? tag.end
          : RAW_TEXT.has(tag.name)
            ? Math.min(html.length, elementEnd(html, rawEnd(html, tag.end, tag.name), tag.name))
            : elementEnd(html, tag.end, tag.name)
      continue
    }
    const kept: string[] = []
    for (const attribute of tag.attributes) {
      const value = attribute.value ?? ''
      const dropped =
        HANDLERS.has(attribute.name) ||
        (NAVIGATING.has(`${ns} ${tag.name} ${attribute.name}`) && isJavascriptUrl(value)) ||
        (ns === MATHML_NS &&
          (attribute.name === 'href' || attribute.name === 'xlink:href') &&
          isJavascriptUrl(value)) ||
        (ns === SVG_NS &&
          ANIMATING.has(`${tag.name} ${attribute.name}`) &&
          /^(xlink:)?href$/i.test(decodeReferences(value).trim()))
      if (dropped) report('attribute', `${tag.name} ${attribute.name}`)
      else kept.push(attribute.raw)
    }
    const written = tag.raw.slice(0, 1 + tag.name.length).toLowerCase()
    out += `${written}${kept.length > 0 ? ` ${kept.join(' ')}` : ''}${tag.selfClosing ? ' /' : ''}>`
    i = tag.end
    if ((tag.name === 'svg' || tag.name === 'math') && !tag.selfClosing) foreign.push(tag.name)
    // A raw-text element's content is text, not markup: copied up to its end tag.
    if (ns === HTML_NS && RAW_TEXT.has(tag.name) && !tag.selfClosing) {
      const stop = rawEnd(html, i, tag.name)
      out += html.slice(i, stop)
      i = stop
    }
  }
  return out
}
