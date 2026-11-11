/**
 * Story 322: Settings is one grant again. Structure, Code and Workflow set-up follow
 * the Settings section; the parts of Settings a group could hold alone (story 296)
 * are read and dropped; and the client is told exactly the sections held.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { sectionRequirements } from '@crombolo/api-management'
import { RETIRED_SECTIONS, SECTION_ALIASES, SECTION_NAMES } from '@crombolo/core'
import { parseUserGroup } from '@crombolo/schema'
import { type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const allows = (held: string, method: string, path: string) =>
  sectionRequirements({
    method,
    path: `/umbraco/management/api/v1/${path}`,
  } as Parameters<typeof sectionRequirements>[0]).every(
    (need) => need !== 'admin' && need.includes(held as never),
  )

describe('what Settings opens on the server', () => {
  test.each([
    ['post', 'document-type'],
    ['put', 'data-type/{id}'],
    ['post', 'media-type'],
    ['put', 'member-type/{id}'],
    ['post', 'language'],
    ['post', 'document-type/folder'],
    ['get', 'tree/document-type/root'],
    ['post', 'partial-view'],
    ['put', 'stylesheet/{path}'],
    ['post', 'script'],
    ['post', 'template'],
    ['get', 'tree/partial-view/root'],
    ['post', 'webhook'],
  ])('settings may %s %s', (method, path) => {
    expect(allows('settings', method, path)).toBe(true)
  })

  test.each([
    ['content', 'post', 'document-type'],
    ['content', 'post', 'partial-view'],
    ['content', 'post', 'language'],
    ['content', 'get', 'tree/document-type/root'],
  ])('%s may not %s %s', (held, method, path) => {
    expect(allows(held, method, path)).toBe(false)
  })
})

describe('the parts of Settings a group could once hold alone', () => {
  test('are not sections, and are not offered', () => {
    for (const retired of ['structure', 'components', 'workflowSetup']) {
      expect(retired in SECTION_ALIASES).toBe(false)
      expect(RETIRED_SECTIONS.has(retired)).toBe(true)
      expect(SECTION_NAMES.some((section) => section.name === retired)).toBe(false)
    }
  })

  test('a group file naming one still loads, without it', () => {
    const parsed = parseUserGroup(
      'user-groups/modellers.toml',
      [
        '[user-group]',
        'alias = "modellers"',
        'name = "Modellers"',
        'sections = ["content", "structure", "components", "workflowSetup", "packages"]',
      ].join('\n'),
    )
    expect(parsed.problems).toEqual([])
    expect(parsed.value?.sections).toEqual(['content'])
  })
})

describe('on a real server', () => {
  const open: Harness[] = []
  afterAll(async () => {
    for (const h of open) await h.server.close().catch(() => {})
  })

  const asGroup = async (alias: string, sections: string[]) => {
    const admin = await signedInServer()
    open.push(admin)
    const created = await admin.post(`${V1}/user-group`, {
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
    expect(created.status).toBe(201)
    return signInAsGroup(admin, alias)
  }

  test('Settings opens the types and the code, and is told as itself', async () => {
    const h = await asGroup('builders', [SECTION_ALIASES.content, SECTION_ALIASES.settings])
    expect((await h.call(`${V1}/tree/document-type/root?take=10`)).status).toBe(200)
    expect((await h.call(`${V1}/tree/partial-view/root?take=10`)).status).toBe(200)
    expect((await h.call(`${V1}/webhook?take=10`)).status).toBe(200)
    const user = await h.json<{ allowedSections: string[] }>(`${V1}/user/current`)
    expect([...user.allowedSections].sort()).toEqual(
      [SECTION_ALIASES.content, SECTION_ALIASES.settings].sort(),
    )
  })

  test('Content alone opens none of it', async () => {
    const h = await asGroup('writers', [SECTION_ALIASES.content])
    expect((await h.call(`${V1}/tree/document-type/root?take=10`)).status).toBe(403)
    expect((await h.call(`${V1}/tree/partial-view/root?take=10`)).status).toBe(403)
    expect((await h.call(`${V1}/webhook?take=10`)).status).toBe(403)
  })
})
