/**
 * Story 445: a member a directory provisioned is changed only by that directory. A
 * member created by a client `members.managedBy` names remembers it; anyone else's
 * change is refused, administrators included, on every path that writes members; the
 * password, two-factor and an unlock stay the site's; the manager hands them back.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { MemberResponse, Principal, SaveMember } from '@crombolo/api-management'
import {
  AuditLog,
  MemberRepository,
  memberManagerMigration,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import {
  changeMember,
  changesOnlyTheSites,
  createSiteMembers,
  loadConfig,
  MANAGED_MEMBER,
  type MemberAdminError,
  mayChange,
  removeMember,
  siteMemberPorts,
  withSiteWrites,
} from '@crombolo/server'
import {
  applyMembersManaged,
  isManaged,
  LIST_MARK,
  MANAGED_FLAG,
  MANAGED_LINE,
  MANAGED_TABLE,
  managerLine,
} from '../packages/backoffice-host/plugin/members-managed.js'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const DIRECTORY = { id: 'crombolo-back-office-directory', secret: 'a-directory-secret-1' }

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

async function site(managedBy: string[] = [DIRECTORY.id]) {
  const h = await signedInServer({
    config: { apiClient: DIRECTORY, members: { managedBy } },
  })
  open.push(h)
  const granted = await h.server.fetch(
    new Request(`${ORIGIN}${V1}/security/back-office/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DIRECTORY.id,
        client_secret: DIRECTORY.secret,
      }).toString(),
    }),
  )
  const { access_token } = (await granted.json()) as { access_token: string }
  const directory = (method: string, path: string, body?: unknown) =>
    h.server.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${access_token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  const memberBody = (name: string) => ({
    memberType: { id: SYSTEM_MEMBER_TYPE.key },
    email: `${name}@example.test`,
    username: name,
    password: 'correct-horse-battery',
    isApproved: true,
    groups: [],
    values: [],
    variants: [{ culture: null, segment: null, name }],
  })
  const made = async (response: Response) => {
    expect(response.status, await response.clone().text()).toBe(201)
    return response.headers.get('umb-generated-resource') as string
  }
  const fromDirectory = async (name: string) =>
    made(await directory('POST', `${V1}/member`, memberBody(name)))
  const bySite = async (name: string) => made(await h.post(`${V1}/member`, memberBody(name)))
  const read = (key: string) => h.json<MemberResponse>(`${V1}/member/${key}`)
  /** The member as stored, sent back with `change` on top: what an editor's save sends. */
  const saved = async (key: string, change: Record<string, unknown> = {}) => {
    const member = await read(key)
    return {
      email: member.email,
      username: member.username,
      isApproved: member.isApproved,
      isLockedOut: member.isLockedOut,
      isTwoFactorEnabled: member.isTwoFactorEnabled,
      groups: member.groups,
      values: member.values,
      variants: member.variants,
      ...change,
    }
  }
  const manager = (key: string) => `${BACKOFFICE}/crombolo/api/members/${key}/manager`
  return { h, directory, fromDirectory, bySite, read, saved, manager }
}

describe('the setting', () => {
  test('is read from the environment, and a bad one in the config file is refused', () => {
    const before = process.env.CROMBOLO_MEMBERS_MANAGED_BY
    try {
      process.env.CROMBOLO_MEMBERS_MANAGED_BY = ' a-client , b-client ,'
      expect(loadConfig({}).members?.managedBy).toEqual(['a-client', 'b-client'])
      expect(loadConfig({ members: { actAs: 'x' } }).members).toMatchObject({
        actAs: 'x',
        managedBy: ['a-client', 'b-client'],
      })
      expect(loadConfig({ members: { managedBy: ['c-client'] } }).members?.managedBy).toEqual([
        'c-client',
      ])
      delete process.env.CROMBOLO_MEMBERS_MANAGED_BY
      expect(loadConfig({}).members?.managedBy).toBeUndefined()
      expect(() => loadConfig({ members: { managedBy: [' '] } })).toThrow(
        'members.managedBy in crombolo.config.ts is a list of API client ids.',
      )
    } finally {
      if (before === undefined) delete process.env.CROMBOLO_MEMBERS_MANAGED_BY
      else process.env.CROMBOLO_MEMBERS_MANAGED_BY = before
    }
  })
})

describe('the rule', () => {
  test('a member with no manager is anyone’s; one with a manager is theirs alone', () => {
    expect(mayChange({ managedBy: null }, undefined)).toBe(true)
    expect(mayChange({ managedBy: null }, { viaClient: 'other' })).toBe(true)
    expect(mayChange({ managedBy: 'dir' }, { viaClient: 'dir' })).toBe(true)
    expect(mayChange({ managedBy: 'dir' }, { viaClient: 'other' })).toBe(false)
    expect(mayChange({ managedBy: 'dir' }, {})).toBe(false)
    expect(mayChange({ managedBy: 'dir' }, undefined)).toBe(false)
  })

  test('only the password, a second factor turned off and an unlock are the site’s', () => {
    const before = {
      email: 'a@example.test',
      username: 'a',
      isApproved: true,
      isLockedOut: true,
      groups: ['5F0A2C1E-0000-4000-8000-000000000001'],
      values: [
        { alias: 'n', culture: null, segment: null, value: { b: 1, a: 2 }, editorAlias: 'x' },
      ],
      variants: [{ culture: null, segment: null, name: 'A' }],
    } as unknown as MemberResponse
    const same: SaveMember = {
      key: 'k',
      memberTypeKey: '',
      email: 'a@example.test',
      username: 'a',
      password: 'a-new-password',
      isApproved: true,
      isLockedOut: false,
      isTwoFactorEnabled: false,
      groupKeys: ['5f0a2c1e-0000-4000-8000-000000000001'],
      values: [{ alias: 'n', culture: null, segment: null, value: { a: 2, b: 1 } }],
      variants: [{ culture: null, segment: null, name: 'A' }],
    }
    expect(changesOnlyTheSites(before, same)).toBe(true)
    expect(changesOnlyTheSites(before, { ...same, groupKeys: undefined })).toBe(true)
    for (const change of [
      { email: 'b@example.test' },
      { username: 'b' },
      { isApproved: false },
      { groupKeys: [] },
      { variants: [{ culture: null, segment: null, name: 'B' }] },
      { values: [] },
      { values: [{ alias: 'n', culture: null, segment: null, value: { a: 3, b: 1 } }] },
    ])
      expect([change, changesOnlyTheSites(before, { ...same, ...change })]).toEqual([change, false])
    expect(
      changesOnlyTheSites({ ...before, isLockedOut: false }, { ...same, isLockedOut: true }),
    ).toBe(false)
  })
})

describe(`members managed from outside the site (${dialectUnderTest})`, () => {
  test('a member the listed client creates remembers it, with the name it signs in as', async () => {
    const { fromDirectory, bySite, read } = await site()
    const kept = await read(await fromDirectory('kept'))
    expect(kept.managedBy?.clientId).toBe(DIRECTORY.id)
    expect(kept.managedBy?.name).toBeTruthy()
    expect(kept.flags).toEqual([{ alias: MANAGED_FLAG }])
    const own = await read(await bySite('own'))
    expect(own.managedBy).toBeNull()
    expect(own.flags).toEqual([])
  })

  test('a member an unlisted client creates has no manager', async () => {
    const { fromDirectory, read, h } = await site([])
    const key = await fromDirectory('unlisted')
    expect((await read(key)).managedBy).toBeNull()
    expect(
      (await h.put(`${V1}/member/${key}`, { ...(await read(key)), username: 'moved' })).status,
    ).toBe(200)
  })

  test("an administrator's change or delete is refused through the Management API, with the reason", async () => {
    const { h, fromDirectory, saved } = await site()
    const key = await fromDirectory('kept')
    for (const change of [
      { email: 'other@example.test' },
      { username: 'other' },
      { isApproved: false },
      { variants: [{ culture: null, segment: null, name: 'Other' }] },
    ]) {
      const refused = await h.put(`${V1}/member/${key}`, await saved(key, change))
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({
        detail: MANAGED_MEMBER,
        operationStatus: 'ManagedOutside',
      })
    }
    const group = await h.post(`${V1}/member-group`, { name: 'Customers' })
    const groupKey = group.headers.get('umb-generated-resource') as string
    expect(
      (await h.put(`${V1}/member/${key}`, await saved(key, { groups: [groupKey] }))).status,
    ).toBe(403)
    const deleted = await h.del(`${V1}/member/${key}`)
    expect(deleted.status).toBe(403)
    expect(await deleted.json()).toMatchObject({ operationStatus: 'ManagedOutside' })
    expect(await new MemberRepository(h.server.db).byKey(key)).toMatchObject({
      username: 'kept',
      isApproved: true,
    })
  })

  test('the password, the second factor and an unlock stay the site’s', async () => {
    const { h, fromDirectory, saved } = await site()
    const key = await fromDirectory('kept')
    const repository = new MemberRepository(h.server.db)
    await repository.recordFailedLogin(key, 1)
    expect((await repository.byKey(key))?.isLockedOut).toBe(true)
    const unlocked = await h.put(`${V1}/member/${key}`, await saved(key, { isLockedOut: false }))
    expect(unlocked.status, await unlocked.clone().text()).toBe(200)
    expect((await repository.byKey(key))?.isLockedOut).toBe(false)
    const stamp = (await repository.byKey(key))?.securityStamp
    const password = await h.put(
      `${V1}/member/${key}`,
      await saved(key, { newPassword: 'another-horse-battery', isTwoFactorEnabled: false }),
    )
    expect(password.status, await password.clone().text()).toBe(200)
    expect((await repository.byKey(key))?.securityStamp).not.toBe(stamp)
    expect(
      (await h.put(`${V1}/member/${key}`, await saved(key, { isLockedOut: true }))).status,
    ).toBe(403)
  })

  test('the manager changes, disables and deletes it as before', async () => {
    const { directory, fromDirectory, saved, read } = await site()
    const key = await fromDirectory('kept')
    const changed = await directory(
      'PUT',
      `${V1}/member/${key}`,
      await saved(key, { username: 'renamed', isApproved: false }),
    )
    expect(changed.status, await changed.clone().text()).toBe(200)
    expect(await read(key)).toMatchObject({ username: 'renamed', isApproved: false })
    expect((await directory('DELETE', `${V1}/member/${key}`)).status).toBe(200)
  })

  test("the site's own members are changed by anyone who may, as before", async () => {
    const { h, bySite, saved } = await site()
    const key = await bySite('own')
    expect(
      (await h.put(`${V1}/member/${key}`, await saved(key, { username: 'moved' }))).status,
    ).toBe(200)
    expect((await h.del(`${V1}/member/${key}`)).status).toBe(200)
  })

  test('the command line and the remote protocol refuse a change and a removal', async () => {
    const { h, fromDirectory, bySite } = await site()
    const kept = await fromDirectory('kept')
    const own = await bySite('own')
    const config = loadConfig({ members: { managedBy: [DIRECTORY.id] } })
    const ports = await siteMemberPorts(h.server.db, config)
    const admin = {
      id: crypto.randomUUID(),
      name: 'Admin',
      isAdmin: true,
      groups: [{ key: 'admin', alias: 'admin', defaults: [], granular: new Map() }],
    } as unknown as Principal
    const refusal = (run: Promise<unknown>) =>
      run.then(
        () => 'changed',
        (error: MemberAdminError) => `${error.kind}: ${error.message}`,
      )
    const nothing = `refused: Nothing was changed: ${MANAGED_MEMBER}`
    expect(await refusal(changeMember(ports, admin, kept, { name: 'Other' }))).toBe(nothing)
    expect(await refusal(changeMember(ports, admin, kept, { approved: false }))).toBe(nothing)
    expect(await refusal(removeMember(ports, admin, kept))).toBe(nothing)
    expect(
      await refusal(changeMember(ports, admin, kept, { password: 'a-new-horse-battery' })),
    ).toBe('changed')
    const viaDirectory = { ...admin, viaClient: DIRECTORY.id } as Principal
    expect(await refusal(changeMember(ports, viaDirectory, kept, { name: 'Other' }))).toBe(
      'changed',
    )
    expect(await refusal(changeMember(ports, admin, own, { name: 'Other' }))).toBe('changed')
  })

  test('site().members refuses the member, staff and jobs alike', async () => {
    const { h, fromDirectory, bySite } = await site()
    const kept = await fromDirectory('kept')
    const own = await bySite('own')
    const group = await h.post(`${V1}/member-group`, { name: 'Readers' })
    expect(group.status).toBe(201)
    const build = createSiteMembers({
      db: h.server.db,
      nodeState: h.server.schema.nodeState,
      groups: { selfService: ['Readers'] },
      actAs: DIRECTORY.id,
    })
    const inRoute = <T>(run: () => T) =>
      withSiteWrites({ via: 'route POST /x', source: 'request' }, run)
    const asMember = (key: string, username: string) =>
      build(async () => ({
        kind: 'member',
        key,
        name: username,
        username,
        email: `${username}@example.test`,
      }))
    const staff = build(async () => ({
      kind: 'user',
      principal: {
        id: crypto.randomUUID(),
        name: 'Staff',
        allowedSections: ['Umb.Section.Members'],
        groups: [],
      } as unknown as Principal,
    }))
    const said = (result: { isOk(): boolean; message?: string; status?: number }) =>
      result.isOk() ? 'ok' : `${result.status} ${result.message}`
    const refused = `403 ${MANAGED_MEMBER}`
    const self = asMember(kept, 'kept')
    expect(said(await inRoute(() => self.update(kept, { name: 'Me' })))).toBe(refused)
    expect(said(await inRoute(() => self.addToGroups(kept, ['Readers'])))).toBe(refused)
    expect(said(await staff.update(kept, { name: 'Other' }))).toBe(refused)
    expect(said(await staff.removeFromGroups(kept, ['Readers']))).toBe(refused)
    expect(said(await staff.delete(kept))).toBe(refused)
    // A job acts as an API user, never as the directory, even under its client id.
    const inJob = <T>(run: () => T) => withSiteWrites({ via: 'job work.run', source: 'job' }, run)
    expect(said(await inJob(() => staff.update(kept, { name: 'Other' })))).toBe(refused)
    expect(said(await inJob(() => staff.update(own, { name: 'Other' })))).toBe('ok')
    expect((await self.me()).isOk()).toBe(true)
    const theirOwn = asMember(own, 'own')
    expect(said(await inRoute(() => theirOwn.update(own, { name: 'Me' })))).toBe('ok')
    expect(said(await inRoute(() => theirOwn.addToGroups(own, ['Readers'])))).toBe('ok')
    expect(said(await staff.delete(own))).toBe('ok')
  })

  test('the member’s own reset still sets their password', async () => {
    const { h, fromDirectory } = await site()
    const key = await fromDirectory('kept')
    const repository = new MemberRepository(h.server.db)
    expect(await repository.resetPassword(key, 'a-hash', '{}')).toBe(true)
    expect((await repository.byKey(key))?.passwordHash).toBe('a-hash')
  })
})

describe(`handing a member back (${dialectUnderTest})`, () => {
  test('only the manager clears it, audited, and the member is the site’s own after', async () => {
    const { h, directory, fromDirectory, saved, read, manager } = await site()
    const key = await fromDirectory('kept')
    const shown = await h.json<{ managedBy: { clientId: string; name: string } | null }>(
      manager(key),
    )
    expect(shown.managedBy?.clientId).toBe(DIRECTORY.id)
    expect(managerLine(shown.managedBy)).toBe(
      `Kept by ${shown.managedBy?.name}: changes are made there.`,
    )

    const refused = await h.del(manager(key))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ message: MANAGED_MEMBER })
    expect((await read(key)).managedBy).not.toBeNull()

    expect((await directory('DELETE', manager(key))).status).toBe(204)
    expect((await read(key)).managedBy).toBeNull()
    expect((await h.json<{ managedBy: unknown }>(manager(key))).managedBy).toBeNull()
    expect(
      (await h.put(`${V1}/member/${key}`, await saved(key, { username: 'site' }))).status,
    ).toBe(200)
    const audited = (
      await new AuditLog(h.server.db).query({}, { skip: 0, take: 100 })
    ).items.filter((entry) => entry.entityKey === key && entry.action === 'HandBack')
    expect(audited).toHaveLength(1)
    expect(audited[0]?.detail).toContain(DIRECTORY.id)
    expect((await h.del(manager(key))).status).toBe(204)
    expect((await h.call(manager(crypto.randomUUID()))).status).toBe(404)
  })
})

describe(`the migration (${dialectUnderTest})`, () => {
  test('adds member.managed_by, empty for every member there was', async () => {
    const { h, bySite } = await site()
    const key = await bySite('before')
    const db = h.server.db
    await db.exec('ALTER TABLE member DROP COLUMN managed_by')
    await memberManagerMigration.up(db)
    expect((await new MemberRepository(db).byKey(key))?.managedBy).toBeNull()
    expect(memberManagerMigration).toMatchObject({ name: 'AddMemberManager', kind: 'expand' })
  })
})

describe('the Members section', () => {
  test('a managed member is marked in the list, read-only with the line, and Save is held back', () => {
    const registered: Array<{ alias: string }> = []
    const appended: Array<[string, { alias: string }]> = []
    applyMembersManaged({
      register: (manifest: { alias: string }) => registered.push(manifest),
      appendCondition: (alias: string, condition: { alias: string }) =>
        appended.push([alias, condition]),
    })
    expect(registered.map((m) => m.alias)).toEqual([
      'Crombolo.Condition.Member.NotManaged',
      'Crombolo.WorkspaceContext.MemberManaged',
      MANAGED_LINE.alias,
      MANAGED_TABLE.alias,
    ])
    expect(appended).toEqual([
      ['Umb.WorkspaceAction.Member.Save', { alias: 'Crombolo.Condition.Member.NotManaged' }],
    ])
    expect(MANAGED_TABLE.overwrites).toEqual(['Umb.CollectionView.Member.Table'])
    expect(isManaged({ flags: [{ alias: MANAGED_FLAG }] })).toBe(true)
    expect(isManaged({ flags: [] })).toBe(false)
    expect(LIST_MARK).toBe('Kept by a directory')
    expect(managerLine(null)).toBeNull()
    expect(managerLine({ clientId: 'c', name: 'Staff directory' })).toBe(
      'Kept by Staff directory: changes are made there.',
    )
  })
})
