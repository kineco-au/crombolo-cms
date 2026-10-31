/**
 * Bundles ask for permissions (story 222). A bundle's package declares what it
 * may do with the site, and each capability serves only those. Wiring it in the
 * config approves it, recorded at boot (story 225); an administrator can
 * disable it.
 * docs/bundles.md, "Permissions".
 */
import {
  type BundlePackage,
  type BundlePermission,
  describePermissions,
} from '@crombolo/backoffice-host/registry'
import { type BundleGrant, BundleGrantRepository, type Db } from '@crombolo/data'

/** The permissions each capability serves; `log` needs none. */
export const CAPABILITY_PERMISSIONS: Record<string, readonly BundlePermission[]> = {
  redirects: ['redirects.read', 'redirects.write'],
  documents: ['documents.read'],
  identityProviders: ['identityProviders.read', 'identityProviders.write'],
  media: ['media.read', 'media.write', 'member.delegate'],
  log: [],
}

/** The permission each capability method needs. */
const METHOD_PERMISSIONS: Record<string, Record<string, BundlePermission>> = {
  redirects: {
    list: 'redirects.read',
    byKey: 'redirects.read',
    save: 'redirects.write',
    replace: 'redirects.write',
    remove: 'redirects.write',
  },
  documents: { url: 'documents.read' },
  identityProviders: {
    list: 'identityProviders.read',
    test: 'identityProviders.read',
    groups: 'identityProviders.read',
    update: 'identityProviders.write',
    reset: 'identityProviders.write',
  },
  media: {
    get: 'media.read',
    list: 'media.read',
    crop: 'media.read',
    create: 'media.write',
    update: 'media.write',
    delete: 'media.write',
  },
}

/** The permissions a package declares. */
export const declaredPermissions = (pkg: BundlePackage | undefined): string[] =>
  Array.isArray(pkg?.field.permissions) ? [...(pkg?.field.permissions ?? [])] : []

/**
 * Why a bundle's capabilities and its declared permissions disagree: a
 * capability with none of its permissions, `media` without `member.delegate`
 * (it always acts as the calling member), or a permission no capability uses.
 */
export function permissionProblems(
  label: string,
  capabilities: readonly string[],
  declared: readonly string[],
): string[] {
  const problems: string[] = []
  const has = new Set(declared)
  for (const capability of capabilities) {
    const serves = CAPABILITY_PERMISSIONS[capability]
    if (!serves || serves.length === 0) continue
    const writes = serves.filter((p) => p !== 'member.delegate')
    if (!writes.some((p) => has.has(p)))
      problems.push(
        `Bundle "${label}" uses "${capability}" but declares none of its permissions (${writes.join(', ')}) in "crombolo.permissions".`,
      )
    if (capability === 'media' && !has.has('member.delegate'))
      problems.push(
        `Bundle "${label}" uses "media", which acts as the calling member, and so needs "member.delegate" in "crombolo.permissions".`,
      )
  }
  for (const permission of declared) {
    const used = capabilities.some((c) => CAPABILITY_PERMISSIONS[c]?.includes(permission as never))
    if (!used)
      problems.push(
        `Bundle "${label}" declares "${permission}", which none of its capabilities uses; take it out of "crombolo.permissions".`,
      )
  }
  return problems
}

/** A capability call the bundle was not given the permission for. */
export class PermissionRefusedError extends Error {
  constructor(
    readonly bundle: string,
    readonly permission: string,
  ) {
    super(`Bundle "${bundle}" may not do this: it does not declare "${permission}".`)
  }
}

/**
 * A capability with only the methods its declared permissions allow: the rest
 * throw `PermissionRefusedError`, naming the permission.
 */
export function gated<T extends object>(
  bundle: string,
  capability: string,
  host: T,
  declared: readonly string[],
): T {
  const methods = METHOD_PERMISSIONS[capability]
  if (!methods) return host
  const has = new Set(declared)
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(host)) {
    const needs = methods[name]
    out[name] =
      typeof value === 'function' && needs && !has.has(needs)
        ? () => {
            throw new PermissionRefusedError(bundle, needs)
          }
        : typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(host)
          : value
  }
  return Object.freeze(out) as T
}

/** Where a bundle stands: what it may do, who approved it, and whether it is disabled. */
export interface BundleGrantState {
  bundleId: string
  packageName: string
  version: string
  declared: { permission: string; allows: string }[]
  /** On unless an administrator disabled it: the site's code is its approval. */
  on: boolean
  grant: BundleGrant | undefined
  /** Who disabled it, when it is off. */
  disabledBy: string | null
}

/** Whether a bundle may run, what it was approved for, and the switch to stop one. */
export interface BundleGrants {
  /** Reads the rows again, as a node elsewhere may have changed them. */
  refresh(): Promise<void>
  isOn(bundleId: string): boolean
  state(pkg: BundlePackage): BundleGrantState
  /** Records what a bundle is approved for, and by whom; true when that changed. */
  grant(pkg: BundlePackage, by: string | null): Promise<boolean>
  disable(pkg: BundlePackage, by: string | null): Promise<BundleGrantState>
  enable(pkg: BundlePackage): Promise<BundleGrantState>
}

/** Whether a recorded approval already holds this version and list. */
export function approvalHolds(pkg: BundlePackage, grant: BundleGrant | undefined): boolean {
  if (!grant || grant.version !== pkg.version) return false
  const declared = declaredPermissions(pkg)
  return (
    grant.permissions.length === declared.length &&
    declared.every((permission) => grant.permissions.includes(permission))
  )
}

/**
 * Bundles as this node sees them (stories 222 and 225): read at boot, read
 * again at most every `refreshMs` (a node elsewhere disabling one), and at once
 * after a change made here.
 */
export function createBundleGrants(options: {
  db: Db
  /** The wired bundles' packages, by bundle id. */
  packages: () => ReadonlyMap<string, BundlePackage>
  refreshMs?: number
}): BundleGrants {
  const repository = new BundleGrantRepository(options.db)
  let grants = new Map<string, BundleGrant>()
  let readAt = 0
  const refreshMs = options.refreshMs ?? 5_000

  const read = async () => {
    grants = new Map((await repository.all()).map((grant) => [grant.bundleId, grant]))
    readAt = Date.now()
  }
  const stale = () => {
    if (Date.now() - readAt > refreshMs) void read().catch(() => {})
  }
  const stateOf = (pkg: BundlePackage): BundleGrantState => {
    const grant = grants.get(pkg.id)
    return {
      bundleId: pkg.id,
      packageName: pkg.packageName,
      version: pkg.version,
      declared: describePermissions(declaredPermissions(pkg)),
      on: !grant?.disabledAt,
      grant,
      disabledBy: grant?.disabledAt ? grant.disabledBy : null,
    }
  }

  return {
    refresh: read,
    isOn(bundleId) {
      stale()
      return options.packages().has(bundleId) && !grants.get(bundleId)?.disabledAt
    },
    state(pkg) {
      stale()
      return stateOf(pkg)
    },
    async grant(pkg, by) {
      if (approvalHolds(pkg, grants.get(pkg.id))) return false
      await repository.grant({
        bundleId: pkg.id,
        packageName: pkg.packageName,
        version: pkg.version,
        permissions: declaredPermissions(pkg),
        grantedBy: by,
      })
      await read()
      return true
    },
    async disable(pkg, by) {
      await repository.disable(
        { bundleId: pkg.id, packageName: pkg.packageName, version: pkg.version },
        by,
      )
      await read()
      return stateOf(pkg)
    },
    async enable(pkg) {
      await repository.enable(pkg.id)
      await read()
      return stateOf(pkg)
    },
  }
}

/** Who a bundle's approval names when it came from being wired in the config. */
export const APPROVED_BY_CODE = "the site's code"

/** What a route of a bundle that is off answers. */
export function disabledResponse(bundleId: string): Response {
  return Response.json(
    {
      title: 'Turned off',
      detail: `The bundle "${bundleId}" has been disabled by an administrator, in Packages → Installed.`,
      status: 503,
    },
    { status: 503, headers: { 'content-type': 'application/problem+json' } },
  )
}
