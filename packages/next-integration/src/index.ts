/**
 * A Next.js App Router front end for a crombolo site (story 208).
 *
 * `createCrombolo()` wraps the typed Delivery API client for server
 * components: answers kept in Next's cache and tagged by the content they hold,
 * drafts in Draft Mode, a member's own reads, route lookup as a `Result`, and
 * Next's `Metadata` from a page's search and sharing details.
 * docs/delivery-api.md, "A Next.js front end".
 */

import { Outcome, ok, type Result } from '@crombolo/common'
import {
  type ContentItem,
  type ContentQuery,
  createDeliveryClient,
  type DeliveryClient,
  type DeliveryClientOptions,
  DeliveryError,
  type DeliverySchema,
  memoryConditionalStore,
  type RequestOptions,
} from '@crombolo/delivery-client'
import type { Metadata } from 'next'
import { cookies, draftMode } from 'next/headers'
import { forbidden, notFound, permanentRedirect, redirect, unauthorized } from 'next/navigation'
import type { CacheAdapter } from './cache.ts'
import {
  type MemberSession,
  PREVIEW_COOKIE,
  SESSION_COOKIE,
  sessionSecret,
  unseal,
} from './session.ts'

export {
  assertSafeLocation,
  type FieldError,
  isOk,
  isOutcome,
  type MatchHandlers,
  Ok,
  Outcome,
  type OutcomeStatus,
  ok,
  Result,
} from '@crombolo/common'
export type { CacheAdapter, KeptAnswer } from './cache.ts'
export { SITE_TAG, tagOf, tagsFor } from './cache.ts'
export type { MemberSession } from './session.ts'

export interface CromboloOptions {
  /** The CMS's address, such as `https://cms.example.com`. */
  url: string
  /** The Delivery API key, for a site whose API is not public, and for preview. */
  apiKey?: string
  /** Next's cache, from `./cache-16` or `./cache-15`; without one, every read revalidates by ETag. */
  cache?: CacheAdapter
  /** `etag` revalidates every read rather than keeping it until the webhook clears it. */
  revalidate?: 'tags' | 'etag'
  /** The hostname routes resolve for, as the site's domains pick a root and culture. */
  host?: string
  culture?: string
  startItem?: string
  /** `CROMBOLO_NEXT_SECRET`, which seals a member's session; read from the environment when unset. */
  secret?: string
  /** The Delivery API's path, when the site serves it somewhere else. */
  apiPath?: string
}

/** What a page lookup can answer instead of a page. */
export type PageStatus = 301 | 302 | 303 | 307 | 308 | 401 | 403 | 404

/** The reads a page makes, through whichever client the request calls for. */
export interface CromboloReads<Schema extends DeliverySchema = DeliverySchema> {
  readonly client: DeliveryClient<Schema>
  /** The page at an address, a redirect, or a refusal, as the site would answer it. */
  page(
    path: string,
    options?: { host?: string; expand?: string },
  ): Promise<Result<ContentItem<Schema>, PageStatus>>
  /** `page()` ended with Next's own `redirect`, `permanentRedirect`, `notFound`, `unauthorized` or `forbidden`. */
  resolvePage(
    path: string,
    options?: { host?: string; expand?: string },
  ): Promise<ContentItem<Schema>>
  /** The site's not-found page for a hostname, when it has one. */
  notFoundPage(options?: { host?: string }): Promise<ContentItem<Schema> | undefined>
  item: DeliveryClient<Schema>['item']
  items: DeliveryClient<Schema>['items']
  content: DeliveryClient<Schema>['content']
  mediaItem: DeliveryClient<Schema>['mediaItem']
  media: DeliveryClient<Schema>['media']
  menu: DeliveryClient<Schema>['menu']
  dictionary: DeliveryClient<Schema>['dictionary']
  settings: DeliveryClient<Schema>['settings']
  search: DeliveryClient<Schema>['search']
  form: DeliveryClient<Schema>['form']
  sitemap: DeliveryClient<Schema>['sitemap']
}

export interface Crombolo<Schema extends DeliverySchema = DeliverySchema>
  extends CromboloReads<Schema> {
  readonly options: CromboloOptions
  /** Reads revalidated by ETag on every call, for a page rendered per request. */
  readonly fresh: CromboloReads<Schema>
  /**
   * The signed-in member's reads, never kept, or undefined for a visitor.
   * Reads the session cookie, so the page renders per request.
   */
  member(): Promise<(CromboloReads<Schema> & { session: MemberSession }) | undefined>
  /** Next's `Metadata` from a page's search and sharing details (`seo: true`). */
  metadata(item: ContentItem<Schema> | undefined, extra?: Metadata): Metadata
  /** Clears every kept answer holding these keys. */
  revalidate(keys: readonly string[]): void
}

/** An address for this path that never answers a page, to ask the site for its not-found page. */
const NOT_FOUND_PROBE = '/.crombolo/not-found'

const etagCopies = memoryConditionalStore()

export function createCrombolo<Schema extends DeliverySchema = DeliverySchema>(
  options: CromboloOptions,
): Crombolo<Schema> {
  const base: DeliveryClientOptions = {
    baseUrl: options.url,
    apiPath: options.apiPath,
    apiKey: options.apiKey,
    culture: options.culture,
    startItem: options.startItem,
  }
  const uncached = (url: string, init: RequestInit) => fetch(url, { ...init, cache: 'no-store' })

  const kept = createDeliveryClient<Schema>({
    ...base,
    fetch: options.cache
      ? async (url, init) => {
          const answer = await (options.cache as CacheAdapter).answer(
            url,
            Object.fromEntries(new Headers(init.headers)),
          )
          return new Response(answer.body || null, {
            status: answer.status,
            headers: answer.headers,
          })
        }
      : uncached,
    conditional: options.cache ? undefined : etagCopies,
  })
  const revalidated = createDeliveryClient<Schema>({
    ...base,
    fetch: uncached,
    conditional: etagCopies,
  })

  /** In Draft Mode, the editor's drafts and never a kept copy. */
  const draftClient = async (): Promise<DeliveryClient<Schema> | undefined> => {
    if (!(await draftMode()).isEnabled) return undefined
    const token = (await cookies()).get(PREVIEW_COOKIE)?.value
    return createDeliveryClient<Schema>({
      ...base,
      fetch: uncached,
      preview: () => (token ? { token } : true),
    })
  }

  const reads = (pick: () => Promise<DeliveryClient<Schema>>, fixed?: DeliveryClient<Schema>) => {
    const call =
      <K extends keyof DeliveryClient<Schema>>(name: K) =>
      async (...args: Parameters<DeliveryClient<Schema>[K]>) => {
        const client = await pick()
        return (client[name] as (...a: typeof args) => unknown)(...args)
      }
    const page: CromboloReads<Schema>['page'] = async (path, request = {}) => {
      const client = await pick()
      try {
        const answer = await client.route(path, {
          host: request.host ?? options.host,
          expand: request.expand,
          seo: true,
        })
        if (answer.kind === 'page') return ok(answer.item)
        if (answer.kind === 'notFound') return Outcome.notFound()
        switch (answer.statusCode) {
          case 301:
            return Outcome.movedPermanentlyTo(answer.location)
          case 303:
            return Outcome.seeOther(answer.location)
          case 307:
            return Outcome.redirect(answer.location)
          case 308:
            return Outcome.permanentRedirect(answer.location)
          default:
            return Outcome.foundAt(answer.location)
        }
      } catch (error) {
        if (error instanceof DeliveryError && error.status === 401) return Outcome.unauthorized()
        if (error instanceof DeliveryError && error.status === 403) return Outcome.forbidden()
        throw error
      }
    }
    return {
      get client() {
        return fixed ?? kept
      },
      page,
      async resolvePage(path, request) {
        const result = await page(path, request)
        if (result.ok) return result.value
        switch (result.status) {
          case 301:
          case 308:
            return permanentRedirect(result.location as string)
          case 302:
          case 303:
          case 307:
            return redirect(result.location as string)
          case 401:
            return unauthorized()
          case 403:
            return forbidden()
          default:
            return notFound()
        }
      },
      async notFoundPage(request = {}) {
        const answer = await (await pick()).route(NOT_FOUND_PROBE, {
          host: request.host ?? options.host,
          seo: true,
        })
        return answer.kind === 'notFound' ? (answer.item ?? undefined) : undefined
      },
      item: call('item') as DeliveryClient<Schema>['item'],
      items: call('items') as DeliveryClient<Schema>['items'],
      content: call('content') as DeliveryClient<Schema>['content'],
      mediaItem: call('mediaItem') as DeliveryClient<Schema>['mediaItem'],
      media: call('media') as DeliveryClient<Schema>['media'],
      menu: call('menu') as DeliveryClient<Schema>['menu'],
      dictionary: call('dictionary') as DeliveryClient<Schema>['dictionary'],
      settings: call('settings') as DeliveryClient<Schema>['settings'],
      search: call('search') as DeliveryClient<Schema>['search'],
      form: call('form') as DeliveryClient<Schema>['form'],
      sitemap: call('sitemap') as DeliveryClient<Schema>['sitemap'],
    } satisfies CromboloReads<Schema>
  }

  const tagged = options.revalidate === 'etag' ? revalidated : kept
  const crombolo = reads(async () => (await draftClient()) ?? tagged)

  return {
    ...crombolo,
    options,
    fresh: reads(async () => (await draftClient()) ?? revalidated, revalidated),
    async member() {
      const secret = sessionSecret(options.secret ?? process.env.CROMBOLO_NEXT_SECRET)
      const session = await unseal<MemberSession>(
        (await cookies()).get(SESSION_COOKIE)?.value,
        secret,
      )
      // An expired token is refreshed by the middleware, which may set cookies; a page may not.
      if (!session || session.expiresAt <= Date.now()) return undefined
      const preview = (await draftMode()).isEnabled
        ? (await cookies()).get(PREVIEW_COOKIE)?.value
        : undefined
      const client = createDeliveryClient<Schema>({
        ...base,
        fetch: uncached,
        memberToken: () => session.accessToken,
        ...(preview ? { preview: () => ({ token: preview }) } : {}),
      })
      return { ...reads(async () => client, client), session }
    },
    metadata: (item, extra) => metadataOf(item, extra),
    revalidate(keys) {
      options.cache?.revalidate(keys)
    },
  }
}

/** Next's `Metadata` from a page's `seo` details; `extra` wins field by field. Pure. */
export function metadataOf(
  item: { name: string; seo?: ContentItem['seo'] } | undefined,
  extra: Metadata = {},
): Metadata {
  const seo = item?.seo
  if (!seo) return { ...(item ? { title: item.name } : {}), ...extra }
  const languages = Object.fromEntries(seo.alternates.map((a) => [a.culture, a.url]))
  if (seo.xDefault) languages['x-default'] = seo.xDefault
  const image = seo.image
    ? [
        {
          url: seo.image.url,
          ...(seo.image.width ? { width: seo.image.width } : {}),
          ...(seo.image.height ? { height: seo.image.height } : {}),
        },
      ]
    : undefined
  return {
    title: { absolute: seo.title },
    ...(seo.description ? { description: seo.description } : {}),
    alternates: {
      ...(seo.canonical ? { canonical: seo.canonical } : {}),
      ...(Object.keys(languages).length > 0 ? { languages } : {}),
    },
    ...(seo.robots?.includes('noindex') ? { robots: { index: false } } : {}),
    openGraph: {
      title: seo.title,
      ...(seo.description ? { description: seo.description } : {}),
      ...(seo.canonical ? { url: seo.canonical } : {}),
      siteName: seo.siteName,
      type: 'website',
      ...(image ? { images: image } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary' },
    ...extra,
  }
}

export type {
  ApiBlockGrid,
  ApiBlockGridItem,
  ApiBlockList,
  ApiBlockListItem,
  ApiContent,
  ApiContentReference,
  ApiCrop,
  ApiElement,
  ApiFocalPoint,
  ApiLink,
  ApiMedia,
  ApiMediaReference,
  ApiMediaWithCrops,
  ApiMenu,
  ApiMenuItem,
  ApiRoute,
  ApiSeo,
  MediaItem,
  Paged,
  RichTextElement,
  RichTextGenericElement,
  RichTextTextElement,
  RichTextValue,
  SearchHit,
  SettingsItem,
} from '@crombolo/delivery-client'
export { decodeEntities, isExpanded, walkRichText } from '@crombolo/delivery-client'
export type { ContentItem, ContentQuery, DeliverySchema, RequestOptions }
