import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { isClientModule } from '@crombolo/render'
import { isServerOnly } from './islands.ts'

/**
 * A `.tsx` under the site's `components/` directory.
 *
 * There is one root and one kind of file. What makes a component a *template*
 * is that a content type names it — `components = ["pages/homePage"]` — not
 * where it sits, which is why this carries no kind: the schema already records
 * that, and a directory that restated it could disagree with it.
 *
 * (Umbraco splits these into Templates and Partial Views because Razor needed
 * the distinction for master-template inheritance. A TSX layout is an import,
 * so the split bought nothing and cost a rule about where a file may live.)
 */
export interface ComponentFile {
  /**
   * Its path under the root without the extension, slash-separated — which is
   * exactly the alias a content type names.
   */
  alias: string
  path: string
}

const SOURCE = /\.(tsx|jsx)$/

/** Folders whose files are one component each, where a `page.tsx` is just a component named page. */
const FLAT_FOLDERS = new Set(['blocks', 'emails'])

/** An alias that stays inside the root: no climbing, no absolute path, no drive. */
export function isSafeAlias(alias: string): boolean {
  if (alias.length === 0 || alias.startsWith('/') || alias.includes('\\')) return false
  if (/^[a-zA-Z]:/.test(alias)) return false
  return !alias.split('/').some((part) => part === '' || part === '.' || part === '..')
}

/** Every component on disk, at any depth, in a stable order. */
export function listComponents(root: string): ComponentFile[] {
  if (!existsSync(root)) return []
  const out: ComponentFile[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!SOURCE.test(name)) continue
      out.push({ alias: aliasOf(root, path), path })
    }
  }
  walk(root)
  // `x.tsx` wins over `x/page.tsx`, as it does when rendering.
  const seen = new Set<string>()
  return out
    .sort((a, b) => a.alias.localeCompare(b.alias) || a.path.length - b.path.length)
    .filter((file) => !seen.has(file.alias) && Boolean(seen.add(file.alias)))
}

/**
 * The alias a file answers to: its path under the root, without the extension.
 * A folder's `page.tsx` answers to the folder, as a Next.js route does (story 206).
 */
export function aliasOf(root: string, path: string): string {
  const alias = relative(root, path).split(sep).join('/').replace(SOURCE, '')
  const folder = alias.endsWith('/page') ? alias.slice(0, -'/page'.length) : undefined
  return folder && !FLAT_FOLDERS.has(folder) ? folder : alias
}

export interface ComponentProblem {
  /** Relative to the site, so the message is one somebody can act on. */
  file: string
  message: string
}

export interface ComponentCheckReport {
  components: ComponentFile[]
  /** The aliases a content type names; the rest are only ever imported. */
  declared: readonly string[]
  /** One that does not compile, or a template a type declares and nothing provides. */
  problems: ComponentProblem[]
  /** Whether types were checked, and what the compiler said. */
  types: { checked: boolean; problems: string[]; note?: string }
}

/**
 * Compiles every component, and reports the templates the schema expects.
 *
 * Each file is transpiled first, because that gives the line a syntax error is
 * on, and then imported, because that is what a render does: an import that
 * cannot be resolved is as fatal as a syntax error and shows up nowhere else.
 */
export async function checkComponents(options: {
  componentsDir: string
  siteDir: string
  /** Component aliases the schema declares, from `allProperties`'s neighbours. */
  declaredComponents?: readonly string[]
}): Promise<ComponentCheckReport> {
  const components = listComponents(options.componentsDir)
  const problems: ComponentProblem[] = []
  const transpiler = new Bun.Transpiler({ loader: 'tsx' })

  for (const component of components) {
    const where = relative(options.siteDir, component.path)
    const source = await Bun.file(component.path).text()
    try {
      transpiler.transformSync(source)
    } catch (error) {
      // Bun's message is a bare "Syntax Error"; the line it is on hangs off
      // `position`, and without it the report says nothing anybody can act on.
      const at = (error as { position?: { line?: number; column?: number; lineText?: string } })
        .position
      const where_ = at?.line ? `:${at.line}${at.column === undefined ? '' : `:${at.column}`}` : ''
      const text = at?.lineText?.trim()
      problems.push({
        file: `${where}${where_}`,
        message: `${(error as Error).message.trim()}${text ? `  (${text})` : ''}`,
      })
      continue
    }
    // A relative import that climbs out of the root resolves today and breaks
    // the moment the component is rendered from a snapshot, which is a copy of
    // the tree and nothing above it. Refused here, where the message can say why.
    for (const specifier of transpiler.scanImports(source)) {
      if (!specifier.path.startsWith('.')) continue
      const target = resolve(join(component.path, '..'), specifier.path)
      if (!relative(options.componentsDir, target).startsWith('..')) continue
      problems.push({
        file: where,
        message:
          `imports "${specifier.path}", which is outside components/. A component is rendered ` +
          'from a snapshot of the tree, so it can only import what the tree contains.',
      })
    }

    for (const found of unawaitedMedia(source))
      problems.push({ file: `${where}:${found.line}`, message: found.message })

    // Browser code (story 209): never imported here, where React or Vue would
    // load into the CMS, and held to the boundary instead.
    if (isClientModule(source) || component.alias.startsWith('client/')) {
      for (const specifier of transpiler.scanImports(source))
        if (isServerOnly(specifier.path))
          problems.push({
            file: where,
            message: `imports ${specifier.path}, which only runs on the server. Code that runs in the browser cannot use it.`,
          })
      continue
    }

    try {
      // A query does not bust Bun's module cache, so a path imported once in
      // this process answers from the registry. Harmless: the CLI checks each
      // component once and exits, and each test uses a directory of its own.
      await import(component.path)
    } catch (error) {
      problems.push({ file: where, message: (error as Error).message.trim() })
    }
  }

  const present = new Set(components.map((component) => component.alias))
  const declared = [...new Set(options.declaredComponents ?? [])]
  for (const alias of declared) {
    if (!isSafeAlias(alias)) {
      problems.push({
        file: relative(options.siteDir, options.componentsDir),
        message: `a content type declares the component "${alias}", which is not a path inside components/`,
      })
      continue
    }
    if (present.has(alias)) continue
    problems.push({
      file: relative(options.siteDir, componentFileFor(options.componentsDir, alias)),
      message: `a content type declares the component "${alias}", and there is no file for it`,
    })
  }

  return {
    components,
    declared: declared.filter((alias) => present.has(alias)),
    problems,
    types: await checkTypes(options.siteDir),
  }
}

const MEDIA_CALL = /(\bawait\s+)?((?:[A-Za-z_$][\w$]*)(?:\??\.[A-Za-z_$][\w$]*)*)\.media\(/g

/** The index just past the parenthesis that closes the one opened before `from`. */
function closingParen(source: string, from: number): number {
  let depth = 1
  for (let at = from; at < source.length; at++) {
    const c = source[at]
    if (c === '(') depth += 1
    else if (c === ')' && --depth === 0) return at + 1
  }
  return source.length
}

/**
 * `media()` read as if it were not a promise (story 197): indexed, a property
 * read off it, destructured or iterated without `await`. Without the type
 * checker this is the check that catches a view written before media was read
 * asynchronously. A promise passed on, or returned, is left alone. Pure.
 */
export function unawaitedMedia(source: string): Array<{ line: number; message: string }> {
  const out: Array<{ line: number; message: string }> = []
  for (const match of source.matchAll(MEDIA_CALL)) {
    if (match[1]) continue
    const start = match.index ?? 0
    const end = closingParen(source, start + match[0].length)
    const call = source.slice(start, end)
    const after = source.slice(end).trimStart()
    const before = source.slice(Math.max(0, start - 200), start)
    const synchronous =
      /^(\[|\??\.(?!\.|then\b|catch\b|finally\b))/.test(after) ||
      /\[[^\]=]*\]\s*=\s*$/.test(before) ||
      /\bof\s+$/.test(before) ||
      /\.\.\.\s*$/.test(before)
    if (!synchronous) continue
    out.push({
      line: source.slice(0, start).split('\n').length,
      message:
        `${call} is read asynchronously: write (await ${call}) in an async component. ` +
        'Media is looked up as it is read, so it is awaited like any other promise.',
    })
  }
  return out
}

/** The values read asynchronously since media left the page snapshot (story 197). */
const ASYNC_VALUE = /Promise<(?:MediaWithCrops|Link|PublishedContent|RawHtml|string)\b/

/** A compiler message about one of them, with the change to make. Pure. */
export function withAwaitHint(line: string): string {
  return ASYNC_VALUE.test(line)
    ? `${line} (media, rich text and link values are read asynchronously: await them in an async component)`
    : line
}

/**
 * `tsc --noEmit` with the site's own tsconfig, when the site has the compiler.
 *
 * `typescript` is not a dependency of crombolo — a site that has not installed
 * it is told so rather than being made to carry one.
 */
export async function checkTypes(
  siteDir: string,
  options: { signal?: AbortSignal } = {},
): Promise<ComponentCheckReport['types']> {
  const tsc = join(siteDir, 'node_modules', 'typescript', 'bin', 'tsc')
  if (!existsSync(tsc))
    return {
      checked: false,
      problems: [],
      note: 'types were not checked: `bun add -d typescript` to check them too',
    }
  if (!existsSync(join(siteDir, 'tsconfig.json')))
    return { checked: false, problems: [], note: 'types were not checked: no tsconfig.json here' }

  const proc = Bun.spawn(['bun', tsc, '--noEmit', '-p', siteDir], {
    cwd: siteDir,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  // A newer change has made this check's answer stale (story 214).
  options.signal?.addEventListener('abort', () => proc.kill(), { once: true })
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  await proc.exited
  const lines = `${out}${err}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^Found \d+ error/.test(line))
    .map(withAwaitHint)
  return { checked: true, problems: lines }
}

/** Where a component with this alias lives: `<alias>.tsx`, or `<alias>/page.tsx` as a folder. */
export function componentFileFor(
  root: string,
  alias: string,
  options: { folder?: boolean } = {},
): string {
  if (!isSafeAlias(alias)) throw new Error(`"${alias}" is not a path inside components/`)
  if (
    !options.folder &&
    existsSync(join(root, alias, 'page.tsx')) &&
    !existsSync(join(root, `${alias}.tsx`))
  )
    return join(root, alias, 'page.tsx')
  return options.folder ? join(root, alias, 'page.tsx') : join(root, `${alias}.tsx`)
}

/** What an e-mail template looks like: a default export over `EmailProps`. */
export function emailScaffold(alias: string): string {
  const name = componentName(alias)
  return `import type { EmailProps } from '@crombolo/crombolo'

export default function ${name}({ form, fields, site }: EmailProps) {
  return (
    <html lang="en">
      <body>
        <h1>{form.name}</h1>
        <table>
          {fields.map((field) => (
            <tr>
              <th>{field.caption}</th>
              <td>
                {field.leftOut
                  ? 'Not included'
                  : field.answered
                    ? field.values.join(', ')
                    : 'Not answered'}
              </td>
            </tr>
          ))}
        </table>
        <p>
          Sent from <a href={site.url}>{site.name}</a>
        </p>
      </body>
    </html>
  )
}
`
}

/** The folder e-mail templates live in, as an alias prefix. */
export const EMAIL_FOLDER = 'emails/'

/**
 * The components the forms designer offers as e-mail designs: those in
 * `components/emails/`, and any a form already names, so a picker never loses
 * the one that is set. A layout there takes `EmailLayoutProps`, so it is not offered.
 */
export function listEmailTemplates(
  root: string,
  named: Iterable<string> = [],
): { alias: string; name: string }[] {
  const components = listComponents(root)
  const found = new Set<string>()
  for (const component of components)
    if (
      component.alias.startsWith(EMAIL_FOLDER) &&
      !/\bEmailLayoutProps\b/.test(readFileSync(component.path, 'utf8'))
    )
      found.add(component.alias)
  const present = new Set(components.map((component) => component.alias))
  for (const alias of named) if (present.has(alias)) found.add(alias)
  const items = [...found].sort().map((alias) => ({ alias, name: readableName(alias) }))
  // Two folders with the same file name would read alike, so those keep their path.
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  return items.map((item) =>
    (counts.get(item.name) ?? 0) > 1 ? { ...item, name: `${item.name} (${item.alias})` } : item,
  )
}

/** `emails/contactReceipt` → "Contact receipt". */
function readableName(alias: string): string {
  const base = alias.split('/').pop() ?? alias
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What a component looks like: a function, taking whatever imports it hands it. */
export function componentScaffold(alias: string): string {
  const name = componentName(alias)
  return `import type { PublishedContent } from '@crombolo/crombolo'

export function ${name}({ model }: { model: PublishedContent }) {
  return <p>{model.name}</p>
}
`
}

/** A PascalCase identifier from an alias, which may be a path. */
export function componentName(alias: string): string {
  const base = alias.split('/').pop() ?? alias
  const cleaned = base.replace(/[^A-Za-z0-9]+(.)?/g, (_, next: string | undefined) =>
    next ? next.toUpperCase() : '',
  )
  const name = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  return /^[A-Za-z]/.test(name) ? name : `Component${name}`
}

export type AssetKind = 'stylesheet' | 'script'

export interface AssetFile {
  kind: AssetKind
  name: string
  path: string
}

/** Umbraco's places, which the backoffice's own editors read and write. */
export function assetDirs(config: {
  stylesheetsDir: string
  scriptsDir: string
}): Record<AssetKind, { dir: string; extension: string }> {
  return {
    stylesheet: { dir: config.stylesheetsDir, extension: '.css' },
    script: { dir: config.scriptsDir, extension: '.js' },
  }
}

export function listAssets(config: { stylesheetsDir: string; scriptsDir: string }): AssetFile[] {
  const out: AssetFile[] = []
  for (const [kind, where] of Object.entries(assetDirs(config)) as Array<
    [AssetKind, { dir: string; extension: string }]
  >) {
    if (!existsSync(where.dir)) continue
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) {
          walk(path)
          continue
        }
        if (name.endsWith(where.extension))
          out.push({ kind, name: relative(where.dir, path), path })
      }
    }
    walk(where.dir)
  }
  return out
}

/** The file `assets new` writes: enough to be valid and obviously a starting point. */
export function assetScaffold(kind: AssetKind, name: string): string {
  return kind === 'stylesheet'
    ? `/* ${name} — linked from a view with <link rel="stylesheet" href="/css/${name}"> */\n`
    : `// ${name} — loaded by a view with <script src="/scripts/${name}"></script>\n`
}
