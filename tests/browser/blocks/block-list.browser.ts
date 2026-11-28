/**
 * Story 456: Umbraco's Block List editor against crombolo's server — added from the
 * catalogue, filled in, saved, published and rendered; edited inline where the data
 * type asks; reordered, deleted, its settings set; its own limits and the server's.
 */
import { expect, signIn, test } from '../fixtures.ts'
import { BLOCK_KEYS, CARD_TITLE_MESSAGE, STORED_PROBLEM_PAGE } from './site.ts'
import {
  addButton,
  addressOf,
  blockField,
  blocksPage,
  cards,
  dragBlock,
  edit,
  findPage,
  pick,
  property,
  rendered,
  save,
  saveAndPublish,
  storedValue,
  submitBlock,
  titles,
} from './support.ts'

test('a block added from the catalogue, filled in inline and in its workspace, is saved, published and rendered', async ({
  page,
}) => {
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('First card') })
  await edit(page, made.key)

  // Notes offers two block types, so its Add opens the catalogue; it edits inline.
  const notes = property(page, 'notes')
  await addButton(notes).click()
  await pick(page, 'Note')
  await expect(page.locator('umb-block-catalogue-modal')).toHaveCount(0)
  const inline = notes.locator('umb-block-list-entry').first()
  await inline
    .locator('umb-property', { has: page.locator('uui-label[title="text"]') })
    .locator('input')
    .fill('Written inline')

  // Cards is edited in the block's own workspace.
  const list = property(page, 'cards')
  await addButton(list).click()
  await pick(page, 'Card')
  await blockField(page, 'title').fill('Second card')
  await submitBlock(page)
  await expect(list.locator('umb-block-list-entry')).toHaveCount(2)

  await saveAndPublish(page)
  await expect
    .poll(async () => {
      const stored = await storedValue<{
        contentData: Array<{ values: Array<{ value: unknown }> }>
      }>(page, made.key, 'cards')
      return stored?.contentData.map((d) => d.values[0]?.value)
    })
    .toEqual(['First card', 'Second card'])
  const url = await addressOf(page, made.key)
  await expect.poll(() => rendered(page, url, 'card')).toEqual(['First card', 'Second card'])
  await expect.poll(() => rendered(page, url, 'note')).toEqual(['Written inline'])
  expect(BLOCK_KEYS.card).toBeTruthy()
})

test('blocks are reordered by drag and deleted, a delete taken back at its confirmation', async ({
  page,
  diagnostics,
}) => {
  // Umbraco's client logs a delete declined at its confirmation as a failed action.
  diagnostics.allowed.push('Error executing block action: undefined')
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('Alpha', 'Beta', 'Gamma') })
  await edit(page, made.key)
  const entries = property(page, 'cards').locator('umb-block-list-entry')
  await expect(entries).toHaveCount(3)

  // Gamma dragged above Alpha, by the mouse as an editor drags it.
  await dragBlock(page, entries.nth(2), entries.nth(0))
  await expect(entries.nth(0)).toContainText('Gamma')
  await expect(entries.nth(1)).toContainText('Alpha')

  // Beta's delete, taken back at its confirmation, then confirmed.
  await entries.nth(2).hover()
  await entries.nth(2).getByTestId('block-action:Umb.BlockAction.Delete').click()
  const confirm = page.locator('umb-confirm-modal')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(entries).toHaveCount(3)
  await entries.nth(2).hover()
  await entries.nth(2).getByTestId('block-action:Umb.BlockAction.Delete').click()
  await confirm.getByRole('button', { name: 'Delete' }).click()
  await expect(entries).toHaveCount(2)

  await save(page)
  await expect
    .poll(async () => titles(await storedValue(page, made.key, 'cards')))
    .toEqual(['Gamma', 'Alpha'])
})

test('a block’s settings are set in its workspace and saved with it', async ({ page }) => {
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('Themed') })
  await edit(page, made.key)
  const entry = property(page, 'cards').locator('umb-block-list-entry').first()
  await entry.hover()
  await entry.getByTestId('block-action:Umb.BlockAction.EditSettings').click()
  await blockField(page, 'theme').fill('dark')
  await submitBlock(page)
  await save(page)
  await expect
    .poll(async () => {
      const stored = (await storedValue(page, made.key, 'cards')) as {
        settingsData: Array<{ values: Array<{ alias: string; value: unknown }> }>
      }
      return stored?.settingsData[0]?.values.find((v) => v.alias === 'theme')?.value
    })
    .toBe('dark')
})

test('the editor’s own limits and mandatory field, and the server’s refusal, each on the right block', async ({
  page,
  diagnostics,
}) => {
  // The server's refusals, which this test asks for.
  diagnostics.allowed.push(
    '400 PUT /crombolo/management/api/v1',
    'One or more properties did not pass validation',
  )
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('Only') })
  await edit(page, made.key)
  const list = property(page, 'cards')

  // A card created without its title: the workspace says so in the field's own words.
  await addButton(list).click()
  await pick(page, 'Card')
  await submitBlock(page)
  await expect(page.locator('umb-block-workspace-editor')).toContainText(CARD_TITLE_MESSAGE)
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  const catalogue = page.locator('umb-block-catalogue-modal')
  if (await catalogue.isVisible())
    await catalogue.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.locator('umb-block-workspace-editor')).toHaveCount(0)

  // The list's minimum, said by the editor below the list when its one card goes.
  const entries = list.locator('umb-block-list-entry')
  await entries.first().hover()
  await entries.first().getByTestId('block-action:Umb.BlockAction.Delete').click()
  await page.locator('umb-confirm-modal').getByRole('button', { name: 'Delete' }).click()
  await save(page)
  await expect(list).toContainText('Minimum 1 entries')

  // A draft saved before the rules: its second card has no title. The server's answer
  // names that card, and the editor marks it and not the first.
  const stored = await findPage(page, STORED_PROBLEM_PAGE)
  await edit(page, stored)
  const validated = page.waitForResponse(
    (r) => r.url().includes(`/document/${stored}/validate`) && r.request().method() === 'PUT',
  )
  await save(page)
  const answer = (await (await validated).json()) as { errors: Record<string, string[]> }
  expect(Object.entries(answer.errors)).toContainEqual([
    "$.values[0].value.contentData[1].values[?(@.alias == 'title' && @.culture == null && @.segment == null)].value",
    [CARD_TITLE_MESSAGE],
  ])
  const problem = property(page, 'cards').locator('umb-block-list-entry')
  await expect(problem.nth(1)).toHaveAttribute('content-invalid', '')
  await expect(problem.nth(0)).not.toHaveAttribute('content-invalid', '')
})

test('a block copied to the clipboard is pasted into another property', async ({ page }) => {
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('Copied card') })
  await edit(page, made.key)
  const entry = property(page, 'cards').locator('umb-block-list-entry').first()
  await entry.hover()
  await entry.getByTestId('block-action:Umb.BlockAction.CopyToClipboard').click()

  // Notes offers cards too: pasted there from the clipboard.
  const notes = property(page, 'notes')
  await addButton(notes).click()
  const catalogue = page.locator('umb-block-catalogue-modal')
  await catalogue.getByRole('tab', { name: 'Clipboard' }).click()
  await catalogue.getByText('Copied card').first().click()
  await catalogue.getByRole('button', { name: 'Submit' }).click()
  await expect(notes.locator('umb-block-list-entry')).toHaveCount(1)
  await save(page)
  await expect
    .poll(async () => titles(await storedValue(page, made.key, 'notes')))
    .toEqual(['Copied card'])
})
