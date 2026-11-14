/**
 * What authorization needs from the database: where nodes sit in their trees,
 * and each signed-in user's combined start nodes, group verbs and languages.
 */
import type { NodeChain, NodeLookup, Principal } from '@crombolo/api-management/domain'
import { normaliseUuid, ObjectTypes, unionStartNodes } from '@crombolo/core'
import { type Db, fromDbBool, UserRepository } from '@crombolo/data'

async function chains(
  db: Db,
  rows: Array<{ id: number; unique_id: string; path: string; trashed: unknown }>,
): Promise<Map<string, NodeChain>> {
  const ids = [
    ...new Set(
      rows.flatMap((r) =>
        String(r.path)
          .split(',')
          .map(Number)
          .filter((id) => id > 0),
      ),
    ),
  ]
  const keys = new Map<number, string>()
  if (ids.length > 0)
    for (const row of await db.q
      .selectFrom('node')
      .select(['id', 'unique_id'])
      .where('id', 'in', ids)
      .execute())
      keys.set(Number(row.id), normaliseUuid(String(row.unique_id)))
  return new Map(
    rows.map((row) => [
      normaliseUuid(String(row.unique_id)),
      {
        chain: String(row.path)
          .split(',')
          .map(Number)
          .filter((id) => id > 0)
          .flatMap((id) => {
            const key = keys.get(id)
            return key ? [key] : []
          }),
        trashed: fromDbBool(row.trashed),
      },
    ]),
  )
}

export function createNodeLookup(db: Db): NodeLookup {
  const byKeys = async (objectType: string, keys: readonly string[]) => {
    const wanted = keys.filter((k) => /^[0-9a-f-]{32,36}$/i.test(k)).map(normaliseUuid)
    if (wanted.length === 0) return new Map<string, NodeChain>()
    return chains(
      db,
      await db.q
        .selectFrom('node')
        .select(['id', 'unique_id', 'path', 'trashed'])
        .where('node_object_type', '=', objectType)
        .where('unique_id', 'in', wanted)
        .execute(),
    )
  }
  return {
    documents: (keys) => byKeys(ObjectTypes.Document, keys),
    media: (keys) => byKeys(ObjectTypes.Media, keys),
    async documentDescendants(key) {
      const node = await db.q
        .selectFrom('node')
        .select('path')
        .where('unique_id', '=', normaliseUuid(key))
        .executeTakeFirst()
      if (!node) return []
      return [
        ...(
          await chains(
            db,
            await db.q
              .selectFrom('node')
              .select(['id', 'unique_id', 'path', 'trashed'])
              .where('node_object_type', '=', ObjectTypes.Document)
              .where('path', 'like', `${node.path},%`)
              .execute(),
          )
        ).values(),
      ]
    },
    async versionDocument(versionId) {
      const id = Number(versionId)
      if (!Number.isInteger(id)) return undefined
      const row = await db.q
        .selectFrom('content_version as cv')
        .innerJoin('node as n', 'n.id', 'cv.node_id')
        .select('n.unique_id')
        .where('cv.id', '=', id)
        .executeTakeFirst()
      return row ? normaliseUuid(String(row.unique_id)) : undefined
    },
  }
}

/**
 * A user's languages, their groups' start nodes per tree (story 339), and group
 * verbs; from the given groups instead while a session views as them (story 314).
 */
export async function loadAccess(
  db: Db,
  userId: number,
  groupKeys?: readonly string[],
): Promise<Pick<Principal, 'languages' | 'startNodes' | 'groups'>> {
  const data = await new UserRepository(db).access(userId, groupKeys)
  return {
    languages: data.languages,
    groups: data.groups,
    startNodes: {
      document: unionStartNodes(data.groupStartNodes.document),
      media: unionStartNodes(data.groupStartNodes.media),
      element: unionStartNodes(data.groupStartNodes.element),
    },
  }
}
