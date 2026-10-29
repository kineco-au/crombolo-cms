/**
 * The Forms section's designer, against the real backoffice.
 */
import { expect, signIn, test } from './fixtures.ts'

const FORMS_API = '/crombolo/crombolo/api/forms'
const API = '/crombolo/management/api/v1'
const CONTACT = '7b1f4c20-9a63-4e18-8d25-3c6f5a1e9b04'

test('a page shows its saved form, offers choices, and reveals the Harbourstone fields', async ({
  page,
  diagnostics,
}) => {
  await signIn(page)
  const types = await (
    await page.request.get(`${API}/document-type/allowed-at-root?take=100`)
  ).json()
  const type = types.items.find((item: { name: string }) => item.name === 'Contact form test')
  const made = await page.request.post(`${API}/document`, {
    data: {
      documentType: { id: type.id },
      template: null,
      parent: null,
      values: [{ alias: 'enquiryForm', culture: null, segment: null, value: CONTACT }],
      variants: [{ culture: null, segment: null, name: 'Contact form picker' }],
    },
  })
  expect(made.status()).toBe(201)
  const key = made.headers()['umb-generated-resource']
  const url = `/crombolo/section/content/workspace/document/edit/${key}`
  await page.goto(url)
  const picker = page.locator('crombolo-form-picker')
  const select = picker.getByRole('combobox', { name: 'Form', exact: true })
  await expect(select).toHaveValue(CONTACT)
  await expect(select.locator('option')).toContainText(['No form', 'Write to the cove'])
  await expect(picker).toContainText('7 fields over 1 page')
  await picker.getByText('View form fields', { exact: true }).click()
  const preview = picker.locator('details')
  await expect(preview.locator('.fields > li')).toHaveCount(7)
  for (const caption of ['Name', 'Email', 'Subject', 'Company', 'Phone', 'Message'])
    await expect(preview.getByText(caption, { exact: true })).toBeVisible()
  await expect(preview).toContainText('Trade and allocation')
  await expect(preview).toContainText('Required')

  await select.selectOption({ label: 'No form' })
  await expect(picker.locator('details')).toHaveCount(0)
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
  await expect
    .poll(async () => {
      const doc = await (await page.request.get(`${API}/document/${key}`)).json()
      return (
        doc.values.find((value: { alias: string }) => value.alias === 'enquiryForm')?.value ?? null
      )
    })
    .toBeNull()

  await select.selectOption(CONTACT)
  await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
  await expect
    .poll(async () => {
      const doc = await (await page.request.get(`${API}/document/${key}`)).json()
      return doc.values.find((value: { alias: string }) => value.alias === 'enquiryForm')?.value
    })
    .toBe(CONTACT)
  await page.goto(url)
  await expect(picker.getByRole('combobox', { name: 'Form', exact: true })).toHaveValue(CONTACT)

  diagnostics.allowed.push(`503 GET ${FORMS_API}/${CONTACT}`, 'status of 503 (Service Unavailable)')
  await page.route(`${FORMS_API}/${CONTACT}`, (route) => route.fulfill({ status: 503, json: {} }))
  await page.goto(url)
  await picker.getByText('View form fields', { exact: true }).click()
  await expect(picker.getByRole('alert')).toHaveText('The form fields could not be loaded.')
  await page.unroute(`${FORMS_API}/${CONTACT}`)
  await picker.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(picker.locator('.fields > li')).toHaveCount(7)

  // A form removed after the page was saved remains visible until deliberately cleared.
  await page.route(FORMS_API, (route) => route.fulfill({ json: { items: [] } }))
  await page.goto(url)
  await expect(select).toHaveValue(CONTACT)
  await expect(picker).toContainText('The selected form is no longer available.')
  await expect(picker.locator('details')).toHaveCount(0)
  await select.selectOption({ label: 'No form' })
  await expect(picker).toContainText('This site has no forms yet.')
})

test('a Send email workflow is given an e-mail design, and saved', async ({
  page,
  diagnostics,
}) => {
  // The refused save below is the server answering 400 with its reasons, by design
  diagnostics.allowed.push(`400 PUT ${FORMS_API}`, 'status of 400 (Bad Request)')
  // Its own form, so a rerun against the same site adds something new
  const alias = `mail${Math.random().toString(36).slice(2, 7)}`
  const key = crypto.randomUUID()
  await signIn(page)
  const created = await page.request.put(FORMS_API, {
    data: {
      key,
      alias,
      name: `Mail ${alias}`,
      storeEntries: true,
      pages: [
        {
          groups: [
            {
              columns: 1,
              fields: [{ alias: 'email', type: 'email', caption: 'Email', values: [], accept: [] }],
            },
          ],
        },
      ],
      workflows: [],
    },
  })
  expect(created.status()).toBe(200)

  // The section opens on Entries; the designer is its Forms view
  await page.goto('/crombolo/section/forms/view/forms')
  await page
    .locator('uui-table-row', { hasText: alias })
    .getByRole('button', { name: 'Edit' })
    .click()
  await page.getByRole('button', { name: 'Add a workflow' }).click()
  const workflow = page.locator('section.workflow')
  await expect(workflow).toHaveCount(1)

  // Saved without a subject first: refused, and the refusal says where in words
  await workflow.getByRole('textbox', { name: 'Send to' }).fill('team@example.com')
  await workflow.getByRole('textbox', { name: 'Send to' }).press('Tab')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('alert')).toContainText('Send an e-mail: Subject')

  await workflow.getByRole('textbox', { name: 'Subject' }).fill('New enquiry from {email}')
  await workflow.getByRole('textbox', { name: 'Subject' }).press('Tab')
  const design = workflow.getByRole('combobox', { name: 'E-mail design' })
  await expect(design.locator('option')).toHaveText(['Standard', 'Receipt'])
  await design.selectOption({ label: 'Receipt' })
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Form saved').first()).toBeVisible()

  const saved = (await (await page.request.get(`${FORMS_API}/${key}`)).json()) as {
    definition: { workflows: { type: string; settings: Record<string, unknown> }[] }
  }
  expect(saved.definition.workflows).toHaveLength(1)
  expect(saved.definition.workflows[0]).toMatchObject({
    type: 'sendEmail',
    settings: {
      to: 'team@example.com',
      subject: 'New enquiry from {email}',
      template: 'emails/receipt',
    },
  })
  await page.request.delete(`${FORMS_API}/${key}`)
})
