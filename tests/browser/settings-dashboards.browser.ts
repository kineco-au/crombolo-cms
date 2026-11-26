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

test('a service account is made in Settings, its secret shown once (story 433)', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/crombolo/section/settings/dashboard/service-accounts')
  const screen = page.locator('crombolo-service-accounts')
  await screen.getByRole('button', { name: 'New service account' }).click()
  await screen.getByLabel('Name').fill('Nightly importer')
  await screen.locator('uui-checkbox[label="Writers"]').click()
  await screen.getByRole('button', { name: 'Create' }).click()
  await expect(screen.getByRole('heading', { name: 'Nightly importer' })).toBeVisible()
  await screen.getByRole('button', { name: 'Add a client id' }).click()
  await expect(screen.getByText('Copy this secret now')).toBeVisible()
  await screen.getByRole('button', { name: 'All service accounts' }).click()
  await expect(screen.getByRole('button', { name: 'Nightly importer' })).toBeVisible()
  await expect(screen.getByText('Copy this secret now')).toBeHidden()
})
