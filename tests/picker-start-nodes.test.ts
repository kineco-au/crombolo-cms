/**
 * Story 270: a picker whose data type has "Ignore user start nodes" on lets an
 * editor kept to one branch browse and pick from the whole tree, and only that
 * picker: the same requests without it, or naming another data type, stay
 * within the editor's start nodes.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository } from '@crombolo/data'
import { type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

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

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'picker-start-nodes-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  const admin = await signedInServer({ config: { schemaDir: join(root, 'schema') } })
  open.push(admin)
  const typeKey = (await new ContentTypeRepository(admin.server.db).byAlias('page'))?.key as string
  const page = async (name: string, parent: string | null = null) => {
    const response = await admin.post(`${V1}/document`, {
      documentType: { id: typeKey },
      parent: parent ? { id: parent } : null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    if (response.status !== 201)
      throw new Error(`create ${response.status}: ${await response.text()}`)
    return response.headers.get('umb-generated-resource') as string
  }
  const picker = async (name: string, ignoreUserStartNodes: boolean) => {
    const response = await admin.post(`${V1}/data-type`, {
      name,
      editorAlias: 'Umbraco.ContentPicker',
      editorUiAlias: 'Umb.PropertyEditorUi.DocumentPicker',
      values: [{ alias: 'ignoreUserStartNodes', value: ignoreUserStartNodes }],
      parent: null,
    })
    if (response.status !== 201)
      throw new Error(`data type ${response.status}: ${await response.text()}`)
    return response.headers.get('umb-generated-resource') as string
  }
  return { admin, page, picker }
}

/** An editor whose only start node is `startNode`, with Read everywhere. */
async function editorUnder(admin: Harness, startNode: string) {
  const created = await admin.post(`${V1}/user-group`, {
    name: 'Branch editors',
    alias: 'branch',
    sections: ['Umb.Section.Content'],
    languages: [],
    hasAccessToAllLanguages: true,
    documentRootAccess: false,
    documentStartNode: { id: startNode },
    mediaRootAccess: false,
    mediaStartNode: null,
    elementRootAccess: false,
    elementStartNode: null,
    fallbackPermissions: ['Umb.Document.Read'],
    permissions: [],
  })
  expect(created.status).toBe(201)
  const editor = await signInAsGroup(admin, 'branch')
  open.push(editor)
  return editor
}

type Tree = { total: number; items: Array<{ id: string; noAccess: boolean }> }

describe('pickers that ignore a user’s start nodes', () => {
  test('the picker sees the whole tree; without it the editor sees their branch', async () => {
    const { admin, page, picker } = await site()
    const mine = await page('Mine')
    const theirs = await page('Theirs')
    const below = await page('Below theirs', theirs)
    const wide = await picker('Anywhere', true)
    const narrow = await picker('Within', false)
    const editor = await editorUnder(admin, mine)

    const ids = (tree: Tree) => tree.items.map((i) => i.id)
    const root = (query = '') =>
      editor.json<Tree>(`${V1}/tree/document/root?skip=0&take=100${query}`)
    expect(ids(await root())).toEqual([mine])
    expect(ids(await root(`&dataTypeId=${narrow}`))).toEqual([mine])
    expect(ids(await root(`&dataTypeId=${wide}`))).toEqual([mine, theirs])

    const children = (query = '') =>
      editor.call(`${V1}/tree/document/children?parentId=${theirs}&skip=0&take=100${query}`)
    expect(((await (await children()).json()) as Tree).total).toBe(0)
    const opened = (await (await children(`&dataTypeId=${wide}`)).json()) as Tree
    expect(ids(opened)).toEqual([below])

    const search = (query: string) =>
      editor.json<Tree>(`${V1}/item/document/search?query=Below&skip=0&take=100${query}`)
    expect((await search('')).total).toBe(0)
    expect(ids(await search(`&dataTypeId=${wide}`))).toEqual([below])

    // The list view below another branch is refused, except to the picker.
    const list = (query = '') =>
      editor.call(`${V1}/collection/document/${theirs}?skip=0&take=100${query}`)
    expect((await list()).status).toBe(403)
    expect((await list(`&dataTypeId=${narrow}`)).status).toBe(403)
    expect((await list(`&dataTypeId=${wide}`)).status).toBe(200)
  })

  test('only the picker’s reads are widened, and Read still applies', async () => {
    const { admin, page, picker } = await site()
    const mine = await page('Mine')
    const theirs = await page('Theirs')
    const wide = await picker('Anywhere', true)
    const editor = await editorUnder(admin, mine)

    // Opening the page itself is not a picker's read.
    expect((await editor.call(`${V1}/document/${theirs}?dataTypeId=${wide}`)).status).toBe(403)
    // A data type that does not exist widens nothing.
    const unknown = crypto.randomUUID()
    expect(
      (
        await editor.json<Tree>(`${V1}/tree/document/root?skip=0&take=100&dataTypeId=${unknown}`)
      ).items.map((i) => i.id),
    ).toEqual([mine])

    // Taking Read away on the other branch refuses its list even to the picker.
    const groups = await admin.json<{ items: Array<{ id: string; alias: string }> }>(
      `${V1}/user-group?take=100`,
    )
    const branch = groups.items.find((g) => g.alias === 'branch')?.id as string
    const group = await admin.json<Record<string, unknown>>(`${V1}/user-group/${branch}`)
    expect(
      (
        await admin.put(`${V1}/user-group/${branch}`, {
          ...group,
          permissions: [
            {
              $type: 'DocumentPermissionPresentationModel',
              document: { id: theirs },
              verbs: [],
            },
          ],
        })
      ).status,
    ).toBe(200)
    expect(
      (await editor.call(`${V1}/collection/document/${theirs}?skip=0&take=100&dataTypeId=${wide}`))
        .status,
    ).toBe(403)
  })

  test('the pickers report that they can ignore start nodes', async () => {
    const { admin, picker } = await site()
    const wide = await picker('Anywhere', true)
    expect(
      (await admin.json<{ canIgnoreStartNodes: boolean }>(`${V1}/data-type/${wide}`))
        .canIgnoreStartNodes,
    ).toBe(true)
  })
})
