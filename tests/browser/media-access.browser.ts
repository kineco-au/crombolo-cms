import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS, SYSTEM_MEMBER_TYPE_KEY } from '@crombolo/core'
import type { Page } from '@playwright/test'
import { expect, signIn, test } from './fixtures.ts'

const API = '/crombolo/management/api/v1'
const ACCESS = '/crombolo/crombolo/api/media-access'

/** Opens the Permissions dialog from the workspace's actions, retrying while the menu settles. */
async function openPermissions(page: Page) {
  await expect(async () => {
    await page.getByRole('button', { name: 'Actions', exact: true }).click({ timeout: 2_000 })
    await page
      .getByText('Permissions', { exact: true })
      .filter({ visible: true })
      .click({ timeout: 2_000 })
    await expect(page.locator('crombolo-media-access-modal')).toHaveCount(1, { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

test('Public Access inherits for child files and persists overrides for root files, child files and folders', async ({
  page,
}) => {
  await signIn(page)
  // Names of their own, so a retry against the same database can create them again.
  const run = crypto.randomUUID().slice(0, 8)
  const readers = `Media readers ${run}`
  const reader = `Media reader ${run}`
  const group = await page.request.post(`${API}/member-group`, { data: { name: readers } })
  expect(group.status()).toBe(201)
  const member = await page.request.post(`${API}/member`, {
    data: {
      memberType: { id: SYSTEM_MEMBER_TYPE_KEY },
      isApproved: true,
      values: [],
      username: `media-reader-${run}`,
      email: `media-reader-${run}@example.test`,
      password: 'correct-horse-battery',
      variants: [{ culture: null, segment: null, name: reader }],
    },
  })
  expect(member.status()).toBe(201)
  const memberKey = member.headers()['umb-generated-resource']
  const folder = await page.request.post(`${API}/media`, {
    data: {
      mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Permission folder' }],
    },
  })
  expect(folder.status()).toBe(201)
  const parent = folder.headers()['umb-generated-resource']
  for (const at of [null, parent]) {
    const id = crypto.randomUUID()
    const upload = await page.request.post(`${API}/temporary-file`, {
      multipart: {
        Id: id,
        File: {
          name: 'photo.png',
          mimeType: 'image/png',
          buffer: readFileSync(join(process.cwd(), 'tests/fixtures/pixel.png')),
        },
      },
    })
    expect(upload.status()).toBe(201)
    const created = await page.request.post(`${API}/media`, {
      data: {
        mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Image },
        parent: at ? { id: at } : null,
        values: [
          {
            alias: 'umbracoFile',
            culture: null,
            segment: null,
            value: { src: '', temporaryFileId: id, crops: [], focalPoint: null },
          },
        ],
        variants: [{ culture: null, segment: null, name: at ? 'Child photo' : 'Root photo' }],
      },
    })
    expect(created.status()).toBe(201)
    const key = created.headers()['umb-generated-resource']
    await page.goto(`/crombolo/section/media/workspace/media/edit/${key}`)
    await expect(page.getByRole('textbox', { name: 'Enter a name...' })).toHaveValue(
      at ? 'Child photo' : 'Root photo',
    )
    await openPermissions(page)
    const modal = page.locator('crombolo-media-access-modal')
    const box = modal.locator('uui-box[headline="Public Access"]')
    await expect(box).toHaveCount(1)
    const read = modal.getByRole('radiogroup', { name: 'Read', exact: true })
    const write = modal.getByRole('radiogroup', { name: 'Write', exact: true })
    const inherit = modal.getByRole('checkbox', { name: 'Inherit parent permissions' })
    await expect(read.getByRole('radio')).toHaveCount(3)
    await expect(write.getByRole('radio')).toHaveCount(2)
    await expect(read.getByRole('radio', { name: 'Enabled', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(
      write.getByRole('radio', { name: 'No Public Access', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    if (at) {
      await expect(inherit).toBeChecked()
      await expect(modal.locator('.summary')).toContainText('Default permissions.')
      await inherit.uncheck()
    } else await expect(inherit).toHaveCount(0)
    await read.getByRole('radio', { name: 'Custom', exact: true }).click()
    const readSection = modal.getByRole('region', { name: 'Read', exact: true })
    await readSection.getByRole('checkbox', { name: readers, exact: true }).check()
    await write.getByRole('radio', { name: 'Custom', exact: true }).click()
    const writeSection = modal.getByRole('region', { name: 'Write', exact: true })
    await writeSection
      .locator('umb-input-member')
      .getByRole('button', { name: 'Choose', exact: true })
      .click()
    const picker = page.locator('umb-member-picker-modal')
    await picker.locator(`uui-menu-item[label="${reader}"]`).click()
    await picker.getByRole('button', { name: 'Choose', exact: true }).click()
    await expect(writeSection.locator('umb-input-member')).toContainText(reader)
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(modal).toHaveCount(0)
    const custom = await (await page.request.get(`${ACCESS}/${key}`)).json()
    expect(custom.hasParent).toBe(Boolean(at))
    expect(custom.item).toMatchObject({ readPolicy: 'inherit', writePolicy: 'inherit' })
    expect(custom.own.groups).toContainEqual({ name: readers, read: true, write: false })
    expect(custom.own.members).toEqual([{ key: memberKey, read: false, write: true }])
    await openPermissions(page)
    await expect(read.getByRole('radio', { name: 'Custom', exact: true })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(writeSection.locator('umb-input-member')).toContainText(reader)
    if (at) {
      await expect(inherit).not.toBeChecked()
      await expect(modal.locator('.summary')).toContainText('Set for this item.')
    }
    await read.getByRole('radio', { name: 'Disabled', exact: true }).click()
    await write.getByRole('radio', { name: 'No Public Access', exact: true }).click()
    await modal.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(modal).toHaveCount(0)
    const privateAccess = await (await page.request.get(`${ACCESS}/${key}`)).json()
    expect(privateAccess.own).toMatchObject({ publicRead: false, groups: [] })
    if (at) {
      await openPermissions(page)
      await inherit.check()
      await modal.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(modal).toHaveCount(0)
      const inherited = await (await page.request.get(`${ACCESS}/${key}`)).json()
      expect(inherited.own).toBeNull()
    }
  }
  await page.goto(`/crombolo/section/media/workspace/media/edit/${parent}`)
  await expect(page.getByRole('textbox', { name: 'Enter a name...' })).toHaveValue(
    'Permission folder',
  )
  await openPermissions(page)
  const modal = page.locator('crombolo-media-access-modal')
  await expect(modal.getByRole('checkbox', { name: 'Inherit parent permissions' })).toHaveCount(0)
  for (const action of ['Read', 'Write']) {
    await modal
      .getByRole('radiogroup', { name: action, exact: true })
      .getByRole('radio', { name: 'Custom', exact: true })
      .click()
    await modal
      .getByRole('region', { name: action, exact: true })
      .getByRole('checkbox', { name: readers, exact: true })
      .check()
  }
  await modal.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(modal).toHaveCount(0)
  const folderAccess = await (await page.request.get(`${ACCESS}/${parent}`)).json()
  expect(folderAccess.own).toMatchObject({
    publicRead: false,
    newRead: null,
    newWrite: null,
    groups: [{ name: readers, read: true, write: true }],
  })
})
