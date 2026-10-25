/**
 * Side panels (story 182): a bundle's panel docks beside the view, keeps its
 * element and state while the editor moves between sections, is still open
 * after a reload, and becomes a sheet over the view on a narrow window. The
 * browser site carries a bundle with one panel, `Test.SidePanel.Notes`, that
 * counts clicks (`serve.ts`).
 */
import type { Page } from '@playwright/test'
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

const toggle = (page: Page) => page.locator('crombolo-side-panel-toggle uui-button')
const panel = (page: Page) => page.locator('crombolo-side-panel-host #panel')
const count = (page: Page) => page.locator('test-notes-panel #count')

test('a panel stays open across sections and a reload, and is a sheet on a narrow window', async ({
  page,
}) => {
  await signIn(page)
  try {
    await toggle(page).click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toHaveAttribute('role', 'complementary')
    await expect(panel(page)).toHaveAttribute('aria-label', 'Notes')
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')

    // Docked beside main, which has made room for it.
    const box = await panel(page).boundingBox()
    expect(box?.width).toBeGreaterThan(300)
    const main = await page.locator('umb-backoffice-main').boundingBox()
    expect((main?.x ?? 0) + (main?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + 1)

    // The panel's own state survives moving around the back office.
    await count(page).click()
    await count(page).click()
    // One section change: two in a row trips the client's own race (fixtures.ts,
    // `settle`) whether or not a panel is open.
    await goToSection(page, 'Media')
    await expect(count(page)).toHaveText('Clicked 2')

    // The splitter resizes it from the keyboard, within its limits.
    const splitter = page.locator('crombolo-side-panel-host [role="separator"]')
    await expect(splitter).toHaveAttribute('aria-valuenow', '360')
    await splitter.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(splitter).toHaveAttribute('aria-valuenow', '376')
    await page.keyboard.press('Home')
    await expect(splitter).toHaveAttribute('aria-valuenow', '280')

    // Remembered for this user: open, at the width it was left.
    await page.reload()
    await settle(page)
    await expect(panel(page)).toBeVisible()
    await expect(splitter).toHaveAttribute('aria-valuenow', '280')

    // On a narrow window it is a sheet over the view, which Escape closes.
    await page.setViewportSize({ width: 700, height: 900 })
    await expect(panel(page)).toHaveAttribute('role', 'dialog')
    await expect(panel(page)).toHaveAttribute('aria-modal', 'true')
    await panel(page).focus()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await page.setViewportSize({ width: 1280, height: 900 })
    // Leave it closed for the tests after this one.
    if ((await toggle(page).getAttribute('aria-expanded')) === 'true') await toggle(page).click()
  }
})
