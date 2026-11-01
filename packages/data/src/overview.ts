/**
 * What the back office's Overview shows about a page beyond a content query's
 * answer (story 236): its type's name, who last changed it, and the keys from
 * the root down to it, which permissions are checked against.
 */
import { ObjectTypes } from '@crombolo/core'
import type { Db } from './database.ts'
import { fromDbBool } from './dialect.ts'

export interface OverviewPageFacts {
  key: string
  name: string
  contentTypeName: string
  /** The user who saved the current version, by name; null when nobody signed in did. */
  author: string | null
  /** Ancestor keys, then the page's own. */
  chain: string[]
  trashed: boolean
}

/** The facts for each page that still exists, by key. */
export async function overviewPageFacts(
  db: Db,
  keys: readonly string[],
): Promise<Map<string, OverviewPageFacts>> {
  const out = new Map<string, OverviewPageFacts>()
  const wanted = [...new Set(keys.map((k) => k.toLowerCase()))]
  if (wanted.length === 0) return out
  const rows = await db.q
    .selectFrom('node as n')
    .innerJoin('content as c', 'c.node_id', 'n.id')
    .innerJoin('node as tn', 'tn.id', 'c.content_type_id')
    .leftJoin('content_version as cv', (join) =>
      join
        .onRef('cv.node_id', '=', 'n.id')
        .on('cv.current', '=', db.dialect.boolValue(true) as boolean),
    )
    .leftJoin('user_account as u', 'u.id', 'cv.user_id')
    .select([
      'n.unique_id as key',
      'n.text as name',
      'n.path as path',
      'n.trashed as trashed',
      'tn.text as typeName',
      'u.user_name as author',
    ])
    .where('n.node_object_type', '=', ObjectTypes.Document)
    .where('n.unique_id', 'in', wanted)
    .execute()
  const ancestorIds = new Set<number>()
  for (const row of rows)
    for (const id of String(row.path).split(',').map(Number)) if (id > 0) ancestorIds.add(id)
  const keyOf = new Map<number, string>()
  if (ancestorIds.size > 0)
    for (const n of await db.q
      .selectFrom('node')
      .select(['id', 'unique_id'])
      .where('id', 'in', [...ancestorIds])
      .execute())
      keyOf.set(Number(n.id), String(n.unique_id))
  for (const row of rows) {
    const chain = String(row.path)
      .split(',')
      .map(Number)
      .filter((id) => id > 0)
      .map((id) => keyOf.get(id))
      .filter((k): k is string => k !== undefined)
    out.set(String(row.key), {
      key: String(row.key),
      name: String(row.name ?? ''),
      contentTypeName: String(row.typeName ?? ''),
      author: row.author === null || row.author === undefined ? null : String(row.author),
      chain,
      trashed: fromDbBool(row.trashed),
    })
  }
  return out
}
