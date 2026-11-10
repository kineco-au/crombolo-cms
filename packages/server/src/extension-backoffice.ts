/**
 * An extension's back-office code, built (story 320). Each module its manifest
 * names under `src/backoffice/` is built for the browser, TypeScript and the npm
 * packages it imports included, into `.crombolo/extensions/<id>/backoffice/`,
 * and that build is all that is served of the package. The back office's own
 * modules stay imports, for its import map to resolve. Built when first asked
 * for, and again when its files change. docs/extensions.md.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  BACKOFFICE_DIR,
  type BundlePackage,
  backOfficeModules,
  type InstalledExtension,
  SERVER_DIR,
} from '@crombolo/backoffice-host/registry'
import type { BundleLog } from './bundles.ts'

const SOURCE = /\.(m?[jt]s|[jt]sx)$/

/** Builds a package's back-office modules into `outDir`, or throws saying why. */
export async function buildBackOffice(pkg: BundlePackage, outDir: string): Promise<void> {
  const root = join(pkg.directory, BACKOFFICE_DIR)
  // As the build sees it: a workspace link resolves to its real place.
  const server = `${join(realpathSync(pkg.directory), SERVER_DIR)}${sep}`
  const entrypoints = backOfficeModules(pkg.field).map((module) =>
    join(pkg.directory, module.replace(/^\.\//, '')),
  )
  const next = `${outDir}.next`
  rmSync(next, { recursive: true, force: true })
  const result = await Bun.build({
    entrypoints,
    root,
    outdir: next,
    target: 'browser',
    format: 'esm',
    splitting: true,
    naming: { entry: '[dir]/[name].[ext]', chunk: 'chunks/[name]-[hash].[ext]' },
    external: ['@umbraco-cms/*'],
    throw: false,
    plugins: [
      {
        name: 'crombolo-backoffice',
        setup(build) {
          build.onLoad({ filter: SOURCE }, async (args) => {
            // Each half is kept from the other's folder: the server's code is never in the browser.
            if (args.path.startsWith(server))
              throw new Error(
                `${relative(pkg.directory, args.path)} is the server half's, which back-office code never imports.`,
              )
            const ext = args.path.match(SOURCE)?.[1] ?? 'js'
            const loader = ext.endsWith('ts')
              ? 'ts'
              : ext === 'tsx'
                ? 'tsx'
                : ext === 'jsx'
                  ? 'jsx'
                  : 'js'
            return { contents: await Bun.file(args.path).text(), loader }
          })
        },
      },
    ],
  })
  if (!result.success) {
    rmSync(next, { recursive: true, force: true })
    throw new Error(
      `Its back-office code could not be built: ${result.logs.map((log) => log.message).join('; ')}`,
    )
  }
  rmSync(outDir, { recursive: true, force: true })
  renameSync(next, outDir)
}

/** When a package's back-office code last changed: its version, and its files' times. */
function stamp(pkg: BundlePackage): string {
  let latest = 0
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else latest = Math.max(latest, stat.mtimeMs)
    }
  }
  const root = join(pkg.directory, BACKOFFICE_DIR)
  if (existsSync(root)) walk(root)
  return `${pkg.version}:${latest}`
}

export interface BackOfficeBuilds {
  /** The extensions given, each with its build to serve; one whose code cannot be built is left out. */
  ready(extensions: readonly InstalledExtension[]): Promise<InstalledExtension[]>
  /** The extensions whose back-office code could not be built, and why. */
  failed(): Array<{ id: string; reason: string }>
}

export function createBackOfficeBuilds(
  siteDir: string,
  log: (id: string) => BundleLog,
): BackOfficeBuilds {
  const built = new Map<string, { stamp: string; dir: string }>()
  const failures = new Map<string, { stamp: string; reason: string }>()
  const building = new Map<string, Promise<void>>()

  const ensure = async (pkg: BundlePackage): Promise<string | undefined> => {
    const now = stamp(pkg)
    const done = built.get(pkg.id)
    if (done?.stamp === now) return done.dir
    if (failures.get(pkg.id)?.stamp === now) return undefined
    const key = `${pkg.id}@${now}`
    let pending = building.get(key)
    if (!pending) {
      const dir = join(siteDir, '.crombolo', 'extensions', pkg.id, 'backoffice')
      mkdirSync(join(dir, '..'), { recursive: true })
      pending = buildBackOffice(pkg, dir).then(
        () => {
          built.set(pkg.id, { stamp: now, dir })
          failures.delete(pkg.id)
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          failures.set(pkg.id, { stamp: now, reason })
          log(pkg.id).error(
            '{package} is left out of the back office, as its screens could not be built: {reason}',
            { package: pkg.packageName, reason },
          )
        },
      )
      building.set(key, pending)
      void pending.finally(() => building.delete(key))
    }
    await pending
    return built.get(pkg.id)?.stamp === now ? built.get(pkg.id)?.dir : undefined
  }

  return {
    async ready(extensions) {
      const out: InstalledExtension[] = []
      for (const extension of extensions) {
        // Entries that name no module, a label and an icon, need nothing built.
        if (backOfficeModules(extension.bundle.field).length === 0) {
          out.push(extension)
          continue
        }
        const dir = await ensure(extension.bundle)
        if (dir) out.push({ ...extension, servedDir: dir })
      }
      return out
    },
    failed: () => [...failures].map(([id, failure]) => ({ id, reason: failure.reason })),
  }
}
