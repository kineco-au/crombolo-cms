/**
 * Live reload in development (story 214): the script a page carries, and where
 * it listens. The server streams a `hello` with its boot id on each connection,
 * `reload` when the views, the schema or the content change, and `types` with
 * the background type check's findings, and `styles` with a stylesheet that does
 * not compile. docs/writing-components.md, "The development loop".
 */

export const LIVE_RELOAD_SCRIPT_PATH = '/crombolo/dev/live.js'
export const LIVE_EVENTS_PATH = '/crombolo/dev/events'

/** What changed; a `reload` event carries each in its burst as `reasons`. */
export type LiveChange = 'views' | 'schema' | 'content' | 'styles'

/** The site's `css/tailwind.css` does not compile (story 452), in a `styles` event; none clears its banner. */
export interface LiveStyles {
  problem?: { file?: string; line?: number; message: string }
}

/** The background type check's findings, in a `types` event; no errors clears the banner. */
export interface LiveTypes {
  count: number
  first?: { file: string; line: number; message: string }
}

/**
 * Reloads the page on a `reload`, or on a `hello` from a server that restarted,
 * and keeps dismissible banners of type errors and of a stylesheet that does not
 * compile. Plain DOM, styled through the CSSOM, so a strict content security
 * policy allows it.
 */
export const LIVE_RELOAD_SCRIPT = `/* crombolo: live reload in development */
(function () {
  if (window.__cromboloLive) return
  window.__cromboloLive = true
  var boot = null
  var banners = {}
  var events = new EventSource('${LIVE_EVENTS_PATH}')
  events.addEventListener('hello', function (event) {
    var id = JSON.parse(event.data).boot
    if (boot !== null && boot !== id) location.reload()
    boot = id
  })
  events.addEventListener('reload', function () {
    location.reload()
  })
  function show(kind, message, place) {
    if (banners[kind]) banners[kind].remove()
    banners[kind] = null
    if (!message) return
    var banner = document.createElement('div')
    banner.setAttribute('role', 'status')
    banner.setAttribute('data-crombolo-live', kind)
    banner.style.cssText = 'position:fixed;left:1rem;right:1rem;' + place + ':1rem;z-index:2147483647;display:flex;gap:1rem;align-items:flex-start;padding:.75rem 1rem;border-radius:.5rem;background:#3b1219;color:#fff;font:14px/1.4 ui-monospace,monospace;box-shadow:0 4px 16px rgba(0,0,0,.3)'
    var text = document.createElement('div')
    text.style.cssText = 'flex:1;white-space:pre-wrap'
    text.textContent = message
    var close = document.createElement('button')
    close.type = 'button'
    close.textContent = '\\u00d7'
    close.setAttribute('aria-label', 'Dismiss')
    close.style.cssText = 'background:none;border:0;color:inherit;font-size:1.25rem;line-height:1;cursor:pointer'
    close.addEventListener('click', function () {
      banner.remove()
      if (banners[kind] === banner) banners[kind] = null
    })
    banner.append(text, close)
    document.body.append(banner)
    banners[kind] = banner
  }
  events.addEventListener('types', function (event) {
    var types = JSON.parse(event.data)
    var first = types.first
    show('types', types.count ? types.count + (types.count === 1 ? ' type error' : ' type errors') +
      (first ? '\\n' + first.file + ':' + first.line + '  ' + first.message : '') : '', 'bottom')
  })
  events.addEventListener('styles', function (event) {
    var problem = JSON.parse(event.data).problem
    show('styles', problem ? 'The stylesheet did not compile, so the last good one is served\\n' +
      (problem.file ? problem.file + (problem.line ? ':' + problem.line : '') + '  ' : '') + problem.message : '', 'top')
  })
})()
`

/** The tag that loads the script. */
export const LIVE_RELOAD_TAG = `<script src="${LIVE_RELOAD_SCRIPT_PATH}" defer></script>`

/** A page's HTML with the live-reload script before `</body>`, or at the end when it has none. */
export function withLiveReload(html: string): string {
  const at = html.toLowerCase().lastIndexOf('</body>')
  return at < 0
    ? `${html}${LIVE_RELOAD_TAG}`
    : `${html.slice(0, at)}${LIVE_RELOAD_TAG}${html.slice(at)}`
}
