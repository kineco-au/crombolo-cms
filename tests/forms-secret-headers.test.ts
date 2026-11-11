/**
 * Story 304: a send-to-URL workflow's secret headers. Set in the back office,
 * sealed in the database and never in the form's file, never shown back, and
 * sent only to the address they were set for.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SchemaForm } from '@crombolo/core'
import { AuditLog, FormWorkflowSecretRepository } from '@crombolo/data'
import { runWorkflow, sealSecret } from '@crombolo/server'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup } from './support/harness.ts'

const FORMS = `${BACKOFFICE}/crombolo/api/forms`
const FORM_KEY = '9c4a7d1e-0304-4b2a-9f31-6d8e2c5a7b40'
const WORKFLOW_KEY = '5e0b2c1d-0304-4f3a-8b2e-1c9d7a6f0304'
const KEY = 'a-secret-key-for-sealing-the-headers-304'
const PUBLIC = { lookup: async () => ['93.184.216.34'] }

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

const FORM = `[form]
key = "${FORM_KEY}"
alias = "leads"
name = "Leads"

[[page]]

  [[page.group]]

    [[page.group.field]]
    alias = "email"
    type = "email"
    caption = "Email"

[[workflow]]
key = "${WORKFLOW_KEY}"
type = "sendToUrl"
name = "To the CRM"

  [workflow.settings]
  url = "https://crm.example.com/leads"

    [workflow.settings.headers]
    X-Source = "website"
    Authorization = { secret = true }
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'forms-secret-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'forms'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'forms', 'leads.toml'), FORM)
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), secretKey: KEY, allowPrivateAddresses: false },
  })
  open.push(h)
  return { h, file: join(root, 'schema', 'forms', 'leads.toml') }
}

const secretUrl = `${FORMS}/${FORM_KEY}/workflows/${WORKFLOW_KEY}/secrets/Authorization`

type Detail = {
  definition: SchemaForm
  secrets: { workflow: string; header: string; set: boolean }[]
}

/** Runs the form's workflow as the queue would, and what it sent. */
async function send(h: Harness, form: SchemaForm, secretKey = KEY) {
  const sent: Headers[] = []
  const outcome = await runWorkflow(
    form.workflows[0] as SchemaForm['workflows'][number],
    { form, values: [], entryId: null },
    {
      db: h.server.db,
      secretKey,
      outbound: PUBLIC,
      fetch: (async (_url: string, init: RequestInit) => {
        sent.push(new Headers(init.headers))
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch,
    },
  )
  return { outcome, sent }
}

describe('secret headers (story 304)', () => {
  test('one not yet set sends nothing, and says so', async () => {
    const { h } = await site()
    const detail = await h.json<Detail>(`${FORMS}/${FORM_KEY}`)
    expect(detail.secrets).toEqual([
      { workflow: WORKFLOW_KEY, header: 'Authorization', set: false },
    ])
    const { outcome, sent } = await send(h, detail.definition)
    expect(sent).toEqual([])
    expect(outcome).toMatchObject({ ok: false, retry: false })
    expect(outcome.ok === false && outcome.error).toContain('"Authorization" has not been set')
  })

  test('set here, it is sent, and never shown back or written to the file', async () => {
    const { h, file } = await site()
    const set = await h.call(secretUrl, {
      method: 'PUT',
      body: JSON.stringify({ value: 'Bearer crm-token' }),
    })
    expect(set.status, await set.clone().text()).toBe(200)

    const raw = await (await h.call(`${FORMS}/${FORM_KEY}`)).text()
    expect(raw).not.toContain('crm-token')
    const detail = JSON.parse(raw) as Detail
    expect(detail.secrets[0]?.set).toBe(true)
    expect(readFileSync(file, 'utf8')).not.toContain('crm-token')

    const { outcome, sent } = await send(h, detail.definition)
    expect(outcome.ok).toBe(true)
    expect(sent[0]?.get('authorization')).toBe('Bearer crm-token')
    expect(sent[0]?.get('x-source')).toBe('website')

    const audit = await new AuditLog(h.server.db).query(
      { entityKey: FORM_KEY },
      { skip: 0, take: 50 },
    )
    const entry = audit.items.find((item) => item.action === 'secret header set')
    expect(entry?.detail).toBe('To the CRM: Authorization')
    expect(JSON.stringify(audit.items)).not.toContain('crm-token')
  })

  test('once the address changes it is not sent until set again', async () => {
    const { h } = await site()
    await h.call(secretUrl, { method: 'PUT', body: JSON.stringify({ value: 'Bearer crm-token' }) })
    const { definition } = await h.json<Detail>(`${FORMS}/${FORM_KEY}`)
    const workflow = definition.workflows[0] as SchemaForm['workflows'][number]
    workflow.settings = { ...workflow.settings, url: 'https://elsewhere.example.com/' }
    const saved = await h.call(FORMS, { method: 'PUT', body: JSON.stringify(definition) })
    expect(saved.status, await saved.clone().text()).toBe(200)

    const detail = await h.json<Detail>(`${FORMS}/${FORM_KEY}`)
    expect(detail.secrets[0]?.set).toBe(false)
    const { outcome, sent } = await send(h, detail.definition)
    expect(sent).toEqual([])
    expect(outcome.ok === false && outcome.error).toContain('set for another address')
  })

  test('one sealed with another key sends nothing', async () => {
    const { h } = await site()
    await new FormWorkflowSecretRepository(h.server.db).set(
      FORM_KEY,
      WORKFLOW_KEY,
      'Authorization',
      {
        sealed: sealSecret('Bearer x', 'another-key-entirely-for-this-test-304'),
        url: 'https://crm.example.com/leads',
      },
      null,
    )
    const { definition } = await h.json<Detail>(`${FORMS}/${FORM_KEY}`)
    const { outcome, sent } = await send(h, definition)
    expect(sent).toEqual([])
    expect(outcome.ok === false && outcome.error).toContain('cannot be read')
  })

  test('only someone who manages forms sets one, and only one the form names', async () => {
    const { h } = await site()
    const writer = await signInAsGroup(h, 'writer')
    const refused = await writer.call(secretUrl, {
      method: 'PUT',
      body: JSON.stringify({ value: 'x' }),
    })
    expect(refused.status).toBe(403)
    const unnamed = await h.call(
      `${FORMS}/${FORM_KEY}/workflows/${WORKFLOW_KEY}/secrets/X-Source`,
      { method: 'PUT', body: JSON.stringify({ value: 'x' }) },
    )
    expect(unnamed.status).toBe(404)
  })

  test('removing the workflow forgets its secrets', async () => {
    const { h } = await site()
    await h.call(secretUrl, { method: 'PUT', body: JSON.stringify({ value: 'Bearer crm-token' }) })
    const { definition } = await h.json<Detail>(`${FORMS}/${FORM_KEY}`)
    const saved = await h.call(FORMS, {
      method: 'PUT',
      body: JSON.stringify({ ...definition, workflows: [] }),
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect(
      (await new FormWorkflowSecretRepository(h.server.db).of(FORM_KEY, WORKFLOW_KEY)).size,
    ).toBe(0)
  })

  test('saving a form that sends to this server’s network is refused', async () => {
    const { h } = await site()
    const { definition } = await h.json<Detail>(`${FORMS}/${FORM_KEY}`)
    const workflow = definition.workflows[0] as SchemaForm['workflows'][number]
    workflow.settings = { ...workflow.settings, url: 'http://169.254.169.254/latest' }
    const saved = await h.call(FORMS, { method: 'PUT', body: JSON.stringify(definition) })
    expect(saved.status).toBe(400)
    expect(await saved.text()).toContain('which this site does not send to')
  })
})
