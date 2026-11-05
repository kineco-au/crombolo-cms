/**
 * The checks every search provider is held to (story 273), run against a
 * provider by its own tests: writing, replacing and removing, word-prefix
 * matching, culture, content types, access, ranking, paging and totals. It
 * needs no test framework and answers a report, as the remote protocol's
 * suite does. docs/search.md, "Providers".
 */
import type {
  BackofficeSearchEntry,
  BackofficeSearchProvider,
  SearchItem,
  SearchKind,
  SiteSearchEntry,
  SiteSearchProvider,
  SiteSearchText,
} from './search-providers.ts'
import { searchWords } from './search-providers.ts'

export interface SearchConformanceCheck {
  name: string
  ok: boolean
  detail?: string
}

export interface SearchConformanceReport {
  passed: boolean
  checks: SearchConformanceCheck[]
}

export interface SearchConformanceOptions {
  backoffice?: BackofficeSearchProvider
  site?: SiteSearchProvider
  /**
   * Makes an item the provider may be given: a real page, media item or
   * member where the provider reads its store, a made-up one where it does
   * not. Pages of one call share no ancestry unless `parent` says so.
   */
  item(spec: {
    kind: SearchKind
    contentTypeAlias: string
    parent?: SearchItem
  }): Promise<SearchItem>
}

class Failed extends Error {}

function expect(condition: boolean, detail: string): void {
  if (!condition) throw new Failed(detail)
}

const words = (...texts: string[]) => texts.flatMap(searchWords).join(' ')

const backofficeEntry = (name: string, body = '', culture = ''): BackofficeSearchEntry => ({
  culture,
  name: words(name),
  body: words(body),
  fields: { nodeName: [name], ...(body ? { bodyText: [body] } : {}) },
})

const siteText = (name: string, text: Partial<SiteSearchText> = {}): SiteSearchText => ({
  name,
  high: text.high ?? [],
  normal: text.normal ?? [],
  low: text.low ?? [],
})

const siteEntry = (
  culture: string,
  name: string,
  text: Partial<SiteSearchText> = {},
): SiteSearchEntry => ({ culture, text: siteText(name, text) })

/** Runs every check that applies to the providers given, each on items of its own. */
export async function searchProviderConformance(
  options: SearchConformanceOptions,
): Promise<SearchConformanceReport> {
  const checks: SearchConformanceCheck[] = []
  const check = async (name: string, run: () => Promise<void>) => {
    try {
      await run()
      checks.push({ name, ok: true })
    } catch (error) {
      checks.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }
  const { backoffice, site, item } = options

  if (backoffice) {
    await check('backoffice: every word of a query matches as a prefix', async () => {
      const a = await item({ kind: 'document', contentTypeAlias: 'article' })
      const b = await item({ kind: 'document', contentTypeAlias: 'article' })
      await backoffice.write(a, [backofficeEntry('Harbour lights', 'Evening ferries')])
      await backoffice.write(b, [backofficeEntry('Harbour walk')])
      const ids = async (query: string) =>
        (await backoffice.matches(query, { kinds: ['document'], limit: 100 })).map((m) => m.id)
      expect((await ids('harb')).sort().join() === [a.id, b.id].sort().join(), 'prefix of a name')
      expect((await ids('harbour ferr')).join() === String(a.id), 'every word must match')
      expect((await ids('ÉVENING')).join() === String(a.id), 'folded: case and accents')
      expect((await ids('submarine')).length === 0, 'a word in neither')
    })
    await check('backoffice: kinds and the limit narrow the matches', async () => {
      const page = await item({ kind: 'document', contentTypeAlias: 'article' })
      const member = await item({ kind: 'member', contentTypeAlias: 'member' })
      await backoffice.write(page, [backofficeEntry('Quokka page')])
      await backoffice.write(member, [backofficeEntry('Quokka member')])
      const of = async (kinds: SearchKind[], limit = 100) =>
        (await backoffice.matches('quokka', { kinds, limit })).map((m) => m.id)
      expect((await of(['member'])).join() === String(member.id), 'members only')
      expect((await of(['document'])).join() === String(page.id), 'pages only')
      expect((await of(['document', 'member'], 1)).length === 1, 'at most the limit')
    })
    await check('backoffice: a write replaces, no entries or a removal forget', async () => {
      const a = await item({ kind: 'document', contentTypeAlias: 'article' })
      const b = await item({ kind: 'document', contentTypeAlias: 'article' })
      await backoffice.write(a, [backofficeEntry('Wombat')])
      await backoffice.write(a, [backofficeEntry('Numbat')])
      await backoffice.write(b, [backofficeEntry('Wombat burrow')])
      const ids = async (query: string) =>
        (await backoffice.matches(query, { kinds: ['document'], limit: 100 })).map((m) => m.id)
      expect(!(await ids('wombat')).includes(a.id), 'the old text is gone')
      expect((await ids('numbat')).join() === String(a.id), 'the new text is found')
      await backoffice.write(a, [])
      expect((await ids('numbat')).length === 0, 'no entries: nothing to find')
      await backoffice.remove(b)
      expect((await ids('wombat')).length === 0, 'removed')
    })
    await check('backoffice: the dashboard gets stored fields, best first, paged', async () => {
      const a = await item({ kind: 'media', contentTypeAlias: 'image' })
      const b = await item({ kind: 'media', contentTypeAlias: 'image' })
      await backoffice.write(a, [backofficeEntry('Pelican', 'pelican pelican')])
      await backoffice.write(b, [backofficeEntry('Shore', 'a pelican')])
      const all = await backoffice.query('InternalIndex', 'pelican', { skip: 0, take: 10 })
      expect(all.total === 2, `total is ${all.total}, not 2`)
      expect(all.items[0]?.key === a.key, 'the item named for it ranks first')
      const fields = all.items[0]?.fields.find((f) => f.name === 'nodeName')
      expect(fields?.values.includes('Pelican') === true, 'stored fields come back')
      const second = await backoffice.query('InternalIndex', 'pelican', { skip: 1, take: 1 })
      expect(
        second.total === 2 && second.items.length === 1 && second.items[0]?.key === b.key,
        'skip and take page the hits, and total counts them all',
      )
      const members = await backoffice.query('MembersIndex', 'pelican', { skip: 0, take: 10 })
      expect(members.total === 0, 'the members index holds no media')
    })
    await check('backoffice: stats count what each index holds', async () => {
      const before = await backoffice.stats('MembersIndex')
      const member = await item({ kind: 'member', contentTypeAlias: 'member' })
      await backoffice.write(member, [backofficeEntry('Ada', 'one two three')])
      const after = await backoffice.stats('MembersIndex')
      expect(after.documentCount === before.documentCount + 1, 'one more member')
      expect(after.fieldCount >= 2, 'the fields of the fullest item')
    })
  }

  if (site) {
    await check('site: culture, and an invariant page in every culture', async () => {
      const both = await item({ kind: 'document', contentTypeAlias: 'article' })
      const invariant = await item({ kind: 'document', contentTypeAlias: 'article' })
      await site.write(both, [
        siteEntry('en-us', 'Ferry timetable'),
        siteEntry('da-dk', 'Færgekøreplan', { normal: ['ferry'] }),
      ])
      await site.write(invariant, [siteEntry('', 'Ferry news')])
      const keys = async (culture: string) =>
        (await site.query('ferry', { culture, skip: 0, take: 10 })).items
          .map((h) => `${h.key}/${h.culture}`)
          .sort()
      expect(
        (await keys('en-us')).join() === [`${both.key}/en-us`, `${invariant.key}/`].sort().join(),
        'English, and the invariant page',
      )
      expect(
        (await keys('da-dk')).join() === [`${both.key}/da-dk`, `${invariant.key}/`].sort().join(),
        'Danish, and the invariant page',
      )
    })
    await check('site: the name outranks high, normal and low text', async () => {
      const low = await item({ kind: 'document', contentTypeAlias: 'article' })
      const high = await item({ kind: 'document', contentTypeAlias: 'article' })
      const named = await item({ kind: 'document', contentTypeAlias: 'article' })
      await site.write(low, [siteEntry('', 'One', { low: ['cormorant'] })])
      await site.write(high, [siteEntry('', 'Two', { high: ['cormorant'] })])
      await site.write(named, [siteEntry('', 'Cormorant')])
      const order = (await site.query('cormorant', { culture: '', skip: 0, take: 10 })).items.map(
        (h) => h.key,
      )
      expect(order.join() === [named.key, high.key, low.key].join(), `ranked ${order.join()}`)
      const hit = (await site.query('cormorant', { culture: '', skip: 0, take: 1 })).items[0]
      expect(hit?.text.name === 'Cormorant', 'the text comes back for an excerpt')
    })
    await check('site: content types and paging, with the total', async () => {
      const a = await item({ kind: 'document', contentTypeAlias: 'article' })
      const b = await item({ kind: 'document', contentTypeAlias: 'news' })
      const c = await item({ kind: 'document', contentTypeAlias: 'news' })
      for (const page of [a, b, c]) await site.write(page, [siteEntry('', 'Lighthouse')])
      const news = await site.query('lighthouse', {
        culture: '',
        types: ['news'],
        skip: 0,
        take: 10,
      })
      expect(
        news.total === 2 && news.items.every((h) => h.key !== a.key),
        'only the types asked for, counted',
      )
      const page = await site.query('lighthouse', { culture: '', skip: 2, take: 2 })
      expect(page.total === 3 && page.items.length === 1, 'skip and take, and the whole total')
    })
    await check('site: a page under a denied branch is left out, and counted out', async () => {
      const closed = await item({ kind: 'document', contentTypeAlias: 'article' })
      const inside = await item({ kind: 'document', contentTypeAlias: 'article', parent: closed })
      const reopened = await item({ kind: 'document', contentTypeAlias: 'article', parent: closed })
      const below = await item({ kind: 'document', contentTypeAlias: 'article', parent: reopened })
      const open = await item({ kind: 'document', contentTypeAlias: 'article' })
      for (const page of [inside, below, open]) await site.write(page, [siteEntry('', 'Albatross')])
      const found = await site.query('albatross', {
        culture: '',
        access: { denied: [closed.id], allowed: [reopened.id] },
        skip: 0,
        take: 10,
      })
      const keys = found.items.map((h) => h.key).sort()
      expect(keys.join() === [below.key, open.key].sort().join(), `found ${keys.join()}`)
      expect(found.total === 2, `total is ${found.total}, not 2`)
    })
    await check('site: a write replaces, and a removal forgets', async () => {
      const page = await item({ kind: 'document', contentTypeAlias: 'article' })
      await site.write(page, [siteEntry('', 'Gannet')])
      await site.write(page, [siteEntry('', 'Booby')])
      const total = async (query: string) =>
        (await site.query(query, { culture: '', skip: 0, take: 10 })).total
      expect((await total('gannet')) === 0, 'the old text is gone')
      expect((await total('booby')) === 1, 'the new text is found')
      const before = (await site.stats()).documentCount
      await site.remove(page)
      expect((await total('booby')) === 0, 'removed')
      expect((await site.stats()).documentCount === before - 1, 'one fewer counted')
    })
  }

  return { passed: checks.every((c) => c.ok), checks }
}
