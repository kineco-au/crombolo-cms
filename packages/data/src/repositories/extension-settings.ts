/**
 * An extension's settings as set in the back office (story 310), each stored as
 * JSON; a secret arrives already sealed. docs/bundles.md, "Settings".
 */
import type { Db } from '../database.ts'
import { DbDate } from '../dialect.ts'

export class ExtensionSettingRepository {
  constructor(private readonly db: Db) {}

  /** Every stored value, by extension and key. */
  async all(): Promise<Map<string, Record<string, unknown>>> {
    const rows = await this.db.q.selectFrom('extension_setting').selectAll().execute()
    const out = new Map<string, Record<string, unknown>>()
    for (const row of rows) {
      const values = out.get(row.bundle_id) ?? {}
      try {
        values[row.setting_key] = JSON.parse(row.value) as unknown
      } catch {
        continue
      }
      out.set(row.bundle_id, values)
    }
    return out
  }

  /** One extension's stored values. */
  async of(bundleId: string): Promise<Record<string, unknown>> {
    return (await this.all()).get(bundleId) ?? {}
  }

  /** Sets one value, or with `undefined` takes it back to its default. */
  async set(bundleId: string, key: string, value: unknown, by: string | null): Promise<void> {
    await this.db.q
      .deleteFrom('extension_setting')
      .where('bundle_id', '=', bundleId)
      .where('setting_key', '=', key)
      .execute()
    if (value === undefined) return
    await this.db.q
      .insertInto('extension_setting')
      .values({
        bundle_id: bundleId,
        setting_key: key,
        value: JSON.stringify(value),
        updated_by: by,
        updated_at: DbDate.toDb(new Date()),
      })
      .execute()
  }
}
