/**
 * What each bundle was approved for (stories 222 and 225): one row per bundle,
 * its approval replaced as it changes, and whether an administrator disabled
 * it. docs/bundles.md, "Permissions".
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export interface BundleGrant {
  bundleId: string
  packageName: string
  version: string
  permissions: string[]
  grantedBy: string | null
  grantedAt: Date
  /** Who disabled the bundle, and when; null while it may run. */
  disabledBy: string | null
  disabledAt: Date | null
}

const permissionsOf = (value: unknown): string[] => {
  try {
    const parsed = JSON.parse(String(value)) as unknown
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

export class BundleGrantRepository {
  constructor(private readonly db: Db) {}

  async all(): Promise<BundleGrant[]> {
    const rows = await this.db.q
      .selectFrom('bundle_grant')
      .selectAll()
      .orderBy('bundle_id')
      .execute()
    return rows.map((row) => ({
      bundleId: row.bundle_id,
      packageName: row.package_name,
      version: row.version,
      permissions: permissionsOf(row.permissions),
      grantedBy: row.granted_by ?? null,
      grantedAt: DbDate.fromDb(row.granted_at) ?? new Date(0),
      disabledBy: row.disabled_by ?? null,
      disabledAt: row.disabled_at ? (DbDate.fromDb(row.disabled_at) ?? null) : null,
    }))
  }

  async get(bundleId: string): Promise<BundleGrant | undefined> {
    return (await this.all()).find((grant) => grant.bundleId === bundleId)
  }

  /** Records what a bundle is approved for, keeping whether it is disabled. */
  async grant(grant: Omit<BundleGrant, 'grantedAt' | 'disabledBy' | 'disabledAt'>): Promise<void> {
    const values = {
      package_name: grant.packageName,
      version: grant.version,
      permissions: JSON.stringify(grant.permissions),
      granted_by: grant.grantedBy,
      granted_at: DbDate.toDb(new Date()),
    }
    await this.db.q
      .insertInto('bundle_grant')
      .values({ bundle_id: grant.bundleId, ...values })
      .onConflict((conflict) => conflict.column('bundle_id').doUpdateSet(values))
      .execute()
  }

  /**
   * Disables a bundle, recording its package as it stands when it has no row
   * yet; it stays disabled until `enable`.
   */
  async disable(
    bundle: Pick<BundleGrant, 'bundleId' | 'packageName' | 'version'>,
    by: string | null,
  ): Promise<void> {
    const disabled = { disabled_by: by, disabled_at: DbDate.toDb(new Date()) }
    await this.db.q
      .insertInto('bundle_grant')
      .values({
        bundle_id: bundle.bundleId,
        package_name: bundle.packageName,
        version: bundle.version,
        permissions: JSON.stringify([]),
        granted_by: null,
        granted_at: DbDate.toDb(new Date()),
        ...disabled,
      })
      .onConflict((conflict) => conflict.column('bundle_id').doUpdateSet(disabled))
      .execute()
  }

  /** Lets a disabled bundle run again; true when it was disabled. */
  async enable(bundleId: string): Promise<boolean> {
    const before = await this.get(bundleId)
    await this.db.q
      .updateTable('bundle_grant')
      .set({ disabled_by: null, disabled_at: null })
      .where('bundle_id', '=', bundleId)
      .execute()
    return before?.disabledAt != null
  }
}
