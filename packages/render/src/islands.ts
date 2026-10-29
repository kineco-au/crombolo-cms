/**
 * Interactive islands (story 209). A view module whose first statement is
 * `'use client'` runs in the browser: while views are copied into a snapshot it
 * is written as a stub, whose exports render a `<crombolo-island>` placeholder
 * carrying the props as JSON. The browser code is built per snapshot
 * generation, and `/crombolo/islands.js` mounts each island when it is needed.
 * docs/rendering.md, "Islands".
 */
import { markIslands } from './context.ts'
import { escapeHtml, RawHtml } from './html.ts'
import { type Child, renderToString } from './jsx-runtime.ts'

/** The loader every page with an island links to; a file, so no inline script is written. */
export const ISLAND_LOADER_PATH = '/crombolo/islands.js'
/** Where a generation's built browser code is served from. */
export const ISLANDS_PATH = '/crombolo/islands'

/** When an island loads: as it scrolls into view, when the browser is idle, or at once. */
export type IslandLoad = 'visible' | 'idle' | 'load'
const LOADS: readonly IslandLoad[] = ['visible', 'idle', 'load']

/**
 * Whether a module's first statement is `'use client'`. Comments may come
 * before it; the words anywhere else, in a string or later on, do not count.
 */
export function isClientModule(source: string): boolean {
  let rest = source.replace(/^﻿/, '')
  for (;;) {
    rest = rest.replace(/^\s+/, '')
    if (rest.startsWith('//')) {
      const end = rest.indexOf('\n')
      rest = end < 0 ? '' : rest.slice(end + 1)
    } else if (rest.startsWith('/*')) {
      const end = rest.indexOf('*/')
      if (end < 0) return false
      rest = rest.slice(end + 2)
    } else break
  }
  return /^(['"])use client\1\s*(;|\n|$)/.test(rest)
}

/** A prop an island cannot carry to the browser, named by where it is. */
export class IslandPropsError extends Error {}

/**
 * The props as JSON a `<script type="application/json">` can hold: refused
 * when anything would not survive the trip, escaped so nothing in it can close
 * the script or read as markup.
 */
export function serializeProps(props: Record<string, unknown>, island: string): string {
  const seen = new Set<object>()
  const check = (value: unknown, path: string): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return
    if (typeof value === 'number') {
      if (!Number.isFinite(value))
        throw new IslandPropsError(`${island}: ${path} is ${value}, which JSON cannot carry.`)
      return
    }
    if (typeof value !== 'object') {
      const what = value === undefined ? 'undefined' : `a ${typeof value}`
      throw new IslandPropsError(
        `${island}: ${path} is ${what}; an island's props travel to the browser as JSON, so only data can be passed.`,
      )
    }
    if (seen.has(value))
      throw new IslandPropsError(
        `${island}: ${path} refers back to itself, which JSON cannot carry.`,
      )
    const proto = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && proto !== Object.prototype && proto !== null)
      throw new IslandPropsError(
        `${island}: ${path} is ${value instanceof Date ? 'a Date' : `a ${proto?.constructor?.name ?? 'class'} instance`}; pass plain data, such as a string or a number.`,
      )
    seen.add(value)
    if (Array.isArray(value))
      for (const [index, item] of value.entries()) check(item, `${path}[${index}]`)
    else
      for (const [key, item] of Object.entries(value))
        if (item !== undefined) check(item, `${path}.${key}`)
    seen.delete(value)
  }
  check(props, 'props')
  return JSON.stringify(props)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029')
}

const transpiler = new Bun.Transpiler({ loader: 'tsx' })

/**
 * What a client module is written as in a snapshot: each of its exports a
 * server component rendering the island. It imports nothing; the island
 * renderer is reached through a global this module sets, so the stub works
 * wherever the snapshot sits.
 */
export function islandStub(module: string, source: string): string {
  const { exports } = transpiler.scan(source)
  const island = 'globalThis[Symbol.for("crombolo.island")]'
  const lines = [`// The browser half of ${module} ('use client', story 209).`]
  for (const name of exports) {
    const call = `(props) => ${island}(${JSON.stringify(module)}, ${JSON.stringify(name)}, props)`
    lines.push(name === 'default' ? `export default ${call}` : `export const ${name} = ${call}`)
  }
  return `${lines.join('\n')}\n`
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** The snapshot transform: a client module's stub, or undefined to copy the file as it is. */
export function islandTransform(key: string, bytes: Uint8Array): Uint8Array | undefined {
  if (!/\.[jt]sx?$/.test(key)) return undefined
  const source = decoder.decode(bytes)
  return isClientModule(source) ? encoder.encode(islandStub(key, source)) : undefined
}

const htmlOf = async (child: unknown): Promise<string> =>
  child === undefined || child === null ? '' : renderToString(child as Child)

interface IslandOptions {
  kind: 'react' | 'mount'
  module: string
  exportName: string
  props: Record<string, unknown>
}

async function renderIsland(options: IslandOptions): Promise<RawHtml> {
  const { load = 'visible', fallback, children, ...rest } = options.props
  const where =
    options.kind === 'mount'
      ? `<Island name="${options.module.slice('client/'.length)}">`
      : options.module
  if (!LOADS.includes(load as IslandLoad))
    throw new IslandPropsError(
      `${where}: load must be visible, idle or load, not ${JSON.stringify(load)}.`,
    )
  const json = serializeProps(rest, where)
  const [fallbackHtml, childrenHtml] = await Promise.all([htmlOf(fallback), htmlOf(children)])
  markIslands()
  let shown = fallbackHtml
  let carried = ''
  let childrenMode = 'none'
  if (options.kind === 'react') {
    if (fallback === undefined || fallback === null) {
      shown = childrenHtml
      if (childrenHtml) childrenMode = 'inline'
    } else if (childrenHtml) {
      carried = `<template data-children>${childrenHtml}</template>`
      childrenMode = 'template'
    }
  } else if (fallback === undefined || fallback === null) shown = childrenHtml
  const attributes = [
    `data-kind="${options.kind}"`,
    `data-module="${escapeHtml(options.module)}"`,
    `data-export="${escapeHtml(options.exportName)}"`,
    `data-load="${load}"`,
    `data-children="${childrenMode}"`,
  ].join(' ')
  return new RawHtml(
    `<crombolo-island ${attributes}><script type="application/json">${json}</script>${shown}${carried}</crombolo-island>`,
  )
}

/** What a client component's stub calls. */
function clientIsland(module: string, exportName: string, props: Record<string, unknown> = {}) {
  return renderIsland({ kind: 'react', module, exportName, props })
}

/** Kept on `globalThis`, so a stub reaches it whichever copy of this module loaded first. */
const KEY = Symbol.for('crombolo.island')
;(globalThis as Record<symbol, unknown>)[KEY] ??= clientIsland

export interface IslandProps {
  /** `components/client/<name>`, whose default export is `mount(element, props)`. */
  name: string
  props?: Record<string, unknown>
  load?: IslandLoad
  /** Shown until it mounts; the children when there is none. */
  fallback?: Child
  children?: Child
}

/**
 * An island in another framework — Vue, Lit or plain TypeScript: the module
 * `components/client/<name>` exports `mount(element, props)`, returning an
 * optional unmount.
 */
export function Island({
  name,
  props = {},
  load,
  fallback,
  children,
}: IslandProps): Promise<RawHtml> {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(name))
    throw new IslandPropsError(
      `<Island name="${name}">: the name is a path under components/client/.`,
    )
  return renderIsland({
    kind: 'mount',
    module: `client/${name}`,
    exportName: 'default',
    props: { ...props, load, fallback, children },
  })
}

/** The tags a page with islands ends with: where its browser code is, and the loader. */
export function islandTags(manifestUrl: string): string {
  return `<meta name="crombolo-islands" content="${escapeHtml(manifestUrl)}"><script type="module" src="${ISLAND_LOADER_PATH}"></script>`
}

/** A page's HTML with the island tags before `</body>`, or at the end when it has none. */
export function withIslandTags(html: string, manifestUrl: string): string {
  const tags = islandTags(manifestUrl)
  const at = html.toLowerCase().lastIndexOf('</body>')
  return at < 0 ? `${html}${tags}` : `${html.slice(0, at)}${tags}${html.slice(at)}`
}
