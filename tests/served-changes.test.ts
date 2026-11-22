/**
 * Story 395: what is live, for an editor where a site is made. A host reports each
 * change it applied to the served copy; once it has, schema is built in a named
 * workspace, and what the served copy does not have is not offered for making
 * content outside one. A publish names the changes it needs, and who made it; a
 * schedule is passed on as a publish is; and a host leaves a person a notice.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ChangeRepository,
  ComponentRepository,
  ContentTypeRepository,
  DocumentRepository,
  ExternalLoginRepository,
  externalLoginProvider,
  UserGroupRepository,
} from '@crombolo/data'
import {
  type CromboloConfig,
  JWT_TOKEN_TYPE,
  oidc,
  REMOTE_API_PATH,
  TOKEN_EXCHANGE_GRANT,
} from '@crombolo/server'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { unpackChange } from '../packages/server/src/remote-changes.ts'
import { noticeLink } from '../packages/server/src/served-api.ts'
import { type ServedView, withoutUnserved } from '../packages/server/src/served-schema.ts'
import { webhookPayload } from '../packages/server/src/webhooks.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const PLUGIN = `${BACKOFFICE}/crombolo/api`
const SERVED = `${PLUGIN}/changes/served`
const NOTICES = `${PLUGIN}/notices`
const HOME = '6b2f1f0e-3c1d-4a8e-9f00-000000000395'
const AUDIENCE = 'api://crombolo-remote'

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"

[[property]]
alias = "title"
name = "Title"
type = "textstring"
`

let issuer = ''
let idp: ReturnType<typeof Bun.serve>
let privateKey: CryptoKey

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'RS256', use: 'sig' }
  idp = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/.well-known/openid-configuration')
        return Response.json({ issuer, jwks_uri: `${issuer}/jwks` })
      if (pathname === '/jwks') return Response.json({ keys: [jwk] })
      return new Response('Not Found', { status: 404 })
    },
  })
  issuer = `http://localhost:${idp.port}`
})
afterAll(() => idp.stop(true))

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

/** The signed-in session's own access token, as a host's tool would send it. */
const tokenOf = (h: Harness) => /umbAccessToken[^=]*=([^;]+)/.exec(h.cookie())?.[1] as string

const newType = (alias: string, templates: string[] = []) => ({
  alias,
  name: alias,
  icon: 'icon-document',
  description: null,
  allowedAsRoot: true,
  variesByCulture: false,
  variesBySegment: false,
  isElement: false,
  allowedInLibrary: false,
  collection: null,
  cleanup: {
    preventCleanup: false,
    keepAllVersionsNewerThanDays: null,
    keepLatestVersionPerDayForDays: null,
  },
  properties: [],
  containers: [],
  compositions: [],
  allowedDocumentTypes: [],
  allowedTemplates: templates.map((id) => ({ id })),
  defaultTemplate: templates[0] ? { id: templates[0] } : null,
  parent: null,
})

async function site(config: Partial<CromboloConfig> = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'served-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      schemaWritable: true,
      workspaces: true,
      ...config,
    },
  })
  open.push(h)
  const db = h.server.db
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const send = (method: string, path: string, body?: unknown, headers = {}, as = h) =>
    as.call(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const bearer = (token: string, path: string, init: RequestInit = {}) =>
    h.server.fetch(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(init.headers as Record<string, string>),
          authorization: `Bearer ${token}`,
        },
      }),
    )
  const report = (key: string, token = tokenOf(h)) =>
    bearer(token, SERVED, { method: 'PUT', body: JSON.stringify({ key }) })
  const created = await send('POST', `${V1}/document`, {
    id: HOME,
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [{ alias: 'title', culture: null, segment: null, value: 'Welcome' }],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status, await created.clone().text()).toBe(201)
  const publish = async (body: unknown = { publishSchedules: [{ culture: null }] }, as = h) => {
    const response = await send('PUT', `${V1}/document/${HOME}/publish`, body, {}, as)
    expect(response.status, await response.clone().text()).toBe(200)
  }
  await publish()
  /** The newest change, by when it began. */
  const newest = async () => (await new ChangeRepository(db).list(0, 1)).items[0]
  /** What each `Crombolo.ChangePublished` said, in no order: events keep none. */
  const announced = async () =>
    (
      await db.q
        .selectFrom('content_event')
        .select('facts')
        .where('kind', '=', 'change-published')
        .execute()
    ).map(
      (e) =>
        (JSON.parse(String(e.facts)) as { webhook: { change: Record<string, unknown> } }).webhook
          .change,
    )
  /** What the one event `act` raised said. */
  const announcedBy = async (act: () => Promise<unknown>) => {
    const before = new Set((await announced()).map((c) => c.key))
    await act()
    const fresh = (await announced()).filter((c) => !before.has(c.key))
    expect(fresh).toHaveLength(1)
    return fresh[0] as Record<string, unknown>
  }
  const offeredAtRoot = async (headers: Record<string, string> = {}) =>
    (
      (await (
        await send('GET', `${V1}/document-type/allowed-at-root`, undefined, headers)
      ).json()) as {
        items: Array<{ id: string }>
      }
    ).items.map((i) => i.id)
  const close = async () => {
    open.splice(open.indexOf(h), 1)
    await h.db.close()
  }
  return {
    h,
    db,
    typeKey,
    componentKey,
    send,
    bearer,
    report,
    publish,
    newest,
    announcedBy,
    offeredAtRoot,
    close,
  }
}

/** A new type and template made straight in Shared, and Page allowed to use the template. */
async function madeEvent(s: Awaited<ReturnType<typeof site>>) {
  const view = await s.send('POST', `${V1}/partial-view`, {
    name: 'event.tsx',
    parent: null,
    content: 'export default () => <article />\n',
  })
  expect(view.status, await view.clone().text()).toBe(201)
  const registered = await s.send('POST', `${PLUGIN}/templates`, { alias: 'event' })
  expect(registered.status, await registered.clone().text()).toBe(201)
  const template = ((await registered.json()) as { id: string }).id
  const type = await s.send('POST', `${V1}/document-type`, newType('event', [template]))
  expect(type.status, await type.clone().text()).toBe(201)
  const page = (await (await s.send('GET', `${V1}/document-type/${s.typeKey}`)).json()) as Record<
    string,
    unknown
  > & { allowedTemplates: Array<{ id: string }> }
  const saved = await s.send('PUT', `${V1}/document-type/${s.typeKey}`, {
    ...page,
    allowedTemplates: [...page.allowedTemplates, { id: template }],
  })
  expect(saved.status, await saved.clone().text()).toBe(200)
  return {
    template,
    type: type.headers.get('umb-generated-resource') as string,
    change: (await s.newest())?.key as string,
  }
}

describe(`what is live, where a site is made (${dialectUnderTest})`, () => {
  test('the mark is reported and read with Apply changes, by a token alone', async () => {
    const s = await site()
    const token = tokenOf(s.h)
    const read = async () =>
      (await (await s.bearer(token, SERVED)).json()) as Record<string, unknown>
    expect(await read()).toEqual({ newest: null, waiting: 0 })
    expect((await s.send('GET', SERVED)).status).toBe(401)
    expect((await s.report('not-a-key')).status).toBe(400)
    expect((await s.report(randomUUID())).status).toBe(404)

    const first = (await s.newest())?.key as string
    expect((await s.report(first)).status).toBe(200)
    expect((await s.report(first)).status).toBe(200)
    expect(await read()).toMatchObject({ newest: { key: first }, waiting: 0 })

    const writer = await signInAsGroup(s.h, 'writer')
    expect((await s.report(first, tokenOf(writer))).status).toBe(403)
    expect((await s.bearer(tokenOf(writer), SERVED)).status).toBe(403)
  }, 30_000)

  test('with nothing reported, schema is built anywhere and everything is offered', async () => {
    const s = await site()
    const made = await madeEvent(s)
    expect(await s.offeredAtRoot()).toContain(made.type)
    const page = (await (
      await s.send('GET', `${V1}/document-type/${s.typeKey}`, undefined, {
        'crombolo-purpose': 'content',
      })
    ).json()) as { allowedTemplates: Array<{ id: string }> }
    expect(page.allowedTemplates.map((t) => t.id)).toContain(made.template)
  }, 30_000)

  test('once reported, schema outside a named workspace is refused; in one it is made', async () => {
    const s = await site()
    expect((await s.report((await s.newest())?.key as string)).status).toBe(200)
    const refused = await s.send('POST', `${V1}/document-type`, newType('news'))
    expect(refused.status).toBe(409)
    expect(((await refused.json()) as { title: string }).title).toBe('Build this in a workspace')
    expect(
      (
        await s.send('POST', `${V1}/document-type`, newType('news'), {
          'crombolo-workspace': 'mine',
        })
      ).status,
    ).toBe(409)
    expect(
      (
        await s.send('POST', `${V1}/partial-view`, {
          name: 'news.tsx',
          parent: null,
          content: 'export default () => <p />\n',
        })
      ).status,
    ).toBe(409)

    const workspace = await s.send('POST', `${PLUGIN}/workspaces`, { name: 'Autumn release' })
    const { key } = (await workspace.json()) as { key: string }
    expect(
      (await s.send('POST', `${V1}/document-type`, newType('news'), { 'crombolo-workspace': key }))
        .status,
    ).toBe(201)
    // Pages are still written in Shared.
    await s.publish()
  }, 30_000)

  test('schema past the mark stays in Settings, and is offered for content once reported', async () => {
    const s = await site()
    const before = (await s.newest())?.key as string
    const made = await madeEvent(s)
    expect((await s.report(before)).status).toBe(200)

    const tree = (await (await s.send('GET', `${V1}/tree/document-type/root`)).json()) as {
      items: Array<{ id: string }>
    }
    expect(tree.items.map((i) => i.id)).toContain(made.type)
    expect(await s.offeredAtRoot()).not.toContain(made.type)
    expect(await s.offeredAtRoot()).toContain(s.typeKey)
    expect(await s.offeredAtRoot({ 'crombolo-workspace': 'mine' })).not.toContain(made.type)
    const workspace = await s.send('POST', `${PLUGIN}/workspaces`, { name: 'Autumn release' })
    const { key } = (await workspace.json()) as { key: string }
    expect(await s.offeredAtRoot({ 'crombolo-workspace': key })).toContain(made.type)

    const templates = async (headers: Record<string, string>) =>
      (
        (await (
          await s.send('GET', `${V1}/document-type/${s.typeKey}`, undefined, headers)
        ).json()) as {
          allowedTemplates: Array<{ id: string }>
        }
      ).allowedTemplates.map((t) => t.id)
    expect(await templates({ 'crombolo-purpose': 'content' })).toEqual([s.componentKey])
    expect(await templates({})).toContain(made.template)

    const status = (await (await s.bearer(tokenOf(s.h), SERVED)).json()) as { waiting: number }
    expect(status.waiting).toBe(1)
    expect((await s.report(made.change)).status).toBe(200)
    expect(await s.offeredAtRoot()).toContain(made.type)
    expect(await templates({ 'crombolo-purpose': 'content' })).toContain(made.template)
  }, 30_000)

  test('a publish using something past the mark goes ahead, and its event names what it needs', async () => {
    const s = await site()
    const before = (await s.newest())?.key as string
    const made = await madeEvent(s)
    expect((await s.report(before)).status).toBe(200)
    expect(await s.announcedBy(() => s.publish())).toMatchObject({
      by: 'person',
      needs: [{ key: made.change, items: [{ kind: 'documentType', alias: 'page' }] }],
    })

    expect((await s.report(made.change)).status).toBe(200)
    expect(await s.announcedBy(() => s.publish())).toMatchObject({ needs: [] })
  }, 30_000)

  test('setting a schedule closes the change, raises the event, and carries the schedule', async () => {
    const source = await site()
    const at = '2031-05-01T09:00:00.000Z'
    const said = await source.announcedBy(() =>
      source.publish({ publishSchedules: [{ culture: null, schedule: { publishTime: at } }] }),
    )
    const change = await new ChangeRepository(source.db).byId(said.key as string)
    expect(change?.closedAt).not.toBeNull()
    const response = await source.bearer(
      tokenOf(source.h),
      `${PLUGIN}/changes/${change?.id}/bundle`,
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const sha = response.headers.get('crombolo-sha256') as string
    const file = join(dirs[0] as string, 'scheduled.tgz')
    writeFileSync(file, bytes)
    const { change: bundle } = await unpackChange(file)
    expect(bundle.pages.find((p) => p.key === HOME)?.after?.schedule).toEqual([
      { culture: null, publishTime: at, unpublishTime: null },
    ])

    await source.close()

    const served = await site()
    const applied = await served.bearer(tokenOf(served.h), `${PLUGIN}/changes`, {
      method: 'PUT',
      body: bytes as Uint8Array<ArrayBuffer>,
      headers: { 'crombolo-sha256': sha, 'content-type': 'application/gzip' },
    })
    expect(applied.status, await applied.clone().text()).toBe(200)
    const schedule = await new DocumentRepository(served.db).schedules(HOME)
    expect(schedule.map((s) => ({ action: s.action, date: s.date.toISOString() }))).toEqual([
      { action: 'Release', date: at },
    ])
  }, 30_000)

  test('a publish by a tool acting for a person says so', async () => {
    const s = await site({
      backofficeIdentityProviders: [
        oidc({
          id: 'corp',
          name: 'Corp',
          issuer,
          clientId: 'back-office-app',
          claims: { identity: 'oid' },
          remoteExchange: { audience: AUDIENCE },
        }),
      ],
    })
    const groups = new UserGroupRepository(s.db)
    const editor = await groups.byAlias('editor')
    const created = await s.h.post(`${V1}/user`, {
      kind: 'Default',
      email: 'pat@example.com',
      userName: 'pat@example.com',
      name: 'Pat',
      userGroupIds: [{ id: editor?.key }],
    })
    await new ExternalLoginRepository(s.db).link(
      created.headers.get('umb-generated-resource') as string,
      externalLoginProvider('user', 'corp'),
      'sign-in-sub',
      { value: 'oid-1', issuer },
    )
    const now = Math.floor(Date.now() / 1000)
    const subject = await new SignJWT({
      oid: 'oid-1',
      sub: 'pairwise',
      act: { sub: 'agent-7', name: 'Release bot' },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(issuer)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 600)
      .setJti(randomUUID())
      .sign(privateKey)
    const exchanged = await s.h.server.fetch(
      new Request(`${ORIGIN}${REMOTE_API_PATH}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT,
          subject_token: subject,
          subject_token_type: JWT_TOKEN_TYPE,
        }),
      }),
    )
    expect(exchanged.status, await exchanged.clone().text()).toBe(200)
    const token = ((await exchanged.json()) as { access_token: string }).access_token
    const said = await s.announcedBy(async () => {
      const published = await s.bearer(token, `${V1}/document/${HOME}/publish`, {
        method: 'PUT',
        body: JSON.stringify({ publishSchedules: [{ culture: null }] }),
      })
      expect(published.status, await published.clone().text()).toBe(200)
    })
    expect(said).toMatchObject({ by: 'tool', tool: { id: 'agent-7', name: 'Release bot' } })
    expect(await s.announcedBy(() => s.publish())).toMatchObject({ by: 'person' })
  }, 30_000)

  test('a host leaves a person a notice, shown to them once', async () => {
    const s = await site()
    const me = (await s.h.json<{ id: string }>(`${V1}/user/current`)).id
    const token = tokenOf(s.h)
    const post = (body: unknown, as = token) =>
      s.bearer(as, NOTICES, { method: 'POST', body: JSON.stringify(body) })
    expect(
      (
        await post({
          user: me,
          kind: 'failure',
          message: 'Home is waiting for the Autumn release.',
          link: '/section/content',
        })
      ).status,
    ).toBe(201)
    expect((await s.send('POST', NOTICES, { user: me, message: 'x' })).status).toBe(401)
    expect((await post({ user: me, message: 'x', link: 'javascript:alert(1)' })).status).toBe(400)
    expect((await post({ user: me, message: 'x', kind: 'maybe' })).status).toBe(400)
    expect((await post({ user: randomUUID(), message: 'x' })).status).toBe(404)
    const writer = await signInAsGroup(s.h, 'writer')
    expect((await post({ user: me, message: 'x' }, tokenOf(writer))).status).toBe(403)

    const mine = async () =>
      ((await (await s.send('GET', `${NOTICES}/mine`)).json()) as { items: unknown[] }).items
    expect(await mine()).toEqual([
      expect.objectContaining({
        kind: 'failure',
        message: 'Home is waiting for the Autumn release.',
        link: '/section/content',
      }),
    ])
    expect(await mine()).toEqual([])
  }, 30_000)
})

describe('what the served copy lacks, taken out of what is offered', () => {
  const view: ServedView = {
    hiddenTypes: new Set(['11111111-1111-1111-1111-111111111111']),
    hiddenTemplates: new Set(['22222222-2222-2222-2222-222222222222']),
    pending: new Map(),
  }
  const answer = (body: unknown) => Response.json(body)

  test('the block pickers leave out element types the served copy lacks', async () => {
    const body = {
      values: [
        {
          alias: 'blocks',
          value: [
            { contentElementTypeKey: '11111111-1111-1111-1111-111111111111' },
            { contentElementTypeKey: '33333333-3333-3333-3333-333333333333' },
          ],
        },
        { alias: 'validationLimit', value: { min: 0 } },
      ],
    }
    const filtered = (await (
      await withoutUnserved(answer(body), 'GetDataTypeById', view, true)
    ).json()) as typeof body
    expect(filtered.values[0]?.value).toEqual([
      { contentElementTypeKey: '33333333-3333-3333-3333-333333333333' },
    ])
    const settings = (await (
      await withoutUnserved(answer(body), 'GetDataTypeById', view, false)
    ).json()) as typeof body
    expect(settings).toEqual(body)
  })

  test('a template the served copy lacks is not a default either', async () => {
    const body = {
      allowedTemplates: [{ id: '22222222-2222-2222-2222-222222222222' }],
      defaultTemplate: { id: '22222222-2222-2222-2222-222222222222' },
    }
    expect(
      await (await withoutUnserved(answer(body), 'GetDocumentTypeById', view, true)).json(),
    ).toEqual({ allowedTemplates: [], defaultTemplate: null })
  })

  test('the payload names the change, who made it and what it needs', () => {
    const facts = {
      alias: 'Crombolo.ChangePublished',
      key: HOME,
      change: {
        key: 'c1',
        name: null,
        by: 'tool' as const,
        tool: { id: 'agent-7', name: 'Release bot' },
        needs: [{ key: 'c0', name: 'Autumn', items: [{ kind: 'documentType', alias: 'event' }] }],
      },
    }
    expect(webhookPayload(facts, 'minimal')).toEqual({
      Id: HOME,
      Change: {
        Key: 'c1',
        Name: null,
        By: 'tool',
        Tool: { Id: 'agent-7', Name: 'Release bot' },
        Needs: [{ Key: 'c0', Name: 'Autumn', Items: [{ Kind: 'documentType', Alias: 'event' }] }],
      },
    })
  })

  test('a notice links to a back office path or a web address, nothing else', () => {
    expect(noticeLink(undefined)).toBeNull()
    expect(noticeLink('/section/content')).toBe('/section/content')
    expect(noticeLink('https://ci.example.com/run/1')).toBe('https://ci.example.com/run/1')
    expect(noticeLink('//evil.example.com')).toBeUndefined()
    expect(noticeLink('javascript:alert(1)')).toBeUndefined()
  })
})
