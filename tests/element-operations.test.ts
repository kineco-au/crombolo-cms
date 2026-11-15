/**
 * Story 361: every Library write goes through the Library operations, so who
 * may and what is recorded do not depend on what started it — the back office
 * or the command line. Each write's verbs, its audit entry with the back
 * office's names, written once, for a user, an operator and the system.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  type Actor,
  createElementOperations,
  ELEMENT_VERBS,
  type ElementEvent,
  elementAuditFor,
  operatorActor,
  systemActor,
  userActor,
} from '@crombolo/content'
import {
  ElementPermissions as E,
  MENU_ALIAS_PROPERTY,
  ROOT_ACCESS,
  SYSTEM_CONTENT_TYPE_KEYS,
} from '@crombolo/core'
import { AuditLog, NodeRepository } from '@crombolo/data'
import { createElementEventSink, createElementPort } from '@crombolo/server'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

async function site() {
  const h = await signedInServer()
  open.push(h)
  const db = h.server.db
  const heard: ElementEvent[] = []
  const operations = createElementOperations({
    db,
    store: (tx) => createElementPort(tx, { nodeState: h.server.schema.nodeState }),
    events: {
      record: (tx, event, actor) => createElementEventSink().record(tx, event, actor),
      afterCommit: (event) => void heard.push(event),
    },
  })
  const menu = (name: string, alias?: string) => ({
    key: crypto.randomUUID(),
    contentTypeKey: SYSTEM_CONTENT_TYPE_KEYS.Menu,
    componentKey: null,
    parentKey: null as string | null,
    values:
      alias === undefined
        ? []
        : [{ alias: MENU_ALIAS_PROPERTY, culture: null, segment: null, value: alias }],
    variants: [{ culture: null, segment: null, name }],
  })
  const audit = async (key: string) =>
    (await new AuditLog(db).query({ entityKey: key, ascending: true }, { skip: 0, take: 50 })).items
  return { h, db, operations, heard, menu, audit }
}

/** A user whose groups hold these Library verbs, and nothing else in the Library. */
const holding = (verbs: readonly string[]): Actor =>
  userActor({
    id: crypto.randomUUID(),
    name: 'Lib',
    isAdmin: false,
    allowedSections: ['Umb.Section.Library'],
    hasAccessToAllLanguages: true,
    languages: [],
    startNodes: { document: ROOT_ACCESS, media: ROOT_ACCESS },
    groups: [{ key: 'g', alias: 'library', defaults: verbs, granular: new Map() }],
  })

describe('the audit entries', () => {
  test('each write is entered once, with the names the back office has always written', async () => {
    const { operations, heard, menu, audit } = await site()
    const actor = operatorActor('ops')
    const box = await operations.createFolder(actor, { name: 'Menus', parentKey: null })
    const other = await operations.createFolder(actor, { name: 'Old', parentKey: null })
    if (!box.ok || !other.ok) throw new Error('no folders')
    const made = await operations.create(actor, { ...menu('Main', 'main'), parentKey: box.key })
    if (!made.ok) throw new Error(made.reason)
    const key = made.key
    const input = { ...menu('Main navigation', 'main'), key, parentKey: box.key }
    expect((await operations.save(actor, key, input)).ok).toBe(true)
    expect((await operations.publish(actor, key, null)).ok).toBe(true)
    expect((await operations.saveAndPublish(actor, key, input, null)).ok).toBe(true)
    expect((await operations.unpublish(actor, key, null)).ok).toBe(true)
    const copied = await operations.copy(actor, key, other.key)
    expect(copied.ok).toBe(true)
    expect((await operations.move(actor, key, null)).ok).toBe(true)
    expect((await operations.trash(actor, key)).ok).toBe(true)
    expect((await operations.renameFolder(actor, other.key, 'Older')).ok).toBe(true)
    expect((await operations.moveFolder(actor, other.key, box.key)).ok).toBe(true)
    expect((await operations.trashFolder(actor, box.key)).ok).toBe(true)
    const published = await operations.createAndPublish(actor, menu('Footer', 'footer'), null)
    expect(published.ok).toBe(true)

    const entries = await audit(key)
    expect(entries.map((e) => e.action)).toEqual([
      'Create',
      'Save',
      'Publish',
      'SaveAndPublish',
      'Unpublish',
      'Copy',
      'Move',
      'Trash',
    ])
    for (const entry of entries)
      expect(entry).toMatchObject({
        category: 'content',
        source: 'cli',
        userKey: null,
        userName: 'ops',
        entityType: 'Element',
        entityKey: key,
      })
    expect((await audit(other.key)).map((e) => e.action)).toEqual(['Create', 'Save', 'Move'])
    expect((await audit(box.key)).map((e) => `${e.entityType} ${e.action}`)).toEqual([
      'ElementFolder Create',
      'ElementFolder Trash',
    ])
    if (published.ok)
      expect((await audit(published.key)).map((e) => e.action)).toEqual(['CreateAndPublish'])
    expect(heard.map((e) => e.type)).toContain('copied')
  })

  test('the back office writes them once too, from the operations and not the router', async () => {
    const { h, audit } = await site()
    const response = await h.post(`${V1}/element`, {
      documentType: { id: SYSTEM_CONTENT_TYPE_KEYS.Menu },
      parent: null,
      values: [{ alias: MENU_ALIAS_PROPERTY, culture: null, segment: null, value: 'main' }],
      variants: [{ culture: null, segment: null, name: 'Main' }],
    })
    expect(response.status).toBe(201)
    const key = response.headers.get('umb-generated-resource') as string
    expect((await h.put(`${V1}/element/${key}/publish`, { cultures: [] })).status).toBe(200)
    const folder = await h.post(`${V1}/element/folder`, { name: 'Menus', parent: null })
    expect(folder.status).toBe(201)
    const folderKey = folder.headers.get('umb-generated-resource') as string
    expect((await h.put(`${V1}/element/${key}/move`, { target: { id: folderKey } })).status).toBe(
      200,
    )
    expect((await h.put(`${V1}/element/folder/${folderKey}`, { name: 'Navigation' })).status).toBe(
      200,
    )

    const entries = await audit(key)
    expect(entries.map((e) => e.action)).toEqual(['Create', 'Publish', 'Move'])
    for (const entry of entries)
      expect(entry).toMatchObject({ category: 'content', source: 'request', entityKey: key })
    expect(entries[0]?.userName).toBeTruthy()
    expect((await audit(folderKey)).map((e) => `${e.entityType} ${e.action}`)).toEqual([
      'ElementFolder Create',
      'ElementFolder Save',
    ])
  })

  test('a copy is entered against the original, and each folder write as a folder', () => {
    expect(elementAuditFor({ type: 'copied', key: 'a', copyKey: 'b' })).toEqual({
      category: 'content',
      action: 'Copy',
      entityType: 'Element',
      entityKey: 'a',
    })
    expect(elementAuditFor({ type: 'folderRenamed', key: 'f' })).toMatchObject({
      action: 'Save',
      entityType: 'ElementFolder',
    })
  })
})

describe('who may', () => {
  test('a user is held to the Library verbs each write needs, and refused leaves nothing', async () => {
    const { db, operations, menu, audit } = await site()
    const reader = holding([E.Read])
    const first = menu('Main', 'main')
    expect(await operations.create(reader, first)).toMatchObject({
      ok: false,
      kind: 'forbidden',
      status: 403,
    })
    expect(await new NodeRepository(db).byKey(first.key)).toBeUndefined()

    const maker = holding([E.Read, E.Create, E.Update])
    const made = await operations.create(maker, menu('Main', 'main'))
    if (!made.ok) throw new Error(made.reason)
    // Making and publishing at once is the Publish verb, as the back office has it.
    expect(await operations.createAndPublish(maker, menu('Footer'), null)).toMatchObject({
      kind: 'forbidden',
    })
    expect(await operations.publish(maker, made.key, null)).toMatchObject({ kind: 'forbidden' })
    // A copy needs Duplicate as well as Create.
    expect(await operations.copy(maker, made.key, null)).toMatchObject({ kind: 'forbidden' })
    expect(await operations.trash(maker, made.key)).toMatchObject({ kind: 'forbidden' })
    expect(await operations.createFolder(maker, { name: 'F', parentKey: null })).toMatchObject({
      ok: true,
    })

    const entries = await audit(made.key)
    expect(entries.map((e) => e.action)).toEqual(['Create'])
    expect(entries[0]).toMatchObject({ source: 'request', userName: 'Lib' })
  })

  test('the table is the one each write checks', () => {
    expect(ELEMENT_VERBS.copy).toEqual([E.Duplicate, E.Create])
    expect(ELEMENT_VERBS.createAndPublish).toEqual([E.Publish])
    expect(ELEMENT_VERBS.trashFolder).toEqual([E.Delete])
  })

  test('an operator and the system are not checked, and the system names whom it acts for', async () => {
    const { operations, menu, audit } = await site()
    const made = await operations.create(operatorActor('ops'), menu('Main', 'main'))
    if (!made.ok) throw new Error(made.reason)
    const person = { id: crypto.randomUUID(), name: 'Approver' }
    const published = await operations.publish(
      systemActor('The schedule', { user: person }),
      made.key,
      null,
    )
    expect(published.ok).toBe(true)
    const [entry] = await audit(made.key)
    expect(entry).toMatchObject({
      action: 'Publish',
      source: 'job',
      userKey: person.id,
      userName: 'Approver',
    })
  })

  test('a menu alias another menu has is refused, and nothing is made or entered', async () => {
    const { db, operations, menu, audit } = await site()
    const ops = operatorActor('ops')
    expect((await operations.create(ops, menu('Main', 'main'))).ok).toBe(true)
    const again = menu('Other', 'main')
    expect(await operations.create(ops, again)).toMatchObject({
      ok: false,
      kind: 'invalid',
      reason: expect.stringContaining('Another menu already uses the alias "main"'),
    })
    expect(await new NodeRepository(db).byKey(again.key)).toBeUndefined()
    expect(await audit(again.key)).toEqual([])
  })
})
