/**
 * Story 384: workspaces in the back office. The switch at the head of Content opens a
 * workspace and enters it; a page changed there is changed only there; and the switch
 * merges it into Shared, where the change then is. A fresh load straight into an
 * editor waits for the back office to know the workspace and the page's revision.
 */
import type { Page, Route } from '@playwright/test'
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

test('a fresh load straight into an editor reads and saves the page in the workspace, however slowly the back office starts', async ({
  page,
  diagnostics,
}) => {
  diagnostics.allowed.push('Tree context is not set', 'repository is missing')
  const NAME = `Slow ${Math.random().toString(36).slice(2, 7)}`
  await signIn(page)
  const key = await sharedPage(page, NAME)
  await goToSection(page, 'Content')
  await settle(page)
  await switchButton(page).click()
  await menuItem(page, 'New workspace').click()
  const dialog = page.locator('dialog.crombolo-workspace-dialog')
  await dialog.locator('input[name="name"]').fill('Slow start')
  await dialog.getByRole('button', { name: 'Open it' }).click()
  await expect(switchButton(page)).toContainText('Slow start')

  // What sets up the workspace and the page's revision arrives late, as on a slow network.
  const late = async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  }
  await page.route('**/crombolo/api/workspaces/mine', late)
  await page.route('**/edit-conflicts.js', late)
  const reads: Array<string | undefined> = []
  const saves: Array<string | undefined> = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (!path.endsWith(`/document/${key}`)) return
    if (request.method() === 'GET') reads.push(request.headers()['crombolo-workspace'])
    if (request.method() === 'PUT') saves.push(request.headers()['if-match'])
  })

  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
  await page.locator('#name-input input').fill(`${NAME} later`)
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
  await expect(page.locator('uui-toast-notification').filter({ hasText: /saved/i })).toBeVisible()
  expect(reads.length).toBeGreaterThan(0)
  expect(reads.every((header) => header !== undefined && header !== 'shared')).toBe(true)
  expect(saves).toHaveLength(1)
  expect(saves[0]).toMatch(/^"\d+\.\d+"$/)
  expect(await sharedName(page, key)).toBe(NAME)
})
