/**
 * Approvals is a section only while the site has a workflow or a request is
 * open, and opens on what waits for the reader; setting workflows up is an
 * administrator's Settings card (story 234).
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

test('Approvals comes with the first workflow and goes with the last', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/content')
  const tabs = page.locator('umb-backoffice-header-sections uui-tab')
  await expect(tabs.first()).toBeVisible({ timeout: 30_000 })
  await expect(tabs.filter({ hasText: 'Approvals' })).toHaveCount(0)

  const saved = await page.request.put(`${API}/workflows/${WORKFLOW.alias}`, {
    data: { workflow: WORKFLOW },
  })
  expect(saved.status(), await saved.text()).toBe(200)

  await page.goto('/crombolo/section/workflow')
  await expect(tabs.filter({ hasText: 'Approvals' })).toHaveCount(1, { timeout: 30_000 })
  const views = page.locator('umb-section-main-views uui-tab')
  await expect(views.first()).toHaveText('Waiting for me', { timeout: 30_000 })
  await expect(page.locator('crombolo-workflow-waiting')).toBeVisible()
  await expect(page.locator('crombolo-workflow-designer')).toHaveCount(0)

  // Deleted from the designer: Approvals goes without a reload.
  await page.goto('/crombolo/section/settings/dashboard/workflows')
  const designer = page.locator('crombolo-workflow-designer')
  await expect(designer.getByText('Browser check')).toBeVisible({ timeout: 30_000 })
  page.once('dialog', (dialog) => dialog.accept())
  await designer.getByRole('button', { name: 'Delete' }).click()
  await expect(designer.getByText('Browser check')).toHaveCount(0)
  await expect(tabs.filter({ hasText: 'Approvals' })).toHaveCount(0)
})

test('the Workflows card in Settings opens the list of workflows', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/settings')
  const landing = page.locator('crombolo-settings-landing')
  await landing.getByRole('link', { name: /Workflows/ }).click({ timeout: 30_000 })
  await expect(page).toHaveURL(/\/section\/settings\/dashboard\/workflows/)
  await expect(page.locator('crombolo-workflow-designer')).toBeVisible()
})
