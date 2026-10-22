/**
 * `excludePeople`: a bundle's members, users and their groups left out of an
 * import, so a file can bring content without bringing anyone who signs in.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MemberRepository, SYSTEM_MEMBER_TYPE, UserRepository } from '@crombolo/data'
import {
  type BundlePeople,
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
import { type Harness, signedInServer, V1 } from './support/harness.ts'

const PASS = 'people left behind'
const CHEAP = { n: 2 ** 10, r: 8, p: 1 }
const NEW_USER = '6f1d3c3e-7a51-4b8e-9a35-2f1f7d9c0a11'

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

async function server(): Promise<Harness> {
  const h = await signedInServer()
  open.push(h)
  return h
}

/** The source's members and one administrator nobody at the destination has, sealed on disk. */
async function bundleWithPeople(source: Harness, content?: 'open'): Promise<string> {
  const created = await source.post(`${V1}/member`, {
    memberType: { id: SYSTEM_MEMBER_TYPE.key },
    email: 'ada@example.test',
    username: 'ada',
    password: 'a password for ada',
    isApproved: true,
    groups: [],
    values: [],
    variants: [{ culture: null, segment: null, name: 'ada' }],
  })
  expect(created.status).toBe(201)
  const exported = await exportPeople(source.server.db, { members: true, users: true })
  const admin = exported.users.find((user) => user.groupAliases.includes('admin'))
  if (!admin) throw new Error('the source has no administrator to export')
  const people: BundlePeople = {
    ...exported,
    users: [{ ...admin, key: NEW_USER, userName: 'mallory', email: 'mallory@example.test' }],
  }
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
  const dir = mkdtempSync(join(process.cwd(), 'output', 'people-exclude-'))
  dirs.push(dir)
  const payload = writeBundle(set, undefined, [], {
    seal: newSeal(PASS, CHEAP),
    people,
    ...(content ? { content } : {}),
  })
  for (const file of writeBundlePackage(payload, {
    name: 'people',
    version: '1.0.0',
    id: 'people',
    label: 'People',
    private: true,
    peerRange: '*',
  })) {
    mkdirSync(join(dir, file.path, '..'), { recursive: true })
    writeFileSync(join(dir, file.path), file.bytes ?? (file.text as string))
  }
  return join(dir, 'content')
}

describe(`importing without people (${dialectUnderTest})`, () => {
  test('a file’s members and users are applied unless excluded', async () => {
    const source = await server()
    const content = await bundleWithPeople(source)
    const destination = await server()
    const result = await importBundle(
      destination.server.db,
      openBundle(loadBundle(content), PASS).set,
      { nodeId: 'test' },
    )
    expect(result.check.outstanding).toEqual([])
    expect(result.people.map((p) => p.kind).sort()).toEqual(['member', 'user'])
    expect(await new UserRepository(destination.server.db).byKey(NEW_USER)).toBeDefined()
    expect(
      await new MemberRepository(destination.server.db).byEmail('ada@example.test'),
    ).toBeDefined()
  })

  test('excluded, neither arrives, and the check says what was left out', async () => {
    const source = await server()
    const content = await bundleWithPeople(source)
    const destination = await server()
    const result = await importBundle(
      destination.server.db,
      openBundle(loadBundle(content), PASS).set,
      { nodeId: 'test', excludePeople: true },
    )
    expect(result.runId).toBeDefined()
    expect(result.check.outstanding).toEqual([])
    expect(result.check.people).toBeUndefined()
    expect(result.check.peopleExcluded).toMatchObject({ members: 1, users: 1 })
    expect(result.people).toEqual([])
    expect(await new UserRepository(destination.server.db).byKey(NEW_USER)).toBeUndefined()
    expect(
      await new MemberRepository(destination.server.db).byEmail('ada@example.test'),
    ).toBeUndefined()
  })

  test('people sealed around open content need no passphrase when left out', async () => {
    const source = await server()
    const loaded = loadBundle(await bundleWithPeople(source, 'open'))
    expect(loaded.set?.sealed).toBe(true)
    const opened = openBundle(loaded, undefined, { withoutPeople: true })
    expect(opened.set.sealed).toBeUndefined()
    expect(opened.set.people).toBeUndefined()
    expect(opened.people).toBeUndefined()
  })
})
