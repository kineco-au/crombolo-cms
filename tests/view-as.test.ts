/**
 * Story 314: an administrator's session seen as user groups, for an hour.
 * Everything the session does is the groups' (sections, verbs, start nodes,
 * languages, approval stages) while their other sessions stay their own, and
 * every entry it writes says whose groups it was seen as.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ContentTypeRepository,
  DbDate,
  detailInContext,
  type UserGroupRecord,
  UserGroupRepository,
} from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import {
  ADMIN,
  BACKOFFICE,
  type Harness,
  signedInServer,
  signIn,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const VIEW_AS = `${BACKOFFICE}/crombolo/api/view-as`
const APPROVALS = `${BACKOFFICE}/crombolo/api/approvals`

const POLICY_TOML = `[content-type]
alias = "policy"
name = "Policy"
allow-at-root = true
allow-children = ["policy"]
components = ["policy"]
default-component = "policy"

[[property]]
alias = "body"
name = "Body"
type = "textarea"
`

const WORKFLOW_TOML = `[workflow]
alias = "sign-off"
name = "Sign-off"
applies-to = { branches = [], content-types = ["policy"] }
publishers-may-skip = false
on-edit = "withdraw"
self-approval = "automatic"
comments = "on-send-back"
unpublish = true
on-change = "restart"

[[stage]]
alias = "legal"
approvers = ["legal"]
next = ["final"]

[[stage]]
alias = "final"
approvers = ["admin"]
`

interface CurrentUser {
  id: string
  isAdmin: boolean
  allowedSections: string[]
  userGroupIds: Array<{ id: string }>
  fallbackPermissions: string[]
  documentStartNodeIds: Array<{ id: string }>
  hasDocumentRootAccess: boolean
  languages: string[]
  hasAccessToAllLanguages: boolean
}

interface Status {
  viewing: { groups: Array<{ key: string; name: string }>; until: string } | null
  allowed: boolean
  groups: Array<{ key: string; name: string }>
}

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

/** A site with a Policy type under a workflow, and the groups to view as. */
async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'view-as-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'schema', 'workflows'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'policy.toml'), POLICY_TOML)
  writeFileSync(join(root, 'schema', 'workflows', 'sign-off.toml'), WORKFLOW_TOML)
  writeFileSync(join(root, 'components', 'policy.tsx'), 'export default () => <main />\n')
  const admin = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(admin)
  const groups = new UserGroupRepository(admin.server.db)
  const byAlias = async (alias: string) => (await groups.byAlias(alias)) as UserGroupRecord
  const writer = await byAlias('writer')
  const legal = { ...writer, key: crypto.randomUUID(), alias: 'legal', name: 'Legal' }
  expect(await groups.save({ ...legal, sections: [...writer.sections, 'workflow'] })).toBe('saved')
  const typeKey = (await new ContentTypeRepository(admin.server.db).byAlias('policy'))
    ?.key as string
  const page = async (name: string, by: Harness = admin, parent: string | null = null) => {
    const created = await by.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: parent ? { id: parent } : null,
      values: [{ alias: 'body', culture: null, segment: null, value: `${name} text` }],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status, await created.clone().text()).toBe(201)
    return created.headers.get('umb-generated-resource') as string
  }
  const viewAs = (by: Harness, ...keys: string[]) => by.post(VIEW_AS, { groups: keys })
  const current = (by: Harness) => by.json<CurrentUser>(`${V1}/user/current`)
  const audit = async (userKey: string) =>
    (
      await admin.server.db.query<{ action: string; detail: string | null }>(
        'SELECT action, detail FROM audit_entry WHERE user_key = ? ORDER BY id',
        [userKey],
      )
    ).map((row) => ({ action: row.action, detail: row.detail }))
  return { admin, groups, byAlias, page, viewAs, current, audit }
}

describe(`viewing the back office as a group (${dialectUnderTest})`, () => {
  test("the session takes the groups' sections and verbs, and the administrators' do not apply", async () => {
    const { admin, byAlias, viewAs, current } = await site()
    const writer = await byAlias('writer')
    const before = await admin.json<Status>(VIEW_AS)
    expect(before.viewing).toBeNull()
    expect(before.allowed).toBe(true)
    expect(before.groups.map((g) => g.name)).toContain('Writers')

    const started = await viewAs(admin, writer.key)
    expect(started.status).toBe(200)
    const status = (await started.json()) as Status
    expect(status.viewing?.groups).toEqual([{ key: writer.key, name: writer.name }])
    const until = Date.parse(status.viewing?.until ?? '') - Date.now()
    expect(until).toBeGreaterThan(59 * 60_000)
    expect(until).toBeLessThanOrEqual(60 * 60_000)

    const me = await current(admin)
    expect(me.isAdmin).toBe(false)
    expect(me.userGroupIds).toEqual([{ id: writer.key }])
    expect(me.allowedSections).not.toContain('Umb.Section.Settings')
    expect(me.allowedSections).not.toContain('Umb.Section.Users')
    expect(me.allowedSections).toContain('Umb.Section.Content')
    expect([...me.fallbackPermissions].sort()).toEqual([...writer.permissions].sort())
    // What the server allows follows, not only what the screens show.
    expect((await admin.call(`${V1}/user?take=10`)).status).toBe(403)
    expect((await admin.call(`${V1}/document-type/folder`, { method: 'POST' })).status).toBe(403)
    expect((await admin.json<Status>(VIEW_AS)).viewing?.groups[0]?.name).toBe(writer.name)
  })

  test('start nodes and languages are the groups’ own', async () => {
    const { admin, groups, byAlias, page, viewAs, current } = await site()
    const news = await page('News')
    const writer = await byAlias('writer')
    const desk = {
      ...writer,
      key: crypto.randomUUID(),
      alias: 'newsDesk',
      name: 'News desk',
      languages: ['en-US'],
      hasAccessToAllLanguages: false,
      startNodes: { ...writer.startNodes, document: { root: false, key: news } },
    }
    expect(await groups.save(desk)).toBe('saved')
    expect((await current(admin)).hasAccessToAllLanguages).toBe(true)

    expect((await viewAs(admin, desk.key)).status).toBe(200)
    const me = await current(admin)
    expect(me.documentStartNodeIds).toEqual([{ id: news }])
    expect(me.hasDocumentRootAccess).toBe(false)
    expect(me.hasAccessToAllLanguages).toBe(false)
    expect(me.languages).toEqual(['en-US'])
    // Under the start node a page may be made; at the root, outside it, not.
    await page('Story', admin, news)
    const typeKey = (await new ContentTypeRepository(admin.server.db).byAlias('policy'))?.key
    const atRoot = await admin.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: null,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Elsewhere' }],
    })
    expect(atRoot.status).toBe(403)
  })

  test('viewing as several groups unions them, and the administrators group may be one', async () => {
    const { admin, byAlias, viewAs, current } = await site()
    const writer = await byAlias('writer')
    const administrators = await byAlias('admin')
    expect((await viewAs(admin, writer.key, administrators.key)).status).toBe(200)
    const me = await current(admin)
    expect(me.isAdmin).toBe(true)
    expect(me.userGroupIds.map((g) => g.id).sort()).toEqual([writer.key, administrators.key].sort())
    expect(me.allowedSections).toContain('Umb.Section.Settings')
  })

  test("another session of the same administrator is its own, and switching back ends this one's", async () => {
    const { admin, byAlias, viewAs, current } = await site()
    const other = await signIn(admin.server, ADMIN)
    open.push(other)
    expect((await viewAs(admin, (await byAlias('writer')).key)).status).toBe(200)
    expect((await current(admin)).isAdmin).toBe(false)
    expect((await current(other)).isAdmin).toBe(true)
    expect((await other.json<Status>(VIEW_AS)).viewing).toBeNull()

    const back = await admin.del(VIEW_AS)
    expect(back.status).toBe(200)
    expect(((await back.json()) as Status).viewing).toBeNull()
    expect((await current(admin)).isAdmin).toBe(true)
  })

  test('switching back works from a view that has no sections at all', async () => {
    const { admin, groups, byAlias, viewAs, current } = await site()
    const nothing = {
      ...(await byAlias('writer')),
      key: crypto.randomUUID(),
      alias: 'nothing',
      name: 'Nothing',
      sections: [],
      permissions: [],
    }
    expect(await groups.save(nothing)).toBe('saved')
    expect((await viewAs(admin, nothing.key)).status).toBe(200)
    expect((await current(admin)).allowedSections).toEqual([])
    expect((await admin.del(VIEW_AS)).status).toBe(200)
    expect((await current(admin)).isAdmin).toBe(true)
  })

  test('it ends by itself after the hour', async () => {
    const { admin, byAlias, viewAs, current } = await site()
    expect((await viewAs(admin, (await byAlias('writer')).key)).status).toBe(200)
    expect((await current(admin)).isAdmin).toBe(false)
    await admin.server.db.exec(
      'UPDATE user_login_session SET view_as_until = ? WHERE view_as_groups IS NOT NULL',
      [DbDate.toDb(new Date(Date.now() - 1000))],
    )
    expect((await current(admin)).isAdmin).toBe(true)
    expect((await admin.json<Status>(VIEW_AS)).viewing).toBeNull()
  })

  test('a non-administrator is refused, and is not offered it', async () => {
    const { admin, byAlias } = await site()
    const writer = await signInAsGroup(admin, 'writer')
    open.push(writer)
    expect(await writer.json<Status>(VIEW_AS)).toEqual({
      viewing: null,
      allowed: false,
      groups: [],
    })
    expect((await writer.post(VIEW_AS, { groups: [(await byAlias('admin')).key] })).status).toBe(
      403,
    )
    expect((await writer.json<CurrentUser>(`${V1}/user/current`)).isAdmin).toBe(false)
  })

  test('an administrator who is no longer one stops viewing, and is refused a new view', async () => {
    const { admin, byAlias, viewAs, current } = await site()
    const writer = await byAlias('writer')
    const other = await signIn(admin.server, ADMIN)
    open.push(other)
    expect((await viewAs(admin, writer.key)).status).toBe(200)
    const me = await current(other)
    // Moved out of the administrators group, into the writers.
    const administrators = await byAlias('admin')
    await admin.server.db.exec(
      `UPDATE user_group_member SET user_group_id = ?
       WHERE user_id = (SELECT id FROM user_account WHERE key = ?) AND user_group_id = ?`,
      [writer.id, me.id, administrators.id],
    )
    const status = await admin.json<Status>(VIEW_AS)
    expect(status.viewing).toBeNull()
    expect(status.allowed).toBe(false)
    expect((await viewAs(admin, writer.key)).status).toBe(403)
  })

  test('choosing no group, or none that exists, is refused', async () => {
    const { admin, viewAs } = await site()
    expect((await viewAs(admin)).status).toBe(400)
    expect((await viewAs(admin, crypto.randomUUID())).status).toBe(400)
    expect((await admin.post(VIEW_AS, { groups: 'writer' })).status).toBe(400)
    expect((await admin.call(VIEW_AS, { method: 'PUT' })).status).toBe(405)
  })

  test("starting, what is changed while viewing, and switching back are audited with the groups' names", async () => {
    const { admin, byAlias, page, viewAs, current, audit } = await site()
    const me = (await current(admin)).id
    const legal = await byAlias('legal')
    expect((await viewAs(admin, legal.key)).status).toBe(200)
    const made = await page('Privacy')
    expect((await admin.del(VIEW_AS)).status).toBe(200)
    await page('Terms')

    const entries = await audit(me)
    expect(entries).toContainEqual({ action: 'Started viewing as', detail: 'Legal' })
    expect(entries).toContainEqual({ action: 'Switched back', detail: 'from viewing as Legal' })
    const creates = entries.filter((e) => e.action === 'Create')
    expect(creates).toHaveLength(2)
    expect(creates[0]?.detail).toBe('While viewing as Legal')
    expect(creates[1]?.detail ?? '').not.toContain('viewing as')
    expect(made).toBeTruthy()
  })

  test("an automatic self-approval counts the viewed groups, not the administrator's own", async () => {
    const { admin, byAlias, page, viewAs } = await site()
    const send = async (key: string) => {
      const response = await admin.post(`${APPROVALS}/page/${key}/send`, { action: 'publish' })
      expect(response.status, await response.clone().text()).toBe(200)
      const view = (await response.json()) as { stages: Array<{ alias: string; state: string }> }
      return Object.fromEntries(view.stages.map((s) => [s.alias, s.state]))
    }
    // As themselves, an administrator is not in Legal: its stage waits.
    expect((await send(await page('Own'))).legal).toBe('waiting')
    // Viewing as Legal, the change is theirs, so Legal's stage counts it.
    const viewed = await page('Viewed')
    expect((await viewAs(admin, (await byAlias('legal')).key)).status).toBe(200)
    expect(await send(viewed)).toMatchObject({ legal: 'approved', final: 'waiting' })
  })
})

describe('the audit context', () => {
  const context = {
    viewing: { userKey: '6f2b1f7e-1b1c-4d8e-9a41-1d2c3b4a5e6f', groups: 'Editors' },
  }

  test("adds the view to the viewer's own entries", () => {
    expect(detailInContext({ userKey: context.viewing.userKey, detail: null }, context)).toBe(
      'While viewing as Editors',
    )
    expect(
      detailInContext({ userKey: context.viewing.userKey, detail: 'Groups: X' }, context),
    ).toBe('Groups: X, while viewing as Editors')
  })

  test("leaves anyone else's, and a request with no view, alone", () => {
    expect(detailInContext({ userKey: crypto.randomUUID(), detail: 'd' }, context)).toBe('d')
    expect(detailInContext({ userKey: null, detail: 'd' }, context)).toBe('d')
    expect(detailInContext({ userKey: context.viewing.userKey, detail: 'd' }, {})).toBe('d')
    expect(detailInContext({ userKey: context.viewing.userKey, detail: 'd' }, undefined)).toBe('d')
  })
})
