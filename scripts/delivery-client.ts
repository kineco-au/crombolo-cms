/**
 * `@crombolo/delivery-client` is the one package published as built JavaScript:
 * an app's toolchain cannot be assumed to run TypeScript from `node_modules`, as
 * Bun does. In the workspace it is source like every other package; publishing
 * builds `dist/` and packs it under a manifest that points there.
 * docs/packaging-and-upgrades.md, "Packages".
 */
import { rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Manifest } from './packages.ts'

export const DELIVERY_CLIENT = '@crombolo/delivery-client'

/** Writes `dist/index.js` and `dist/index.d.ts` from `src/index.ts`. */
export async function buildDeliveryClient(packageDir: string): Promise<void> {
  const dir = resolve(packageDir)
  const dist = join(dir, 'dist')
  rmSync(dist, { recursive: true, force: true })
  const built = await Bun.build({
    entrypoints: [join(dir, 'src/index.ts')],
    outdir: dist,
    target: 'browser',
    format: 'esm',
  })
  if (!built.success) throw new AggregateError(built.logs, 'The delivery client did not build')
  const declarations = Bun.spawnSync(
    [
      'bun',
      'x',
      'tsc',
      join(dir, 'src/index.ts'),
      '--declaration',
      '--emitDeclarationOnly',
      '--outDir',
      dist,
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      '--lib',
      'es2022,dom',
      '--strict',
      '--skipLibCheck',
      // The repository's tsconfig.json is for the workspace, not this one file.
      '--ignoreConfig',
    ],
    { cwd: dir, stdout: 'pipe', stderr: 'pipe' },
  )
  if (declarations.exitCode !== 0)
    throw new Error(
      `The delivery client's declarations did not build:\n${declarations.stdout}${declarations.stderr}`,
    )
}

/** The manifest the package is packed under: the built files, not the source. */
export function builtManifest(manifest: Manifest): Manifest {
  return {
    ...manifest,
    exports: {
      '.': { types: './dist/index.d.ts', import: './dist/index.js', default: './dist/index.js' },
    },
    files: ['dist', 'NOTICE'],
  }
}
