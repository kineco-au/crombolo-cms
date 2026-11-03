/**
 * A block's alias in the real backoffice (story 253): shown in the block's
 * editor, refused when another block in the list has it, and kept by a save.
 */
import { BLOCK_ONLY_ELEMENT_TYPE, expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'
const FIRST = '3d1c7a52-0b6e-4f2a-9c84-51e7d0a6b913'
const SECOND = '8a5e2f17-4c93-4b0d-a6e1-2f7c9b3d5a40'

const block = (key: string, text: string) => ({
  key,
  contentTypeKey: BLOCK_ONLY_ELEMENT_TYPE,
  values: [
    { alias: 'text', editorAlias: 'Umbraco.TextBox', culture: null, segment: null, value: text },
  ],
})

test("a block's alias is shown, checked against the list's others, and kept by a save", async ({
  page,
}) => {
  await signIn(page)
  const types = await (
    await page.request.get(`${API}/document-type/allowed-at-root?take=100`)
  ).json()
  const type = types.items.find((item: { name: string }) => item.name === 'Aliased blocks page')
  const made = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: type.id },
      template: null,
      parent: null,
      values: [
        {
          alias: 'blocks',
          culture: null,
          segment: null,
          value: {
            layout: {
              'Umbraco.BlockList': [{ contentKey: FIRST, alias: 'intro' }, { contentKey: SECOND }],
            },
            contentData: [block(FIRST, 'First'), block(SECOND, 'Second')],
            settingsData: [],
            expose: [
              { contentKey: FIRST, culture: null, segment: null },
              { contentKey: SECOND, culture: null, segment: null },
            ],
          },
        },
      ],
      variants: [
        { culture: null, segment: null, name: `Aliased ${Math.random().toString(36).slice(2, 7)}` },
      ],
    },
  })
  expect(made.status()).toBe(201)
  const key = made.headers()['umb-generated-resource']
  const aliases = async () => {
    const doc = await (await page.request.get(`${API}/document/${key}`)).json()
    const value = doc.values.find((v: { alias: string }) => v.alias === 'blocks')?.value
    return value.layout['Umbraco.BlockList'].map((item: { alias?: string }) => item.alias ?? null)
  }

  await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
  const entries = page.locator('umb-block-list-entry')
  await expect(entries).toHaveCount(2)
  const alias = page.locator('umb-block-workspace-editor #alias input')
  const update = page.getByTestId('workspace-action:Umb.WorkspaceAction.Block.SubmitUpdate')

  await entries.nth(0).click()
  await expect(alias).toHaveValue('intro')
  await update.click()
  await expect(alias).toHaveCount(0)

  await entries.nth(1).click()
  await expect(alias).toHaveValue('')
  await alias.fill('Intro')
  await alias.press('Enter')
  await expect(page.locator('umb-block-workspace-editor #alias-problem')).toHaveText(
    'Another block here has this alias',
  )
  await alias.fill('outro')
  await alias.press('Enter')
  await expect(page.locator('umb-block-workspace-editor #alias-problem')).toHaveCount(0)
  await update.click()
  await expect(alias).toHaveCount(0)

  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
  await expect.poll(aliases).toEqual(['intro', 'outro'])
})
