/**
 * Stylesheets and scripts at addresses that change with their content (story
 * 260): `/css/site.css` is also `/css/site.<hash>.css`, kept for a year, and
 * `asset()` gives a template the hashed address of the file as it is now.
 * docs/rendering.md, "Stylesheets and scripts".
 */
import { createHash } from 'node:crypto'

/** The first eight characters of a SHA-256 over the bytes. Pure. */
export function contentHash(body: string | Uint8Array): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 8)
}

/** `/css/site.css` with a hash: `/css/site.3f9a1c2b.css`. Pure. */
export function hashedAddress(path: string, hash: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return dot > slash + 1 ? `${path.slice(0, dot)}.${hash}${path.slice(dot)}` : `${path}.${hash}`
}

/** The plain address and the hash in a hashed one, or undefined when it has none. Pure. */
export function splitHashedAddress(path: string): { path: string; hash: string } | undefined {
  const match = /^(.*\/[^/]+)\.([0-9a-f]{8})(\.[A-Za-z0-9]+)$/.exec(path)
  return match ? { path: `${match[1]}${match[3]}`, hash: match[2] as string } : undefined
}

type AssetResolver = (path: string) => string

const KEY = Symbol.for('crombolo.assets')
const shared = globalThis as Record<symbol, AssetResolver | undefined>

/** What `asset()` asks: the server's, which knows the site's files. */
export function setAssetResolver(resolve: AssetResolver | undefined): void {
  shared[KEY] = resolve
}

/**
 * The address to link a stylesheet or script by: `asset('/css/site.css')` is
 * `/css/site.3f9a1c2b.css` while the file is as it is now. A file the site
 * does not have keeps its plain address, and development says so.
 */
export function asset(path: string): string {
  return shared[KEY]?.(path) ?? path
}

type FileResolver = (path: string) => string | undefined

const FILES_KEY = Symbol.for('crombolo.files')
const sharedFiles = globalThis as Record<symbol, FileResolver | undefined>

/** What `file()` asks: the server's, which knows the published Files (story 450). */
export function setFileResolver(resolve: FileResolver | undefined): void {
  sharedFiles[FILES_KEY] = resolve
}

/**
 * The address to link a File in the content tree by: `file('/llms.txt')` is
 * that File's address while a published File answers there. A path no File
 * answers keeps its path, and development says so.
 */
export function file(path: string): string {
  return sharedFiles[FILES_KEY]?.(path) ?? path
}

/** A link to `/css/tailwind.css`, at its plain address or any hashed one. */
const LINKS_TAILWIND = /<link\b[^>]*\bhref\s*=\s*["']?\/css\/tailwind(?:\.[0-9a-f]{8})?\.css\b/i
const HEAD = /<head(?:\s[^>]*)?>/i
const STYLESHEET = /<link\b[^>]*\brel\s*=\s*["']?stylesheet\b|<style\b/i

/**
 * A page's HTML with a link to `href` in its head, before the first stylesheet
 * so the site's own rules win, or before `</head>`. A page with no head, or that
 * links the stylesheet itself, is as it was. Pure.
 */
export function withPageStylesheet(html: string, href: string): string {
  const head = HEAD.exec(html)
  if (!head || LINKS_TAILWIND.test(html)) return html
  const from = head.index + head[0].length
  const close = html.toLowerCase().indexOf('</head>', from)
  const within = html.slice(from, close < 0 ? html.length : close)
  const first = STYLESHEET.exec(within)
  const at = first ? from + first.index : close < 0 ? from : close
  return `${html.slice(0, at)}<link rel="stylesheet" href="${escapeAttribute(href)}">${html.slice(at)}`
}

const escapeAttribute = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
