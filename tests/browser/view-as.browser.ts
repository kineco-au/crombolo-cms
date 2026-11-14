/**
 * Story 314 in the real back office: an administrator views it as the Writers,
 * who have no Settings, sees no Settings, and switches back. Runs in CI only,
 * in the browser suite on a push carrying `--browser-tests`.
 */
import { expect, settle, signIn, test } from './fixtures.ts'

test('an administrator views the back office as a group without Settings, and switches back', async ({
  page,
}) => {
  await signIn(page)
  const settings = page
    .locator('umb-backoffice-header-apps')
    .getByRole('link', { name: 'Settings' })
  await expect(settings).toBeVisible()

  await page.locator('umb-current-user-header-app uui-button').click()
  await page.getByRole('button', { name: 'View as a group…' }).click()
  await page.locator('crombolo-view-as-modal uui-checkbox', { hasText: 'Writers' }).click()
  await page.getByRole('button', { name: 'View as this group' }).click()

  const banner = page.locator('crombolo-view-as-banner')
  await expect(banner).toContainText('Viewing as Writers until', { timeout: 30_000 })
  await settle(page)
  await expect(settings).toHaveCount(0)

  await banner.getByRole('button', { name: 'Switch back' }).click()
  await expect(banner).toHaveCount(0, { timeout: 30_000 })
  await settle(page)
  await expect(settings).toBeVisible()
})
