/**
 * Bundles ask for permissions (story 222). A bundle's package declares what it
 * may do with the site, and each capability serves only those. Wiring it in the
 * config approves it, recorded at boot (story 225); an administrator can
 * disable it.
 * docs/bundles.md, "Permissions".
 */
import {
  askedPermissions,
  type BundlePackage,
  type BundlePermission,
  type DeclaredPermission,
  describePermissions,
  isSchema3Field,
} from '@crombolo/backoffice-host/registry'
import { type BundleGrant, BundleGrantRepository, type Db } from '@crombolo/data'
import { API_PERMISSIONS } from './bundle-api.ts'

/** The permissions each capability serves; `log` needs none. */
export const CAPABILITY_PERMISSIONS: Record<string, readonly BundlePermission[]> = {
  redirects: ['redirects.read', 'redirects.write'],
  documents: ['content.read'],
  identityProviders: ['identityProviders.read', 'identityProviders.write'],
  media: ['media.read', 'media.write', 'member.delegate'],
  log: [],
  // Story 308: the areas through the Management API, and requests out.
  api: Object.keys(API_PERMISSIONS) as BundlePermission[],
  fetch: ['http.outbound'],
}

/** Permissions a bundle uses by what it declares, not by a capability: checked at boot instead. */
const DECLARATION_PERMISSIONS: ReadonlySet<string> = new Set([
  'events.content',
  'routes.public',
  'actAs',
  'templates',
  'member.delegate',
  // What the screens need, not the server half (story 320).
  'backoffice.code',
])

/** The permission each capability method needs. */
const METHOD_PERMISSIONS: Record<string, Record<string, BundlePermission>> = {
  redirects: {
    list: 'redirects.read',
    byKey: 'redirects.read',
    save: 'redirects.write',
    replace: 'redirects.write',
    remove: 'redirects.write',
  },
  documents: { url: 'content.read' },
  fetch: { fetch: 'http.outbound' },
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

/**
 * What a package declares: each permission, its reason and its origins. Schema
 * 3 listed names, read here in schema 4's terms, `documents.read` as
 * `content.read`, so an extension already installed keeps working (story 308).
 */
export const declaredEntries = (pkg: BundlePackage | undefined): DeclaredPermission[] =>
  askedPermissions(pkg?.field)

/** The permissions a package declares, by name. */
export const declaredPermissions = (pkg: BundlePackage | undefined): string[] =>
  declaredEntries(pkg).map((entry) => entry.permission)

/** The origins its `http.outbound` names; none when it asks for none. */
export const declaredOrigins = (pkg: BundlePackage | undefined): string[] =>
  declaredEntries(pkg).find((entry) => entry.permission === 'http.outbound')?.origins ?? []

/** Whether it was written before permissions said why (story 308). */
export const isSchema3 = (pkg: BundlePackage | undefined): boolean => isSchema3Field(pkg?.field)

/**
 * Why a bundle's capabilities and its declared permissions disagree: a
 * capability with none of its permissions, `media` without `member.delegate`
 * (it always acts as the calling member), or a permission no capability uses.
 */
export function permissionProblems(
  label: string,
  capabilities: readonly string[],
  declared: readonly string[],
  /** It has back-office screens, which `http.outbound` lets reach its origins too (story 313). */
  screens = false,
  /** It handles events, whose `fetch` `http.outbound` is for too (story 301). */
  options: { events?: boolean } = {},
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
    if (DECLARATION_PERMISSIONS.has(permission)) continue
    if (permission === 'http.outbound' && (screens || options.events)) continue
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
  declared: { permission: string; allows: string; reason: string | null; origins?: string[] }[]
  /** It runs: granted what the installed version asks for, and not turned off (story 309). */
  on: boolean
  /**
   * Why, in a word: `on`; `off`, turned off by an administrator; `waiting`, its
   * version asks for more than was granted; `not-granted`, never granted.
   */
  status: 'on' | 'off' | 'waiting' | 'not-granted'
  /** With `waiting`: what it asks for that the grant does not cover. */
  missing: string[]
  grant: BundleGrant | undefined
  /** Who disabled it, when it is off. */
  disabledBy: string | null
}

/**
 * What the installed version asks for that a grant does not cover (story 309):
 * permissions, `http.outbound` origins, and whom `actAs` acts for. Empty when it
 * covers it all. Pure.
 */
export function grantGaps(pkg: BundlePackage, grant: BundleGrant | undefined): string[] {
  if (!grant) return declaredPermissions(pkg)
  // A schema 3 grant names `documents.read`, which is `content.read` now (story 308).
  const has = new Set(grant.permissions.map((p) => (p === 'documents.read' ? 'content.read' : p)))
  const gaps = declaredPermissions(pkg).filter((permission) => !has.has(permission))
  for (const origin of declaredOrigins(pkg))
    if (!grant.origins.includes(origin)) gaps.push(`http.outbound ${origin}`)
  if (declaredPermissions(pkg).includes('actAs') && !grant.actAs && !gaps.includes('actAs'))
    gaps.push('actAs: whom it acts for')
  return gaps
}

/** Whether a bundle may run, what it was approved for, and the switch to stop one. */
export interface BundleGrants {
  /** Reads the rows again, as a node elsewhere may have changed them. */
  refresh(): Promise<void>
  isOn(bundleId: string): boolean
  /** What it may use now: what it asks for while it is on, nothing otherwise (story 309). */
  granted(bundleId: string): string[]
  /**
   * Narrows a grant to what the installed version asks for, when it asks for no
   * more than was granted: a version that asks for less stays on. True when changed.
   */
  narrow(pkg: BundlePackage): Promise<boolean>
  state(pkg: BundlePackage): BundleGrantState
  /**
   * Records what a bundle is approved for, and by whom; true when that changed.
   * `actAs` is whom it acts for, when it asks to act for a user (story 308).
   */
  grant(
    pkg: BundlePackage,
    by: string | null,
    options?: { actAs?: string | null },
  ): Promise<boolean>
  disable(pkg: BundlePackage, by: string | null): Promise<BundleGrantState>
  enable(pkg: BundlePackage): Promise<BundleGrantState>
}

/** Whether a recorded approval already holds this version and list. */
export function approvalHolds(
  pkg: BundlePackage,
  grant: BundleGrant | undefined,
  actAs?: string | null,
): boolean {
  if (!grant || grant.version !== pkg.version) return false
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && a.every((entry) => b.includes(entry))
  return (
    same(grant.permissions, declaredPermissions(pkg)) &&
    same(grant.origins, declaredOrigins(pkg)) &&
    (actAs === undefined || grant.actAs === actAs)
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
    const missing = grantGaps(pkg, grant)
    const status = grant?.disabledAt
      ? 'off'
      : !grant?.recorded
        ? 'not-granted'
        : missing.length > 0
          ? 'waiting'
          : 'on'
    return {
      bundleId: pkg.id,
      packageName: pkg.packageName,
      version: pkg.version,
      declared: describePermissions(declaredEntries(pkg)),
      on: status === 'on',
      status,
      missing: status === 'waiting' ? missing : [],
      grant,
      disabledBy: grant?.disabledAt ? grant.disabledBy : null,
    }
  }

  return {
    refresh: read,
    isOn(bundleId) {
      stale()
      const pkg = options.packages().get(bundleId)
      return pkg !== undefined && stateOf(pkg).on
    },
    granted(bundleId) {
      stale()
      const pkg = options.packages().get(bundleId)
      return pkg && stateOf(pkg).on ? declaredPermissions(pkg) : []
    },
    async narrow(pkg) {
      const grant = grants.get(pkg.id)
      if (!grant?.recorded || grantGaps(pkg, grant).length > 0 || approvalHolds(pkg, grant))
        return false
      await repository.grant({
        bundleId: pkg.id,
        packageName: pkg.packageName,
        version: pkg.version,
        permissions: declaredPermissions(pkg),
        origins: declaredOrigins(pkg),
        actAs: declaredPermissions(pkg).includes('actAs') ? grant.actAs : null,
        grantedBy: grant.grantedBy,
      })
      await read()
      return true
    },
    state(pkg) {
      stale()
      return stateOf(pkg)
    },
    async grant(pkg, by, options = {}) {
      if (approvalHolds(pkg, grants.get(pkg.id), options.actAs)) return false
      const asks = declaredPermissions(pkg)
      await repository.grant({
        bundleId: pkg.id,
        packageName: pkg.packageName,
        version: pkg.version,
        permissions: asks,
        origins: declaredOrigins(pkg),
        actAs: asks.includes('actAs') ? (options.actAs ?? grants.get(pkg.id)?.actAs ?? null) : null,
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
