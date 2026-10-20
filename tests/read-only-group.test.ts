/**
 * Story 088: a group that may only read changes nothing — in documents, media,
 * elements, approval requests and redirect tracking — while still reading what
 * its sections show; and a property a group may only read cannot be changed.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SYSTEM_MEDIA_TYPE_KEYS } from '@crombolo/core'
import { ContentTypeRepository } from '@crombolo/data'
import { siteMediaTypeFiles } from '@crombolo/schema'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const APPROVALS = `${BACKOFFICE}/crombolo/api/approvals`

const POLICY_TOML = `[content-type]
alias = "policy"
name = "Policy"
allow-at-root = true
components = ["policy"]
default-component = "policy"

[[property]]
alias = "body"
name = "Body"
type = "textarea"

[[property]]
alias = "summary"
name = "Summary"
type = "textarea"
`

const QUOTE_TOML = `[content-type]
alias = "quote"
name = "Quote"
is-element = true
allow-in-library = true

[[property]]
alias = "body"
name = "Body"
type = "textstring"
`

const WORKFLOW_TOML = `[workflow]
alias = "policy-sign-off"
name = "Policy sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = false
unpublish = true

[[stage]]
alias = "final"
approvers = ["admin"]
`

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

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'read-only-'))
  dirs.push(root)
  for (const dir of ['content-types', 'media-types', 'workflows'])
    mkdirSync(join(root, 'schema', dir), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'policy.toml'), POLICY_TOML)
  writeFileSync(join(root, 'schema', 'content-types', 'quote.toml'), QUOTE_TOML)
  writeFileSync(join(root, 'schema', 'workflows', 'policy-sign-off.toml'), WORKFLOW_TOML)
  for (const [path, content] of Object.entries(siteMediaTypeFiles()))
    writeFileSync(join(root, path), content)
  writeFileSync(join(root, 'components', 'policy.tsx'), 'export default () => <main />\n')
  const admin = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
    },
  })
  open.push(admin)
  const types = new ContentTypeRepository(admin.server.db)
  const policy = (await types.byAlias('policy'))?.key as string
  const quote = (await types.byAlias('quote'))?.key as string
  const created = async (path: string, body: unknown) => {
    const response = await admin.post(path, body)
    expect(response.status, await response.clone().text()).toBe(201)
    return response.headers.get('umb-generated-resource') as string
  }
  const page = await created(`${V1}/document`, {
    documentType: { id: policy },
    template: null,
    parent: null,
    values: [
      { alias: 'body', culture: null, segment: null, value: 'Body text' },
      { alias: 'summary', culture: null, segment: null, value: 'Summary text' },
    ],
    variants: [{ culture: null, segment: null, name: 'Privacy' }],
  })
  const folder = await created(`${V1}/media`, {
    mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Photos' }],
  })
  const binned = await created(`${V1}/media`, {
    mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Old' }],
  })
  expect((await admin.put(`${V1}/media/${binned}/move-to-recycle-bin`, {})).status).toBe(200)
  const element = await created(`${V1}/element`, {
    documentType: { id: quote },
    parent: null,
    values: [{ alias: 'body', culture: null, segment: null, value: 'Quoted' }],
    variants: [{ culture: null, segment: null, name: 'A quote' }],
  })
  const elementFolder = await created(`${V1}/element/folder`, { name: 'Quotes', parent: null })
  const group = async (alias: string, fields: Record<string, unknown>) => {
    const response = await admin.post(`${V1}/user-group`, {
      name: alias,
      alias,
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: true,
      documentStartNode: null,
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: true,
      elementStartNode: null,
      permissions: [],
      ...fields,
    })
    expect(response.status, await response.clone().text()).toBe(201)
    return signInAsGroup(admin, alias)
  }
  return { admin, policy, page, folder, binned, element, elementFolder, group }
}

describe(`a read-only group (${dialectUnderTest})`, () => {
  test('reads what its sections show and is refused every change', async () => {
    const { admin, page, folder, binned, element, elementFolder, group } = await site()
    const reader = await group('readers', {
      sections: ['Umb.Section.Content', 'Umb.Section.Media', 'Umb.Section.Library'],
      fallbackPermissions: [
        'Umb.Document.Read',
        'Umb.Document.PropertyValue.Read',
        'Umb.Element.Read',
        'Umb.ElementContainer.Read',
        'Crombolo.Media.Read',
      ],
    })
    open.push(reader)

    const reads = [
      `${V1}/document/${page}`,
      `${V1}/tree/document/root?skip=0&take=10`,
      `${V1}/media/${folder}`,
      `${V1}/media/${folder}/audit-log?skip=0&take=10`,
      `${V1}/collection/media?skip=0&take=10`,
      `${V1}/collection/media?id=${folder}&skip=0&take=10`,
      `${V1}/tree/media/root?skip=0&take=10`,
      `${V1}/recycle-bin/media/root?skip=0&take=10`,
      `${V1}/element/${element}`,
      `${V1}/element/folder/${elementFolder}`,
      `${V1}/tree/element/root?skip=0&take=10`,
      `${V1}/redirect-management/status`,
      `${APPROVALS}/page/${page}`,
    ]
    for (const path of reads) expect([path, (await reader.call(path)).status]).toEqual([path, 200])
    expect(await reader.json<unknown>(`${V1}/user/current/permissions/media?id=${folder}`)).toEqual(
      {
        permissions: [{ nodeKey: folder, permissions: ['Crombolo.Media.Read'] }],
      },
    )

    const variants = (name: string) => [{ culture: null, segment: null, name }]
    const writes: Array<[string, string, unknown?]> = [
      ['PUT', `${V1}/document/${page}`, { values: [], variants: variants('Changed') }],
      ['POST', `${V1}/media`, { mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder }, parent: null }],
      ['POST', `${V1}/media/validate`, { mediaType: { id: SYSTEM_MEDIA_TYPE_KEYS.Folder } }],
      ['PUT', `${V1}/media/${folder}`, { values: [], variants: variants('Changed') }],
      ['PUT', `${V1}/media/${folder}/validate`, { values: [], variants: variants('Changed') }],
      ['DELETE', `${V1}/media/${folder}`],
      ['PUT', `${V1}/media/${folder}/move-to-recycle-bin`, {}],
      ['PUT', `${V1}/media/${folder}/move`, { target: null }],
      ['PUT', `${V1}/media/${folder}/sort-children`, { sorting: [] }],
      ['PUT', `${V1}/media/sort`, { parent: null, sorting: [{ id: folder, sortOrder: 0 }] }],
      ['PUT', `${V1}/media/root/sort-children`, { sorting: [] }],
      ['PUT', `${V1}/recycle-bin/media/${binned}/restore`, { target: null }],
      ['DELETE', `${V1}/recycle-bin/media/${binned}`],
      ['DELETE', `${V1}/recycle-bin/media`],
      ['POST', `${V1}/element`, { values: [], variants: variants('New') }],
      ['PUT', `${V1}/element/${element}`, { values: [], variants: variants('Changed') }],
      ['PUT', `${V1}/element/${element}/publish`, { publishSchedules: [] }],
      ['PUT', `${V1}/element/${element}/move-to-recycle-bin`, {}],
      ['DELETE', `${V1}/element/${element}`],
      ['POST', `${V1}/element/${element}/copy`, { target: null }],
      ['POST', `${V1}/element/folder`, { name: 'New', parent: null }],
      ['PUT', `${V1}/element/folder/${elementFolder}`, { name: 'Renamed' }],
      ['DELETE', `${V1}/element/folder/${elementFolder}`],
      ['DELETE', `${V1}/recycle-bin/element`],
      ['POST', `${V1}/redirect-management/status?status=Disabled`, {}],
      ['POST', `${APPROVALS}/page/${page}/send`, { action: 'publish' }],
      ['POST', `${APPROVALS}/page/${page}/send`, { action: 'unpublish' }],
    ]
    for (const [method, path, body] of writes) {
      const response = await reader.call(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      expect([method, path, response.status]).toEqual([method, path, 403])
    }

    // Nothing changed, and nothing was asked for
    expect((await admin.call(`${V1}/media/${folder}`)).status).toBe(200)
    expect((await admin.call(`${V1}/element/${element}`)).status).toBe(200)
    expect(
      (await admin.json<{ request?: unknown }>(`${APPROVALS}/page/${page}`)).request,
    ).toBeUndefined()
    expect(await admin.json<{ status: string }>(`${V1}/redirect-management/status`)).toMatchObject({
      status: 'Enabled',
    })
  })

  test('any signed-in user may still upload a temporary file', async () => {
    const { admin } = await site()
    const writer = await signInAsGroup(admin, 'writer')
    open.push(writer)
    const form = new FormData()
    form.set('Id', crypto.randomUUID())
    form.set('File', new File(['hello'], 'hello.txt', { type: 'text/plain' }))
    expect((await writer.call(`${V1}/temporary-file`, { method: 'POST', body: form })).status).toBe(
      201,
    )
  })
})

describe(`a property a group may only read (${dialectUnderTest})`, () => {
  test('cannot be changed, named in the refusal; sending it back unchanged is not a change', async () => {
    const { admin, policy, page, group } = await site()
    const type = await admin.json<{ properties: Array<{ id: string; alias: string }> }>(
      `${V1}/document-type/${policy}`,
    )
    const body = type.properties.find((p) => p.alias === 'body')?.id as string
    const editor = await group('summaryEditors', {
      sections: ['Umb.Section.Content'],
      fallbackPermissions: [
        'Umb.Document.Read',
        'Umb.Document.Update',
        'Umb.Document.PropertyValue.Read',
        'Umb.Document.PropertyValue.Write',
      ],
      permissions: [
        {
          $type: 'DocumentPropertyValuePermissionPresentationModel',
          documentType: { id: policy },
          propertyType: { id: body },
          verbs: ['Umb.Document.PropertyValue.Read'],
        },
      ],
    })
    open.push(editor)
    const save = (values: Record<string, unknown>) =>
      editor.put(`${V1}/document/${page}`, {
        template: null,
        values: Object.entries(values).map(([alias, value]) => ({
          alias,
          culture: null,
          segment: null,
          value,
        })),
        variants: [{ culture: null, segment: null, name: 'Privacy' }],
      })

    const refused = await save({ body: 'Rewritten', summary: 'Summary text' })
    expect(refused.status).toBe(403)
    expect((await refused.json()).detail).toContain('"Body"')
    // Leaving it out would clear it, which is a change too
    expect((await save({ summary: 'New summary' })).status).toBe(403)
    const patched = await editor.call(`${V1}/document/${page}/patch`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'replace',
            path: '/values[alias=body,culture=null,segment=null]/value',
            value: 'Patched',
          },
        ],
      }),
    })
    expect(patched.status).toBe(403)

    expect((await save({ body: 'Body text', summary: 'New summary' })).status).toBe(200)
    const values = (
      await admin.json<{ values: Array<{ alias: string; value: unknown }> }>(
        `${V1}/document/${page}`,
      )
    ).values
    expect(Object.fromEntries(values.map((v) => [v.alias, v.value]))).toEqual({
      body: 'Body text',
      summary: 'New summary',
    })
  })
})
