/**
 * Story 056: an app renders a form itself — the definition as data with a fresh
 * token, a form picker that never shows the stored definition, and submissions
 * from another origin, uploads included.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { siteDeclaring } from './support/bundles.ts'
import { FORMS_PACKAGE, formsBundle } from './support/form-types-bundle.ts'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

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

const FORM_KEY = '9c4a7d1e-0560-4b2a-9f31-6d8e2c5a7b56'
const APP = 'https://app.example.com'

const FORM = `[form]
key = "${FORM_KEY}"
alias = "signUp"
name = "Sign up"
submit-label = "Join"
message-on-submit = "Thanks."
honeypot = true
notes = "Internal: send to the CRM"

[[page]]
caption = "About you"

  [[page.group]]
  columns = 1

    [[page.group.field]]
    alias = "email"
    type = "email"
    caption = "Email"
    mandatory = true

    [[page.group.field]]
    alias = "postcode"
    type = "postcode"
    caption = "Postcode"
    mandatory = true
    settings = { country = "AU", lookup = true }

    [[page.group.field]]
    alias = "plan"
    type = "dropdown"
    caption = "Plan"
    values = ["Free", "Paid"]

    [[page.group.field]]
    alias = "cv"
    type = "fileUpload"
    caption = "CV"
    accept = [".pdf", ".txt"]

[[workflow]]
type = "crmHandoff"
name = "To the CRM"

[workflow.settings]
endpoint = "https://crm.internal.example/secret-hook"
list = "newsletter"
`

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "signUp"
name = "Sign up"
type = "formPicker"
`

type ApiForm = {
  id: string
  alias: string
  name: string
  submitLabel: string
  pages: Array<{
    caption: string
    groups: Array<{ fields: Array<Record<string, unknown> & { alias: string }> }>
  }>
  types: Record<string, Record<string, unknown>>
  submit: { action: string; method: string; fields: Record<string, string>; honeypot?: string }
}

async function site() {
  const root = siteDeclaring('delivery-forms', FORMS_PACKAGE)
  dirs.push(root)
  for (const dir of ['schema/content-types', 'schema/forms'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'schema', 'forms', 'sign-up.toml'), FORM)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      bundles: [formsBundle()],
      deliveryApi: { enabled: true, cors: { allowedOrigins: [APP] } },
    },
  })
  open.push(h)
  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const created = await h.post(`${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [{ alias: 'signUp', value: FORM_KEY, culture: null, segment: null }],
    variants: [{ culture: null, segment: null, name: 'Join us' }],
  })
  expect(created.status).toBe(201)
  const page = created.headers.get('umb-generated-resource') as string
  expect(
    (await h.put(`${V1}/document/${page}/publish`, { publishSchedules: [{ culture: null }] }))
      .status,
  ).toBe(200)
  const api = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`${ORIGIN}/umbraco/delivery/api/v2${path}`, { headers }))
  return { h, page, api }
}

describe('a form as data', () => {
  test('is what a visitor sees and answers, with a fresh token, and nothing of the site’s', async () => {
    const { api } = await site()
    const response = await api('/forms/signUp')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(text).not.toContain('secret-hook')
    expect(text).not.toContain('workflow')
    expect(text).not.toContain('Internal')
    const form = JSON.parse(text) as ApiForm
    expect(form).toMatchObject({
      id: FORM_KEY,
      alias: 'signUp',
      name: 'Sign up',
      submitLabel: 'Join',
    })
    expect(form.pages[0]?.caption).toBe('About you')
    const fields = form.pages[0]?.groups[0]?.fields ?? []
    expect(fields.map((f) => f.alias)).toEqual(['email', 'postcode', 'plan', 'cv'])
    expect(fields[2]?.options).toEqual([
      { value: 'Free', label: 'Free' },
      { value: 'Paid', label: 'Paid' },
    ])
    expect(fields[1]?.settings).toEqual({ country: 'AU', lookup: true })
    expect(form.types.postcode).toMatchObject({ label: 'Postcode', bundle: 'acme-forms' })
    expect(form.types.email?.bundle).toBeUndefined()
    expect(form.submit.action).toBe(`${ORIGIN}/crombolo/forms/${FORM_KEY}`)
    expect(form.submit.honeypot).toBe('_crombolo_hp')
    expect(form.submit.fields._crombolo_token).toBeTruthy()
    expect(Number(form.submit.fields._crombolo_at)).toBeGreaterThan(0)
    expect((await api('/forms/nope')).status).toBe(404)
  })

  test('submits from an app on another origin, a file included', async () => {
    const { h, api } = await site()
    const form = (await (await api('/forms/signUp')).json()) as ApiForm
    const body = new FormData()
    for (const [name, value] of Object.entries(form.submit.fields)) body.set(name, value)
    body.set('_crombolo_hp', '')
    body.set('email', 'ada@example.com')
    body.set('postcode', '2000')
    body.set('plan', 'Paid')
    body.set('cv', new File(['my cv'], 'cv.txt', { type: 'text/plain' }))
    const response = await h.server.fetch(
      new Request(form.submit.action, {
        method: 'POST',
        body,
        headers: { accept: 'application/json', origin: APP },
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(APP)
    const answer = (await response.json()) as { ok: boolean; entryId?: string }
    expect(answer.ok).toBe(true)
    expect(answer.entryId).toBeTruthy()

    const refused = await h.server.fetch(
      new Request(form.submit.action, {
        method: 'POST',
        body: new FormData(),
        headers: { accept: 'application/json', origin: APP },
      }),
    )
    expect(refused.status).toBe(400)
    expect(refused.headers.get('access-control-allow-origin')).toBe(APP)

    const preflight = await h.server.fetch(
      new Request(form.submit.action, {
        method: 'OPTIONS',
        headers: { origin: APP, 'access-control-request-method': 'POST' },
      }),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toBe('POST')
  })
})

describe('a form picker', () => {
  test('is a reference, or the form as data when expanded, never the stored definition', async () => {
    const { api, page } = await site()
    const plain = await api(`/content/item/${page}`)
    const plainText = await plain.text()
    expect(plainText).not.toContain('secret-hook')
    const item = JSON.parse(plainText) as { properties: { signUp: unknown } }
    expect(item.properties.signUp).toEqual({ id: FORM_KEY, alias: 'signUp', name: 'Sign up' })

    const expanded = await api(`/content/item/${page}?expand=properties[signUp]`)
    expect(expanded.headers.get('cache-control')).toBe('no-store')
    const expandedText = await expanded.text()
    expect(expandedText).not.toContain('secret-hook')
    const form = (JSON.parse(expandedText) as { properties: { signUp: ApiForm } }).properties.signUp
    expect(form.submit.fields._crombolo_token).toBeTruthy()
    expect(form.pages[0]?.groups[0]?.fields.map((f) => f.alias)).toContain('postcode')
  })
})
