/**
 * Story 233: Crombolo's Bundle Editor, in place of Umbraco's package builder.
 * Only the running back office shows that the editor mounts on the Created
 * view's routes, that its tabs are drawn with Umbraco's own inputs, and that a
 * bundle it creates opens again with what was saved, its forms (story 226)
 * among it.
 */
import { expect, signIn, test } from './fixtures.ts'

const CREATED = '/crombolo/section/packages/view/created'

test('the Bundle Editor creates a bundle, lists it, and opens it again on every tab', async ({
  page,
}) => {
  await signIn(page)
  await page.goto(`${CREATED}/package-builder/create`)

  const editor = page.locator('crombolo-bundle-editor')
  // The Packages section has no tree, so there is no sidebar to wait for.
  await expect(editor).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('umb-workspace-package-builder')).toHaveCount(0)
  const tabs = editor.locator('uui-tab')
  await expect(tabs).toHaveText([
    'Content',
    'Types',
    'Code',
    'Language',
    'Forms',
    'Workflows',
    'User groups',
  ])
  await editor.locator('uui-tab', { hasText: 'Forms' }).click()
  await editor.locator('uui-checkbox', { hasText: 'Write to the cove' }).click()
  await editor.locator('uui-tab', { hasText: 'Workflows' }).click()
  await expect(editor.getByText('This site has no approval workflows.')).toBeVisible()

  const name = `Bundle ${Date.now()}`
  await editor.getByLabel('Name of the bundle').fill(name)
  await editor.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText('Bundle created').first()).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Download' })).toBeVisible()

  await page.goto(`${CREATED}/overview`)
  await page
    .getByRole('row', { name: new RegExp(name) })
    .getByRole('button', { name: 'Edit' })
    .click()
  const reopened = page.locator('crombolo-bundle-editor')
  await expect(reopened.getByLabel('Name of the bundle')).toHaveValue(name)

  const inputs: Record<string, string> = {
    Content: 'umb-input-document',
    Types: 'umb-input-document-type',
    Code: 'umb-input-entity',
    Language: 'umb-input-language',
  }
  for (const [tab, input] of Object.entries(inputs)) {
    await reopened.locator('uui-tab', { hasText: tab }).click()
    await expect(reopened.locator(input).first()).toBeVisible()
  }
  await reopened.locator('uui-tab', { hasText: 'Forms' }).click()
  await expect(reopened.getByLabel('Write to the cove')).toBeChecked()
})
