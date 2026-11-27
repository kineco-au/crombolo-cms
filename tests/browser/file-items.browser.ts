/**
 * Story 450's journey: a File made at the root from the Create menu, its text
 * typed in the editor its name chooses, previewed raw, published and opened at
 * its name exactly.
 */
import { expect, goToSection, settle, signIn, test } from './fixtures.ts'

test('a File is made, previewed, published and served at its name', async ({ page }) => {
  const NAME = `llms-${Math.random().toString(36).slice(2, 7)}.txt`
  const BODY = '# The site\n\nWhat an agent should know.'
  await signIn(page)
  await goToSection(page, 'Content')
  await settle(page)

  // The Create menu at the root offers File, whatever the site's types allow there.
  const dialog = page.locator('umb-document-create-options-modal')
  await expect(async () => {
    await page
      .getByRole('button', { name: 'Create item for Content' })
      .click({ force: true, timeout: 2_000 })
    await expect(dialog).toBeVisible({ timeout: 2_000 })
    await expect(dialog.locator('uui-loader')).toHaveCount(0, { timeout: 3_000 })
    await dialog
      .locator('uui-ref-node-document-type')
      .filter({ hasText: /^\s*File\b/ })
      .first()
      .click({ timeout: 3_000 })
    await expect(page).toHaveURL(/\/document\/create\//, { timeout: 3_000 })
  }).toPass({ timeout: 30_000 })

  // The name chooses the editor: a .txt File is a plain text area.
  // Typed again if the new item's workspace, still loading, clears it.
  const editor = page.locator('crombolo-file-body')
  await expect(async () => {
    await page.locator('#name-input input').fill(NAME)
    await expect(editor.locator('uui-textarea')).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await editor.locator('uui-textarea textarea').fill(BODY)

  // Previewed raw, as a browser would show the draft.
  const popup = page.waitForEvent('popup')
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.SaveAndPreview').click()
  const preview = await popup
  await expect(preview.frameLocator('iframe').locator('body')).toContainText(
    'What an agent should know.',
    { timeout: 15_000 },
  )
  await preview.close()

  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.SaveAndPublish').click()
  await expect(
    page.locator('uui-toast-notification').filter({ hasText: 'published' }),
  ).toBeVisible()

  // Opened at its name exactly, extension and all, as text.
  const served = await page.request.get(`/${NAME}`)
  expect(served.status()).toBe(200)
  expect(served.headers()['content-type']).toBe('text/plain; charset=utf-8')
  expect(await served.text()).toBe(BODY)
})
