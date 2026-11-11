/**
 * The HTML Sanitizer API's built-in safe baseline (story 330), copied from the
 * standard's own data so the rule is the standard's, not ours: what every safe
 * `setHTML()` removes whatever else it is told to keep.
 *
 * Source: WICG/sanitizer-api `builtins/safe-baseline-configuration.json` and
 * `builtins/event-handler-content-attributes.txt` at c56c3d7a95e5 (2026-08-31),
 * merged into WHATWG HTML, "HTML sanitization"
 * (https://html.spec.whatwg.org/#html-sanitization). Copied 2026-11-11.
 * `tests/safe-html.test.ts` holds a copy of each list and fails when they part.
 */

export const HTML_NS = 'html'
export const SVG_NS = 'svg'
export const MATHML_NS = 'math'

/** `removeElements`: each removed with everything inside it, by namespace. */
export const BASELINE_REMOVE_ELEMENTS: readonly { namespace: string; name: string }[] = [
  { namespace: HTML_NS, name: 'embed' },
  { namespace: HTML_NS, name: 'frame' },
  { namespace: HTML_NS, name: 'iframe' },
  { namespace: HTML_NS, name: 'object' },
  { namespace: HTML_NS, name: 'script' },
  { namespace: SVG_NS, name: 'script' },
  { namespace: SVG_NS, name: 'use' },
]

/** Every event handler content attribute, which safe sanitization always removes. */
export const EVENT_HANDLER_ATTRIBUTES: readonly string[] = [
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

/**
 * The built-in navigating URL attributes: an element's attribute that is
 * dropped when its value is a `javascript:` URL. HTML's entries come from each
 * element's definition (`a`, `area` `href`; `form` `action`; `button`, `input`
 * `formaction`); SVG's from the table. MathML's `href` is checked on any element.
 */
export const NAVIGATING_URL_ATTRIBUTES: readonly {
  namespace: string
  element: string
  attribute: string
}[] = [
  { namespace: HTML_NS, element: 'a', attribute: 'href' },
  { namespace: HTML_NS, element: 'area', attribute: 'href' },
  { namespace: HTML_NS, element: 'form', attribute: 'action' },
  { namespace: HTML_NS, element: 'button', attribute: 'formaction' },
  { namespace: HTML_NS, element: 'input', attribute: 'formaction' },
  { namespace: SVG_NS, element: 'a', attribute: 'href' },
  { namespace: SVG_NS, element: 'a', attribute: 'xlink:href' },
]

/** The built-in animating URL attributes: dropped when they would animate `href`. */
export const ANIMATING_URL_ATTRIBUTES: readonly { element: string; attribute: string }[] = [
  { element: 'animate', attribute: 'attributeName' },
  { element: 'animateTransform', attribute: 'attributeName' },
  { element: 'set', attribute: 'attributeName' },
]
