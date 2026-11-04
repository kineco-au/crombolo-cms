/**
 * Story 264: the back office shows whether a page's copies are shared and
 * why not, notes a view that shows the signed-in member, inserts a part with
 * its import, offers starters for a personalised and an interactive part, and
 * lets a user who can open Members preview as one.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AuditLog,
  ComponentRepository,
  ContentTypeRepository,
  PublicAccessRepository,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import {
  describeSharing,
  duration,
  fileEditorHref,
} from '../packages/backoffice-host/plugin/page-sharing.js'
import { visitorLabel } from '../packages/backoffice-host/plugin/preview-member.js'
import {
  componentName,
  importFor,
  loadsSeparately,
  memberNotes,
  partFileName,
  partInsert,
  personalisedPartSnippet,
  withImport,
} from '../packages/backoffice-host/plugin/view-parts.js'
import { type Harness, ORIGIN, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page", "greeted"]
default-component = "page"
`

const LAYOUT = `export const Layout = ({ children }) => <html><body>{children}</body></html>
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'parts-backoffice-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components/shared'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'shared', 'layout.tsx'), LAYOUT)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    `import { Layout } from './shared/layout.tsx'
export default ({ model }) => <Layout><h1>{model.name}</h1></Layout>
`,
  )
  writeFileSync(
    join(root, 'components', 'greeted.tsx'),
    `import { usePage } from '@crombolo/crombolo'
export default () => <p>{usePage().member ? 'Welcome back' : 'Welcome'}</p>
`,
  )
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo'),
      cache: { maxAge: 300, validator: 'published' },
    },
  })
  open.push(h)
  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const components = new ComponentRepository(h.server.db)
  const make = async (name: string, template: string, parent: string | null = null) => {
    const created = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: (await components.byAlias(template))?.key },
      parent: parent ? { id: parent } : null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    const key = created.headers.get('umb-generated-resource') as string
    expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(
      200,
    )
    return key
  }
  return { h, make }
}

const sharing = (h: Harness, key: string) =>
  h.json<Record<string, unknown>>(`/crombolo/crombolo/api/page-sharing/${key}`)

describe('a page’s Info panel', () => {
  test('says how long shared copies are kept, and which files make a page each member’s', async () => {
    const { h, make } = await site()
    const home = await make('Home', 'page')
    expect(await sharing(h, home)).toEqual({
      status: 'shared',
      keptFor: 300,
      checkedWithoutRendering: true,
      memberFiles: [],
    })
    const greeted = await make('Greeted', 'greeted', home)
    expect(await sharing(h, greeted)).toMatchObject({
      status: 'shared',
      memberFiles: ['/greeted.tsx'],
    })
  })

  test('says a members-only page is never shared, and answers nothing for a page the user cannot read', async () => {
    const { h, make } = await site()
    const home = await make('Home', 'page')
    const secret = await make('Secret', 'page', home)
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: secret,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    expect(await sharing(h, secret)).toEqual({ status: 'membersOnly' })
    const missing = await h.call(`/crombolo/crombolo/api/page-sharing/${crypto.randomUUID()}`)
    expect(missing.status).toBe(404)
  })

  test('words what the server says, with no implementation terms', () => {
    expect(
      describeSharing({
        status: 'shared',
        keptFor: 300,
        checkedWithoutRendering: true,
        memberFiles: [],
      })?.text,
    ).toBe('Copies are kept for 5 minutes, checked without rendering.')
    const members = describeSharing({
      status: 'shared',
      keptFor: 3600,
      checkedWithoutRendering: false,
      memberFiles: ['/shared/layout.tsx'],
    })
    expect(members?.text).toStartWith('Copies are kept for 1 hour for signed-out visitors')
    expect(members?.files).toEqual(['/shared/layout.tsx'])
    for (const said of [
      members,
      describeSharing({ status: 'membersOnly' }),
      describeSharing({ status: 'notShared' }),
      describeSharing({ status: 'shared', keptFor: null, memberFiles: [] }),
    ])
      expect(said?.text).not.toMatch(/ETag|validator|Vary|deferred|render\b|cache-control/i)
    expect(duration(90)).toBe('90 seconds')
    expect(duration(86_400)).toBe('1 day')
    expect(fileEditorHref('/shared/layout.tsx', '/umbraco')).toBe(
      '/umbraco/section/settings/workspace/partial-view/edit/%2Fshared%2Flayout%25dot%25tsx',
    )
  })
})

describe('the template editor', () => {
  test('notes each line that shows the member, unless the file loads separately', () => {
    const source = `// member, in a comment, says nothing
export default ({ member }) => <p>{member?.name}</p>
`
    const notes = memberNotes(source)
    expect(notes.map((n: { line: number; start: number }) => [n.line, n.start])).toEqual([[2, 19]])
    expect(memberNotes(`'use deferred'\n${source}`)).toEqual([])
    expect(memberNotes(`/** @jsxImportSource react */\n'use client'\n${source}`)).toEqual([])
    expect(loadsSeparately("  // a note\n'use deferred'\n")).toBe(true)
    expect(loadsSeparately("export const x = 'use deferred'\n")).toBe(false)
  })

  test('inserts a partial view or a personalised part as a tag, and its import beside the others', () => {
    expect(partInsert('@await Html.PartialAsync("shared/user-menu%25dot%25tsx")')).toEqual({
      path: '/shared/user-menu.tsx',
      tag: '<UserMenu />',
    })
    expect(partInsert(personalisedPartSnippet('/shared/greeting.tsx'))).toEqual({
      path: '/shared/greeting.tsx',
      tag: '<Greeting fallback={<span>Loading…</span>} />',
    })
    expect(partInsert('@Model.Value("title")')).toBeUndefined()
    expect(importFor('/shared/greeting.tsx', '/pages/home.tsx')).toBe(
      "import Greeting from '../shared/greeting.tsx'",
    )
    expect(importFor('/shared/greeting.tsx', '/shared/layout.tsx')).toBe(
      "import Greeting from './greeting.tsx'",
    )
    expect(importFor('/greeting.tsx', '/page.tsx')).toBe("import Greeting from './greeting.tsx'")
    const line = "import Greeting from './greeting.tsx'"
    expect(withImport("import { x } from 'y'\n\nexport default 1\n", line)).toBe(
      `import { x } from 'y'\n${line}\n\nexport default 1\n`,
    )
    expect(withImport(`${line}\nexport default 1\n`, line)).toBe(`${line}\nexport default 1\n`)
    expect(componentName('/a/9-lives.tsx')).toBe('Part9Lives')
    expect(partFileName(' User menu ')).toBe('user-menu.tsx')
    expect(partFileName('!!')).toBe('')
  })
})

describe('the create menu', () => {
  test('offers a personalised and an interactive part to start from', async () => {
    const { h } = await site()
    const list = await h.json<{ items: Array<{ id: string; name: string }> }>(
      `${V1}/partial-view/snippet?take=100`,
    )
    expect(list.items.map((s) => s.name)).toEqual(
      expect.arrayContaining(['Personalised part', 'Interactive part']),
    )
    const part = await h.json<{ content: string }>(`${V1}/partial-view/snippet/PersonalisedPart`)
    expect(part.content).toStartWith("'use deferred'")
    const island = await h.json<{ content: string }>(`${V1}/partial-view/snippet/InteractivePart`)
    expect(island.content).toContain("'use client'")
  })
})

describe('previewing as a member', () => {
  async function withMember() {
    const s = await site()
    const created = await s.h.post(`${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: 'ada@example.test',
      username: 'ada',
      password: 'correct-horse-battery',
      isApproved: true,
      groups: [],
      values: [],
      variants: [{ culture: null, segment: null, name: 'Ada' }],
    })
    expect(created.status).toBe(201)
    return { ...s, member: created.headers.get('umb-generated-resource') as string }
  }
  const PATH = '/crombolo/crombolo/api/preview-member'

  test('renders the draft as the chosen member, and records the choice', async () => {
    const { h, make, member } = await withMember()
    const greeted = await make('Greeted', 'greeted')
    const chosen = await h.call(PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member }),
    })
    expect(chosen.status).toBe(200)
    expect(await chosen.json()).toEqual({ allowed: true, member: { key: member, name: 'Ada' } })
    const cookie = (chosen.headers.getSetCookie()[0] ?? '').split(';')[0] as string
    expect(cookie).toStartWith('crombolo-preview-member=')

    const preview = (extra: string) =>
      h.server.fetch(
        new Request(`${ORIGIN}/${greeted}`, {
          headers: { cookie: `${h.cookie()}; UMB_PREVIEW=preview; ${extra}` },
        }),
      )
    expect(await (await preview(cookie)).text()).toContain('Welcome back')
    const signedOut = await h.call(PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member: null }),
    })
    expect(await signedOut.json()).toEqual({ allowed: true, member: null })
    const cleared = (signedOut.headers.getSetCookie()[0] ?? '').split(';')[0] as string
    expect(await (await preview(cleared)).text()).toContain('<p>Welcome</p>')

    const { items } = await new AuditLog(h.server.db).query({}, { skip: 0, take: 50 })
    expect(items.some((e) => e.action === 'preview as' && e.entityKey === member)).toBe(true)
  })

  test('is refused to a user who cannot open Members', async () => {
    const { h, member } = await withMember()
    const writer = await signInAsGroup(h, 'writer')
    expect(await writer.json<Record<string, unknown>>(PATH)).toEqual({
      allowed: false,
      member: null,
    })
    const refused = await writer.call(PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member }),
    })
    expect(refused.status).toBe(403)
    expect(visitorLabel(null)).toBe('Signed out')
    expect(visitorLabel({ name: 'Ada' })).toBe('As Ada')
    expect(ORIGIN).toBeDefined()
  })
})
