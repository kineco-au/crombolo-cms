/**
 * `site()` for a page render (story 206): the site's services acting as
 * whoever is asking. Media the visitor may not read answers `notFound`, never
 * `forbidden`, as `/media/` answers 404. docs/rendering.md, "Server code".
 */

import type { Principal } from '@crombolo/api-management'
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
  type QueryUser,
  type RequestMember,
  type SiteContent,
  type SiteJobs,
  type SiteMembers,
  type SiteQueries,
  type SiteServices,
  unavailableServices,
} from '@crombolo/render'
import type { MembersCaller } from './site-members.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SiteServicesDeps {
  db: Db
  cache: PublishedCache
  /** `site().jobs`, recording who queued (story 187). */
  jobs?: (queuedBy: () => Promise<string>) => SiteJobs
  /** `site().queries` for a member or a visitor (story 189). */
  queries?: (
    member: RequestMember | undefined | (() => Promise<RequestMember | undefined>),
    user?: QueryUser,
  ) => SiteQueries
  /** `site().content` (story 298): one for every caller, acting as the configured API user. */
  content?: SiteContent
  /** `site().content` acting as a signed-in user, on a staff screen's route (story 431). */
  contentAs?: (principal: Principal) => SiteContent
  /** `site().members` (story 207), for whoever is asking. */
  members?: (asking: () => Promise<MembersCaller | undefined>) => SiteMembers
}

/**
 * Builds `site()`'s services for one request; undefined `member` is a visitor or a
 * previewing editor. `asUser` is a signed-in user's, on a staff screen's route
 * (story 431): media as a visitor reads it, everything else as them.
 */
export function createSiteServices(deps: SiteServicesDeps) {
  const forMember = memberServices(deps)
  const asUser = (principal: Principal): (() => SiteServices) => {
    const user: QueryUser = {
      key: principal.id,
      name: principal.name,
      email: principal.email,
      groups: principal.groups.map((group) => group.alias),
    }
    const visitor = forMember(undefined)()
    const services: SiteServices = {
      media: visitor.media,
      queries: deps.queries?.(undefined, user) ?? ({} as SiteQueries),
      jobs:
        deps.jobs?.(async () => `user ${principal.email}`) ?? unavailableServices<SiteJobs>('jobs'),
      members:
        deps.members?.(async () => ({ kind: 'user', principal })) ??
        unavailableServices<SiteMembers>('members'),
      content: deps.contentAs?.(principal) ?? unavailableServices<SiteContent>('content'),
    }
    return () => services
  }
  return Object.assign(forMember, { asUser })
}

function memberServices(deps: SiteServicesDeps) {
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
      queries: deps.queries?.(member) ?? ({} as SiteQueries),
      jobs:
        deps.jobs?.(async () => {
          const who = await (typeof member === 'function' ? member() : Promise.resolve(member))
          return who ? `member ${who.username}` : 'a visitor'
        }) ?? unavailableServices<SiteJobs>('jobs'),
      members:
        deps.members?.(async () => {
          const who = await (typeof member === 'function' ? member() : Promise.resolve(member))
          return who ? { kind: 'member', ...who } : undefined
        }) ?? unavailableServices<SiteMembers>('members'),
      content: deps.content ?? unavailableServices<SiteContent>('content'),
    }
    return () => services
  }
}
