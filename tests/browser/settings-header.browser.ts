/**
 * Settings opens from the header's gear, on its landing page of cards (story
 * 234), and is not among the section tabs.
 */
import { expect, goToSection, signIn, test } from './fixtures.ts'

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
  await expect(
    page.locator('crombolo-settings-landing').getByRole('heading', { name: 'Site' }),
  ).toBeVisible({ timeout: 30_000 })
})

test('Users are in Settings, with no tab of their own, and their old address opens them', async ({
  page,
}) => {
  await signIn(page)
  await goToSection(page, 'Users')
  await expect(page).toHaveURL(/\/section\/settings\/users/)
  await expect(page.locator('umb-user-collection')).toBeVisible()
  await expect(
    page.locator('umb-backoffice-header-sections uui-tab').filter({ hasText: 'Users' }),
  ).toHaveCount(0)
  await page.goto('/crombolo/section/user-management/workspace/user-group-root')
  await expect(page).toHaveURL(/\/section\/settings\/users\/workspace\/user-group-root/)
})
