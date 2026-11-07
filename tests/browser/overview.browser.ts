/**
 * Stories 236 and 288: signing in opens Home, outside any section, and the logo
 * leads back to it: recent pages, how many are drafts or published,
 * what people did, New content and the system's details.
 */
import { BROWSER_ADMIN, expect, goToSection, settle, signIn, test } from './fixtures.ts'

test('signing in opens Home, with no section marked', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)

  await expect(page).toHaveURL(/\/crombolo\/home$/)
  const overview = page.locator('crombolo-overview-dashboard')
  await expect(overview).toHaveCount(1)
  await expect(page.locator('umb-backoffice-header-sections uui-tab[active]')).toHaveCount(0)
  await expect(page.locator('umb-umbraco-news-dashboard')).toHaveCount(0)

  await expect(overview.getByRole('heading', { name: 'Home' })).toBeVisible()
  await expect(overview.getByText('Recent content')).toBeVisible()
  await expect(overview.getByText('Quick stats')).toBeVisible()
  await expect(overview.getByText('Activity', { exact: true })).toBeVisible()
  // Nothing about how Crombolo is built: that was the Welcome dashboard's.
  await expect(overview).not.toContainText('TSX')

  // A stat lists its pages in place.
  await overview.getByRole('button', { name: /View drafts/ }).click()
  await expect(overview.locator('.headline', { hasText: 'Drafts' })).toBeVisible()
  await overview.getByRole('button', { name: 'Back to recent' }).click()
  await expect(overview.locator('.headline', { hasText: 'Recent content' })).toBeVisible()

  // New content opens the back office's own choice of page type.
  await overview.getByRole('button', { name: /New content/ }).click()
  await expect(page.locator('umb-document-create-options-modal')).toBeVisible()

  expect(errors).toEqual([])
})

test('the logo opens Home, and it has the system’s details', async ({ page }) => {
  await signIn(page)
  await goToSection(page, 'Media')
  await page.locator('umb-backoffice-header-logo').getByRole('link', { name: 'Home' }).click()
  await expect(page).toHaveURL(/\/crombolo\/home$/)

  const overview = page.locator('crombolo-overview-dashboard')
  const system = overview.locator('uui-box', { hasText: 'System information' })
  await expect(system.locator('dd').first()).not.toHaveText('…')
  await expect(system.getByRole('link', { name: 'Crombolo on GitHub' })).toBeVisible()
  await expect(page.locator('#logo-popover')).toHaveCount(0)

  await system.getByRole('button', { name: 'All details' }).click()
  await expect(page.locator('umb-sysinfo')).toBeVisible()
})

test('someone without Content lands on their own section, and the logo leads there', async ({
  page,
}) => {
  await page.route('**/management/api/v1/user/current', async (route) => {
    const response = await route.fetch()
    const user = await response.json()
    user.allowedSections = user.allowedSections.filter(
      (section: string) => section !== 'Umb.Section.Content',
    )
    await route.fulfill({ response, json: user })
  })
  await signIn(page)

  await expect(page).not.toHaveURL(/\/home$/)
  await expect(page).toHaveURL(/\/section\//)
  await expect(page.locator('crombolo-overview-dashboard')).toHaveCount(0)
  await page.locator('umb-backoffice-header-logo').getByRole('link', { name: 'Home' }).click()
  await expect(page).toHaveURL(/\/section\//)
})

test('after a session ends, signing back in loads what Home could not', async ({
  page,
  diagnostics,
}) => {
  // The refused requests are the point of this test.
  diagnostics.allowed.push('401')
  await signIn(page)
  await settle(page)
  const overview = page.locator('crombolo-overview-dashboard')
  await expect(overview.getByText('Recent content')).toBeVisible()

  // The session goes while the page stays, then something on the page asks.
  await page.context().clearCookies()
  await overview.getByRole('button', { name: /View drafts/ }).click()
  const dialog = page.locator('crombolo-sign-in-dialog')
  await expect(dialog.getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(overview.locator('.error')).toHaveCount(0)

  const opened = page.waitForEvent('popup')
  await dialog.getByRole('button', { name: 'Sign in' }).click()
  const popup = await opened
  await popup.locator('input[name="username"]').fill(BROWSER_ADMIN.login)
  await popup.locator('input[name="password"]').fill(BROWSER_ADMIN.password)
  await popup.getByRole('button', { name: /^(Login|Sign in)$/ }).click()

  await expect(dialog).toHaveCount(0)
  await expect(overview.locator('.error')).toHaveCount(0)
  await expect(overview.locator('.headline', { hasText: 'Drafts' })).toBeVisible()
})
