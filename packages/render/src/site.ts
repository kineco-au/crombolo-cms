/**
 * The site's own services, acting as whoever the page is rendering for
 * (story 206). Each returns a `Result`; a component ends the chain with
 * `unwrap()`. Reading anything personal makes the page personal.
 */
import { Outcome, type Result } from '@crombolo/core'
import { currentSite } from './context.ts'
import type { PublishedMedia } from './media.ts'

/** Media this visitor may read; anything else answers `notFound`, as `/media/` does. */
export interface SiteMedia {
  get(key: string): Promise<Result<PublishedMedia, 404>>
  /** A folder's items this visitor may read, in their order. */
  children(folderKey: string): Promise<Result<PublishedMedia[], 404>>
}

/** The site's own schema; filled by story 189. */
export interface SiteSql {
  // biome-ignore lint/suspicious/noExplicitAny: a slot each site's own queries will type.
  [query: string]: (...args: any[]) => Promise<Result<any>>
}

/** Members, acting as the caller; filled by story 207. */
export interface SiteMembers {
  // biome-ignore lint/suspicious/noExplicitAny: a slot story 207 will type.
  [operation: string]: (...args: any[]) => Promise<Result<any>>
}

export interface SiteServices {
  media: SiteMedia
  sql: SiteSql
  members: SiteMembers
}

/** The site's services as the visitor; only while a page renders. */
export function site(): SiteServices {
  return currentSite('site()') as SiteServices
}

/** A slot not filled yet: every call answers `notFound`, saying what is missing. */
export function unavailableServices<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, property) =>
      typeof property === 'string' && property !== 'then'
        ? async () => Outcome.notFound(`site().${name}.${property} is not available on this site.`)
        : undefined,
  })
}
