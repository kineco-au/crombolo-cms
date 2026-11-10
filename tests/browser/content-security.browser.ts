/**
 * The back office's content security policy (story 313): the back office works
 * under it with nothing blocked, a page's request to an origin no granted
 * extension declared is blocked by the browser, and one the browser site's
 * extension declares is not.
 */
import type { Page } from '@playwright/test'
import { expect, settle, signIn, test } from './fixtures.ts'

/** Collects what the policy blocks on this page, from now on. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __violations: string[] }).__violations = seen
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`)
    })
  })
  return () =>
    page.evaluate(() => [...(window as unknown as { __violations: string[] }).__violations])
}

test('the back office runs under its policy with nothing blocked', async ({ page }) => {
  await signIn(page)
  // Each section opened by its address: two section changes in a row trip the
  // client's own race (fixtures.ts, `settle`).
  for (const section of ['content', 'media', 'settings', 'member-management', 'user-management']) {
    await page.goto(`/crombolo/section/${section}`)
    await settle(page)
    const violations = await watchViolations(page)
    await page.waitForTimeout(500)
    expect(await violations(), section).toEqual([])
  }
})

test('a request to an undeclared origin is blocked; a granted extension’s origin is not', async ({
  page,
  diagnostics,
}) => {
  // The refusal this test is about, which the browser logs.
  diagnostics.allowed.push('elsewhere.crombolo.test', 'notes.crombolo.test')
  await signIn(page)
  const violations = await watchViolations(page)
  const attempt = (url: string) =>
    page.evaluate(async (target) => {
      try {
        await fetch(target, { mode: 'no-cors' })
        return 'sent'
      } catch {
        return 'failed'
      }
    }, url)
  expect(await attempt('https://elsewhere.crombolo.test/collect')).toBe('failed')
  await attempt('https://notes.crombolo.test/notes')
  await expect.poll(violations).toEqual(['connect-src https://elsewhere.crombolo.test/collect'])
})
