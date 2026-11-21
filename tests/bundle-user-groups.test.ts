/**
 * Story 393: a bundle's user groups arrive as they were, with the languages they may
 * edit and their verbs on single pages, Library items and fields; and the CMS's lists
 * of sections and verbs come from `@crombolo/crombolo/transfer`.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import * as core from '@crombolo/core'
import { ObjectTypes, SystemNodes } from '@crombolo/core'
import * as transfer from '@crombolo/crombolo/transfer'
import {
  ContentTypeRepository,
  type GranularPermission,
  NodeRepository,
  UserGroupRepository,
} from '@crombolo/data'
import {
  type BundleUserGroup,
  bundleGranular,
  type ContentSet,
  exportBundle,
  exportPeople,
  importBundle,
} from '@crombolo/transfer'
import { createPage, type TreeSite, treeSite } from './support/content-tree.ts'
import { dialectUnderTest } from './support/db.ts'
import { V1 } from './support/harness.ts'

const READ = 'Umb.Document.Read'
const UPDATE = 'Umb.Document.Update'
const WRITE_FIELD = 'Umb.Document.PropertyValue.Write'
const GROUP = '5d0f3a6e-9c1b-4b0e-8e7f-2a1b3c4d5e6f'

const open: TreeSite[] = []
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close()
})

async function site(): Promise<TreeSite> {
  const s = await treeSite()
  open.push(s)
  return s
}

const language = (s: TreeSite, isoCode: string) =>
  s.h.post(`${V1}/language`, {
    isoCode,
    name: isoCode,
    isDefault: false,
    isMandatory: false,
    fallbackIsoCode: null,
  })

const titleKey = async (s: TreeSite) =>
  (await new ContentTypeRepository(s.h.server.db).byKey(s.typeKey))?.properties.find(
    (p) => p.alias === 'title',
  )?.key as string

/**
 * The source's pages as a bundle. Taken before the destination boots: on Postgres every
 * server here shares one database, which booting resets.
 */
async function pagesOf(s: TreeSite, pages: string[]): Promise<ContentSet> {
  const nodes = new NodeRepository(s.h.server.db)
  const roots = await Promise.all(pages.map(async (key) => (await nodes.byKey(key)) as never))
  const { set } = await exportBundle(s.h.server.db, {
    roots,
    asGiven: pages,
    descendants: false,
    snapshot: 'drafts',
    blueprints: false,
    withBlobs: false,
    siteName: 'Source',
    nodeId: 'source',
  })
  return set
}

/** The bundle, carrying these user groups in its people. */
const withGroups = (set: ContentSet, userGroups: BundleUserGroup[]): ContentSet => ({
  ...set,
  people: { memberGroups: [], members: [], userGroups, users: [] },
})

const group = (over: Partial<BundleUserGroup> = {}): BundleUserGroup => ({
  key: GROUP,
  alias: 'translators',
  name: 'Translators',
  icon: null,
  sections: ['content'],
  permissions: [READ],
  hasAccessToAllLanguages: false,
  languages: [],
  documentStartNodeKey: null,
  mediaStartNodeKey: null,
  ...over,
})

const rows = (granular: readonly GranularPermission[]) =>
  granular.map((r) => `${r.context}:${r.key}:${r.permission}`).sort()

describe(`a bundle's user groups (${dialectUnderTest})`, () => {
  test('arrive with their languages and their verbs on the same pages, Library items and fields', async () => {
    const source = await site()
    for (const iso of ['da-DK', 'fr-FR']) expect((await language(source, iso)).status).toBe(201)
    const kept = await createPage(source, 'Kept')
    const closed = await createPage(source, 'Closed')
    const absent = await createPage(source, 'Left behind')
    const field = await titleKey(source)
    const saved = await new UserGroupRepository(source.h.server.db).save({
      key: GROUP,
      alias: 'translators',
      name: 'Translators',
      description: null,
      icon: null,
      sections: ['content'],
      languages: ['da-DK', 'fr-FR'],
      hasAccessToAllLanguages: false,
      startNodes: {
        document: { root: false, key: null },
        media: { root: false, key: null },
        element: { root: false, key: null },
      },
      permissions: [READ],
      granular: [
        { key: kept, permission: READ, context: 'Document' },
        { key: kept, permission: UPDATE, context: 'Document' },
        { key: closed, permission: '', context: 'Document' },
        { key: absent, permission: UPDATE, context: 'Document' },
        {
          key: source.typeKey,
          permission: `${field}|${WRITE_FIELD}`,
          context: 'DocumentTypeProperty',
        },
      ],
    })
    expect(saved).toBe('saved')

    // The environment's export carries the group whole.
    const people = await exportPeople(source.h.server.db, { members: false, users: true })
    const exported = people.userGroups.find((g) => g.alias === 'translators') as BundleUserGroup
    expect(exported.languages).toEqual(['da-DK', 'fr-FR'])
    expect(exported.granular).toEqual([
      { key: kept, permissions: [READ, UPDATE] },
      { key: closed, permissions: [] },
      { key: absent, permissions: [UPDATE] },
      {
        key: source.typeKey,
        context: 'DocumentTypeProperty',
        permissions: [`${field}|${WRITE_FIELD}`],
      },
    ])

    // The destination has Danish but not French, and gets two of the three pages.
    const pages = await pagesOf(source, [kept, closed])
    const destination = await site()
    expect((await language(destination, 'da-DK')).status).toBe(201)
    // A Library item already here, and a page key that is one of them is not a Library item.
    const item = crypto.randomUUID()
    await new NodeRepository(destination.h.server.db).create({
      key: item,
      parentId: SystemNodes.Root,
      objectType: ObjectTypes.Element,
      text: 'Shared banner',
    })
    const withItems = {
      ...exported,
      granular: [
        ...(exported.granular ?? []),
        { key: item, context: 'Element' as const, permissions: [READ] },
        { key: kept, context: 'Element' as const, permissions: [READ] },
      ],
    }
    const set = withGroups(pages, [withItems])
    const result = await importBundle(destination.h.server.db, set, { nodeId: 'test' })
    expect(result.check.outstanding).toEqual([])
    const codes = result.check.findings
      .filter((f) => f.subjectType === 'user-group')
      .map((f) => f.code)
    expect(codes).toContain('missing-language')
    expect(codes).toContain('missing-page')

    const here = await new UserGroupRepository(destination.h.server.db).byKey(GROUP)
    expect(here?.hasAccessToAllLanguages).toBe(false)
    expect(here?.languages).toEqual(['da-DK'])
    expect(here?.permissions).toEqual([READ])
    expect(rows(here?.granular ?? [])).toEqual(
      rows([
        { key: kept, permission: READ, context: 'Document' },
        { key: kept, permission: UPDATE, context: 'Document' },
        { key: closed, permission: '', context: 'Document' },
        { key: item, permission: READ, context: 'Element' },
        {
          key: destination.typeKey,
          permission: `${field}|${WRITE_FIELD}`,
          context: 'DocumentTypeProperty',
        },
      ]),
    )
  })

  test('a verb the CMS does not know refuses the bundle; a retired one is read as its replacement', async () => {
    const source = await site()
    const page = await createPage(source, 'Home')
    const pages = await pagesOf(source, [page])
    const destination = await site()
    const unknown = await importBundle(
      destination.h.server.db,
      withGroups(pages, [
        group({ granular: [{ key: page, permissions: ['Umb.Document.Juggle'] }] }),
      ]),
      { nodeId: 'test' },
    )
    expect(unknown.runId).toBeUndefined()
    expect(unknown.check.outstanding.map((f) => f.code)).toContain('unknown-permission')
    expect(await new UserGroupRepository(destination.h.server.db).byKey(GROUP)).toBeUndefined()

    const retired = await importBundle(
      destination.h.server.db,
      withGroups(pages, [group({ permissions: ['Umb.Document.CreateBlueprint', READ] })]),
      { nodeId: 'test' },
    )
    expect(retired.check.outstanding).toEqual([])
    const here = await new UserGroupRepository(destination.h.server.db).byKey(GROUP)
    expect(here?.permissions.sort()).toEqual([core.DocumentPermissions.Create, READ].sort())
  })

  test('a per-item permission with no key is refused', async () => {
    const source = await site()
    const page = await createPage(source, 'Home')
    const pages = await pagesOf(source, [page])
    const destination = await site()
    const result = await importBundle(
      destination.h.server.db,
      withGroups(pages, [group({ granular: [{ key: '', permissions: [READ] }] })]),
      { nodeId: 'test' },
    )
    expect(result.check.outstanding.map((f) => f.code)).toContain('invalid-permission')
  })

  test('a bundle written before applies as it did, and a group here is left as it is', async () => {
    const source = await site()
    const page = await createPage(source, 'Home')
    const pages = await pagesOf(source, [page])
    const destination = await site()
    const older = group({ hasAccessToAllLanguages: true })
    const result = await importBundle(destination.h.server.db, withGroups(pages, [older]), {
      nodeId: 'test',
    })
    expect(result.check.outstanding).toEqual([])
    const here = await new UserGroupRepository(destination.h.server.db).byKey(GROUP)
    expect(here).toMatchObject({ hasAccessToAllLanguages: true, languages: [], granular: [] })

    const again = await importBundle(
      destination.h.server.db,
      withGroups(pages, [group({ permissions: ['Umb.Document.Juggle'] })]),
      { nodeId: 'test' },
    )
    expect(again.check.outstanding).toEqual([])
    expect(
      (await new UserGroupRepository(destination.h.server.db).byKey(GROUP))?.permissions,
    ).toEqual([READ])
  })
})

describe('the CMS lists a bundle writer reads', () => {
  test('are the CMS own, from @crombolo/crombolo/transfer', () => {
    expect(transfer.SECTION_ALIASES).toBe(core.SECTION_ALIASES)
    expect(transfer.RETIRED_SECTIONS).toBe(core.RETIRED_SECTIONS)
    expect(transfer.KNOWN_PERMISSIONS).toBe(core.KNOWN_PERMISSIONS)
    expect(transfer.PRUNED_PERMISSIONS).toBe(core.PRUNED_PERMISSIONS)
    expect(transfer.PAGE_LEVELS).toBe(core.PAGE_LEVELS)
    expect(transfer.MEDIA_LEVELS).toBe(core.MEDIA_LEVELS)
    expect(transfer.FORM_LEVELS).toBe(core.FORM_LEVELS)
    expect(transfer.levelVerbs).toBe(core.levelVerbs)
  })

  test("a group's rows become one entry per item", () => {
    expect(
      bundleGranular([
        { key: 'a', permission: READ, context: 'Document' },
        { key: 'a', permission: UPDATE, context: 'Document' },
        { key: 'b', permission: READ, context: 'Element' },
        { key: null, permission: READ, context: 'Document' },
      ]),
    ).toEqual([
      { key: 'a', permissions: [READ, UPDATE] },
      { key: 'b', context: 'Element', permissions: [READ] },
    ])
  })
})
