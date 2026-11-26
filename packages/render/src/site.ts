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
  /** The signed-in back-office user, on a staff screen's route (story 431); undefined for a member or a visitor. */
  user(): Promise<QueryUser | undefined>
  /** The language the page renders in, when there is a page. */
  locale: string | null
}

/** A back-office user, as a query sees them: their groups by alias. */
export interface QueryUser {
  key: string
  name: string
  email: string
  groups: string[]
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

/** A member as the site's code reads one (story 207): the properties the caller may see. */
export interface SiteMember {
  key: string
  /** Their member type's alias. */
  type: string
  name: string
  username: string
  email: string
  /** Group names. */
  groups: readonly string[]
  approved: boolean
  properties: Readonly<Record<string, unknown>>
}

/** Which members to list; `after` is the last page's `next`. */
export interface SiteMemberQuery {
  group?: string
  /** A member type's alias. */
  type?: string
  approved?: boolean
  /** Found in their name, username or e-mail. */
  text?: string
  /** Made or saved since. */
  since?: Date
  after?: string
  /** How many at once: 100, and at most 500. */
  take?: number
}

/** A change to a member: what is given, the rest kept. A property set to null is cleared. */
export interface SiteMemberChange {
  name?: string
  email?: string
  properties?: Readonly<Record<string, unknown>>
}

/**
 * Members, acting as whoever is asking: a member reaches their own record only,
 * and a job or an event handler is the API user `members.actAs` names.
 */
export interface SiteMembers {
  /** The signed-in member. */
  me(): Promise<Result<SiteMember, 403>>
  get(key: string): Promise<Result<SiteMember, 403 | 404>>
  byEmail(email: string): Promise<Result<SiteMember, 403 | 404>>
  byUsername(username: string): Promise<Result<SiteMember, 403 | 404>>
  list(
    query?: SiteMemberQuery,
  ): Promise<Result<{ items: SiteMember[]; next: string | null }, 400 | 403>>
  update(
    key: string,
    change: SiteMemberChange,
  ): Promise<Result<{ key: string }, 400 | 403 | 404 | 422>>
  addToGroups(key: string, groups: readonly string[]): Promise<Result<{ key: string }, 403 | 404>>
  removeFromGroups(
    key: string,
    groups: readonly string[],
  ): Promise<Result<{ key: string }, 403 | 404>>
  /** For good: members have no recycle bin. Never as the member themselves. */
  delete(key: string): Promise<Result<{ key: string }, 403 | 404>>
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

/**
 * A page as the site's code reads and writes it (story 298): its values by
 * alias, and by culture for a property that varies, `{ title: { 'en-GB': 'Hi' } }`.
 */
export interface SiteDocument {
  key: string
  /** Its content type's alias. */
  contentType: string
  parent: string | null
  /** Its name, or its name in each culture where the type varies. */
  name: string | Readonly<Record<string, string>>
  values: Readonly<Record<string, unknown>>
  /** Whether it, or any of its cultures, is published. */
  published: boolean
}

/** What a new page is: where, of what type, and its name and values. */
export interface SiteDocumentInput {
  parent: string | null
  /** The content type's alias. */
  contentType: string
  name: string
  /** The culture `name`, and any plain value of a varying property, are in. */
  culture?: string
  values?: Readonly<Record<string, unknown>>
}

/** A change to a page: a new name, and the values given; the rest stay. */
export interface SiteDocumentChange {
  name?: string
  culture?: string
  values?: Readonly<Record<string, unknown>>
}

type ContentWrite = Promise<Result<{ key: string }, 400 | 403 | 404 | 422>>

/**
 * Pages, as the API user the config's `content.actAs` names: its permissions
 * bound what this may do, and every change is audited as it. Writes happen in
 * an action, a route, a job or an event handler; a page render only reads.
 */
export interface SiteContent {
  /** The page as last saved. */
  get(key: string): Promise<Result<SiteDocument, 403 | 404>>
  /** A page's children as last saved, in order; `null` for the top level. */
  children(key: string | null): Promise<Result<SiteDocument[], 403 | 404>>
  create(input: SiteDocumentInput): ContentWrite
  update(key: string, change: SiteDocumentChange): ContentWrite
  /** Publishes it, or some of its cultures; a workflow may hold it for approval. */
  publish(key: string, options?: { cultures?: string[] }): ContentWrite
  unpublish(key: string, options?: { cultures?: string[] }): ContentWrite
  /** To the recycle bin. */
  delete(key: string): ContentWrite
}

/** A content event as the config's `events` handlers receive it (story 298). */
export interface SiteContentEvent {
  /** As webhooks name it: `Crombolo.ContentPublish`. */
  alias: string
  /** The page it is about. */
  key: string
  /** Its content type's alias, when it is still there to say. */
  contentType: string | null
  /** The cultures it was about, when it was about some. */
  cultures: string[] | null
  /** Who made the change. */
  actor: { kind: string; name: string }
}

export interface SiteServices {
  media: SiteMedia
  queries: SiteQueries
  members: SiteMembers
  jobs: SiteJobs
  content: SiteContent
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
