/**
 * The Workflows section opens on the list of workflows for an administrator,
 * the one view only administrators have.
 */
import { expect, signIn, test } from './fixtures.ts'

test('an administrator opening the Workflows section lands on the list of workflows', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/crombolo/section/workflow')
  const tabs = page.locator('umb-section-main-views uui-tab')
  await expect(tabs.first()).toHaveText('Workflows', { timeout: 30_000 })
  await expect(page.locator('crombolo-workflow-designer')).toBeVisible()
  await expect(page.locator('crombolo-workflow-waiting')).toHaveCount(0)
})
