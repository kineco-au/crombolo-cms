/**
 * Story 289: the menu under Content, which keeps Content's tab marked across
 * Pages, Structure, Code and Workflows, and the tree beside forms
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
    // Logged, not thrown: a page left as it opens, as in the test below.
    'Context request was cancelled, host was disconnected',
  )
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)
  for (const [label, address] of [
    ['Approvals', /\/section\/workflow/],
    ['Structure', /\/section\/settings\/structure$/],
    ['Code', /\/section\/settings\/code$/],
    ['Pages', /\/section\/content/],
  ] as const) {
    await strip(page).getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(address)
    await expect(strip(page).getByRole('link', { name: label })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(marked(page)).toHaveAttribute('label', 'Content')
    // A section with no tabs once drew the word false where they would be.
    await expect(page.getByText('false', { exact: true })).toHaveCount(0)
  }
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

test('leaving a page while it opens throws nothing', async ({ page, diagnostics }) => {
  diagnostics.allowed.push(
    'Tree context is not set',
    'provideAt is not a function',
    'repository is missing',
    // Logged, not thrown: a part of the page asked for something as it was taken away.
    'Context request was cancelled, host was disconnected',
  )
  await signIn(page)
  for (let i = 0; i < 6; i++) {
    await goToSection(page, 'Content')
    await strip(page).getByRole('link', { name: 'Pages' }).click()
    await page.waitForTimeout(40 * i)
    await strip(page).getByRole('link', { name: 'Structure' }).click()
    await expect(page).toHaveURL(/structure/)
  }
})

test('Forms is a node in Structure, and Content Types can start a form', async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowed.push(
    'Tree context is not set',
    'provideAt is not a function',
    'repository is missing',
  )
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)
  await expect(strip(page).getByRole('link', { name: 'Forms' })).toHaveCount(0)
  await strip(page).getByRole('link', { name: 'Structure' }).click()

  // Its tree sits under Structure's, and stays beside a form when one opens.
  // A node of Structure's own menu, after Data Types and before Languages.
  const tree = page.locator('crombolo-definition-tree').first()
  await expect(tree.locator('uui-menu-item[label="Forms"]')).toBeVisible()
  const names = await page
    .locator('umb-section-sidebar uui-menu-item[label]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('label')))
  const at = (label: string) => names.indexOf(label)
  expect(at('Forms')).toBeGreaterThan(at('Data Types'))
  expect(at('Languages')).toBeGreaterThan(at('Forms'))
  await tree.getByRole('link', { name: 'Forms', exact: true }).click()
  await expect(page).toHaveURL(/\/section\/settings\/forms\/entries/)
  await expect(tree).toBeVisible()
  await expect(strip(page).getByRole('link', { name: 'Structure' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // The types made from forms aren't listed twice.
  const types = page
    .locator('umb-tree-item, umb-default-tree-item')
    .filter({ hasText: 'Content Types' })
  await expect(types.first()).toBeVisible()
  await types.first().hover()
  await types
    .first()
    .locator('uui-action-bar, umb-entity-actions-bundle')
    .first()
    .locator('uui-button, a')
    .first()
    .click()
  await page.getByText('Create…', { exact: true }).click()
  await page.getByText('Form', { exact: true }).click()
  await expect(page).toHaveURL(/\/section\/settings\/forms\?new=/)
  await expect(page.locator('crombolo-forms-overview')).toBeVisible()
})

test('Forms and Approvals have no tab of their own in the header, and Settings no Build cards', async ({
  page,
}) => {
  await signIn(page)
  const tabs = page.locator('umb-backoffice-header-sections uui-tab')
  await expect(tabs.first()).toBeVisible()
  await expect(tabs.filter({ hasText: 'Forms' })).toHaveCount(0)
  await expect(tabs.filter({ hasText: 'Approvals' })).toHaveCount(0)

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

test('someone given Structure alone gets its tree, with no Settings tools', async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowed.push(
    'Tree context is not set',
    'provideAt is not a function',
    'repository is missing',
  )
  await page.route('**/management/api/v1/user/current', async (route) => {
    const response = await route.fetch()
    const user = await response.json()
    user.allowedSections = [
      'Umb.Section.Content',
      'Umb.Section.Settings',
      'Crombolo.Section.Structure',
    ]
    user.isAdmin = false
    await route.fulfill({ response, json: user })
  })
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)
  const links = strip(page).getByRole('link')
  await expect(links).toHaveText(['Pages', 'Structure'])
  await expect(
    page.locator('umb-backoffice-header-sections uui-tab', { hasText: 'Structure' }),
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0)

  // The cards aren't for them, so the address leads to what they have.
  await page.goto('/crombolo/section/settings')
  await expect(page).toHaveURL(/\/section\/settings\/structure$/)
  await expect(page.locator('crombolo-settings-landing')).toHaveCount(0)
})

test('forms sit in folders in the tree, and the root lists every entry', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/forms')
  const tree = page.locator('crombolo-definition-tree')
  await expect(tree.locator('uui-menu-item[label="Forms"]')).toBeVisible()

  // The "…" beside a row, as every tree in the back office has it.
  const folder = `Folder ${Math.random().toString(36).slice(2, 7)}`
  // The "…" shows while its own row is hovered, as in every tree.
  await tree.locator('uui-menu-item[label="Forms"] #menu-item').first().hover()
  await expect(tree.getByRole('button', { name: 'New form' }).first()).toBeVisible()
  await tree.getByRole('button', { name: 'Actions for Forms' }).click()
  await tree.locator('uui-menu-item[label="New folder…"]').click()
  await tree.getByLabel('Folder name').fill(folder)
  await tree.getByRole('button', { name: 'Add' }).click()
  const row = tree.locator(`uui-menu-item[label="${folder}"]`)
  await expect(row).toBeVisible()

  await row.locator('#menu-item').first().hover()
  await tree.getByRole('button', { name: `Actions for ${folder}` }).click()
  await tree.locator('uui-menu-item[label="Delete"]').click()
  await expect(row).toHaveCount(0)

  await tree.getByRole('link', { name: 'Forms', exact: true }).click()
  await expect(page).toHaveURL(/\/view\/entries/)
})

test('Workflows is a node in Structure, below Forms, started from its tree', async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowed.push(
    'Tree context is not set',
    'provideAt is not a function',
    'repository is missing',
  )
  await signIn(page)
  await page.goto('/crombolo/section/settings/structure')
  await expect(
    page.locator('umb-section-sidebar uui-menu-item[label="Workflows"]').first(),
  ).toBeVisible({ timeout: 30_000 })
  const names = await page
    .locator('umb-section-sidebar uui-menu-item[label]')
    .evaluateAll((items) => items.map((item) => item.getAttribute('label')))
  const at = (label: string) => names.indexOf(label)
  expect(at('Workflows')).toBeGreaterThan(at('Forms'))
  expect(at('Languages')).toBeGreaterThan(at('Workflows'))
  const tree = page
    .locator('crombolo-definition-tree')
    .filter({ has: page.locator('uui-menu-item[label="Workflows"]') })
  await expect(tree.locator('uui-menu-item[label="Approvals"]')).toHaveCount(0)

  await tree.getByRole('link', { name: 'Workflows', exact: true }).click()
  await expect(page).toHaveURL(/\/section\/settings\/workflows$/)
  await expect(page.locator('crombolo-workflow-designer')).toBeVisible()
  await expect(strip(page).getByRole('link', { name: 'Structure' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // A workflow is started from the tree, as a form or a content type is, not from the list.
  await expect(page.locator('crombolo-workflow-designer .create')).toHaveCount(0)
  await tree.locator('uui-menu-item[label="Workflows"] #menu-item').first().hover()
  // "+" beside "…", as every tree has it for a new item.
  await tree.getByRole('button', { name: 'New workflow' }).click()
  await expect(page).toHaveURL(/settings\/workflows\?new=/)
  await expect(page.getByRole('button', { name: 'Back to the list' })).toBeVisible()
  await expect(tree).toBeVisible()
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
  await expect(tree.getByRole('button', { name: 'Actions for Forms' })).toHaveCount(0)
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

test('the tree beside each place keeps the one width the reader chose', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/content')
  await page.evaluate(() => localStorage.setItem('umb-split-panel-position', '360px'))
  for (const [address, tree] of [
    ['/crombolo/section/content', 'umb-section-sidebar'],
    ['/crombolo/section/settings/structure', 'umb-section-sidebar:not([hidden])'],
    ['/crombolo/section/settings/code', 'umb-section-sidebar:not([hidden])'],
    ['/crombolo/section/forms', 'umb-section-sidebar'],
    ['/crombolo/section/workflow', 'umb-section-sidebar'],
  ] as const) {
    await page.goto(address)
    const sidebar = page.locator(tree).first()
    await expect(sidebar).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => Math.round((await sidebar.boundingBox())?.width ?? 0), {
        message: address,
      })
      .toBe(360)
  }
})
