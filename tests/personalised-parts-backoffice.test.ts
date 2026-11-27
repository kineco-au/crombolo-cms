/**
 * Story 264: the back office shows whether a page's copies are shared and
 * why not, notes a view that shows the signed-in member, inserts a part with
 * its import, offers starters for a personalised and an interactive part.
 * Story 443: anyone who previews sees the page signed out or as a member of
 * chosen groups, never as a real member.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { memberMayOpen } from '@crombolo/core'
import {
  AuditLog,
  ComponentRepository,
  ContentTypeRepository,
  PublicAccessRepository,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import {
  createSiteMembers,
  formSigningSecret,
  PREVIEW_STAND_IN_KEY,
  previewGroupKeys,
  previewStandIn,
  withSiteWrites,
} from '@crombolo/server'
import {
  describeSharing,
  duration,
  fileEditorHref,
} from '../packages/backoffice-host/plugin/page-sharing.js'
import { STAND_IN_NOTE, visitorLabel } from '../packages/backoffice-host/plugin/preview-member.js'
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
components = ["page", "greeted", "visitor"]
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
  writeFileSync(
    join(root, 'components', 'visitor.tsx'),
    `import { site } from '@crombolo/crombolo/server'
export default async function Visitor({ member }) {
  const found = member ? await site().members.get(member.key) : undefined
  const seen = member && {
    key: member.key,
    name: member.name,
    username: member.username,
    email: member.email,
    roles: member.roles,
    properties: member.properties ?? null,
    found: found?.isOk() ? 'found' : found?.message,
  }
  return <pre>{JSON.stringify(seen ?? 'signed out')}</pre>
}
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
      // Its type has no Caching tab, so the Info panel offers no link to one.
      options: { keepFor: false },
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
      '/umbraco/section/content/code/workspace/partial-view/edit/%2Fshared%2Flayout%25dot%25tsx',
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

describe('previewing as a member of a group', () => {
  const PATH = '/crombolo/crombolo/api/preview-member'
  const choose = (h: Harness, groups: unknown) =>
    h.call(PATH, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groups }),
    })
  const cookieOf = (response: Response) =>
    (response.headers.getSetCookie()[0] ?? '').split(';')[0] as string
  const preview = (h: Harness, key: string, cookie: string) =>
    h.server
      .fetch(
        new Request(`${ORIGIN}/${key}`, {
          headers: { cookie: `${h.cookie()}; UMB_PREVIEW=preview; ${cookie}` },
        }),
      )
      .then((r) => r.text())
  const read = (h: Harness, cookie: string) =>
    h.server
      .fetch(new Request(`${ORIGIN}${PATH}`, { headers: { cookie: `${h.cookie()}; ${cookie}` } }))
      .then((r) => r.json() as Promise<Record<string, unknown>>)
  const SIGNED_OUT = 'crombolo-preview-member='
  const seen = (html: string) => {
    const text = /<pre>(.*?)<\/pre>/s.exec(html)?.[1] ?? ''
    return JSON.parse(text.replaceAll('&quot;', '"').replaceAll('&#x27;', "'"))
  }

  async function withGroups() {
    const s = await site()
    const group = async (name: string) =>
      (await s.h.post(`${V1}/member-group`, { name })).headers.get(
        'umb-generated-resource',
      ) as string
    const staff = await group('Staff')
    const friends = await group('Friends')
    return { ...s, staff, friends }
  }

  test('lists the groups by name, and renders the draft for a stand-in in the chosen ones', async () => {
    const { h, make, staff, friends } = await withGroups()
    const page = await make('Visited', 'visitor')
    expect(await h.json<Record<string, unknown>>(PATH)).toEqual({
      groups: [
        { key: friends, name: 'Friends' },
        { key: staff, name: 'Staff' },
      ],
      chosen: null,
    })
    const chosen = await choose(h, [staff, friends])
    expect(chosen.status).toBe(200)
    expect(await chosen.json()).toMatchObject({
      chosen: {
        groups: [
          { key: staff, name: 'Staff' },
          { key: friends, name: 'Friends' },
        ],
      },
    })
    const cookie = cookieOf(chosen)
    expect(cookie).toStartWith('crombolo-preview-member=g%3A')
    expect(seen(await preview(h, page, cookie))).toEqual({
      key: PREVIEW_STAND_IN_KEY,
      name: 'Preview member',
      username: '',
      email: '',
      roles: ['Staff', 'Friends'],
      properties: null,
      found: 'There is no such member.',
    })
    expect(await read(h, cookie)).toMatchObject({
      chosen: { groups: [{ name: 'Staff' }, { name: 'Friends' }] },
    })

    const signedOut = await choose(h, [])
    expect(await signedOut.json()).toMatchObject({ chosen: null })
    expect(seen(await preview(h, page, cookieOf(signedOut)))).toBe('signed out')
  })

  test('shows a protected page whatever the groups, and the live site never reads the choice', async () => {
    const { h, make, staff } = await withGroups()
    const open = await make('Open', 'greeted')
    const home = await make('Home', 'page')
    const secret = await make('Secret', 'greeted', home)
    await new PublicAccessRepository(h.server.db).save({
      nodeKey: secret,
      loginNodeKey: home,
      errorNodeKey: home,
      memberGroupNames: ['Staff'],
      memberUserNames: [],
    })
    const cookie = cookieOf(await choose(h, [staff]))
    expect(await preview(h, secret, cookie)).toContain('Welcome back')
    expect(await preview(h, secret, SIGNED_OUT)).toContain('<p>Welcome</p>')

    const live = await h.server.fetch(
      new Request(`${ORIGIN}/`, { headers: { cookie: `${h.cookie()}; ${cookie}` } }),
    )
    expect(await live.text()).toContain('<p>Welcome</p>')
    expect(open).toBeDefined()
  })

  test('is open to a user without Members, and the cookie is that user’s alone', async () => {
    const { h, make, staff } = await withGroups()
    const page = await make('Visited', 'visitor')
    const writer = await signInAsGroup(h, 'writer')
    const listed = await writer.json<{ groups: unknown[] }>(PATH)
    expect(listed.groups).toHaveLength(2)
    const chosen = await choose(writer, [staff])
    expect(chosen.status).toBe(200)
    const cookie = cookieOf(chosen)
    expect(seen(await preview(writer, page, cookie)).roles).toEqual(['Staff'])
    expect(seen(await preview(h, page, cookie))).toBe('signed out')
  })

  test('names a renamed group as it is now, drops a deleted one, and is signed out with none left', async () => {
    const { h, make, staff, friends } = await withGroups()
    const page = await make('Visited', 'visitor')
    const cookie = cookieOf(await choose(h, [staff, friends]))
    expect((await h.put(`${V1}/member-group/${staff}`, { name: 'Employees' })).status).toBe(200)
    expect(seen(await preview(h, page, cookie)).roles).toEqual(['Employees', 'Friends'])
    expect((await h.call(`${V1}/member-group/${friends}`, { method: 'DELETE' })).status).toBe(200)
    expect(seen(await preview(h, page, cookie)).roles).toEqual(['Employees'])
    expect((await h.call(`${V1}/member-group/${staff}`, { method: 'DELETE' })).status).toBe(200)
    expect(seen(await preview(h, page, cookie))).toBe('signed out')
  })

  test('reads a cookie naming a real member as signed out', async () => {
    const { h, make } = await withGroups()
    const page = await make('Visited', 'visitor')
    const created = await h.post(`${V1}/member`, {
      memberType: { id: SYSTEM_MEMBER_TYPE.key },
      email: 'ada@example.test',
      username: 'ada',
      password: 'correct-horse-battery',
      isApproved: true,
      groups: [],
      values: [],
      variants: [{ culture: null, segment: null, name: 'Ada' }],
    })
    const member = created.headers.get('umb-generated-resource') as string
    const user = (await h.json<{ id: string }>(`${V1}/user/current`)).id
    const key = `deferred|${await formSigningSecret(h.server.db)}`
    const signature = new Bun.CryptoHasher('sha256', key)
      .update(`preview-member|${member}|${user}`)
      .digest('base64url')
    const old = `crombolo-preview-member=${encodeURIComponent(`${member}.${signature}`)}`
    expect(seen(await preview(h, page, old))).toBe('signed out')
    expect(await read(h, old)).toMatchObject({ chosen: null })
    expect(previewGroupKeys(member)).toEqual([])
    expect(previewGroupKeys(`g:${member.toUpperCase()},`)).toEqual([member.toLowerCase()])
    const chosen = await choose(h, [member])
    expect(chosen.status).toBe(404)
    expect(((await chosen.json()) as { message: string }).message).toBe(
      'One of those member groups no longer exists.',
    )
    expect((await choose(h, 'Staff')).status).toBe(400)
  })

  test('records each switch in the audit log, with the group names', async () => {
    const { h, staff, friends } = await withGroups()
    await choose(h, [staff, friends])
    await choose(h, [])
    const { items } = await new AuditLog(h.server.db).query({}, { skip: 0, take: 50 })
    const switches = items.filter((e) => e.action.startsWith('preview '))
    expect(switches.map((e) => [e.action, e.detail])).toEqual(
      expect.arrayContaining([
        ['preview as groups', 'Staff, Friends'],
        ['preview signed out', null],
      ]),
    )
    expect(items.some((e) => e.action === 'preview as')).toBe(false)
  })

  test('the stand-in is in its groups and nobody else: what it writes as itself is refused', async () => {
    const { h, staff } = await withGroups()
    const stand = previewStandIn(['Staff'])
    expect(stand).toEqual({
      key: PREVIEW_STAND_IN_KEY,
      name: 'Preview member',
      username: '',
      email: '',
      roles: ['Staff'],
    })
    const rule = { memberGroupNames: ['staff'], memberUserNames: [''] }
    expect(memberMayOpen(rule, { username: stand.username, groups: stand.roles })).toBe(true)
    expect(
      memberMayOpen(
        { memberGroupNames: ['Friends'], memberUserNames: [] },
        {
          username: '',
          groups: stand.roles,
        },
      ),
    ).toBe(false)

    const members = createSiteMembers({
      db: h.server.db,
      nodeState: h.server.schema.nodeState,
      groups: { selfService: ['Staff'] },
    })(async () => ({ kind: 'member', ...stand }))
    const inRoute = <T>(run: () => T) =>
      withSiteWrites({ via: 'route POST /x', source: 'request' }, run)
    const refused = [
      await inRoute(() => members.me()),
      await inRoute(() => members.update(stand.key, { name: 'Changed' })),
      await inRoute(() => members.addToGroups(stand.key, ['Staff'])),
    ]
    expect(refused.map((r) => (r.isOk() ? 200 : r.status))).toEqual([403, 404, 404])
    expect(staff).toBeDefined()
  })

  test('the switch words who the page is shown to, and what a stand-in cannot show', () => {
    expect(visitorLabel(null)).toBe('Signed out')
    expect(visitorLabel({ groups: [{ name: 'Staff' }, { name: 'Friends' }] })).toBe(
      'A member of Staff, Friends',
    )
    expect(STAND_IN_NOTE).toContain('look the member up')
    expect(ORIGIN).toBeDefined()
  })
})
