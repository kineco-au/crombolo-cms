/**
 * Story 444 in the real back office: on a site whose members the suite's server holds,
 * the Members section says where they are kept, lists them, and saves a change there; a
 * member group renamed from it warns how many pages' rules name the group first.
 */
import type { APIRequestContext, Page } from '@playwright/test'
import {
  BROWSER_ADMIN,
  CONTENT_SITE_URL,
  expect,
  MEMBERS_CONTENT_SITE,
  settle,
  signIn,
  test,
} from './fixtures.ts'

const API = '/umbraco/management/api/v1'
const unique = (name: string) => `${name}-${Math.random().toString(36).slice(2, 7)}`

/** The content site's service account on the suite's server, made once. */
async function contentSiteAccount(page: Page): Promise<void> {
  const token = await page.request.post(`${API}/security/back-office/token`, {
    form: {
      grant_type: 'client_credentials',
      client_id: MEMBERS_CONTENT_SITE.id,
      client_secret: MEMBERS_CONTENT_SITE.secret,
    },
  })
  if (token.ok()) return
  const groups = await (await page.request.get(`${API}/user-group?skip=0&take=100`)).json()
  const admin = groups.items.find((g: { alias: string }) => g.alias === 'admin')
  const made = await page.request.post(`${API}/user`, {
    data: {
      kind: 'Api',
      email: 'content-site@example.test',
      userName: 'content-site@example.test',
      name: 'Content site',
      userGroupIds: [{ id: admin.id }],
    },
  })
  expect(made.status()).toBe(201)
  const key = made.headers()['umb-generated-resource'] as string
  const credential = await page.request.post(`${API}/user/${key}/client-credentials`, {
    data: { clientId: MEMBERS_CONTENT_SITE.id, clientSecret: MEMBERS_CONTENT_SITE.secret },
  })
  expect(credential.status()).toBe(200)
}

async function createMember(request: APIRequestContext, name: string) {
  const types = await (await request.get(`${API}/tree/member-type/root?skip=0&take=10`)).json()
  const response = await request.post(`${API}/member`, {
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

/**
 * A Management API call to the content site from its own page. Its sign-in cookies are
 * Secure, which Chromium keeps for http://127.0.0.1 and Playwright's request API does not send.
 */
async function onContentSite(page: Page, method: string, path: string, data?: unknown) {
  return page.evaluate(
    async ({ method, url, data }) => {
      const response = await fetch(url, {
        method,
        headers: data === undefined ? {} : { 'content-type': 'application/json' },
        body: data === undefined ? undefined : JSON.stringify(data),
      })
      return {
        status: response.status,
        made: response.headers.get('umb-generated-resource'),
        text: await response.text(),
      }
    },
    { method, url: `${CONTENT_SITE_URL}${API}${path}`, data },
  )
}

/** Signed in to the content site, whose cookies are its own. */
async function signInToContentSite(page: Page) {
  await page.goto(`${CONTENT_SITE_URL}/crombolo`)
  await page.locator('input[name="username"]').fill(BROWSER_ADMIN.login)
  await page.locator('input[name="password"]').fill(BROWSER_ADMIN.password)
  await page.getByRole('button', { name: /^(Login|Sign in)$/ }).click()
  await expect(page.locator('umb-backoffice-header')).toBeVisible({ timeout: 30_000 })
  await settle(page)
}

test('the Members section lists and changes the members another site holds', async ({ page }) => {
  await signIn(page)
  await contentSiteAccount(page)
  const name = unique('held')
  const key = await createMember(page.request, name)

  await signInToContentSite(page)
  await page.goto(`${CONTENT_SITE_URL}/crombolo/section/member-management`)
  await settle(page)
  await expect(page.locator('[data-mark="members-source"]')).toContainText(
    'Members are kept at http://localhost:',
  )
  await page
    .locator('umb-section-sidebar')
    .getByRole('link', { name: 'Members', exact: true })
    .click()
  await expect(page.locator('crombolo-member-table').getByRole('link', { name })).toBeVisible()

  await page.goto(
    `${CONTENT_SITE_URL}/crombolo/section/member-management/workspace/member/edit/${key}`,
  )
  await settle(page)
  await page.getByRole('textbox', { name: 'Enter a name...' }).fill(`${name} renamed`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await settle(page)
  await expect
    .poll(async () => {
      const there = await (await page.request.get(`${API}/member/${key}`)).json()
      return there.variants[0].name
    })
    .toBe(`${name} renamed`)
})

test('renaming a member group warns how many pages’ rules name it, then renames it there', async ({
  page,
}) => {
  await signIn(page)
  await contentSiteAccount(page)
  const groupName = unique('Gold')
  const made = await page.request.post(`${API}/member-group`, { data: { name: groupName } })
  expect(made.status()).toBe(201)
  const group = made.headers()['umb-generated-resource'] as string

  await signInToContentSite(page)
  const types = JSON.parse(
    (await onContentSite(page, 'GET', '/document-type/allowed-at-root?skip=0&take=10')).text,
  )
  const created = await onContentSite(page, 'POST', '/document', {
    documentType: { id: types.items[0].id },
    template: null,
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: unique('Members only') }],
  })
  expect(created.status, created.text).toBe(201)
  const pageKey = created.made as string
  const rule = await onContentSite(page, 'POST', `/document/${pageKey}/public-access`, {
    memberUserNames: [],
    memberGroupNames: [groupName],
    loginDocument: { id: pageKey },
    errorDocument: { id: pageKey },
  })
  expect(rule.status, rule.text).toBe(201)

  await page.goto(
    `${CONTENT_SITE_URL}/crombolo/section/member-management/workspace/member-group/edit/${group}`,
  )
  await settle(page)
  await page.locator('umb-workspace-header-name-editable uui-input input').fill(`${groupName} plus`)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  const warning = page.locator('umb-confirm-modal')
  await expect(warning).toContainText(`1 page here has a rule naming "${groupName}"`)
  await warning.getByRole('button', { name: 'Rename anyway' }).click()
  await settle(page)
  await expect
    .poll(async () => (await (await page.request.get(`${API}/member-group/${group}`)).json()).name)
    .toBe(`${groupName} plus`)
  const rewritten = JSON.parse(
    (await onContentSite(page, 'GET', `/document/${pageKey}/public-access`)).text,
  )
  expect(rewritten.groups.map((g: { name: string }) => g.name)).toEqual([`${groupName} plus`])
})
