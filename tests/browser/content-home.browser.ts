/**
 * Story 288: the Content section opens on the first page the user can see,
 * selected in the tree, or says there is none. The back button leaves the
 * section rather than coming back to the redirect.
 */
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'
const WORKSPACE = /\/section\/content\/workspace\/document\/edit\//

test('Content opens the first page, and the back button leaves it', async ({
  page,
  diagnostics,
}) => {
  // Leaving a section as soon as it renders is the client's known race (see `settle`).
  diagnostics.allowed.push(
    'Tree context is not set',
    'provideAt is not a function',
    'repository is missing',
  )
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const name = `First ${Math.random().toString(36).slice(2, 7)}`
  const created = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: homeType.id },
      template: detail.defaultTemplate,
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: name }],
      variants: [{ culture: null, segment: null, name }],
    },
  })
  expect(created.status()).toBe(201)

  await goToSection(page, 'Media')
  await goToSection(page, 'Content')

  await expect(page).toHaveURL(WORKSPACE)
  await expect(page.locator('umb-document-workspace-editor')).toBeVisible()
  await expect(page.locator('crombolo-content-home-dashboard')).toHaveCount(0)
  await expect(
    page.locator('umb-section-sidebar [active], umb-section-sidebar [selected]').first(),
  ).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/section\/media/)
})

test('with no page to open, Content says so and offers one', async ({ page }) => {
  await page.route('**/management/api/v1/tree/document/root*', (route) =>
    route.fulfill({ json: { total: 0, items: [] } }),
  )
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)

  const home = page.locator('crombolo-content-home-dashboard')
  await expect(home.getByRole('heading', { name: 'No pages yet' })).toBeVisible()
  await home.getByRole('button', { name: 'New content' }).click()
  await expect(page.locator('umb-document-create-options-modal')).toBeVisible()
})

test('without leave to create, Content offers nothing', async ({ page }) => {
  await page.route('**/management/api/v1/tree/document/root*', (route) =>
    route.fulfill({ json: { total: 0, items: [] } }),
  )
  await page.route('**/management/api/v1/user/current', async (route) => {
    const response = await route.fetch()
    const user = await response.json()
    user.fallbackPermissions = user.fallbackPermissions.filter(
      (permission: string) => permission !== 'Umb.Document.Create',
    )
    await route.fulfill({ response, json: user })
  })
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)

  const home = page.locator('crombolo-content-home-dashboard')
  await expect(home.getByRole('heading', { name: 'No pages yet' })).toBeVisible()
  await expect(home.getByRole('button', { name: 'New content' })).toHaveCount(0)
})
