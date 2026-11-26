/**
 * Story 440: every item a recycle bin's emptying deletes, the items in it and everything
 * below them, by key, read before they go, for the one event that says the bin was emptied.
 */
import { normaliseUuid } from '@crombolo/core'
import type { Db } from '@crombolo/data'

export async function branchKeys(
  db: Db,
  roots: ReadonlyArray<{ id: number; path: string }>,
): Promise<string[]> {
  const out: string[] = []
  for (const root of roots) {
    const rows = await db.q
      .selectFrom('node')
      .select('unique_id')
      .where((eb) => eb.or([eb('id', '=', root.id), eb('path', 'like', `${root.path},%`)]))
      .orderBy('level')
      .orderBy('id')
      .execute()
    out.push(...rows.map((r) => normaliseUuid(String(r.unique_id))))
  }
  return [...new Set(out)]
}
