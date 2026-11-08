/**
 * Story 297: a page's text box holding `{#key}` shows the dictionary item as a
 * chip. Its words open in an overlay, where they are changed and saved to the
 * dictionary; the × clears the box, and typing `{#` offers the items again.
 */
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'

test('a {#key} in a page is a chip whose words are changed in place', async ({ page }) => {
  await signIn(page)
  const languages = (await (await page.request.get(`${API}/language?skip=0&take=10`)).json()) as {
    items: Array<{ isoCode: string; isDefault: boolean }>
  }
  const iso = (languages.items.find((l) => l.isDefault) ?? languages.items[0])?.isoCode as string
  const name = `chip.${Math.random().toString(36).slice(2, 7)}`
  const item = await page.request.post(`${API}/dictionary`, {
    data: { name, parent: null, translations: [{ isoCode: iso, translation: 'Harbour' }] },
  })
  expect(item.status()).toBe(201)
  const itemKey = item.headers()['umb-generated-resource'] as string

  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const created = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: homeType.id },
      template: detail.defaultTemplate,
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: `{#${name}}` }],
      variants: [{ culture: null, segment: null, name: `Chips ${name}` }],
    },
  })
  expect(created.status()).toBe(201)
  const key = created.headers()['umb-generated-resource'] as string

  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
  const chip = page.locator('crombolo-dictionary-chip').first()
  await expect(chip).toBeVisible({ timeout: 30_000 })
  const words = chip.getByRole('button', { name: 'Harbour' })
  await expect(words).toBeVisible()

  // The overlay: the words in each language, changed and saved to the dictionary.
  await words.click()
  const overlay = chip.getByRole('dialog', { name: `Dictionary item ${name}` })
  await expect(overlay).toBeVisible()
  await overlay.locator('uui-textarea textarea').fill('Lighthouse')
  await overlay.getByRole('button', { name: 'Save' }).click()
  await expect(overlay).toBeHidden()
  await expect(chip.getByRole('button', { name: 'Lighthouse' })).toBeVisible()
  const stored = (await (await page.request.get(`${API}/dictionary/${itemKey}`)).json()) as {
    translations: Array<{ isoCode: string; translation: string }>
  }
  expect(stored.translations).toContainEqual({ isoCode: iso, translation: 'Lighthouse' })

  // The × empties the box; typing {# offers the item, and choosing it is a chip again.
  await chip.getByRole('button', { name: `Remove ${name}` }).click()
  await expect(page.locator('crombolo-dictionary-chip')).toHaveCount(0)
  const words2 = page.locator('crombolo-dictionary-words').first()
  const input = words2.locator('uui-input input').first()
  await expect(input).toHaveValue('')
  await input.fill(`{#${name.slice(0, 7)}`)
  await words2.getByRole('option', { name: new RegExp(name) }).dispatchEvent('pointerdown')
  await expect(page.locator('crombolo-dictionary-chip').first()).toBeVisible()
})
