/**
 * The interfaces a search provider implements (story 273): one for backoffice
 * search, over drafts, and one for site search, over published pages. The
 * database providers in `@crombolo/data` are the defaults; a site replaces
 * either in `crombolo.config.ts`. Crombolo still decides what an item's text
 * is and who may see a result: a provider stores the documents it is given
 * and finds them again. docs/search.md, "Providers".
 */

/**
 * Lowercase words without diacritics: letters and digits only, everything else
 * a separator. The index stores text in this form, so the full-text engines on
 * both dialects only ever split on spaces, and match the same way. A provider
 * folds a query with it to meet what it was given.
 */
export function searchWords(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
}

/** The distinct words of a query, at most a dozen: what every result must hold by prefix. */
export function searchTerms(query: string): string[] {
  return [...new Set(searchWords(query))].slice(0, 12)
}

/** What an indexed item is. */
export type SearchKind = 'document' | 'media' | 'member'

/** Umbraco's names for the two backoffice indexes, which the dashboard shows. */
export type BackofficeIndexName = 'InternalIndex' | 'MembersIndex'

/** The kinds each backoffice index covers. */
export const BACKOFFICE_INDEX_KINDS: Readonly<Record<BackofficeIndexName, readonly SearchKind[]>> =
  {
    InternalIndex: ['document', 'media'],
    MembersIndex: ['member'],
  }

/** The item a provider is given its documents for. */
export interface SearchItem {
  /** The node's id, which `matches` answers with. */
  id: number
  key: string
  kind: SearchKind
  contentTypeAlias: string
  /** Node ids from the root down to the item itself, for access filtering. */
  path: readonly number[]
  trashed: boolean
}

/** An item in one culture, '' when invariant: backoffice search's document. */
export interface BackofficeSearchEntry {
  culture: string
  /** Folded words: the name, and for a member its e-mail and username. */
  name: string
  /** Folded words of the item's draft values. */
  body: string
  /** The same text by property alias, as the Examine dashboard shows it. */
  fields: Record<string, string[]>
}

/** A page's text in one culture, by the weight `site-search` gives each property. */
export interface SiteSearchText {
  name: string
  high: string[]
  normal: string[]
  low: string[]
}

/** A published page in one culture, '' when invariant: site search's document. */
export interface SiteSearchEntry {
  culture: string
  text: SiteSearchText
}

export interface SearchMatch {
  id: number
  score: number
}

export interface BackofficeSearchHit {
  key: string
  score: number
  fields: Array<{ name: string; values: string[] }>
}

/**
 * Protected nodes, by id, that the person searching may not open and may
 * (`branchAccess`). A page is left out when the nearest of them on its path is
 * denied: `openTo` says so.
 */
export interface SearchAccess {
  denied: readonly number[]
  allowed: readonly number[]
}

export interface SiteSearchQuery {
  /** Lowercase; an invariant page ('' culture) matches every culture. */
  culture: string
  /** Content type aliases; every type when empty or absent. */
  types?: readonly string[]
  access?: SearchAccess
  skip: number
  take: number
}

export interface SiteSearchHit {
  key: string
  culture: string
  score: number
  /** The text an excerpt is cut from. */
  text: SiteSearchText
}

export interface SearchProviderHealth {
  ok: boolean
  detail?: string
}

export interface BackofficeSearchProvider {
  /** Shown in settings and on the status check. */
  readonly name: string
  /** Replaces what is stored for the item; no entries means nothing to find. */
  write(item: SearchItem, entries: readonly BackofficeSearchEntry[]): Promise<void>
  /** The item was deleted for good. */
  remove(item: Pick<SearchItem, 'id' | 'key' | 'kind'>): Promise<void>
  /** Items holding every word of `query` as a word prefix, best first, at most `limit`. */
  matches(
    query: string,
    options: { kinds: readonly SearchKind[]; limit: number },
  ): Promise<SearchMatch[]>
  /** The Examine dashboard's search: every stored field of each hit, best first. */
  query(
    index: BackofficeIndexName,
    query: string,
    paging: { skip: number; take: number },
  ): Promise<{ total: number; items: BackofficeSearchHit[] }>
  stats(index: BackofficeIndexName): Promise<{ documentCount: number; fieldCount: number }>
  /** Forgets an index before it is rebuilt; absent where a rebuild overwrites in place. */
  clear?(index: BackofficeIndexName): Promise<void>
  health?(): Promise<SearchProviderHealth>
}

export interface SiteSearchProvider {
  readonly name: string
  /** Replaces what is stored for the page; no entries means it is not to be found. */
  write(item: SearchItem, entries: readonly SiteSearchEntry[]): Promise<void>
  remove(item: Pick<SearchItem, 'id' | 'key' | 'kind'>): Promise<void>
  /** Pages holding every word as a word prefix, best first; `total` counts what may be seen. */
  query(query: string, options: SiteSearchQuery): Promise<{ total: number; items: SiteSearchHit[] }>
  stats(): Promise<{ documentCount: number }>
  clear?(): Promise<void>
  health?(): Promise<SearchProviderHealth>
}

/**
 * Whether a page on `path` (root first, the page last) is open to the person
 * `access` describes: the nearest protected node on it decides. Pure.
 */
export function openTo(path: readonly number[], access: SearchAccess | undefined): boolean {
  if (!access) return true
  const denied = new Set(access.denied)
  const allowed = new Set(access.allowed)
  for (let i = path.length - 1; i >= 0; i--) {
    const id = path[i] as number
    if (denied.has(id)) return false
    if (allowed.has(id)) return true
  }
  return true
}
