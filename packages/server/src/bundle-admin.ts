/**
 * Installed bundles, managed (stories 194, 222, 225, 241): the list, install,
 * uninstall, disable and enable, each audited. One implementation behind
 * Settings → Bundles, the remote protocol and the CLI on the site's own machine.
 */
import type { ExtensionRegistry } from '@crombolo/backoffice-host'
import { createExtensionRegistry } from '@crombolo/backoffice-host/registry'
import { type Db, TransferRunRepository } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import { type BundleGrants, createBundleGrants } from './bundle-grants.ts'
import { CommandError, installBundleContent } from './bundle-install.ts'
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
  items: InstalledListing[]
}

export interface InstallRequest {
  /** A package name, or with `file` a packed bundle on this machine. */
  name: string
  version?: string
  file?: boolean
  applyContent?: boolean
  acceptServerCode?: boolean
  grant?: readonly string[]
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
  uninstall(actor: BundleActor, name: string): Promise<InstallOutcome>
  /** Turns a bundle's server features off or on; `id` is its bundle id or its package name. */
  setEnabled(actor: BundleActor, id: string, enabled: boolean): Promise<SwitchOutcome>
}

/** What restarting will make live, said after an install that changed code. */
export const RESTART_NOTICE = 'It takes effect when the site restarts: `crombolo restart`.'

export function createBundleAdmin(options: {
  db: Db
  config: CromboloConfig
  marketplace: Marketplace
  extensions: Pick<ExtensionRegistry, 'bundles'>
  bundleGrants: Pick<BundleGrants, 'disable' | 'enable'>
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

  return {
    inspect: (name, version) => marketplace.inspect(name, version),

    async installed() {
      return {
        installs: config.runtimeInstalls,
        installsElsewhere: config.runtimeInstalls ? null : (config.installsElsewhere ?? null),
        restartPending: restartPending(config.siteDir) ?? null,
        policy: config.bundlePolicy,
        items: await marketplace.installed(),
      }
    },

    async install(actor, request) {
      const asked = {
        applyContent: request.applyContent !== false,
        acceptServerCode: request.acceptServerCode === true,
        grant: request.grant ?? [],
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
          asked.acceptServerCode
            ? `accepted server code; granted ${asked.grant.length > 0 ? asked.grant.join(', ') : 'nothing'}`
            : undefined,
          outcome.provenance ? describeProvenance(outcome.provenance) : undefined,
        ]
          .filter(Boolean)
          .join('; ') || null,
      )
      if (!landed?.carries.server) return outcome
      markRestartPending(config.siteDir, `${name}@${landed.version} installed`)
      return { ...outcome, restartPending: true }
    },

    async uninstall(actor, name) {
      const before = find(name)
      const outcome = await marketplace.uninstall(name)
      if (!outcome.ok) return outcome
      await audit(actor, 'Uninstall', name, null)
      if (!before?.carries.server) return outcome
      markRestartPending(config.siteDir, `${name} removed`)
      return { ...outcome, restartPending: true }
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
      const result = await installBundleContent(db, config, { bundle: packageName }).catch(
        (error: unknown) => {
          if (error instanceof CommandError) return error
          throw error
        },
      )
      if (result instanceof CommandError)
        return { applied: false, message: `Its content was not applied: ${result.message}` }
      if (!result.runId)
        return {
          applied: false,
          message: `Its content was not applied: ${[...result.problems, ...result.check.outstanding.map((f) => f.message)].join('; ') || 'the check refused it'}. \`crombolo bundle apply ${packageName} --dry-run\` says what it needs.`,
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
