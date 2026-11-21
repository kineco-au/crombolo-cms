/**
 * Story 384: workspaces in the back office. The switch at the head of Content opens a
 * workspace and enters it; a page changed there is changed only there; and the switch
 * merges it into Shared, where the change then is.
 */
import type { Page } from '@playwright/test'
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

const API = '/umbraco/management/api/v1'
const switchButton = (page: Page) =>
  page.locator('crombolo-workspace-switch button[aria-haspopup="menu"]')
const menuItem = (page: Page, name: RegExp | string) =>
  page.locator('crombolo-workspace-switch').getByRole('menuitem', { name })

/** A published page, made in Shared through the API: this spec is about the workspace. */
async function sharedPage(page: Page, name: string): Promise<string> {
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as {
    items: Array<{ id: string; name: string }>
  }
  const type = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const made = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: type.id },
      template: null,
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: 'Welcome' }],
      variants: [{ culture: null, segment: null, name }],
    },
  })
  expect(made.status()).toBe(201)
  const key = made.headers()['umb-generated-resource'] as string
  await page.request.put(`${API}/document/${key}/publish`, {
    data: { publishSchedules: [{ culture: null }] },
  })
  return key
}

const sharedName = async (page: Page, key: string) =>
  (
    (await (await page.request.get(`${API}/document/${key}`)).json()) as {
      variants: Array<{ name: string }>
    }
  ).variants[0]?.name

test('a workspace opened from the switch takes a change apart from Shared, and merges it in', async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowed.push('Tree context is not set', 'repository is missing')
  const NAME = `Visit ${Math.random().toString(36).slice(2, 7)}`
  await signIn(page)
  const key = await sharedPage(page, NAME)
  await goToSection(page, 'Content')
  await settle(page)

  // The switch says Shared, and opens a workspace that the tab is then in.
  await expect(switchButton(page)).toContainText('Shared')
  await switchButton(page).click()
  await menuItem(page, 'New workspace').click()
  const dialog = page.locator('dialog.crombolo-workspace-dialog')
  await dialog.locator('input[name="name"]').fill('Spring sale')
  await dialog.getByRole('button', { name: 'Open it' }).click()
  await expect(switchButton(page)).toContainText('Spring sale')

  // The page changed in it is changed there only.
  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
  await page.locator('#name-input input').fill(`${NAME} sale`)
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
  await expect(page.locator('uui-toast-notification').filter({ hasText: /saved/i })).toBeVisible()
  expect(await sharedName(page, key)).toBe(NAME)

  // Merged from the switch, Shared has it; the tab is back in Shared.
  await settle(page)
  await switchButton(page).click()
  await menuItem(page, /Merge into Shared/).click()
  await page
    .locator('dialog.crombolo-workspace-dialog')
    .getByRole('button', { name: 'Merge into Shared' })
    .click()
  await expect(page.locator('dialog.crombolo-workspace-dialog')).toContainText('Merged')
  await expect.poll(() => sharedName(page, key), { timeout: 10_000 }).toBe(`${NAME} sale`)
  await expect(switchButton(page)).toContainText('Shared', { timeout: 15_000 })
})
