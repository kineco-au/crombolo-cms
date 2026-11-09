/**
 * Installed extensions run once granted, with nothing imported by the site
 * (story 310). At boot, each dependency with a server half that the config's
 * `extensions` entry grants, or that a recorded grant covers, is imported by the
 * entry its manifest names and started with its settings.
 * docs/bundles.md, "Extensions run once granted".
 */
import type { BundlePackage } from '@crombolo/backoffice-host'
import { type ExtensionSetting, readSettings } from '@crombolo/backoffice-host/registry'
import {
  type BundleGrant,
  BundleGrantRepository,
  connect,
  ExtensionSettingRepository,
} from '@crombolo/data'
import { declaredOrigins, declaredPermissions, grantGaps } from './bundle-grants.ts'
import type { ServerBundle } from './bundles.ts'
import type { CromboloConfig, ExtensionEntry } from './config.ts'
import { openSecret } from './secrets.ts'

/** What the database says before the boot touches it: the grants and settings recorded. */
export interface RecordedExtensions {
  grants: Map<string, BundleGrant>
  settings: Map<string, Record<string, unknown>>
}

/**
 * Reads the recorded grants and settings, or nothing where there are none yet:
 * a first boot, an in-memory database, or a release before 0.57.
 */
export async function readRecordedExtensions(config: CromboloConfig): Promise<RecordedExtensions> {
  const empty = { grants: new Map(), settings: new Map() }
  let db: Awaited<ReturnType<typeof connect>> | undefined
  try {
    db = await connect({ dialect: config.dialect, file: config.sqliteFile })
    const grants = new Map((await new BundleGrantRepository(db).all()).map((g) => [g.bundleId, g]))
    const settings = await new ExtensionSettingRepository(db).all().catch(() => new Map())
    return { grants, settings }
  } catch {
    return empty
  } finally {
    await db?.close().catch(() => {})
  }
}

/** Whether a config entry grants all a version asks for. Pure. */
export function entryCovers(pkg: BundlePackage, entry: ExtensionEntry | undefined): boolean {
  if (!entry?.grant) return false
  const granted = new Set(entry.grant)
  if (!declaredPermissions(pkg).every((permission) => granted.has(permission))) return false
  const origins = new Set(entry.origins ?? [])
  if (!declaredOrigins(pkg).every((origin) => origins.has(origin))) return false
  return !declaredPermissions(pkg).includes('actAs') || Boolean(entry.actAs)
}

/** Its settings: the manifest's defaults, then what the back office set, then the config's. */
export function settingsOf(
  pkg: BundlePackage,
  stored: Record<string, unknown> | undefined,
  entry: ExtensionEntry | undefined,
  secretKey?: string,
): Record<string, unknown> {
  const declared = readSettings(pkg.field.settings)
  const out: Record<string, unknown> = {}
  if ('settings' in declared)
    for (const [key, setting] of Object.entries(declared.settings) as [string, ExtensionSetting][])
      if (setting.default !== undefined) out[key] = setting.default
  // A secret is kept sealed, and opened only for the extension it is for.
  const opened = Object.fromEntries(
    Object.entries(stored ?? {}).flatMap(([key, value]) => {
      const sealed = (value as { sealed?: unknown } | null)?.sealed
      if (typeof sealed !== 'string') return [[key, value]]
      if (!secretKey) return []
      try {
        return [[key, openSecret(sealed, secretKey)]]
      } catch {
        return []
      }
    }),
  )
  return { ...out, ...opened, ...(entry?.settings ?? {}) }
}

/** Why the config's `extensions` cannot be used: an entry for an extension the site has not got. */
export function extensionEntryProblems(
  entries: Readonly<Record<string, ExtensionEntry>> | undefined,
  packages: readonly BundlePackage[],
): string[] {
  return Object.keys(entries ?? {})
    .filter((id) => !packages.some((pkg) => pkg.id === id))
    .map(
      (id) =>
        `The config's extensions names "${id}", which no extension the site depends on is: add it to package.json, or take it out.`,
    )
}

/**
 * The installed server halves to start, each built by its own factory with its
 * settings: those the config grants and those a recorded grant covers. Ones
 * the config already wires, the old way, are left to it.
 */
export async function startExtensions(
  config: CromboloConfig,
  packages: readonly BundlePackage[],
  recorded: RecordedExtensions,
): Promise<{ bundles: ServerBundle[]; problems: string[] }> {
  const wired = new Set(config.bundles.map((bundle) => bundle.id))
  const bundles: ServerBundle[] = []
  const problems: string[] = []
  for (const pkg of packages) {
    if (!pkg.carries.server || wired.has(pkg.id)) continue
    const entry = config.extensions?.[pkg.id]
    const grant = recorded.grants.get(pkg.id)
    const granted =
      entryCovers(pkg, entry) ||
      Boolean(grant?.recorded && !grant.disabledAt && grantGaps(pkg, grant).length === 0)
    // Nothing of an extension that is not granted is imported, let alone run.
    if (!granted) continue
    try {
      const entryFile = Bun.resolveSync(pkg.packageName, config.siteDir)
      const module = (await import(entryFile)) as Record<string, unknown>
      const factory = module[pkg.field.server as string]
      if (typeof factory !== 'function') {
        problems.push(
          `${pkg.packageName} names "${pkg.field.server}" as its server half, which it does not export.`,
        )
        continue
      }
      bundles.push(
        (factory as (settings: Record<string, unknown>) => ServerBundle)(
          settingsOf(pkg, recorded.settings.get(pkg.id), entry, config.secretKey),
        ),
      )
    } catch (error) {
      problems.push(
        `${pkg.packageName}'s server half could not be started: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return { bundles, problems }
}
