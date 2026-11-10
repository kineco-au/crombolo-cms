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
  // Which features e-mail reaches depends on the site, so these are stated.
  await page.route('**/crombolo/api/email', (route) =>
    route.fulfill({
      json: {
        available: false,
        reason: 'No provider.',
        affects: ['Invitations', 'Password resets'],
      },
    }),
  )
  await signIn(page)
  await page.goto(SETTINGS)

  const landing = page.locator('crombolo-settings-landing')
  await expect(landing.getByRole('heading', { name: 'Site' })).toBeVisible({ timeout: 30_000 })
  for (const group of ['Site', 'Health', 'History', 'Developers', 'Extensions'])
    await expect(landing.getByRole('heading', { name: group })).toBeVisible()
  // The landing page has a trail too, and it starts at Home.
  const landingTrail = page.locator('crombolo-breadcrumb')
  await expect(landingTrail.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(landingTrail).toContainText('Settings')
  // With no e-mail provider, a banner says so above the cards, not a card of its own.
  const email = landing.getByRole('status')
  await expect(email.locator('summary')).toHaveText(/^\s*E-mail is not set up\.\s*$/)
  // The title alone until asked: the details open, with what is unavailable as a list.
  const unavailable = email.locator('.affected li')
  await expect(unavailable.first()).toBeHidden()
  await email.locator('summary').click()
  await expect(unavailable.first()).toBeVisible()
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
  await expect(landing.getByRole('heading', { name: 'Site' })).toBeVisible()

  // Structure and Code each open their own tree, from the menu under Content (story 289).
  await page.goto(`${SETTINGS}/structure`)
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId(CODE_TREE)).toBeHidden()
  // A tree shown a second time once threw "reading 'forEach'" as its menu reopened.
  const menu = page.locator('crombolo-content-strip')
  await menu.getByRole('link', { name: 'Code' }).click()
  await expect(page.getByTestId(CODE_TREE)).toBeVisible()
  await menu.getByRole('link', { name: 'Structure' }).click()
  await expect(page.getByTestId(STRUCTURE_TREE)).toBeVisible()
  await page.getByText('Content Types', { exact: true }).first().click()
  await expect(page.getByTestId(CODE_TREE)).toBeHidden()

  // Extensions is a tool here (story 238), opening on its first tab.
  await page.goto(SETTINGS)
  await landing.getByRole('link', { name: /^Extensions/ }).click()
  await expect(page).toHaveURL(/\/section\/settings\/dashboard\/extensions\/marketplace$/)
  await expect(page.locator('crombolo-bundles-tool uui-tab')).toHaveText([
    'Marketplace',
    'Installed',
    'Created',
  ])
  const trail = page.locator('crombolo-breadcrumb')
  await expect(trail).toContainText('Extensions')

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
    page.locator('crombolo-settings-landing').getByRole('heading', { name: 'Site' }),
  ).toBeVisible()
})
