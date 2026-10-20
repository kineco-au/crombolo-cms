/**
 * Story 026: the pure rules behind authorization — path access, per-node verb
 * calculation and start-node combination, ported from Umbraco — and the
 * section each operation demands.
 */
import { describe, expect, test } from 'bun:test'
import {
  AUTHORIZATION_DIVERGENCES,
  authorize,
  deniedChildren,
  deniedPropertyWrite,
  LOCAL_LOGIN_OPERATIONS,
  type NodeLookup,
  type Principal,
  sectionRequirements,
} from '@crombolo/api-management'
import { listOperations, loadSpec } from '@crombolo/contracts'
import {
  combineStartNodes,
  type GroupGrant,
  generateUserPassword,
  hasPathAccess,
  isValidPassword,
  permissionsForPath,
} from '@crombolo/core'

const group = (
  alias: string,
  defaults: string[],
  granular: Record<string, string[]> = {},
): GroupGrant => ({ key: alias, alias, defaults, granular: new Map(Object.entries(granular)) })

describe('path access', () => {
  test('root reaches everything, the bin included; a start node reaches itself and below, never the bin', () => {
    expect(hasPathAccess({ root: true, keys: [] }, ['a', 'b'], true)).toBe(true)
    const start = { root: false, keys: ['b'] }
    expect(hasPathAccess(start, ['a', 'b'], false)).toBe(true)
    expect(hasPathAccess(start, ['a', 'b', 'c'], false)).toBe(true)
    expect(hasPathAccess(start, ['a'], false)).toBe(false)
    expect(hasPathAccess(start, ['a', 'b', 'c'], true)).toBe(false)
    expect(hasPathAccess({ root: false, keys: [] }, ['a'], false)).toBe(false)
  })
})

describe('verbs on a node', () => {
  test("the nearest explicit setting replaces a group's defaults; groups union", () => {
    const writers = group('writer', ['Read', 'Update'], { b: ['Read'], d: [] })
    const editors = group('editor', ['Read', 'Delete'])
    expect([...permissionsForPath([writers], ['a'])].sort()).toEqual(['Read', 'Update'])
    // b is set explicitly, and so is everything below it
    expect([...permissionsForPath([writers], ['a', 'b'])]).toEqual(['Read'])
    expect([...permissionsForPath([writers], ['a', 'b', 'c'])]).toEqual(['Read'])
    // An explicit empty set denies everything
    expect([...permissionsForPath([writers], ['a', 'b', 'c', 'd'])]).toEqual([])
    // Another group's defaults still count
    expect([...permissionsForPath([writers, editors], ['a', 'b', 'c', 'd'])].sort()).toEqual([
      'Delete',
      'Read',
    ])
    // The root itself: defaults
    expect([...permissionsForPath([writers], [])].sort()).toEqual(['Read', 'Update'])
  })
})

describe("combining groups' and a user's start nodes", () => {
  test("groups keep the topmost, the user's keep the deepest, and the user's replace groups' above or below", () => {
    expect(combineStartNodes([['a'], ['a', 'b']], [])).toEqual({ root: false, keys: ['a'] })
    expect(combineStartNodes([[], ['a']], [])).toEqual({ root: true, keys: [] })
    expect(combineStartNodes([], [['a'], ['a', 'b']])).toEqual({ root: false, keys: ['b'] })
    // Umbraco's example: a group with root plus a user start node yields just the node
    expect(combineStartNodes([[]], [['x', 'y']])).toEqual({ root: false, keys: ['y'] })
    // Unrelated nodes stay side by side
    expect(combineStartNodes([['a']], [['c']])).toEqual({ root: false, keys: ['a', 'c'] })
    // A user's root replaces the groups' nodes
    expect(combineStartNodes([['a']], [[]])).toEqual({ root: true, keys: [] })
    expect(combineStartNodes([], [])).toEqual({ root: false, keys: [] })
  })
})

describe('passwords', () => {
  test('ten characters by default; a generated one always passes', () => {
    expect(isValidPassword('123456789')).toBe(false)
    expect(isValidPassword('1234567890')).toBe(true)
    const strict = {
      minimumPasswordLength: 16,
      requireNonLetterOrDigit: true,
      requireDigit: true,
      requireLowercase: true,
      requireUppercase: true,
    }
    expect(isValidPassword('longenoughbutweak', strict)).toBe(false)
    for (let i = 0; i < 50; i++)
      expect(isValidPassword(generateUserPassword(strict), strict)).toBe(true)
  })
})

describe('section requirements', () => {
  const operations = listOperations(loadSpec())
  const need = (operationId: string) => {
    const operation = operations.find((o) => o.operationId === operationId)
    if (!operation) throw new Error(operationId)
    return sectionRequirements(operation)
  }

  test("each area asks for Umbraco's sections", () => {
    expect(need('GetDocumentById')).toEqual([['content']])
    expect(need('GetTreeDocumentRoot')).toEqual([
      ['content', 'media', 'users', 'settings', 'packages', 'members', 'library'],
    ])
    expect(need('GetDocumentTypeById')).toEqual([['content', 'library', 'settings']])
    expect(need('PutDocumentTypeById')).toEqual([['content', 'library', 'settings'], ['settings']])
    expect(need('GetDocumentTypeConfiguration')).toEqual([
      ['content', 'library', 'settings'],
      ['settings'],
    ])
    expect(need('GetTreeDocumentTypeRoot')).toEqual([['settings']])
    expect(need('PostDataType')).toEqual([
      ['content', 'library', 'media', 'members', 'settings'],
      ['settings'],
    ])
    expect(need('GetTemplateById')).toEqual([['settings', 'content']])
    expect(need('PutTemplateById')).toEqual([['settings', 'content'], ['settings']])
    expect(need('GetMediaById')).toEqual([['media']])
    expect(need('GetDictionary')).toEqual([['translation']])
    expect(need('GetTreeDictionaryRoot')).toEqual([['translation', 'settings']])
    expect(need('GetUser')).toEqual([['users']])
    expect(need('GetUserGroup')).toEqual([['users']])
    expect(need('GetFilterUser')).toEqual([['users']])
    expect(need('PostDocumentBlueprintFromDocument')).toEqual([['content']])
    expect(need('PostDocumentBlueprint')).toEqual([['settings']])
    expect(need('GetDocumentBlueprintById')).toEqual([['content', 'settings']])
    expect(need('GetUpgradeSettings')).toEqual(['admin'])
    // Open to every signed-in user
    for (const id of [
      'GetUserCurrent',
      'GetUserData',
      'GetItemDocument',
      'GetCulture',
      'GetLanguage',
      'GetServerInformation',
      'PostTemporaryFile',
    ])
      expect([id, need(id)]).toEqual([id, []])
    expect(need('PostLanguage')).toEqual([['settings']])
  })

  test('each operation authorized unlike Umbraco is a real one, listed with its reason', () => {
    const ids = new Set(operations.map((o) => o.operationId))
    for (const [id, reason] of Object.entries(AUTHORIZATION_DIVERGENCES))
      expect([id, ids.has(id), reason.length > 0]).toEqual([id, true, true])
    expect(AUTHORIZATION_DIVERGENCES.PostRedirectManagementStatus).toContain('Settings')
  })

  test('turning URL tracking on or off is a setting; a redirect is still content', () => {
    expect(need('PostRedirectManagementStatus')).toEqual([['settings']])
    expect(need('GetRedirectManagementStatus')).toEqual([['content']])
    expect(need('DeleteRedirectManagementById')).toEqual([['content']])
    expect(need('GetRedirectManagement')).toEqual([['content']])
  })

  test('the password-reset endpoints are the ones Umbraco opens while local login is allowed', () => {
    for (const id of LOCAL_LOGIN_OPERATIONS)
      expect(operations.find((o) => o.operationId === id)?.anonymous).toBe(false)
  })
})

describe('per-node rules on documents', () => {
  const operations = listOperations(loadSpec())
  const nodes: NodeLookup = {
    documents: async (keys) =>
      new Map(keys.map((k) => [k.toLowerCase(), { chain: [k], trashed: false }])),
    media: async () => new Map(),
    documentDescendants: async () => [],
    versionDocument: async () => 'doc-1',
  }
  const everywhere = { root: true, keys: [] as string[] }
  const editor = (defaults: string[], start = everywhere): Principal => ({
    id: 'u',
    userName: 'u',
    name: 'u',
    email: 'u@example.test',
    isAdmin: false,
    languageIsoCode: undefined,
    avatarUrls: [],
    allowedSections: ['Umb.Section.Content'],
    permissions: defaults,
    groupKeys: ['writer'],
    hasAccessToAllLanguages: true,
    languages: [],
    startNodes: {
      document: start,
      media: everywhere,
      element: everywhere,
    },
    groups: [group('writer', defaults)],
  })
  const allowed = (operationId: string, defaults: string[], start = everywhere) => {
    const operation = operations.find((o) => o.operationId === operationId)
    if (!operation) throw new Error(operationId)
    const path = operation.path.replace('{id}', 'doc-1').replace('{taskId}', 't')
    const request = new Request(`http://localhost${path}?documentId=doc-1`, {
      method: operation.method.toUpperCase(),
    })
    return authorize(
      operation,
      { id: 'doc-1', taskId: 't' },
      request,
      editor(defaults, start),
      nodes,
    )
  }

  test('a patch needs Update, as a save does', async () => {
    expect(await allowed('PatchDocumentByIdPatch', ['Umb.Document.Read'])).toBe(false)
    expect(await allowed('PatchDocumentByIdPatch', ['Umb.Document.Update'])).toBe(true)
  })

  test('a version is read with Read on its document, and kept from clean-up with Update', async () => {
    expect(await allowed('GetDocumentVersionById', [])).toBe(false)
    expect(await allowed('GetDocumentVersionById', ['Umb.Document.Read'])).toBe(true)
    expect(await allowed('PutDocumentVersionByIdPreventCleanup', ['Umb.Document.Read'])).toBe(false)
    expect(await allowed('PutDocumentVersionByIdPreventCleanup', ['Umb.Document.Update'])).toBe(
      true,
    )
  })

  test('a reader whose start node is another branch can neither read its versions nor patch it', async () => {
    const all = ['Umb.Document.Read', 'Umb.Document.Update', 'Umb.Document.Rollback']
    const elsewhere = { root: false, keys: ['other-branch'] }
    for (const id of [
      'GetDocumentById',
      'GetDocumentVersion',
      'GetDocumentVersionById',
      'PutDocumentVersionByIdPreventCleanup',
      'PutDocumentById',
      'PatchDocumentByIdPatch',
    ]) {
      expect([id, await allowed(id, all, elsewhere)]).toEqual([id, false])
      expect([id, await allowed(id, all)]).toEqual([id, true])
    }
  })

  test('every operation on one document or version is checked against that node', async () => {
    // Umbraco asks only for the Content section on these.
    const sectionOnly = new Set([
      'GetDocumentByIdReferencedBy',
      'GetDocumentByIdReferencedDescendants',
      'GetDocumentByIdPublishWithDescendantsResultByTaskId',
    ])
    const unchecked = []
    for (const operation of operations) {
      if (!/\/v1\/document(-version)?\/\{id\}/.test(operation.path)) continue
      if (sectionOnly.has(operation.operationId)) continue
      if (await allowed(operation.operationId, [])) unchecked.push(operation.operationId)
    }
    expect(unchecked).toEqual([])
  })
})

describe('children a list view leaves out', () => {
  const caller = (...groups: GroupGrant[]) => ({ groups }) as unknown as Principal

  test('those set explicitly without Read, unless another group still grants it', () => {
    const writers = group('writer', ['Umb.Document.Read'], {
      secret: [],
      editable: ['Umb.Document.Read', 'Umb.Document.Update'],
      deeper: [],
    })
    expect(deniedChildren(caller(writers), ['home']).sort()).toEqual(['deeper', 'secret'])
    expect(
      deniedChildren(caller(writers, group('readers', ['Umb.Document.Read'])), ['home']),
    ).toEqual([])
    expect(deniedChildren(caller(group('plain', ['Umb.Document.Read'])), ['home'])).toEqual([])
  })
})

/** A caller with the given sections and fallback verbs, everywhere. */
function caller(
  sections: string[],
  defaults: string[],
  media = { root: true, keys: [] as string[] },
) {
  const everywhere = { root: true, keys: [] as string[] }
  return {
    id: 'u',
    userName: 'u',
    name: 'u',
    email: 'u@example.test',
    isAdmin: false,
    languageIsoCode: undefined,
    avatarUrls: [],
    allowedSections: sections,
    permissions: defaults,
    groupKeys: ['g'],
    hasAccessToAllLanguages: true,
    languages: [],
    startNodes: { document: everywhere, media, element: everywhere },
    groups: [group('g', defaults)],
  } satisfies Principal
}

/** Authorizes an operation by id, its path parameters all `node-1`. */
function asking(sections: string[]) {
  const operations = listOperations(loadSpec())
  const nodes: NodeLookup = {
    documents: async () => new Map(),
    media: async (keys) =>
      new Map(keys.map((k) => [k.toLowerCase(), { chain: [k], trashed: false }])),
    documentDescendants: async () => [],
    versionDocument: async () => undefined,
  }
  const allowed = (
    operationId: string,
    defaults: string[],
    media?: { root: boolean; keys: string[] },
  ) => {
    const operation = operations.find((o) => o.operationId === operationId)
    if (!operation) throw new Error(operationId)
    const path = operation.path.replace('{id}', 'node-1')
    const request = new Request(`http://localhost${path}?id=node-1`, {
      method: operation.method.toUpperCase(),
    })
    return authorize(operation, { id: 'node-1' }, request, caller(sections, defaults, media), nodes)
  }
  return { operations, allowed }
}

describe('verbs on media', () => {
  const READ = 'Crombolo.Media.Read'
  const UPDATE = 'Crombolo.Media.Update'
  const { operations, allowed } = asking(['Umb.Section.Media'])
  const writes = operations.filter(
    (o) => o.method !== 'get' && /\/v1\/(recycle-bin\/)?media(\/|$)/.test(o.path),
  )

  test('reading an item, a folder, its history or where a binned item came from needs Read', async () => {
    for (const id of [
      'GetMediaById',
      'GetCollectionMedia',
      'GetMediaByIdAuditLog',
      'GetRecycleBinMediaByIdOriginalParent',
    ]) {
      expect([id, await allowed(id, [])]).toEqual([id, false])
      expect([id, await allowed(id, [UPDATE])]).toEqual([id, false])
      expect([id, await allowed(id, [READ])]).toEqual([id, true])
    }
  })

  test('every change needs Update: create, save, delete, trash, move, sort and the recycle bin', async () => {
    expect(writes.map((o) => o.operationId).sort()).toEqual([
      'DeleteMediaById',
      'DeleteRecycleBinMedia',
      'DeleteRecycleBinMediaById',
      'PostMedia',
      'PostMediaValidate',
      'PutMediaById',
      'PutMediaByIdMove',
      'PutMediaByIdMoveToRecycleBin',
      'PutMediaByIdSortChildren',
      'PutMediaByIdValidate',
      'PutMediaRootSortChildren',
      'PutMediaSort',
      'PutRecycleBinMediaByIdRestore',
    ])
    for (const { operationId: id } of writes) {
      expect([id, await allowed(id, [READ])]).toEqual([id, false])
      expect([id, await allowed(id, [READ, UPDATE])]).toEqual([id, true])
    }
  })

  test('the verbs come on top of start nodes, not instead of them', async () => {
    const elsewhere = { root: false, keys: ['another-folder'] }
    for (const id of ['GetMediaById', 'PutMediaById', 'DeleteRecycleBinMedia'])
      expect([id, await allowed(id, [READ, UPDATE], elsewhere)]).toEqual([id, false])
  })

  test('pickers and uploads need no verb: trees, items and temporary files', async () => {
    for (const id of [
      'GetTreeMediaRoot',
      'GetTreeMediaChildren',
      'GetItemMedia',
      'PostTemporaryFile',
    ])
      expect([id, await allowed(id, [])]).toEqual([id, true])
  })
})

describe('verbs on elements', () => {
  const { operations, allowed } = asking(['Umb.Section.Library'])
  const E = (verb: string) => `Umb.Element.${verb}`
  const F = (verb: string) => `Umb.ElementContainer.${verb}`
  const RULES: Record<string, string[]> = {
    GetElementById: [E('Read')],
    GetElementByIdPublished: [E('Read')],
    GetElementByIdAuditLog: [E('Read')],
    GetElementVersion: [E('Read')],
    GetElementVersionById: [E('Read')],
    GetRecycleBinElementByIdOriginalParent: [E('Read')],
    PostElement: [E('Create')],
    PostElementValidate: [E('Create')],
    PutElementById: [E('Update')],
    PutElementByIdValidate: [E('Update')],
    PutElementVersionByIdPreventCleanup: [E('Update')],
    PostElementCreateAndPublish: [E('Publish')],
    PutElementByIdUpdateAndPublish: [E('Publish')],
    PutElementByIdPublish: [E('Publish')],
    PutElementByIdUnpublish: [E('Unpublish')],
    DeleteElementById: [E('Delete')],
    PutElementByIdMoveToRecycleBin: [E('Delete')],
    PutElementByIdMove: [E('Move')],
    PostElementByIdCopy: [E('Duplicate'), E('Create')],
    PostElementVersionByIdRollback: [E('Rollback')],
    DeleteRecycleBinElementById: [E('Delete')],
    PutRecycleBinElementByIdRestore: [E('Move')],
    DeleteRecycleBinElement: [E('Delete'), F('Delete')],
    GetElementFolderById: [F('Read')],
    GetRecycleBinElementFolderByIdOriginalParent: [F('Read')],
    PostElementFolder: [F('Create')],
    PutElementFolderById: [F('Update')],
    DeleteElementFolderById: [F('Delete')],
    PutElementFolderByIdMoveToRecycleBin: [F('Delete')],
    DeleteRecycleBinElementFolderById: [F('Delete')],
    PutElementFolderByIdMove: [F('Move')],
    PutRecycleBinElementFolderByIdRestore: [F('Move')],
  }

  test('each operation needs its verbs, every one of them, and is refused without', async () => {
    for (const [id, verbs] of Object.entries(RULES)) {
      expect([id, await allowed(id, verbs)]).toEqual([id, true])
      for (const verb of verbs)
        expect([
          id,
          verb,
          await allowed(
            id,
            verbs.filter((v) => v !== verb),
          ),
        ]).toEqual([id, verb, false])
    }
  })

  test('every change to an element, a folder, a version or the bin is checked', async () => {
    const writes = operations.filter(
      (o) => o.method !== 'get' && /\/v1\/(recycle-bin\/)?element(-version)?(\/|$)/.test(o.path),
    )
    expect(writes.length).toBeGreaterThan(20)
    const reader = [E('Read'), F('Read')]
    const unchecked = []
    for (const { operationId } of writes)
      if (await allowed(operationId, reader)) unchecked.push(operationId)
    expect(unchecked).toEqual([])
  })

  test('the Library section is still required', async () => {
    const { allowed: withoutLibrary } = asking(['Umb.Section.Content'])
    expect(await withoutLibrary('GetElementById', [E('Read')])).toBe(false)
  })
})

describe('writing property values', () => {
  const W = 'Umb.Document.PropertyValue.Write'
  const R = 'Umb.Document.PropertyValue.Read'
  const properties = [
    { alias: 'title', key: 'p-title', name: 'Title' },
    { alias: 'body', key: 'p-body', name: 'Body' },
  ]
  const before = [
    { alias: 'title', culture: null, segment: null, value: 'Home' },
    { alias: 'body', culture: null, segment: null, value: { markup: '<p>x</p>', blocks: null } },
  ]
  const by = (...groups: GroupGrant[]) => ({ groups }) as unknown as Principal
  const readsBody = (defaults = [R, W]): GroupGrant => ({
    ...group('g', defaults),
    properties: new Map([['p-body', [R]]]),
  })
  const after = (body: unknown, title = 'Home') => [
    { alias: 'title', culture: null, segment: null, value: title },
    { alias: 'body', culture: null, segment: null, value: body },
  ]

  test("the group's defaults allow it, unless it sets the property otherwise", () => {
    expect(deniedPropertyWrite(by(group('g', [R, W])), properties, before, after('x'))).toBe(
      undefined,
    )
    expect(deniedPropertyWrite(by(readsBody()), properties, before, after('x'))?.alias).toBe('body')
    expect(deniedPropertyWrite(by(group('g', [R])), properties, before, after('x'))?.alias).toBe(
      'body',
    )
  })

  test('a property set to allow writing is writable even when the defaults are not', () => {
    const g = { ...group('g', [R]), properties: new Map([['p-body', [R, W]]]) }
    expect(deniedPropertyWrite(by(g), properties, before, after('x'))).toBe(undefined)
    expect(
      deniedPropertyWrite(by(g), properties, before, after(before[1]?.value, 'Changed'))?.alias,
    ).toBe('title')
  })

  test('another group granting it is enough', () => {
    expect(
      deniedPropertyWrite(by(readsBody(), group('h', [R, W])), properties, before, after('x')),
    ).toBe(undefined)
  })

  test('a value sent back as it was is no change, however its keys are ordered', () => {
    const same = { blocks: null, markup: '<p>x</p>' }
    expect(deniedPropertyWrite(by(readsBody()), properties, before, after(same, 'New'))).toBe(
      undefined,
    )
  })

  test('leaving a stored value out clears it, which is a change', () => {
    expect(
      deniedPropertyWrite(by(readsBody()), properties, before, [before[0] as never])?.alias,
    ).toBe('body')
  })
})
