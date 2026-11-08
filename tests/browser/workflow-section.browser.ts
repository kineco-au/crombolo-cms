/**
 * Approvals is in the menu under Content, with no tab in the header: one list of
 * requests, pending by default, or word that no workflow is set up, and a tree of
 * what waits for the reader and what was decided. Workflows are set up in
 * Structure (story 234).
 */
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/crombolo/api/approvals'

/** Covers nothing, so the rest of the suite publishes as before. */
const WORKFLOW = {
  alias: 'browser-check',
  name: 'Browser check',
  appliesTo: { branches: [], contentTypes: [] },
  publishersMaySkip: true,
  onEdit: 'withdraw',
  selfApproval: 'refused',
  comments: 'optional',
  unpublish: false,
  onChange: 'keep',
  stages: [
    {
      alias: 'review',
      name: 'Review',
      approvers: ['admin'],
      required: 'one',
      next: [],
      sendBack: 'editor',
      position: { x: 0, y: 0 },
    },
  ],
}

test('Approvals says when no workflow is set up, and lists requests once one is', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/crombolo/section/workflow')
  const tabs = page.locator('umb-backoffice-header-sections uui-tab')
  const waiting = page.locator('crombolo-approvals-list')
  await expect(waiting).toContainText('No approval workflows have been set up yet', {
    timeout: 30_000,
  })
  await expect(tabs.filter({ hasText: 'Approvals' })).toHaveCount(0)
  await expect(
    page.locator('crombolo-content-strip').getByRole('link', { name: 'Approvals' }),
  ).toHaveAttribute('aria-current', 'page')

  const saved = await page.request.put(`${API}/workflows/${WORKFLOW.alias}`, {
    data: { workflow: WORKFLOW },
  })
  expect(saved.status(), await saved.text()).toBe(200)

  await page.reload()
  await expect(waiting.locator('uui-checkbox[label="Pending"]')).toBeVisible({
    timeout: 30_000,
  })
  await expect(waiting).not.toContainText('No approval workflows')
  await expect(page.locator('umb-section-main-views uui-tab')).toHaveCount(0)
  await expect(page.locator('crombolo-workflow-designer')).toHaveCount(0)

  // Deleted from the designer: Approvals says so again.
  await page.goto('/crombolo/section/settings/workflows')
  const designer = page.locator('crombolo-workflow-designer')
  await expect(designer.getByText('Browser check')).toBeVisible({ timeout: 30_000 })
  page.once('dialog', (dialog) => dialog.accept())
  await designer.getByRole('button', { name: 'Delete' }).click()
  await expect(designer.getByText('Browser check')).toHaveCount(0)
  await page.goto('/crombolo/section/workflow')
  await expect(waiting).toContainText('No approval workflows have been set up yet', {
    timeout: 30_000,
  })
})

test('the addresses Workflows had open them in Structure', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/settings/dashboard/workflows')
  await expect(page).toHaveURL(/\/section\/settings\/workflows$/, { timeout: 30_000 })
  await expect(page.locator('crombolo-workflow-designer')).toBeVisible()
})

test('the list pages through pending and decided, and the tree holds what is pending', async ({
  page,
}) => {
  const request = (state: string, nodeName: string, index: number) => ({
    key: `${nodeName}-${index}`,
    nodeKey: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
    nodeName,
    variant: null,
    action: 'publish',
    state,
    schedule: null,
    stages: [],
    workflow: { alias: 'review', name: 'Review' },
    requestedAt: new Date().toISOString(),
  })
  const asked: string[] = []
  await page.route('**/approvals/active', (route) => route.fulfill({ json: { active: true } }))
  await page.route('**/approvals/requests?**', (route) => {
    const url = new URL(route.request().url())
    asked.push(url.search)
    const decided = url.searchParams.get('decided') === 'true'
    const skip = Number(url.searchParams.get('skip'))
    const total = decided ? 30 : 2
    const items = Array.from({ length: Math.min(25, total - skip) }, (_, i) =>
      request(skip + i < 2 ? 'waiting' : 'approved', `Page ${skip + i + 1}`, skip + i + 1),
    )
    return route.fulfill({ json: { total, items } })
  })
  await page.route('**/approvals/in-flight', (route) =>
    route.fulfill({
      json: {
        items: [request('waiting', 'Someone else’s', 2), request('waiting', 'Mine to decide', 1)],
      },
    }),
  )
  await page.route('**/approvals/waiting', (route) =>
    route.fulfill({ json: { items: [request('waiting', 'Mine to decide', 1)] } }),
  )
  await signIn(page)
  await page.goto('/crombolo/section/workflow')
  const list = page.locator('crombolo-approvals-list')

  // Pending by default, with no pages to turn.
  await expect(list.getByRole('link', { name: 'Page 2' })).toBeVisible({ timeout: 30_000 })
  await expect(list.locator('uui-pagination')).toHaveCount(0)
  expect(asked[0]).toContain('pending=true&decided=false')

  // Decided too: thirty rows, two pages.
  await list.locator('uui-checkbox[label="Decided"]').click()
  await expect(list.getByRole('link', { name: 'Page 25' })).toBeVisible()
  const pages = list.locator('uui-pagination')
  await expect(pages).toBeVisible()
  await pages.getByRole('button', { name: '2' }).click()
  await expect(list.getByRole('link', { name: 'Page 30' })).toBeVisible()
  expect(asked.at(-1)).toContain('skip=25')

  // The tree: one Pending folder, no root; what waits for me first, marked.
  const tree = page.locator('crombolo-approvals-tree')
  await expect(tree.getByRole('heading', { name: 'Approvals' })).toBeVisible()
  await expect(tree.locator('uui-menu-item[label="Approvals"]')).toHaveCount(0)
  await expect(tree.locator('uui-menu-item[label="Waiting for me"]')).toHaveCount(0)
  await expect(tree.locator('uui-menu-item[label="Decided"]')).toHaveCount(0)
  const pending = tree.locator('uui-menu-item[label="Pending"]')
  await expect(pending.locator('umb-icon[name="icon-folder"]').first()).toBeAttached()
  const rows = pending.locator('uui-menu-item')
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toHaveAttribute('label', 'Mine to decide')
  await expect(rows.first().locator('umb-icon[name="icon-inbox"]')).toBeAttached()
  await expect(rows.nth(1).locator('umb-icon[name="icon-document"]')).toBeAttached()
  // Not followed: the page is made up, and opening it would fail to load.
  await expect(
    tree.locator('uui-menu-item[label="Mine to decide"] a#label-button'),
  ).toHaveAttribute(
    'href',
    /\/section\/content\/workspace\/document\/edit\/0{8}-0{4}-0{4}-0{4}-0{11}1\/invariant\/view\/workflow$/,
  )
})
