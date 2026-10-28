/**
 * What a page needs to call a bundle's member and public routes (story 186):
 * the anti-forgery meta tag, and the script that sends it back.
 * `docs/bundles.md`, Part 3.
 */
import { currentAntiforgery } from './context.ts'
import { RawHtml } from './html.ts'
import { element } from './jsx-runtime.ts'

/** Where a bundle's member and public routes answer: `/crombolo/bundle/<id>/<path>`. */
export const BUNDLE_SITE_PATH = '/crombolo/bundle'

/** The header a cookie-authenticated member write carries. */
export const ANTIFORGERY_HEADER = 'Crombolo-Antiforgery'

/** The `<meta>` name `<AntiforgeryMeta />` writes and the script reads. */
export const ANTIFORGERY_META = 'crombolo-antiforgery'

export const BUNDLE_SCRIPT_PATH = '/crombolo/bundle.js'

/**
 * Writes `<meta name="crombolo-antiforgery" content="…">` while a member is
 * signed in, and nothing for a visitor. Put it in the layout's `<head>`.
 */
export function AntiforgeryMeta(): RawHtml {
  const token = currentAntiforgery()
  return token ? element('meta', { name: ANTIFORGERY_META, content: token }) : new RawHtml('')
}

/**
 * `crombolo.fetch(input, init)`: `fetch`, with the page's anti-forgery token
 * on requests to this site. Never sent to another origin.
 */
export const BUNDLE_SCRIPT = `/* crombolo bundle routes: fetch with the member's anti-forgery token */
(function () {
  var crombolo = (window.crombolo = window.crombolo || {})
  if (crombolo.fetch) return
  crombolo.fetch = function (input, init) {
    init = init || {}
    var url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href)
    var headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    var meta = document.querySelector('meta[name="${ANTIFORGERY_META}"]')
    if (url.origin === location.origin && meta && !headers.has('${ANTIFORGERY_HEADER}'))
      headers.set('${ANTIFORGERY_HEADER}', meta.getAttribute('content'))
    return fetch(input, Object.assign({ credentials: 'same-origin' }, init, { headers: headers }))
  }
})()
`
