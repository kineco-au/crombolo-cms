/**
 * A section of the site's own (story 431): its tab, its places in the row under the
 * header, each place's menu beside the screen, a screen the site's back-office code
 * draws, kept as the menu is used, and each at an address that reloads. The browser
 * site declares `observations` (`serve.ts`).
 */
import { expect, settle, signIn, test } from './fixtures.ts'

test('a site’s section shows its places, its menus and its own screens', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/observations')
  await settle(page)

  const strip = page.locator('crombolo-content-strip nav')
  await expect(strip.getByRole('link', { name: 'Records' })).toHaveAttribute('aria-current', 'page')
  await expect(strip.getByRole('link', { name: 'Species' })).toBeVisible()

  // The first place's first screen, the site's own element.
  await expect(page.getByRole('heading', { name: 'Awaiting review' })).toBeVisible()
  const reviewed = page.getByRole('button', { name: /^Reviewed/ })
  await reviewed.click()
  await expect(reviewed).toHaveText('Reviewed 1')

  // The menu beside it opens the other screen, and back again keeps the first one's state.
  await page.locator('uui-menu-item[label="All records"]').click()
  await expect(page).toHaveURL(/section\/observations\/records\/all$/)
  await expect(page.getByRole('heading', { name: 'Every record' })).toBeVisible()
  await page.locator('uui-menu-item[label="Awaiting review"]').click()
  await expect(reviewed).toHaveText('Reviewed 1')

  // Another place, from the row; one screen alone needs no menu.
  await strip.getByRole('link', { name: 'Species' }).click()
  await expect(page).toHaveURL(/section\/observations\/species\/list$/)
  await expect(page.getByRole('heading', { name: 'Every record' })).toBeVisible()
  await expect(page.locator('uui-menu-item[label="Species"]')).toHaveCount(0)

  // Its address reloads to the same screen.
  await page.reload()
  await settle(page)
  await expect(page.getByRole('heading', { name: 'Every record' })).toBeVisible()
  await expect(strip.getByRole('link', { name: 'Species' })).toHaveAttribute('aria-current', 'page')
})

test('the site’s own code runs as the back office starts (story 438)', async ({ page }) => {
  await signIn(page)
  await expect(page.locator('html')).toHaveAttribute('data-site-started', 'yes')
})
