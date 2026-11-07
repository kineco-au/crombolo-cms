/**
 * Story 239: forms in the Library. A developer's form gives the Library a type;
 * an editor's element of it is a Library form, whose words a page shows over
 * the form's, whose entries record it, and whose recipients the e-mail uses.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyLibraryForm,
  FORM_LIBRARY_FIELD,
  FORM_RENDERED_FIELD,
  FORM_TOKEN_FIELD,
  libraryFormRecipients,
  libraryFormTypeKey,
  type SchemaForm,
} from '@crombolo/core'
import {
  ComponentRepository,
  ContentTypeRepository,
  ensureFormLibraryTypes,
  FORM_LIBRARY_FOLDER,
  FormEntryRepository,
  FormWorkflowRepository,
  listLibraryForms,
} from '@crombolo/data'
import { loadSchemaDirectory, syncSchema } from '@crombolo/schema'
import { createWorkflowRunner, type EmailMessage, type EmailPort } from '@crombolo/server'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const FORM_KEY = '9c4a7d1e-0239-4b2a-9f31-6d8e2c5a7b40'
const FORMS_API = `${BACKOFFICE}/crombolo/api/forms`

const CONTACT = `[form]
key = "${FORM_KEY}"
alias = "contactUs"
name = "Contact us"
submit-label = "Send"
message-on-submit = "Thanks from the form."

[[page]]

  [[page.group]]

    [[page.group.field]]
    alias = "email"
    type = "email"
    caption = "Email address"
    mandatory = true

[[workflow]]
type = "sendEmail"
name = "Tell the team"
on = "submit"

  [workflow.settings]
  to = "team@example.com"
  subject = "A message"
`

const FEEDBACK = `[form]
alias = "feedback"
name = "Feedback"

[[page]]

  [[page.group]]

    [[page.group.field]]
    alias = "comment"
    type = "shortAnswer"
    caption = "Comment"
`

const PAGE_TYPE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "contactForm"
name = "Contact form"
type = "formPicker"
`

const VIEW = `import { Form } from '@crombolo/crombolo'
export default function Page({ model, submission }) {
  return <main><Form form={model.value('contactForm')} submission={submission} /></main>
}
`

function recordingEmail(): EmailPort & { sent: EmailMessage[] } {
  const port = {
    sent: [] as EmailMessage[],
    description: 'test',
    provider: 'custom' as const,
    async send(message: EmailMessage) {
      port.sent.push(message)
      return { ok: true as const, id: 'test-1' }
    },
  }
  return port
}

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'form-library-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'schema/forms', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TYPE)
  writeFileSync(join(root, 'schema', 'forms', 'contact-us.toml'), CONTACT)
  writeFileSync(join(root, 'schema', 'forms', 'feedback.toml'), FEEDBACK)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
    },
  })
  open.push(h)
  const types = new ContentTypeRepository(h.server.db)
  const libraryType = libraryFormTypeKey(FORM_KEY)

  /** A Library form of Contact us, published unless asked not to be. */
  const libraryForm = async (
    name: string,
    words: Record<string, string>,
    options: { publish?: boolean } = {},
  ) => {
    const created = await h.post(`${V1}/element`, {
      documentType: { id: libraryType },
      parent: null,
      values: Object.entries(words).map(([alias, value]) => ({
        alias,
        culture: null,
        segment: null,
        value,
      })),
      variants: [{ culture: null, segment: null, name }],
    })
    if (created.status !== 201) throw new Error(`create ${created.status}: ${await created.text()}`)
    const key = created.headers.get('umb-generated-resource') as string
    if (options.publish !== false)
      expect((await h.put(`${V1}/element/${key}/publish`, { cultures: [] })).status).toBe(200)
    return key
  }

  /** The home page, picking `value`. */
  const page = async (value: string) => {
    const typeKey = (await types.byAlias('page'))?.key as string
    const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [{ alias: 'contactForm', culture: null, segment: null, value }],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    await h.put(`${V1}/document/${created.headers.get('umb-generated-resource')}/publish`, {
      publishSchedules: [],
    })
  }

  const rendered = async () => {
    const response = await h.server.fetch(new Request(`${ORIGIN}/`))
    expect(response.status).toBe(200)
    const markup = await response.text()
    return {
      markup,
      token: /name="_crombolo_token" value="([^"]+)"/.exec(markup)?.[1] as string,
      at: /name="_crombolo_at" value="([^"]+)"/.exec(markup)?.[1] as string,
      library: /name="_crombolo_library" value="([^"]+)"/.exec(markup)?.[1],
    }
  }

  const post = async (values: Record<string, string>, override: { library?: string } = {}) => {
    const shown = await rendered()
    const body = new FormData()
    for (const [name, value] of Object.entries(values)) body.set(name, value)
    body.set(FORM_TOKEN_FIELD, shown.token)
    body.set(FORM_RENDERED_FIELD, shown.at)
    const library = override.library ?? shown.library
    if (library) body.set(FORM_LIBRARY_FIELD, library)
    return h.server.fetch(
      new Request(`${ORIGIN}/crombolo/forms/${FORM_KEY}`, {
        method: 'POST',
        body,
        headers: { referer: `${ORIGIN}/`, accept: 'application/json' },
      }),
    )
  }

  return { h, root, types, libraryType, libraryForm, page, rendered, post }
}

describe('a Library form’s words over its form', () => {
  const form = {
    key: FORM_KEY,
    alias: 'contactUs',
    name: 'Contact us',
    submitLabel: 'Send',
    messageOnSubmit: 'Thanks from the form.',
    redirectTo: 'page-a',
    storeEntries: true,
    requiresApproval: false,
    honeypot: false,
    pages: [],
    workflows: [],
  } as SchemaForm

  test('each word given replaces the form’s, and an empty one falls back to it', () => {
    const shown = applyLibraryForm(form, 'sales', {
      heading: 'Talk to sales',
      submitLabel: 'Ask us',
      messageOnSubmit: '  ',
      recipients: 'a@example.com; b@example.com',
    })
    expect(shown.submitLabel).toBe('Ask us')
    expect(shown.messageOnSubmit).toBe('Thanks from the form.')
    expect(shown.redirectTo).toBe('page-a')
    expect(shown.library).toEqual({
      key: 'sales',
      heading: 'Talk to sales',
      recipients: ['a@example.com', 'b@example.com'],
    })
    // The form itself is never changed.
    expect(form.submitLabel).toBe('Send')
  })

  test('recipients may be separated by commas, semicolons or lines', () => {
    expect(libraryFormRecipients(' a@x.com,b@x.com\nc@x.com;; ')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ])
    expect(libraryFormRecipients(undefined)).toEqual([])
  })
})

describe('the types made from forms', () => {
  test('each form gives one element type, in the Library and in a Forms folder', async () => {
    const { h, types, libraryType } = await site()
    const type = await types.byKey(libraryType)
    expect(type).toMatchObject({
      alias: 'contactUsForm',
      name: 'Contact us',
      isElement: true,
      allowedInLibrary: true,
      formKey: FORM_KEY,
    })
    expect(type?.properties.map((p) => p.alias)).toEqual([
      'heading',
      'introduction',
      'submitLabel',
      'messageOnSubmit',
      'redirectTo',
      'recipients',
    ])
    // A form with no key is named by its alias.
    expect((await types.byAlias('feedbackForm'))?.formKey).toBe('feedback')
    const folder = await h.json<{ name: string }>(`${V1}/document-type/folder/${type?.parentKey}`)
    expect(folder.name).toBe(FORM_LIBRARY_FOLDER)
    // Forms sit beside content types in Structure, so the tree doesn't show them twice.
    const tree = await h.json<{ total: number; items: Array<{ name: string }> }>(
      `${V1}/tree/document-type/root?skip=0&take=100`,
    )
    expect(tree.items.map((item) => item.name)).not.toContain(FORM_LIBRARY_FOLDER)
    expect(tree.total).toBe(tree.items.length)

    const offered = await h.json<{ items: Array<{ id: string }> }>(
      `${V1}/document-type/allowed-in-library?skip=0&take=100`,
    )
    expect(offered.items.map((item) => item.id)).toContain(libraryType)
  })

  test('are kept in step: a second pass changes nothing, and a renamed form renames its type', async () => {
    const { h, types, libraryType } = await site()
    const forms = [{ key: FORM_KEY, alias: 'contactUs', name: 'Contact us' }]
    const again = await ensureFormLibraryTypes(h.server.db, forms)
    expect(again.created).toEqual([])
    expect(again.updated).toEqual([])
    await ensureFormLibraryTypes(h.server.db, [{ ...forms[0], name: 'Get in touch' } as never])
    expect((await types.byKey(libraryType))?.name).toBe('Get in touch')
  })

  test('cannot be changed or deleted in Settings, only through their form', async () => {
    const { h, libraryType } = await site()
    const type = await h.json<Record<string, unknown>>(`${V1}/document-type/${libraryType}`)
    const saved = await h.put(`${V1}/document-type/${libraryType}`, { ...type, name: 'Other' })
    expect(saved.status).toBe(400)
    expect(await saved.text()).toContain('made from a form')
    expect((await h.del(`${V1}/document-type/${libraryType}`)).status).toBe(400)

    const listed = await h.json<{ items: Array<{ typeKey: string; formName: string }> }>(
      `${FORMS_API}/library-types`,
    )
    expect(listed.items).toContainEqual({ typeKey: libraryType, formName: 'Contact us' })
  })

  test('a removed form’s type goes when unused, and stays while a Library form uses it', async () => {
    const { h, root, types, libraryType, libraryForm } = await site()
    await libraryForm('Contact – Sales', { heading: 'Sales' })
    rmSync(join(root, 'schema', 'forms', 'contact-us.toml'))
    rmSync(join(root, 'schema', 'forms', 'feedback.toml'))
    const report = await ensureFormLibraryTypes(h.server.db, [])
    expect(report.retired).toEqual(['feedbackForm'])
    expect((await types.byKey(libraryType))?.alias).toBe('contactUsForm')
    expect(await types.byAlias('feedbackForm')).toBeUndefined()

    // The schema sync leaves both alone: neither has a file of its own.
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.1"\n')
    const synced = await syncSchema(
      h.server.db,
      loadSchemaDirectory(join(root, 'schema')),
      { nodeId: 'test', version: '1.0.1', revision: '0' },
      { mode: 'development', componentAliases: new Set(['page']) },
    )
    expect(synced.action).toBe('applied')
    expect(synced.retiredTypes).not.toContain('contactUsForm')
  })
})

describe('a Library form on a page', () => {
  test('shows its words over the form, and the form’s own where it gives none', async () => {
    const { libraryForm, page, rendered } = await site()
    const sales = await libraryForm('Contact – Sales', {
      heading: 'Talk to sales',
      introduction: '<p>We reply <strong>within a day</strong>.</p>',
      submitLabel: 'Ask sales',
    })
    await page(sales)
    const { markup, library } = await rendered()
    expect(markup).toContain('<h2 class="crombolo-form__heading">Talk to sales</h2>')
    expect(markup).toContain('<p>We reply <strong>within a day</strong>.</p>')
    expect(markup).toContain('>Ask sales</button>')
    expect(library).toBe(sales)
  })

  test('a page naming the form itself still shows it, in the form’s words', async () => {
    const { page, rendered } = await site()
    await page(FORM_KEY)
    const { markup, library } = await rendered()
    expect(markup).toContain('>Send</button>')
    expect(markup).not.toContain('crombolo-form__heading')
    expect(library).toBeUndefined()
  })

  test('an unpublished Library form shows no form', async () => {
    const { libraryForm, page, rendered } = await site()
    await page(await libraryForm('Draft', { heading: 'Not yet' }, { publish: false }))
    expect((await rendered()).markup).not.toContain('<form')
  })

  test('the picker lists Library forms with the form each is made from', async () => {
    const { h, libraryForm } = await site()
    const sales = await libraryForm('Contact – Sales', {})
    await libraryForm('Contact – Draft', {}, { publish: false })
    const listed = await h.json<{ items: Array<Record<string, unknown>> }>(
      `${FORMS_API}/library-forms`,
    )
    expect(listed.items).toEqual([
      {
        key: expect.any(String),
        name: 'Contact – Draft',
        formKey: FORM_KEY,
        formAlias: 'contactUs',
        formName: 'Contact us',
        published: false,
      },
      {
        key: sales,
        name: 'Contact – Sales',
        formKey: FORM_KEY,
        formAlias: 'contactUs',
        formName: 'Contact us',
        published: true,
      },
    ])
    expect((await listLibraryForms(h.server.db)).map((item) => item.name)).toHaveLength(2)
  })
})

describe('submitting through a Library form', () => {
  test('thanks in its words, records it on the entry and e-mails its recipients', async () => {
    const { h, libraryForm, page, post } = await site()
    const sales = await libraryForm('Contact – Sales', {
      messageOnSubmit: 'Sales will reply.',
      recipients: 'sales@example.com, lead@example.com',
    })
    await page(sales)
    const response = await post({ email: 'someone@example.com' })
    expect(response.status).toBe(200)
    expect(((await response.json()) as { message: string }).message).toBe('Sales will reply.')

    const entries = new FormEntryRepository(h.server.db)
    const listed = await entries.list({ formKey: FORM_KEY })
    expect(listed.items.map((entry) => entry.libraryKey)).toEqual([sales])
    expect((await entries.list({ formKey: FORM_KEY, libraryKey: sales })).total).toBe(1)
    expect((await entries.list({ formKey: FORM_KEY, libraryKey: null })).total).toBe(0)
    const filtered = await h.json<{ total: number }>(
      `${FORMS_API}/${FORM_KEY}/entries?library=none`,
    )
    expect(filtered.total).toBe(0)

    const email = recordingEmail()
    const forms = {
      byKey: (key: string) =>
        key === FORM_KEY
          ? (loadSchemaDirectory(h.server.config.schemaDir).set.forms ?? []).find(
              (form) => form.key === FORM_KEY,
            )
          : undefined,
    }
    const runs = new FormWorkflowRepository(h.server.db)
    expect((await runs.forForm(FORM_KEY))[0]?.recipients).toEqual([
      'sales@example.com',
      'lead@example.com',
    ])
    await createWorkflowRunner({ db: h.server.db, forms, email }).runDue()
    expect(email.sent[0]?.to).toEqual([
      { email: 'sales@example.com' },
      { email: 'lead@example.com' },
    ])
  })

  test('a token for one Library form does not carry another’s words', async () => {
    const { libraryForm, page, post } = await site()
    const sales = await libraryForm('Contact – Sales', {})
    const support = await libraryForm('Contact – Support', { recipients: 'x@example.com' })
    await page(sales)
    expect((await post({ email: 'someone@example.com' }, { library: support })).status).toBe(400)
  })
})
