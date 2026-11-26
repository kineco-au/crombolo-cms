/**
 * Story 207: the site's own code reads and changes members through
 * `site().members`, acting as the member, as a back-office user, or, in a job, as
 * the API user the config names.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Principal } from '@crombolo/api-management'
import { route } from '@crombolo/common'
import type { Result } from '@crombolo/core'
import { AuditLog, MemberRepository } from '@crombolo/data'
import type { SiteMembers, SiteServices } from '@crombolo/render'
import { createSiteMembers, shapeProblem, withSiteWrites } from '@crombolo/server'
import { bootServer, type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Array<Pick<Harness, 'db'>> = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const CLIENT = { id: 'crombolo-back-office-site-code', secret: 'a-site-code-secret-1' }

const TYPE = `[member-type]
alias = "recorder"
name = "Recorder"

[[property]]
alias = "address"
name = "Address"
type = "textstring"
member-can-view = true
member-can-edit = true

[[property]]
alias = "adult"
name = "Adult"
type = "trueFalse"
member-can-view = true
member-can-edit = true

[[property]]
alias = "number"
name = "Number"
type = "textstring"
member-can-view = true

[[property]]
alias = "note"
name = "Note"
type = "textstring"

[[property]]
alias = "secret"
name = "Secret"
type = "textstring"
sensitive = true
`

const VIEW = `import { site } from '@crombolo/crombolo/server'
export default async function Page({ member }) {
  const tried = await site().members.update(member?.key ?? '', { name: 'From a page' })
  return <p>{member?.properties?.address ?? 'nobody'}|{tried.isOk() ? 'saved' : tried.status}</p>
}
`

const answer = (result: Result<unknown>) =>
  result.isOk()
    ? Response.json({ value: result.value })
    : Response.json({ message: result.message, errors: result.errors }, { status: result.status })

type Answer = {
  status: number
  value?: Record<string, unknown>
  message?: string
  errors?: Array<{ field: string }>
}

/** A site with a member in it, whose code calls `site().members` as a route is told to. */
async function site(members?: Record<string, unknown>) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'site-members-'))
  dirs.push(root)
  for (const dir of ['schema/member-types', 'schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'member-types', 'recorder.toml'), TYPE)
  writeFileSync(
    join(root, 'schema', 'content-types', 'page.toml'),
    '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\ncomponents = ["page"]\ndefault-component = "page"\n',
  )
  writeFileSync(join(root, 'components', 'page.tsx'), VIEW)
  const seen: unknown[] = []
  const work = {
    async run(
      { call, args }: { call: keyof SiteMembers; args: unknown[] },
      { site }: { site: SiteServices },
    ) {
      // biome-ignore lint/suspicious/noExplicitAny: whichever operation the test names
      const result: Result<unknown> = await (site.members as any)[call](...args)
      seen.push(
        result.isOk()
          ? { value: result.value }
          : { status: result.status, message: result.message },
      )
    },
  }
  const routes = [
    route(
      '/call',
      {
        async POST(request, { site }) {
          const { call, args } = (await request.json()) as { call: string; args: unknown[] }
          // biome-ignore lint/suspicious/noExplicitAny: whichever operation the test names
          return answer(await ((site() as SiteServices).members as any)[call](...args))
        },
      },
      { csrf: false },
    ),
    route('/queue', {
      async POST(request, { site }) {
        return Response.json({
          id: await (site() as SiteServices).jobs.enqueue('work.run', await request.json()),
        })
      },
    }),
  ]
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      apiClient: CLIENT,
      routes: routes as never,
      jobs: { work } as never,
      ...(members ? { members } : {}),
    },
  })
  open.push(h)
  h.server.jobs.stop()
  const types = await h.json<{ items: Array<{ id: string; name: string }> }>(
    `${V1}/tree/member-type/root?take=100`,
  )
  const type = types.items.find((t) => t.name === 'Recorder')?.id as string
  const addMember = async (name: string) => {
    const made = await h.post(`${V1}/member`, {
      memberType: { id: type },
      email: `${name}@example.test`,
      username: name,
      password: 'correct-horse-battery',
      isApproved: true,
      groups: [],
      values: [
        { alias: 'address', culture: null, segment: null, value: '1 Oak Lane' },
        { alias: 'number', culture: null, segment: null, value: '77' },
        { alias: 'note', culture: null, segment: null, value: 'Staff only' },
        { alias: 'secret', culture: null, segment: null, value: 'Hidden' },
      ],
      variants: [{ culture: null, segment: null, name }],
    })
    expect(made.status, await made.clone().text()).toBe(201)
    return made.headers.get('umb-generated-resource') as string
  }
  const ada = await addMember('ada')
  const grace = await addMember('grace')
  const signedIn = await h.server.fetch(
    new Request('http://localhost/umbraco/members/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ username: 'ada', password: 'correct-horse-battery' }),
    }),
  )
  const cookie = signedIn.headers.getSetCookie()[0]?.split(';')[0] as string
  const send = async (headers: Record<string, string>, call: string, args: unknown[]) => {
    const response = await h.server.fetch(
      new Request('http://localhost/call', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ call, args }),
      }),
    )
    return { status: response.status, ...((await response.json()) as object) } as Answer
  }
  /** As ada; as nobody; and in a job. */
  const asAda = (call: string, ...args: unknown[]) => send({ cookie }, call, args)
  const asNobody = (call: string, ...args: unknown[]) => send({}, call, args)
  const inJob = async (call: string, ...args: unknown[]) => {
    seen.length = 0
    // Queued by a signed-in member, whose rights the job does not borrow.
    const queued = await h.server.fetch(
      new Request('http://localhost/queue', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost', cookie },
        body: JSON.stringify({ call, args }),
      }),
    )
    expect(queued.status, await queued.clone().text()).toBe(200)
    await h.server.backgroundJobs.runDue()
    return seen[0] as Answer
  }
  const stored = async (key: string) => {
    const found = await h.json<{
      email: string
      values: Array<{ alias: string; value: unknown }>
      variants: Array<{ name: string }>
    }>(`${V1}/member/${key}`)
    return {
      email: found.email,
      name: found.variants[0]?.name,
      ...Object.fromEntries(found.values.map((v) => [v.alias, v.value])),
    } as Record<string, unknown>
  }
  const audited = async (key: string) =>
    (await new AuditLog(h.server.db).query({}, { skip: 0, take: 100 })).items
      .filter((entry) => entry.entityKey === key)
      .map((entry) => `${entry.action} ${entry.userName}: ${entry.detail}`)
  const group = (name: string) => h.post(`${V1}/member-group`, { name })
  return { h, ada, grace, asAda, asNobody, inJob, stored, audited, group, addMember, cookie }
}

test('a value is held to its property’s kind', () => {
  expect(shapeProblem(null, 'Integer')).toBeUndefined()
  expect(shapeProblem(true, 'Integer')).toBeUndefined()
  expect(shapeProblem('3', 'Integer')).toContain('whole number')
  expect(shapeProblem(Number.NaN, 'Decimal')).toContain('number')
  expect(shapeProblem('2026-01-02', 'Date')).toBeUndefined()
  expect(shapeProblem('soon', 'Date')).toContain('date')
  expect(shapeProblem(3, 'Nvarchar')).toContain('text')
})

describe(`as a member (${process.env.CROMBOLO_DB ?? 'sqlite'})`, () => {
  test('their own record is read, as far as their type shows it', async () => {
    const { ada, asAda } = await site()
    const expected = {
      key: ada,
      type: 'recorder',
      email: 'ada@example.test',
      properties: { address: '1 Oak Lane', number: '77' },
    }
    for (const call of [
      ['me'],
      ['get', ada],
      ['byEmail', 'ADA@example.test'],
      ['byUsername', 'ada'],
    ] as const) {
      const found = await asAda(...(call as unknown as [string, ...string[]]))
      expect(found.value).toMatchObject(expected)
      expect(Object.keys(found.value?.properties as object).sort()).toEqual(['address', 'number'])
    }
  })

  test('nobody else’s is, whether they exist or not', async () => {
    const { grace, asAda } = await site()
    const missing = crypto.randomUUID()
    for (const call of [
      ['get', grace],
      ['get', missing],
      ['byEmail', 'grace@example.test'],
      ['byEmail', 'no@example.test'],
      ['byUsername', 'grace'],
      ['update', grace, { name: 'X' }],
      ['addToGroups', grace, []],
      ['list'],
      ['delete', grace],
    ] as const)
      expect([call[0], (await asAda(...(call as unknown as [string]))).status]).toEqual([
        call[0],
        403,
      ])
  })

  test('with nobody signed in everything is forbidden', async () => {
    const { ada, asNobody } = await site()
    for (const call of [
      ['me'],
      ['get', ada],
      ['list'],
      ['update', ada, { name: 'X' }],
      ['removeFromGroups', ada, []],
      ['delete', ada],
    ] as const)
      expect((await asNobody(...(call as unknown as [string]))).status).toBe(403)
  })

  test('changes their name and what their type lets them edit, the rest kept, audited', async () => {
    const { ada, asAda, stored, audited } = await site()
    const saved = await asAda('update', ada, {
      name: 'Ada L',
      properties: { address: '2 Elm Road', adult: true },
    })
    expect(saved.status, JSON.stringify(saved)).toBe(200)
    expect(await stored(ada)).toMatchObject({
      name: 'Ada L',
      address: '2 Elm Road',
      adult: true,
      number: '77',
      note: 'Staff only',
    })
    expect(await audited(ada)).toContain(
      'Save ada: As the member: name, address, adult, through route POST /call',
    )
    expect((await asAda('update', ada, { properties: { address: null } })).status).toBe(200)
    expect((await stored(ada)).address).toBeUndefined()
  })

  test('not their e-mail, what they may only see, nor what they may not', async () => {
    const { ada, asAda, stored } = await site()
    const email = await asAda('update', ada, { email: 'new@example.test' })
    expect([email.status, email.errors?.map((e) => e.field)]).toEqual([422, ['email']])
    for (const alias of ['number', 'note', 'secret'])
      expect((await asAda('update', ada, { properties: { [alias]: 'x' } })).status).toBe(403)
    const wrong = await asAda('update', ada, {
      name: ' ',
      properties: { colour: 'red', adult: 'perhaps' },
    })
    expect([wrong.status, wrong.errors?.map((e) => e.field)]).toEqual([
      422,
      ['name', 'colour', 'adult'],
    ])
    expect(await stored(ada)).toMatchObject({ email: 'ada@example.test', number: '77' })
  })

  test('joins and leaves only self-service groups', async () => {
    const { h, ada, asAda, audited } = await site()
    await h.post(`${V1}/member-group`, { name: 'Staff' })
    expect((await asAda('addToGroups', ada, ['Staff'])).status).toBe(403)
    expect((await new MemberRepository(h.server.db).byKey(ada))?.roles).toEqual([])
    expect((await audited(ada)).some((line) => line.startsWith('JoinGroup'))).toBe(false)
  })

  test('never deletes themselves', async () => {
    const { h, ada, asAda } = await site()
    expect((await asAda('delete', ada)).status).toBe(403)
    expect(await new MemberRepository(h.server.db).byKey(ada)).toBeDefined()
  })

  test('a page shows their properties, is never shared, and changes nothing', async () => {
    const { h, ada, cookie, stored } = await site()
    const types = await h.json<{ items: Array<{ id: string; name: string }> }>(
      `${V1}/tree/document-type/root?take=100`,
    )
    const type = types.items.find((t) => t.name === 'Page')?.id as string
    const detail = await h.json<{ defaultTemplate: { id: string } }>(`${V1}/document-type/${type}`)
    const made = await h.post(`${V1}/document`, {
      documentType: { id: type },
      template: detail.defaultTemplate,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'Home' }],
    })
    const key = made.headers.get('umb-generated-resource')
    await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
    h.server.cache.invalidate()
    const page = (headers: Record<string, string>) =>
      h.server.fetch(new Request('http://localhost/', { headers }))
    const mine = await page({ cookie })
    expect((await mine.text()).replaceAll('<!-- -->', '')).toContain('1 Oak Lane|403')
    expect(mine.headers.get('cache-control')).toContain('private')
    expect((await (await page({})).text()).replaceAll('<!-- -->', '')).toContain('nobody|403')
    expect((await stored(ada)).name).toBe('ada')
  })
})

describe('groups the config lists', () => {
  test('a group that does not exist stops the boot, named', async () => {
    await expect(
      bootServer({ config: { members: { groups: { selfService: ['Nowhere'] } } } }),
    ).rejects.toThrow('"Nowhere", which is no member group')
  })

  test('as does an actAs that is no API user', async () => {
    await expect(bootServer({ config: { members: { actAs: 'nobody' } } })).rejects.toThrow(
      'members.actAs names "nobody"',
    )
  })

  test('self-service for the member, managed for others, the rest for nobody', async () => {
    const { h, ada, group } = await site()
    for (const name of ['Members', 'Moderators', 'Admins']) await group(name)
    const build = createSiteMembers({
      db: h.server.db,
      nodeState: h.server.schema.nodeState,
      groups: { selfService: ['members'], managed: ['Moderators'] },
    })
    const member = build(async () => ({
      kind: 'member',
      key: ada,
      name: 'ada',
      username: 'ada',
      email: 'ada@example.test',
    }))
    const staff = build(async () => ({ kind: 'user', principal: STAFF }))
    const inRoute = <T>(run: () => T) =>
      withSiteWrites({ via: 'route POST /x', source: 'request' }, run)
    const roles = async () => (await new MemberRepository(h.server.db).byKey(ada))?.roles.sort()

    expect((await inRoute(() => member.addToGroups(ada, ['Members']))).isOk()).toBe(true)
    for (const closed of ['Moderators', 'Admins'])
      expect((await inRoute(() => member.addToGroups(ada, ['Members', closed]))).isOk()).toBe(false)
    expect(await roles()).toEqual(['Members'])
    expect((await staff.addToGroups(ada, ['Moderators'])).isOk()).toBe(true)
    expect((await staff.addToGroups(ada, ['Admins'])).isOk()).toBe(false)
    expect(await roles()).toEqual(['Members', 'Moderators'])
    expect((await inRoute(() => member.removeFromGroups(ada, ['Members']))).isOk()).toBe(true)
    expect(await roles()).toEqual(['Moderators'])
  })
})

const STAFF = {
  id: crypto.randomUUID(),
  name: 'Staff',
  allowedSections: ['Umb.Section.Members'],
  groups: [],
} as unknown as Principal

describe('as a back-office user', () => {
  test('any member, without sensitive properties unless they may see them', async () => {
    const { h, ada, stored } = await site()
    const build = createSiteMembers({ db: h.server.db, nodeState: h.server.schema.nodeState })
    const as = (principal: Principal) => build(async () => ({ kind: 'user', principal }))
    const seen = (await as(STAFF).get(ada)).unwrap().properties
    expect(Object.keys(seen).sort()).toEqual(['address', 'note', 'number'])
    const trusted = { ...STAFF, groups: [{ alias: 'sensitiveData' }] } as unknown as Principal
    expect((await as(trusted).get(ada)).unwrap().properties.secret).toBe('Hidden')

    expect((await as(STAFF).update(ada, { properties: { secret: 'x' } })).isOk()).toBe(false)
    const changed = await as(STAFF).update(ada, {
      email: 'ada2@example.test',
      properties: { note: 'New' },
    })
    expect(changed.isOk()).toBe(true)
    expect(await stored(ada)).toMatchObject({ email: 'ada2@example.test', note: 'New' })
    // Kept, though the one who saved was never shown it.
    expect((await as(trusted).get(ada)).unwrap().properties.secret).toBe('Hidden')

    const taken = await as(STAFF).update(ada, { email: 'grace@example.test' })
    expect(taken.isOk() ? 200 : taken.status).toBe(422)
  })

  test('nobody without Members', async () => {
    const { h, ada } = await site()
    const build = createSiteMembers({ db: h.server.db, nodeState: h.server.schema.nodeState })
    const none = { ...STAFF, allowedSections: ['Umb.Section.Content'] } as unknown as Principal
    const asNone = build(async () => ({ kind: 'user', principal: none }))
    for (const result of [await asNone.get(ada), await asNone.list(), await asNone.delete(ada)])
      expect(result.isOk() ? 200 : result.status).toBe(403)
  })
})

describe('in a job', () => {
  test('is the API user the config names, audited as it and naming the job', async () => {
    const { h, ada, grace, inJob, stored, audited } = await site({ actAs: CLIENT.id })
    expect((await inJob('get', grace)).value).toMatchObject({ username: 'grace' })
    expect((await inJob('update', ada, { email: 'moved@example.test' })).value).toEqual({
      key: ada,
    })
    expect((await stored(ada)).email).toBe('moved@example.test')
    expect(await audited(ada)).toContain('Save API client: email, through job work.run')
    expect((await inJob('me')).status).toBe(403)
    expect((await inJob('delete', grace)).value).toEqual({ key: grace })
    expect(await new MemberRepository(h.server.db).byKey(grace)).toBeUndefined()
    expect((await audited(grace)).some((l) => l.startsWith('Delete API client'))).toBe(true)
  })

  test('reaches nobody without one, whoever queued it', async () => {
    const { ada, inJob } = await site()
    const refused = await inJob('get', ada)
    expect(refused.status).toBe(403)
    expect(refused.message).toContain('members.actAs')
  })
})

describe('listing', () => {
  test('pages through every member once, filtered', async () => {
    const { h, ada, addMember, group } = await site()
    await group('Members')
    for (const name of ['alan', 'barbara', 'edsger']) await addMember(name)
    const build = createSiteMembers({
      db: h.server.db,
      nodeState: h.server.schema.nodeState,
      groups: { managed: ['Members'] },
    })
    const staff = build(async () => ({ kind: 'user', principal: STAFF }))
    const names: string[] = []
    let after: string | undefined
    do {
      const page = (await staff.list({ after, take: 2 })).unwrap()
      expect(page.items.length).toBeLessThanOrEqual(2)
      names.push(...page.items.map((m) => m.username))
      after = page.next ?? undefined
    } while (after)
    expect(names).toEqual(['ada', 'grace', 'alan', 'barbara', 'edsger'])

    await staff.addToGroups(ada, ['Members'])
    const only = async (query: Parameters<SiteMembers['list']>[0]) =>
      (await staff.list(query)).unwrap().items.map((m) => m.username)
    expect(await only({ group: 'Members' })).toEqual(['ada'])
    expect(await only({ text: 'BARB' })).toEqual(['barbara'])
    expect(await only({ type: 'nothing' })).toEqual([])
    expect(await only({ approved: false })).toEqual([])
    expect(await only({ since: new Date(Date.now() + 60_000) })).toEqual([])
    expect(await only({ since: new Date(Date.now() - 3_600_000) })).toHaveLength(5)
    const bad = await staff.list({ after: 'nonsense' })
    expect(bad.isOk() ? 200 : bad.status).toBe(400)
  })

  test('is read in the order of the members’ own index, sorting nothing', async () => {
    const { h } = await site()
    const postgres = h.server.db.dialect.name === 'postgres'
    const plan = await h.server.db.transaction(async (tx) => {
      // A sort is chosen only where no index gives the order.
      if (postgres) await tx.exec('SET LOCAL enable_sort = off')
      const query = new MemberRepository(tx).afterQuery({ after: 10, take: 100 })
      return JSON.stringify(await query.explain())
    })
    expect(plan).not.toMatch(/TEMP B-TREE|"Sort|Sort Key/)
    expect(plan).not.toBe('[]')
  })
})
