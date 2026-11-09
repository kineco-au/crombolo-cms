/**
 * Installed bundles, managed (stories 194, 222, 225, 241): the list, install,
 * uninstall, disable and enable, each audited. One implementation behind
 * Settings → Bundles, the remote protocol and the CLI on the site's own machine.
 */
import type { BundlePackage, ExtensionRegistry } from '@crombolo/backoffice-host'
import {
  createExtensionRegistry,
  type ExtensionSetting,
  readSettings,
  settingValueProblem,
} from '@crombolo/backoffice-host/registry'
import { type Db, ExtensionSettingRepository, TransferRunRepository } from '@crombolo/data'
import { revertRun } from '@crombolo/transfer'
import { recordAudit } from './adapters/audit.ts'
import { type BundleGrants, createBundleGrants, declaredPermissions } from './bundle-grants.ts'
import { CommandError, installBundleContent, revertSections } from './bundle-install.ts'
import type { CromboloConfig } from './config.ts'
import {
  createMarketplace,
  type InstalledListing,
  type InstallOutcome,
  type Marketplace,
  type PackageInstaller,
} from './marketplace.ts'
import { describeProvenance, type ProvenancePolicy } from './provenance.ts'
import { markRestartPending, type RestartPending, restartPending } from './restart-pending.ts'
import { sealSecret } from './secrets.ts'
import { MASKED } from './webhooks.ts'

/** Who acted, and from where, for the audit log. */
export interface BundleActor {
  id: string | null
  name: string
  email: string | null
  source: 'request' | 'cli'
  ipAddress?: string | null
  forwardedFor?: string | null
}

export interface InstalledBundles {
  installs: boolean
  installsElsewhere: { message: string; url?: string } | null
  /** Code installed here that runs once the site restarts. */
  restartPending: RestartPending | null
  /** What this site takes of a bundle's signature (story 060). */
  policy: ProvenancePolicy
  items: (InstalledListing & { settings?: SettingView[]; couldNotStart?: string })[]
}

/** A setting as Installed shows it (story 310): its value, masked when secret, and whether the config locks it. */
export interface SettingView extends ExtensionSetting {
  key: string
  value: unknown
  locked: boolean
}

export interface InstallRequest {
  /** A package name, or with `file` a packed bundle on this machine. */
  name: string
  version?: string
  file?: boolean
  applyContent?: boolean
  grant?: readonly string[]
  /** Whom it acts for, when it asks for `actAs` (story 308). */
  actAs?: string | null
}

export interface SwitchOutcome {
  status: number
  ok: boolean
  on?: boolean
  message: string
}

export interface BundleAdmin {
  installed(): Promise<InstalledBundles>
  /** What installing a version would bring, with nothing installed. */
  inspect: Marketplace['inspect']
  install(actor: BundleActor, request: InstallRequest): Promise<InstallOutcome>
  /** `revertContent` first puts back the content its install applied (story 306). */
  uninstall(
    actor: BundleActor,
    name: string,
    options?: { revertContent?: boolean },
  ): Promise<InstallOutcome>
  /** Turns a bundle's server features off or on; `id` is its bundle id or its package name. */
  setEnabled(actor: BundleActor, id: string, enabled: boolean): Promise<SwitchOutcome>
  /**
   * Sets an extension's settings (story 310): those the config does not lock;
   * `null` takes one back to its default, and a secret's mask keeps what is stored.
   */
  setSettings(
    actor: BundleActor,
    id: string,
    values: Readonly<Record<string, unknown>>,
  ): Promise<SwitchOutcome>
  /**
   * Grants an installed extension exactly what its installed version asks for
   * (story 309), naming whom `actAs` acts for when it asks to; refused, saying
   * what differs, otherwise.
   */
  grant(
    actor: BundleActor,
    id: string,
    request: { grant: readonly string[]; actAs?: string | null },
  ): Promise<SwitchOutcome>
}

/** What restarting will make live, said after an install that changed code. */
export const RESTART_NOTICE = 'It takes effect when the site restarts: `crombolo restart`.'

export function createBundleAdmin(options: {
  db: Db
  config: CromboloConfig
  marketplace: Marketplace
  extensions: Pick<ExtensionRegistry, 'bundles'>
  bundleGrants: Pick<BundleGrants, 'disable' | 'enable' | 'grant' | 'state'>
  /** Granted extensions that could not start, and why (story 311). */
  failed?: () => readonly { id: string; reason: string }[]
}): BundleAdmin {
  const { db, config, marketplace, extensions, bundleGrants } = options
  const audit = (actor: BundleActor, action: string, entityName: string, detail: string | null) =>
    recordAudit(db, {
      category: 'system',
      action,
      entityType: 'Bundle',
      entityName,
      detail,
      source: actor.source,
      userKey: actor.id,
      userName: actor.name,
      ipAddress: actor.ipAddress ?? null,
      forwardedFor: actor.forwardedFor ?? null,
    })
  const find = (name: string) =>
    extensions.bundles().bundles.find((bundle) => bundle.packageName === name || bundle.id === name)

  /** Each setting with its value, and whether the config locks it; a secret's value masked. */
  const settingsView = async (pkg: BundlePackage) => {
    const declared = readSettings(pkg.field.settings)
    if (!('settings' in declared)) return []
    const stored = await new ExtensionSettingRepository(db).of(pkg.id).catch(() => ({}))
    const locked = config.extensions?.[pkg.id]?.settings ?? {}
    return Object.entries(declared.settings).map(([key, setting]) => {
      const value =
        key in locked
          ? locked[key]
          : key in stored
            ? (stored as Record<string, unknown>)[key]
            : setting.default
      return {
        key,
        ...setting,
        value: setting.secret && value !== undefined ? MASKED : (value ?? null),
        locked: key in locked,
      }
    })
  }

  return {
    inspect: (name, version) => marketplace.inspect(name, version),

    async installed() {
      return {
        installs: config.runtimeInstalls,
        installsElsewhere: config.runtimeInstalls ? null : (config.installsElsewhere ?? null),
        restartPending: restartPending(config.siteDir) ?? null,
        policy: config.bundlePolicy,
        items: await Promise.all(
          (await marketplace.installed()).map(async (item) => {
            const pkg = find(item.packageName)
            if (!pkg) return item
            const failed = options.failed?.().find((candidate) => candidate.id === pkg.id)
            return {
              ...item,
              settings: await settingsView(pkg),
              ...(failed ? { couldNotStart: failed.reason } : {}),
            }
          }),
        ),
      }
    },

    async setSettings(actor, id, values) {
      const pkg = find(id)
      if (!pkg)
        return { status: 404, ok: false, message: `No installed extension is called "${id}".` }
      const declared = readSettings(pkg.field.settings)
      const settings = 'settings' in declared ? declared.settings : {}
      const locked = config.extensions?.[pkg.id]?.settings ?? {}
      const problems: string[] = []
      for (const [key, value] of Object.entries(values)) {
        const setting = settings[key]
        if (!setting) problems.push(`${pkg.name} has no setting "${key}"`)
        else if (key in locked) problems.push(`${setting.label} is set in the site's config`)
        else if (value !== null && value !== MASKED) {
          const problem = settingValueProblem(setting, value)
          if (problem) problems.push(problem)
        }
      }
      if (problems.length > 0) return { status: 400, ok: false, message: `${problems.join('; ')}.` }
      if (Object.entries(values).some(([key]) => settings[key]?.secret) && !config.secretKey)
        return {
          status: 409,
          ok: false,
          message: 'Keeping a secret setting needs CROMBOLO_SECRET_KEY set on the server.',
        }
      const store = new ExtensionSettingRepository(db)
      for (const [key, value] of Object.entries(values)) {
        // The mask sent back keeps what is stored.
        if (value === MASKED) continue
        const kept =
          value !== null && settings[key]?.secret
            ? { sealed: sealSecret(String(value), config.secretKey as string) }
            : value
        await store.set(pkg.id, key, value === null ? undefined : kept, actor.email ?? actor.name)
      }
      await audit(
        actor,
        'Settings',
        `${pkg.packageName}@${pkg.version}`,
        Object.keys(values).join(', '),
      )
      // Read when it starts: until story 311 runs it in a process of its own, a restart.
      if (pkg.carries.server) markRestartPending(config.siteDir, `${pkg.name}'s settings changed`)
      return {
        status: 200,
        ok: true,
        message: pkg.carries.server
          ? `${pkg.name}'s settings are saved. They take effect when the site restarts.`
          : `${pkg.name}'s settings are saved.`,
      }
    },

    async install(actor, request) {
      const asked = {
        applyContent: request.applyContent !== false,
        grant: request.grant ?? [],
        actAs: request.actAs ?? null,
        by: actor.email ?? actor.name,
      }
      const outcome = request.file
        ? await marketplace.installFile(request.name, asked)
        : await marketplace.install(request.name, request.version, asked)
      if (!outcome.ok) return outcome
      const name = outcome.dependency?.name ?? request.name
      const landed = find(name)
      await audit(
        actor,
        'Install',
        outcome.dependency ? `${name}@${outcome.dependency.version}` : name,
        [
          `granted ${asked.grant.length > 0 ? asked.grant.join(', ') : 'nothing'}${asked.actAs ? `, acting for ${asked.actAs}` : ''}`,
          outcome.provenance ? describeProvenance(outcome.provenance) : undefined,
        ]
          .filter(Boolean)
          .join('; ') || null,
      )
      if (!landed?.carries.server) return outcome
      markRestartPending(config.siteDir, `${name}@${landed.version} installed`)
      return { ...outcome, restartPending: true }
    },

    async uninstall(actor, name, options = {}) {
      const before = find(name)
      if (options.revertContent) {
        const run = await new TransferRunRepository(db).appliedForPackage(name)
        if (run) {
          const reverted = await revertRun(db, run.id, {
            nodeId: config.nodeId,
            backOfficePath: config.backOfficePath,
          })
          if (!reverted.runId)
            return {
              ok: false,
              message: `${name}'s content could not be put back, so it was not removed: ${reverted.check.findings.map((finding) => finding.message).join('; ')}`,
            }
          await revertSections(db, config, run.id)
        }
      }
      const outcome = await marketplace.uninstall(name)
      if (!outcome.ok) return outcome
      await audit(actor, 'Uninstall', name, null)
      if (!before?.carries.server) return outcome
      markRestartPending(config.siteDir, `${name} removed`)
      return { ...outcome, restartPending: true }
    },

    async grant(actor, id, request) {
      const pkg = find(id)
      if (!pkg)
        return { status: 404, ok: false, message: `No installed extension is called "${id}".` }
      const asks = declaredPermissions(pkg)
      const missing = asks.filter((permission) => !request.grant.includes(permission))
      const extra = request.grant.filter((permission) => !asks.includes(permission))
      if (missing.length > 0 || extra.length > 0)
        return {
          status: 409,
          ok: false,
          message: [
            `${pkg.name} asks for other permissions than were granted.`,
            missing.length > 0 ? `Not granted: ${missing.join(', ')}.` : '',
            extra.length > 0 ? `Not asked for: ${extra.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
        }
      if (asks.includes('actAs') && !request.actAs)
        return {
          status: 409,
          ok: false,
          message: `${pkg.name} asks to act for a user: say whom, the installer, the caller or a named user.`,
        }
      await bundleGrants.grant(pkg, actor.email ?? actor.name, { actAs: request.actAs ?? null })
      await audit(
        actor,
        'Grant',
        `${pkg.packageName}@${pkg.version}`,
        `granted ${asks.join(', ') || 'nothing'}${request.actAs ? `, acting for ${request.actAs}` : ''}`,
      )
      const state = bundleGrants.state(pkg)
      return {
        status: 200,
        ok: true,
        on: state.on,
        message: `${pkg.name} is granted what it asks for.`,
      }
    },

    async setEnabled(actor, id, enabled) {
      const pkg = find(id)
      if (!pkg?.carries.server)
        return {
          status: 404,
          ok: false,
          message: `No installed bundle with a server half is called "${id}".`,
        }
      const state = enabled
        ? await bundleGrants.enable(pkg)
        : await bundleGrants.disable(pkg, actor.email ?? actor.name)
      await audit(
        actor,
        enabled ? 'Enable' : 'Disable',
        `${pkg.packageName}@${pkg.version}`,
        enabled ? 'enabled; it runs again' : 'disabled; it is off',
      )
      return {
        status: 200,
        ok: true,
        on: state.on,
        message: enabled
          ? `${pkg.name} is turned on.`
          : `${pkg.name} is turned off until it is enabled again.`,
      }
    },
  }
}

/**
 * The same, for the CLI on the site's own machine, with no server running: the
 * site directory's dependencies, its database's grants, and `bun add` here.
 * Installing is always allowed, whatever the site says about installs while it
 * runs: on its own machine the site is a working copy to commit from.
 */
export async function localBundleAdmin(
  db: Db,
  config: CromboloConfig,
  options: { install?: PackageInstaller; fetch?: typeof fetch } = {},
): Promise<BundleAdmin> {
  const extensions = createExtensionRegistry(config.siteDir, { cache: false })
  const bundleGrants = createBundleGrants({
    db,
    packages: () => new Map(extensions.bundles().bundles.map((pkg) => [pkg.id, pkg])),
  })
  await bundleGrants.refresh()
  const marketplace = createMarketplace({
    registry: config.npmRegistry,
    keyword: config.packageKeyword,
    marketplaceUrl: config.marketplaceUrl,
    extensions,
    siteDir: config.siteDir,
    grants: bundleGrants,
    installs: true,
    policy: config.bundlePolicy,
    applyContentOnInstall: true,
    contentApplied: async (packageName) =>
      (await new TransferRunRepository(db).appliedForPackage(packageName))?.packageVersion ?? null,
    applyContent: async (packageName) => {
      const result = await installBundleContent(db, config, {
        bundle: packageName,
        expects: 'extension',
      }).catch((error: unknown) => {
        if (error instanceof CommandError) return error
        throw error
      })
      if (result instanceof CommandError)
        return { applied: false, message: `Its content was not applied: ${result.message}` }
      if (!result.runId)
        return {
          applied: false,
          message: `Its content was not applied: ${[...result.problems, ...result.check.outstanding.map((f) => f.message)].join('; ') || 'the check refused it'}.`,
        }
      return { applied: true, runId: result.runId, message: 'Its content was applied.' }
    },
    ...(options.install ? { install: options.install } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  })
  return createBundleAdmin({
    db,
    config: { ...config, runtimeInstalls: true },
    marketplace,
    extensions,
    bundleGrants,
  })
}
