/**
 * Story 026's exit in the real backoffice: an administrator creates a user in the
 * Users section and puts them in a group restricted to one branch without the
 * Delete verb; signed in, that editor sees only their start node and is not
 * offered Delete. Plus the Translation section's dictionary.
 */
import type { Page } from '@playwright/test'
import { expect, goToSection, signIn, test } from './fixtures.ts'

const API = '/umbraco/management/api/v1'
const unique = (name: string) => `${name} ${Math.random().toString(36).slice(2, 7)}`

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API}${path}`)
  expect(response.status(), path).toBe(200)
  return (await response.json()) as T
}

async function createPage(page: Page, name: string, parent: string | null = null) {
  const types = await api<{ items: Array<{ id: string; name: string }> }>(
    page,
    '/document-type/allowed-at-root?skip=0&take=10',
  )
  const type = types.items.find((t) => t.name === 'Home Page') as { id: string }
  const response = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: type.id },
      parent: parent ? { id: parent } : null,
      values: [{ alias: 'title', culture: null, segment: null, value: name }],
      variants: [{ culture: null, segment: null, name }],
    },
  })
  expect(response.status()).toBe(201)
  return response.headers()['umb-generated-resource'] as string
}

test('a user created in the Users section, restricted to one branch, sees only it and cannot delete', async ({
  page,
  browser,
  diagnostics,
}) => {
  const SITE = unique('Site')
  const BRANCH = unique('Branch')
  const OTHER = unique('Other')
  const GROUP = unique('Branch editors')
  const email = `${Math.random().toString(36).slice(2, 9)}@example.com`

  await signIn(page)
  const site = await createPage(page, SITE)
  const branch = await createPage(page, BRANCH, site)
  await createPage(page, OTHER)
  const group = await page.request.post(`${API}/user-group`, {
    data: {
      name: GROUP,
      alias: GROUP.replace(/\W/g, ''),
      sections: ['Umb.Section.Content'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: false,
      documentStartNode: { id: branch },
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: [
        'Umb.Document.Read',
        'Umb.Document.Create',
        'Umb.Document.Update',
        'Umb.Document.Publish',
      ],
      permissions: [],
    },
  })
  expect(group.status()).toBe(201)

  // The Users section: create the user through its dialog
  await goToSection(page, 'Users')
  await page
    .locator('umb-section-sidebar')
    .getByRole('link', { name: 'Users', exact: true })
    .click()
  await expect(page.locator('umb-user-collection')).toBeVisible()
  await page.getByRole('button', { name: 'Create', exact: true }).first().click()
  await page
    .getByText(/^User(\.\.\.|…)$/)
    .filter({ visible: true })
    .first()
    .click()
  const dialog = page.locator('umb-create-user-modal')
  await dialog.locator('#name input').fill('Branch Editor')
  await dialog.locator('#email input').fill(email)
  await dialog
    .locator('#userGroups')
    .getByRole('button', { name: /Choose|Add/ })
    .first()
    .click()
  await page
    .locator('uui-modal-sidebar')
    .last()
    .locator('umb-user-group-ref')
    .filter({ hasText: GROUP })
    .click()
  await page
    .locator('uui-modal-sidebar')
    .last()
    .getByRole('button', { name: /Choose|Submit/ })
    .click()
  await dialog.getByRole('button', { name: 'Create user' }).click()

  // The success dialog shows the initial password once
  const success = page.locator('umb-create-user-success-modal')
  await expect(success).toBeVisible()
  const password = page.locator('umb-create-user-success-modal uui-input-password#password')
  await expect
    .poll(async () => (await password.evaluate((el) => (el as HTMLInputElement).value)) ?? '')
    .not.toBe('')
  const initial = (await password.evaluate((el) => (el as HTMLInputElement).value)) as string
  await success.getByRole('button', { name: 'Close' }).click()

  // The group opens in its workspace, with its start node and verbs, and saves unchanged
  await page
    .locator('umb-section-sidebar')
    .getByRole('link', { name: 'User Groups', exact: true })
    .click()
  await page.getByRole('link', { name: GROUP, exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Enter alias...' })).toHaveValue(
    GROUP.replace(/\W/g, ''),
  )
  await expect(page.getByText(BRANCH).first()).toBeVisible()
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/user-group\/[0-9a-f-]{36}$/.test(r.url()),
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await saved).status()).toBe(200)
  const after = await api<{
    documentStartNode: { id: string } | null
    fallbackPermissions: string[]
  }>(page, `/user-group/${group.headers()['umb-generated-resource']}`)
  expect(after.documentStartNode).toEqual({ id: branch })
  expect(after.fallbackPermissions).not.toContain('Umb.Document.Delete')

  // The new editor, in their own browser session
  const context = await browser.newContext()
  const editor = await context.newPage()
  diagnostics.attach(editor)
  await signIn(editor, { login: email, password: initial })
  await goToSection(editor, 'Content')
  const tree = editor.locator('umb-tree').first()
  // The way to their start node is shown, greyed out; the rest of the site is not
  const siteItem = tree.locator('umb-tree-item').filter({ hasText: SITE }).first()
  await expect(siteItem).toBeVisible()
  await expect(tree.locator('umb-tree-item').filter({ hasText: OTHER })).toHaveCount(0)
  await expect(tree.getByRole('link', { name: SITE, exact: true })).toHaveCount(0)
  // Content opens the first page they may open, not the page above it (story 288).
  await expect(editor).toHaveURL(new RegExp(`/workspace/document/edit/${branch}`))
  await expect(tree.getByRole('link', { name: BRANCH, exact: true })).toBeVisible()

  // Their menu on the start node offers Create, never Delete
  await expect(async () => {
    await editor
      .getByRole('link', { name: BRANCH, exact: true })
      .filter({ visible: true })
      .last()
      .hover()
    await editor
      .getByRole('button', { name: `View actions for '${BRANCH}'` })
      .filter({ visible: true })
      .last()
      .click({ force: true, timeout: 2_000 })
    await expect(
      editor
        .getByTestId('entity-action:Umb.EntityAction.Document.Create')
        .filter({ visible: true }),
    ).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 15_000 })
  await expect(
    editor.getByTestId('entity-action:Umb.EntityAction.Document.RecycleBin.Trash'),
  ).toHaveCount(0)
  await expect(editor.getByTestId('entity-action:Umb.EntityAction.Document.Delete')).toHaveCount(0)
  // And the server agrees
  expect(
    (
      await editor.request.put(`${API}/document/${branch}/move-to-recycle-bin`, { data: {} })
    ).status(),
  ).toBe(403)
  await context.close()
})

test("a group's owners choose who is in it, and only an administrator changes it (story 302)", async ({
  page,
  browser,
  diagnostics,
}) => {
  const LEADS = unique('Leads')
  const TEAM = unique('Team')
  const email = `${Math.random().toString(36).slice(2, 9)}@example.com`
  await signIn(page)
  const group = async (name: string, extra: Record<string, unknown> = {}) => {
    const response = await page.request.post(`${API}/user-group`, {
      data: {
        name,
        alias: name.replace(/\W/g, ''),
        sections: ['Umb.Section.Users', 'Umb.Section.Content'],
        languages: [],
        hasAccessToAllLanguages: true,
        documentRootAccess: true,
        documentStartNode: null,
        mediaRootAccess: true,
        mediaStartNode: null,
        elementRootAccess: false,
        elementStartNode: null,
        fallbackPermissions: ['Umb.Document.Read'],
        permissions: [],
        ...extra,
      },
    })
    expect(response.status()).toBe(201)
    return response.headers()['umb-generated-resource'] as string
  }
  const leads = await group(LEADS)
  await group(TEAM, { owners: [{ id: leads }] })
  const created = await page.request.post(`${API}/user`, {
    data: { kind: 'Default', email, userName: email, name: 'Lead', userGroupIds: [{ id: leads }] },
  })
  expect(created.status()).toBe(201)
  const reset = await page.request.post(
    `${API}/user/${created.headers()['umb-generated-resource']}/reset-password`,
  )
  const { resetPassword } = (await reset.json()) as { resetPassword: string }

  // The administrator sees the owners on the group's screen, and may save it
  await goToSection(page, 'Users')
  await page
    .locator('umb-section-sidebar')
    .getByRole('link', { name: 'User Groups', exact: true })
    .click()
  await page.getByRole('link', { name: TEAM, exact: true }).click()
  // Story 338: owners and members are on the editor's People tab
  await page.getByRole('tab', { name: 'People' }).click()
  await expect(page.getByText('Owners can manage group members')).toBeVisible()
  await expect(page.locator('umb-user-group-ref').filter({ hasText: LEADS })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()

  // The lead, in their own session: the group is theirs to fill, not to change
  const context = await browser.newContext()
  const lead = await context.newPage()
  diagnostics.attach(lead)
  await signIn(lead, { login: email, password: resetPassword })
  await goToSection(lead, 'Users')
  await lead
    .locator('umb-section-sidebar')
    .getByRole('link', { name: 'User Groups', exact: true })
    .click()
  await expect(lead.getByRole('link', { name: LEADS, exact: true })).toHaveCount(0)
  await lead.getByRole('link', { name: TEAM, exact: true }).click()
  await expect(
    lead.getByText(
      "Only an administrator can change what this group allows. You can choose who's in it.",
    ),
  ).toBeVisible()
  await expect(lead.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  // Data Transfer is an administrator's; the rest are there to read
  await expect(lead.getByRole('tab', { name: 'Data Transfer' })).toHaveCount(0)
  await lead.getByRole('tab', { name: 'People' }).click()
  const people = lead.locator('umb-user-group-workspace-users')
  await expect(people).not.toHaveAttribute('readonly', '')
  await expect(
    lead.locator('umb-user-group-input[readonly]').getByRole('button', { name: 'Choose' }),
  ).toHaveCount(0)
  await context.close()
})

test('a group is set up in levels, and its exceptions read as sentences (story 338)', async ({
  page,
}) => {
  const NAME = unique('Reviewers')
  const SITE = unique('Site')
  await signIn(page)
  const site = await createPage(page, SITE)
  const response = await page.request.post(`${API}/user-group`, {
    data: {
      name: NAME,
      alias: NAME.replace(/\W/g, ''),
      sections: ['Umb.Section.Content'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: true,
      documentStartNode: null,
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: [
        'Umb.Document.Read',
        'Umb.Document.Create',
        'Umb.Document.Update',
        'Umb.Document.Move',
        'Umb.Document.Duplicate',
        'Umb.Document.Sort',
        'Umb.Document.PropertyValue.Write',
      ],
      permissions: [
        {
          $type: 'DocumentPermissionPresentationModel',
          document: { id: site },
          verbs: ['Umb.Document.Read'],
        },
      ],
    },
  })
  expect(response.status()).toBe(201)
  const id = response.headers()['umb-generated-resource'] as string

  await goToSection(page, 'Users')
  await page
    .locator('umb-section-sidebar')
    .getByRole('link', { name: 'User Groups', exact: true })
    .click()
  await page.getByRole('link', { name: NAME, exact: true }).click()

  // Access: Content is on, Media is off and says nothing more
  const editor = page.locator('crombolo-group-editor')
  await expect(editor.getByRole('switch', { name: 'Content: on' })).toBeVisible()
  await expect(editor.getByRole('switch', { name: 'Media: off' })).toBeVisible()

  // Permissions: the stored verbs read as Edit; Media is greyed with its access off
  await editor.getByRole('tab', { name: 'Permissions' }).click()
  await expect(
    editor.getByRole('radio', { name: /^Edit Write and organise drafts/ }).first(),
  ).toBeChecked()
  await expect(editor.getByText('Access is off').first()).toBeVisible()
  await editor
    .getByRole('radio', { name: /^Edit and publish/ })
    .first()
    .check()

  // Exceptions: the page set to See reads as a sentence
  await editor.getByRole('tab', { name: /Exceptions/ }).click()
  await expect(editor.getByText(SITE)).toBeVisible()
  await expect(editor.getByText('Pages: See, instead of Edit and publish')).toBeVisible()

  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().endsWith(`/user-group/${id}`),
  )
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await saved).status()).toBe(200)
  const after = await api<{ fallbackPermissions: string[]; permissions: unknown[] }>(
    page,
    `/user-group/${id}`,
  )
  expect(after.fallbackPermissions).toEqual(
    expect.arrayContaining([
      'Umb.Document.Publish',
      'Umb.Document.Unpublish',
      'Umb.Document.Rollback',
    ]),
  )
  expect(after.fallbackPermissions).not.toContain('Umb.Document.Delete')
  expect(after.permissions).toHaveLength(1)
})

test('the Translation section: a dictionary item opens from its tree and saves its translation', async ({
  page,
}) => {
  const KEY = unique('Greeting').replace(' ', '.')
  await signIn(page)
  await goToSection(page, 'Translation')
  await expect(page.locator('umb-section-sidebar')).toBeVisible()
  const response = await page.request.post(`${API}/dictionary`, {
    data: { name: KEY, parent: null, translations: [{ isoCode: 'en-US', translation: 'Hello' }] },
  })
  expect(response.status()).toBe(201)
  const key = response.headers()['umb-generated-resource'] as string
  await page.reload()
  const item = page.locator('umb-section-sidebar').getByRole('link', { name: KEY, exact: true })
  await expect(item).toBeVisible()
  await item.click()
  const translation = page
    .locator('umb-workspace-view-dictionary-editor uui-textarea textarea')
    .first()
  await expect(translation).toHaveValue('Hello')
  await translation.fill('Hello there')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await api<{ translations: Array<{ translation: string }> }>(page, `/dictionary/${key}`))
          .translations[0]?.translation,
    )
    .toBe('Hello there')
})
