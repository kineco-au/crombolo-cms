/**
 * Deferred parts (story 263). A view module whose first statement is
 * `'use deferred'` renders in a request of its own, for the visitor: in the
 * page it is a placeholder holding its `fallback`, so the page stays the same
 * for everyone, and `/crombolo/deferred.js` fetches each part and puts it in.
 * docs/rendering.md, "Deferred parts".
 */
import { basename } from 'node:path'
import { contentHash, hashedAddress } from './assets.ts'
import { currentDeferred, currentPlace } from './context.ts'
import { escapeHtml, RawHtml } from './html.ts'
import { hasDirective, serializeProps } from './islands.ts'
import { type Child, renderToString } from './jsx-runtime.ts'
import type { SnapshotTransform } from './snapshots.ts'

/** Where a part is rendered for the visitor. */
export const DEFERRED_PATH = '/crombolo/deferred'
/** The script every page with a part links to. */
export const DEFERRED_LOADER_PATH = '/crombolo/deferred.js'

/** What a render does with the parts it meets: placeholders, or, inside a part's own request, the parts. */
export interface DeferredScope {
  inPart: boolean
  /** Signs a placeholder's address, so a visitor cannot change what it renders. */
  sign(data: string): string
  /** Set once the page holds a placeholder, so the loader is linked. */
  used: boolean
}

/** What a placeholder's address names. */
export interface DeferredRequest {
  module: string
  exportName: string
  /** The page it sits on, for `usePage()`. */
  key: string
  culture: string | null
  props: Record<string, unknown>
}

export function isDeferredModule(source: string): boolean {
  return hasDirective(source, 'use deferred')
}

/** Where a part's own source is kept in a snapshot, beside the stub that imports it. */
export function deferredSourceKey(key: string): string {
  return key.replace(/(\.[jt]sx?)$/, '.deferred-source$1')
}

export function isDeferredSource(path: string): boolean {
  return /\.deferred-source\.[jt]sx?$/.test(path)
}

const transpiler = new Bun.Transpiler({ loader: 'tsx' })

/** What a deferred module is written as in a snapshot: each export a placeholder, over the source beside it. */
export function deferredStub(key: string, source: string): string {
  const { exports } = transpiler.scan(source)
  const lines = [
    `// The page half of ${key} ('use deferred', story 263).`,
    `import * as part from ${JSON.stringify(`./${basename(deferredSourceKey(key))}`)}`,
  ]
  for (const name of exports) {
    const call = `(props) => globalThis[Symbol.for("crombolo.deferred")](${JSON.stringify(key)}, ${JSON.stringify(name)}, props, part[${JSON.stringify(name)}])`
    lines.push(name === 'default' ? `export default ${call}` : `export const ${name} = ${call}`)
  }
  return `${lines.join('\n')}\n`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The snapshot transform for a deferred module, or undefined for any other file. */
export function deferredTransform(key: string, bytes: Uint8Array): SnapshotTransform | undefined {
  if (!/\.[jt]sx?$/.test(key)) return undefined
  const source = decoder.decode(bytes)
  if (!isDeferredModule(source)) return undefined
  return { bytes: encoder.encode(deferredStub(key, source)), beside: deferredSourceKey(key) }
}

const base64url = (text: string) => Buffer.from(text, 'utf8').toString('base64url')

/** A part's address: what it renders, signed. */
export function deferredAddress(request: DeferredRequest, sign: (data: string) => string): string {
  const data = base64url(
    JSON.stringify({
      m: request.module,
      e: request.exportName,
      k: request.key,
      c: request.culture,
      p: request.props,
    }),
  )
  return `${DEFERRED_PATH}?d=${data}&s=${sign(data)}`
}

/** What a part's address names, or undefined when it was not signed here. */
export function readDeferredAddress(
  search: URLSearchParams,
  verify: (data: string, signature: string) => boolean,
): DeferredRequest | undefined {
  const data = search.get('d')
  const signature = search.get('s')
  if (!data || !signature || !verify(data, signature)) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (
      typeof parsed.m !== 'string' ||
      typeof parsed.e !== 'string' ||
      typeof parsed.k !== 'string'
    )
      return undefined
    return {
      module: parsed.m,
      exportName: parsed.e,
      key: parsed.k,
      culture: typeof parsed.c === 'string' ? parsed.c : null,
      props: parsed.p && typeof parsed.p === 'object' ? parsed.p : {},
    }
  } catch {
    return undefined
  }
}

type PartComponent = (props: Record<string, unknown>) => Child

/** What a deferred module's stub calls: the placeholder, or the part itself in its own request. */
async function renderDeferred(
  module: string,
  exportName: string,
  props: Record<string, unknown> | undefined,
  component: PartComponent | undefined,
): Promise<RawHtml> {
  if (typeof component !== 'function')
    throw new Error(`${module} has no export "${exportName}" a page can render.`)
  const { fallback, ...rest } = props ?? {}
  const scope = currentDeferred()
  const place = currentPlace()
  // Outside a page, or with nobody to sign for it, the part renders where it is, as any view.
  if (!scope || scope.inPart || !place)
    return new RawHtml(await renderToString(component(rest as Record<string, unknown>)))
  const json = serializeProps(rest, module, 'part')
  const src = deferredAddress(
    { module, exportName, key: place.key, culture: place.culture, props: JSON.parse(json) },
    scope.sign,
  )
  scope.used = true
  const shown =
    fallback === undefined || fallback === null ? '' : await renderToString(fallback as Child)
  return new RawHtml(`<crombolo-deferred src="${escapeHtml(src)}">${shown}</crombolo-deferred>`)
}

const KEY = Symbol.for('crombolo.deferred')
;(globalThis as Record<symbol, unknown>)[KEY] ??= renderDeferred

/** Fetches each part with the visitor's cookies and puts it in place of its fallback. */
export const DEFERRED_LOADER = `for (const part of document.querySelectorAll('crombolo-deferred[src]')) {
  const src = part.getAttribute('src')
  part.removeAttribute('src')
  fetch(src, { credentials: 'same-origin', headers: { accept: 'text/html' } })
    .then((response) => (response.ok ? response.text() : undefined))
    .then((html) => {
      if (html === undefined) return
      const template = document.createElement('template')
      template.innerHTML = html
      part.replaceChildren(template.content)
      part.dispatchEvent(new CustomEvent('crombolo:deferred', { bubbles: true }))
    })
    .catch(() => {})
}
`

/** The loader's address while its script is as it is now (story 260). */
export const DEFERRED_LOADER_ADDRESS = hashedAddress(
  DEFERRED_LOADER_PATH,
  contentHash(DEFERRED_LOADER),
)

/** The tag a page with a part ends with. */
export const DEFERRED_TAGS = `<script type="module" src="${DEFERRED_LOADER_ADDRESS}"></script>`
