/**
 * Aliases made from names, as in Umbraco's own editors: something new has its
 * alias follow its name, locked, until it is saved or written by hand; a saved
 * one stays locked, and says what unlocking it changes.
 */
import { expect, signIn, test } from './fixtures.ts'

const CONTACT = '7b1f4c20-9a63-4e18-8d25-3c6f5a1e9b04'

const aliasOf = (host: import('@playwright/test').Locator) => host.locator('uui-input').first()

test('a new form and its fields take aliases from their names', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/forms/view/forms?new=')
  const editor = page.locator('crombolo-forms-overview')
  const name = editor.getByRole('textbox', { name: 'Name', exact: true })
  await name.fill('Trade enquiry')
  const formAlias = editor.locator('crombolo-alias-input').first()
  await expect(aliasOf(formAlias)).toHaveJSProperty('value', 'tradeEnquiry')

  // A field: its alias follows its caption, a dictionary item's name included.
  await editor.getByRole('button', { name: 'Add a field' }).first().click()
  const caption = editor.locator('crombolo-form-word-input[label="Caption"] input').last()
  await caption.fill('Your phone number')
  const fieldAlias = editor.locator('uui-table-row crombolo-alias-input').last()
  await expect(aliasOf(fieldAlias)).toHaveJSProperty('value', 'yourPhoneNumber')

  // Written by hand, the alias stays when the name changes.
  await formAlias.getByRole('button', { name: /^Unlock/ }).click()
  await formAlias.locator('uui-input input').fill('trade')
  await formAlias.locator('uui-input input').blur()
  await name.fill('Trade enquiry form')
  await expect(aliasOf(formAlias)).toHaveJSProperty('value', 'trade')
  // New, so unlocking it warns of nothing.
  await expect(formAlias.getByRole('status')).toHaveCount(0)
})

test('a saved form keeps its alias, and unlocking it says what that changes', async ({ page }) => {
  const unlabelled: string[] = []
  page.on('console', async (message) => {
    if (!message.text().includes('needs a `label`')) return
    const node = message.args()[1]
    const html = node
      ? await node.evaluate((el) => (el as Element).outerHTML.slice(0, 160)).catch(() => '')
      : ''
    unlabelled.push(`${message.text().split(' JSHandle')[0]} ${html}`)
  })
  await signIn(page)
  await page.goto(`/crombolo/section/forms/view/forms?form=${CONTACT}`)
  const editor = page.locator('crombolo-forms-overview')
  const formAlias = editor.locator('crombolo-alias-input').first()
  await expect(formAlias).toBeVisible({ timeout: 30_000 })
  const before = await aliasOf(formAlias).evaluate((el) => (el as HTMLInputElement).value)
  await editor.getByRole('textbox', { name: 'Name', exact: true }).fill('A new name')
  await expect(aliasOf(formAlias)).toHaveJSProperty('value', before)
  await formAlias.getByRole('button', { name: /^Unlock/ }).click()
  await expect(formAlias.getByRole('status')).toContainText('stops finding this')

  // Every box in the editor is named, so none warns that it needs a label.
  for (const tab of ['Entries', 'Design']) await editor.getByRole('tab', { name: tab }).click()
  expect(unlabelled).toEqual([])
})

test('a new workflow and its stages take aliases from their names', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/settings/workflows?new=')
  const designer = page.locator('crombolo-workflow-designer')
  await designer.getByRole('textbox', { name: 'Name', exact: true }).first().fill('Legal sign off')
  const workflowAlias = designer.locator('crombolo-alias-input').first()
  await expect(aliasOf(workflowAlias)).toHaveJSProperty('value', 'legal-sign-off')

  await designer.getByRole('tab', { name: 'Stages' }).click()
  await designer.getByRole('textbox', { name: 'Name', exact: true }).fill('Legal review')
  const stageAlias = designer.locator('crombolo-alias-input')
  await expect(aliasOf(stageAlias)).toHaveJSProperty('value', 'legal-review')
})
