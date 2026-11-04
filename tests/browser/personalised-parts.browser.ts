/**
 * Story 264: a page's Info tab says whether its copies are shared, and a
 * view's Insert menu makes a personalised part and writes its tag and import.
 */
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'

test("a page's Info tab says whether its copies are shared", async ({ page }) => {
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const name = `Shared ${crypto.randomUUID().slice(0, 8)}`
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
  expect(
    (
      await page.request.put(`${API}/document/${key}/publish`, { data: { publishSchedules: [] } })
    ).status(),
  ).toBe(200)

  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
  await page.getByRole('tab', { name: 'Info' }).click()
  const sharing = page.locator('crombolo-page-sharing-info')
  await expect(sharing).toContainText(/Copies are|Not shared|Members only/, { timeout: 20_000 })
})

test("a view's Insert menu makes a personalised part, with its tag and import", async ({
  page,
}) => {
  await signIn(page)
  const run = crypto.randomUUID().slice(0, 6)
  await page.goto(
    '/crombolo/section/settings/workspace/partial-view/create/parent/partial-view-root/null',
  )
  const editor = page.locator('umb-code-editor')
  await expect(editor).toContainText('export default function Partial')

  await expect(async () => {
    await page.locator('#insert-button').click({ timeout: 2_000 })
    await page
      .getByText('A personalised part', { exact: true })
      .filter({ visible: true })
      .click({ timeout: 2_000 })
    await expect(page.locator('crombolo-personalised-part-modal')).toHaveCount(1, {
      timeout: 2_000,
    })
  }).toPass({ timeout: 20_000 })

  const modal = page.locator('crombolo-personalised-part-modal')
  await modal.locator('uui-input#name input').fill(`Greeting ${run}`)
  await modal.getByRole('button', { name: 'Make it' }).click()
  await expect(modal).toHaveCount(0)

  const component = `Greeting${run[0]?.toUpperCase()}${run.slice(1)}`
  await expect(editor).toContainText(`<${component} fallback={<span>Loading…</span>} />`)
  await expect(editor).toContainText(`import ${component} from './greeting-${run}.tsx'`)

  const made = (await (
    await page.request.get(`${API}/partial-view/${encodeURIComponent(`/greeting-${run}.tsx`)}`)
  ).json()) as { content: string }
  expect(made.content.startsWith("'use deferred'")).toBe(true)
  expect(made.content).toContain(`function ${component}`)
})
