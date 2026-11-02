/**
 * `bundle install --wire` (story 241): a bundle's server half turned on in the
 * site's `crombolo.config.ts`, as a developer would write it by hand: the
 * import, and the factory's call in `bundles`. Text in, text out, so the edit
 * is the reviewed diff and nothing else.
 */

export type WireResult =
  | { ok: true; text: string; changed: boolean }
  | { ok: false; reason: string; lines: [string, string] }

/** A config for a site that has none yet, wiring the one bundle. */
export function newConfigWiring(factory: string, packageName: string): string {
  return [
    "import { defineConfig } from '@crombolo/crombolo'",
    importLine(factory, packageName),
    '',
    'export default defineConfig({',
    `  bundles: [${factory}()],`,
    '})',
    '',
  ].join('\n')
}

const importLine = (factory: string, packageName: string) =>
  `import { ${factory} } from '${packageName}'`

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** The index of the bracket closing the one at `open`, skipping strings and comments. */
function closing(text: string, open: number): number {
  const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')' }
  const stack: string[] = []
  for (let i = open; i < text.length; i++) {
    const c = text[i] as string
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2)
      if (i < 0) return -1
      i++
      continue
    }
    if (pairs[c]) stack.push(pairs[c] as string)
    else if (c === ']' || c === '}' || c === ')') {
      if (stack.pop() !== c) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

/** The import added, or the name added to an import of the package already there. */
function withImport(text: string, factory: string, packageName: string): string | undefined {
  const existing = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escapeRegExp(packageName)}['"]`,
  ).exec(text)
  if (existing) {
    const names = (existing[1] as string)
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
    if (names.some((name) => name === factory || name.endsWith(` as ${factory}`))) return text
    const replaced = existing[0].replace(
      `{${existing[1]}}`,
      `{ ${[...names, factory].join(', ')} }`,
    )
    return text.replace(existing[0], replaced)
  }
  // Something else imports from it: not a shape to guess at.
  if (new RegExp(`from\\s*['"]${escapeRegExp(packageName)}['"]`).test(text)) return undefined
  const imports = [...text.matchAll(/^import\b[\s\S]*?['"][^'"\n]+['"];?[ \t]*$/gm)]
  const last = imports.at(-1)
  const at = last ? (last.index as number) + last[0].length : 0
  const line = importLine(factory, packageName)
  return at === 0 ? `${line}\n${text}` : `${text.slice(0, at)}\n${line}${text.slice(at)}`
}

/**
 * The site's config with the bundle wired, unchanged when it already is, or a
 * refusal with the two lines to add by hand when its shape is not one this can
 * edit safely: `export default defineConfig({ … })`.
 */
export function wireBundle(source: string, factory: string, packageName: string): WireResult {
  const refuse = (reason: string): WireResult => ({
    ok: false,
    reason,
    lines: [importLine(factory, packageName), `bundles: [${factory}()]`],
  })
  const call = /defineConfig\s*\(\s*\{/.exec(source)
  if (!call) return refuse('it does not export `defineConfig({ … })`')
  const objectOpen = (call.index as number) + call[0].length - 1
  const objectClose = closing(source, objectOpen)
  if (objectClose < 0) return refuse('its `defineConfig({ … })` could not be read')

  const body = source.slice(objectOpen, objectClose)
  const key = /(^|[\s,{])bundles\s*:\s*\[/.exec(body)
  let text: string
  if (key) {
    const arrayOpen = objectOpen + (key.index as number) + key[0].length - 1
    const arrayClose = closing(source, arrayOpen)
    if (arrayClose < 0) return refuse('its `bundles` list could not be read')
    const inside = source.slice(arrayOpen + 1, arrayClose)
    if (new RegExp(`(^|[^\\w$.])${escapeRegExp(factory)}\\s*\\(`).test(inside)) {
      const imported = withImport(source, factory, packageName)
      if (imported === undefined)
        return refuse(`it imports from ${packageName} in a way this cannot extend`)
      return { ok: true, text: imported, changed: imported !== source }
    }
    const trimmed = inside.replace(/\s+$/, '')
    const entry = `${factory}()`
    const next =
      trimmed.trim() === ''
        ? entry
        : `${trimmed.replace(/,$/, '')}, ${entry}${inside.slice(trimmed.length)}`
    text = `${source.slice(0, arrayOpen + 1)}${next}${source.slice(arrayClose)}`
  } else {
    if (/(^|[\s,{])bundles\s*:/.test(body))
      return refuse('its `bundles` is not a list written in the file')
    const empty = body.slice(1).trim() === ''
    const insert = empty ? `\n  bundles: [${factory}()],\n` : `\n  bundles: [${factory}()],`
    text = `${source.slice(0, objectOpen + 1)}${insert}${source.slice(objectOpen + 1)}`
  }
  const imported = withImport(text, factory, packageName)
  if (imported === undefined)
    return refuse(`it imports from ${packageName} in a way this cannot extend`)
  return { ok: true, text: imported, changed: true }
}
