/**
 * The site's own services, acting as whoever the page is rendering for
 * (story 206). Each returns a `Result`; a component ends the chain with
 * `unwrap()`. Reading anything personal makes the page personal.
 */
import { Outcome, type Result } from '@crombolo/core'
import { currentSite } from './context.ts'
import type { PublishedMedia } from './media.ts'
import type { RequestMember } from './model.ts'

/** Media this visitor may read; anything else answers `notFound`, as `/media/` does. */
export interface SiteMedia {
  get(key: string): Promise<Result<PublishedMedia, 404>>
  /** A folder's items this visitor may read, in their order. */
  children(folderKey: string): Promise<Result<PublishedMedia[], 404>>
}

/** Who a named query runs for (story 189). */
export interface QueryCaller {
  /** The signed-in member, if any; asking makes the page personal. */
  member(): Promise<
    Pick<RequestMember, 'key' | 'name' | 'username' | 'email' | 'roles'> | undefined
  >
  /** The language the page renders in, when there is a page. */
  locale: string | null
}

/**
 * A named query: `db` is the site's own tables and `caller` who is asking; the
 * rest are what `site().queries.<module>.<name>(…)` is called with.
 */
// biome-ignore lint/suspicious/noExplicitAny: any handle, any arguments, any result
export type NamedQuery = (db: any, caller: QueryCaller, ...args: any[]) => any

type Bound<F> = F extends (db: never, caller: QueryCaller, ...args: infer A) => infer R
  ? (...args: A) => Promise<Awaited<R>>
  : never

/** The modules `queries` lists, as `site().queries` calls them. */
export type QueriesOf<M> = {
  readonly [K in keyof M]: { readonly [N in keyof M[K]]: Bound<M[K][N]> }
}

/**
 * Where a site registers its config's types, so `site().queries` is typed:
 * `declare module '@crombolo/crombolo/server' { interface Register { queries: typeof queries } }`.
 */
// biome-ignore lint/suspicious/noEmptyInterface: filled by the site's declaration
export interface Register {}

/** The site's named queries (story 189), typed from what `Register` says the config lists. */
export type SiteQueries = Register extends { queries: infer Q }
  ? QueriesOf<Q>
  : {
      readonly [module: string]: {
        // biome-ignore lint/suspicious/noExplicitAny: untyped until the site registers its queries
        readonly [query: string]: (...args: any[]) => Promise<Result<any>>
      }
    }

/** Members, acting as the caller; filled by story 207. */
export interface SiteMembers {
  // biome-ignore lint/suspicious/noExplicitAny: a slot story 207 will type.
  [operation: string]: (...args: any[]) => Promise<Result<any>>
}

/** A background job as the site's code reads it (story 187). */
export interface SiteJobStatus {
  id: string
  name: string
  state: 'queued' | 'running' | 'succeeded' | 'failed'
  attempts: number
  progress: { done: number; total?: number; note?: string } | null
  error: string | null
  queuedBy: string | null
  createdAt: string
  finishedAt: string | null
}

/** The site's background jobs: queue one by `module.export`, and read how one is going. */
export interface SiteJobs {
  enqueue(name: string, payload?: unknown): Promise<string>
  status(id: string): Promise<SiteJobStatus | undefined>
}

export interface SiteServices {
  media: SiteMedia
  queries: SiteQueries
  members: SiteMembers
  jobs: SiteJobs
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
