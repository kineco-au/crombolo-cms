/**
 * Story 368: a preview link opens one page's draft in any browser, for a few
 * minutes, with no back-office sign-in in it. The link's token is used once,
 * swapped for an httpOnly cookie and redirected away from; the cookie shows that
 * page's draft as its person, checked again on every request, and published
 * content everywhere else.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AuditLog, ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import {
  readPreviewCookie,
  readPreviewLink,
  signPreviewLink,
} from '../packages/server/src/preview-links.ts'
import { previewSigningSecret, readPreviewToken } from '../packages/server/src/preview-tokens.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const LINKS = `${BACKOFFICE}/crombolo/api/preview-link`

const TYPE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

const VIEW = `export default function Page({ model }) {
  return <main><h1>{model.text('title')}</h1></main>
}
`

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

/** Home and About, each published and then given a draft title. */
async function site() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'preview-link-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), TYPE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  const h = await signedInServer({
    config: { schemaDir: join(root, 'schema'), componentsDir: join(root, 'components') },
  })
  open.push(h)
  const typeKey = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(h.server.db).byAlias('page'))?.key as string
  const body = (name: string, title: string) => ({
    template: { id: componentKey },
    values: [{ alias: 'title', culture: null, segment: null, value: title }],
    variants: [{ culture: null, segment: null, name }],
  })
  const page = async (name: string, parent: string | null) => {
    const created = await h.post(`${V1}/document`, {
      ...body(name, `${name} published`),
      documentType: { id: typeKey },
      parent: parent ? { id: parent } : null,
    })
    expect(created.status).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(
      200,
    )
    const etag = (await h.call(`${V1}/document/${key}`)).headers.get('etag') as string
    const saved = await h.call(`${V1}/document/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'if-match': etag },
      body: JSON.stringify(body(name, `${name} draft`)),
    })
    expect(saved.status).toBe(200)
    return key
  }
  const home = await page('Home', null)
  const about = await page('About', home)
  /** A browser with no sign-in: only the cookie it is given. */
  const visit = (url: string, cookie?: string) =>
    h.server.fetch(
      new Request(url.startsWith('/') ? `${ORIGIN}${url}` : url, {
        headers: cookie ? { cookie } : {},
        redirect: 'manual',
      }),
    )
  const ask = (by: Harness, document: string) => by.post(LINKS, { document })
  return { h, home, about, visit, ask }
}

const cookieOf = (response: Response) => response.headers.get('set-cookie')?.split(';')[0]

describe(`a preview link (${dialectUnderTest})`, () => {
  test('opens its page’s draft once, behind a cookie, and published content elsewhere', async () => {
    const { h, about, visit, ask } = await site()
    const asked = await ask(h, about)
    expect(asked.status).toBe(200)
    const { url, expiresAt } = (await asked.json()) as { url: string; expiresAt: string }
    expect(new URL(url).searchParams.has('crombolo-preview')).toBe(true)
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(5 * 60_000)

    const first = await visit(url)
    expect(first.status).toBe(303)
    const location = first.headers.get('location') as string
    expect(location).not.toContain('crombolo-preview')
    expect(first.headers.get('set-cookie')).toContain('HttpOnly')
    const cookie = cookieOf(first) as string
    expect(cookie).toStartWith('crombolo_preview_link=')

    const page = await visit(location, cookie)
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toContain('no-store')
    expect(await page.text()).toContain('About draft')
    expect(await (await visit('/', cookie)).text()).toContain('Home published')

    // Used once: the same link again drops the token and leaves no cookie.
    const again = await visit(url)
    expect(again.status).toBe(303)
    expect(again.headers.get('set-cookie')).toBeNull()
    expect(await (await visit(location)).text()).toContain('About published')

    const { items } = await new AuditLog(h.server.db).page({ action: 'PreviewLink' }, { limit: 5 })
    expect(items.map((e) => [e.entityKey, e.userName])).toEqual([[about, 'Administrator']])
  })

  test('ends when its person is locked out', async () => {
    const { h, about, visit, ask } = await site()
    const editor = await signInAsGroup(h, 'editor')
    open.push(editor)
    const { url } = (await (await ask(editor, about)).json()) as { url: string }
    const first = await visit(url)
    const cookie = cookieOf(first) as string
    const location = first.headers.get('location') as string
    expect(await (await visit(location, cookie)).text()).toContain('About draft')

    const me = await editor.json<{ id: string }>(`${V1}/user/current`)
    await h.server.db.q
      .updateTable('user_account')
      .set({ is_locked_out: h.server.db.dialect.boolValue(true) })
      .where('key', '=', me.id)
      .execute()
    expect(await (await visit(location, cookie)).text()).toContain('About published')
  })

  test('is refused for a page its person may not read, and to nobody signed in', async () => {
    const { h, visit, ask } = await site()
    expect((await ask(h, crypto.randomUUID())).status).toBe(403)
    const anonymous = await visit(LINKS)
    expect([401, 405]).toContain(anonymous.status)
    const forged = await visit('/?crombolo-preview=forged.token')
    expect(forged.status).toBe(303)
    expect(forged.headers.get('set-cookie')).toBeNull()
  })

  test('is signed for itself, so it is never a Delivery API preview token or a cookie', async () => {
    const { h } = await site()
    const secret = await previewSigningSecret(h.server.db)
    const token = signPreviewLink(secret, {
      user: 1,
      stamp: 's',
      document: crypto.randomUUID(),
      culture: null,
      expires: Date.now() + 60_000,
      id: 'one',
    })
    expect(readPreviewLink(secret, token)?.id).toBe('one')
    expect(readPreviewToken(secret, token)).toBeUndefined()
    expect(readPreviewCookie(secret, token)).toBeUndefined()
  })
})
