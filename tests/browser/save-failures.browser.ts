/** A page's save that fails says so, whatever the reason, and says it once. */
import type { Page } from '@playwright/test'
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

const API = '/umbraco/management/api/v1'
const toasts = (page: Page) => page.locator('uui-toast-notification')
const save = (page: Page) =>
  page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()

/** A page of the test's own, open in its editor. */
async function openPage(page: Page) {
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const type = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const made = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: type.id },
      template: null,
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: 'Welcome' }],
      variants: [{ culture: null, segment: null, name: 'Saving' }],
    },
  })
  expect(made.status()).toBe(201)
  const key = made.headers()['umb-generated-resource'] as string
  await goToSection(page, 'Content')
  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
  await expect(page.locator('#name-input input')).toHaveValue(/Saving/)
  await settle(page)
  return key
}

test('with no name, saving and publishing each say to enter one', async ({ page, diagnostics }) => {
  diagnostics.allowed.push('All variants must have a name')
  await openPage(page)
  for (const name of ['', '   ']) {
    await page.locator('#name-input input').fill(name)
    await save(page)
    await expect(toasts(page)).toHaveCount(1)
    await expect(toasts(page)).toContainText('Enter a name, then save again.')
    await toasts(page).getByRole('button').first().click()
    await expect(toasts(page)).toHaveCount(0)
  }
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.SaveAndPublish').click()
  await expect(toasts(page)).toHaveCount(1)
  await expect(toasts(page)).toContainText('Enter a name')
})

for (const [why, status, says] of [
  ['a permission', 403, 'You may not change this page.'],
  ['a page no longer there', 404, 'The page is gone.'],
  ['a permission, unexplained', 403, ''],
  ['a fault', 500, 'It broke.'],
] as const)
  test(`refused for ${why} (${status}), the save says why, once`, async ({ page, diagnostics }) => {
    diagnostics.allowed.push(`${status}`, 'Error saving content', 'UmbTryExecuteController')
    const key = await openPage(page)
    await page.route(`**/management/api/v1/document/${key}`, (route) =>
      route.request().method() === 'PUT'
        ? route.fulfill({
            status,
            contentType: 'application/problem+json',
            body: JSON.stringify({
              type: 'Error',
              title: 'Could not save',
              status,
              ...(says ? { detail: says } : {}),
            }),
          })
        : route.fallback(),
    )
    await page.locator('#name-input input').fill('Changed')
    await save(page)
    await expect(
      toasts(page).filter({ hasText: says || 'You do not have permission' }),
    ).toHaveCount(1)
    await expect(toasts(page)).toHaveCount(1)
  })

test('with the connection lost, the save says so', async ({ page, diagnostics }) => {
  diagnostics.allowed.push('ERR_FAILED', 'Error saving content', 'UmbTryExecuteController')
  const key = await openPage(page)
  await page.route(`**/management/api/v1/document/${key}`, (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.fallback(),
  )
  await page.locator('#name-input input').fill('Changed')
  await save(page)
  await expect(toasts(page)).toHaveCount(1)
  await expect(toasts(page)).toContainText('Connection lost')
})
