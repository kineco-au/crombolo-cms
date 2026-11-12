/**
 * Story 236: the Content section's Overview. Pages by last change, how many are
 * drafts or published, and what people did, each narrowed to the pages the
 * signed-in user may see; and the words the dashboard puts on them.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository } from '@crombolo/data'
import {
  activityLine,
  ago,
  contentModeOf,
  firstName,
  initials,
} from '../packages/backoffice-host/plugin/overview-format.js'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const OVERVIEW = `${BACKOFFICE}/crombolo/api/overview`

const PAGE = `[content-type]
alias = "page"
name = "Story page"
allow-at-root = true
allow-children = ["page"]

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

interface Overview {
  pages: {
    total: number
    items: Array<{ key: string; name: string; type: string; state: string; author: string | null }>
  }
  counts: { drafts: number; published: number }
  activity: Array<{ key: string; name: string; action: string; who: string; mine: boolean }>
  newPageUnder: string | null
  mayReadAudit: boolean
}

let h: Harness
let root: string
let typeKey: string
const keys: Record<string, string> = {}

async function create(name: string, parent: string | null): Promise<string> {
  const response = await h.post(`${V1}/document`, {
    documentType: { id: typeKey },
    parent: parent ? { id: parent } : null,
    template: null,
    values: [],
    variants: [{ culture: null, segment: null, name }],
  })
  if (response.status !== 201) throw new Error(`create ${name}: ${await response.text()}`)
  return response.headers.get('umb-generated-resource') as string
}

const publish = async (key: string) => {
  const response = await h.put(`${V1}/document/${key}/publish`, {
    publishSchedules: [{ culture: null }],
  })
  if (!response.ok) throw new Error(`publish: ${await response.text()}`)
}

beforeAll(async () => {
  root = mkdtempSync(join(process.cwd(), 'output', 'overview-'))
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  keys.harbour = await create('Harbour', null)
  keys.vault = await create('Vault', null)
  keys.lights = await create('Harbour lights', keys.harbour)
  keys.secret = await create('Secret plans', keys.vault)
  await publish(keys.harbour)
  await publish(keys.vault)
  await publish(keys.secret)
}, 60_000)

afterAll(async () => {
  await h.db.close().catch(() => {})
  rmSync(root, { recursive: true, force: true })
})

describe(`the Overview (${dialectUnderTest})`, () => {
  test('an administrator sees every page, newest change first, with its type, state and author', async () => {
    const overview = await h.json<Overview>(OVERVIEW)
    expect(overview.pages.total).toBe(4)
    expect(overview.pages.items.map((p) => p.name)).toEqual([
      'Secret plans',
      'Vault',
      'Harbour',
      'Harbour lights',
    ])
    expect(overview.pages.items[0]).toMatchObject({ type: 'Story page', state: 'published' })
    expect(overview.pages.items[0]?.author).toBeTruthy()
    expect(overview.counts).toEqual({ drafts: 1, published: 3 })
    expect(overview.newPageUnder).toBeNull()
    expect(overview.mayReadAudit).toBe(true)
    // Newest first, and the administrator's own actions are theirs.
    expect(overview.activity[0]).toMatchObject({ name: 'Secret plans', action: 'Publish' })
    expect(overview.activity.every((a) => a.mine)).toBe(true)
  })

  test('a list of drafts or of published pages, a page at a time', async () => {
    const drafts = await h.json<Overview>(`${OVERVIEW}?list=drafts`)
    expect(drafts.pages.items.map((p) => p.name)).toEqual(['Harbour lights'])
    const published = await h.json<Overview>(`${OVERVIEW}?list=published&take=2&skip=1`)
    expect(published.pages.total).toBe(3)
    expect(published.pages.items.map((p) => p.name)).toEqual(['Vault', 'Harbour'])
  })

  test('someone confined to a branch sees only that branch: pages, counts and activity', async () => {
    const created = await h.post(`${V1}/user-group`, {
      name: 'Harbour editors',
      alias: 'harbourEditors',
      sections: ['Umb.Section.Content'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: false,
      documentStartNode: { id: keys.harbour },
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: ['Umb.Document.Read'],
      permissions: [],
    })
    expect(created.status).toBe(201)
    const editor = await signInAsGroup(h, 'harbourEditors')
    const overview = await editor.json<Overview>(OVERVIEW)
    expect(overview.pages.items.map((p) => p.name).sort()).toEqual(['Harbour', 'Harbour lights'])
    expect(overview.counts).toEqual({ drafts: 1, published: 1 })
    const named = overview.activity.map((a) => a.name)
    expect(named).not.toContain('Secret plans')
    expect(named).not.toContain('Vault')
    expect(named).toContain('Harbour')
    expect(overview.activity.every((a) => !a.mine)).toBe(true)
    expect(overview.newPageUnder).toBe(keys.harbour as string)
    expect(overview.mayReadAudit).toBe(false)
  })

  test('it needs someone signed in with the Content section', async () => {
    const anonymous = await h.server.fetch(new Request(`http://localhost${OVERVIEW}`))
    expect(anonymous.status).toBe(401)
    const translator = await signInAsGroup(h, 'translator')
    expect((await translator.call(OVERVIEW)).status).toBe(403)
  })
})

describe("the Overview's words", () => {
  test('a greeting by first name, and initials for an avatar', () => {
    expect(firstName('Alex Morgan')).toBe('Alex')
    expect(firstName('')).toBe('')
    expect(initials('Alex Morgan')).toBe('AM')
    expect(initials('jordan van der wu')).toBe('JW')
    expect(initials('admin')).toBe('A')
    expect(initials('')).toBe('?')
  })

  test('how long ago, then the date', () => {
    const now = new Date('2026-11-01T12:00:00Z')
    expect(ago('2026-11-01T11:59:30Z', now)).toBe('just now')
    expect(ago('2026-11-01T11:55:00Z', now)).toBe('5m ago')
    expect(ago('2026-11-01T10:00:00Z', now)).toBe('2h ago')
    expect(ago('2026-10-29T12:00:00Z', now)).toBe('3d ago')
    expect(ago('2026-09-01T12:00:00Z', now)).toMatch(/2026/)
  })

  test('a line for each thing someone did', () => {
    expect(activityLine({ mine: true, who: 'Admin', action: 'Publish', name: 'Home' })).toBe(
      'You published “Home”',
    )
    expect(activityLine({ mine: false, who: 'Jordan Wu', action: 'Trash', name: 'Old' })).toBe(
      'Jordan Wu moved “Old” to the recycle bin',
    )
    expect(
      activityLine({ mine: false, who: 'Sara', action: 'PublishWithDescendants', name: 'News' }),
    ).toBe('Sara published “News” and the pages below it')
    expect(activityLine({ mine: false, who: '', action: 'Save', name: 'About' })).toBe(
      'Someone saved “About”',
    )
  })
})

describe("the Overview's avatars", () => {
  test('a name always takes the same colour, and names spread across them', async () => {
    const { AVATAR_HUES, avatarHue } = await import(
      '../packages/backoffice-host/plugin/overview-format.js'
    )
    expect(avatarHue('Alex Morgan')).toBe(avatarHue('Alex Morgan'))
    const hues = new Set(
      ['Alex', 'Jordan Wu', 'Sara Kim', 'Riley Park', 'Sam', 'Admin'].map(avatarHue),
    )
    expect(hues.size).toBeGreaterThan(2)
    for (const hue of hues) expect(hue).toBeLessThan(AVATAR_HUES)
    expect(avatarHue('')).toBe(0)
  })
})

describe("Home's System information (story 343)", () => {
  test('says the content mode in words, not the runtime mode it comes from', () => {
    expect(contentModeOf('Production')).toBe('Production')
    expect(contentModeOf('BackofficeDevelopment')).toBe('Development')
    expect(contentModeOf(undefined)).toBe('…')
  })
})
