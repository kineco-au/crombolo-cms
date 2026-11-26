/**
 * The site's back-office code, built (story 431): each module its sections' screens and
 * its panels (437) name, in the site or a package it depends on, with what it imports, for
 * the browser, into `.crombolo/site/backoffice/`, which is all that is served of it. The back office's own modules stay imports. Built when
 * first asked for and again when the site's files change; one that cannot be built
 * leaves the site's sections out of the back office, and says why.
 */
import { existsSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import {
  nativeDialogUses,
  type PackageManifest,
  PLUGIN_PATH_PLACEHOLDER,
  SITE_CODE_SEGMENT,
  sectionManifests,
} from '@crombolo/backoffice-host/registry'
import {
  resolveModule,
  type SiteBackOfficeConfig,
  siteBackOfficeModules,
  sitePanelAlias,
  siteSectionAlias,
} from './site-backoffice.ts'

/** The folder every one of these is under, so the build keeps where each is. */
function commonRoot(paths: readonly string[]): string {
  const parts = paths.map((path) => path.split(sep))
  const first = parts[0] ?? []
  let length = first.length
  for (const other of parts) {
    let i = 0
    while (i < length && i < other.length && other[i] === first[i]) i++
    length = i
  }
  return first.slice(0, length).join(sep) || sep
}

/**
 * Story 437: each module the config names, by the file it is, and where its build is
 * served below the site's code: by its place under the folder they all share.
 */
export function plannedModules(
  siteDir: string,
  modules: readonly string[],
): { root: string; files: Map<string, string>; served: Map<string, string> } {
  const files = new Map<string, string>()
  for (const module of modules) {
    const resolved = resolveModule(siteDir, module)
    if ('file' in resolved) files.set(module, realpathSync(resolved.file))
  }
  const root = commonRoot([realpathSync(siteDir), ...[...files.values()].map((f) => dirname(f))])
  const served = new Map(
    [...files].map(([module, file]) => [
      module,
      relative(root, file).split(sep).join('/').replace(SOURCE, '.js'),
    ]),
  )
  return { root, files, served }
}

const SOURCE = /\.(m?[jt]s|[jt]sx)$/

/** Builds the modules into `outDir`, or throws saying why. */
export async function buildSiteBackOffice(
  siteDir: string,
  modules: readonly string[],
  outDir: string,
): Promise<void> {
  const own = `${realpathSync(siteDir)}${sep}`
  const { root, files } = plannedModules(siteDir, modules)
  const entries = new Set(files.values())
  const next = `${outDir}.next`
  rmSync(next, { recursive: true, force: true })
  const refused: string[] = []
  const result = await Bun.build({
    entrypoints: [...entries],
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
        name: 'crombolo-site-backoffice',
        setup(build) {
          build.onLoad({ filter: SOURCE }, async (args) => {
            const contents = await Bun.file(args.path).text()
            // The site's own code asks in the back office's dialogs, as the back office does:
            // its files, and each module it names from a package.
            if (
              entries.has(args.path) ||
              (args.path.startsWith(own) && !args.path.includes(`${sep}node_modules${sep}`))
            ) {
              const uses = nativeDialogUses(contents)
              if (uses.length > 0)
                refused.push(
                  `${relative(siteDir, args.path)} uses ${uses.join(', ')}: ask with the back office's own dialogs`,
                )
            }
            const ext = args.path.match(SOURCE)?.[1] ?? 'js'
            const loader = ext.endsWith('ts')
              ? 'ts'
              : ext === 'tsx'
                ? 'tsx'
                : ext === 'jsx'
                  ? 'jsx'
                  : 'js'
            return { contents, loader }
          })
        },
      },
    ],
  })
  if (!result.success || refused.length > 0) {
    rmSync(next, { recursive: true, force: true })
    throw new Error(
      refused.length > 0
        ? refused.join('; ')
        : `It could not be built: ${result.logs.map((log) => log.message).join('; ')}`,
    )
  }
  rmSync(outDir, { recursive: true, force: true })
  renameSync(next, outDir)
}

/** When the site's files last changed, `node_modules` and crombolo's own folders aside. */
function stamp(siteDir: string): string {
  let latest = 0
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) walk(path)
      else if (SOURCE.test(name)) latest = Math.max(latest, stat.mtimeMs)
    }
  }
  walk(siteDir)
  return String(latest)
}

export interface SiteBackOfficeBuild {
  /** The built folder, or undefined when there is nothing to build or it could not be built. */
  ready(): Promise<string | undefined>
  /** The site's sections, as the back office loads them, once their code is built. */
  manifest(): Promise<PackageManifest | undefined>
  /** Why it could not be built, if it could not. */
  failed(): string | undefined
}

export function createSiteBackOfficeBuild(
  siteDir: string,
  config: SiteBackOfficeConfig | undefined,
  log: (message: string, properties: Record<string, unknown>) => void,
  /** Built again when the site's files change: in development. Otherwise once. */
  watch = false,
): SiteBackOfficeBuild {
  const modules = siteBackOfficeModules(config)
  const dir = join(siteDir, '.crombolo', 'site', 'backoffice')
  const served = (module: string) =>
    `${PLUGIN_PATH_PLACEHOLDER}/${SITE_CODE_SEGMENT}/${plannedModules(siteDir, [...modules]).served.get(module) ?? ''}`
  let built: string | undefined
  let failure: { stamp: string; reason: string } | undefined
  let building: Promise<void> | undefined

  const ready = async (): Promise<string | undefined> => {
    if (modules.length === 0) return undefined
    const now = watch ? stamp(siteDir) : 'once'
    if (built === now && existsSync(dir)) return dir
    if (failure?.stamp === now) return undefined
    building ??= buildSiteBackOffice(siteDir, modules, dir)
      .then(
        () => {
          built = now
          failure = undefined
        },
        (error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error)
          failure = { stamp: now, reason }
          log("The site's back-office screens are left out, as they could not be built: {reason}", {
            reason,
          })
        },
      )
      .finally(() => {
        building = undefined
      })
    await building
    return built === now ? dir : undefined
  }

  return {
    ready,
    async manifest() {
      if (modules.length === 0 || !(await ready())) return undefined
      return {
        name: 'The site',
        id: 'Crombolo.Site',
        extensions: [
          ...(config?.sections ?? []).flatMap((section) =>
            sectionManifests({
              alias: siteSectionAlias(section.alias),
              pathname: section.alias,
              label: section.label,
              places: section.places.map((place) => ({
                alias: place.alias,
                label: place.label,
                menu: place.menu.map((screen) => ({
                  alias: screen.alias,
                  label: screen.label,
                  ...(screen.icon ? { icon: screen.icon } : {}),
                  element: served(screen.module),
                })),
              })),
            }),
          ),
          // Story 438: the site's own code as the back office starts, for everyone signed in.
          ...(config?.entryPoints ?? []).map((module, index) => ({
            type: 'backofficeEntryPoint',
            alias: `Site.EntryPoint.${index + 1}`,
            name: `The site's ${module}`,
            js: served(module),
          })),
          // Story 437: each panel in every section, for whoever holds its grant.
          ...(config?.panels ?? []).map((panel) => ({
            type: 'sidePanel',
            alias: sitePanelAlias(panel.alias),
            name: panel.label,
            element: served(panel.module),
            meta: {
              label: panel.label,
              icon: panel.icon ?? 'icon-app',
              defaultWidth: 360,
              toggle: true,
              // Story 438: one for everyone is in nobody's Access, and held to no grant.
              ...(panel.everyone
                ? {}
                : { cromboloGrant: { alias: sitePanelAlias(panel.alias), label: panel.label } }),
            },
            ...(panel.everyone
              ? {}
              : {
                  conditions: [
                    {
                      alias: 'Umb.Condition.SectionUserPermission',
                      match: sitePanelAlias(panel.alias),
                    },
                  ],
                }),
          })),
        ],
      }
    },
    failed: () => failure?.reason,
  }
}
