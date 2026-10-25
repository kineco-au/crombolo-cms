/**
 * A host installs a site's bundles itself and tells each node (story 181):
 * `reloadBundles()` reads the site's `package.json` and `node_modules` again,
 * so the back office serves what is there now. It never mounts a server half:
 * configured `bundles` are wired at boot only, and stay as they were.
 */
import type { BundlePackage, ExtensionRegistry } from '@crombolo/backoffice-host'

/** The event a signed-in back office hears when this node's bundles change. */
export const BUNDLES_CHANGED_EVENT = {
  eventSource: 'Crombolo:Bundles',
  eventType: 'Changed',
  key: '00000000-0000-0000-0000-000000000000',
} as const

export interface ReloadedBundle {
  packageName: string
  version: string
  carries: BundlePackage['carries']
  /** Whether its server half is mounted; a bundle found by a reload never is. */
  wired: boolean
}

export interface BundleReload {
  added: ReloadedBundle[]
  removed: { packageName: string; version: string }[]
  changed: { packageName: string; from: string; to: string }[]
  /** A dependency that claims to be a bundle and is not a valid one. */
  problems: { packageName: string; problems: string[] }[]
}

export interface BundleReloader {
  reload(): BundleReload
}

export interface BundleReloaderOptions {
  extensions: ExtensionRegistry
  /** The ids of the configured server halves mounted at boot. */
  wired: () => readonly string[]
  /** Called when anything changed, with what did. */
  changed: (reload: BundleReload) => void
}

/**
 * Compares against what this node last saw rather than the registry's cache,
 * which development leaves off, so a reload reports a change once either way.
 */
export function createBundleReloader(options: BundleReloaderOptions): BundleReloader {
  const byName = (bundles: readonly BundlePackage[]) =>
    new Map(bundles.map((bundle) => [bundle.packageName, bundle]))
  let seen = byName(options.extensions.bundles().bundles)
  return {
    reload() {
      options.extensions.invalidate()
      const found = options.extensions.bundles()
      const now = byName(found.bundles)
      const wired = new Set(options.wired())
      const result: BundleReload = {
        added: [...now.values()]
          .filter((bundle) => !seen.has(bundle.packageName))
          .map((bundle) => ({
            packageName: bundle.packageName,
            version: bundle.version,
            carries: bundle.carries,
            wired: bundle.carries.server && wired.has(bundle.id),
          })),
        removed: [...seen.values()]
          .filter((bundle) => !now.has(bundle.packageName))
          .map((bundle) => ({ packageName: bundle.packageName, version: bundle.version })),
        changed: [...now.values()].flatMap((bundle) => {
          const before = seen.get(bundle.packageName)
          return before && before.version !== bundle.version
            ? [{ packageName: bundle.packageName, from: before.version, to: bundle.version }]
            : []
        }),
        problems: found.problems,
      }
      seen = now
      if (result.added.length + result.removed.length + result.changed.length > 0)
        options.changed(result)
      return result
    },
  }
}
