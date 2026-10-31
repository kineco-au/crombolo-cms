/**
 * Story 228: user groups a site declares in `schema/user-groups/`. The file
 * owns what a group is; each environment's Users section keeps where it starts
 * and who is in it. In development a save writes the file back; elsewhere the
 * file's fields are read-only.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { UserGroupRepository } from '@crombolo/data'
import { parseUserGroup, writeUserGroup } from '@crombolo/schema'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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

const SUB_EDITORS = `[user-group]
alias = "subEditors"
name = "Sub-editors"
icon = "icon-edit"
sections = ["content", "media"]
permissions = ["Umb.Document.Read", "Umb.Document.Update"]
languages = "all"
`

async function site(schemaWritable: boolean) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'user-groups-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'user-groups'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'user-groups', 'sub-editors.toml'), SUB_EDITORS)
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), schemaWritable },
  })
  open.push(h)
  const groups = new UserGroupRepository(h.server.db)
  const group = (await groups.byAlias('subEditors')) as NonNullable<
    Awaited<ReturnType<UserGroupRepository['byAlias']>>
  >
  const read = () => h.json<Record<string, unknown>>(`${V1}/user-group/${group.key}`)
  const put = (body: Record<string, unknown>) => h.put(`${V1}/user-group/${group.key}`, body)
  return { h, root, groups, group, read, put }
}

describe('a user group file', () => {
  test('reads, writes back the same, and refuses what a group cannot hold', () => {
    const parsed = parseUserGroup('sub-editors.toml', SUB_EDITORS)
    expect(parsed.problems).toEqual([])
    expect(parsed.value).toMatchObject({ alias: 'subEditors', languages: 'all' })
    expect(writeUserGroup(parsed.value as never)).toBe(SUB_EDITORS)
    const bad = parseUserGroup(
      'x.toml',
      `[user-group]\nalias = "admin"\nname = "x"\nsections = ["nowhere"]\npermissions = ["Umb.Document.Fly"]\n`,
    )
    const said = bad.problems.map((p) => p.message).join('\n')
    expect(said).toContain('administrators group is built in')
    expect(said).toContain('"nowhere" is not a section')
    expect(said).toContain('"Umb.Document.Fly" is not a permission verb')
  })
})

describe('a declared group', () => {
  test('exists after the boot with what its file says', async () => {
    const { group } = await site(false)
    expect(group).toMatchObject({
      name: 'Sub-editors',
      icon: 'icon-edit',
      hasAccessToAllLanguages: true,
    })
    expect(group.sections.sort()).toEqual(['content', 'media'])
    expect(group.permissions.sort()).toEqual(['Umb.Document.Read', 'Umb.Document.Update'])
  })

  test('outside development: its start node is changed in Users, its file fields are not', async () => {
    const { h, group, groups, read, put } = await site(false)
    const before = await read()
    expect(before.isDeletable).toBe(false)
    expect(before.aliasCanBeChanged).toBe(false)
    expect((await put({ ...before, documentRootAccess: true })).status).toBe(200)
    expect((await groups.byKey(group.key))?.startNodes.document.root).toBe(true)
    const renamed = await put({ ...(await read()), name: 'Copy desk' })
    expect(renamed.status).toBe(409)
    expect(JSON.stringify(await renamed.json())).toContain("comes from the site's files")
    expect((await groups.byKey(group.key))?.name).toBe('Sub-editors')
    const removed = await h.call(`${V1}/user-group/${group.key}`, { method: 'DELETE' })
    expect(removed.status).toBe(409)
  })

  test('in development: a save writes the file back, without its start node', async () => {
    const { root, read, put } = await site(true)
    expect(
      (await put({ ...(await read()), name: 'Copy desk', documentRootAccess: true })).status,
    ).toBe(200)
    const file = readFileSync(join(root, 'schema', 'user-groups', 'sub-editors.toml'), 'utf8')
    expect(file).toContain('name = "Copy desk"')
    expect(file).not.toContain('root')
  })

  test('the sync keeps its start node and per-page permissions, and only writes a change', async () => {
    const { group, groups } = await site(false)
    await groups.save({
      ...group,
      startNodes: { ...group.startNodes, document: { root: true, key: null } },
    })
    const declared = parseUserGroup('sub-editors.toml', SUB_EDITORS).value as never
    expect(await groups.syncDeclared([declared])).toEqual({ created: [], updated: [] })
    const renamed = { ...(declared as object), name: 'Copy desk' } as never
    expect(await groups.syncDeclared([renamed])).toEqual({ created: [], updated: ['subEditors'] })
    const after = await groups.byKey(group.key)
    expect(after?.name).toBe('Copy desk')
    expect(after?.startNodes.document.root).toBe(true)
    await expect(
      groups.syncDeclared([{ ...(declared as object), languages: ['xx-XX'] } as never]),
    ).rejects.toThrow('names a language the site does not have')
  })
})
