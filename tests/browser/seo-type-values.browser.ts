/**
 * Story 317: an administrator sets where a page's title comes from, from its
 * Search & sharing view, for every page of its type, and another page of that
 * type then takes its title from the setting.
 */
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'
const SEO = '/crombolo/crombolo/api/seo'

test("a type's title, set from one page, titles another", async ({ page }) => {
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const suffix = Math.random().toString(36).slice(2, 7)
  const create = async (title: string) => {
    const created = await page.request.post(`${API}/document`, {
      data: {
        documentType: { id: homeType.id },
        template: detail.defaultTemplate,
        parent: null,
        values: [{ alias: 'title', culture: null, segment: null, value: title }],
        variants: [{ culture: null, segment: null, name: `${title} ${suffix}` }],
      },
    })
    expect(created.status()).toBe(201)
    return created.headers()['umb-generated-resource'] as string
  }
  const first = await create('First')
  const second = await create('Second')

  try {
    await page.goto(
      `/crombolo/section/content/workspace/document/edit/${first}/invariant/view/search-and-sharing`,
    )
    const view = page.locator('crombolo-seo-document-view')
    await view.locator('uui-button[label="Change where the title comes from"]').click()

    // Typing `{` offers the page's properties.
    const box = view.locator('crombolo-seo-value-input uui-input input')
    await box.fill('')
    await box.pressSequentially('{tit')
    await view.getByRole('option', { name: /Title/ }).first().click()
    await expect(box).toHaveValue('{title}')
    await box.pressSequentially(' | Harbour')
    await box.blur()

    await view.locator('uui-button[label^="Every Home Page page"]').click()
    await expect(view.locator('tr', { hasText: 'Title' }).first()).toContainText('First | Harbour')

    await page.goto(
      `/crombolo/section/content/workspace/document/edit/${second}/invariant/view/search-and-sharing`,
    )
    const title = page.locator('crombolo-seo-document-view tr', { hasText: 'Title' }).first()
    await expect(title).toContainText('Second | Harbour', { timeout: 30_000 })
    await expect(title).toContainText("This type's setting")
  } finally {
    await page.request.put(`${SEO}/type`, { data: { contentType: 'homePage', seo: {} } })
  }
})
