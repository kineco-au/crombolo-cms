/**
 * Story 263: a page shared by every visitor, signed in or not, with the parts
 * that show the member fetched in a request of their own. A `'use deferred'`
 * view is a placeholder holding its fallback in the page; the page depends on
 * the member only when a view it rendered mentions them.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository, SYSTEM_MEMBER_TYPE } from '@crombolo/data'
import {
  DEFERRED_LOADER_ADDRESS,
  DEFERRED_LOADER_PATH,
  deferredAddress,
  deferredSourceKey,
  deferredTransform,
  readDeferredAddress,
} from '@crombolo/render'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

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

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const LAYOUT = `import Greeting from './greeting.tsx'
export const Layout = ({ title, children }) => (
  <html><body>
    <header><Greeting fallback={<a href="/sign-in">Sign in</a>} where={title} /></header>
    <main>{children}</main>
  </body></html>
)
`

const GREETING = `'use deferred'
import { usePage } from '@crombolo/crombolo'
export default function Greeting({ where }) {
  const { member, model } = usePage()
  return member
    ? <a href="/account">Hi {member.name}, on {model.name} ({where})</a>
    : <a href="/sign-in">Sign in</a>
}
`

/** A page that names the member outside a part, as a site does before it uses one. */
const GREETED = `import { Layout } from './shared/layout.tsx'
export default ({ model, member }) => (
  <Layout title={model.name}><p>{member ? 'Welcome back' : 'Welcome'}</p></Layout>
)
`

async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'deferred-parts-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components/shared'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'shared', 'layout.tsx'), LAYOUT)
  writeFileSync(join(root, 'components', 'shared', 'greeting.tsx'), GREETING)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    `import { Layout } from './shared/layout.tsx'
export default (props) => <Layout title={props.model.name} {...props}><h1>{props.model.text('title')}</h1></Layout>
`,
  )
  writeFileSync(join(root, 'components', 'greeted.tsx'), GREETED)
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo'),
      cache: { maxAge: 60 },
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
      values: [{ alias: 'title', culture: null, segment: null, value: name }],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(created.status).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(
      200,
    )
    return key
  }
  const home = await make('Home', 'page')
  await make('Greeted', 'greeted', home)
  const member = await h.post(`${V1}/member`, {
    memberType: { id: SYSTEM_MEMBER_TYPE.key },
    email: 'ada@example.test',
    username: 'ada',
    password: 'correct-horse-battery',
    isApproved: true,
    groups: [],
    values: [],
    variants: [{ culture: null, segment: null, name: 'Ada' }],
  })
  expect(member.status).toBe(201)
  const visit = (path: string, headers: Record<string, string> = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${path}`, { headers, redirect: 'manual' }))
  const signIn = async () => {
    const response = await h.server.fetch(
      new Request(`${ORIGIN}/umbraco/members/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'ada', password: 'correct-horse-battery' }),
      }),
    )
    return (response.headers.getSetCookie()[0] ?? '').split(';')[0] ?? ''
  }
  return { h, visit, signIn }
}

const partSrc = (html: string) =>
  /<crombolo-deferred src="([^"]+)">/.exec(html)?.[1]?.replaceAll('&amp;', '&') as string

describe('a page with a deferred part', () => {
  test('is the same for a member as for anyone: the fallback, the loader, and no member', async () => {
    const { visit, signIn } = await site()
    const anonymous = await visit('/')
    const html = await anonymous.text()
    expect(anonymous.headers.get('cache-control')).toBe('public, max-age=60, stale-if-error=604800')
    expect(anonymous.headers.get('vary')).toBeNull()
    expect(html).toContain('<a href="/sign-in">Sign in</a></crombolo-deferred>')
    expect(html).toContain(
      `<script type="module" src="${DEFERRED_LOADER_ADDRESS}"></script></body>`,
    )

    const cookie = await signIn()
    const member = await visit('/', { cookie })
    expect(member.headers.get('cache-control')).toBe('public, max-age=60, stale-if-error=604800')
    const memberHtml = await member.text()
    expect(memberHtml).not.toContain('Ada')
    expect(memberHtml).toBe(html)
  })

  test('the part is fetched with the visitor’s cookies, private, and sees the page', async () => {
    const { visit, signIn } = await site()
    const src = partSrc(await (await visit('/')).text())
    expect(src).toStartWith('/crombolo/deferred?d=')

    const anonymous = await visit(src)
    expect(anonymous.status).toBe(200)
    expect(anonymous.headers.get('cache-control')).toBe('private, no-store')
    expect(await anonymous.text()).toBe('<a href="/sign-in">Sign in</a>')

    const part = await visit(src, { cookie: await signIn() })
    expect(await part.text()).toBe('<a href="/account">Hi Ada, on Home (Home)</a>')
  })

  test('an address this site did not sign renders nothing', async () => {
    const { visit } = await site()
    const src = partSrc(await (await visit('/')).text())
    const url = new URL(src, ORIGIN)
    const changed = JSON.parse(
      Buffer.from(url.searchParams.get('d') as string, 'base64url').toString(),
    )
    changed.p.where = 'Elsewhere'
    url.searchParams.set('d', Buffer.from(JSON.stringify(changed)).toString('base64url'))
    const forged = await visit(`${url.pathname}${url.search}`)
    expect(forged.status).toBe(404)
    expect(forged.headers.get('cache-control')).toBe('private, no-store')
  })

  test('a view that mentions the member makes the page the member’s, and says so to a CDN', async () => {
    const { visit, signIn } = await site()
    const anonymous = await visit('/greeted')
    expect(anonymous.headers.get('cache-control')).toBe('public, max-age=60, stale-if-error=604800')
    expect(anonymous.headers.get('vary')).toBe('X-Crombolo-Member')
    expect(await anonymous.text()).toContain('<p>Welcome</p>')
    const member = await visit('/greeted', { cookie: await signIn() })
    expect(member.headers.get('cache-control')).toBe('private, no-store')
    expect(await member.text()).toContain('<p>Welcome back</p>')
  })

  test('the loader is served', async () => {
    const { visit } = await site()
    const loader = await visit(DEFERRED_LOADER_PATH)
    expect(loader.headers.get('content-type')).toStartWith('text/javascript')
    expect(await loader.text()).toContain("querySelectorAll('crombolo-deferred[src]')")
  })
})

describe('the deferred transform and address', () => {
  test('writes a deferred module as a stub over its source, kept beside it', () => {
    const source = new TextEncoder().encode(GREETING)
    const written = deferredTransform('shared/greeting.tsx', source)
    expect(written).toBeDefined()
    const { bytes, beside } = written as { bytes: Uint8Array; beside: string }
    expect(beside).toBe('shared/greeting.deferred-source.tsx')
    expect(deferredSourceKey('a/b.jsx')).toBe('a/b.deferred-source.jsx')
    const stub = new TextDecoder().decode(bytes)
    expect(stub).toContain('import * as part from "./greeting.deferred-source.tsx"')
    expect(stub).toContain('export default (props) =>')
    expect(
      deferredTransform('shared/plain.tsx', new TextEncoder().encode('export default 1')),
    ).toBeUndefined()
    expect(
      deferredTransform('site.css', new TextEncoder().encode("'use deferred'")),
    ).toBeUndefined()
  })

  test('reads back only an address signed with the same key', () => {
    const sign = (data: string) => `sig-${data.length}`
    const src = deferredAddress(
      {
        module: 'shared/greeting.tsx',
        exportName: 'default',
        key: 'k',
        culture: null,
        props: { a: 1 },
      },
      sign,
    )
    const search = new URL(src, ORIGIN).searchParams
    const verify = (data: string, signature: string) => sign(data) === signature
    expect(readDeferredAddress(search, verify)).toEqual({
      module: 'shared/greeting.tsx',
      exportName: 'default',
      key: 'k',
      culture: null,
      props: { a: 1 },
    })
    expect(readDeferredAddress(search, () => false)).toBeUndefined()
  })
})
