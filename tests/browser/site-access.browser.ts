/**
 * Story 446 in a real browser: a site open only to its back-office users sends a
 * visitor to the back office's sign-in, and back to the page they asked for once
 * signed in; it is never indexed, and its robots.txt disallows everything.
 */
import { BROWSER_ADMIN, CLOSED_SITE_HOME, CLOSED_SITE_URL, expect, test } from './fixtures.ts'

test('a closed site sends a visitor to sign in, and back to the page once they have', async ({
  page,
}) => {
  const robots = await page.request.get(`${CLOSED_SITE_URL}/robots.txt`)
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')

  await page.goto(`${CLOSED_SITE_URL}/?from=journey`)
  await expect(page).toHaveURL(/\/crombolo\/login\?returnUrl=/)
  await page.locator('input[name="username"]').fill(BROWSER_ADMIN.login)
  await page.locator('input[name="password"]').fill(BROWSER_ADMIN.password)
  const back = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/' && response.request().resourceType() === 'document',
  )
  await page.getByRole('button', { name: /^(Login|Sign in)$/ }).click()
  // The site's own page, not the sign-in, and never to be indexed.
  const answered = await back
  expect(answered.status()).toBe(200)
  expect(answered.headers()['x-robots-tag']).toBe('noindex, nofollow')
  await expect(page).toHaveURL(`${CLOSED_SITE_URL}/?from=journey`)
  await expect(page.locator('body')).toContainText(CLOSED_SITE_HOME)
})
