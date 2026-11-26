/**
 * Story 432: members keep their links to identity providers on the way between sites, in
 * the sealed people section, and members already here are linked from a property they hold.
 * A link another member holds is left out, naming both; one to a provider this site does not
 * declare is kept, and said; a member the file carries ends with the file's links, and a
 * file from before removes none. Each link made is audited.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ExternalLoginRepository, externalLoginProvider, SYSTEM_MEMBER_TYPE } from '@crombolo/data'
import { linkMembersByProperty } from '@crombolo/server'
import {
  type BundlePeople,
  type ContentSet,
  exportBundle,
  exportPeople,
  importBundle,
  loadBundle,
  newSeal,
  openBundle,
  writeBundle,
  writeBundlePackage,
} from '@crombolo/transfer'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

const PASS = 'members on the move'
const CHEAP = { n: 2 ** 10, r: 8, p: 1 }
const B2C = externalLoginProvider('member', 'b2c')
const GOOGLE = externalLoginProvider('member', 'google')

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

const RECORDER = `[member-type]
alias = "recorder"
name = "Recorder"

[[property]]
alias = "aDObjectID"
name = "B2C object id"
type = "textstring"
`

async function server(): Promise<Harness> {
  const root = mkdtempSync(join(process.cwd(), 'output', 'member-links-'))
  dirs.push(root)
  for (const dir of ['schema/member-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'member-types', 'recorder.toml'), RECORDER)
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
    },
  })
  open.push(h)
  return h
}

async function member(h: Harness, name: string, objectId?: string, key?: string) {
  const types = await h.json<{ items: Array<{ id: string; name: string }> }>(
    `${V1}/tree/member-type/root?take=100`,
  )
  const recorder = types.items.find((t) => t.name === 'Recorder')?.id ?? SYSTEM_MEMBER_TYPE.key
  const created = await h.post(`${V1}/member`, {
    ...(key ? { id: key } : {}),
    memberType: { id: recorder },
    email: `${name}@example.test`,
    username: name,
    password: `a password for ${name}`,
    isApproved: true,
    groups: [],
    values: objectId
      ? [{ alias: 'aDObjectID', culture: null, segment: null, value: objectId }]
      : [],
    variants: [{ culture: null, segment: null, name }],
  })
  expect(created.status, await created.clone().text()).toBe(201)
  return created.headers.get('umb-generated-resource') as string
}

/** The source's members as a sealed bundle on disk, opened again as the destination would. */
async function sealed(source: Harness, edit?: (people: BundlePeople) => void): Promise<ContentSet> {
  const people = await exportPeople(source.server.db, { members: true, users: false })
  edit?.(people)
  const { set } = await exportBundle(source.server.db, {
    roots: [],
    asGiven: [],
    descendants: false,
    snapshot: 'published',
    blueprints: false,
    withBlobs: false,
    siteName: 'Source',
    nodeId: 'source',
  })
  const dir = mkdtempSync(join(process.cwd(), 'output', 'member-links-bundle-'))
  dirs.push(dir)
  const payload = writeBundle(set, undefined, [], { seal: newSeal(PASS, CHEAP), people })
  for (const file of writeBundlePackage(payload, {
    name: 'members',
    version: '1.0.0',
    id: 'members',
    label: 'Members',
    private: true,
    peerRange: '*',
    bundleType: 'site',
  })) {
    mkdirSync(join(dir, file.path, '..'), { recursive: true })
    writeFileSync(join(dir, file.path), file.bytes ?? (file.text as string))
  }
  return openBundle(loadBundle(dir), PASS).set
}

const linksOf = async (h: Harness, key: string) =>
  (await new ExternalLoginRepository(h.server.db).forOwner(key))
    .map((login) => [login.loginProvider, login.providerKey])
    .sort()

const linkAudits = async (h: Harness) =>
  (
    await h.server.db.q
      .selectFrom('audit_entry')
      .select(['action', 'entity_key', 'detail'])
      .where('action', 'in', ['Link', 'Unlink'])
      .execute()
  ).map((row) => [row.action, row.detail])

describe(`members' links between sites (${dialectUnderTest})`, () => {
  test('arrive linked, sealed with them, once however often the file is applied', async () => {
    const source = await server()
    const ada = await member(source, 'ada')
    await new ExternalLoginRepository(source.server.db).link(ada, B2C, 'ada-oid')
    const set = await sealed(source)
    expect((set.people as BundlePeople).members[0]?.externalLogins).toEqual([
      { provider: 'b2c', subject: 'ada-oid' },
    ])

    const destination = await server()
    const first = await importBundle(destination.server.db, set, {
      nodeId: 'test',
      memberProviders: ['b2c'],
    })
    expect(first.check.findings.map((f) => f.message)).toContain('1 sign-in link(s) arrive')
    expect(await linksOf(destination, ada)).toEqual([[B2C, 'ada-oid']])
    // Who the provider's id names is a member here, not anyone with the same e-mail.
    expect(
      (await new ExternalLoginRepository(destination.server.db).find(B2C, 'ada-oid'))?.ownerKey,
    ).toBe(ada)
    await importBundle(destination.server.db, set, { nodeId: 'test', memberProviders: ['b2c'] })
    expect(await linksOf(destination, ada)).toEqual([[B2C, 'ada-oid']])
    expect(await linkAudits(destination)).toEqual([['Link', 'Signs in through b2c, by an import']])
  })

  test('one another member holds is left out, naming both; the rest stands', async () => {
    const source = await server()
    const ada = await member(source, 'ada')
    await new ExternalLoginRepository(source.server.db).link(ada, B2C, 'shared-oid')
    const set = await sealed(source)

    const destination = await server()
    const grace = await member(destination, 'grace')
    await new ExternalLoginRepository(destination.server.db).link(grace, B2C, 'shared-oid')
    const result = await importBundle(destination.server.db, set, {
      nodeId: 'test',
      memberProviders: ['b2c'],
    })
    expect(result.people.map((p) => [p.kind, p.action])).toEqual([['member', 'create']])
    expect(result.check.findings.map((f) => f.message)).toContain(
      `the b2c sign-in of member ${ada} is linked to member ${grace} here, so it is left out`,
    )
    expect(await linksOf(destination, ada)).toEqual([])
    expect(await linksOf(destination, grace)).toEqual([[B2C, 'shared-oid']])
  })

  test('one to a provider this site does not declare is kept, and said', async () => {
    const source = await server()
    const ada = await member(source, 'ada')
    await new ExternalLoginRepository(source.server.db).link(ada, B2C, 'ada-oid')
    const set = await sealed(source)
    const destination = await server()
    const result = await importBundle(destination.server.db, set, {
      nodeId: 'test',
      memberProviders: [],
    })
    expect(result.check.findings.map((f) => f.message)).toContain(
      '1 sign-in link(s) to "b2c", which this site does not declare: kept, and used once it does',
    )
    expect(await linksOf(destination, ada)).toEqual([[B2C, 'ada-oid']])
  })

  test('a member the file carries ends with its links; a file from before removes none', async () => {
    const source = await server()
    const ada = await member(source, 'ada')
    await new ExternalLoginRepository(source.server.db).link(ada, B2C, 'ada-oid')
    const set = await sealed(source)
    const before = await sealed(source, (people) => {
      for (const m of people.members) delete m.externalLogins
    })
    const destination = await server()
    await importBundle(destination.server.db, set, { nodeId: 'test' })
    await new ExternalLoginRepository(destination.server.db).link(ada, GOOGLE, 'ada-google')

    // A file from before links carries none: nothing is taken away.
    await importBundle(destination.server.db, before, { nodeId: 'test' })
    expect(await linksOf(destination, ada)).toEqual(
      [
        [B2C, 'ada-oid'],
        [GOOGLE, 'ada-google'],
      ].sort(),
    )

    // One that carries them leaves the member with exactly those.
    await importBundle(destination.server.db, set, { nodeId: 'test' })
    expect(await linksOf(destination, ada)).toEqual([[B2C, 'ada-oid']])
    expect(await linkAudits(destination)).toContainEqual([
      'Unlink',
      'Sign-in through google removed, by an import',
    ])
  })
})

describe(`members linked from a property they hold (${dialectUnderTest})`, () => {
  test('each with an id and no link is linked, once; one another holds is refused, naming both', async () => {
    const h = await server()
    const ada = await member(h, 'ada', 'ada-oid')
    const grace = await member(h, 'grace', 'grace-oid')
    const empty = await member(h, 'nobody')
    const taken = await member(h, 'taken', 'held-oid')
    const holder = await member(h, 'holder')
    await new ExternalLoginRepository(h.server.db).link(holder, B2C, 'held-oid')

    const options = {
      provider: 'b2c',
      property: 'aDObjectID',
      declared: ['b2c'],
      source: 'cli' as const,
    }
    expect(await linkMembersByProperty(h.server.db, { ...options, dryRun: true })).toMatchObject({
      linked: 2,
    })
    expect(await linksOf(h, ada)).toEqual([])

    const outcome = await linkMembersByProperty(h.server.db, options)
    expect(outcome).toEqual({
      linked: 2,
      already: 0,
      // The member holding the id has none in the property, and is empty as the other.
      empty: 2,
      held: [{ member: taken, heldBy: holder }],
      declared: true,
    })
    expect(await linksOf(h, ada)).toEqual([[B2C, 'ada-oid']])
    expect(await linksOf(h, grace)).toEqual([[B2C, 'grace-oid']])
    expect(await linksOf(h, empty)).toEqual([])

    // Again, it links nobody twice.
    expect(await linkMembersByProperty(h.server.db, options)).toMatchObject({
      linked: 0,
      already: 2,
    })
    expect((await linkAudits(h)).filter(([action]) => action === 'Link')).toHaveLength(2)

    // A provider the site does not declare: linked anyway, and said.
    expect(
      (
        await linkMembersByProperty(h.server.db, {
          ...options,
          provider: 'legacy',
          declared: ['b2c'],
        })
      ).declared,
    ).toBe(false)
  })

  test('an administrator sees what a member signs in with; their id there only with Sensitive data', async () => {
    const h = await server()
    const ada = await member(h, 'ada')
    await new ExternalLoginRepository(h.server.db).link(ada, B2C, 'ada-oid')
    const shown = await h.json<{ items: Array<Record<string, unknown>> }>(
      `${BACKOFFICE}/crombolo/api/members/${ada}/sign-ins`,
    )
    expect(shown.items).toEqual([
      { provider: 'b2c', name: 'b2c', declared: false, subject: 'ada-oid' },
    ])
  })
})
