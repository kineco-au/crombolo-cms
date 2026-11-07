/**
 * Story 296: a group can hold Structure, Components or Workflow setup without the
 * rest of Settings. The server goes by what is held, and the client is told enough
 * to open those screens and no more.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { sectionRequirements } from '@crombolo/api-management'
import { ALL_SETTINGS, clientSections, SECTION_ALIASES } from '@crombolo/core'
import { type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const allows = (held: string, method: string, path: string) =>
  sectionRequirements({
    method,
    path: `/umbraco/management/api/v1/${path}`,
  } as Parameters<typeof sectionRequirements>[0]).every(
    (need) => need !== 'admin' && need.includes(held as never),
  )

describe('what each grant opens on the server', () => {
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
  ])('%s may %s %s', (held, method, path) => {
    expect(allows(held, method, path)).toBe(true)
  })

  test.each([
    ['structure', 'post', 'partial-view'],
    ['structure', 'get', 'log-viewer/log'],
    ['structure', 'post', 'webhook'],
    ['structure', 'get', 'user-group'],
    ['structure', 'get', 'package/created'],
    ['components', 'post', 'document-type'],
    ['components', 'post', 'language'],
    ['components', 'get', 'health-check-group'],
  ])('%s may not %s %s', (held, method, path) => {
    expect(allows(held, method, path)).toBe(false)
  })

  test('the whole of Settings keeps everything', () => {
    for (const [method, path] of [
      ['post', 'document-type'],
      ['post', 'partial-view'],
      ['post', 'webhook'],
    ] as const)
      expect(allows('settings', method, path)).toBe(true)
  })
})

describe('what the client is told', () => {
  const told = (allowedSections: string[], isAdmin = false) =>
    clientSections({ allowedSections, isAdmin })

  test('a part of Settings opens its screens, and isn’t the whole of it', () => {
    const sections = told([SECTION_ALIASES.structure])
    expect(sections).toContain(SECTION_ALIASES.settings)
    expect(sections).not.toContain(ALL_SETTINGS)
    expect(sections).not.toContain(SECTION_ALIASES.components)
  })

  test('the whole of Settings holds Structure and Components', () => {
    const sections = told([SECTION_ALIASES.settings])
    expect(sections).toContain(ALL_SETTINGS)
    expect(sections).toContain(SECTION_ALIASES.structure)
    expect(sections).toContain(SECTION_ALIASES.components)
    expect(sections).not.toContain(SECTION_ALIASES.workflowSetup)
  })

  test('Workflow setup reaches the screens it lives on', () => {
    expect(told([SECTION_ALIASES.workflowSetup])).toContain(SECTION_ALIASES.forms)
  })

  test('an administrator has everything', () => {
    const sections = told([SECTION_ALIASES.settings], true)
    expect(sections).toContain(SECTION_ALIASES.workflowSetup)
    expect(sections).toContain(SECTION_ALIASES.forms)
  })

  test('nothing is added for Content alone', () => {
    expect(told([SECTION_ALIASES.content])).toEqual([SECTION_ALIASES.content])
  })
})

describe('a group given Structure alone, on a real server', () => {
  const open: Harness[] = []
  afterAll(async () => {
    for (const h of open) await h.server.close().catch(() => {})
  })

  const asStructure = async () => {
    const admin = await signedInServer()
    open.push(admin)
    const created = await admin.post(`${V1}/user-group`, {
      name: 'Modellers',
      alias: 'modellers',
      sections: ['Umb.Section.Content', SECTION_ALIASES.structure],
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
    return signInAsGroup(admin, 'modellers')
  }

  test('opens its types, and nothing else in Settings', async () => {
    const h = await asStructure()
    expect((await h.call(`${V1}/tree/document-type/root?take=10`)).status).toBe(200)
    expect((await h.call(`${V1}/tree/data-type/root?take=10`)).status).toBe(200)
    expect((await h.call(`${V1}/tree/partial-view/root?take=10`)).status).toBe(403)
    expect((await h.call(`${V1}/webhook?take=10`)).status).toBe(403)
    expect((await h.call(`${V1}/user-group?take=10`)).status).toBe(403)
    const user = await h.json<{ allowedSections: string[] }>(`${V1}/user/current`)
    expect(user.allowedSections).toContain(SECTION_ALIASES.settings)
    expect(user.allowedSections).not.toContain(ALL_SETTINGS)
  })
})
