/**
 * Story 289: the menu under Content, which keeps Content's tab marked across
 * Pages, Structure, Components, Forms and Workflows, and the tree beside forms
 * and workflows, with folders.
 */
import type { Page } from '@playwright/test'
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

const strip = (page: Page) => page.locator('crombolo-content-strip')
const marked = (page: Page) => page.locator('umb-backoffice-header-sections uui-tab[active]')

test('the menu opens each place, with Content marked throughout', async ({ page, diagnostics }) => {
  diagnostics.allowed.push(
    'Tree context is not set',
    'provideAt is not a function',
    'repository is missing',
  )
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)
  for (const [label, address] of [
    ['Structure', /\/section\/settings\/structure$/],
    ['Components', /\/section\/settings\/code$/],
    ['Forms', /\/section\/forms/],
    ['Workflows', /\/section\/forms\/view\/workflows/],
    ['Pages', /\/section\/content/],
  ] as const) {
    await strip(page).getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(address)
    await expect(strip(page).getByRole('link', { name: label })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(marked(page)).toHaveAttribute('label', 'Content')
  }
  // A section with no tabs once drew the word false where they would be.
  await strip(page).getByRole('link', { name: 'Forms' }).click()
  await expect(page.getByText('false', { exact: true })).toHaveCount(0)
})

test('the menu is a row under the header, gone from Home and the sidebar', async ({ page }) => {
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)
  const header = await page.locator('umb-backoffice-header #appHeader').boundingBox()
  const row = await strip(page).locator('nav').boundingBox()
  expect(row?.y).toBe((header?.y ?? 0) + (header?.height ?? 0))
  await expect(page.locator('umb-section-sidebar crombolo-content-strip')).toHaveCount(0)
  await page.locator('umb-backoffice-header-logo').click()
  await expect(strip(page).locator('nav')).toHaveCount(0)
})

test('Forms has no tab of its own in the header, and Settings no Build cards', async ({ page }) => {
  await signIn(page)
  const tabs = page.locator('umb-backoffice-header-sections uui-tab')
  await expect(tabs.first()).toBeVisible()
  await expect(tabs.filter({ hasText: 'Forms' })).toHaveCount(0)

  await goToSection(page, 'Settings')
  const landing = page.locator('crombolo-settings-landing')
  await expect(landing.getByRole('heading', { name: 'Site' })).toBeVisible()
  await expect(landing.getByRole('heading', { name: 'Build' })).toHaveCount(0)
  for (const card of [/^Structure/, /^Code/, /^Workflows/])
    await expect(landing.getByRole('link', { name: card })).toHaveCount(0)
})

test('someone with Pages alone sees no menu', async ({ page }) => {
  await page.route('**/management/api/v1/user/current', async (route) => {
    const response = await route.fetch()
    const user = await response.json()
    user.allowedSections = ['Umb.Section.Content']
    user.isAdmin = false
    await route.fulfill({ response, json: user })
  })
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)
  await expect(strip(page).getByRole('link')).toHaveCount(0)
})

test('forms sit in folders in the tree, and the root lists every entry', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/forms')
  const tree = page.locator('crombolo-definition-tree')
  await expect(tree.locator('.root')).toContainText('Forms')

  const folder = `Folder ${Math.random().toString(36).slice(2, 7)}`
  await tree.locator('.root').getByRole('button', { name: 'New folder' }).click()
  await tree.getByLabel('Folder name').fill(folder)
  await tree.getByRole('button', { name: 'Add' }).click()
  await expect(tree.locator('summary', { hasText: folder })).toBeVisible()

  await tree.locator('summary', { hasText: folder }).getByRole('button', { name: 'Delete' }).click()
  await expect(tree.locator('summary', { hasText: folder })).toHaveCount(0)

  await tree.locator('.root').getByRole('link', { name: 'Forms' }).click()
  await expect(page).toHaveURL(/\/view\/entries/)
})

test('a form is opened from the tree, with its entries a tab', async ({ page }) => {
  const alias = `tree${Math.random().toString(36).slice(2, 7)}`
  await page.route('**/crombolo/api/forms', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    const response = await route.fetch()
    const body = await response.json()
    body.items.push({ key: alias, alias, name: 'From the tree', folder: '' })
    await route.fulfill({ response, json: body })
  })
  await page.route(`**/crombolo/api/forms/${alias}`, (route) =>
    route.fulfill({
      json: {
        definition: {
          key: alias,
          alias,
          name: 'From the tree',
          storeEntries: true,
          pages: [{ groups: [{ columns: 1, fields: [] }] }],
          workflows: [],
        },
      },
    }),
  )
  await page.route(`**/crombolo/api/forms/${alias}/entries*`, (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  )
  await signIn(page)
  await page.goto('/crombolo/section/forms')
  await page
    .locator('crombolo-definition-tree')
    .getByRole('link', { name: 'From the tree' })
    .click()
  const form = page.locator('crombolo-forms-overview')
  await expect(form.getByRole('tab', { name: 'Design' })).toBeVisible()
  await form.getByRole('tab', { name: 'Entries' }).click()
  await expect(form.locator('crombolo-forms-entries')).toBeVisible()
  await expect(form.locator('crombolo-forms-entries uui-select[label="Form"]')).toHaveCount(0)
})

test('a site that cannot change them says so, and offers no way to', async ({ page }) => {
  await page.route('**/crombolo/api/forms', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), readOnlyBecause: 'site' } })
  })
  await signIn(page)
  await page.goto('/crombolo/section/forms')
  const list = page.locator('crombolo-forms-overview')
  await expect(list.getByRole('status')).toContainText("can't be changed here")
  await expect(list.getByRole('button', { name: 'Create' })).toHaveCount(0)
  const tree = page.locator('crombolo-definition-tree')
  await expect(tree.getByRole('status')).toContainText("can't be changed here")
  await expect(tree.getByRole('button', { name: 'New folder' })).toHaveCount(0)
})

test('Structure says when its types cannot be changed here', async ({ page }) => {
  await page.route('**/crombolo/api/site-files', (route) =>
    route.fulfill({ json: { writable: false } }),
  )
  await signIn(page)
  await page.goto('/crombolo/section/settings/structure')
  await expect(page.locator('umb-section-sidebar .read-only')).toContainText(
    "can't be changed here",
  )
})

test('a page leads to its content type', async ({ page }) => {
  const API = '/crombolo/management/api/v1'
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const name = `Linked ${Math.random().toString(36).slice(2, 7)}`
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
  await goToSection(page, 'Content')
  await settle(page)
  const tree = page.locator('umb-section-sidebar')
  await expect(async () => {
    await tree.getByRole('link', { name, exact: true }).hover()
    await page
      .getByRole('button', { name: `View actions for '${name}'` })
      .first()
      .click({ force: true, timeout: 2_000 })
    await page
      .getByTestId('entity-action:Crombolo.EntityAction.Document.EditContentType')
      .filter({ visible: true })
      .first()
      .click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/section\/settings\/workspace\/document-type\/edit\//)
})
