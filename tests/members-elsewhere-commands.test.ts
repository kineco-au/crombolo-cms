/**
 * Story 448: the command line and the remote protocol on members another site holds (444).
 * The holding site is served over HTTP in this process; the site under test reaches it
 * through `member-admin.ts` on its own database, through the remote protocol, and through
 * `crombolo members …` run in its folder with no server. Its sign-ins panel's route and a
 * reset link are the holding site's, and each write is in that site's audit as the person.
 *
 * The holding site runs on SQLite whatever the dialect, as in members-elsewhere.test.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Principal } from '@crombolo/api-management'
import { operatorActor } from '@crombolo/content'
import {
  AuditLog,
  ComponentRepository,
  ContentTypeRepository,
  ExternalLoginRepository,
  externalLoginProvider,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import {
  changeMember,
  clearPageAccess,
  type EmailMessage,
  type EmailPort,
  findMember,
  groupsOf,
  linkMembersByProperty,
  listMembers,
  type MemberAdminError,
  memberAdminErrorOf,
  membersSourceFor,
  newGroup,
  newMember,
  notAnswering,
  pageAccess,
  REMOTE_API_PATH,
  removeGroup,
  removeMember,
  sendMemberResetLink,
  setPageAccess,
  showMember,
  siteDocumentOperations,
  siteMemberPorts,
} from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'
import { localSite } from './support/local-site.ts'

const CLIENT = { id: 'crombolo-back-office-content-site', secret: 'a-content-site-secret-1' }
const PLUGIN = `${BACKOFFICE}/crombolo/api`
const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const MEMBER = SYSTEM_MEMBER_TYPE.alias
/** The holding site's own address, which its reset links name. */
const HOLDING_URL = 'https://members.example'

const open: Harness[] = []
const served: Array<ReturnType<typeof Bun.serve>> = []
const dirs: string[] = []
afterEach(async () => {
  while (served.length > 0) served.pop()?.stop(true)
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function capturing(): EmailPort & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    description: 'test',
    provider: 'custom',
    async send(message) {
      sent.push(message)
      return { ok: true, id: 'x' }
    },
  }
}

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"
`

/** The site that holds the members, served over HTTP; `email: null` sends nothing. */
const CUSTOMER = `[member-type]
alias = "customer"
name = "Customer"

[[property]]
alias = "oid"
name = "Directory id"
type = "textstring"
`

async function holdingSite(email: EmailPort | null = capturing()) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const schema = mkdtempSync(join(process.cwd(), 'output', 'members-holding-'))
  dirs.push(schema)
  mkdirSync(join(schema, 'member-types'), { recursive: true })
  writeFileSync(join(schema, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(schema, 'member-types', 'customer.toml'), CUSTOMER)
  const holding = await signedInServer({
    config: {
      schemaDir: schema,
      dialect: 'sqlite',
      sqliteFile: ':memory:',
      apiClient: CLIENT,
      applicationUrl: HOLDING_URL,
      email,
      members: { actorsFrom: [CLIENT.id], resetPasswordPage: '/account/reset-password' },
    },
  })
  open.push(holding)
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => holding.server.fetch(request),
  })
  served.push(server)
  const audited = async (key: string) =>
    (await new AuditLog(holding.server.db).query({}, { skip: 0, take: 500 })).items.filter(
      (entry) => entry.entityKey === key,
    )
  return {
    holding,
    server,
    source: `http://127.0.0.1:${server.port}`,
    audited,
    email: email as ReturnType<typeof capturing> | null,
  }
}

async function sites(email?: EmailPort | null) {
  const held = await holdingSite(email)
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'members-elsewhere-commands-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    'export default ({ model }) => <main>{model.name}</main>\n',
  )
  const content = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
      members: { source: held.source, client: CLIENT },
      remote: {
        enabled: true,
        environment: 'production',
        protected: false,
        approvals: false,
        maxUploadBytes: 1024 ** 2,
      },
    },
  })
  open.push(content)
  const typeKey = (await new ContentTypeRepository(content.server.db).byAlias('page'))
    ?.key as string
  const componentKey = (await new ComponentRepository(content.server.db).byAlias('page'))
    ?.key as string
  const page = async (name: string) => {
    const made = await content.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(made.status, await made.clone().text()).toBe(201)
    return made.headers.get('umb-generated-resource') as string
  }
  const remote = (path: string, init: RequestInit = {}) =>
    content.server.fetch(
      new Request(`${ORIGIN}${REMOTE_API_PATH}/environments/production/${path}`, {
        ...init,
        headers: {
          cookie: content.cookie(),
          'content-type': 'application/json',
          ...(init.headers as Record<string, string>),
        },
      }),
    )
  const memberRows = async () =>
    Number(
      (
        await content.server.db.q
          .selectFrom('member')
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirst()
      )?.n ?? 0,
    )
  const ports = () => siteMemberPorts(content.server.db, content.server.config)
  return { ...held, content, page, remote, memberRows, ports }
}

/** The person a test acts as on the site under test: its administrator. */
async function administrator(content: Harness): Promise<Principal> {
  const me = await content.json<{ id: string; name: string }>(`${V1}/user/current`)
  return {
    id: me.id,
    name: me.name,
    isAdmin: true,
    allowedSections: ['members', 'content'],
    groups: [{ key: 'admin', alias: 'admin', defaults: [], granular: new Map() }],
  } as unknown as Principal
}

const refusal = async (work: Promise<unknown>): Promise<MemberAdminError> => {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  const said = memberAdminErrorOf(error)
  if (!said) throw new Error(`expected a refusal, got ${String(error)}`)
  return said
}

describe(`member-admin on members another site holds (${dialectUnderTest})`, () => {
  test('members are made, found, listed, changed and removed there, each write audited as the person', async () => {
    const { holding, content, audited, memberRows, ports } = await sites()
    const me = await administrator(content)
    const p = await ports()
    const gold = await newGroup(p, 'Gold', me)
    expect(
      (await holding.json<{ items: Array<{ name: string }> }>(`${V1}/member-group?take=10`)).items,
    ).toMatchObject([{ name: 'Gold' }])

    const ada = await newMember(p, me, {
      email: 'ada@example.test',
      login: 'ada',
      name: 'Ada Lovelace',
      type: MEMBER,
      groups: ['gold'],
      password: 'correct-horse-battery',
    })
    expect(ada).toMatchObject({ login: 'ada', groups: ['Gold'], signsIn: 'password' })
    expect((await holding.json<{ username: string }>(`${V1}/member/${ada.key}`)).username).toBe(
      'ada',
    )
    await newMember(p, me, { email: 'grace@example.test', type: MEMBER })

    expect(await findMember(p, 'ADA@example.test')).toBe(ada.key)
    expect(await findMember(p, 'Ada')).toBe(ada.key)
    expect(await findMember(p, ada.key.toUpperCase())).toBe(ada.key)
    expect((await refusal(findMember(p, 'nobody@example.test'))).kind).toBe('not_found')

    const listed = await listMembers(p, me, { group: 'Gold' })
    expect(listed.items.map((m) => m.login)).toEqual(['ada'])
    expect((await listMembers(p, me)).total).toBe(2)
    expect(await groupsOf(p)).toMatchObject([{ name: 'Gold', members: 1, pages: [] }])

    const steps = [
      { change: { approved: false }, check: { approved: false } },
      { change: { approved: true }, check: { approved: true } },
      { change: { locked: true }, check: { locked: true } },
      { change: { locked: false }, check: { locked: false } },
      { change: { name: 'Ada L' }, check: { name: 'Ada L' } },
      { change: { removeGroups: ['Gold'] }, check: { groups: [] } },
    ] as const
    for (const step of steps) {
      const done = await changeMember(p, me, 'ada', step.change)
      expect(done.changed).toBe(true)
      expect(done.member).toMatchObject(step.check)
    }
    expect((await changeMember(p, me, 'ada', { locked: false })).changed).toBe(false)
    const reset = await changeMember(p, me, 'ada', { generatePassword: true })
    expect(reset.password?.length).toBeGreaterThan(10)
    expect((await changeMember(p, me, 'ada', { twoFactor: false })).changed).toBe(false)

    const entries = await audited(ada.key)
    expect(entries.length).toBeGreaterThanOrEqual(steps.length)
    for (const entry of entries) {
      expect(entry.actor?.id).toBe(me.id)
      expect(entry.detail).toMatch(/through /)
    }
    const groupEntries = await audited(gold.key)
    expect(groupEntries.some((e) => e.actor?.id === me.id)).toBe(true)

    await removeMember(p, me, 'ada')
    expect((await holding.call(`${V1}/member/${ada.key}`)).status).toBe(404)
    expect(
      (await audited(ada.key)).some((e) => e.action === 'Delete' && e.actor?.id === me.id),
    ).toBe(true)
    await removeGroup(p, 'Gold', false, me)
    expect(
      (await holding.json<{ items: unknown[] }>(`${V1}/member-group?take=10`)).items,
    ).toHaveLength(0)
    expect(await memberRows()).toBe(0)
  }, 60_000)

  test('a refusal there comes back in its words, and nothing is written', async () => {
    const { content, ports, memberRows } = await sites()
    const me = await administrator(content)
    const p = await ports()
    await newMember(p, me, { email: 'ada@example.test', login: 'ada', type: MEMBER })
    const taken = await refusal(
      newMember(p, me, { email: 'other@example.test', login: 'ada', type: MEMBER }),
    )
    expect(taken.message).toContain('Another member already uses this username.')
    expect((await refusal(newGroup(p, 'Gold', me).then(() => newGroup(p, 'gold', me)))).kind).toBe(
      'conflict',
    )
    expect(await memberRows()).toBe(0)
  }, 60_000)

  test('content access names that site’s groups and members, and drops those it no longer has', async () => {
    const { content, page, ports } = await sites()
    const me = await administrator(content)
    const p = await ports()
    const members = await page('Members')
    const signIn = await page('Sign in')
    const noAccess = await page('Subscribe')
    await newGroup(p, 'Subscribers', me)
    await newMember(p, me, { email: 'ana@example.test', login: 'ana', type: MEMBER })
    const { operations } = await siteDocumentOperations(content.server.db, content.server.config)
    const actor = operatorActor('the command line')

    expect(await pageAccess(p, members)).toMatchObject({ rule: 'none' })
    expect(
      await setPageAccess(p, operations, actor, members, {
        groups: ['subscribers'],
        loginPage: signIn,
        noAccessPage: noAccess,
      }),
    ).toMatchObject({ rule: 'own', groups: ['Subscribers'], members: [] })
    expect(
      await setPageAccess(p, operations, actor, members, { members: ['ANA@example.test'] }),
    ).toMatchObject({ groups: [], members: ['ana'] })
    expect(
      (await refusal(setPageAccess(p, operations, actor, members, { groups: ['Nope'] }))).kind,
    ).toBe('not_found')
    await removeMember(p, me, 'ana')
    expect((await pageAccess(p, members)).members).toEqual([])
    expect((await clearPageAccess(p, operations, actor, members)).changed).toBe(true)
  }, 60_000)

  test('show lists the providers they sign in with as that site knows them, and so does the sign-ins panel’s route', async () => {
    const { holding, content, ports } = await sites()
    const me = await administrator(content)
    const p = await ports()
    const ada = await newMember(p, me, { email: 'ada@example.test', login: 'ada', type: MEMBER })
    await new ExternalLoginRepository(holding.server.db).link(
      ada.key,
      externalLoginProvider('member', 'b2c'),
      'ada-oid',
    )
    expect((await showMember(p, me, 'ada')).signsInWith.map((s) => s.provider)).toEqual(['b2c'])
    const panel = await content.json<{ items: Array<{ provider: string; name: string }> }>(
      `${PLUGIN}/members/${ada.key}/sign-ins`,
    )
    expect(panel.items).toMatchObject([{ provider: 'b2c', name: 'b2c', declared: false }])
    // Nothing of them is kept here.
    expect(await new ExternalLoginRepository(content.server.db).forOwner(ada.key)).toEqual([])
  }, 60_000)

  test('reset-password sends the link from that site, audited there as the person', async () => {
    const { content, ports, audited, email } = await sites()
    const me = await administrator(content)
    const p = await ports()
    const ada = await newMember(p, me, {
      email: 'ada@example.test',
      login: 'ada',
      type: MEMBER,
      password: 'correct-horse-battery',
    })
    const { outcome } = await sendMemberResetLink(p, me, 'ada')
    expect(outcome).toEqual({ sent: true })
    expect(email?.sent).toHaveLength(1)
    expect(email?.sent[0]?.to).toEqual([{ name: 'ada', email: 'ada@example.test' }])
    expect(email?.sent[0]?.text).toContain(`${HOLDING_URL}/account/reset-password?token=`)
    const entry = (await audited(ada.key)).find((e) => e.action === 'SendPasswordReset')
    expect(entry?.actor?.id).toBe(me.id)
  }, 60_000)

  test('where that site can’t send, the link is handed back; one who signs in through a provider is refused', async () => {
    const { holding, content, ports } = await sites(null)
    const me = await administrator(content)
    const p = await ports()
    await newMember(p, me, {
      email: 'ada@example.test',
      login: 'ada',
      type: MEMBER,
      password: 'correct-horse-battery',
    })
    const { outcome } = await sendMemberResetLink(p, me, 'ada')
    expect(outcome).toMatchObject({ sent: false })
    expect((outcome as { link: string }).link).toStartWith(
      `${HOLDING_URL}/account/reset-password?token=`,
    )

    const ext = await newMember(p, me, { email: 'ext@example.test', login: 'ext', type: MEMBER })
    await new ExternalLoginRepository(holding.server.db).link(
      ext.key,
      externalLoginProvider('member', 'b2c'),
      'ext-oid',
    )
    expect((await sendMemberResetLink(p, me, 'ext')).outcome).toEqual({ refused: 'provider' })
  }, 60_000)

  test('the holding site’s reset-link route needs Members, and is off where members are kept elsewhere', async () => {
    const { holding, content } = await sites()
    const someone = crypto.randomUUID()
    expect((await holding.post(`${PLUGIN}/members/${someone}/reset-link`, {})).status).toBe(404)
    const kept = await content.post(`${PLUGIN}/members/${someone}/reset-link`, {})
    expect(kept.status).toBe(404)
    expect(((await kept.json()) as { message: string }).message).toContain('Members are kept at')
    const anonymous = await holding.server.fetch(
      new Request(`${ORIGIN}${PLUGIN}/members/${someone}/reset-link`, { method: 'POST' }),
    )
    expect(anonymous.status).toBe(401)
  }, 60_000)

  test('with that site unreachable, each says so and changes nothing', async () => {
    const { content, server, source, ports, memberRows } = await sites()
    const me = await administrator(content)
    const p = await ports()
    server.stop(true)
    const said = notAnswering(source)
    // Each started only when awaited: begun together, the later ones would fail unwatched.
    for (const work of [
      () => listMembers(p, me),
      () => findMember(p, 'ada'),
      () => newMember(p, me, { email: 'ada@example.test', type: MEMBER }),
      () => groupsOf(p),
      () => newGroup(p, 'Gold', me),
      () => sendMemberResetLink(p, me, 'ada'),
    ]) {
      const refused = await refusal(work())
      expect(refused.kind).toBe('unavailable')
      expect(refused.message).toBe(said)
    }
    const panel = await content.call(`${PLUGIN}/members/${crypto.randomUUID()}/sign-ins`)
    expect(panel.status).toBe(503)
    expect(await memberRows()).toBe(0)
  }, 60_000)
})

describe(`members link on members another site holds (${dialectUnderTest})`, () => {
  test('the link runs there: a dry run and a real one report as the command does there, audited as the person', async () => {
    const { holding, content, audited } = await sites()
    const me = await administrator(content)
    const there = await siteMemberPorts(holding.server.db, holding.server.config)
    const admin = await administrator(holding)
    const ada = await newMember(there, admin, {
      email: 'ada@example.test',
      login: 'ada',
      type: 'customer',
      sets: [['oid', 'ada-oid']],
    })
    const bo = await newMember(there, admin, {
      email: 'bo@example.test',
      login: 'bo',
      type: 'customer',
      sets: [['oid', 'ada-oid']],
    })
    await newMember(there, admin, { email: 'cy@example.test', login: 'cy', type: MEMBER })
    const source = membersSourceFor(content.server.config)
    if (!source) throw new Error('no source')
    const forWhom = { id: me.id, name: me.name }
    const options = { provider: 'b2c', property: 'oid' }

    const dry = await source.members.link({ ...options, dryRun: true }, forWhom)
    const local = await linkMembersByProperty(holding.server.db, {
      ...options,
      declared: [],
      source: 'cli',
      dryRun: true,
    })
    expect(dry).toEqual(local)
    expect(dry).toMatchObject({ linked: 2, already: 0, empty: 1, held: [], declared: false })
    expect(await new ExternalLoginRepository(holding.server.db).forOwner(ada.key)).toEqual([])

    const done = await source.members.link(options, forWhom)
    expect(done).toMatchObject({ linked: 1, already: 0, empty: 1 })
    expect(done.held).toHaveLength(1)
    const linkedKey = done.held[0]?.heldBy as string
    expect([ada.key, bo.key]).toContain(linkedKey)
    const entry = (await audited(linkedKey)).find((e) => e.action === 'Link')
    expect(entry?.actor?.id).toBe(me.id)
    expect(entry?.detail).toMatch(/through /)
    const again = await source.members.link(options, forWhom)
    expect(again).toMatchObject({ linked: 0, already: 1 })
  }, 60_000)

  test('the route needs Members, is off where members are kept elsewhere, and says so while that site is down', async () => {
    const { holding, content, server, source } = await sites()
    const body = { provider: 'b2c', property: 'oid' }
    const anonymous = await holding.server.fetch(
      new Request(`${ORIGIN}${PLUGIN}/members/link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    expect(anonymous.status).toBe(401)
    const writer = await signInAsGroup(holding, 'writer')
    expect((await writer.post(`${PLUGIN}/members/link`, body)).status).toBe(403)
    expect((await holding.post(`${PLUGIN}/members/link`, {})).status).toBe(400)
    const kept = await content.post(`${PLUGIN}/members/link`, body)
    expect(kept.status).toBe(404)
    expect(((await kept.json()) as { message: string }).message).toContain('Members are kept at')
    const me = await administrator(content)
    server.stop(true)
    const refused = await refusal(
      (
        membersSourceFor(content.server.config) as NonNullable<ReturnType<typeof membersSourceFor>>
      ).members.link(body, { id: me.id, name: me.name }),
    )
    expect(refused.kind).toBe('unavailable')
    expect(refused.message).toBe(notAnswering(source))
  }, 60_000)
})

describe(`the remote protocol on members another site holds (${dialectUnderTest})`, () => {
  test('its member, group, access and reset routes reach that site, as the person signed in', async () => {
    const { holding, content, remote, page, audited, email } = await sites()
    const me = await content.json<{ id: string }>(`${V1}/user/current`)
    const group = await remote('member-groups', {
      method: 'POST',
      body: JSON.stringify({ name: 'Gold' }),
    })
    expect(group.status, await group.clone().text()).toBe(201)
    const made = await remote('members', {
      method: 'POST',
      body: JSON.stringify({
        email: 'ada@example.test',
        login: 'ada',
        type: MEMBER,
        groups: ['Gold'],
        password: 'correct-horse-battery',
      }),
    })
    expect(made.status, await made.clone().text()).toBe(201)
    const ada = (await made.json()) as { key: string }
    expect((await holding.call(`${V1}/member/${ada.key}`)).status).toBe(200)

    const listed = (await (await remote('members?group=Gold')).json()) as { total: number }
    expect(listed.total).toBe(1)
    expect(((await (await remote('members/ADA')).json()) as { key: string }).key).toBe(ada.key)
    const groups = (await (await remote('member-groups')).json()) as {
      groups: Array<{ name: string; members: number }>
    }
    expect(groups.groups).toMatchObject([{ name: 'Gold', members: 1 }])
    const locked = await remote(`members/${ada.key}`, {
      method: 'PATCH',
      body: JSON.stringify({ locked: true }),
    })
    expect(((await locked.json()) as { changed: boolean }).changed).toBe(true)

    const members = await page('Members')
    const signIn = await page('Sign in')
    const access = await remote(`content/${members}/access`, {
      method: 'PUT',
      body: JSON.stringify({ groups: ['Gold'], loginPage: signIn, noAccessPage: signIn }),
    })
    expect(access.status, await access.clone().text()).toBe(200)
    expect(await access.json()).toMatchObject({ rule: 'own', groups: ['Gold'] })

    const reset = await remote(`members/${ada.key}/reset-link`, { method: 'POST', body: '{}' })
    expect(reset.status, await reset.clone().text()).toBe(200)
    expect(await reset.json()).toEqual({ sent: true })
    expect(email?.sent).toHaveLength(1)

    const removed = await remote(`members/${ada.key}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    for (const entry of await audited(ada.key)) expect(entry.actor?.id).toBe(me.id)
  }, 60_000)

  test('with that site unreachable, a route says so', async () => {
    const { remote, server, source } = await sites()
    server.stop(true)
    const listed = await remote('members')
    expect(listed.status).toBe(503)
    expect(((await listed.json()) as { title: string }).title).toBe(notAnswering(source))
  }, 60_000)
})

type Run = { code: number | null; out: string; err: string }

describe(`crombolo members … in a site folder whose members another site holds (${dialectUnderTest})`, () => {
  test('each command reaches that site with no server running here', async () => {
    const { holding, source, audited, server } = await holdingSite()
    const here = localSite('members-elsewhere-cli')
    dirs.push(here.dir)
    const env = here.env({
      CROMBOLO_MEMBERS_SOURCE: source,
      CROMBOLO_MEMBERS_CLIENT_ID: CLIENT.id,
      CROMBOLO_MEMBERS_CLIENT_SECRET: CLIENT.secret,
    })
    // Asynchronously, so this process keeps serving the holding site while the command runs.
    const run = async (...args: string[]): Promise<Run> => {
      const proc = Bun.spawn(['bun', BIN, ...args], {
        cwd: here.dir,
        env,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      return { code: await proc.exited, out, err }
    }
    const ok = async (...args: string[]) => {
      const done = await run(...args)
      expect(done.code, done.err).toBe(0)
      return done
    }
    const json = async <T>(...args: string[]) =>
      JSON.parse((await ok(...args, '-o', 'json')).out) as T

    await ok('members', 'groups', 'new', 'Gold')
    const made = await json<{ key: string; groups: string[] }>(
      'members',
      'new',
      'ada@example.test',
      '--type',
      MEMBER,
      '--login',
      'ada',
      '--group',
      'Gold',
    )
    expect(made.groups).toEqual(['Gold'])
    expect((await holding.call(`${V1}/member/${made.key}`)).status).toBe(200)
    expect((await json<{ total: number }>('members', 'list')).total).toBe(1)
    await new ExternalLoginRepository(holding.server.db).link(
      made.key,
      externalLoginProvider('member', 'b2c'),
      'ada-oid',
    )
    expect((await ok('members', 'show', 'ADA@example.test')).out).toContain('links      b2c')
    await ok('members', 'update', 'ada', '--name', 'Ada L')
    expect((await ok('members', 'lock', 'ada')).out).toContain('is locked out')
    expect((await ok('members', 'unlock', 'ada')).out).toContain('can sign in again')
    expect((await ok('members', 'approve', 'ada')).out).toContain('no change')
    expect((await ok('members', 'reset-2fa', 'ada')).out).toContain('no change')
    const groups = await json<{ groups: Array<{ name: string; members: number }> }>(
      'members',
      'groups',
      'list',
    )
    expect(groups.groups).toMatchObject([{ name: 'Gold', members: 1 }])
    await ok('members', 'groups', 'leave', 'ada', 'Gold')
    await ok('members', 'groups', 'add', 'ada', 'Gold')
    // A member who signs in through a provider has no password to reset by link.
    const provider = await run('members', 'reset-password', 'ada')
    expect(provider.code).toBe(ERROR_KINDS.refused.exitCode)
    // Story 448: the link runs there, against its members and its providers.
    const there = await siteMemberPorts(holding.server.db, holding.server.config)
    const cy = await newMember(there, await administrator(holding), {
      email: 'cy@example.test',
      login: 'cy',
      type: 'customer',
      sets: [['oid', 'cy-oid']],
    })
    const dry = await ok('members', 'link', '--provider', 'entra', '--property', 'oid', '--dry-run')
    expect(dry.out).toContain(`${source} declares no member provider "entra"`)
    expect(dry.out).toContain('would link 1, 0 linked already, 1 with no oid, 0 refused')
    expect(await new ExternalLoginRepository(holding.server.db).forOwner(cy.key)).toEqual([])
    const linked = await json<{ linked: number }>(
      'members',
      'link',
      '--provider',
      'entra',
      '--property',
      'oid',
    )
    expect(linked.linked).toBe(1)
    expect(
      (await new ExternalLoginRepository(holding.server.db).forOwner(cy.key)).map(
        (l) => l.providerKey,
      ),
    ).toEqual(['cy-oid'])
    expect((await audited(cy.key)).find((e) => e.action === 'Link')?.detail).toMatch(/through /)

    await ok('members', 'remove', 'ada', '--yes')
    expect((await holding.call(`${V1}/member/${made.key}`)).status).toBe(404)
    const entries = await audited(made.key)
    expect(entries.length).toBeGreaterThan(3)
    for (const entry of entries) expect(entry.detail).toMatch(/through /)
    await ok('members', 'groups', 'remove', 'Gold')

    server.stop(true)
    const down = await run('members', 'list')
    expect(down.code).toBe(ERROR_KINDS.unavailable.exitCode)
    expect(down.err).toContain(notAnswering(source))
    const linkDown = await run('members', 'link', '--provider', 'entra', '--property', 'oid')
    expect(linkDown.code).toBe(ERROR_KINDS.unavailable.exitCode)
    expect(linkDown.err).toContain(notAnswering(source))
  }, 180_000)
})

describe(`without members.source (${dialectUnderTest})`, () => {
  test('the sign-ins route and the reset-link route answer from this site', async () => {
    const h = await signedInServer({
      config: { email: capturing(), members: { resetPasswordPage: '/account/reset-password' } },
    })
    open.push(h)
    const p = await siteMemberPorts(h.server.db, h.server.config)
    const me = await administrator(h)
    const ada = await newMember(p, me, {
      email: 'ada@example.test',
      login: 'ada',
      type: MEMBER,
      password: 'correct-horse-battery',
    })
    await new ExternalLoginRepository(h.server.db).link(
      ada.key,
      externalLoginProvider('member', 'b2c'),
      'ada-oid',
    )
    const panel = await h.json<{ items: Array<{ provider: string }> }>(
      `${PLUGIN}/members/${ada.key}/sign-ins`,
    )
    expect(panel.items.map((i) => i.provider)).toEqual(['b2c'])
    expect((await showMember(p, me, 'ada')).signsInWith.map((s) => s.provider)).toEqual(['b2c'])
    const grace = await newMember(p, me, {
      email: 'grace@example.test',
      login: 'grace',
      type: MEMBER,
      password: 'correct-horse-battery',
    })
    const reset = await h.post(`${PLUGIN}/members/${grace.key}/reset-link`, {})
    expect(reset.status, await reset.clone().text()).toBe(200)
    expect(await reset.json()).toEqual({ sent: true })
    expect((await sendMemberResetLink(p, me, 'ada')).outcome).toEqual({ refused: 'provider' })
  }, 60_000)
})
