/**
 * Stories 384 and 419: workspaces in the back office. The switch at the head of Content opens a
 * workspace and enters it; a page changed there is changed only there; and the switch
 * merges it into Shared, where the change then is. A fresh load straight into an
 * editor waits for the back office to know the workspace and the page's revision.
 */
import type { Page, Route } from '@playwright/test'
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

const API = '/umbraco/management/api/v1'
const switchButton = (page: Page) =>
  page.locator('crombolo-workspace-switch button[aria-haspopup="menu"]')
const controlButton = (page: Page, name: string) =>
  page.locator('crombolo-workspace-controls').getByRole('button', { name, exact: true })
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

  // The switch says Shared, at the head of the strip, which is in no colour of its own.
  const stripNav = page.locator('crombolo-content-strip nav')
  await expect(switchButton(page)).toContainText('Shared')
  // The strip keeps the back office's own colour; the switch is its last item, after the buttons.
  await expect(stripNav).not.toHaveAttribute('style', /.+/)
  await expect(stripNav.locator(':scope > *').last()).toHaveJSProperty(
    'tagName',
    'CROMBOLO-WORKSPACE-SWITCH',
  )
  await switchButton(page).click()
  // Seen, not only clickable: the strip scrolls, and a menu inside it was clipped off-screen.
  const menu = await page.locator('crombolo-workspace-switch ul[role="menu"]').boundingBox()
  const width = page.viewportSize()?.width ?? 0
  expect(menu?.x ?? -1).toBeGreaterThanOrEqual(0)
  expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(width)
  // Story 428: a new workspace is not in the list; pressing outside it closes it.
  await expect(menuItem(page, 'New workspace')).toHaveCount(0)
  await page.locator('crombolo-content-strip nav').click({ position: { x: 400, y: 5 } })
  await expect(page.locator('crombolo-workspace-switch ul[role="menu"]')).toHaveCount(0)
  // In Shared there is nothing to merge, share or delete.
  await expect(controlButton(page, 'Merge into Shared')).toBeDisabled()
  await expect(controlButton(page, 'Share this workspace')).toBeDisabled()
  await expect(controlButton(page, 'Delete this workspace')).toBeDisabled()
  // Each button is an icon, its words shown beside it: a greyed one says why.
  const tooltip = page.locator('crombolo-workspace-controls [role="tooltip"]')
  await controlButton(page, 'New workspace').hover()
  await expect(tooltip).toHaveText('New workspace')
  await page.locator('crombolo-workspace-controls .control').nth(2).hover()
  await expect(tooltip).toContainText('open a workspace first')
  await controlButton(page, 'New workspace').click()
  const dialog = page.locator('dialog.crombolo-workspace-dialog')
  await dialog.locator('input[name="name"]').fill('Spring sale')
  await dialog.locator('textarea[name="description"]').fill('The spring prices')
  // Shared with a group as it is made (story 451): chosen in its autocomplete box.
  await dialog.getByRole('combobox', { name: 'Groups' }).fill('Edit')
  await dialog.getByRole('option', { name: /^Editors/ }).click()
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(switchButton(page)).toContainText('Spring sale')
  // In it, its colour is the dot beside its name, and the strip is as it was.
  await expect(switchButton(page).locator('.dot')).toHaveAttribute(
    'style',
    /background: ?#[0-9a-f]{6}/,
  )
  await expect(stripNav).not.toHaveAttribute('style', /.+/)
  // In a workspace of one's own, it is shared and deleted from the buttons.
  await expect(controlButton(page, 'Share this workspace')).toBeEnabled()
  await expect(controlButton(page, 'Delete this workspace')).toBeEnabled()

  await controlButton(page, 'Delete this workspace').click()
  const confirm = page.locator('umb-confirm-modal uui-dialog-layout')
  await expect(confirm.locator('h3')).toHaveText('Delete Spring sale')
  await expect(confirm.locator('h3')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('umb-confirm-modal')).toContainText(
    "The workspace will be lost. This can't be undone",
  )
  await page.locator('umb-confirm-modal #cancel').click()
  await expect(confirm).toHaveCount(0)

  // Workspaces lists them, the one the tab is in marked, and says what the chosen one is.
  await stripNav.getByRole('link', { name: 'Workspaces', exact: true }).click()
  // The list takes the sidebar, where the tree of pages was; the one chosen is beside it.
  const list = page.locator('umb-section-sidebar crombolo-workspaces-list')
  const all = page.locator('crombolo-workspaces-page')
  await expect(list.locator('.row[aria-current="true"]')).toContainText('Spring sale')
  // The tab is in it, so its switch is off; Shared's is on.
  await expect(list.locator('.row[aria-current="true"] .switch')).toBeDisabled()
  await expect(list.locator('.row', { hasText: 'Shared' }).first().locator('.switch')).toBeEnabled()
  await expect(list.locator('.row[aria-current="true"] .here')).toHaveAttribute(
    'aria-label',
    'You are here',
  )
  await expect(page.locator('umb-section-sidebar umb-document-tree-item')).toHaveCount(0)
  // One place at a time: no tabs for Home and Workspaces above it.
  await expect(page.locator('umb-section-main-views')).toHaveCount(0)
  await expect(all.locator('input.title')).toHaveValue('Spring sale')
  await expect(all.locator('textarea[name="description"]')).toHaveValue('The spring prices')
  // The group chosen is listed where it is shared.
  await expect(all.locator('.tag', { hasText: 'Editors' })).toBeVisible()
  await expect(all.locator('.facts')).toContainText('Created by')
  await expect(all.locator('.facts')).toContainText('Editors')
  // Its owner takes the group away there, and the card says so.
  await all.getByRole('button', { name: 'Remove Editors' }).click()
  await expect(all.locator('.tag', { hasText: 'Editors' })).toHaveCount(0)
  await expect(all.locator('.facts')).not.toContainText('Editors')
  // Renamed there, it is called that at once in the switch too.
  await all.locator('input.title').fill('Spring offers')
  await all.locator('input.title').blur()
  await expect(switchButton(page)).toContainText('Spring offers')
  await expect(list.locator('.row[aria-current="true"]')).toContainText('Spring offers')
  // Shared, chosen in the list, is shown and not entered.
  await list.locator('.row', { hasText: 'Shared' }).first().click()
  await expect(all.getByRole('button', { name: 'Switch to Shared' })).toBeVisible()
  await expect(switchButton(page)).toContainText('Spring offers')
  await expect(stripNav.getByRole('link', { name: 'Workspaces', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  )

  // The page changed in it is changed there only.
  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
  await page.locator('#name-input input').fill(`${NAME} sale`)
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
  await expect(page.locator('uui-toast-notification').filter({ hasText: /saved/i })).toBeVisible()
  expect(await sharedName(page, key)).toBe(NAME)
  // In the tree, the page it changed is marked in its colour, after its name; the rest are not.
  const marks = page.locator('umb-section-sidebar crombolo-item-marks:not([hidden])')
  await expect(marks).toHaveCount(1)
  await expect(marks.first()).toHaveAttribute('title', 'Changed in Spring offers')

  // The merge is a view of its own, in the address, reached from the icon in the bar.
  await settle(page)
  await controlButton(page, 'Merge into Shared').click()
  await expect(page).toHaveURL(/content\/workspaces\?workspace=[0-9a-f-]+&view=merge/)
  const merging = page.locator('crombolo-workspaces-page .merge')
  await expect(merging.locator('h2')).toHaveText('Merge Spring offers into Shared')
  // What it changes is a box for each page, opened to see its fields before and after.
  const item = merging.locator('details.item').first()
  await expect(item.locator('summary')).toContainText(`${NAME} sale`)
  const name = item.locator('tbody tr', { hasText: 'Name' }).first()
  await expect(name.locator('td').first()).toHaveText(NAME)
  await expect(name.locator('td').last()).toHaveText(`${NAME} sale`)
  await expect(page.locator('dialog.crombolo-workspace-dialog')).toHaveCount(0)
  // Back leaves it for the page it was opened from, and forward returns.
  await page.goBack()
  await expect(merging).toHaveCount(0)
  await page.goForward()
  await expect(merging.locator('h2')).toHaveText('Merge Spring offers into Shared')
  // Cancel shows the workspace again; its Merge button comes back here.
  const place = page.locator('crombolo-workspaces-page')
  await place.getByRole('button', { name: 'Cancel' }).click()
  await expect(page).not.toHaveURL(/view=merge/)
  await place.getByRole('button', { name: 'Merge into Shared' }).click()
  await expect(merging.locator('h2')).toHaveText('Merge Spring offers into Shared')
  await place.getByRole('button', { name: 'Merge into Shared' }).click()
  await expect(place).toContainText('Merged into Shared')
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
  await controlButton(page, 'New workspace').click()
  const dialog = page.locator('dialog.crombolo-workspace-dialog')
  await dialog.locator('input[name="name"]').fill('Slow start')
  await dialog.getByRole('button', { name: 'Create' }).click()
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
