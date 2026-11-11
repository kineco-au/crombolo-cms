/**
 * Story 323: an extension's screen is drawn by the back office from what its
 * server half describes. The browser site carries `test-screens`, whose Settings
 * dashboard is a table of rules and a form whose fields follow a choice
 * (`serve.ts`). Nothing of the extension's is loaded in the page.
 */
import { expect, signIn, test } from './fixtures.ts'

test('a described screen renders, checks its form, confirms, and round-trips to its process', async ({
  page,
}) => {
  const loaded: string[] = []
  page.on('request', (request) => loaded.push(request.url()))
  await signIn(page)
  await page.goto('/crombolo/section/settings/dashboard/test-screens')

  const screen = page.locator('umb-body-layout').filter({ hasText: 'Test screens' })
  await expect(screen.getByText('/first')).toBeVisible({ timeout: 30_000 })

  // The field follows the choice, in the browser.
  await expect(screen.getByText('Address')).toHaveCount(0)
  await screen.locator('uui-select select').selectOption('url')
  await expect(screen.getByText('Address')).toBeVisible()
  await screen.locator('uui-select select').selectOption('path')

  // A required field is checked before anything is sent.
  await screen.getByRole('button', { name: 'Add' }).click()
  await expect(screen.getByText('Rule is required.')).toBeVisible()

  await screen.locator('uui-input[label="Rule"] input').fill('/second')
  await screen.getByRole('button', { name: 'Add' }).click()
  await expect(screen.getByText('Added /second')).toBeVisible()
  await expect(screen.getByText('/second', { exact: true })).toBeVisible()

  // Delete asks first, in the back office's own dialog.
  await screen.getByRole('button', { name: 'Delete' }).first().click()
  await page.locator('umb-confirm-modal').getByRole('button', { name: 'Delete' }).click()
  await expect(screen.getByText('Deleted /first')).toBeVisible()

  expect(loaded.filter((url) => url.includes('/bundles/test-screens'))).toEqual([])
})
