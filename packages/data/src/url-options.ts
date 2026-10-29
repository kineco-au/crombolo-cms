/**
 * How this site's URLs are built, as Umbraco's `HideTopLevelNodeFromPath`
 * sets it. Synced from `schema/schema.toml` and changed in Settings; read by
 * the published cache. docs/rendering.md, "URLs".
 */
import type { Db } from './database.ts'
import { now } from './query.ts'

export const URL_OPTIONS_KEY = 'crombolo:urls'

export interface UrlOptions {
  /** Leave the top-level page's segment out of every path below it. Umbraco's default. */
  hideTopLevel: boolean
}

export const DEFAULT_URL_OPTIONS: UrlOptions = { hideTopLevel: true }

/** Whether two settings build the same URLs. Pure. */
export const sameUrlOptions = (a: UrlOptions, b: UrlOptions): boolean =>
  a.hideTopLevel === b.hideTopLevel

/** A stored value read leniently: anything unreadable is the default. Pure. */
export function parseUrlOptions(value: string | undefined): UrlOptions {
  if (!value) return { ...DEFAULT_URL_OPTIONS }
  try {
    const parsed = JSON.parse(value) as Partial<UrlOptions>
    return {
      hideTopLevel:
        typeof parsed.hideTopLevel === 'boolean'
          ? parsed.hideTopLevel
          : DEFAULT_URL_OPTIONS.hideTopLevel,
    }
  } catch {
    return { ...DEFAULT_URL_OPTIONS }
  }
}

export async function readUrlOptions(db: Db): Promise<UrlOptions> {
  const rows = await db.q
    .selectFrom('key_value')
    .select('value')
    .where('key', '=', URL_OPTIONS_KEY)
    .execute()
  return parseUrlOptions(rows[0]?.value ?? undefined)
}

/** Stores the setting; answers what it was before. */
export async function writeUrlOptions(db: Db, options: UrlOptions): Promise<UrlOptions> {
  return db.transaction(async (tx) => {
    const before = await readUrlOptions(tx)
    const value = JSON.stringify({ hideTopLevel: options.hideTopLevel })
    const updated = await tx.q
      .updateTable('key_value')
      .set({ value, update_date: now(tx) })
      .where('key', '=', URL_OPTIONS_KEY)
      .returning('key')
      .execute()
    if (updated.length === 0)
      await tx.q
        .insertInto('key_value')
        .values({ key: URL_OPTIONS_KEY, value, update_date: now(tx) })
        .execute()
    return before
  })
}
