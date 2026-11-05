/**
 * Story 269: a page's list view, as the back office asks for it — searched by
 * name, sorted by a column in the culture shown, paged, and naming who created
 * and last edited each child.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository } from '@crombolo/data'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
varies-by-culture = true

[[property]]
alias = "price"
name = "Price"
type = "numeric"

[[property]]
alias = "opens"
name = "Opens"
type = "datePicker"

[[property]]
alias = "tagline"
name = "Tagline"
type = "textstring"
varies-by-culture = true
`

type Row = {
  id: string
  creator: string | null
  updater: string | null
  hasChildren: boolean
  variants: Array<{ culture: string; name: string }>
}

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'document-collection-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  const h = await signedInServer({ config: { schemaDir: join(root, 'schema') } })
  open.push(h)
  expect(
    (
      await h.post(`${V1}/language`, {
        isoCode: 'da-DK',
        name: 'Danish',
        isDefault: false,
        isMandatory: false,
        fallbackIsoCode: null,
      })
    ).status,
  ).toBe(201)
  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const page = async (
    en: string,
    da: string,
    parent: string | null = null,
    values: Array<{ alias: string; value: unknown; culture?: string }> = [],
  ) => {
    const response = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      parent: parent ? { id: parent } : null,
      values: values.map((v) => ({ culture: null, segment: null, ...v })),
      variants: [
        { culture: 'en-US', segment: null, name: en },
        { culture: 'da-DK', segment: null, name: da },
      ],
    })
    if (response.status !== 201)
      throw new Error(`create ${response.status}: ${await response.text()}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const list = (parent: string, query = '') =>
    h.json<{ total: number; items: Row[] }>(
      `${V1}/collection/document/${parent}?skip=0&take=100${query}`,
    )
  const names = (rows: Row[], culture = 'en-US') =>
    rows.map((r) => r.variants.find((v) => v.culture === culture)?.name)
  return { h, page, list, names }
}

describe('the pages list view', () => {
  test('searches by name in the culture shown, and the total agrees', async () => {
    const { page, list, names } = await site()
    const home = await page('Home', 'Hjem')
    await page('Apple', 'Æble', home)
    await page('Banana', 'Banan', home)
    await page('Pineapple', 'Ananas', home)

    const apples = await list(home, '&filter=apple')
    expect(apples.total).toBe(2)
    expect(names(apples.items)).toEqual(['Apple', 'Pineapple'])
    // In Danish the names are the Danish ones.
    const danish = await list(home, '&filter=ana&orderCulture=da-DK')
    expect(names(danish.items, 'da-DK')).toEqual(['Banan', 'Ananas'])
    // A filter matching nothing, and one with SQL wildcards in it, find nothing.
    expect((await list(home, '&filter=cherry')).total).toBe(0)
    expect((await list(home, `&filter=${encodeURIComponent('%')}`)).total).toBe(0)
  })

  test('sorts by a column in either direction, in the culture shown', async () => {
    const { page, list, names } = await site()
    const home = await page('Home', 'Hjem')
    await page('Charlie', 'Alfa', home)
    await page('Alpha', 'Charlie', home)
    await page('Bravo', 'Bravo', home)

    expect(names((await list(home)).items)).toEqual(['Charlie', 'Alpha', 'Bravo'])
    expect(names((await list(home, '&orderBy=name&orderDirection=Ascending')).items)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ])
    expect(names((await list(home, '&orderBy=name&orderDirection=Descending')).items)).toEqual([
      'Charlie',
      'Bravo',
      'Alpha',
    ])
    // Sorting by name in Danish orders by the Danish names.
    expect(
      names((await list(home, '&orderBy=name&orderDirection=Ascending&orderCulture=da-DK')).items),
    ).toEqual(['Charlie', 'Bravo', 'Alpha'])
    expect(
      names((await list(home, '&orderBy=createDate&orderDirection=Descending')).items),
    ).toEqual(['Bravo', 'Alpha', 'Charlie'])
    // A column the list cannot sort by keeps the sort order.
    expect(names((await list(home, '&orderBy=nonsense')).items)).toEqual([
      'Charlie',
      'Alpha',
      'Bravo',
    ])
  })

  test('names who created and last edited each child, and which have children', async () => {
    const { h, page, list } = await site()
    const me = await h.json<{ name: string }>(`${V1}/user/current`)
    const home = await page('Home', 'Hjem')
    const parent = await page('Parent', 'Forælder', home)
    await page('Child', 'Barn', parent)
    const leaf = await page('Leaf', 'Blad', home)

    const rows = Object.fromEntries((await list(home)).items.map((r) => [r.id, r]))
    expect(rows[parent]).toMatchObject({ creator: me.name, updater: me.name, hasChildren: true })
    expect(rows[leaf]).toMatchObject({ creator: me.name, updater: me.name, hasChildren: false })
    // Sorting by either person is accepted.
    expect((await list(home, '&orderBy=creator')).total).toBe(2)
    expect((await list(home, '&orderBy=updater&orderDirection=Descending')).total).toBe(2)
  })

  test('sorts by a property column, numbers and dates as such, empty values last (story 276)', async () => {
    const { page, list, names } = await site()
    const home = await page('Home', 'Hjem')
    const at = (date: string) => `${date} 00:00:00`
    await page('Ten', 'Ti', home, [
      { alias: 'price', value: 10 },
      { alias: 'opens', value: at('2026-03-01') },
      { alias: 'tagline', value: 'banana', culture: 'en-US' },
      { alias: 'tagline', value: 'citron', culture: 'da-DK' },
    ])
    await page('Nine', 'Ni', home, [
      { alias: 'price', value: 9 },
      { alias: 'opens', value: at('2025-12-31') },
      { alias: 'tagline', value: 'Apple', culture: 'en-US' },
      { alias: 'tagline', value: 'banan', culture: 'da-DK' },
    ])
    await page('Hundred', 'Hundrede', home, [
      { alias: 'price', value: 100 },
      { alias: 'opens', value: at('2026-01-15') },
      { alias: 'tagline', value: 'cherry', culture: 'en-US' },
      { alias: 'tagline', value: 'appelsin', culture: 'da-DK' },
    ])
    await page('None', 'Ingen', home)
    const by = async (query: string) => names((await list(home, query)).items)

    // As numbers: 9, 10, 100 rather than "10", "100", "9"; the page with none last.
    expect(await by('&orderBy=price&orderDirection=Ascending')).toEqual([
      'Nine',
      'Ten',
      'Hundred',
      'None',
    ])
    expect(await by('&orderBy=price&orderDirection=Descending')).toEqual([
      'Hundred',
      'Ten',
      'Nine',
      'None',
    ])
    expect(await by('&orderBy=opens&orderDirection=Ascending')).toEqual([
      'Nine',
      'Hundred',
      'Ten',
      'None',
    ])
    // Text ignores case, and a property that varies is sorted in the culture shown.
    expect(await by('&orderBy=tagline&orderDirection=Ascending&orderCulture=en-US')).toEqual([
      'Nine',
      'Ten',
      'Hundred',
      'None',
    ])
    expect(await by('&orderBy=tagline&orderDirection=Ascending&orderCulture=da-DK')).toEqual([
      'Hundred',
      'Nine',
      'Ten',
      'None',
    ])
    expect((await list(home, '&orderBy=price')).total).toBe(4)
  })

  test('pages a large folder', async () => {
    const { page, names, h } = await site()
    const home = await page('Home', 'Hjem')
    for (let i = 0; i < 30; i++) await page(`Page ${String(i).padStart(2, '0')}`, `Side ${i}`, home)
    const second = await h.json<{ total: number; items: Row[] }>(
      `${V1}/collection/document/${home}?skip=10&take=5&orderBy=name&orderDirection=Descending`,
    )
    expect(second.total).toBe(30)
    expect(names(second.items)).toEqual(['Page 19', 'Page 18', 'Page 17', 'Page 16', 'Page 15'])
  })
})
