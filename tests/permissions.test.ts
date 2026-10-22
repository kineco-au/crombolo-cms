/**
 * The current user's permission verbs — what makes the backoffice show Create,
 * Publish, Delete — and the development log of operations still answering 501.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { hashPassword, passwordConfigJson } from '@crombolo/auth'
import {
  BUILT_IN_GROUP_PERMISSIONS,
  BUILT_IN_GROUPS,
  cromboloPlan,
  type Db,
  MIGRATION_STATE_KEY,
  migrate,
  STATE_APPROVAL_SCHEDULES,
  STATE_RECYCLE_BIN,
  seedIdentity,
} from '@crombolo/data'
import {
  onInit as hideMediaChanges,
  MEDIA_CHANGES,
  MEDIA_READ_ONLY,
  mayChangeMedia,
} from '../packages/backoffice-host/plugin/media-permissions.js'
import umbracoPackage from '../packages/backoffice-host/plugin/umbraco-package.json'
import { freshDb, undoMigrationsSinceContentEditing } from './support/db.ts'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
const dbs: Db[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dbs.length > 0)
    await dbs
      .pop()
      ?.close()
      .catch(() => {})
})

describe('permission verbs', () => {
  test("the administrator's fallback permissions are Umbraco's admin set, Create included", async () => {
    const h = await signedInServer()
    open.push(h)
    const me = await h.json<{ fallbackPermissions: string[]; permissions: unknown[] }>(
      `${V1}/user/current`,
    )
    expect(me.fallbackPermissions).toContain('Umb.Document.Create')
    expect(me.fallbackPermissions).toContain('Umb.Document.Publish')
    expect([...me.fallbackPermissions].sort()).toEqual(
      [...(BUILT_IN_GROUP_PERMISSIONS.admin ?? [])].sort(),
    )
    expect(me.permissions).toEqual([])
  })

  test('migration 007 grants the defaults to a database seeded without them, once', async () => {
    const db = await freshDb()
    dbs.push(db)
    await migrate(db, cromboloPlan)
    await seedIdentity(db, {
      admin: { name: 'A', login: 'a@b.c', email: 'a@b.c', password: 'x' },
      hashPassword,
      passwordConfig: passwordConfigJson(),
    })
    const count = async () =>
      Number(
        (await db.query<{ n: number }>('SELECT COUNT(*) AS n FROM user_group_permission'))[0]?.n,
      )
    const seeded = await count()
    const expected = Object.values(BUILT_IN_GROUP_PERMISSIONS).reduce(
      (n, list) => n + list.length,
      0,
    )
    expect(seeded).toBe(expected)

    // An older database: groups exist, permissions do not, and 007 has not run
    await db.exec('DELETE FROM user_group_permission')
    // …nor anything a later migration added
    await db.exec('DROP TABLE member_property_type')
    // …and before migration 010's tables
    await undoMigrationsSinceContentEditing(db)
    await db.exec("UPDATE key_value SET value = ? WHERE key = 'Crombolo.Core.Upgrader.State'", [
      STATE_RECYCLE_BIN,
    ])
    const result = await migrate(db, cromboloPlan)
    // 007, and whatever the plan has added since
    expect(result.applied[0]).toBe('GrantBuiltInGroupPermissions')
    expect(await count()).toBe(expected)
  })
})

describe('the media verbs (story 088)', () => {
  const MEDIA = ['Crombolo.Media.Read', 'Crombolo.Media.Update']

  test('every built-in group with the Media section is seeded with both, and no other', () => {
    for (const group of BUILT_IN_GROUPS) {
      const verbs = BUILT_IN_GROUP_PERMISSIONS[group.alias] ?? []
      const held = MEDIA.filter((verb) => verbs.includes(verb))
      expect([group.alias, held]).toEqual([
        group.alias,
        (group.sections as readonly string[]).includes('media') ? MEDIA : [],
      ])
    }
  })

  test('migration 045 gives both to every group that had the Media section, built-in or not', async () => {
    const db = await freshDb()
    dbs.push(db)
    await migrate(db, cromboloPlan)
    await seedIdentity(db, {
      admin: { name: 'A', login: 'a@b.c', email: 'a@b.c', password: 'x' },
      hashPassword,
      passwordConfig: passwordConfigJson(),
    })
    const now = new Date().toISOString()
    const custom = async (alias: string, section: string | null) => {
      const key = crypto.randomUUID()
      await db.exec(
        `INSERT INTO user_group (key, alias, name, has_access_to_all_languages, create_date, update_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [key, alias, alias, db.dialect.boolValue(true), now, now],
      )
      const id = (
        await db.query<{ id: number }>('SELECT id FROM user_group WHERE key = ?', [key])
      )[0]?.id
      if (section)
        await db.exec('INSERT INTO user_group_section (user_group_id, app_alias) VALUES (?, ?)', [
          id,
          section,
        ])
      return key
    }
    const librarians = await custom('librarians', 'media')
    const imported = await custom('imported', 'Umb.Section.Media')
    const authors = await custom('authors', 'content')
    // As 0.20.0 left it: nobody holds a media verb
    await db.exec(
      `DELETE FROM user_group_permission WHERE permission IN ('Crombolo.Media.Read', 'Crombolo.Media.Update')`,
    )
    await db.exec("DELETE FROM migration_history WHERE name = 'GrantMediaPermissions'")
    await db.exec('UPDATE key_value SET value = ? WHERE key = ?', [
      STATE_APPROVAL_SCHEDULES,
      MIGRATION_STATE_KEY,
    ])
    expect((await migrate(db, cromboloPlan)).applied).toEqual(['GrantMediaPermissions'])
    const held = async (key: string) =>
      (
        await db.query<{ permission: string }>(
          `SELECT permission FROM user_group_permission p WHERE p.user_group_key = ?
           AND permission LIKE 'Crombolo.Media.%' ORDER BY permission`,
          [key],
        )
      ).map((row) => row.permission)
    expect(await held(librarians)).toEqual(MEDIA)
    expect(await held(imported)).toEqual(MEDIA)
    expect(await held(authors)).toEqual([])
    for (const group of BUILT_IN_GROUPS)
      expect([group.alias, await held(group.key)]).toEqual([
        group.alias,
        (group.sections as readonly string[]).includes('media') ? MEDIA : [],
      ])
  })

  test('can be ticked in the user-group editor', () => {
    const permissions = umbracoPackage.extensions.filter(
      (e) => e.type === 'entityUserPermission' && e.forEntityTypes?.includes('media'),
    )
    expect(permissions.flatMap((e) => (e.meta as { verbs: string[] }).verbs)).toEqual(MEDIA)
  })

  test("the media library's changes are hidden from a user without Update", () => {
    const appended: Array<[string, unknown]> = []
    const registered: unknown[] = []
    hideMediaChanges(undefined, {
      appendCondition: (alias: string, condition: unknown) => appended.push([alias, condition]),
      register: (manifest: unknown) => registered.push(manifest),
    })
    expect(registered).toEqual([MEDIA_READ_ONLY])
    expect(appended.map(([alias]) => alias)).toEqual(MEDIA_CHANGES)
    for (const [, condition] of appended)
      expect(condition).toEqual({
        alias: 'Umb.Condition.UserPermission.Fallback',
        allOf: ['Crombolo.Media.Update'],
      })
    for (const alias of [
      'Umb.EntityAction.Media.Create',
      'Umb.EntityAction.Media.Delete',
      'Umb.EntityAction.Media.MoveTo',
      'Umb.EntityAction.Media.SortChildrenOf',
    ])
      expect(MEDIA_CHANGES).toContain(alias)
  })

  test('the media workspace is read only, name included, without Update', async () => {
    expect(mayChangeMedia(['Crombolo.Media.Read', 'Crombolo.Media.Update'])).toBe(true)
    expect(mayChangeMedia(['Crombolo.Media.Read'])).toBe(false)
    expect(mayChangeMedia(undefined)).toBe(false)
    expect(MEDIA_READ_ONLY).toMatchObject({
      type: 'workspaceContext',
      conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'Umb.Workspace.Media' }],
    })
    // What it leans on in the vendored client, so an upgrade that moves it fails here.
    const workspace = 'packages/backoffice-dist/dist/packages/media/media/workspace'
    expect(await Bun.file(`${workspace}/constants.js`).text()).toContain("'Umb.Workspace.Media'")
    const context = await Bun.file(`${workspace}/media-workspace.context.js`).text()
    expect(context).toContain('this.readOnlyGuard.addRule(')
    const loaded = await Bun.file('packages/backoffice-host/plugin/media-read-only.js').text()
    expect(loaded).toContain("from '@umbraco-cms/backoffice/media'")
    expect(loaded).toContain('export { CromboloMediaReadOnly as api }')
  })

  test('each action it hides is still one the vendored client registers', async () => {
    const { Glob } = await import('bun')
    let source = ''
    for await (const file of new Glob(
      'packages/backoffice-dist/dist/packages/media/**/manifests.js',
    ).scan('.'))
      source += await Bun.file(file).text()
    for (const alias of MEDIA_CHANGES)
      expect([alias, source.includes(`'${alias}'`)]).toEqual([alias, true])
  })
})

describe('the development 501 log', () => {
  test('records each missing operation once, counting repeats, and leaves implemented ones alone', async () => {
    const h = await signedInServer({ config: { development: true } })
    open.push(h)
    expect(h.server.notImplemented.entries()).toEqual([])
    await h.call(`${V1}/install/settings`)
    await h.call(`${V1}/install/settings`)
    await h.call(`${V1}/upgrade/settings`)
    await h.call(`${V1}/document-type/configuration`)
    const entries = h.server.notImplemented.entries()
    expect(entries.map((e) => [e.operationId, e.method, e.path, e.count])).toEqual([
      ['GetInstallSettings', 'GET', '/umbraco/management/api/v1/install/settings', 2],
      ['GetUpgradeSettings', 'GET', '/umbraco/management/api/v1/upgrade/settings', 1],
    ])
  })

  test('is not wired up in production', async () => {
    const h = await signedInServer({ config: { development: false } })
    open.push(h)
    expect((await h.call(`${V1}/install/settings`)).status).toBe(501)
    expect(h.server.notImplemented.entries()).toEqual([])
  })
})
