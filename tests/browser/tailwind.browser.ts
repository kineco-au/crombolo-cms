/**
 * Story 452: Tailwind on every site. A class saved in a view in the template
 * editor styles the page, and typing in a `className` offers a class that is
 * then inserted.
 */
import type { Page } from '@playwright/test'
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'

interface Template {
  name: string
  alias: string
  content: string
}

/** The Home Page type and its template, as the suite's site has them. */
async function homeTemplate(page: Page) {
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const type = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${type.id}`)).json()) as {
    defaultTemplate: { id: string }
  }
  const id = detail.defaultTemplate.id
  const template = (await (await page.request.get(`${API}/template/${id}`)).json()) as Template
  return { type: type.id, id, template }
}

/** What monaco holds and does for the open view, reached through the element's editor. */
const monacoOf = (page: Page) => page.locator('umb-code-editor')

async function setCode(page: Page, code: string) {
  await monacoOf(page).evaluate((host, text) => {
    ;(host as unknown as { code: string }).code = text
  }, code)
}

test('a class saved in a view in the template editor styles the page', async ({ page }) => {
  await signIn(page)
  const { type, id, template } = await homeTemplate(page)
  const name = `Styled ${crypto.randomUUID().slice(0, 8)}`
  const created = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: type },
      template: { id },
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
  const urls = (await (await page.request.get(`${API}/document/urls?id=${key}`)).json()) as Array<{
    urlInfos: Array<{ url: string }>
  }>
  const url = urls[0]?.urlInfos[0]?.url as string
  expect(url).toBeTruthy()

  const visitor = await page.context().newPage()
  await visitor.goto(url)
  const link = visitor.locator('link[href^="/css/tailwind."]')
  await expect(link).toHaveCount(1)
  const before = await link.getAttribute('href')
  await expect(visitor.locator('h1')).not.toHaveCSS('text-decoration-style', 'wavy')

  try {
    await page.goto(`/crombolo/section/content/code/workspace/template/edit/${id}`)
    await expect(monacoOf(page)).toContainText('export default function HomePage')
    await setCode(
      page,
      template.content.replace('<h1>', '<h1 className="underline decoration-wavy">'),
    )
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes(`/template/${id}`) && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    expect((await saved).ok()).toBe(true)

    await expect(async () => {
      await visitor.reload()
      await expect(visitor.locator('h1')).toHaveCSS('text-decoration-style', 'wavy', {
        timeout: 1_000,
      })
    }).toPass({ timeout: 20_000 })
    expect(await visitor.locator('link[href^="/css/tailwind."]').getAttribute('href')).not.toBe(
      before,
    )
  } finally {
    await page.request.put(`${API}/template/${id}`, { data: template })
    await visitor.close()
  }
})

test('typing in a className offers Tailwind’s classes, and the one chosen is inserted', async ({
  page,
}) => {
  await signIn(page)
  await page.goto(
    '/crombolo/section/content/code/workspace/template/create/parent/template-root/null',
  )
  await expect(monacoOf(page)).toContainText(
    'export default function Template({ model }: PageProps)',
  )
  await setCode(
    page,
    `export default function Template() {
  return <div className="">Hello</div>
}
`,
  )
  // The cursor between the quotes, then typed as a person types.
  await monacoOf(page).evaluate((host) => {
    const editor = (
      host as unknown as {
        editor: {
          monacoEditor: {
            focus(): void
            setPosition(position: { lineNumber: number; column: number }): void
          }
        }
      }
    ).editor.monacoEditor
    editor.setPosition({ lineNumber: 2, column: 26 })
    editor.focus()
  })
  await page.keyboard.type('bg-red-5', { delay: 50 })
  const offered = page.locator('.suggest-widget .monaco-list-row', { hasText: /bg-red-500\b/ })
  await expect(offered.first()).toBeVisible({ timeout: 15_000 })
  // A colour is offered with its swatch.
  await expect(offered.first().locator('.colorspan')).toHaveCSS(
    'background-color',
    'rgb(251, 44, 54)',
  )
  await offered.first().click()
  await expect(async () => {
    const code = await monacoOf(page).evaluate((host) =>
      (
        host as unknown as { editor: { monacoEditor: { getValue(): string } } }
      ).editor.monacoEditor.getValue(),
    )
    expect(code).toContain('className="bg-red-500"')
  }).toPass({ timeout: 5_000 })
})
