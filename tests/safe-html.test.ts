/**
 * Story 330: an extension component's HTML carries no script into the page.
 * The rule is the HTML Sanitizer API's safe baseline, the part of \`setHTML()\`
 * no configuration turns off, and this suite holds the standard's lists so the
 * copy in \`safe-html-lists.ts\` cannot drift from them.
 */
import { describe, expect, test } from 'bun:test'
import {
  BASELINE_REMOVE_ELEMENTS,
  EVENT_HANDLER_ATTRIBUTES,
  isJavascriptUrl,
  sanitiseHtml,
} from '@crombolo/render'

/** WICG/sanitizer-api builtins at c56c3d7a95e5: what the lists in code must be. */
const SPEC_REMOVE_ELEMENTS = [
  ['html', 'embed'],
  ['html', 'frame'],
  ['html', 'iframe'],
  ['html', 'object'],
  ['html', 'script'],
  ['svg', 'script'],
  ['svg', 'use'],
]
const SPEC_EVENT_HANDLERS = [
  'onafterprint',
  'onauxclick',
  'onbeforeinput',
  'onbeforematch',
  'onbeforeprint',
  'onbeforeunload',
  'onbeforetoggle',
  'onblur',
  'oncancel',
  'oncanplay',
  'oncanplaythrough',
  'onchange',
  'onclick',
  'onclose',
  'oncontextlost',
  'oncontextmenu',
  'oncontextrestored',
  'oncopy',
  'oncuechange',
  'oncut',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondragstart',
  'ondrop',
  'ondurationchange',
  'onemptied',
  'onended',
  'onerror',
  'onfocus',
  'onformdata',
  'onhashchange',
  'oninput',
  'oninvalid',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onlanguagechange',
  'onload',
  'onloadeddata',
  'onloadedmetadata',
  'onloadstart',
  'onmessage',
  'onmessageerror',
  'onmousedown',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onoffline',
  'ononline',
  'onpagehide',
  'onpagereveal',
  'onpageshow',
  'onpageswap',
  'onpaste',
  'onpause',
  'onplay',
  'onplaying',
  'onpopstate',
  'onprogress',
  'onratechange',
  'onreset',
  'onresize',
  'onrejectionhandled',
  'onscroll',
  'onscrollend',
  'onsecuritypolicyviolation',
  'onseeked',
  'onseeking',
  'onselect',
  'onslotchange',
  'onstalled',
  'onstorage',
  'onsubmit',
  'onsuspend',
  'ontimeupdate',
  'ontoggle',
  'onunhandledrejection',
  'onunload',
  'onvolumechange',
  'onwaiting',
  'onwheel',
]

const clean = (html: string) => {
  const removed: string[] = []
  return { html: sanitiseHtml(html, (kind, name) => removed.push(`${kind} ${name}`)), removed }
}

describe('the lists', () => {
  test('are the standard’s, entry for entry', () => {
    expect(BASELINE_REMOVE_ELEMENTS.map((entry) => [entry.namespace, entry.name])).toEqual(
      SPEC_REMOVE_ELEMENTS,
    )
    expect([...EVENT_HANDLER_ATTRIBUTES]).toEqual(SPEC_EVENT_HANDLERS)
  })
})

describe('what is taken out', () => {
  test('a removed element goes with everything inside it, nested or not', () => {
    expect(clean('<p>a</p><script>alert(1)</script><p>b</p>').html).toBe('<p>a</p><p>b</p>')
    expect(clean('<iframe src="x"><p>in</p></iframe>ok').html).toBe('ok')
    expect(clean('<object><object>x</object><p>y</p></object>ok').html).toBe('ok')
    expect(clean('<embed src="x.swf">ok<frame src="x">').html).toBe('ok')
    expect(clean('<SCRIPT>x</SCRIPT>ok').html).toBe('ok')
  })

  test('script and use in SVG, and nothing else of it', () => {
    expect(clean('<svg><script>x</script><use href="#a"/><circle r="1"/></svg>').html).toBe(
      '<svg><circle r="1" /></svg>',
    )
  })

  test('every event handler attribute, whatever its case or element', () => {
    const { html, removed } = clean(
      '<img src="a.png" onerror="x()"><b ONCLICK="x()" class="k">b</b>',
    )
    expect(html).toBe('<img src="a.png"><b class="k">b</b>')
    expect(removed).toEqual(['attribute img onerror', 'attribute b onclick'])
  })

  test('a javascript: URL on a navigating attribute, however it is written', () => {
    for (const value of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java&#115;cript:alert(1)',
      'java&#x73;cript&colon;alert(1)',
      '&#106;avascript:alert(1)',
    ])
      expect([value, clean(`<a href="${value}">x</a>`).html]).toEqual([value, '<a>x</a>'])
    expect(clean('<form action="javascript:x()"></form>').html).toBe('<form></form>')
    expect(clean('<button formaction="javascript:x()">b</button>').html).toBe('<button>b</button>')
    expect(clean('<svg><a xlink:href="javascript:x()">s</a></svg>').html).toBe(
      '<svg><a>s</a></svg>',
    )
    expect(clean('<math><mi href="javascript:x()">m</mi></math>').html).toBe(
      '<math><mi>m</mi></math>',
    )
    expect(clean('<svg><set attributeName="href" to="javascript:x()"/></svg>').html).toBe(
      '<svg><set to="javascript:x()" /></svg>',
    )
  })

  test('isJavascriptUrl reads a URL as the parser does', () => {
    expect(isJavascriptUrl('\u0001javascript:x')).toBe(true)
    expect(isJavascriptUrl('https://example.com/javascript:x')).toBe(false)
    expect(isJavascriptUrl('/path')).toBe(false)
  })
})

describe('what stays', () => {
  test('a page’s own markup, classes, styles and images, byte for byte', () => {
    const page =
      '<article class="brochure" id="top" style="color: red"><h1>Spring</h1>' +
      '<img src="/media/a.jpg" srcset="/media/a.jpg 2x" alt="A" loading="lazy">' +
      '<a href="/about" target="_blank" rel="noopener">About</a>' +
      '<style>.brochure { color: blue }</style><!-- a note --></article>'
    expect(clean(page)).toEqual({ html: page, removed: [] })
  })

  test('a style element’s content is CSS, not markup', () => {
    expect(clean('<style>a::before { content: "<script>" }</style>').html).toBe(
      '<style>a::before { content: "<script>" }</style>',
    )
  })

  test('a tag that never closes cannot run on into the page’s own markup', () => {
    expect(clean('<p>ok</p><a href="javascript:x()" ').html).toBe(
      '<p>ok</p>&lt;a href="javascript:x()" ',
    )
  })
})
