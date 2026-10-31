/**
 * Settings opens from the header's gear, and is not among the section tabs.
 */
import { expect, signIn, test } from './fixtures.ts'

test('the gear in the header opens Settings, which is not a section tab', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/content')
  const tabs = page.locator('umb-backoffice-header-sections uui-tab')
  await expect(tabs.first()).toBeVisible({ timeout: 30_000 })
  await expect(tabs.filter({ hasText: 'Settings' })).toHaveCount(0)
  await page
    .locator('umb-header-app-button')
    .filter({ has: page.locator('[label="Settings"]') })
    .click()
  await expect(page).toHaveURL(/\/section\/settings/)
})
