/**
 * Story 444: a site's members held by another site. Two real sites in one process: the
 * one that holds the members, served over HTTP, and the one content is made on, whose
 * Members section, pickers, Public Access and `site().members` work on the other's
 * members through its Management API, naming who acted, and which keeps none itself.
 *
 * The holding site runs on SQLite whatever the suite's dialect: two sites cannot share
 * the suite's one Postgres database, and what the holding site does with members is
 * proven on both elsewhere. The site under test here runs on the dialect under test.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MemberResponse, Principal } from '@crombolo/api-management'
import { ObjectTypes } from '@crombolo/core'
import {
  AuditLog,
  ComponentRepository,
  ContentTypeRepository,
  PublicAccessRepository,
  SYSTEM_MEMBER_TYPE,
} from '@crombolo/data'
import {
  actingForValue,
  createMembersClient,
  createRemoteSiteMembers,
  exportSite,
  loadConfig,
  memberBody,
  membersSourceFor,
  notAnswering,
  readActingFor,
  serviceAccountUses,
  withSiteWrites,
} from '@crombolo/server'
import {
  keptAtLine,
  notAnsweringLine,
  renameWarning,
} from '../packages/backoffice-host/plugin/members-source.js'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const CLIENT = { id: 'crombolo-back-office-content-site', secret: 'a-content-site-secret-1' }
const PLUGIN = `${BACKOFFICE}/crombolo/api`

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

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"
`

const memberBodyFor = (name: string, groups: string[] = []) => ({
  memberType: { id: SYSTEM_MEMBER_TYPE.key },
  email: `${name}@example.test`,
  username: name,
  password: 'correct-horse-battery',
  isApproved: true,
  groups,
  values: [],
  variants: [{ culture: null, segment: null, name }],
})

/** A save of the member as they are, with `change` on top: what an editor's save sends. */
const savedAs = (member: MemberResponse, change: Record<string, unknown> = {}) => ({
  email: member.email,
  username: member.username,
  isApproved: member.isApproved,
  isLockedOut: member.isLockedOut,
  isTwoFactorEnabled: member.isTwoFactorEnabled,
  groups: member.groups,
  values: member.values,
  variants: member.variants,
  ...change,
})

interface Options {
  /** Whether the holding site trusts the content site's account to say who acted. */
  trusted?: boolean
  managedBy?: string[]
}

async function sites(options: Options = {}) {
  const holding = await signedInServer({
    config: {
      dialect: 'sqlite',
      sqliteFile: ':memory:',
      apiClient: CLIENT,
      allowMemberRegistration: true,
      members: {
        ...(options.trusted === false ? {} : { actorsFrom: [CLIENT.id] }),
        ...(options.managedBy ? { managedBy: options.managedBy } : {}),
      },
    },
  })
  open.push(holding)
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: (request) => holding.server.fetch(request),
  })
  served.push(server)
  const source = `http://127.0.0.1:${server.port}`

  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'members-elsewhere-'))
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
      members: { source, client: CLIENT },
    },
  })
  open.push(content)

  const visit = (h: Harness, path: string, init: RequestInit = {}) =>
    h.server.fetch(new Request(`${ORIGIN}${path}`, init))
  const register = (name: string) =>
    visit(holding, '/umbraco/members/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        email: `${name}@example.test`,
        username: name,
        password: 'correct-horse-battery',
      }),
    })
  const made = async (response: Response) => {
    expect(response.status, await response.clone().text()).toBe(201)
    return response.headers.get('umb-generated-resource') as string
  }
  const typeKey = (await new ContentTypeRepository(content.server.db).byAlias('page'))
    ?.key as string
  const componentKey = (await new ComponentRepository(content.server.db).byAlias('page'))
    ?.key as string
  const page = async (name: string) =>
    made(
      await content.post(`${V1}/document`, {
        documentType: { id: typeKey },
        template: { id: componentKey },
        parent: null,
        values: [],
        variants: [{ culture: null, segment: null, name }],
      }),
    )
  const audited = async (key: string) =>
    (await new AuditLog(holding.server.db).query({}, { skip: 0, take: 200 })).items.filter(
      (entry) => entry.entityKey === key,
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
  const groupRows = async () =>
    (
      await content.server.db.q
        .selectFrom('node')
        .select('unique_id')
        .where('node_object_type', '=', ObjectTypes.MemberGroup)
        .execute()
    ).length
  return {
    holding,
    content,
    server,
    source,
    register,
    made,
    page,
    audited,
    memberRows,
    groupRows,
    visit,
  }
}

describe('the setting', () => {
  const env = [
    'CROMBOLO_MEMBERS_SOURCE',
    'CROMBOLO_MEMBERS_CLIENT_ID',
    'CROMBOLO_MEMBERS_CLIENT_SECRET',
    'CROMBOLO_MEMBERS_ACTORS_FROM',
  ] as const
  const withEnv = (values: Partial<Record<(typeof env)[number], string>>, run: () => void) => {
    const before = Object.fromEntries(env.map((name) => [name, process.env[name]]))
    try {
      for (const name of env) delete process.env[name]
      Object.assign(process.env, values)
      run()
    } finally {
      for (const name of env)
        if (before[name] === undefined) delete process.env[name]
        else process.env[name] = before[name]
    }
  }

  test('is read from the environment, and the file wins', () => {
    withEnv(
      {
        CROMBOLO_MEMBERS_SOURCE: 'https://www.example.com/',
        CROMBOLO_MEMBERS_CLIENT_ID: 'crombolo-back-office-a',
        CROMBOLO_MEMBERS_CLIENT_SECRET: 'a-secret',
        CROMBOLO_MEMBERS_ACTORS_FROM: ' one , two ,',
      },
      () => {
        expect(loadConfig({}).members).toMatchObject({
          source: 'https://www.example.com',
          client: { id: 'crombolo-back-office-a', secret: 'a-secret' },
          actorsFrom: ['one', 'two'],
        })
        expect(
          loadConfig({ members: { source: 'http://serving.test:8080', actorsFrom: ['three'] } })
            .members,
        ).toMatchObject({ source: 'http://serving.test:8080', actorsFrom: ['three'] })
      },
    )
  })

  test('without it, members are this site’s own', () => {
    withEnv({}, () => {
      const members = loadConfig({}).members
      expect(members?.source).toBeUndefined()
      expect(members?.client).toBeUndefined()
      expect(membersSourceFor(loadConfig({}))).toBeUndefined()
    })
  })

  test('a missing client, or a malformed source, refuses to boot, saying which', () => {
    withEnv({}, () => {
      expect(() => loadConfig({ members: { source: 'https://www.example.com' } })).toThrow(
        'no service account there is named: set members.client, or CROMBOLO_MEMBERS_CLIENT_ID and CROMBOLO_MEMBERS_CLIENT_SECRET.',
      )
      for (const bad of ['www.example.com', 'ftp://example.com', 'https://example.com/members'])
        expect(() =>
          loadConfig({ members: { source: bad, client: { id: 'a', secret: 'b' } } }),
        ).toThrow(`members.source is "${bad}": it is the address of the site that holds`)
      expect(() => loadConfig({ members: { actorsFrom: [' '] } })).toThrow(
        'members.actorsFrom in crombolo.config.ts is a list of API client ids.',
      )
    })
    withEnv({ CROMBOLO_MEMBERS_SOURCE: 'not an address' }, () => {
      expect(() => loadConfig({})).toThrow('members.source is "not an address"')
    })
  })
})

describe('who acted', () => {
  test('Service accounts says what a trusted account is for', () => {
    expect(serviceAccountUses({ members: { actorsFrom: ['a'] } })('a')).toEqual([
      "Manages this site's members from another site, saying who for",
    ])
    expect(serviceAccountUses({ members: { actorsFrom: ['a'] } })('b')).toEqual([])
  })

  test('the header carries an id and a name, and is read back limited and clean', () => {
    const value = actingForValue({ id: 'b1f0|x', name: 'Ada Lovelace, route POST /x' })
    expect(readActingFor(value)).toEqual({ id: 'b1f0|x', name: 'Ada Lovelace, route POST /x' })
    expect(readActingFor(`id|${encodeURIComponent('A\u0007da')}`)).toEqual({
      id: 'id',
      name: 'Ada',
    })
    expect(readActingFor(`${'a'.repeat(300)}|${'b'.repeat(300)}`)).toEqual({
      id: 'a'.repeat(200),
      name: 'b'.repeat(100),
    })
    for (const bad of [null, '', 'no-bar', '|name', '%E0%A4%A|x'])
      expect(readActingFor(bad)).toBe(undefined)
  })

  test('a save sends what the Management API reads, and no password it was not given', () => {
    const input = {
      key: 'k',
      memberTypeKey: 't',
      email: 'a@example.test',
      username: 'a',
      isApproved: true,
      isLockedOut: false,
      isTwoFactorEnabled: false,
      groupKeys: undefined,
      values: [{ alias: 'x', culture: null, segment: null, value: 1 }],
      variants: [{ culture: null, segment: null, name: 'A' }],
    }
    expect(memberBody({ ...input, password: 'p' }, true)).toMatchObject({
      id: 'k',
      memberType: { id: 't' },
      password: 'p',
    })
    const update = memberBody(input, false)
    expect(update).not.toHaveProperty('groups')
    expect(update).not.toHaveProperty('newPassword')
    expect(update.values).toEqual([{ alias: 'x', culture: null, segment: null, value: 1 }])
  })

  test('the back office says where members are kept, and warns before a rename', () => {
    expect(keptAtLine('https://www.example.com')).toBe(
      'Members are kept at https://www.example.com.',
    )
    expect(notAnsweringLine('https://www.example.com')).toBe(
      notAnswering('https://www.example.com'),
    )
    expect(renameWarning({ pages: 3, from: 'Gold', to: 'Premium', source: 'https://x.test' })).toBe(
      '3 pages here have rules naming "Gold". They are changed to name "Premium", but its members can\'t open those pages at https://x.test until that change arrives there.',
    )
    expect(
      renameWarning({ pages: 1, from: 'Gold', to: 'Premium', source: 'https://x.test' }),
    ).toContain('1 page here has a rule naming "Gold". It is changed')
  })
})

describe(`members held by another site (${dialectUnderTest})`, () => {
  test('the Members section lists that site’s members and groups, one who signed up a moment ago included', async () => {
    const { holding, content, register } = await sites()
    expect((await holding.post(`${V1}/member-group`, { name: 'Gold' })).status).toBe(201)
    expect((await holding.post(`${V1}/member`, memberBodyFor('ada'))).status).toBe(201)
    expect((await register('grace')).status).toBe(200)

    const listed = await content.json<{ items: MemberResponse[]; total: number }>(
      `${V1}/filter/member?skip=0&take=100`,
    )
    expect(listed.items.map((m) => m.username).sort()).toEqual(['ada', 'grace'])
    const groups = await content.json<{ items: Array<{ name: string }> }>(
      `${V1}/tree/member-group/root?skip=0&take=100`,
    )
    expect(groups.items.map((g) => g.name)).toEqual(['Gold'])
    const searched = await content.json<{ items: Array<{ id: string }> }>(
      `${V1}/item/member/search?query=grace&skip=0&take=10`,
    )
    expect(searched.items).toHaveLength(1)
    const status = await content.json<{ source: string; answering: boolean }>(
      `${PLUGIN}/members-source`,
    )
    expect(status.answering).toBe(true)
  }, 30_000)

  test('editing, disabling, adding and deleting a member changes it there at once, the person who did it audited', async () => {
    const { holding, content, made, audited, memberRows } = await sites()
    const key = await made(await content.post(`${V1}/member`, memberBodyFor('ada')))
    const there = await holding.json<MemberResponse>(`${V1}/member/${key}`)
    expect(there.username).toBe('ada')

    const read = await content.json<MemberResponse>(`${V1}/member/${key}`)
    const renamed = await content.put(
      `${V1}/member/${key}`,
      savedAs(read, { variants: [{ culture: null, segment: null, name: 'Ada L' }] }),
    )
    expect(renamed.status, await renamed.clone().text()).toBe(200)
    expect((await holding.json<MemberResponse>(`${V1}/member/${key}`)).variants[0]?.name).toBe(
      'Ada L',
    )
    const disabled = await content.put(
      `${V1}/member/${key}`,
      savedAs(await content.json<MemberResponse>(`${V1}/member/${key}`), { isApproved: false }),
    )
    expect(disabled.status).toBe(200)
    expect((await holding.json<MemberResponse>(`${V1}/member/${key}`)).isApproved).toBe(false)

    const entries = await audited(key)
    expect(entries.length).toBeGreaterThanOrEqual(3)
    for (const entry of entries) {
      expect(entry.actor?.name).toBe('Administrator')
      expect(entry.detail).toMatch(/by Administrator, through /i)
    }

    expect((await content.del(`${V1}/member/${key}`)).status).toBe(200)
    expect((await holding.call(`${V1}/member/${key}`)).status).toBe(404)
    expect((await audited(key)).some((e) => e.action === 'Delete' && e.actor !== null)).toBe(true)
    expect(await memberRows()).toBe(0)
  }, 30_000)

  test('an account the other site does not list is audited as itself, with nobody named', async () => {
    const { content, made, audited } = await sites({ trusted: false })
    const key = await made(await content.post(`${V1}/member`, memberBodyFor('ada')))
    const entries = await audited(key)
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      expect(entry.actor).toBeNull()
      expect(entry.detail ?? '').not.toContain('through')
    }
  }, 30_000)

  test('a header from a caller not listed is ignored, whoever sends it', async () => {
    const { holding, made, audited } = await sites()
    const key = await made(
      await holding.call(`${V1}/member`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Crombolo-Acting-For': actingForValue({ id: 'x', name: 'Mallory' }),
        },
        body: JSON.stringify(memberBodyFor('eve')),
      }),
    )
    for (const entry of await audited(key)) expect(entry.actor).toBeNull()
  }, 30_000)

  test('a refusal there comes back in its words, and nothing is written here', async () => {
    const { content, made, memberRows } = await sites({ managedBy: ['crombolo-back-office-other'] })
    await made(await content.post(`${V1}/member`, memberBodyFor('ada')))
    const taken = await content.post(`${V1}/member`, memberBodyFor('ada'))
    expect(taken.status).toBe(400)
    expect(await taken.text()).toContain('Another member already uses this username.')
    expect(await memberRows()).toBe(0)
  }, 30_000)

  test('a member a directory keeps there is read-only here too', async () => {
    const { content, made } = await sites({ managedBy: [CLIENT.id] })
    const key = await made(await content.post(`${V1}/member`, memberBodyFor('kept')))
    const member = await content.json<MemberResponse>(`${V1}/member/${key}`)
    expect(member.managedBy?.clientId).toBe(CLIENT.id)
    expect(member.flags).toEqual([{ alias: 'Crombolo.Member.Managed' }])
    const manager = await content.json<{ managedBy: { clientId: string } }>(
      `${PLUGIN}/members/${key}/manager`,
    )
    expect(manager.managedBy.clientId).toBe(CLIENT.id)
    expect((await content.del(`${PLUGIN}/members/${key}/manager`)).status).toBe(403)
  }, 30_000)

  test('member groups are added, renamed and removed there; a rename rewrites this site’s rules', async () => {
    const { holding, content, made, page, groupRows } = await sites()
    const home = await page('Home')
    const login = await page('Login')
    const denied = await page('Denied')
    const adaPage = await page('For Ada')
    const gold = await made(await content.post(`${V1}/member-group`, { name: 'Gold' }))
    expect((await holding.json<{ name: string }>(`${V1}/member-group/${gold}`)).name).toBe('Gold')

    const ada = await made(await holding.post(`${V1}/member`, memberBodyFor('ada', [gold])))
    // A page's Public Access picks that site's groups and members.
    expect(
      (
        await content.post(`${V1}/document/${home}/public-access`, {
          memberUserNames: [],
          memberGroupNames: ['Gold'],
          loginDocument: { id: login },
          errorDocument: { id: denied },
        })
      ).status,
    ).toBe(201)
    const entry = await content.json<{ groups: unknown[] }>(`${V1}/document/${home}/public-access`)
    expect(entry.groups).toEqual([{ id: gold, name: 'Gold', flags: [] }])
    expect(
      (
        await content.post(`${V1}/document/${adaPage}/public-access`, {
          memberUserNames: ['ada'],
          memberGroupNames: [],
          loginDocument: { id: login },
          errorDocument: { id: denied },
        })
      ).status,
    ).toBeLessThan(300)
    const named = await content.json<{ members: Array<{ id: string }> }>(
      `${V1}/document/${adaPage}/public-access`,
    )
    expect(named.members.map((m) => m.id)).toEqual([ada])

    const counted = await content.json<{ name: string; pages: number; rewritten: boolean }>(
      `${PLUGIN}/member-groups/${gold}/rules`,
    )
    expect(counted).toEqual({ name: 'Gold', pages: 1, rewritten: true })

    expect((await content.put(`${V1}/member-group/${gold}`, { name: 'Premium' })).status).toBe(200)
    expect((await holding.json<{ name: string }>(`${V1}/member-group/${gold}`)).name).toBe(
      'Premium',
    )
    const rule = await new PublicAccessRepository(content.server.db).byNodeKey(home)
    expect(rule?.memberGroupNames).toEqual(['Premium'])
    expect(
      (await content.json<{ pages: number }>(`${PLUGIN}/member-groups/${gold}/rules`)).pages,
    ).toBe(1)

    const duplicate = await content.post(`${V1}/member-group`, { name: 'Premium' })
    expect(duplicate.status).toBe(400)
    expect((await content.del(`${V1}/member-group/${gold}`)).status).toBe(200)
    expect((await holding.call(`${V1}/member-group/${gold}`)).status).toBe(404)
    expect(await groupRows()).toBe(0)
  }, 30_000)

  test('preview’s groups are that site’s', async () => {
    const { holding, content } = await sites()
    expect((await holding.post(`${V1}/member-group`, { name: 'Gold' })).status).toBe(201)
    const choice = await content.json<{ groups: Array<{ name: string }> }>(
      `${PLUGIN}/preview-member`,
    )
    expect(choice.groups.map((g) => g.name)).toEqual(['Gold'])
  }, 30_000)

  test('site().members reads and writes that site’s members, named in its audit as the code that wrote', async () => {
    const { holding, content, made, audited } = await sites()
    const gold = await made(await holding.post(`${V1}/member-group`, { name: 'Gold' }))
    const ada = await made(await holding.post(`${V1}/member`, memberBodyFor('ada')))
    const source = membersSourceFor(content.server.config)
    if (!source) throw new Error('no members source')
    const build = createRemoteSiteMembers({
      db: content.server.db,
      source,
      groups: { managed: ['Gold'] },
    })
    const staff = build(async () => ({
      kind: 'user',
      principal: {
        id: crypto.randomUUID(),
        name: 'Staff',
        allowedSections: ['Umb.Section.Members'],
        groups: [],
      } as unknown as Principal,
    }))
    const said = (result: { isOk(): boolean; message?: string; status?: number }) =>
      result.isOk() ? 'ok' : `${result.status} ${result.message}`

    const found = await staff.byUsername('ada')
    expect(found.isOk()).toBe(true)
    if (found.isOk()) expect(found.value.key).toBe(ada)
    const listed = await staff.list()
    expect(listed.isOk() && listed.value.items.map((m) => m.username)).toEqual(['ada'])

    const inJob = <T>(run: () => T) =>
      withSiteWrites({ via: 'job members.tidy', source: 'job' }, run)
    expect(said(await inJob(() => staff.update(ada, { name: 'Ada L' })))).toBe('ok')
    expect(said(await inJob(() => staff.addToGroups(ada, ['Gold'])))).toBe('ok')
    const there = await holding.json<MemberResponse>(`${V1}/member/${ada}`)
    expect(there.variants[0]?.name).toBe('Ada L')
    expect(there.groups).toEqual([gold])
    const got = await staff.get(ada)
    expect(got.isOk() && got.value.groups).toEqual(['Gold'])
    for (const entry of (await audited(ada)).filter((e) => e.action === 'Save'))
      expect(entry.actor?.name).toBe('job members.tidy')

    expect(said(await inJob(() => staff.delete(ada)))).toBe('ok')
    expect((await holding.call(`${V1}/member/${ada}`)).status).toBe(404)
    expect(said(await staff.get(ada))).toBe('404 There is no such member.')
  }, 30_000)

  test('this site holds no members: sign-in, registration and reset are off', async () => {
    const { content, visit, memberRows, groupRows, source } = await sites()
    for (const path of ['login', 'register', 'forgot-password'])
      expect(
        (
          await visit(content, `/umbraco/members/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'ada', password: 'x', email: 'ada@example.test' }),
          })
        ).status,
      ).toBe(404)
    expect(
      (
        await visit(content, '/umbraco/delivery/api/v1/security/member/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=client_credentials&client_id=x&client_secret=y',
        })
      ).status,
    ).toBe(404)
    await expect(
      exportSite(content.server.db, content.server.config, {
        out: join(process.cwd(), 'output', 'never.tgz'),
        withMembers: true,
        passphrase: 'a-passphrase-long-enough',
      }),
    ).rejects.toThrow(`This site holds no members: they are kept at ${source}.`)
    expect(await memberRows()).toBe(0)
    expect(await groupRows()).toBe(0)
  }, 30_000)

  test('with the other site unreachable, the Members section says so and writes nothing', async () => {
    const { content, server, source, memberRows } = await sites()
    server.stop(true)
    const listed = await content.call(`${V1}/filter/member?skip=0&take=10`)
    expect(listed.status).toBe(503)
    expect(((await listed.json()) as { title: string }).title).toBe(notAnswering(source))
    const added = await content.post(`${V1}/member`, memberBodyFor('ada'))
    expect(added.status).toBe(503)
    const status = await content.json<{ source: string; answering: boolean; message: string }>(
      `${PLUGIN}/members-source`,
    )
    expect(status).toEqual({ source, answering: false, message: notAnswering(source) })
    expect(await memberRows()).toBe(0)
  }, 30_000)

  test('a refused account is said in words', async () => {
    const { source } = await sites()
    const client = createMembersClient({ source, client: { id: CLIENT.id, secret: 'wrong' } })
    await expect(client.call('GetMemberGroup', { query: { skip: 0, take: 1 } })).rejects.toThrow(
      `${source} refused this site's service account, ${CLIENT.id}: check members.client.`,
    )
  }, 30_000)

  test('a token is kept until it expires', async () => {
    const { source } = await sites()
    let asked = 0
    let now = 0
    const client = createMembersClient({
      source,
      client: CLIENT,
      now: () => now,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/security/back-office/token')) asked += 1
        return fetch(input, init)
      }) as typeof fetch,
    })
    for (let i = 0; i < 3; i++)
      expect((await client.call('GetMemberGroup', { query: { skip: 0, take: 1 } })).ok).toBe(true)
    expect(asked).toBe(1)
    now += 60 * 60 * 1000
    expect((await client.call('GetMemberGroup', { query: { skip: 0, take: 1 } })).ok).toBe(true)
    expect(asked).toBe(2)
  }, 30_000)
})

describe(`without the setting (${dialectUnderTest})`, () => {
  test('members behave as today, and the back office hears there is no other site', async () => {
    const h = await signedInServer()
    open.push(h)
    expect(await h.json<{ source: null }>(`${PLUGIN}/members-source`)).toEqual({ source: null })
    const made = await h.post(`${V1}/member`, memberBodyFor('ada'))
    expect(made.status).toBe(201)
    const listed = await h.json<{ total: number }>(`${V1}/filter/member?skip=0&take=10`)
    expect(listed.total).toBe(1)
  })
})
