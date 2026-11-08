/**
 * The Forms section's designer and a page's Form picker, against the real backoffice.
 */
import { expect, signIn, test } from './fixtures.ts'

const FORMS_API = '/crombolo/crombolo/api/forms'
const API = '/crombolo/management/api/v1'
const CONTACT = '7b1f4c20-9a63-4e18-8d25-3c6f5a1e9b04'

test('a page picks a Library form, keeps a form it named itself, and reveals the fields', async ({
  page,
  diagnostics,
}) => {
  await signIn(page)
  const types = await (
    await page.request.get(`${API}/document-type/allowed-at-root?take=100`)
  ).json()
  const type = types.items.find((item: { name: string }) => item.name === 'Contact form test')
  // A page saved before Library forms (story 239) names the form itself.
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

  // A Library form of the same form, made from the type the form gives the Library.
  const inLibrary = await (
    await page.request.get(`${API}/document-type/allowed-in-library?skip=0&take=100`)
  ).json()
  const formType = inLibrary.items.find(
    (item: { name: string }) => item.name === 'Write to the cove',
  )
  expect(formType).toBeDefined()
  const element = await page.request.post(`${API}/element`, {
    data: {
      documentType: { id: formType.id },
      parent: null,
      values: [{ alias: 'heading', culture: null, segment: null, value: 'Trade enquiries' }],
      variants: [{ culture: null, segment: null, name: 'Cove – Trade' }],
    },
  })
  expect(element.status()).toBe(201)
  const trade = element.headers()['umb-generated-resource'] as string
  expect(
    (
      await page.request.put(`${API}/element/${trade}/publish`, { data: { cultures: [] } })
    ).status(),
  ).toBe(200)

  const url = `/crombolo/section/content/workspace/document/edit/${key}`
  await page.goto(url)
  const picker = page.locator('crombolo-form-picker')
  const select = picker.getByRole('combobox', { name: 'Form', exact: true })
  await expect(select).toHaveValue(CONTACT)
  // Grouped choices come first in the select, and No form after them.
  for (const choice of ['No form', 'Cove – Trade', "Write to the cove (the form's own words)"])
    await expect(select).toContainText(choice)
  await expect(picker).toContainText('7 fields over 1 page')

  await select.selectOption({ label: 'Cove – Trade' })
  await picker.getByText('View form fields', { exact: true }).click()
  const preview = picker.locator('details')
  await expect(preview.locator('.fields > li')).toHaveCount(7)
  for (const caption of ['Name', 'Email', 'Subject', 'Company', 'Phone', 'Message'])
    await expect(preview.getByText(caption, { exact: true })).toBeVisible()
  await expect(preview).toContainText('Trade and allocation')
  await expect(preview).toContainText('Required')
  // A save clicked while the page is still settling is ignored, so it is clicked until it lands.
  await expect(async () => {
    await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
    const doc = await (await page.request.get(`${API}/document/${key}`)).json()
    expect(
      doc.values.find((value: { alias: string }) => value.alias === 'enquiryForm')?.value,
    ).toBe(trade)
  }).toPass({ timeout: 15_000 })

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
  await select.selectOption({ label: 'Cove – Trade' })
  // A save clicked while the one before is under way is ignored, so it is clicked until it lands.
  await expect(async () => {
    await page.getByTestId('workspace-action:Umb.WorkspaceAction.Document.Save').click()
    const doc = await (await page.request.get(`${API}/document/${key}`)).json()
    expect(
      doc.values.find((value: { alias: string }) => value.alias === 'enquiryForm')?.value,
    ).toBe(trade)
  }).toPass({ timeout: 15_000 })

  diagnostics.allowed.push(`503 GET ${FORMS_API}/${CONTACT}`, 'status of 503 (Service Unavailable)')
  await page.route(`${FORMS_API}/${CONTACT}`, (route) => route.fulfill({ status: 503, json: {} }))
  await page.goto(url)
  await picker.getByText('View form fields', { exact: true }).click()
  await expect(picker.getByRole('alert')).toHaveText('The form fields could not be loaded.')
  await page.unroute(`${FORMS_API}/${CONTACT}`)
  await picker.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(picker.locator('.fields > li')).toHaveCount(7)

  // A choice removed after the page was saved remains visible until deliberately cleared.
  await page.route(FORMS_API, (route) => route.fulfill({ json: { items: [] } }))
  await page.route(`${FORMS_API}/library-forms`, (route) => route.fulfill({ json: { items: [] } }))
  await page.goto(url)
  await expect(select).toHaveValue(trade)
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

  // The section opens on its list of forms.
  await page.goto('/crombolo/section/forms')
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

test('typing # offers dictionary items, chosen as a chip, and a field keeps its help and messages', async ({
  page,
}) => {
  await signIn(page)
  const name = `form.word.${crypto.randomUUID().slice(0, 6)}`
  const made = await page.request.post(`${API}/dictionary`, {
    data: { name, parent: null, translations: [{ isoCode: 'en-US', translation: 'Your name' }] },
  })
  expect(made.status()).toBe(201)

  await page.goto(`/crombolo/section/forms/view/forms?form=${CONTACT}`)
  const caption = page.locator('crombolo-form-word-input[label="Caption"]').first()
  const input = caption.locator('input')
  await input.fill('#form.word')
  await expect(caption.getByRole('option').first()).toBeVisible()
  await input.press('Enter')
  // Chosen, it is {#key}, shown as a chip with the item's words (story 297).
  const chip = caption.locator('crombolo-dictionary-chip')
  await expect(chip.getByRole('button', { name: 'Your name' })).toBeVisible()
  await expect(caption.getByRole('option')).toHaveCount(0)

  await page.getByText('Help and messages', { exact: true }).first().click()
  const help = page.locator('crombolo-form-word-input[label="Help text"]').first().locator('input')
  await help.fill('Who should we ask for?')
  await help.blur()
  await expect(help).toHaveValue('Who should we ask for?')
})
