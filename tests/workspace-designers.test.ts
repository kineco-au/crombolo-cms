/**
 * Story 392: forms and workflows in a workspace. Their designers, given the workspace,
 * read and write its copy of `schema/`; Shared's files and its workflows are left
 * alone until the merge brings them in.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ChangeRepository,
  ContentTypeRepository,
  FormEntryRepository,
  readWorkflows,
} from '@crombolo/data'
import { workspaceHeaders } from '../packages/backoffice-host/plugin/workspace-client.js'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

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

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const NEWS_TOML = `[content-type]
alias = "news"
name = "News"
allow-at-root = true
varies-by-culture = true

[[property]]
alias = "title"
name = "Title"
type = "textstring"
varies-by-culture = true
`

const CONTACT = `[form]
key = "9c4a7d1e-0001-4b2a-9f31-6d8e2c5a7b92"
alias = "contactUs"
name = "Contact us"

[[page]]

  [[page.group]]

    [[page.group.field]]
    alias = "email"
    type = "email"
    caption = "Email address"

    [[page.group.field]]
    alias = "note"
    type = "longAnswer"
    caption = "Note"
`

const SIGN_OFF = `[workflow]
alias = "sign-off"
name = "Sign-off"
applies-to = { branches = [], content-types = ["page"] }

[[stage]]
alias = "review"
approvers = ["admin"]
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const FORMS = `${BACKOFFICE}/crombolo/api/forms`
const WORKFLOWS = `${BACKOFFICE}/crombolo/api/approvals/workflows`

async function site(extra: Record<string, unknown> = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-designers-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'schema/forms', 'schema/workflows', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'schema', 'content-types', 'news.toml'), NEWS_TOML)
  writeFileSync(join(root, 'schema', 'forms', 'contact-us.toml'), CONTACT)
  writeFileSync(join(root, 'schema', 'workflows', 'sign-off.toml'), SIGN_OFF)
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      schemaWritable: true,
      workspaces: true,
      ...extra,
    },
  })
  open.push(h)
  const send = (method: string, path: string, body?: unknown, workspace?: string) =>
    h.call(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(workspace ? { 'crombolo-workspace': workspace } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string }
  }
  const file = (...path: string[]) => join(root, 'schema', ...path)
  return { h, send, opened, file }
}

const JOBS = {
  key: '9c4a7d1e-0002-4b2a-9f31-6d8e2c5a7b92',
  alias: 'jobApplication',
  name: 'Job application',
  pages: [
    {
      groups: [
        {
          columns: 1,
          fields: [{ alias: 'name', type: 'shortAnswer', caption: 'Name', mandatory: true }],
        },
      ],
    },
  ],
}

describe(`the designers in a workspace (${dialectUnderTest})`, () => {
  test('a form saved there is the workspace’s until the merge writes it into Shared', async () => {
    const { send, opened, file } = await site()
    const sale = await opened('Spring sale')
    expect((await send('PUT', FORMS, JOBS, sale.key)).status).toBe(200)
    expect(existsSync(file('forms', 'job-application.toml'))).toBe(false)

    const aliases = async (workspace?: string) =>
      (
        (await (await send('GET', FORMS, undefined, workspace)).json()) as {
          items: Array<{ alias: string }>
        }
      ).items.map((f) => f.alias)
    expect(await aliases(sale.key)).toEqual(['contactUs', 'jobApplication'])
    expect(await aliases()).toEqual(['contactUs'])

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(readFileSync(file('forms', 'job-application.toml'), 'utf8')).toContain(
      'alias = "jobApplication"',
    )
  }, 20_000)

  test('a form deleted there stays in Shared until the merge', async () => {
    const { send, opened, file } = await site()
    const sale = await opened('Spring sale')
    const removed = await send(
      'DELETE',
      `${FORMS}/9c4a7d1e-0001-4b2a-9f31-6d8e2c5a7b92`,
      undefined,
      sale.key,
    )
    expect(removed.status).toBe(200)
    expect(existsSync(file('forms', 'contact-us.toml'))).toBe(true)
    // Removing a definition loses it, so the merge asks for that to be accepted.
    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(409)
    const merged = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {
      accept: ['file-removed:forms/contact-us.toml'],
    })
    expect(merged.status).toBe(200)
    expect(existsSync(file('forms', 'contact-us.toml'))).toBe(false)
  }, 20_000)

  test('a workflow changed there leaves Shared’s, in its file and in force, until the merge', async () => {
    const { h, send, opened, file } = await site()
    const sale = await opened('Spring sale')
    const listed = (await (await send('GET', WORKFLOWS, undefined, sale.key)).json()) as {
      items: Array<Record<string, unknown>>
    }
    const workflow = listed.items.find((w) => w.alias === 'sign-off') as Record<string, unknown>
    const saved = await send(
      'PUT',
      `${WORKFLOWS}/sign-off`,
      { workflow: { ...workflow, name: 'Careful sign-off' } },
      sale.key,
    )
    expect(saved.status, await saved.clone().text()).toBe(200)
    expect(readFileSync(file('workflows', 'sign-off.toml'), 'utf8')).toContain('name = "Sign-off"')
    const inForce = async () => (await readWorkflows(h.server.db)).map((w) => w.workflow.name)
    expect(await inForce()).toEqual(['Sign-off'])
    const names = async (workspace?: string) =>
      (
        (await (await send('GET', WORKFLOWS, undefined, workspace)).json()) as {
          items: Array<{ name: string }>
        }
      ).items.map((w) => w.name)
    expect(await names(sale.key)).toEqual(['Careful sign-off'])

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(readFileSync(file('workflows', 'sign-off.toml'), 'utf8')).toContain(
      'name = "Careful sign-off"',
    )
    expect(await inForce()).toEqual(['Careful sign-off'])
  }, 20_000)
})

describe(`blueprints in a workspace (${dialectUnderTest})`, () => {
  const blueprint = (typeKey: string, name: string) => ({
    documentType: { id: typeKey },
    parent: null,
    values: [{ alias: 'title', culture: null, segment: null, value: name }],
    variants: [{ culture: null, segment: null, name }],
  })
  const setUp = async () => {
    const s = await site()
    const typeKey = (await new ContentTypeRepository(s.h.server.db).byAlias('page'))?.key as string
    const names = async (workspace?: string) =>
      (
        (await (
          await s.send(
            'GET',
            `${V1}/tree/document-blueprint/root?skip=0&take=50`,
            undefined,
            workspace,
          )
        ).json()) as { items: Array<{ name: string }> }
      ).items.map((i) => i.name)
    const made = async (name: string, workspace?: string) => {
      const response = await s.send(
        'POST',
        `${V1}/document-blueprint`,
        blueprint(typeKey, name),
        workspace,
      )
      expect(response.status).toBe(201)
      return response.headers.get('umb-generated-resource') as string
    }
    return { ...s, typeKey, names, made }
  }

  test('one made there is the workspace’s until the merge brings it into Shared', async () => {
    const { send, opened, names, made } = await setUp()
    const sale = await opened('Spring sale')
    const key = await made('Sale page', sale.key)
    expect(await names(sale.key)).toEqual(['Sale page'])
    expect(await names()).toEqual([])
    expect((await send('GET', `${V1}/document-blueprint/${key}`)).status).toBe(404)
    expect((await send('GET', `${V1}/document-blueprint/${key}`, undefined, sale.key)).status).toBe(
      200,
    )

    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(200)
    expect(await names()).toEqual(['Sale page'])
  }, 20_000)

  test('Shared’s, changed or deleted there, stays as it was in Shared until the merge', async () => {
    const { send, opened, names, made } = await setUp()
    const plain = await made('Plain page')
    const old = await made('Old page')
    const sale = await opened('Spring sale')
    const renamed = await send(
      'PUT',
      `${V1}/document-blueprint/${plain}`,
      {
        values: [{ alias: 'title', culture: null, segment: null, value: 'Sale' }],
        variants: [{ culture: null, segment: null, name: 'Sale page' }],
      },
      sale.key,
    )
    expect(renamed.status).toBe(200)
    expect(
      (await send('DELETE', `${V1}/document-blueprint/${old}`, undefined, sale.key)).status,
    ).toBe(200)
    expect(await names(sale.key)).toEqual(['Sale page'])
    expect(await names()).toEqual(['Old page', 'Plain page'])

    // A delete is accepted first, as a page's is.
    expect((await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})).status).toBe(409)
    const merged = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {
      accept: ['page-deleted'],
    })
    expect(merged.status).toBe(200)
    expect(await names()).toEqual(['Sale page'])
  }, 20_000)

  test('their folders are Shared’s', async () => {
    const { send, opened } = await setUp()
    const sale = await opened('Spring sale')
    const refused = await send(
      'POST',
      `${V1}/document-blueprint/folder`,
      { name: 'Sales', parent: null },
      sale.key,
    )
    expect(refused.status).toBe(409)
  })
})

describe(`removing what the site's data holds (${dialectUnderTest})`, () => {
  const blockers = async (response: Response) =>
    ((await response.json()) as { blockers: string[] }).blockers.join(' ')

  test('a form field with entries is accepted first; the entries are kept', async () => {
    const { h, send, opened } = await site()
    await new FormEntryRepository(h.server.db).create({
      formKey: '9c4a7d1e-0001-4b2a-9f31-6d8e2c5a7b92',
      formAlias: 'contactUs',
      culture: null,
      pageKey: null,
      ipHash: null,
      userAgent: null,
      values: [{ fieldAlias: 'note', values: ['Call me'] }],
    })
    const sale = await opened('Spring sale')
    const form = (await (
      await send('GET', `${FORMS}/9c4a7d1e-0001-4b2a-9f31-6d8e2c5a7b92`, undefined, sale.key)
    ).json()) as {
      definition: { pages: Array<{ groups: Array<{ fields: Array<{ alias: string }> }> }> }
    }
    const definition = form.definition
    for (const page of definition.pages)
      for (const group of page.groups) group.fields = group.fields.filter((f) => f.alias !== 'note')
    expect((await send('PUT', FORMS, definition, sale.key)).status).toBe(200)

    const refused = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(await blockers(refused)).toContain('form-field-entries-orphaned:contactUs.note')
    const merged = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {
      accept: ['form-field-entries-orphaned'],
    })
    expect(merged.status).toBe(200)
  }, 20_000)

  test('a workflow with a request waiting is accepted first', async () => {
    const { h, send, opened } = await site()
    await h.server.db.q
      .insertInto('approval_request')
      .values({
        key: crypto.randomUUID(),
        action: 'publish',
        node_key: crypto.randomUUID(),
        requested_at: new Date().toISOString(),
        requested_by: crypto.randomUUID(),
        state: 'waiting',
        workflow: JSON.stringify({ alias: 'sign-off' }),
        workflow_key: 'sign-off',
        workflow_version: '1',
      })
      .execute()
    const sale = await opened('Spring sale')
    expect((await send('DELETE', `${WORKFLOWS}/sign-off`, undefined, sale.key)).status).toBe(200)
    const refused = await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(await blockers(refused)).toContain('workflow-requests-withdrawn:sign-off')
    expect(
      (
        await send('POST', `${WORKSPACES}/${sale.key}/merge`, {
          accept: ['workflow-requests-withdrawn'],
        })
      ).status,
    ).toBe(200)
  }, 20_000)

  test('a language with values is accepted first; one without merges as it is', async () => {
    const { h, send, opened } = await site()
    for (const [isoCode, name] of [
      ['da-DK', 'Danish'],
      ['fr-FR', 'French'],
    ])
      expect(
        (
          await send('POST', `${V1}/language`, {
            isoCode,
            name,
            isDefault: false,
            isMandatory: false,
            fallbackIsoCode: null,
          })
        ).status,
      ).toBe(201)
    const news = (await new ContentTypeRepository(h.server.db).byAlias('news'))?.key as string
    const made = await send('POST', `${V1}/document`, {
      documentType: { id: news },
      template: null,
      parent: null,
      values: [{ alias: 'title', culture: 'da-DK', segment: null, value: 'Nyheder' }],
      variants: [{ culture: 'da-DK', segment: null, name: 'Nyheder' }],
    })
    expect(made.status, await made.clone().text()).toBe(201)

    const unused = await opened('No French')
    expect((await send('DELETE', `${V1}/language/fr-FR`, undefined, unused.key)).status).toBe(200)
    expect((await send('POST', `${WORKSPACES}/${unused.key}/merge`, {})).status).toBe(200)

    const used = await opened('No Danish')
    expect((await send('DELETE', `${V1}/language/da-DK`, undefined, used.key)).status).toBe(200)
    const refused = await send('POST', `${WORKSPACES}/${used.key}/merge`, {})
    expect(refused.status).toBe(409)
    expect(await blockers(refused)).toContain('language-values-dropped:da-DK')
  }, 30_000)
})

describe(`a direct edit in Shared (${dialectUnderTest})`, () => {
  test('to a form, a workflow, a language or a blueprint is recorded as the person’s change', async () => {
    const { h, send } = await site()
    expect((await send('PUT', FORMS, JOBS)).status).toBe(200)
    const listed = (await (await send('GET', WORKFLOWS)).json()) as {
      items: Array<Record<string, unknown>>
    }
    const workflow = listed.items[0] as Record<string, unknown>
    expect(
      (await send('PUT', `${WORKFLOWS}/sign-off`, { workflow: { ...workflow, name: 'Careful' } }))
        .status,
    ).toBe(200)
    const language = {
      isoCode: 'da-DK',
      name: 'Danish',
      isDefault: false,
      isMandatory: false,
      fallbackIsoCode: null,
    }
    expect((await send('POST', `${V1}/language`, language)).status).toBe(201)
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const made = await send('POST', `${V1}/document-blueprint`, {
      documentType: { id: typeKey },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Plain page' }],
    })
    expect(made.status).toBe(201)
    const blueprint = made.headers.get('umb-generated-resource') as string

    const changes = new ChangeRepository(h.server.db)
    const paths: string[] = []
    for (const change of (await changes.list()).items)
      for (const item of await changes.itemsOf(change.id, { pages: true })) paths.push(item.path)
    expect(paths).toEqual(
      expect.arrayContaining([
        'schema/forms/job-application.toml',
        'schema/workflows/sign-off.toml',
        'schema/languages.toml',
      ]),
    )
    const pages = await h.server.db.q
      .selectFrom('content_transfer_change')
      .select('node_key')
      .where('node_key', '=', blueprint.toLowerCase())
      .execute()
    expect(pages).toHaveLength(1)
  }, 20_000)
})

describe(`with content locked (${dialectUnderTest})`, () => {
  test('a language, a blueprint, a form and a workflow are read-only, saying why', async () => {
    const { h, send } = await site({ contentEditing: 'locked' })
    const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const tries = [
      await send('POST', `${V1}/language`, {
        isoCode: 'da-DK',
        name: 'Danish',
        isDefault: false,
        isMandatory: false,
        fallbackIsoCode: null,
      }),
      await send('POST', `${V1}/document-blueprint`, {
        documentType: { id: typeKey },
        parent: null,
        values: [],
        variants: [{ culture: null, segment: null, name: 'Plain page' }],
      }),
      await send('PUT', FORMS, JOBS),
      await send('DELETE', `${WORKFLOWS}/sign-off`),
    ]
    expect(tries.map((r) => r.status)).toEqual([409, 409, 409, 409])
    const forms = (await (await send('GET', FORMS)).json()) as { readOnlyBecause: string | null }
    expect(forms.readOnlyBecause).toBe('site')
    const workflows = (await (await send('GET', WORKFLOWS)).json()) as { editable: boolean }
    expect(workflows.editable).toBe(false)
  })
})

describe('the back office’s designer calls', () => {
  const storage = (value: unknown) => ({
    getItem: () => (value === undefined ? null : JSON.stringify(value)),
    setItem: () => {},
    removeItem: () => {},
  })
  test('carry the tab’s workspace, and none in Shared', () => {
    expect(workspaceHeaders(storage({ key: 'abc', name: 'Sale' }))).toEqual({
      'Crombolo-Workspace': 'abc',
    })
    expect(workspaceHeaders(storage({ key: 'shared' }))).toEqual({})
  })
})
