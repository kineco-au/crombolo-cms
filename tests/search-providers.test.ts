/**
 * Story 273: backoffice search and site search through providers. The
 * conformance suite holds the database providers and an in-memory one to the
 * same checks, and a site configured with the in-memory ones indexes, searches,
 * forgets, retries and reports through them with no full-text rows written.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  type SearchItem,
  type SearchKind,
  SYSTEM_MEDIA_TYPE_KEYS,
  searchProviderConformance,
} from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  NodeRepository,
  SYSTEM_MEMBER_TYPE,
  searchItemFor,
  searchProvidersOf,
} from '@crombolo/data'
import { type Harness, signedInServer, V1 } from './support/harness.ts'
import { memorySearch } from './support/memory-search.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const type = (alias: string) => `[content-type]
alias = "${alias}"
name = "${alias}"
allow-at-root = true
allow-children = ["article", "news"]
components = ["page"]
default-component = "page"

[[property]]
alias = "bodyText"
name = "Body"
type = "textarea"
`

const RESULTS = `import { search } from '@crombolo/crombolo'

export default async function Page({ model, request }) {
  const q = new URL(request.url).searchParams.get('q') ?? ''
  if (!q) return <h1>{model.name}</h1>
  const results = await search(q)
  return <p class="found">{results.total}:{results.items.map((i) => i.name).join(',')}</p>
}
`

async function site(config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'search-providers-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  for (const alias of ['article', 'news'])
    writeFileSync(join(root, 'schema', 'content-types', `${alias}.toml`), type(alias))
  writeFileSync(join(root, 'components', 'page.tsx'), RESULTS)
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      deliveryApi: { enabled: true },
      ...config,
    },
  })
  open.push(h)
  // The tests run the indexer themselves.
  h.server.jobs.stop()
  const types = new ContentTypeRepository(h.server.db)
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const page = async (
    name: string,
    options: { alias?: string; parent?: string | null; body?: string; publish?: boolean } = {},
  ) => {
    const typeKey = (await types.byAlias(options.alias ?? 'article'))?.key as string
    const response = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: options.parent ? { id: options.parent } : null,
      values: options.body
        ? [{ alias: 'bodyText', value: options.body, culture: null, segment: null }]
        : [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (response.status !== 201)
      throw new Error(`page ${response.status}: ${await response.text()}`)
    const key = response.headers.get('umb-generated-resource') as string
    if (options.publish !== false)
      await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
    return key
  }
  const media = async (name: string) => {
    const response = await h.post(`${V1}/media`, {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (response.status !== 201) throw new Error(`media ${response.status}`)
    return response.headers.get('umb-generated-resource') as string
  }
  let members = 0
  const member = async () => {
    const username = `member${++members}`
    const response = await h.post(`${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: `${username}@example.test`,
      username,
      password: 'a-long-enough-password-1',
      isApproved: true,
      groups: [],
      values: [],
      variants: [{ culture: null, segment: null, name: username }],
    })
    if (response.status !== 201)
      throw new Error(`member ${response.status}: ${await response.text()}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const itemOf = async (key: string) => {
    const node = await new NodeRepository(h.server.db).byKey(key)
    return (await searchItemFor(h.server.db, node?.id as number)) as SearchItem
  }
  const index = () => h.server.jobs.runSearchIndexing()
  const rows = async (table: 'search_document' | 'site_search_document' | 'search_index_queue') =>
    Number(
      (await h.server.db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n ?? 0,
    )
  return { h, page, media, member, itemOf, index, rows }
}

const failures = (report: Awaited<ReturnType<typeof searchProviderConformance>>) =>
  report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)

describe(`the conformance suite (${process.env.CROMBOLO_DB ?? 'sqlite'})`, () => {
  test('the database providers pass it', async () => {
    const { h, page, media, member, itemOf } = await site()
    const providers = searchProvidersOf(h.server.db)
    const report = await searchProviderConformance({
      backoffice: providers.backoffice,
      site: providers.site,
      async item(spec) {
        const make: Record<SearchKind, () => Promise<string>> = {
          document: () =>
            page(`p${crypto.randomUUID().slice(0, 8)}`, {
              alias: spec.contentTypeAlias === 'news' ? 'news' : 'article',
              parent: spec.parent?.key ?? null,
              publish: false,
            }),
          media: () => media(`m${crypto.randomUUID().slice(0, 8)}`),
          member,
        }
        return itemOf(await make[spec.kind]())
      },
    })
    expect(failures(report)).toEqual([])
    expect(report.checks.length).toBe(10)
  })

  test('an in-memory provider passes it, so the interfaces need no database', async () => {
    const memory = memorySearch()
    let next = 1
    const report = await searchProviderConformance({
      backoffice: memory.backoffice,
      site: memory.site,
      async item(spec) {
        const id = next++
        return {
          id,
          key: crypto.randomUUID(),
          kind: spec.kind,
          contentTypeAlias: spec.contentTypeAlias,
          path: [...(spec.parent?.path ?? []), id],
          trashed: false,
        }
      },
    })
    expect(failures(report)).toEqual([])
  })

  test('a provider that does not hold the contract fails it', async () => {
    const memory = memorySearch()
    const report = await searchProviderConformance({
      site: { ...memory.site, remove: async () => {} },
      item: async (spec) => ({
        id: Math.floor(Math.random() * 1e9),
        key: crypto.randomUUID(),
        kind: spec.kind,
        contentTypeAlias: spec.contentTypeAlias,
        path: [],
        trashed: false,
      }),
    })
    expect(report.passed).toBe(false)
    expect(failures(report).join()).toContain('removed')
  })
})

describe(`a site with its own providers (${process.env.CROMBOLO_DB ?? 'sqlite'})`, () => {
  async function withMemory() {
    const memory = memorySearch()
    const s = await site({
      search: { backoffice: () => memory.backoffice, site: () => memory.site, matchLimit: 50 },
    })
    return { ...s, memory }
  }

  test('indexes and searches through them, writing no full-text rows', async () => {
    const { h, page, member, index, rows, memory } = await withMemory()
    const harbour = await page('Harbour', { body: 'Ferries leave at dawn' })
    const lights = await page('Lights', { body: 'The harbour lights' })
    await page('Draft harbour', { publish: false })
    await member()
    await index()
    expect(await rows('search_document')).toBe(0)
    expect(await rows('site_search_document')).toBe(0)
    expect(memory.backofficeItems.size).toBeGreaterThanOrEqual(4)

    // The back office's item search joins the provider's matches.
    const found = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/item/document/search?query=harbour&skip=0&take=10`,
    )
    expect(found.items.map((i) => i.id)).toContain(lights)
    expect(found.items.map((i) => i.id)).toContain(harbour)

    // Site search finds published pages only, from a component and the Delivery API.
    const html = await (await h.call('/?q=harbour')).text()
    expect(/class="found">(\d+):/.exec(html)?.[1]).toBe('2')
    const api = (await (await h.call('/umbraco/delivery/api/v2/search?term=ferries')).json()) as {
      total: number
      items: Array<{ id: string }>
    }
    expect(api.items.map((i) => i.id)).toEqual([harbour])

    // The dashboard reads its numbers and hits from the provider.
    const internal = await h.json<{ documentCount: number }>(`${V1}/indexer/InternalIndex`)
    expect(internal.documentCount).toBe(
      [...memory.backofficeItems.values()].filter((i) => i.item.kind !== 'member').length,
    )
    const hits = await h.json<{ total: number }>(
      `${V1}/searcher/InternalSearcher/query?term=ferries&skip=0&take=10`,
    )
    expect(hits.total).toBe(1)
  })

  test('a delete for good reaches the provider, and a move gives it the new path', async () => {
    const { h, page, itemOf, index, rows, memory } = await withMemory()
    const parent = await page('Parent')
    const child = await page('Child', { parent, body: 'gull' })
    const elsewhere = await page('Elsewhere')
    await index()

    expect(
      (await h.put(`${V1}/document/${child}/move`, { target: { id: elsewhere } })).status,
    ).toBe(200)
    expect(await rows('search_index_queue')).toBeGreaterThan(0)
    await index()
    const moved = await itemOf(child)
    expect(memory.siteItems.get(moved.id)?.item.path).toEqual(moved.path)

    expect((await h.put(`${V1}/document/${elsewhere}/move-to-recycle-bin`, {})).status).toBe(200)
    expect((await h.del(`${V1}/recycle-bin/document`)).status).toBe(200)
    expect(await rows('search_removal' as 'search_document')).toBeGreaterThan(0)
    await index()
    expect(memory.backofficeItems.has(moved.id)).toBe(false)
    expect(memory.siteItems.has(moved.id)).toBe(false)
    expect(await rows('search_removal' as 'search_document')).toBe(0)
  })

  test('a provider that fails leaves the work queued, done once it recovers', async () => {
    const { h, page, index, rows, memory } = await withMemory()
    memory.failing = new Error('the service is down')
    const key = await page('Petrel', { body: 'storm' })
    await index()
    expect(await rows('search_index_queue')).toBeGreaterThan(0)
    expect(memory.siteItems.size).toBe(0)

    const status = await h.post(`${V1}/health-check-group/Search/check`, {})
    expect(status.status).toBe(200)

    memory.failing = undefined
    await index()
    expect(await rows('search_index_queue')).toBe(0)
    const api = (await (await h.call('/umbraco/delivery/api/v2/search?term=storm')).json()) as {
      items: Array<{ id: string }>
    }
    expect(api.items.map((i) => i.id)).toEqual([key])
  })

  test('the status check and settings name the providers and say when one is down', async () => {
    const { h, memory } = await withMemory()
    type Check = { checks: Array<{ results: Array<{ resultType: string; message: string }> }> }
    const run = () => h.json<Check>(`${V1}/health-check-group/Search/check`, { method: 'POST' })
    const healthy = (await run()).checks[0]?.results ?? []
    expect(healthy.map((r) => r.resultType)).toEqual(['Success', 'Success'])
    expect(healthy[0]?.message).toBe('Back-office search uses memory, which is answering.')
    memory.healthy = false
    const down = (await run()).checks[0]?.results ?? []
    expect(down.map((r) => r.resultType)).toEqual(['Error', 'Error'])
    expect(down[1]?.message).toBe(
      'Site search uses memory, which is not answering: the memory is unplugged',
    )
  })

  test('a query taking the whole match limit is still answered, from the matches it took', async () => {
    const { h, page, index } = await withMemory()
    for (let i = 0; i < 55; i++) await page(`Tern ${i}`, { publish: false })
    await index()
    const found = await h.json<{ total: number }>(
      `${V1}/item/document/search?query=tern&skip=0&take=10`,
    )
    // Every name matches by itself; the provider's matches are capped at 50.
    expect(found.total).toBe(55)
  })
})
