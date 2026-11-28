/**
 * Tailwind on every site (story 452): the stylesheet for the classes the site's
 * views use, made by the server with Tailwind's JavaScript compiler from the
 * site's `css/tailwind.css` or Tailwind's default, and served at
 * `/css/tailwind.css` behind a hash of its bytes. docs/rendering.md, "Styling
 * with Tailwind".
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { contentHash, hashedAddress } from '@crombolo/render'
import { __unstable__loadDesignSystem, compile } from 'tailwindcss'

/** Where the stylesheet is served, and the site's own input lives under `css/`. */
export const TAILWIND_PATH = '/css/tailwind.css'
export const TAILWIND_INPUT_FILE = 'tailwind.css'
export const TAILWIND_DEFAULT_INPUT = '@import "tailwindcss";\n'

/** What a view, partial or component is written in. */
const VIEW_FILE = /\.(?:tsx|ts|jsx|js|html)$/i
/** Builds kept at their hashed address, so a page rendered just before a change still finds its own. */
const KEPT_BUILDS = 5
const MAX_SOURCE_FILES = 10_000
const MAX_FILE_BYTES = 1024 * 1024
const MAX_CANDIDATE = 200

/** Splits text where no class can continue. */
const SEPARATORS = /[\s"'`\\<>{};=]+/
/** A class with an arbitrary value, which may hold quotes and commas: `content-['a']`, `grid-cols-[1fr,2fr]`. */
const ARBITRARY = /[\w\-:!@./*&>#%]*\[[^\s\]]+\][\w\-:/!.%]*/g
const LEADING = /^[^A-Za-z0-9\-!@*[]+/
const TRAILING = /[^A-Za-z0-9\])%!*]+$/

/**
 * Every token in `text` that could be a class, sorted and once each. Tailwind's
 * compiler keeps those that are, so over-collecting costs nothing but time. Pure.
 */
export function classCandidates(text: string): string[] {
  const found = new Set<string>()
  const add = (token: string) => {
    if (token.length === 0 || token.length > MAX_CANDIDATE || !/[a-z]/i.test(token)) return
    found.add(token)
    const trimmed = token.replace(LEADING, '').replace(TRAILING, '')
    if (trimmed && trimmed !== token && /[a-z]/i.test(trimmed)) found.add(trimmed)
  }
  for (const token of text.split(SEPARATORS)) {
    add(token)
    if (token.includes(',') && !token.includes('[')) for (const part of token.split(',')) add(part)
  }
  for (const match of text.matchAll(ARBITRARY)) add(match[0])
  return [...found].sort()
}

/** Where a stylesheet error was, for a person to open. */
export interface TailwindProblem {
  message: string
  /** Relative to the site: `css/tailwind.css`. */
  file?: string
  line?: number
}

/**
 * What went wrong compiling, with the line: Tailwind's syntax errors name it,
 * and an unknown class in `@apply` is found in the input by name. Pure.
 */
export function tailwindProblem(
  error: unknown,
  input: { css: string; file?: string },
  siteDir: string,
): TailwindProblem {
  const raw = error instanceof Error ? error.message : String(error)
  const shown = input.file ? relative(siteDir, input.file).split(sep).join('/') : undefined
  const located = /^(.*?):(\d+):\d+: ([\s\S]*)$/.exec(raw)
  if (located) {
    const where = located[1] as string
    const file = where && existsSync(where) ? relative(siteDir, where).split(sep).join('/') : shown
    return { message: (located[3] as string).trim(), line: Number(located[2]), file }
  }
  const named = /`([^`]+)`/.exec(raw)?.[1]
  const index = named ? input.css.split('\n').findIndex((line) => line.includes(named)) : Number.NaN
  return {
    message: raw.trim(),
    ...(shown ? { file: shown } : {}),
    ...(index >= 0 ? { line: index + 1 } : {}),
  }
}

/** Where a problem is: `css/tailwind.css:3`. Pure. */
export function tailwindPlace(problem: TailwindProblem): string {
  return problem.file
    ? `${problem.file}${problem.line ? `:${problem.line}` : ''}`
    : "Tailwind's default input"
}

/** `css/tailwind.css:3: Missing closing }`. Pure. */
export function describeTailwindProblem(problem: TailwindProblem): string {
  return `${tailwindPlace(problem)}: ${problem.message}`
}

const TAILWIND_DIR = dirname(Bun.resolveSync('tailwindcss/package.json', import.meta.dir))

/** The Tailwind this CMS ships (story 452): a site does not choose one. */
export const TAILWIND_VERSION: string = JSON.parse(
  readFileSync(join(TAILWIND_DIR, 'package.json'), 'utf8'),
).version

const within = (root: string, path: string) =>
  path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)

/** How the compiler reads an `@import`: Tailwind's own files, the site's, or a package's stylesheet. */
function stylesheetLoader(siteDir: string) {
  return async (id: string, base: string) => {
    let path: string
    if (id === 'tailwindcss') path = join(TAILWIND_DIR, 'index.css')
    else if (id.startsWith('tailwindcss/')) path = Bun.resolveSync(id, import.meta.dir)
    else if (id.startsWith('.') || id.startsWith('/')) {
      path = resolve(base, id)
      if (!within(resolve(siteDir), path))
        throw new Error(`@import "${id}" is outside the site, so it is not read.`)
    } else path = packageStylesheet(id, siteDir)
    return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
  }
}

/** A package's stylesheet: its own `.css` export, or the `style` its package names. */
function packageStylesheet(id: string, siteDir: string): string {
  const resolved = Bun.resolveSync(id, siteDir)
  if (resolved.endsWith('.css')) return resolved
  let dir = dirname(resolved)
  while (!existsSync(join(dir, 'package.json')) && dirname(dir) !== dir) dir = dirname(dir)
  const style = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).style
  if (typeof style !== 'string') throw new Error(`The package ${id} has no stylesheet to import.`)
  return join(dir, style)
}

/** How the compiler reads `@plugin` and `@config`: a module, resolved from where it is named. */
async function loadModule(id: string, base: string) {
  const path = Bun.resolveSync(id, base)
  const module = (await import(path)) as { default?: unknown }
  // biome-ignore lint/suspicious/noExplicitAny: the compiler takes a plugin or a config, whichever it is.
  return { path, base: dirname(path), module: (module.default ?? module) as any }
}

/** One class the editor offers: its name, the CSS it makes, and its colour as `#rrggbb` when it is one. */
export type TailwindClass = [name: string, css: string, color?: string]

export interface TailwindClassList {
  enabled: boolean
  version: string
  classes: TailwindClass[]
  /** Every variant a class can take: `hover`, `md`, `dark`, `aria-checked`… */
  variants: string[]
}

export interface TailwindBuild {
  css: string
  hash: string
  /** `/css/tailwind.<hash>.css`. */
  address: string
}

export interface SiteTailwindOptions {
  siteDir: string
  componentsDir: string
  stylesheetsDir: string
  /** A build failed; called again only when the problem changes. */
  onProblem?: (problem: TailwindProblem) => void
  /** A build succeeded after a failure. */
  onRecovered?: () => void
  /** A build made a stylesheet different from the one before. */
  onChanged?: (build: TailwindBuild, previous: TailwindBuild | undefined) => void
}

interface ScannedFile {
  size: number
  modified: number
  candidates: readonly string[]
}

/** The site's Tailwind stylesheet: built, kept, and served from memory. */
export class SiteTailwind {
  readonly #options: SiteTailwindOptions
  #current: TailwindBuild | undefined
  readonly #kept = new Map<string, string>()
  #problem: TailwindProblem | undefined
  #goodInput: string | undefined
  readonly #scanned = new Map<string, ScannedFile>()
  #running: Promise<void> | undefined
  #queued: Promise<void> | undefined
  #classList: { input: string; list: Promise<TailwindClassList> } | undefined

  constructor(options: SiteTailwindOptions) {
    this.#options = options
  }

  /** The site's own input, or Tailwind's default when it has none. */
  input(): { css: string; file?: string } {
    const file = join(this.#options.stylesheetsDir, TAILWIND_INPUT_FILE)
    try {
      return { css: readFileSync(file, 'utf8'), file }
    } catch {
      return { css: TAILWIND_DEFAULT_INPUT }
    }
  }

  /**
   * Builds the stylesheet from the files as they are now. A build asked for while
   * one runs runs once after it, so the result is always of the latest files.
   */
  refresh(): Promise<void> {
    if (this.#queued) return this.#queued
    if (this.#running) {
      this.#queued = this.#running.then(() => {
        this.#queued = undefined
        return this.refresh()
      })
      return this.#queued
    }
    this.#running = this.#build().finally(() => {
      this.#running = undefined
    })
    return this.#running
  }

  current(): TailwindBuild | undefined {
    return this.#current
  }

  problem(): TailwindProblem | undefined {
    return this.#problem
  }

  /** The hashed address of the stylesheet as it is now, for `asset()` and the page's link. */
  address(path: string): string | undefined {
    return path === TAILWIND_PATH ? this.#current?.address : undefined
  }

  /** The stylesheet at a hashed address this node built, the current one or one just before it. */
  kept(address: string): string | undefined {
    return this.#kept.get(address)
  }

  /** The classes, variants and colours the template editor offers, for the input as it is now. */
  classList(): Promise<TailwindClassList> {
    const input = this.input()
    const css = this.#goodInput !== undefined && this.#problem ? this.#goodInput : input.css
    if (this.#classList?.input !== css) {
      const list = designSystemList(css, input.file, this.#options)
      list.catch(() => {
        if (this.#classList?.list === list) this.#classList = undefined
      })
      this.#classList = { input: css, list }
    }
    return this.#classList.list
  }

  async #build(): Promise<void> {
    const input = this.input()
    const { siteDir, stylesheetsDir } = this.#options
    let css: string
    try {
      const compiler = await compile(input.css, {
        base: stylesheetsDir,
        ...(input.file ? { from: input.file } : {}),
        loadStylesheet: stylesheetLoader(siteDir),
        loadModule,
      })
      const candidates = new Set<string>()
      if (compiler.root !== 'none') {
        const root =
          compiler.root && typeof compiler.root === 'object'
            ? matching(compiler.root.base, compiler.root.pattern)
            : viewFiles(this.#options.componentsDir)
        for (const file of root) this.#candidatesOf(file, candidates)
      }
      const excluded = new Set(
        compiler.sources
          .filter((source) => source.negated)
          .flatMap((source) => matching(source.base, source.pattern)),
      )
      for (const source of compiler.sources.filter((s) => !s.negated))
        for (const file of matching(source.base, source.pattern))
          if (!excluded.has(file)) this.#candidatesOf(file, candidates)
      css = compiler.build([...candidates].sort())
    } catch (error) {
      const problem = tailwindProblem(error, input, siteDir)
      const said = this.#problem && describeTailwindProblem(this.#problem)
      this.#problem = problem
      if (said !== describeTailwindProblem(problem)) this.#options.onProblem?.(problem)
      return
    }
    const hadProblem = this.#problem !== undefined
    this.#problem = undefined
    this.#goodInput = input.css
    if (hadProblem) this.#options.onRecovered?.()
    const hash = contentHash(css)
    if (hash === this.#current?.hash) return
    const previous = this.#current
    const build = { css, hash, address: hashedAddress(TAILWIND_PATH, hash) }
    this.#current = build
    this.#kept.delete(build.address)
    this.#kept.set(build.address, css)
    while (this.#kept.size > KEPT_BUILDS)
      this.#kept.delete(this.#kept.keys().next().value as string)
    this.#options.onChanged?.(build, previous)
  }

  /** A file's candidates, read again only when its size or time has changed. */
  #candidatesOf(file: string, into: Set<string>): void {
    try {
      const stat = statSync(file)
      if (stat.size > MAX_FILE_BYTES) return
      let scanned = this.#scanned.get(file)
      if (!scanned || scanned.size !== stat.size || scanned.modified !== stat.mtimeMs) {
        scanned = {
          size: stat.size,
          modified: stat.mtimeMs,
          candidates: classCandidates(readFileSync(file, 'utf8')),
        }
        this.#scanned.set(file, scanned)
      }
      for (const candidate of scanned.candidates) into.add(candidate)
    } catch {
      this.#scanned.delete(file)
    }
  }
}

/** The views, partials and components, sorted so every node reads them in one order. */
function viewFiles(dir: string, out: string[] = []): string[] {
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  } catch {
    return out
  }
  for (const name of names) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const path = join(dir, name)
    try {
      if (statSync(path).isDirectory()) viewFiles(path, out)
      else if (VIEW_FILE.test(name)) out.push(path)
    } catch {
      // Gone while the folder was read.
    }
    if (out.length >= MAX_SOURCE_FILES) break
  }
  return out
}

/** The files an `@source` names: a folder's every file, or a glob's matches, relative to `base`. */
function matching(base: string, pattern: string): string[] {
  const segments = pattern.split('/')
  const glob = segments.findIndex((segment) => /[*?[\]{}!]/.test(segment))
  const fixed = glob < 0 ? segments : segments.slice(0, glob)
  const rest = glob < 0 ? '' : segments.slice(glob).join('/')
  const root = resolve(base, ...fixed)
  try {
    if (!rest) {
      const stat = statSync(root)
      if (stat.isFile()) return [root]
      if (!stat.isDirectory()) return []
    }
    const found: string[] = []
    for (const file of new Bun.Glob(rest || '**/*').scanSync({ cwd: root, onlyFiles: true })) {
      if (file.split('/').includes('node_modules') && !fixed.includes('node_modules')) continue
      found.push(join(root, file))
      if (found.length >= MAX_SOURCE_FILES) break
    }
    return found.sort()
  } catch {
    return []
  }
}

/** What the editor offers, from Tailwind's design system for the input. */
async function designSystemList(
  css: string,
  file: string | undefined,
  options: Pick<SiteTailwindOptions, 'siteDir' | 'stylesheetsDir'>,
): Promise<TailwindClassList> {
  const design = await __unstable__loadDesignSystem(css, {
    base: options.stylesheetsDir,
    ...(file ? { from: file } : {}),
    loadStylesheet: stylesheetLoader(options.siteDir),
    loadModule,
  })
  const names = design.getClassList().map(([name]) => name)
  const made = design.candidatesToCss(names)
  const classes: TailwindClass[] = []
  names.forEach((name, index) => {
    const text = made[index]
    if (!text) return
    const shown = text.replace(/@property[^{]*\{[^}]*\}\s*/g, '').trim()
    const used = new Set([...shown.matchAll(/var\((--color-[\w-]+)/g)].map((m) => m[1] as string))
    const value = used.size === 1 ? design.resolveThemeValue([...used][0] as string) : undefined
    const color = value ? cssColorToHex(value) : undefined
    classes.push(color ? [name, shown, color] : [name, shown])
  })
  const variants = new Set<string>()
  for (const variant of design.getVariants()) {
    if (variant.values.length === 0) variants.add(variant.name)
    for (const value of variant.values)
      variants.add(variant.hasDash ? `${variant.name}-${value}` : `${variant.name}${value}`)
  }
  return { enabled: true, version: TAILWIND_VERSION, classes, variants: [...variants] }
}

const hex = (channel: number) =>
  Math.round(Math.min(1, Math.max(0, channel)) * 255)
    .toString(16)
    .padStart(2, '0')

/** sRGB's transfer function, from linear light. */
const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

/**
 * A theme colour as `#rrggbb`, which the editor draws as a swatch: hex, `rgb()`
 * and `oklch()`, Tailwind's own; undefined for anything else. Pure.
 */
export function cssColorToHex(value: string): string | undefined {
  const text = value.trim().toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text)
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
  if (/^#[0-9a-f]{6}$/.test(text)) return text
  if (/^#[0-9a-f]{8}$/.test(text)) return text.slice(0, 7)
  const number = (part: string, scale: number) =>
    part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part) / scale
  const rgb = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/.exec(text)
  if (rgb)
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => hex(number(part as string, 255))).join('')}`
  const oklch = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?/.exec(text)
  if (!oklch) return undefined
  const lightness = number(oklch[1] as string, 1)
  const chroma = Number(oklch[2])
  const hue = (Number(oklch[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return `#${[red, green, blue].map((channel) => hex(gamma(channel))).join('')}`
}

const NO_CLASSES: TailwindClassList = {
  enabled: false,
  version: TAILWIND_VERSION,
  classes: [],
  variants: [],
}

const answers = new WeakMap<TailwindClassList, { etag: string; body: string; gzip: Uint8Array }>()

/**
 * The class list's answer: tagged, so an editor reopened on the same input is
 * told 304, and gzipped, since it is several megabytes of CSS before it is.
 */
export async function tailwindClassesResponse(
  request: Request,
  tailwind: SiteTailwind | undefined,
): Promise<Response> {
  const list = tailwind ? await tailwind.classList() : NO_CLASSES
  let answer = answers.get(list)
  if (!answer) {
    const body = JSON.stringify(list)
    answer = { etag: `"${Bun.hash(body).toString(36)}"`, body, gzip: Bun.gzipSync(body) }
    answers.set(list, answer)
  }
  const headers: Record<string, string> = {
    'cache-control': 'private, no-cache',
    etag: answer.etag,
    vary: 'accept-encoding',
  }
  if (request.headers.get('if-none-match') === answer.etag)
    return new Response(null, { status: 304, headers })
  headers['content-type'] = 'application/json'
  if (/\bgzip\b/.test(request.headers.get('accept-encoding') ?? ''))
    return new Response(answer.gzip as BodyInit, {
      headers: { ...headers, 'content-encoding': 'gzip' },
    })
  return new Response(answer.body, { headers })
}
