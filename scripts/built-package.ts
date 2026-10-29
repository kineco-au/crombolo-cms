/**
 * The packages an app or a third-party package installs, published as built
 * JavaScript as the delivery client is: `@crombolo/next-integration` (story
 * 208) and `@crombolo/common` (story 210). Neither Node nor Next.js runs
 * TypeScript from `node_modules`. `tsc` emits them file for file, so the
 * `'use client'` and `'use cache'` directives Next.js reads stay where they
 * were written. docs/packaging-and-upgrades.md, "Packages".
 */
import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Manifest } from './packages.ts'

export const NEXT_INTEGRATION = '@crombolo/next-integration'
export const COMMON = '@crombolo/common'

/** Built file for file and packed under a manifest pointing at `dist/`. */
export const BUILT_PACKAGES: ReadonlySet<string> = new Set([NEXT_INTEGRATION, COMMON])

/** Writes `dist/*.js` and `dist/*.d.ts` from `src/`. */
export async function buildPackage(packageDir: string): Promise<void> {
  const dir = resolve(packageDir)
  const dist = join(dir, 'dist')
  rmSync(dist, { recursive: true, force: true })
  const sources = readdirSync(join(dir, 'src'))
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(dir, 'src', file))
  const built = Bun.spawnSync(
    [
      'bun',
      'x',
      'tsc',
      ...sources,
      '--declaration',
      '--outDir',
      dist,
      '--rootDir',
      join(dir, 'src'),
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--jsx',
      'react-jsx',
      '--rewriteRelativeImportExtensions',
      '--lib',
      'es2022,dom,dom.iterable',
      '--strict',
      '--skipLibCheck',
      '--ignoreConfig',
    ],
    { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
  )
  if (built.exitCode !== 0) throw new Error(`${dir} did not build:\n${built.stdout}${built.stderr}`)
}

/** The manifest it is packed under: each entry point at its built file. */
export function builtPackageManifest(manifest: Manifest): Manifest {
  const exports: Record<string, Record<string, string>> = {}
  for (const [entry, source] of Object.entries(manifest.exports ?? {})) {
    const base = String(source)
      .replace(/^\.\/src\//, './dist/')
      .replace(/\.tsx?$/, '')
    exports[entry] = { types: `${base}.d.ts`, import: `${base}.js`, default: `${base}.js` }
  }
  return { ...manifest, exports, files: ['dist', 'NOTICE'] }
}
