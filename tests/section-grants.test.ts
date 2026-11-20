/**
 * Story 385: each place under Content is a grant of its own. Structure opens the
 * types, data types and languages, Code the templates and files, and Settings
 * keeps its tools and opens neither; Pages opens the pages. Every place needs
 * Content too, which the API, group files and bundles refuse without. Workflow
 * set-up, which a group could hold alone between stories 296 and 322, is
 * Structure's and is read and dropped.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { sectionRequirements } from '@crombolo/api-management'
import { placesRefusal, RETIRED_SECTIONS, SECTION_ALIASES, SECTION_NAMES } from '@crombolo/core'
import { parseUserGroup } from '@crombolo/schema'
import { type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const allows = (held: string, method: string, path: string) =>
  sectionRequirements({
    method,
    path: `/umbraco/management/api/v1/${path}`,
  } as Parameters<typeof sectionRequirements>[0]).every(
    (need) => need !== 'admin' && need.includes(held as never),
  )

describe('what each place opens on the server', () => {
  test.each([
    ['structure', 'post', 'document-type'],
    ['structure', 'put', 'data-type/{id}'],
    ['structure', 'post', 'media-type'],
    ['structure', 'put', 'member-type/{id}'],
    ['structure', 'post', 'language'],
    ['structure', 'post', 'document-type/folder'],
    ['structure', 'get', 'tree/document-type/root'],
    ['components', 'post', 'partial-view'],
    ['components', 'put', 'stylesheet/{path}'],
    ['components', 'post', 'script'],
    ['components', 'post', 'template'],
    ['components', 'get', 'tree/partial-view/root'],
    ['settings', 'post', 'webhook'],
    ['pages', 'get', 'document/{id}'],
    ['pages', 'put', 'document/{id}'],
  ])('%s may %s %s', (held, method, path) => {
    expect(allows(held, method, path)).toBe(true)
  })

  test.each([
    ['settings', 'post', 'document-type'],
    ['settings', 'post', 'partial-view'],
    ['settings', 'post', 'language'],
    ['structure', 'post', 'partial-view'],
    ['components', 'post', 'document-type'],
    ['content', 'post', 'document-type'],
    ['content', 'get', 'document/{id}'],
    ['structure', 'post', 'webhook'],
  ])('%s may not %s %s', (held, method, path) => {
    expect(allows(held, method, path)).toBe(false)
  })
})

describe('the grants', () => {
  test('Pages, Structure and Code are sections; workflow set-up is not', () => {
    for (const place of ['pages', 'structure', 'components'])
      expect([place, place in SECTION_ALIASES, RETIRED_SECTIONS.has(place)]).toEqual([
        place,
        true,
        false,
      ])
    expect(SECTION_NAMES.map((section) => section.name)).toEqual(
      expect.arrayContaining(['pages', 'structure', 'components']),
    )
    expect(RETIRED_SECTIONS.has('workflowSetup')).toBe(true)
  })

  test('a place without Content is refused, naming each', () => {
    expect(placesRefusal(['content', 'media', 'structure'])).toBeUndefined()
    expect(placesRefusal(['settings', 'users'])).toBeUndefined()
    expect(placesRefusal(['media', 'Crombolo.Section.Components'])).toBe(
      'Media, Code are places under Content, so the group needs Content too.',
    )
  })

  test('a group file naming a place without Content is a problem; workflow set-up is dropped', () => {
    const file = (sections: string) =>
      parseUserGroup(
        'user-groups/modellers.toml',
        [
          '[user-group]',
          'alias = "modellers"',
          'name = "Modellers"',
          `sections = ${sections}`,
        ].join('\n'),
      )
    const loaded = file('["content", "structure", "components", "workflowSetup", "packages"]')
    expect(loaded.problems).toEqual([])
    expect(loaded.value?.sections).toEqual(['content', 'structure', 'components'])
    expect(file('["structure"]').problems.map((p) => p.message)).toEqual([
      'Structure is a place under Content, so the group needs Content too.',
    ])
  })
})

describe('on a real server', () => {
  const open: Harness[] = []
  afterAll(async () => {
    for (const h of open) await h.server.close().catch(() => {})
  })

  const admin = async () => {
    const h = await signedInServer()
    open.push(h)
    return h
  }
  const group = (alias: string, sections: string[]) => ({
    name: alias,
    alias,
    sections,
    languages: [],
    hasAccessToAllLanguages: true,
    documentRootAccess: true,
    documentStartNode: null,
    mediaRootAccess: true,
    mediaStartNode: null,
    elementRootAccess: false,
    elementStartNode: null,
    fallbackPermissions: ['Umb.Document.Read'],
    permissions: [],
  })
  const asGroup = async (alias: string, sections: string[]) => {
    const h = await admin()
    const created = await h.post(`${V1}/user-group`, group(alias, sections))
    expect(created.status).toBe(201)
    return signInAsGroup(h, alias)
  }

  test('Structure alone opens the types and nothing of Code or Settings, and is told as itself', async () => {
    const sections = [SECTION_ALIASES.content, SECTION_ALIASES.structure]
    const h = await asGroup('modellers', sections)
    expect((await h.call(`${V1}/tree/document-type/root?take=10`)).status).toBe(200)
    expect((await h.call(`${V1}/tree/partial-view/root?take=10`)).status).toBe(403)
    expect((await h.call(`${V1}/webhook?take=10`)).status).toBe(403)
    const user = await h.json<{ allowedSections: string[] }>(`${V1}/user/current`)
    expect([...user.allowedSections].sort()).toEqual([...sections].sort())
  })

  test('Settings alone opens neither Structure nor Code, and keeps its tools', async () => {
    const h = await asGroup('operators', [SECTION_ALIASES.content, SECTION_ALIASES.settings])
    expect((await h.call(`${V1}/tree/document-type/root?take=10`)).status).toBe(403)
    expect((await h.call(`${V1}/tree/partial-view/root?take=10`)).status).toBe(403)
    expect((await h.call(`${V1}/webhook?take=10`)).status).toBe(200)
  })

  test('a group with a place and without Content is refused, saying why', async () => {
    const h = await admin()
    const refused = await h.post(`${V1}/user-group`, group('loose', [SECTION_ALIASES.media]))
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({
      operationStatus: 'PlacesNeedContent',
      detail: 'Media is a place under Content, so the group needs Content too.',
    })
  })
})
