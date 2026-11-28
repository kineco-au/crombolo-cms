/**
 * Story 456: blocks in Umbraco's rich text editor against crombolo's server — a block
 * inserted from the toolbar, filled in, deleted and brought back by the editor's undo,
 * then saved, published and rendered.
 */
import { expect, signIn, test } from '../fixtures.ts'
import {
  addressOf,
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

test('a block inserted in rich text, deleted and undone, is saved, published and rendered', async ({
  page,
  diagnostics,
}) => {
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('Card') })
  await edit(page, made.key)
  const body = property(page, 'body')
  const editor = body.locator('.tiptap, [contenteditable="true"]').first()
  await editor.click()
  await page.keyboard.type('Before the quote. ')
  await body.getByRole('button', { name: 'Insert Block' }).click()
  const opened = page.locator('umb-block-catalogue-modal, umb-block-workspace-editor').first()
  await expect(opened).toBeVisible()
  // The catalogue may go straight on to the block's editor, opening over itself: pick from it
  // only while the editor isn't open yet, and until it is.
  const catalogue = page.locator('umb-block-catalogue-modal')
  const workspace = page.locator('umb-block-workspace-editor')
  await expect(async () => {
    if (await workspace.isVisible()) return
    await catalogue.getByText('Quote', { exact: true }).click({ timeout: 2_000 })
    await expect(workspace).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await blockField(page, 'text').fill('Quoted in the text')
  await submitBlock(page)
  const blocks = body.locator('umb-rte-block, umb-rte-block-inline')
  await expect(blocks).toHaveCount(1)

  // Deleted through its own action, then brought back by the editor's undo.
  diagnostics.allowed.push('Error executing block action: undefined')
  const entry = blocks.first()
  await entry.hover()
  await entry.getByTestId('block-action:Umb.BlockAction.Delete').click()
  await page.locator('umb-confirm-modal').getByRole('button', { name: 'Delete' }).click()
  await expect(blocks).toHaveCount(0)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(blocks).toHaveCount(1)

  await saveAndPublish(page)
  await expect
    .poll(async () => {
      const stored = (await storedValue(page, made.key, 'body')) as {
        markup: string
        blocks: { contentData: Array<{ values: Array<{ value: unknown }> }> }
      }
      return [
        stored?.markup.includes('umb-rte-block'),
        stored?.blocks.contentData[0]?.values[0]?.value,
      ]
    })
    .toEqual([true, 'Quoted in the text'])
  const url = await addressOf(page, made.key)
  await expect.poll(() => rendered(page, url, 'quote')).toEqual(['Quoted in the text'])
})
