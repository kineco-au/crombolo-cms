/**
 * Proving a directory can import a view, before one has to.
 *
 * JSX compiles to an import of `@crombolo/crombolo/jsx-runtime`, which resolves by walking
 * up from the file that needs it. So a views directory — or a snapshot of one —
 * outside the site's own tree cannot load at all:
 *
 *   Cannot find package '@crombolo/crombolo' imported from /mnt/views/homePage.tsx
 *
 * Checked at boot because the alternative is every render failing with a message
 * that names the runtime rather than the configuration that moved it.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

export const JSX_RUNTIME = '@crombolo/crombolo/jsx-runtime'

export class ViewRuntimeUnreachableError extends Error {
  constructor(
    readonly dir: string,
    readonly reason: string,
  ) {
    super(
      `Views cannot be imported from ${dir}: '${JSX_RUNTIME}' does not resolve from there (${reason}).\n` +
        '  JSX compiles to an import of it, resolved by walking up from the file, so the directory\n' +
        '  has to sit inside a tree whose node_modules carries @crombolo/crombolo. Move it under the site, or\n' +
        '  set CROMBOLO_COMPONENTS_CACHE_DIR to somewhere that is.',
    )
  }
}

/** Whether `dir` or a folder above it holds a node_modules. */
function insideNodeModules(dir: string): boolean {
  for (let at = resolve(dir); ; at = dirname(at)) {
    if (existsSync(join(at, 'node_modules'))) return true
    if (dirname(at) === at) return false
  }
}

/** Throws unless a `.tsx` placed in `dir` could resolve the JSX runtime. */
export function assertViewRuntime(dir: string): void {
  mkdirSync(dir, { recursive: true })
  // With no node_modules at or above it, Bun installs a package it cannot find,
  // and the resolve blocks on the registry: `crombolo status` is read-only.
  if (!insideNodeModules(dir)) throw new ViewRuntimeUnreachableError(dir, 'no node_modules there')
  try {
    Bun.resolveSync(JSX_RUNTIME, dir)
  } catch (error) {
    throw new ViewRuntimeUnreachableError(
      dir,
      error instanceof Error ? error.message : String(error),
    )
  }
}
