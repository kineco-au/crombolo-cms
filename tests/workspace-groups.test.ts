/**
 * Story 451: a workspace shared with user groups. A group is stored on the workspace, not
 * expanded to its people, so access follows the group's membership: someone added to it
 * later is in the workspace, and someone removed from it no longer is. Only the owner
 * shares or unshares, each change is audited, and a discard takes the group rows with it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import type { Principal } from '@crombolo/api-management/domain'
import {
  type Db,
  isWorkspaceMember,
  UserGroupRepository,
  UserRepository,
  WorkspaceRepository,
  workspaceGroupsMigration,
} from '@crombolo/data'
import { mayUse } from '../packages/server/src/workspaces.ts'
import { dialectUnderTest, migratedDb } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`

const dbs: Db[] = []
const open: Harness[] = []
afterEach(async () => {
  while (dbs.length > 0) await dbs.pop()?.close()
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

const OWNER = crypto.randomUUID()
const GROUP = crypto.randomUUID()
const OTHER_GROUP = crypto.randomUUID()

describe(`a workspace's groups in the repository (${dialectUnderTest})`, () => {
  test('are added once, listed, removed, and counted by forUser and membership', async () => {
    const db = await migratedDb()
    dbs.push(db)
    const workspaces = new WorkspaceRepository(db)
    const sale = await workspaces.open({ name: 'Spring sale', ownerKey: OWNER })
    expect(sale.groupKeys).toEqual([])
    expect(await workspaces.addGroup(sale.id, GROUP.toUpperCase())).toBe(true)
    expect(await workspaces.addGroup(sale.id, GROUP)).toBe(false)
    expect(await workspaces.addGroup(sale.id, OTHER_GROUP)).toBe(true)
    const shared = (await workspaces.byKey(sale.key)) as NonNullable<
      Awaited<ReturnType<WorkspaceRepository['byKey']>>
    >
    expect([...shared.groupKeys].sort()).toEqual([GROUP, OTHER_GROUP].sort())

    const someone = crypto.randomUUID()
    expect(await workspaces.forUser(someone)).toEqual([])
    expect(await workspaces.forUser(someone, [crypto.randomUUID()])).toEqual([])
    expect((await workspaces.forUser(someone, [GROUP])).map((w) => w.key)).toEqual([sale.key])
    expect(isWorkspaceMember(shared, someone, [GROUP])).toBe(true)
    expect(isWorkspaceMember(shared, someone)).toBe(false)
    expect(isWorkspaceMember(shared, OWNER)).toBe(true)

    expect(await workspaces.removeGroup(sale.id, GROUP)).toBe(true)
    expect(await workspaces.removeGroup(sale.id, GROUP)).toBe(false)
    expect(await workspaces.forUser(someone, [GROUP])).toEqual([])
    expect((await workspaces.byKey(sale.key))?.groupKeys).toEqual([OTHER_GROUP])

    await workspaces.discard(sale.id, OWNER)
    expect(await db.q.selectFrom('workspace_group').selectAll().execute()).toEqual([])
  })

  test('mayUse counts the principal’s groups', async () => {
    const db = await migratedDb()
    dbs.push(db)
    const workspaces = new WorkspaceRepository(db)
    const sale = await workspaces.open({ name: 'Spring sale', ownerKey: OWNER })
    await workspaces.addGroup(sale.id, GROUP)
    const found = (await workspaces.byKey(sale.key)) as NonNullable<
      Awaited<ReturnType<WorkspaceRepository['byKey']>>
    >
    const principal = (groupKeys: string[]) =>
      ({ id: crypto.randomUUID(), groupKeys }) as unknown as Principal
    expect(mayUse(found, principal([GROUP]))).toBe(true)
    expect(mayUse(found, principal([OTHER_GROUP]))).toBe(false)
    expect(mayUse(found, principal([]))).toBe(false)
  })

  test('a deleted user group shares nothing any more', async () => {
    const db = await migratedDb()
    dbs.push(db)
    const groups = new UserGroupRepository(db)
    const translators = { key: crypto.randomUUID() }
    expect(
      await groups.save({
        key: translators.key,
        alias: 'translators',
        name: 'Translators',
        description: null,
        icon: null,
        sections: ['content'],
        languages: [],
        hasAccessToAllLanguages: true,
        startNodes: {
          document: { root: false, key: null },
          media: { root: false, key: null },
          element: { root: false, key: null },
        },
        permissions: [],
        granular: [],
      }),
    ).toBe('saved')
    const workspaces = new WorkspaceRepository(db)
    const sale = await workspaces.open({ name: 'Spring sale', ownerKey: OWNER })
    await workspaces.addGroup(sale.id, translators.key)
    await groups.delete(translators.key)
    expect((await workspaces.byKey(sale.key))?.groupKeys).toEqual([])
  })

  test('is added by an expand step, in this release', () => {
    expect(workspaceGroupsMigration).toMatchObject({
      name: 'AddWorkspaceGroups',
      kind: 'expand',
      release: '0.85.0',
    })
  })
})

describe(`a workspace shared with a group over HTTP (${dialectUnderTest})`, () => {
  const send = (who: Harness, method: string, path: string, body?: unknown) =>
    who.call(path, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const groupKey = async (h: Harness, alias: string) => {
    const groups = await h.json<{ items: { id: string; alias: string; name: string }[] }>(
      `${V1}/user-group?take=100`,
    )
    const found = groups.items.find((g) => g.alias === alias)
    if (!found) throw new Error(`No group ${alias}`)
    return { key: found.id.toLowerCase(), name: found.name }
  }
  const setup = async () => {
    const h = await signedInServer({ config: { workspaces: true } })
    open.push(h)
    const opened = await send(h, 'POST', WORKSPACES, { name: 'Spring sale' })
    expect(opened.status).toBe(201)
    const sale = (await opened.json()) as { key: string }
    return { h, sale }
  }

  test('only its owner shares and unshares, an unknown group is refused, and each is audited', async () => {
    const { h, sale } = await setup()
    const writers = await groupKey(h, 'writer')
    const writer = await signInAsGroup(h, 'writer')
    const writerKey = (await writer.json<{ id: string }>(`${V1}/user/current`)).id
    expect(
      (await send(writer, 'POST', `${WORKSPACES}/${sale.key}/groups`, { groupKey: writers.key }))
        .status,
    ).toBe(404)

    expect(
      (
        await send(h, 'POST', `${WORKSPACES}/${sale.key}/groups`, {
          groupKey: crypto.randomUUID(),
        })
      ).status,
    ).toBe(404)
    expect((await send(h, 'POST', `${WORKSPACES}/${sale.key}/groups`, {})).status).toBe(400)

    const shared = await send(h, 'POST', `${WORKSPACES}/${sale.key}/groups`, {
      groupKey: writers.key.toUpperCase(),
    })
    expect(shared.status).toBe(200)
    expect(await shared.json()).toMatchObject({ groupKeys: [writers.key], memberKeys: [] })
    expect(await h.json(`${WORKSPACES}/${sale.key}`)).toMatchObject({ groupKeys: [writers.key] })

    // A member through the group works in it, and does not share or unshare it.
    expect(
      (await send(writer, 'POST', `${WORKSPACES}/${sale.key}/groups`, { groupKey: writers.key }))
        .status,
    ).toBe(403)
    expect(
      (await send(writer, 'DELETE', `${WORKSPACES}/${sale.key}/groups/${writers.key}`)).status,
    ).toBe(403)

    const members = await h.json<{
      items: Array<{ key: string; owner: boolean }>
      groups: Array<{ key: string; name: string }>
    }>(`${WORKSPACES}/${sale.key}/members`)
    expect(members.groups).toEqual([{ key: writers.key, name: writers.name }])
    expect(members.items).toEqual([expect.objectContaining({ owner: true })])
    expect(members.items.some((m) => m.key === writerKey)).toBe(false)

    expect(
      (await send(h, 'DELETE', `${WORKSPACES}/${sale.key}/groups/${writers.key}`)).status,
    ).toBe(204)
    expect(
      (await send(h, 'DELETE', `${WORKSPACES}/${sale.key}/groups/${writers.key}`)).status,
    ).toBe(404)
    expect(await h.json(`${WORKSPACES}/${sale.key}`)).toMatchObject({ groupKeys: [] })

    const audited = await h.server.db.query<{ action: string; detail: string }>(
      `SELECT action, detail FROM audit_entry WHERE entity_key = ? AND action IN ('Share', 'Unshare') ORDER BY id`,
      [sale.key],
    )
    expect(audited).toEqual([
      { action: 'Share', detail: `Shared with the group "${writers.name}" (${writers.key})` },
      {
        action: 'Unshare',
        detail: `No longer shared with the group "${writers.name}" (${writers.key})`,
      },
    ])
  })

  test('access follows the group: added later sees it, removed loses it', async () => {
    const { h, sale } = await setup()
    const writers = await groupKey(h, 'writer')
    const someone = await signInAsGroup(h, 'editor', 'later@example.com')
    const someoneKey = (await someone.json<{ id: string }>(`${V1}/user/current`)).id
    expect(
      (await send(h, 'POST', `${WORKSPACES}/${sale.key}/groups`, { groupKey: writers.key })).status,
    ).toBe(200)
    const listed = async () =>
      (await someone.json<{ items: Array<{ key: string; member?: boolean }> }>(WORKSPACES)).items
    expect((await listed()).some((w) => w.key === sale.key)).toBe(false)
    expect((await someone.call(`${WORKSPACES}/${sale.key}`)).status).toBe(404)

    const users = new UserRepository(h.server.db)
    await users.addToGroup(writers.key, [someoneKey])
    expect(await listed()).toContainEqual(expect.objectContaining({ key: sale.key, member: true }))
    expect((await someone.call(`${WORKSPACES}/${sale.key}`)).status).toBe(200)
    expect((await someone.call(`${WORKSPACES}/${sale.key}/marks`)).status).toBe(200)
    const tree = () =>
      someone.call(`${V1}/tree/document/root`, { headers: { 'crombolo-workspace': sale.key } })
    expect((await tree()).status).toBe(200)

    await users.removeFromGroup(writers.key, [someoneKey])
    expect((await listed()).some((w) => w.key === sale.key)).toBe(false)
    expect((await someone.call(`${WORKSPACES}/${sale.key}`)).status).toBe(404)
    expect((await tree()).status).toBe(404)
  })

  test('share-options lists every enabled user and every group, by name, for any editor', async () => {
    const { h } = await setup()
    const editor = await signInAsGroup(h, 'editor', 'ed@example.com')
    const options = await editor.json<{
      users: Array<{ key: string; name: string; email: string }>
      groups: Array<{ key: string; name: string }>
    }>(`${WORKSPACES}/share-options`)
    expect(options.users).toContainEqual(
      expect.objectContaining({ name: 'ed@example.com', email: 'ed@example.com' }),
    )
    const all = await new UserGroupRepository(h.server.db).all()
    expect(options.groups.map((g) => g.key).sort()).toEqual(
      all.map((g) => g.key.toLowerCase()).sort(),
    )
    for (const list of [options.users, options.groups]) {
      expect(list.every((one) => one.key === one.key.toLowerCase())).toBe(true)
      const names = list.map((one) => one.name)
      expect(names).toEqual(
        [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })),
      )
    }

    // A disabled one is left out.
    const disabled = options.users.find((u) => u.email === 'ed@example.com') as { key: string }
    await new UserRepository(h.server.db).setApproved([disabled.key], false)
    const after = await h.json<{ users: Array<{ key: string }> }>(`${WORKSPACES}/share-options`)
    expect(after.users.some((u) => u.key === disabled.key)).toBe(false)

    const signedOut = await h.server.fetch(new Request(`${ORIGIN}${WORKSPACES}/share-options`))
    expect(signedOut.status).toBe(401)
  })
})
