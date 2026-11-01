/**
 * Story 236: signing in opens the Content section on the Overview, in place of
 * Umbraco's news (`overwrites: ['Umb.Dashboard.UmbracoNews']`): recent pages,
 * how many are drafts or published, what people did, and New content.
 */
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

test('the content section opens on the Overview, not on Umbraco news', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)

  const overview = page.locator('crombolo-overview-dashboard')
  await expect(overview).toHaveCount(1)
  await expect(page.locator('umb-umbraco-news-dashboard')).toHaveCount(0)
  // The only dashboard in Content, so no tab strip: redirects are in Settings (237).
  await expect(page.locator('umb-section-main-views uui-tab')).toHaveCount(0)
  await expect(page.locator('umb-dashboard-redirect-management')).toHaveCount(0)

  await expect(overview.getByRole('heading', { name: 'Overview' })).toBeVisible()
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
