/**
 * Story 234: Settings opens on a page of cards. A tool opens on its own with a
 * way back; Structure and Code each open their own tree, which shows beside
 * their editors and nowhere else; addresses from before still open.
 */
import { expect, signIn, test } from './fixtures.ts'

const SETTINGS = '/crombolo/section/settings'
const STRUCTURE_TREE = 'section-sidebar:Umb.SectionSidebarMenu.Settings'
const CODE_TREE = 'section-sidebar:Umb.SectionSidebarMenu.Templating'

test('Settings opens on cards, and each tool or tree opens from one', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Neither Umbraco's own deprecations nor Lit's development warnings reach the
  // console: they were noise to anyone using the back office.
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() === 'warning' && /will be removed in version|lit\.dev\/msg/.test(text))
      errors.push(text)
  })
  await signIn(page)
  await page.goto(SETTINGS)

  const landing = page.locator('crombolo-settings-landing')
  await expect(landing.getByRole('heading', { name: 'Build' })).toBeVisible({ timeout: 30_000 })
  for (const group of ['Site', 'Health', 'History'])
    await expect(landing.getByRole('heading', { name: group })).toBeVisible()
  // With no e-mail provider, a banner says so above the cards, not a card of its own.
  await expect(landing.getByRole('status')).toContainText('E-mail is not set up.')
  await expect(landing.locator('uui-box')).toHaveCount(0)
  // No tree and no tabs on the landing page.
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeHidden()
  await expect(page.locator('umb-section-main-views')).toHaveCount(0)

  // A tool opens alone, headed by its name and the way back.
  await landing.getByRole('link', { name: /Health check/ }).click()
  await expect(page).toHaveURL(/\/section\/settings\/dashboard\/health-check/)
  await expect(page.getByRole('heading', { name: 'Health check' }).first()).toBeVisible()
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeHidden()
  await page.getByRole('link', { name: 'Settings' }).first().click()
  await expect(landing.getByRole('heading', { name: 'Build' })).toBeVisible()

  // Structure opens its own tree, and only that one.
  await landing.getByRole('link', { name: /Structure/ }).click()
  await expect(page).toHaveURL(/\/section\/settings\/structure$/)
  // The trail names the tree, as it names a tool.
  const trail = page.locator('crombolo-breadcrumb')
  await expect(trail).toContainText('Settings')
  await expect(trail).toContainText('Structure')
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeVisible()
  await expect(page.getByTestId(CODE_TREE)).toBeHidden()

  // Back to Settings by the trail, and into a tree again: a tree shown a second
  // time once threw "reading 'forEach'" as its menu reopened.
  await trail.getByRole('link', { name: 'Settings' }).click()
  await expect(landing.getByRole('heading', { name: 'Build' })).toBeVisible()
  await landing.getByRole('link', { name: /Code/ }).click()
  await expect(page.getByTestId(CODE_TREE)).toBeVisible()
  await trail.getByRole('link', { name: 'Settings' }).click()
  await landing.getByRole('link', { name: /Structure/ }).click()
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeVisible()
  await page.getByText('Content Types', { exact: true }).first().click()
  await expect(page.getByTestId(CODE_TREE)).toBeHidden()

  // A tool that was in the Advanced tree opens without one.
  await page.goto(`${SETTINGS}/workspace/logviewer/view/overview`)
  await expect(page.locator('umb-workspace')).toBeVisible()
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeHidden()
  await expect(page.getByTestId(CODE_TREE)).toBeHidden()
  await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible()

  expect(errors).toEqual([])
})

test('an address from before still opens, beside the right tree', async ({ page }) => {
  await signIn(page)
  // A content type's editor, straight from a link: Structure's tree beside it.
  await page.goto(`${SETTINGS}/workspace/document-type-root`)
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId(CODE_TREE)).toBeHidden()

  // A stylesheet's: Code's.
  await page.goto(`${SETTINGS}/workspace/stylesheet/create/parent/stylesheet-root/null`)
  await expect(page.getByTestId(CODE_TREE)).toBeVisible()
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeHidden()

  // Umbraco's welcome, which the landing page replaced.
  await page.goto(`${SETTINGS}/dashboard/welcome`)
  await expect(
    page.locator('crombolo-settings-landing').getByRole('heading', { name: 'Build' }),
  ).toBeVisible()
})
