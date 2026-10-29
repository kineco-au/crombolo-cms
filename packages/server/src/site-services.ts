/**
 * `site()` for a page render (story 206): the site's services acting as
 * whoever is asking. Media the visitor may not read answers `notFound`, never
 * `forbidden`, as `/media/` answers 404. docs/rendering.md, "Server code".
 */
import {
  type MediaMember,
  type MediaRule,
  memberMay,
  nearestMediaRule,
  ObjectTypes,
  Outcome,
  ok,
  type Result,
} from '@crombolo/core'
import { type Db, MediaAccessRepository } from '@crombolo/data'
import {
  markPersonal,
  type PublishedCache,
  type PublishedMedia,
  type RequestMember,
  type SiteMembers,
  type SiteServices,
  type SiteSql,
  unavailableServices,
} from '@crombolo/render'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SiteServicesDeps {
  db: Db
  cache: PublishedCache
}

/** Builds `site()`'s services for one request; undefined `member` is a visitor or a previewing editor. */
export function createSiteServices(deps: SiteServicesDeps) {
  const { db, cache } = deps
  const access = new MediaAccessRepository(db)

  return (
    member: RequestMember | undefined | (() => Promise<RequestMember | undefined>),
  ): (() => SiteServices) => {
    // Middleware asks for the member only when it reads something personal (story 210).
    let reader: Promise<MediaMember | undefined> | undefined
    const readerOf = () => {
      reader ??= (typeof member === 'function' ? member() : Promise.resolve(member)).then(
        (found) => (found ? { key: found.key, groups: found.roles } : undefined),
      )
      return reader
    }
    let rules: Promise<Map<number, MediaRule>> | undefined
    const ruleAt = async (path: string) => {
      rules ??= access.allRules().then((all) => new Map(all.map((r) => [r.nodeId, r])))
      return nearestMediaRule(path, await rules)
    }

    /** Whether the visitor may read it; reading anything closed to strangers makes the page personal. */
    const readable = async (item: PublishedMedia): Promise<boolean> => {
      const rule = await ruleAt(item.path)
      if (memberMay('read', item.access, rule, undefined)) return true
      markPersonal()
      return memberMay('read', item.access, rule, await readerOf())
    }

    const notFound = Outcome.notFound()

    const media: SiteServices['media'] = {
      async get(key: string): Promise<Result<PublishedMedia, 404>> {
        if (!UUID.test(key)) return notFound
        const item = await cache.media?.byKey(key)
        if (!item || !(await readable(item))) return notFound
        return ok(item)
      },
      async children(folderKey: string): Promise<Result<PublishedMedia[], 404>> {
        if (!UUID.test(folderKey)) return notFound
        const folder = await cache.media?.byKey(folderKey)
        if (!folder || !(await readable(folder))) return notFound
        const rows = await db.q
          .selectFrom('node')
          .select('unique_id')
          .where('parent_id', '=', folder.id)
          .where('node_object_type', '=', ObjectTypes.Media)
          .where('trashed', '=', db.dialect.boolValue(false) as boolean)
          .orderBy('sort_order')
          .orderBy('id')
          .execute()
        const found = (await cache.media?.byKeys(rows.map((row) => row.unique_id))) ?? new Map()
        const items: PublishedMedia[] = []
        for (const row of rows) {
          const item = found.get(row.unique_id.toLowerCase())
          if (item && (await readable(item))) items.push(item)
        }
        return ok(items)
      },
    }

    const services: SiteServices = {
      media,
      sql: unavailableServices<SiteSql>('sql'),
      members: unavailableServices<SiteMembers>('members'),
    }
    return () => services
  }
}
