/**
 * A page's Info view keeps its history behind View: a panel that slides in, lists
 * the page's changes, and shows what one changed from the version before it,
 * when, and who made it.
 */
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'

test('the page history opens in a panel, and a change shows what it changed', async ({ page }) => {
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const name = `History ${Math.random().toString(36).slice(2, 7)}`
  const created = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: homeType.id },
      template: detail.defaultTemplate,
      parent: null,
      values: [{ alias: 'title', culture: null, segment: null, value: 'First words' }],
      variants: [{ culture: null, segment: null, name }],
    },
  })
  expect(created.status()).toBe(201)
  const key = created.headers()['umb-generated-resource'] as string
  const read = await page.request.get(`${API}/document/${key}`)
  const saved = await page.request.put(`${API}/document/${key}`, {
    headers: { 'if-match': read.headers().etag ?? '*' },
    data: {
      template: detail.defaultTemplate,
      values: [{ alias: 'title', culture: null, segment: null, value: 'Second words' }],
      variants: [{ culture: null, segment: null, name }],
    },
  })
  expect(saved.status(), await saved.text()).toBeLessThan(300)

  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}/invariant/view/info`)
  const history = page.locator('crombolo-page-history')
  await expect(history.getByText(/Last changed/)).toBeVisible({ timeout: 30_000 })
  // In place of Umbraco's list, not beside it.
  await expect(page.locator('uui-box[headline="History"]')).toHaveCount(1)
  await expect(history).not.toContainText('in all')
  await history.getByRole('button', { name: 'View all changes' }).click()

  const panel = page.locator('uui-modal-sidebar crombolo-page-history-modal')
  await expect(panel).toBeVisible()
  const changes = panel.getByRole('list', { name: 'Changes to the page' }).getByRole('button')
  await expect(changes).toHaveCount(2)

  // The newest: the title it changed, before and after, and who and when.
  await changes.first().click()
  const table = panel.getByRole('table', { name: 'Changed properties' })
  await expect(table).toContainText('First words')
  await expect(table).toContainText('Second words')
  await expect(panel.getByText('By')).toBeVisible()
  await expect(panel.getByText('What changed from the version before')).toBeVisible()

  // Back to all of them, and the first: what the page was made with.
  await panel.getByRole('button', { name: 'All changes' }).click()
  await changes.last().click()
  await expect(panel.getByText('What the page was made with')).toBeVisible()
  await expect(panel.getByRole('table', { name: 'Changed properties' })).toContainText(name)
})
