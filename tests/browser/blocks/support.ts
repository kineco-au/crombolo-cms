/**
 * What the block journeys share (story 456): a page made through the API with the
 * blocks a journey starts from, the editor opened on it, a property found by alias,
 * and the site's rendering of it.
 */
import type { Locator, Page } from '@playwright/test'
import { expect, settle } from '../fixtures.ts'
import { BLOCK_KEYS, BLOCKS_PAGE, BLOCKS_VARIANT_PAGE } from './site.ts'

export const API = '/crombolo/management/api/v1'

export const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`

export interface BlockData {
  key: string
  contentTypeKey: string
  values: Array<{
    alias: string
    editorAlias: string
    culture: string | null
    segment: null
    value: unknown
  }>
}

/** One block's data, its values text. */
export const blockData = (
  contentTypeKey: string,
  values: Record<string, string>,
  culture: string | null = null,
): BlockData => ({
  key: crypto.randomUUID(),
  contentTypeKey,
  values: Object.entries(values).map(([alias, value]) => ({
    alias,
    editorAlias: 'Umbraco.TextBox',
    culture,
    segment: null,
    value,
  })),
})

/** A list's value, as the editor stores it. */
export const listValue = (
  layout: string,
  contents: BlockData[],
  settings: Array<BlockData | undefined> = [],
) => ({
  layout: {
    [layout]: contents.map((c, i) => ({
      contentKey: c.key,
      settingsKey: settings[i]?.key ?? null,
    })),
  },
  contentData: contents,
  settingsData: settings.filter((s): s is BlockData => s !== undefined),
  expose: contents.map((c) => ({ contentKey: c.key, culture: null, segment: null })),
})

export const cards = (...titles: string[]) =>
  listValue(
    'Umbraco.BlockList',
    titles.map((title) => blockData(BLOCK_KEYS.card, { title })),
  )

/** A Blocks page made through the API, with the values given. */
export async function blocksPage(
  page: Page,
  values: Record<string, unknown>,
  options: { name?: string; variant?: boolean } = {},
): Promise<{ key: string; name: string }> {
  const typeName = options.variant ? BLOCKS_VARIANT_PAGE : BLOCKS_PAGE
  const types = (await (
    await page.request.get(`${API}/tree/document-type/root?take=200`)
  ).json()) as {
    items: Array<{ id: string; name: string }>
  }
  const typeId = types.items.find((t) => t.name === typeName)?.id as string
  const type = (await (await page.request.get(`${API}/document-type/${typeId}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const name = options.name ?? unique('Blocks')
  const made = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: typeId },
      template: type.defaultTemplate,
      parent: null,
      values: Object.entries(values).map(([alias, value]) => ({
        alias,
        culture: null,
        segment: null,
        value,
      })),
      variants: options.variant
        ? [{ culture: 'en-US', segment: null, name }]
        : [{ culture: null, segment: null, name }],
    },
  })
  expect(made.status(), await made.text()).toBe(201)
  return { key: made.headers()['umb-generated-resource'] as string, name }
}

/** The editor opened on a page, settled. */
export async function edit(page: Page, key: string, culture?: string): Promise<void> {
  await page.goto(
    `/crombolo/section/content/workspace/document/edit/${key}${culture ? `/${culture}` : ''}`,
  )
  await settle(page)
}

/** A property of the page being edited, by its alias. */
export const property = (page: Page, alias: string): Locator =>
  page.locator('umb-property', { has: page.locator(`uui-label[title="${alias}"]`) }).first()

/** A page's stored value of one property, as the API reads it. */
export async function storedValue<T = unknown>(page: Page, key: string, alias: string) {
  const doc = (await (await page.request.get(`${API}/document/${key}`)).json()) as {
    values: Array<{ alias: string; culture: string | null; value: T }>
  }
  return doc.values.find((v) => v.alias === alias)?.value
}

/** Publishes a page through the API, its cultures named. */
export async function publish(page: Page, key: string, cultures: Array<string | null> = [null]) {
  const done = await page.request.put(`${API}/document/${key}/publish`, {
    data: { publishSchedules: cultures.map((culture) => ({ culture })) },
  })
  expect(done.status(), await done.text()).toBe(200)
}

/** The texts the site renders in elements of one class, on a page's address. */
export async function rendered(page: Page, url: string, cls: string): Promise<string[]> {
  const html = await (await page.request.get(url)).text()
  return [...html.matchAll(new RegExp(`class="${cls}"[^>]*>([^<]*)<`, 'g'))].map((m) => m[1] ?? '')
}

/** A page's address on the site. */
export async function addressOf(page: Page, key: string): Promise<string> {
  const urls = (await (await page.request.get(`${API}/document/urls?id=${key}`)).json()) as Array<{
    urlInfos: Array<{ url: string }>
  }>
  return urls[0]?.urlInfos[0]?.url ?? '/'
}

export const save = (page: Page) =>
  page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()

export const saveAndPublish = (page: Page) =>
  page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.SaveAndPublish').click()

/** The block workspace's own Create or Update. */
export const submitBlock = (page: Page) =>
  page
    .getByTestId('workspace-action:Umb.WorkspaceAction.Block.SubmitCreate')
    .or(page.getByTestId('workspace-action:Umb.WorkspaceAction.Block.SubmitUpdate'))
    .first()
    .click()

/** A field in the open block workspace, by its property's alias. */
export const blockField = (page: Page, alias: string): Locator =>
  page
    .locator('umb-block-workspace-editor')
    .locator('umb-property', { has: page.locator(`uui-label[title="${alias}"]`) })
    .locator('input')
    .first()

/** A block property's own Add, below its blocks (not the one between them). */
export const addButton = (prop: Locator): Locator =>
  prop.locator('uui-button-group > uui-button[look="placeholder"]').first()

/** A block property's Paste from clipboard. */
export const pasteButton = (prop: Locator): Locator =>
  prop.locator('uui-button-group > uui-button[label="Paste from clipboard"]').first()

/** Picks a block type in the open catalogue. */
export async function pick(page: Page, name: string): Promise<void> {
  const catalogue = page.locator('umb-block-catalogue-modal')
  await expect(catalogue).toBeVisible()
  await catalogue.getByText(name, { exact: true }).click()
}

/** The first value of each block in a stored list, in order. */
export const titles = (value: unknown): unknown[] =>
  ((
    value as
      | {
          contentData?: Array<{ key: string; values: Array<{ value: unknown }> }>
          layout?: Record<string, Array<{ contentKey: string }>>
        }
      | undefined
  )?.layout
    ? (Object.values(
        (value as { layout: Record<string, Array<{ contentKey: string }>> }).layout,
      )[0] ?? [])
    : []
  ).map(
    (entry) =>
      (
        value as { contentData: Array<{ key: string; values: Array<{ value: unknown }> }> }
      ).contentData.find((d) => d.key === entry.contentKey)?.values[0]?.value,
  )

/** A page's key, found by its name at the top of the tree or one level below it. */
export async function findPage(page: Page, name: string): Promise<string> {
  type Items = { items: Array<{ id: string; variants: Array<{ name: string }> }> }
  const named = (items: Items['items']) =>
    items.find((item) => item.variants.some((v) => v.name === name))?.id
  const root = (await (
    await page.request.get(`${API}/tree/document/root?take=500`)
  ).json()) as Items
  const found = named(root.items)
  if (found) return found
  for (const item of root.items) {
    const children = (await (
      await page.request.get(`${API}/tree/document/children?parentId=${item.id}&take=500`)
    ).json()) as Items
    const below = named(children.items ?? [])
    if (below) return below
  }
  throw new Error(`No page called ${name}`)
}

/**
 * A block dragged onto another's place, by the mouse in small steps, as an editor
 * drags it: Umbraco's sorter follows pointer moves, so one jump is not a drag to it.
 */
export async function dragBlock(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  if (!a || !b) throw new Error('A block to drag is not on screen')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  const steps = 12
  for (let i = 1; i <= steps; i++)
    await page.mouse.move(
      a.x + a.width / 2,
      a.y + a.height / 2 + ((b.y + 4 - (a.y + a.height / 2)) * i) / steps,
    )
  await page.mouse.up()
}
