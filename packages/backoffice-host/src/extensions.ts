/**
 * Backoffice extensions as npm dependencies. `docs/bundles.md`.
 *
 * A site's extensions are its dependencies: discovery reads the site's own
 * `package.json`, resolves each dependency through `node_modules`, and takes the
 * `crombolo` field from the dependency's `package.json`. There is no directory
 * convention to keep in step, and `bun add` is the install.
 *
 * Only declared dependencies are read, never a walk of `node_modules`, so a
 * transitive dependency cannot put an extension into a backoffice that never
 * asked for it.
 */
import {
  type BundlePackage,
  type DiscoveredBundles,
  discoverBundles,
  readBundlePackage,
} from './bundle-package.ts'
import type { PackageManifest } from './manifests.ts'
import { PLUGIN_PATH_PLACEHOLDER } from './paths.ts'
import { sectionManifests } from './sections.ts'

/** The npm keyword a bundle publishes so the marketplace can find it. */
export const EXTENSION_KEYWORD = 'crombolo-extension'

/** The keyword extensions published before 0.57 carry, which the Marketplace still finds. */
export const LEGACY_EXTENSION_KEYWORD = 'crombolo-bundle'

/** A bundle's backoffice half, as the manifest endpoint serves it. */
export interface InstalledExtension {
  /** The npm package name, which is also its segment in the asset path. */
  packageName: string
  version: string
  directory: string
  manifest: PackageManifest
  bundle: BundlePackage
}

/** The back office's own element that draws every described screen (story 323). */
export const SCREEN_ELEMENT = `${PLUGIN_PATH_PLACEHOLDER}/extension-screen.js`

/**
 * An entry that names a screen, as the back office loads it: the host's element,
 * told which extension and screen to ask for. Any other entry is unchanged.
 */
export function describedScreen(entry: unknown, bundleId: string): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const { screen, ...rest } = entry as Record<string, unknown>
  if (typeof screen !== 'string') return entry
  const meta = (rest.meta && typeof rest.meta === 'object' ? rest.meta : {}) as Record<
    string,
    unknown
  >
  return {
    ...rest,
    element: SCREEN_ELEMENT,
    meta: { ...meta, cromboloScreen: { bundle: bundleId, screen } },
  }
}

/** A bundle's backoffice half, or undefined when it declares no extensions. */
export function extensionOf(bundle: BundlePackage): InstalledExtension | undefined {
  const field = bundle.field
  if (!bundle.carries.extensions) return undefined
  const packageName = bundle.packageName
  return {
    packageName,
    version: bundle.version,
    directory: bundle.directory,
    bundle,
    manifest: {
      name: bundle.name,
      id: bundle.id,
      version: bundle.version,
      allowPublicAccess: field.allowPublicAccess ?? false,
      allowTelemetry: field.allowTelemetry ?? false,
      // Each extension names its bundle, so Settings can group a bundle's cards and link to it.
      extensions: [
        ...(field.extensions ?? []).map((extension) => {
          const entry = describedScreen(extension, bundle.id)
          return entry && typeof entry === 'object'
            ? { ...entry, cromboloBundle: { name: bundle.name, packageName } }
            : entry
        }),
        // Story 431: its sections, each screen drawn by the back office from its description.
        ...(field.sections ?? []).flatMap((section) =>
          sectionManifests({
            alias: section.alias,
            pathname: section.path,
            label: section.label,
            places: section.places.map((place) => ({
              alias: place.alias,
              label: place.label,
              menu: place.menu.map((entry) => ({
                alias: entry.alias,
                label: entry.label,
                ...(entry.icon ? { icon: entry.icon } : {}),
                element: SCREEN_ELEMENT,
                screen: { bundle: bundle.id, screen: entry.screen },
              })),
            })),
          }),
        ),
      ],
    },
  }
}

/** One dependency's backoffice half, or undefined when it is no bundle or declares no extensions. */
export function readExtension(directory: string): InstalledExtension | undefined {
  const { bundle } = readBundlePackage(directory)
  return bundle ? extensionOf(bundle) : undefined
}

/** Every declared dependency of the site that is a bundle with a backoffice half. */
export function discoverExtensions(siteDir: string): InstalledExtension[] {
  return discoverBundles(siteDir).bundles.flatMap((bundle) => extensionOf(bundle) ?? [])
}

export interface ExtensionRegistry {
  list(): readonly InstalledExtension[]
  /** Every bundle the site depends on, whatever it carries, and the ones that are malformed. */
  bundles(): DiscoveredBundles
  /** Called after an install or an uninstall, so the next read sees it. */
  invalidate(): void
}

/**
 * Discovery, memoized.
 *
 * Reading a handful of `package.json` files on every manifest request would be
 * wasteful, but the uncached behaviour is load-bearing in development: an author
 * editing a local extension expects a reload to show it, which is why `cache`
 * is off there rather than everywhere.
 */
export function createExtensionRegistry(
  siteDir: string,
  options: { cache?: boolean } = {},
): ExtensionRegistry {
  let cached: DiscoveredBundles | undefined
  const cache = options.cache ?? true
  const discovered = () => {
    if (!cache) return discoverBundles(siteDir)
    cached ??= discoverBundles(siteDir)
    return cached
  }
  return {
    list: () => discovered().bundles.flatMap((bundle) => extensionOf(bundle) ?? []),
    bundles: discovered,
    invalidate() {
      cached = undefined
    },
  }
}
