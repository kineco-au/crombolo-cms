/**
 * Story 456: Umbraco's Single Block editor against crombolo's server — its one block
 * added from the catalogue, filled in, saved, published and rendered, and no second
 * offered once it has one.
 */
import { expect, signIn, test } from '../fixtures.ts'
import {
  addButton,
  addressOf,
  blockField,
  blocksPage,
  cards,
  edit,
  pick,
  property,
  rendered,
  saveAndPublish,
  storedValue,
  submitBlock,
  titles,
} from './support.ts'

test('a Single Block holds one block: added, filled in, saved, published and rendered', async ({
  page,
}) => {
  await signIn(page)
  const made = await blocksPage(page, { cards: cards('Card') })
  await edit(page, made.key)
  const hero = property(page, 'hero')
  await addButton(hero).click()
  await pick(page, 'Card')
  await blockField(page, 'title').fill('The one hero')
  await submitBlock(page)
  await expect(hero.locator('umb-block-single-entry')).toHaveCount(1)
  // Holding its one, it offers no second.
  await expect(hero.locator('uui-button-group > uui-button[look="placeholder"]')).toHaveCount(0)

  await saveAndPublish(page)
  await expect
    .poll(async () => titles(await storedValue(page, made.key, 'hero')))
    .toEqual(['The one hero'])
  const url = await addressOf(page, made.key)
  await expect
    .poll(() => rendered(page, url, 'hero'), { message: `rendered at ${url}` })
    .toEqual(['The one hero'])
})
