/**
 * Story 329: Redirects' screen is described by its server half and drawn by the
 * back office, with nothing of its own in the page. The browser site carries the
 * workspace's Redirects, granted in its config (`serve.ts`).
 */
import { expect, signIn, test } from './fixtures.ts'

test('Redirects lists, adds, filters and deletes rules, drawn from its description', async ({
  page,
}) => {
  const loaded: string[] = []
  page.on('request', (request) => loaded.push(request.url()))
  await signIn(page)
  await page.goto('/crombolo/section/settings/workspace/crombolo-redirects')

  const screen = page.locator('umb-body-layout').filter({ hasText: 'Redirects' })
  await expect(screen.getByRole('button', { name: 'Add redirect' })).toBeVisible({
    timeout: 30_000,
  })

  await screen.getByRole('button', { name: 'Add redirect' }).click()
  // The target follows the choice: a path, not the page picker.
  await screen.locator('uui-select[label="Redirect to"] select').selectOption('path')
  await screen.locator('uui-input[label="Redirect from"] input').fill('/browser-old')
  await screen.locator('uui-input[label="Path or URL"] input').fill('/browser-new')
  await screen.getByRole('button', { name: 'Add redirect' }).last().click()
  await expect(screen.getByText('Redirect added.')).toBeVisible()
  await expect(screen.getByText('/browser-old', { exact: true })).toBeVisible()

  await screen.locator('uui-input[type="search"] input').fill('nothing-matches')
  await screen.locator('uui-input[type="search"] input').press('Enter')
  await expect(screen.getByText('No redirect matches')).toBeVisible()
  await screen.locator('uui-input[type="search"] input').fill('')
  await screen.locator('uui-input[type="search"] input').press('Enter')

  await screen.getByRole('button', { name: 'Delete' }).first().click()
  await page.locator('umb-confirm-modal').getByRole('button', { name: 'Delete' }).click()
  await expect(screen.getByText('Redirect deleted.')).toBeVisible()

  expect(loaded.filter((url) => url.includes('/bundles/@crombolo/simple-redirects'))).toEqual([])
})
