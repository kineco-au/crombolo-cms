/**
 * What an administrator granted each bundle (story 222): one row per bundle,
 * replaced on each grant and deleted on withdrawal. docs/bundles.md,
 * "Permissions".
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
    }))
  }

  async get(bundleId: string): Promise<BundleGrant | undefined> {
    return (await this.all()).find((grant) => grant.bundleId === bundleId)
  }

  /** Grants this list, replacing whatever was granted before. */
  async grant(grant: Omit<BundleGrant, 'grantedAt'>): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.q.deleteFrom('bundle_grant').where('bundle_id', '=', grant.bundleId).execute()
      await tx.q
        .insertInto('bundle_grant')
        .values({
          bundle_id: grant.bundleId,
          package_name: grant.packageName,
          version: grant.version,
          permissions: JSON.stringify(grant.permissions),
          granted_by: grant.grantedBy,
          granted_at: DbDate.toDb(new Date()),
        })
        .execute()
    })
  }

  /** Withdraws a bundle's grant; true when there was one. */
  async withdraw(bundleId: string): Promise<boolean> {
    const before = await this.get(bundleId)
    await this.db.q.deleteFrom('bundle_grant').where('bundle_id', '=', bundleId).execute()
    return before !== undefined
  }
}
