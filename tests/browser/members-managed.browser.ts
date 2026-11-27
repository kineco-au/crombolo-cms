/**
 * Story 445 in the real back office: a member a directory created opens read-only, Save
 * hidden, with who keeps them in the footer, and the Members list marks them; a member
 * the site made keeps Save.
 */
import type { APIRequestContext, Page } from '@playwright/test'
import { expect, MEMBER_DIRECTORY, settle, signIn, test } from './fixtures.ts'

const API = '/umbraco/management/api/v1'
const unique = (name: string) => `${name}-${Math.random().toString(36).slice(2, 7)}`

/** The directory's API user and its client, made once for the suite's server. */
async function directoryToken(page: Page): Promise<string> {
  const token = () =>
    page.request.post(`${API}/security/back-office/token`, {
      form: {
        grant_type: 'client_credentials',
        client_id: MEMBER_DIRECTORY.id,
        client_secret: MEMBER_DIRECTORY.secret,
      },
    })
  let granted = await token()
  if (!granted.ok()) {
    const groups = await (await page.request.get(`${API}/user-group?skip=0&take=100`)).json()
    const admin = groups.items.find((g: { alias: string }) => g.alias === 'admin')
    const made = await page.request.post(`${API}/user`, {
      data: {
        kind: 'Api',
        email: 'member-directory@example.test',
        userName: 'member-directory@example.test',
        name: 'Staff directory',
        userGroupIds: [{ id: admin.id }],
      },
    })
    expect(made.status()).toBe(201)
    const key = made.headers()['umb-generated-resource'] as string
    const credential = await page.request.post(`${API}/user/${key}/client-credentials`, {
      data: { clientId: MEMBER_DIRECTORY.id, clientSecret: MEMBER_DIRECTORY.secret },
    })
    expect(credential.status()).toBe(200)
    granted = await token()
  }
  return ((await granted.json()) as { access_token: string }).access_token
}

async function createMember(request: APIRequestContext, name: string, bearer?: string) {
  const types = await (await request.get(`${API}/tree/member-type/root?skip=0&take=10`)).json()
  const response = await request.post(`${API}/member`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    data: {
      memberType: { id: types.items[0].id },
      email: `${name}@example.test`,
      username: name,
      password: 'correct-horse-battery',
      isApproved: true,
      groups: [],
      values: [],
      variants: [{ culture: null, segment: null, name }],
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  return response.headers()['umb-generated-resource'] as string
}

test('a member a directory keeps is read-only with who keeps them; the site’s own keeps Save', async ({
  page,
}) => {
  await signIn(page)
  const kept = unique('kept')
  const own = unique('own')
  const keptKey = await createMember(page.request, kept, await directoryToken(page))
  const ownKey = await createMember(page.request, own)

  await page.goto('/crombolo/section/member-management')
  await settle(page)
  await page
    .locator('umb-section-sidebar')
    .getByRole('link', { name: 'Members', exact: true })
    .click()
  const list = page.locator('crombolo-member-table')
  await expect(list.getByRole('link', { name: kept })).toBeVisible()
  const keptRow = list.locator('uui-table-row', { hasText: kept })
  await expect(keptRow.locator('[data-mark="member-managed"]')).toHaveText('Kept by a directory')
  const ownRow = list.locator('uui-table-row', { hasText: own })
  await expect(ownRow.locator('[data-mark="member-managed"]')).toHaveCount(0)

  await page.goto(`/crombolo/section/member-management/workspace/member/edit/${keptKey}`)
  await settle(page)
  await expect(page.locator('crombolo-member-managed-line')).toHaveText(
    'Kept by Staff directory: changes are made there.',
  )
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  await page.goto(`/crombolo/section/member-management/workspace/member/edit/${ownKey}`)
  await settle(page)
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await expect(page.locator('crombolo-member-managed-line')).toHaveText('')
})
