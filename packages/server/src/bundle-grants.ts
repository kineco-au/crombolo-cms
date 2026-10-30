/**
 * Bundles ask for permissions (story 222). A bundle's package declares what it
 * may do with the site; an administrator grants the whole list, or the bundle
 * stays off. Each capability serves only the permissions declared for it, and
 * a bundle is on only while its grant covers everything it declares.
 * docs/bundles.md, "Permissions".
 */
import {
  type BundlePackage,
  type BundlePermission,
  describePermissions,
  discoverBundles,
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

/** Where a bundle stands: on, or waiting for an administrator, and for what. */
export interface BundleGrantState {
  bundleId: string
  packageName: string
  version: string
  declared: { permission: string; allows: string }[]
  /** On: nothing is declared, or the grant covers everything that is. */
  on: boolean
  grant: BundleGrant | undefined
  /** What is declared and not granted. */
  missing: string[]
}

/** What `on` answers for a bundle, and how grants are made and withdrawn. */
export interface BundleGrants {
  /** Reads the grants again, as a grant on another node may have changed them. */
  refresh(): Promise<void>
  isOn(bundleId: string): boolean
  state(pkg: BundlePackage): BundleGrantState
  grant(pkg: BundlePackage, by: string | null): Promise<BundleGrantState>
  withdraw(bundleId: string): Promise<boolean>
}

/** A bundle is on when its grant covers everything its package declares. */
export function grantCovers(declared: readonly string[], grant: BundleGrant | undefined): boolean {
  if (declared.length === 0) return true
  if (!grant) return false
  const granted = new Set(grant.permissions)
  return declared.every((permission) => granted.has(permission))
}

/**
 * Grants as this node sees them: read at boot, read again at most every
 * `refreshMs` (a grant or a withdrawal on another node), and at once after a
 * grant made here.
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
    const declared = declaredPermissions(pkg)
    const grant = grants.get(pkg.id)
    const granted = new Set(grant?.permissions ?? [])
    return {
      bundleId: pkg.id,
      packageName: pkg.packageName,
      version: pkg.version,
      declared: describePermissions(declared),
      on: grantCovers(declared, grant),
      grant,
      missing: declared.filter((permission) => !granted.has(permission)),
    }
  }

  return {
    refresh: read,
    isOn(bundleId) {
      stale()
      const pkg = options.packages().get(bundleId)
      return pkg ? grantCovers(declaredPermissions(pkg), grants.get(bundleId)) : false
    },
    state(pkg) {
      stale()
      return stateOf(pkg)
    },
    async grant(pkg, by) {
      await repository.grant({
        bundleId: pkg.id,
        packageName: pkg.packageName,
        version: pkg.version,
        permissions: declaredPermissions(pkg),
        grantedBy: by,
      })
      await read()
      return stateOf(pkg)
    },
    async withdraw(bundleId) {
      const had = await repository.withdraw(bundleId)
      await read()
      return had
    },
  }
}

/** What a route of a bundle that is off answers. */
export function waitingResponse(bundleId: string): Response {
  return Response.json(
    {
      title: 'Not turned on yet',
      detail: `The bundle "${bundleId}" is waiting for an administrator to approve what it may do with the site, in Packages → Installed.`,
      status: 503,
    },
    { status: 503, headers: { 'content-type': 'application/problem+json', 'retry-after': '60' } },
  )
}

/** The bundle a site depends on, by id, when it has a server half to grant. */
export function grantableBundle(siteDir: string, id: string): BundlePackage | string {
  const pkg = discoverBundles(siteDir).bundles.find((candidate) => candidate.id === id)
  if (!pkg)
    return `No package this site depends on declares the bundle "${id}". Add it to package.json first.`
  if (!pkg.carries.server)
    return `The bundle "${id}" has no server half, so there is nothing to grant.`
  return pkg
}

/** Grants a bundle the whole of what it declares, outside a running server. */
export async function grantBundle(
  db: Db,
  pkg: BundlePackage,
  by: string | null,
): Promise<string[]> {
  const permissions = declaredPermissions(pkg)
  await new BundleGrantRepository(db).grant({
    bundleId: pkg.id,
    packageName: pkg.packageName,
    version: pkg.version,
    permissions,
    grantedBy: by,
  })
  return permissions
}
