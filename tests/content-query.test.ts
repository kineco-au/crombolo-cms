/**
 * Story 183: finding pages by their facts. The query over the draft (type,
 * place, dates, state, name, full text, value comparisons, sort and paging),
 * the scope a user queries within (start nodes, Browse, properties they may
 * read), and the endpoint and the command line that answer it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT_ACCESS } from '@crombolo/core'
import {
  ContentTypeRepository,
  parseContentQuery,
  type QueryScope,
  queryDocuments,
} from '@crombolo/data'
import { memoryKeychain, OPERATOR_SCOPE } from '@crombolo/server'
import { discover, RemoteClient, signIn } from '../packages/cli/src/remote/client.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const QUERY = `${BACKOFFICE}/crombolo/api/content-query`

const SECTION = `[content-type]
alias = "section"
name = "Section"
allow-at-root = true
allow-children = ["section", "article"]

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const ARTICLE = `[content-type]
alias = "article"
name = "Article"

[[property]]
alias = "title"
name = "Title"
type = "textstring"

[[property]]
alias = "price"
name = "Price"
type = "numeric"

[[property]]
alias = "launch"
name = "Launch"
type = "datePicker"

[[property]]
alias = "summary"
name = "Summary"
type = "textarea"

[[property]]
alias = "body"
name = "Body"
type = "richtext"

[[property]]
alias = "featured"
name = "Featured"
type = "trueFalse"
`

let h: Harness
let root: string
const keys: Record<string, string> = {}
let typeKeys: Record<string, string> = {}

async function create(
  type: 'section' | 'article',
  name: string,
  parent: string | null,
  values: Record<string, unknown> = {},
): Promise<string> {
  const response = await h.post(`${V1}/document`, {
    documentType: { id: typeKeys[type] },
    parent: parent ? { id: parent } : null,
    template: null,
    values: Object.entries(values).map(([alias, value]) => ({
      alias,
      culture: null,
      segment: null,
      value,
    })),
    variants: [{ culture: null, segment: null, name }],
  })
  if (response.status !== 201) throw new Error(`create ${name}: ${await response.text()}`)
  return response.headers.get('umb-generated-resource') as string
}

const publish = async (key: string) => {
  const response = await h.put(`${V1}/document/${key}/publish`, {
    publishSchedules: [{ culture: null }],
  })
  if (!response.ok) throw new Error(`publish: ${await response.text()}`)
}

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'content-query-'))
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'section.toml'), SECTION)
  writeFileSync(join(root, 'schema', 'content-types', 'article.toml'), ARTICLE)
  h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 3,
      },
    },
  })
  const types = new ContentTypeRepository(h.server.db)
  typeKeys = {
    section: (await types.byAlias('section'))?.key as string,
    article: (await types.byAlias('article'))?.key as string,
  }
  keys.news = await create('section', 'News', null)
  keys.shop = await create('section', 'Shop', null)
  keys.deep = await create('section', 'Deep', keys.news)
  keys.harbour = await create('article', 'Harbour lights', keys.news, {
    price: 12,
    launch: '2026-10-05 00:00:00',
    summary: 'Lights along the 100% pier',
    featured: true,
  })
  keys.cove = await create('article', 'The cove', keys.news, {
    price: 30,
    launch: '2026-11-20 00:00:00',
    summary: '',
  })
  keys.kiln = await create('article', 'Kiln_fired', keys.shop, { price: 5 })
  keys.buried = await create('article', 'Buried note', keys.deep, {
    price: 99,
    summary: 'down here',
  })
  keys.gone = await create('article', 'Gone', keys.shop, { price: 1 })
  await publish(keys.news)
  await publish(keys.harbour)
  await publish(keys.cove)
  // Published, then changed and saved again: published with unpublished changes.
  await h.put(`${V1}/document/${keys.cove}`, {
    template: null,
    // A save replaces every value, so the ones it keeps are sent again.
    values: [
      { alias: 'price', culture: null, segment: null, value: 31 },
      { alias: 'launch', culture: null, segment: null, value: '2026-11-20 00:00:00' },
      { alias: 'summary', culture: null, segment: null, value: '' },
    ],
    variants: [{ culture: null, segment: null, name: 'The cove' }],
  })
  await h.put(`${V1}/document/${keys.gone}/move-to-recycle-bin`, {})
}, 60_000)

afterAll(async () => {
  await h.db.close().catch(() => {})
  rmSync(root, { recursive: true, force: true })
})

/** The names a query answers with, in order, as the operator sees them. */
async function names(body: Record<string, unknown>, scope: QueryScope = OPERATOR_SCOPE) {
  const parsed = parseContentQuery({ entity: 'document', ...body })
  if (!parsed.ok) throw new Error(parsed.problems.join('; '))
  return (await queryDocuments(h.server.db, parsed.query, scope)).items.map((i) => i.name)
}

describe(`finding pages (${dialectUnderTest})`, () => {
  test('by type, by alias or key, sorted by name by default', async () => {
    expect(await names({ contentTypes: ['article'] })).toEqual([
      'Buried note',
      'Harbour lights',
      'Kiln_fired',
      'The cove',
    ])
    expect(await names({ contentTypes: [typeKeys.section as string] })).toEqual([
      'Deep',
      'News',
      'Shop',
    ])
  })

  test('by place: under, parent and depth', async () => {
    expect(await names({ under: keys.news })).toEqual([
      'Buried note',
      'Deep',
      'Harbour lights',
      'The cove',
    ])
    expect(await names({ parent: keys.news })).toEqual(['Deep', 'Harbour lights', 'The cove'])
    expect(await names({ under: keys.news, maxDepth: 1 })).toEqual([
      'Deep',
      'Harbour lights',
      'The cove',
    ])
  })

  test('by state, with the bin left out unless asked for', async () => {
    expect(await names({ state: ['published'] })).toEqual(['Harbour lights', 'News'])
    expect(await names({ state: ['changed'] })).toEqual(['The cove'])
    expect(await names({ state: ['draft'], contentTypes: ['article'] })).toEqual([
      'Buried note',
      'Kiln_fired',
    ])
    expect(await names({ contentTypes: ['article'] })).not.toContain('Gone')
    expect(await names({ state: ['trashed'] })).toEqual(['Gone'])
  })

  test('by name, with LIKE wildcards taken literally', async () => {
    expect(await names({ name: { op: 'contains', value: 'OVE' } })).toEqual(['The cove'])
    expect(await names({ name: { op: 'startsWith', value: 'harbour' } })).toEqual([
      'Harbour lights',
    ])
    expect(await names({ name: { op: 'equals', value: 'news' } })).toEqual(['News'])
    // `_` matches only an underscore, and `%` only a percent sign.
    expect(await names({ name: { op: 'contains', value: '_' } })).toEqual(['Kiln_fired'])
    expect(
      await names({ properties: [{ alias: 'summary', op: 'contains', value: '100%' }] }),
    ).toEqual(['Harbour lights'])
  })

  test('by dates', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString()
    expect(await names({ created: { to: tomorrow }, contentTypes: ['section'] })).toHaveLength(3)
    expect(await names({ updated: { from: tomorrow } })).toEqual([])
  })

  test('numbers compare as numbers, dates as dates, text without case', async () => {
    const where = (op: string, value?: unknown, alias = 'price') =>
      names({ properties: [{ alias, op, value }] })
    expect(await where('gt', 12)).toEqual(['Buried note', 'The cove'])
    expect(await where('gte', 12)).toEqual(['Buried note', 'Harbour lights', 'The cove'])
    expect(await where('lt', 12)).toEqual(['Kiln_fired'])
    expect(await where('lte', 5)).toEqual(['Kiln_fired'])
    // The draft's value: the cove was saved at 31 after publishing at 30.
    expect(await where('eq', 31)).toEqual(['The cove'])
    // `ne` includes pages with no value at all.
    expect(await where('ne', 31)).toEqual([
      'Buried note',
      'Deep',
      'Harbour lights',
      'Kiln_fired',
      'News',
      'Shop',
    ])
    expect(await where('gt', '2026-11-01', 'launch')).toEqual(['The cove'])
    expect(await where('eq', 'DOWN HERE', 'summary')).toEqual(['Buried note'])
    expect(await where('eq', true, 'featured')).toEqual(['Harbour lights'])
  })

  test('exists and empty, which is all a structured value takes', async () => {
    expect(await names({ properties: [{ alias: 'summary', op: 'exists' }] })).toEqual([
      'Buried note',
      'Harbour lights',
    ])
    expect(
      await names({ contentTypes: ['article'], properties: [{ alias: 'summary', op: 'empty' }] }),
    ).toEqual(['Kiln_fired', 'The cove'])
    expect(
      await names({ properties: [{ alias: 'body', op: 'empty' }], contentTypes: ['article'] }),
    ).toHaveLength(4)
    await expect(
      names({ properties: [{ alias: 'body', op: 'contains', value: 'x' }] }),
    ).rejects.toThrow('structured content')
  })

  test('full text through the existing index', async () => {
    // The index is filled by the background job.
    await h.server.jobs.runSearchIndexing()
    expect(await names({ text: 'pier' })).toEqual(['Harbour lights'])
  })

  test('sorting and paging', async () => {
    expect(
      await names({
        contentTypes: ['article'],
        sort: { by: 'name', dir: 'desc' },
        skip: 1,
        take: 2,
      }),
    ).toEqual(['Kiln_fired', 'Harbour lights'])
    const page = await queryDocuments(
      h.server.db,
      (parseContentQuery({ entity: 'document', take: 2 }) as { ok: true; query: never }).query,
      OPERATOR_SCOPE,
    )
    expect(page.total).toBe(7)
    expect(page.items).toHaveLength(2)
    expect(page.exact).toBe(true)
  })

  test('each item says where it is, what it is and its state', async () => {
    const parsed = parseContentQuery({
      entity: 'document',
      name: { op: 'equals', value: 'The cove' },
    })
    if (!parsed.ok) throw new Error('bad query')
    const [item] = (await queryDocuments(h.server.db, parsed.query, OPERATOR_SCOPE)).items
    expect(item).toMatchObject({
      id: keys.cove,
      name: 'The cove',
      path: [{ id: keys.news, name: 'News' }],
      contentType: { id: typeKeys.article, alias: 'article' },
      state: 'changed',
    })
    expect(Date.parse(item?.updateDate ?? '')).toBeGreaterThan(0)
  })

  test('unknown names and impossible comparisons are refused by name', async () => {
    await expect(names({ contentTypes: ['nothing'] })).rejects.toThrow('no content type "nothing"')
    await expect(names({ properties: [{ alias: 'nothing', op: 'exists' }] })).rejects.toThrow(
      'no property "nothing"',
    )
    await expect(names({ culture: 'xx-XX' })).rejects.toThrow('no language')
    await expect(
      names({ properties: [{ alias: 'price', op: 'contains', value: '1' }] }),
    ).rejects.toThrow('is not text')
    const bad = parseContentQuery({ entity: 'media', take: 500, properties: Array(6).fill({}) })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.problems.join(' ')).toContain('media is not searchable')
      expect(bad.problems.join(' ')).toContain('"take"')
      expect(bad.problems.join(' ')).toContain('At most 5 property clauses')
    }
  })
})

describe(`who is asking (${dialectUnderTest})`, () => {
  const scope = (over: Partial<QueryScope>): QueryScope => ({
    start: ROOT_ACCESS,
    readsProperty: () => true,
    ...over,
  })

  test('start nodes narrow the query, and the bin stays out of reach', async () => {
    const shopOnly = scope({ start: { root: false, keys: [keys.shop as string] } })
    expect(await names({}, shopOnly)).toEqual(['Kiln_fired', 'Shop'])
    expect(await names({ state: ['trashed'] }, shopOnly)).toEqual([])
    expect(await names({}, scope({ start: { root: false, keys: [] } }))).toEqual([])
  })

  test('a granular Browse denial hides a branch, and a cut window says so', async () => {
    const hidesDeep = scope({ browses: (chain) => !chain.includes(keys.deep as string) })
    expect(await names({ under: keys.news }, hidesDeep)).toEqual(['Harbour lights', 'The cove'])
    const parsed = parseContentQuery({ entity: 'document' })
    if (!parsed.ok) throw new Error('bad query')
    const cut = await queryDocuments(h.server.db, parsed.query, { ...hidesDeep, window: 3 })
    expect(cut.exact).toBe(false)
    const whole = await queryDocuments(h.server.db, parsed.query, hidesDeep)
    expect(whole.exact).toBe(true)
  })

  test('a property the user cannot read cannot be filtered on', async () => {
    const noPrice = scope({ readsProperty: () => false })
    await expect(
      names({ properties: [{ alias: 'price', op: 'gt', value: 1 }] }, noPrice),
    ).rejects.toThrow('cannot read the property "price"')
  })
})

describe(`the endpoint (${dialectUnderTest})`, () => {
  test('answers as the signed-in user, and names each problem', async () => {
    const ok = await h.post(QUERY, { entity: 'document', contentTypes: ['section'] })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { total: number; exact: boolean; items: unknown[] }
    expect(body).toMatchObject({ total: 3, exact: true })

    const bad = await h.post(QUERY, { entity: 'document', contentTypes: ['nothing'] })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({
      code: 'bad-query',
      problems: ['There is no content type "nothing".'],
    })
  })

  test('needs a session and the Content section', async () => {
    const anonymous = await h.server.fetch(
      new Request(`http://localhost${QUERY}`, { method: 'POST', body: '{}' }),
    )
    expect(anonymous.status).toBe(401)
    const translator = await signInAsGroup(h, 'translator')
    expect((await translator.post(QUERY, { entity: 'document' })).status).toBe(403)
  })
})

describe(`through the remote protocol (${dialectUnderTest})`, () => {
  test('a remote offers content-query, answering as the signed-in person', async () => {
    const http = ((input: RequestInfo | URL, init?: RequestInit) =>
      h.server.fetch(new Request(input, init))) as unknown as typeof fetch
    const discovery = await discover(ORIGIN, http)
    expect(discovery.capabilities).toContain('content-query')
    const keychain = memoryKeychain()
    await signIn(discovery, keychain, {
      clientName: 'crombolo in a test',
      http,
      sleep: () => Bun.sleep(5),
      onCode: async (code) => {
        await h.post(`${V1}/security/back-office/device/decide`, { userCode: code, approve: true })
      },
    })
    const client = new RemoteClient(discovery, keychain, http)
    const result = await client.post<{ total: number; items: Array<{ name: string }> }>(
      'environments/production/content/query',
      { entity: 'document', state: ['changed'] },
    )
    expect(result.items.map((i) => i.name)).toEqual(['The cove'])
    const refused = await client
      .post('environments/production/content/query', {
        entity: 'document',
        contentTypes: ['nothing'],
      })
      .catch((error: unknown) => error)
    expect(String(refused)).toContain('There is no content type "nothing".')
  })
})
