/**
 * Story 456: Umbraco's Block Grid editor against crombolo's server — a block placed in
 * an area, which offers only what its allowance allows; a block's column span resized
 * by its handle; saved, published and rendered with its areas.
 */
import { expect, signIn, test } from '../fixtures.ts'
import { BLOCK_KEYS } from './site.ts'
import {
  addressOf,
  blockData,
  blockField,
  blocksPage,
  cards,
  edit,
  property,
  rendered,
  saveAndPublish,
  storedValue,
  submitBlock,
} from './support.ts'

const grid = () => {
  const columns = blockData(BLOCK_KEYS.columns, {})
  const card = blockData(BLOCK_KEYS.card, { title: 'Wide card' })
  return {
    layout: {
      'Umbraco.BlockGrid': [
        {
          contentKey: columns.key,
          settingsKey: null,
          columnSpan: 12,
          rowSpan: 1,
          areas: [
            { key: BLOCK_KEYS.left, items: [] },
            { key: BLOCK_KEYS.right, items: [] },
          ],
        },
        { contentKey: card.key, settingsKey: null, columnSpan: 12, rowSpan: 1, areas: [] },
      ],
    },
    contentData: [columns, card],
    settingsData: [],
    expose: [columns, card].map((c) => ({ contentKey: c.key, culture: null, segment: null })),
  }
}

test('a block placed in an area that allows it, the area offering nothing else, and a span resized', async ({
  page,
}) => {
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('Card'), layout: grid() })
  await edit(page, made.key)
  const layout = property(page, 'layout')
  const rows = layout.locator('umb-block-grid-entry')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Columns')

  // The left area allows quotes alone: it offers a Quote, and its catalogue nothing else.
  const columns = rows.first()
  await columns.getByRole('link', { name: 'Add Quote' }).click()
  const opened = page.locator('umb-block-catalogue-modal, umb-block-workspace-editor').first()
  await expect(opened).toBeVisible()
  const catalogue = page.locator('umb-block-catalogue-modal')
  if (await catalogue.isVisible()) {
    await expect(catalogue.getByText('Card', { exact: true })).toHaveCount(0)
    await catalogue.getByText('Quote', { exact: true }).click()
  }
  await blockField(page, 'text').fill('In the left area')
  await submitBlock(page)
  await expect(columns.locator('umb-block-grid-entry')).toHaveCount(1)
  // It holds one at most, so it offers no second.
  await expect(columns.getByRole('link', { name: 'Add Quote' })).toHaveCount(0)

  // The card's span, from the whole row to half of it, by the handle an editor drags.
  const card = layout.locator('umb-block-grid-entry').filter({ hasText: 'Wide card' }).first()
  const handle = card.locator('umb-block-scale-handler')
  await card.hover()
  await expect(handle).toContainText('12x1')
  const box = await handle.locator('#handler').boundingBox()
  const row = await card.boundingBox()
  if (!box || !row) throw new Error('The card is not on screen')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  const target = row.x + row.width / 2
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + ((target - box.x) * i) / 10, box.y + box.height / 2)
  await page.mouse.up()
  await expect(handle).toContainText('6x1')

  await saveAndPublish(page)
  await expect
    .poll(async () => {
      const stored = (await storedValue(page, made.key, 'layout')) as {
        layout: {
          'Umbraco.BlockGrid': Array<{ columnSpan: number; areas: Array<{ items: unknown[] }> }>
        }
      }
      const [columns, wide] = stored?.layout['Umbraco.BlockGrid'] ?? []
      return [columns?.areas[0]?.items.length, wide?.columnSpan]
    })
    .toEqual([1, 6])
  const url = await addressOf(page, made.key)
  await expect
    .poll(() => rendered(page, url, 'layout'))
    .toEqual(['blockColumns left:In the left area blockCard'])
})
