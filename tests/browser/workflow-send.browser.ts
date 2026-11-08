/**
 * Story 028: a page covered by a workflow is sent for approval from the bottom
 * bar, beside "Save and publish"; the button goes once a request is open, and the
 * Workflow tab shows where it stands.
 */
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'
const APPROVALS = '/crombolo/crombolo/api/approvals'

test('Send for approval sits beside Save and publish, and opens a request', async ({
  page,
  diagnostics,
}) => {
  // Opening a page's tab by its address races the editor's own routing (see `settle`).
  diagnostics.allowed.push('provideAt is not a function')
  await signIn(page)
  const types = (await (
    await page.request.get(`${API}/document-type/allowed-at-root?skip=0&take=10`)
  ).json()) as { items: Array<{ id: string; name: string }> }
  const homeType = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const detail = (await (await page.request.get(`${API}/document-type/${homeType.id}`)).json()) as {
    defaultTemplate: { id: string } | null
  }
  const name = `Send ${Math.random().toString(36).slice(2, 7)}`
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

  // A workflow over this page alone, so the rest of the suite publishes as before.
  const alias = `send-${key.slice(0, 8)}`
  const saved = await page.request.put(`${APPROVALS}/workflows/${alias}`, {
    data: {
      workflow: {
        alias,
        name: 'Bottom bar check',
        appliesTo: { branches: [key], contentTypes: [] },
        publishersMaySkip: true,
        onEdit: 'withdraw',
        selfApproval: 'allowed',
        comments: 'optional',
        unpublish: true,
        onChange: 'keep',
        stages: [
          {
            alias: 'review',
            name: 'Review',
            approvers: ['admin'],
            required: 'one',
            next: [],
            sendBack: 'editor',
            position: { x: 0, y: 0 },
          },
        ],
      },
    },
  })
  expect(saved.status(), await saved.text()).toBe(200)

  try {
    await page.goto(`/crombolo/section/content/workspace/document/edit/${key}`)
    const footer = page.locator('umb-workspace-footer')
    const send = footer.getByRole('button', { name: 'Send for approval' })
    await expect(send).toBeVisible({ timeout: 30_000 })
    await expect(footer.getByRole('button', { name: 'Save and publish' })).toBeVisible()

    await send.click()
    const dialog = page.getByRole('dialog', { name: 'Send for approval' })
    await expect(dialog).toBeVisible()
    await dialog.locator('uui-textarea textarea').fill('Ready for a look')
    await dialog.getByRole('button', { name: 'Send for approval' }).click()

    await expect(send).toHaveCount(0)
    const state = (await (await page.request.get(`${APPROVALS}/page/${key}`)).json()) as {
      request: { state: string; history: Array<{ comment: string | null }> } | null
    }
    expect(state.request?.state).toBe('waiting')
    expect(state.request?.history[0]?.comment).toBe('Ready for a look')
    // The tab no longer sends; it shows where the request stands.
    await page.goto(
      `/crombolo/section/content/workspace/document/edit/${key}/invariant/view/workflow`,
    )
    const tab = page.locator('crombolo-workflow-tab')
    await expect(tab.getByText('Waiting for approval').first()).toBeVisible({ timeout: 30_000 })
    await expect(tab.getByRole('button', { name: 'Send for approval' })).toHaveCount(0)
  } finally {
    await page.request.delete(`${APPROVALS}/workflows/${alias}`)
  }
})
