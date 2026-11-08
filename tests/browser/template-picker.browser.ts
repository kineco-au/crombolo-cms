/**
 * A page's Info view picks its template in a panel, from every component in its folders.
 * One the content type does not allow says so, and is allowed there, beside it:
 * the type gains it, and it is picked like the rest.
 */
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'

test('the template picker is a tree with a search, and allows a template in place', async ({
  page,
}) => {
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
    allowedTemplates: Array<{ id: string }>
  }
  const name = `Template ${Math.random().toString(36).slice(2, 7)}`
  const created = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: homeType.id },
      template: detail.defaultTemplate,
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: name }],
      variants: [{ culture: null, segment: null, name }],
    },
  })
  expect(created.status()).toBe(201)
  const key = created.headers()['umb-generated-resource'] as string

  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}/invariant/view/info`)
  const template = page.locator('umb-document-workspace-view-info uui-ref-node').first()
  await expect(template).toBeVisible({ timeout: 30_000 })
  await template.hover()
  await template.getByRole('button', { name: 'Choose' }).click()

  // A panel that slides in, as Umbraco's pickers do.
  const picker = page.locator('uui-modal-sidebar crombolo-template-picker-modal')
  await expect(picker).toBeVisible()
  await expect(picker.getByText('Choose a template')).toBeVisible()
  const tree = picker.getByRole('tree', { name: 'Templates' })
  await expect(tree.getByRole('treeitem').first()).toBeVisible()

  // One the type does not allow: allowed beside it, then picked like the rest.
  const blocked = picker.locator('li.blocked').first()
  const chosen = ((await blocked.locator('.name').textContent()) ?? '').trim()
  // The search narrows the tree to it.
  await picker.getByRole('textbox', { name: 'Search templates' }).fill(chosen)
  await expect(tree.getByRole('treeitem').filter({ hasText: chosen }).first()).toBeVisible()
  await picker.getByRole('textbox', { name: 'Search templates' }).fill('no-such-template-here')
  await expect(picker.getByText('No template has that name.')).toBeVisible()
  await picker.getByRole('textbox', { name: 'Search templates' }).fill(chosen)

  await picker
    .locator('li.blocked')
    .filter({ hasText: chosen })
    .first()
    .locator('uui-button')
    .click()
  await expect(picker.locator('li.blocked').filter({ hasText: chosen })).toHaveCount(0)
  await expect(picker).toBeVisible()
  await picker.locator('button.pick').filter({ hasText: chosen }).first().click()
  await expect(picker).toBeHidden()
  await expect(template).toHaveAttribute('name', new RegExp(`(^|/)${chosen}$`))

  const after = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    allowedTemplates: Array<{ id: string }>
  }
  expect(after.allowedTemplates.length).toBe(detail.allowedTemplates.length + 1)
})
