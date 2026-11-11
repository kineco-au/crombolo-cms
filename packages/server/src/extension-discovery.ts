/**
 * Installed extensions run once granted, with nothing imported by the site
 * (story 310), each in a Deno process of its own (story 311). At boot, each
 * dependency with a server half that the config's `extensions` entry grants,
 * or that a recorded grant covers, is built, started with its settings, and
 * mounted from what it describes. One that cannot start is left off, and the
 * site starts without it. docs/bundles.md, "Extensions run once granted".
 */
import { join } from 'node:path'
import type { BundlePackage } from '@crombolo/backoffice-host'
import {
  type ExtensionSetting,
  readSettings,
  USER_DELEGATE,
} from '@crombolo/backoffice-host/registry'
import {
  type BundleGrant,
  BundleGrantRepository,
  connect,
  ExtensionSettingRepository,
} from '@crombolo/data'
import { declaredOrigins, declaredPermissions, grantGaps } from './bundle-grants.ts'
import type { BundleLog, ServerBundle } from './bundles.ts'
import type { CromboloConfig, ExtensionEntry } from './config.ts'
import { ExtensionProcess, isolatedBundle, isolationProblems } from './extension-process.ts'
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
  return declaredOrigins(pkg).every((origin) => origins.has(origin))
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
  const problems = Object.keys(entries ?? {})
    .filter((id) => !packages.some((pkg) => pkg.id === id))
    .map(
      (id) =>
        `The config's extensions names "${id}", which no extension the site depends on is: add it to package.json, or take it out.`,
    )
  // Acting for the person needs a person to have granted it, which a config has not (story 325).
  for (const [id, entry] of Object.entries(entries ?? {}))
    if (entry.grant?.includes(USER_DELEGATE))
      problems.push(
        `The config's extensions grants "${id}" ${USER_DELEGATE}, which only an administrator who is signed in may grant, so a job or an event has someone to act for: take it out of the config, and grant it in Settings, under Extensions, or with \`crombolo extension grant ${id} --delegate-to <user key>\`.`,
      )
  if (Bun.env.NODE_ENV === 'production')
    for (const [id, entry] of Object.entries(entries ?? {}))
      if (entry.dev)
        problems.push(
          `The config's extensions gives "${id}" a dev entry, which widens what it may reach and is for a developer's machine only: take it out in production.`,
        )
  return problems
}

/** An extension that could not start, and why: shown where it is listed. */
export interface FailedExtension {
  id: string
  reason: string
}

/**
 * The installed server halves to start, each in its own process with its
 * settings: those the config grants and those a recorded grant covers. Ones the
 * config still imports, the old way, are the site's own code and left to it.
 */
export async function startExtensions(
  config: CromboloConfig,
  packages: readonly BundlePackage[],
  recorded: RecordedExtensions,
  log: (id: string) => BundleLog,
): Promise<{
  bundles: ServerBundle[]
  processes: ExtensionProcess[]
  failed: FailedExtension[]
}> {
  const wired = new Set(config.bundles.map((bundle) => bundle.id))
  const bundles: ServerBundle[] = []
  const processes: ExtensionProcess[] = []
  const failed: FailedExtension[] = []
  for (const pkg of packages) {
    if (!pkg.carries.server || wired.has(pkg.id)) continue
    const entry = config.extensions?.[pkg.id]
    const grant = recorded.grants.get(pkg.id)
    const byConfig = entryCovers(pkg, entry)
    const granted =
      byConfig ||
      Boolean(grant?.recorded && !grant.disabledAt && grantGaps(pkg, grant).length === 0)
    // Nothing of an extension that is not granted is built, let alone run.
    if (!granted) continue
    const process = new ExtensionProcess({
      pkg,
      siteDir: config.siteDir,
      home: join(config.siteDir, '.crombolo', 'extensions', pkg.id),
      settings: settingsOf(pkg, recorded.settings.get(pkg.id), entry, config.secretKey),
      dialect: config.dialect,
      origins: [
        ...((byConfig ? entry?.origins : grant?.origins) ?? []),
        ...(entry?.dev?.allowNet ?? []),
      ],
      reads: entry?.dev?.allowRead,
      timeoutMs: entry?.timeoutMs,
      log: log(pkg.id),
    })
    try {
      const description = await process.start()
      const problems = isolationProblems(description)
      if (description.id !== pkg.id)
        problems.push(
          `it calls itself "${description.id}", where its package.json says "${pkg.id}"`,
        )
      if (problems.length > 0) throw new Error(`It cannot run: ${problems.join('; ')}.`)
      bundles.push(isolatedBundle(process))
      processes.push(process)
    } catch (error) {
      await process.stop()
      const reason = error instanceof Error ? error.message : String(error)
      failed.push({ id: pkg.id, reason })
      log(pkg.id).error(
        '{package} could not be started, and the site starts without it: {reason}',
        {
          package: pkg.packageName,
          reason,
        },
      )
    }
  }
  return { bundles, processes, failed }
}
