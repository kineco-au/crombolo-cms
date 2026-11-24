/**
 * Story 409 in the real back office: while editing is paused, a banner across the top
 * says so, with the reason and when saving is back; it goes when editing is resumed, and
 * by itself when the pause's time passes.
 */
import { expect, settle, signIn, test } from './fixtures.ts'

const ROUTE = '/crombolo/crombolo/api/maintenance'

test('editors see a banner while editing is paused, which goes when it is resumed or ends', async ({
  page,
}) => {
  await signIn(page)
  await settle(page)
  const pause = (body: unknown) =>
    page.request.post(ROUTE, { data: body, headers: { 'content-type': 'application/json' } })
  const banner = page.locator('crombolo-maintenance-banner')

  expect((await pause({ action: 'pause', reason: 'Deploying', forSeconds: 3600 })).status()).toBe(
    200,
  )
  await expect(banner).toContainText('Editing is paused for maintenance: Deploying.', {
    timeout: 15_000,
  })
  await expect(banner).toContainText('You can save again at')

  expect((await pause({ action: 'resume' })).status()).toBe(200)
  await expect(banner).toHaveCount(0, { timeout: 15_000 })

  // A short pause goes by itself, with nothing resumed.
  expect((await pause({ action: 'pause', reason: 'A moment', forSeconds: 8 })).status()).toBe(200)
  await expect(banner).toContainText('A moment', { timeout: 15_000 })
  await expect(banner).toHaveCount(0, { timeout: 20_000 })
})
