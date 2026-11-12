/**
 * Story 338: a user group is set up in levels, and the verbs story 338 took out
 * are rewritten wherever they were stored.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  DocumentPermissions as D,
  ElementPermissions as E,
  KNOWN_PERMISSIONS,
  kindVerbs,
  levelOfVerbs,
  levelsOf,
  levelVerbs,
  type PermissionKind,
  PRUNED_PERMISSIONS,
  withLevel,
  withoutPrunedPermissions,
} from '@crombolo/core'
import { type Db, prunedPermissionsMigration } from '@crombolo/data'
import { parseUserGroup } from '@crombolo/schema'
import {
  exceptionSentence,
  exceptionSummary,
  LEVELS,
  levelOf,
  libraryFollowsPages,
  OWNED_VERBS,
  withLevel as wordsWithLevel,
} from '../packages/backoffice-host/plugin/group-editor-words.js'
import { migratedDb } from './support/db.ts'

const KINDS: PermissionKind[] = ['pages', 'library', 'media', 'forms']

describe('levels', () => {
  test('each level reads back as itself, and each adds to the one before', () => {
    for (const kind of KINDS) {
      let before: string[] = []
      for (const level of levelsOf(kind)) {
        const verbs = levelVerbs(kind, level)
        expect([kind, level, levelOfVerbs(kind, verbs)]).toEqual([kind, level, level])
        expect(before.every((verb) => verbs.includes(verb))).toBe(true)
        before = verbs
      }
    }
  })

  test('any other set is custom, and other kinds are left alone', () => {
    expect(levelOfVerbs('pages', [D.Read, D.Delete])).toBe('custom')
    const mixed = [...levelVerbs('pages', 'full'), ...levelVerbs('media', 'see'), 'Acme.Thing']
    const narrowed = withLevel(mixed, 'pages', 'see')
    expect(levelOfVerbs('pages', narrowed)).toBe('see')
    expect(levelOfVerbs('media', narrowed)).toBe('see')
    expect(narrowed).toContain('Acme.Thing')
  })

  test('only Full control deletes, protects, sets hostnames or changes permissions', () => {
    const publish = levelVerbs('pages', 'publish')
    for (const verb of [D.Delete, D.PublicAccess, D.CultureAndHostnames, D.Permissions])
      expect([verb, publish.includes(verb), levelVerbs('pages', 'full').includes(verb)]).toEqual([
        verb,
        false,
        true,
      ])
  })

  test('every verb a level names is a verb a group can hold', () => {
    for (const kind of KINDS)
      for (const verb of kindVerbs(kind))
        expect([verb, KNOWN_PERMISSIONS.has(verb)]).toEqual([verb, true])
  })

  test('the editor offers exactly the levels the server defines', () => {
    for (const kind of KINDS) {
      expect(LEVELS[kind].map((level: { id: string }) => level.id)).toEqual([...levelsOf(kind)])
      for (const level of LEVELS[kind] as { id: string; verbs: string[] }[])
        expect([kind, level.id, [...level.verbs].sort()]).toEqual([
          kind,
          level.id,
          levelVerbs(kind, level.id as never).sort(),
        ])
      for (const verb of kindVerbs(kind)) expect(OWNED_VERBS.has(verb)).toBe(true)
    }
    const verbs = wordsWithLevel([], 'pages', 'edit')
    expect(levelOf('pages', verbs)).toBe('edit')
  })

  test('the Library follows Pages when it holds the same level', () => {
    const both = wordsWithLevel(wordsWithLevel([], 'pages', 'publish'), 'library', 'publish')
    expect(libraryFollowsPages(both)).toBe(true)
    expect(libraryFollowsPages(wordsWithLevel(both, 'library', 'see'))).toBe(false)
  })
})

describe('the words', () => {
  test('an exception says where, and what is different there', () => {
    const defaults = levelVerbs('pages', 'publish')
    expect(
      exceptionSentence({ kind: 'pages', name: 'Press releases', verbs: [D.Read] }, defaults),
    ).toEqual({
      where: 'Press releases',
      whereNote: 'and everything below it',
      what: 'Pages: See, instead of Edit and publish',
    })
    expect(
      exceptionSentence(
        { kind: 'field', typeName: 'Product', fieldName: 'Price', verbs: [] },
        defaults,
      ).what,
    ).toBe("Can see it but can't change it")
    expect(exceptionSummary('Editors', 'pages', 'News', 'see')).toBe(
      'Editors will see, but not change, pages under News.',
    )
  })
})

describe('pruned verbs (story 338)', () => {
  test('each is replaced or dropped, never left', () => {
    const before = [...Object.keys(PRUNED_PERMISSIONS), E.Read]
    const after = withoutPrunedPermissions(before)
    for (const verb of Object.keys(PRUNED_PERMISSIONS)) expect(after).not.toContain(verb)
    expect(after.sort()).toEqual([D.Create, E.Create, E.Delete, E.Move, E.Read, E.Update].sort())
    for (const verb of Object.keys(PRUNED_PERMISSIONS))
      expect(KNOWN_PERMISSIONS.has(verb)).toBe(false)
  })

  test('a group file naming one loads with its replacement', () => {
    const parsed = parseUserGroup(
      'old.toml',
      `[user-group]\nalias = "old"\nname = "Old"\npermissions = ["Umb.Document.Read", "Umb.Document.Notifications", "Umb.ElementContainer.Read", "Umb.Document.CreateBlueprint"]\n`,
    )
    expect(parsed.problems).toEqual([])
    expect(parsed.value?.permissions.sort()).toEqual([D.Create, D.Read, E.Read].sort())
  })
})

describe('migration 075 rewrites what groups hold', () => {
  const dbs: Db[] = []
  afterEach(async () => {
    while (dbs.length > 0) await dbs.pop()?.close()
  })

  test('defaults and per-page sets are rewritten, and a set left empty denies rather than widens', async () => {
    const db = await migratedDb()
    dbs.push(db)
    const group = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.q
      .insertInto('user_group')
      .values({
        key: group,
        alias: 'pruned',
        name: 'Pruned',
        has_access_to_all_languages: db.dialect.boolValue(true) as boolean,
        create_date: now,
        update_date: now,
      } as never)
      .execute()
    for (const permission of [
      'Umb.Document.Read',
      'Umb.Document.Notifications',
      'Umb.ElementContainer.Update',
      'Umb.Element.Update',
    ])
      await db.q
        .insertInto('user_group_permission')
        .values({ user_group_key: group, permission })
        .execute()
    const page = crypto.randomUUID()
    const field = crypto.randomUUID()
    const granular = [
      { unique_id: page, context: 'Document', permission: 'Umb.Document.Notifications' },
      { unique_id: page, context: 'Document', permission: 'Umb.Document.CreateBlueprint' },
      {
        unique_id: field,
        context: 'DocumentTypeProperty',
        permission: 'Umb.Document.PropertyValue.Read',
      },
    ]
    for (const row of granular)
      await db.q
        .insertInto('user_group_granular_permission')
        .values({ user_group_key: group, ...row })
        .execute()

    await prunedPermissionsMigration.up(db)

    const defaults = await db.q
      .selectFrom('user_group_permission')
      .select('permission')
      .where('user_group_key', '=', group)
      .execute()
    expect(defaults.map((r) => r.permission).sort()).toEqual([
      'Umb.Document.Read',
      'Umb.Element.Update',
    ])
    const rows = await db.q
      .selectFrom('user_group_granular_permission')
      .select(['unique_id', 'permission'])
      .where('user_group_key', '=', group)
      .execute()
    const of = (id: string) => rows.filter((r) => r.unique_id === id).map((r) => r.permission)
    expect(of(page)).toEqual(['Umb.Document.Create'])
    // A field that only held Read is now an explicit "nothing", not a fall back to the defaults
    expect(of(field)).toEqual([''])
  })
})
