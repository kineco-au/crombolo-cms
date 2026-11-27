/**
 * Story 264: a page's Info tab says whether its copies are shared, and a
 * view's Insert menu makes a personalised part and writes its tag and import.
 * Story 443: the preview's visitor switch shows the page to a member of a group.
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

test("the preview's visitor switch shows the page to a member of chosen groups", async ({
  page,
}) => {
  await signIn(page)
  const group = `Readers ${crypto.randomUUID().slice(0, 6)}`
  expect((await page.request.post(`${API}/member-group`, { data: { name: group } })).status()).toBe(
    201,
  )
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  // Its view, as the back office gives a page it creates: without one, preview has nothing to show.
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const name = `Visited ${crypto.randomUUID().slice(0, 8)}`
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

  // Asking for its preview address enters preview, as the editor's Save and preview does.
  expect((await page.request.get(`${API}/document/${key}/preview-url`)).status()).toBe(200)
  await page.goto(`/crombolo/preview?id=${key}`)
  await expect(page.frameLocator('iframe').locator('h1')).toContainText(name, { timeout: 20_000 })
  const visitor = page.locator('crombolo-preview-member')
  await expect(visitor).toContainText('Signed out', { timeout: 20_000 })
  await visitor.getByRole('button', { name: 'Visitor' }).click()
  await visitor.getByText('A member of…', { exact: true }).click()
  await expect(visitor).toContainText('look the member up')
  await visitor.locator('uui-checkbox', { hasText: group }).click()
  await visitor.getByRole('button', { name: 'Preview' }).click()
  await expect(visitor).toContainText(`A member of ${group}`)

  await page.reload()
  await expect(visitor).toContainText(`A member of ${group}`, { timeout: 20_000 })
  await visitor.getByRole('button', { name: 'Visitor' }).click()
  await visitor.getByText('Signed out', { exact: true }).last().click()
  // The button's words are slotted into it, so they are the uui-button's text, not its inner button's.
  await expect(visitor.locator('uui-button[label="Visitor"]')).toContainText('Signed out')
  await expect(visitor.getByRole('menu')).toHaveCount(0)
})

test("a view's Insert menu makes a personalised part, with its tag and import", async ({
  page,
}) => {
  await signIn(page)
  const run = crypto.randomUUID().slice(0, 6)
  await page.goto(
    '/crombolo/section/content/code/workspace/partial-view/create/parent/partial-view-root/null',
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

test("a view's relative imports resolve to the site's views, and a wrong one is underlined", async ({
  page,
}) => {
  await signIn(page)
  await page.goto(
    '/crombolo/section/content/code/workspace/partial-view/create/parent/partial-view-root/null',
  )
  await expect(page.locator('umb-code-editor')).toContainText('export default function Partial')

  const unresolved = () =>
    page.evaluate(async () => {
      const { monaco } = await import('@umbraco-cms/backoffice/external/monaco-editor')
      const model = monaco.editor.getModels().find((m) => m.uri.path.endsWith('.tsx'))
      model?.setValue(
        "import Good from './everyEditor.tsx'\nimport Bad from './nowhere.tsx'\nexport default () => [Good, Bad]\n",
      )
      await new Promise((settled) => setTimeout(settled, 3000))
      return monaco.editor
        .getModelMarkers({ resource: model?.uri })
        .filter((marker) => String(marker.code) === '2307')
        .map((marker) => marker.message)
    })
  await expect
    .poll(unresolved, { timeout: 30_000 })
    .toEqual(["Cannot find module './nowhere.tsx' or its corresponding type declarations."])
})

test('the create menu offers a component or a module, in plain words', async ({ page }) => {
  await signIn(page)
  await page.goto('/crombolo/section/content/code')
  const root = page
    .locator('umb-tree-item, umb-default-tree-item')
    .filter({ hasText: 'Components' })
    .first()
  await root.hover()
  await root
    .locator('uui-action-bar, umb-entity-actions-bundle')
    .first()
    .locator('uui-button, a')
    .first()
    .click()
  await page.getByText('Create…', { exact: true }).click()
  await expect(page.getByText('Component...', { exact: true }).first()).toBeVisible()
  await page.getByText('Module...', { exact: true }).click()
  await expect(page).toHaveURL(/partial-view\/create\/parent\/.*\/module$/)
  await expect(page.locator('umb-code-editor')).toContainText('export function myModule')
})

test('a module is made from its own page, checked as .ts, and has no Insert', async ({ page }) => {
  await signIn(page)
  await page.goto(
    '/crombolo/section/content/code/workspace/partial-view/create/parent/partial-view-root/null/module',
  )
  const editor = page.locator('umb-code-editor')
  await expect(editor).toContainText('export function myModule')
  await expect(page.locator('#insert-button')).toHaveCount(0)

  const name = `module-${crypto.randomUUID().slice(0, 6)}`
  await page.locator('umb-workspace-header-name-editable uui-input input').fill(name)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(new RegExp(`edit/.*${name}.*ts`), { timeout: 20_000 })

  const language = await page.evaluate(async () => {
    const { monaco } = await import('@umbraco-cms/backoffice/external/monaco-editor')
    return monaco.editor.getModels().map((model) => model.uri.path.split('.').at(-1))
  })
  expect(language).toContain('ts')
})
