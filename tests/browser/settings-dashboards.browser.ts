/**
 * Crombolo's own Settings dashboards open without an error: each is an Umbraco
 * element, which the section gives a context when it shows it.
 */
import { expect, signIn, test } from './fixtures.ts'

const DASHBOARDS = {
  addresses: 'crombolo-addresses-dashboard',
  changes: 'crombolo-changes-dashboard',
  'audit-log': 'crombolo-audit-dashboard',
  'background-jobs': 'crombolo-jobs-dashboard',
}

test('the Settings dashboards open without an error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await signIn(page)
  for (const [pathname, element] of Object.entries(DASHBOARDS)) {
    await page.goto(`/crombolo/section/settings/dashboard/${pathname}`)
    await expect(page.locator(element)).toBeVisible({ timeout: 30_000 })
  }
  expect(errors.filter((message) => message.includes('provideContext'))).toEqual([])
})
