/**
 * Story 456: a block that varies by culture, edited in two languages in Umbraco's
 * editor against crombolo's server, each language saved, published and rendered with
 * its own text, as Umbraco 13+ does.
 */
import type { Page } from '@playwright/test'
import { expect, settle, signIn, test } from '../fixtures.ts'
import { BASE_URL } from '../playwright.config.ts'
import { BLOCK_KEYS } from './site.ts'
import { API, blockData, blocksPage, edit, property, rendered, submitBlock } from './support.ts'

/** Save and publish through the workspace's dialog, choosing exactly the cultures named. */
async function saveAndPublishIn(page: Page, cultures: string[]) {
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.SaveAndPublish').click()
  await expect(page.getByRole('heading', { name: 'Save and publish' })).toBeVisible()
  for (const item of await page.getByRole('menu').last().getByRole('menuitem').all()) {
    const text = (await item.textContent()) ?? ''
    const wanted = cultures.some((c) => text.includes(c))
    const selected = await item.evaluate((el) => el.hasAttribute('selected'))
    const disabled = await item.evaluate((el) => el.hasAttribute('disabled'))
    if (wanted !== selected && !disabled) await item.getByRole('button').first().click()
  }
  await page.getByRole('button', { name: 'Save and publish', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Save and publish' })).toHaveCount(0)
}

test('a block that varies by culture is edited in English and Danish, and each renders its own', async ({
  page,
}) => {
  await signIn(page)
  const language = await page.request.post(`${API}/language`, {
    data: {
      isoCode: 'da-DK',
      name: 'Danish',
      isDefault: false,
      isMandatory: false,
      fallbackIsoCode: 'en-US',
    },
  })
  expect([201, 400]).toContain(language.status())
  await page.reload()
  await settle(page)

  const caption = blockData(BLOCK_KEYS.caption, { caption: 'Hello' }, 'en-US')
  const made = await blocksPage(
    page,
    {
      captions: {
        layout: { 'Umbraco.BlockList': [{ contentKey: caption.key, settingsKey: null }] },
        contentData: [caption],
        settingsData: [],
        expose: [{ contentKey: caption.key, culture: 'en-US', segment: null }],
      },
    },
    { variant: true },
  )

  // English as made; then Danish, its own name and its own caption in the same block.
  await edit(page, made.key)
  await saveAndPublishIn(page, ['English'])
  await page.getByRole('button', { name: 'Open version selector' }).click()
  await page
    .getByRole('button', { name: /Danish/ })
    .first()
    .click()
  await expect(page.getByRole('button', { name: 'Open version selector' })).toHaveAttribute(
    'title',
    'Danish',
  )
  await page.locator('#name-input input').fill('Billedtekster')
  const entry = property(page, 'captions').locator('umb-block-list-entry').first()
  await entry.hover()
  // Not yet in Danish: Umbraco offers to create it there, then edits it.
  const create = entry.getByTestId('block-action:Umb.BlockAction.ExposeContent')
  if (await create.isVisible()) await create.click()
  else await entry.click()
  const field = page
    .locator('umb-block-workspace-editor')
    .locator('umb-property', { has: page.locator('uui-label[title="caption"]') })
    .locator('input')
    .first()
  await field.fill('Hej')
  await submitBlock(page)
  await saveAndPublishIn(page, ['Danish'])

  const stored = (await (await page.request.get(`${API}/document/${made.key}`)).json()) as {
    values: Array<{
      alias: string
      value: {
        contentData: Array<{ values: Array<{ culture: string; value: string }> }>
        expose: unknown[]
      }
    }>
  }
  const value = stored.values.find((v) => v.alias === 'captions')?.value
  expect(
    Object.fromEntries((value?.contentData[0]?.values ?? []).map((v) => [v.culture, v.value])),
  ).toEqual({ 'en-US': 'Hello', 'da-DK': 'Hej' })
  expect(value?.expose).toHaveLength(2)

  // Each culture under its own prefix on this host, its own caption.
  const host = new URL(BASE_URL).host
  const run = made.name.split(' ')[1]
  expect(
    (
      await page.request.put(`${API}/document/${made.key}/domains`, {
        data: {
          defaultIsoCode: null,
          domains: [
            { domainName: `${host}/blocks-en-${run}`, isoCode: 'en-US' },
            { domainName: `${host}/blocks-da-${run}`, isoCode: 'da-DK' },
          ],
        },
      })
    ).status(),
  ).toBe(200)
  await expect.poll(() => rendered(page, `/blocks-en-${run}/`, 'caption')).toEqual(['Hello'])
  await expect.poll(() => rendered(page, `/blocks-da-${run}/`, 'caption')).toEqual(['Hej'])
})
