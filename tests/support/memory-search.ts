/**
 * Search providers kept in memory (story 273): what a site's own provider does,
 * with nothing in the database, so the tests prove the interfaces carry every
 * search. Each can be made to fail, as a service that is down does.
 */
import {
  BACKOFFICE_INDEX_KINDS,
  type BackofficeSearchEntry,
  type BackofficeSearchProvider,
  openTo,
  type SearchItem,
  type SiteSearchEntry,
  type SiteSearchProvider,
  searchTerms,
  searchWords,
} from '@crombolo/core'

const holdsAll = (text: string, terms: readonly string[]) => {
  const words = text.split(' ').filter(Boolean)
  return terms.every((term) => words.some((word) => word.startsWith(term)))
}

const hits = (text: string, terms: readonly string[]) => {
  const words = text.split(' ').filter(Boolean)
  return words.filter((word) => terms.some((term) => word.startsWith(term))).length
}

export interface MemorySearch {
  backoffice: BackofficeSearchProvider
  site: SiteSearchProvider
  /** What each holds, by node id. */
  backofficeItems: Map<number, { item: SearchItem; entries: readonly BackofficeSearchEntry[] }>
  siteItems: Map<number, { item: SearchItem; entries: readonly SiteSearchEntry[] }>
  /** While set, every call throws it. */
  failing?: Error
  healthy: boolean
}

export function memorySearch(): MemorySearch {
  const state: MemorySearch = {
    backofficeItems: new Map(),
    siteItems: new Map(),
    healthy: true,
    backoffice: undefined as unknown as BackofficeSearchProvider,
    site: undefined as unknown as SiteSearchProvider,
  }
  const guard = () => {
    if (state.failing) throw state.failing
  }
  const fold = (texts: readonly string[]) => texts.flatMap(searchWords).join(' ')

  state.backoffice = {
    name: 'memory',
    async write(item, entries) {
      guard()
      if (entries.length === 0) state.backofficeItems.delete(item.id)
      else state.backofficeItems.set(item.id, { item, entries })
    },
    async remove(item) {
      guard()
      state.backofficeItems.delete(item.id)
    },
    async matches(query, options) {
      guard()
      const terms = searchTerms(query)
      const found: Array<{ id: number; score: number }> = []
      for (const { item, entries } of state.backofficeItems.values()) {
        if (!options.kinds.includes(item.kind)) continue
        let score = 0
        for (const entry of entries)
          if (holdsAll(`${entry.name} ${entry.body}`, terms))
            score = Math.max(score, 10 * hits(entry.name, terms) + hits(entry.body, terms))
        if (score > 0) found.push({ id: item.id, score })
      }
      return found.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, options.limit)
    },
    async query(index, query, paging) {
      const matched = await state.backoffice.matches(query, {
        kinds: BACKOFFICE_INDEX_KINDS[index],
        limit: Number.MAX_SAFE_INTEGER,
      })
      return {
        total: matched.length,
        items: matched.slice(paging.skip, paging.skip + paging.take).map((m) => {
          const held = state.backofficeItems.get(m.id)
          const fields = new Map<string, string[]>()
          for (const entry of held?.entries ?? [])
            for (const [name, values] of Object.entries(entry.fields))
              fields.set(name, [...new Set([...(fields.get(name) ?? []), ...values])])
          return {
            key: held?.item.key ?? '',
            score: m.score,
            fields: [...fields].map(([name, values]) => ({ name, values })),
          }
        }),
      }
    },
    async stats(index) {
      guard()
      const held = [...state.backofficeItems.values()].filter(({ item }) =>
        BACKOFFICE_INDEX_KINDS[index].includes(item.kind),
      )
      return {
        documentCount: held.length,
        fieldCount: Math.max(
          0,
          ...held.flatMap(({ entries }) => entries.map((e) => Object.keys(e.fields).length)),
        ),
      }
    },
    async clear(index) {
      guard()
      for (const [id, { item }] of state.backofficeItems)
        if (BACKOFFICE_INDEX_KINDS[index].includes(item.kind)) state.backofficeItems.delete(id)
    },
    health: async () =>
      state.healthy ? { ok: true } : { ok: false, detail: 'the memory is unplugged' },
  }

  state.site = {
    name: 'memory',
    async write(item, entries) {
      guard()
      if (entries.length === 0) state.siteItems.delete(item.id)
      else state.siteItems.set(item.id, { item, entries })
    },
    async remove(item) {
      guard()
      state.siteItems.delete(item.id)
    },
    async query(query, options) {
      guard()
      const terms = searchTerms(query)
      const found: Array<{ item: SearchItem; entry: SiteSearchEntry; score: number }> = []
      for (const { item, entries } of state.siteItems.values()) {
        if (options.types?.length && !options.types.includes(item.contentTypeAlias)) continue
        if (!openTo(item.path, options.access)) continue
        for (const entry of entries) {
          if (entry.culture !== '' && entry.culture !== options.culture.toLowerCase()) continue
          const t = entry.text
          const all = fold([t.name, ...t.high, ...t.normal, ...t.low])
          if (!holdsAll(all, terms)) continue
          const score =
            10 * hits(fold([t.name]), terms) +
            5 * hits(fold(t.high), terms) +
            2 * hits(fold(t.normal), terms) +
            hits(fold(t.low), terms)
          found.push({ item, entry, score })
        }
      }
      found.sort((a, b) => b.score - a.score || a.item.id - b.item.id)
      return {
        total: found.length,
        items: found.slice(options.skip, options.skip + options.take).map((f) => ({
          key: f.item.key,
          culture: f.entry.culture,
          score: f.score,
          text: f.entry.text,
        })),
      }
    },
    async stats() {
      guard()
      return { documentCount: state.siteItems.size }
    },
    async clear() {
      guard()
      state.siteItems.clear()
    },
    health: async () =>
      state.healthy ? { ok: true } : { ok: false, detail: 'the memory is unplugged' },
  }
  return state
}
