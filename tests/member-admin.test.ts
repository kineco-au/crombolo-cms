/**
 * Story 354's core: members found by e-mail, login or key in any casing, made and
 * changed keeping what is not named, values converted, sensitive values kept from
 * whoever may not change them; member groups joined, left and removed; and who
 * may see a page, set by group or by member, kept, cleared and inherited.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Principal } from '@crombolo/api-management'
import { operatorActor } from '@crombolo/content'
import {
  changeMember,
  clearPageAccess,
  findMember,
  groupsOf,
  listMembers,
  MemberAdminError,
  type MemberPorts,
  newGroup,
  newMember,
  pageAccess,
  removeGroup,
  removeMember,
  setPageAccess,
  showMember,
  siteDocumentOperations,
  siteMemberPorts,
} from '@crombolo/server'
import { createPage, type TreeSite, treeSite, writeTreeSite } from './support/content-tree.ts'

const CUSTOMER = `[member-type]
alias = "customer"
name = "Customer"

[[property]]
alias = "nickname"
name = "Nickname"
type = "textstring"

[[property]]
alias = "newsletter"
name = "Newsletter"
type = "trueFalse"

[[property]]
alias = "creditLimit"
name = "Credit limit"
type = "textstring"
sensitive = true
`

const open: TreeSite[] = []
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close()
})

const as = (groups: string[]) =>
  ({
    id: crypto.randomUUID(),
    name: 'Someone',
    groups: groups.map((alias) => ({ key: alias, alias, defaults: [], granular: new Map() })),
  }) as unknown as Principal

const SENSITIVE = as(['admin', 'sensitiveData'])
const EDITOR = as(['admin'])

async function site(): Promise<{ site: TreeSite; ports: MemberPorts }> {
  const root = writeTreeSite()
  mkdirSync(join(root, 'schema', 'member-types'), { recursive: true })
  writeFileSync(join(root, 'schema', 'member-types', 'customer.toml'), CUSTOMER)
  const made = await treeSite({ root })
  open.push({
    ...made,
    close: async () => {
      await made.h.db.close().catch(() => {})
    },
  })
  return { site: made, ports: await siteMemberPorts(made.h.server.db, made.h.server.config) }
}

const refusal = async (work: Promise<unknown>) => {
  try {
    await work
  } catch (error) {
    expect(error).toBeInstanceOf(MemberAdminError)
    return error as MemberAdminError
  }
  throw new Error('it was not refused')
}

describe('members', () => {
  test('found by e-mail, login and key, in any casing', async () => {
    const { ports } = await site()
    const ana = await newMember(ports, SENSITIVE, {
      email: 'Ana@Example.com',
      login: 'ana.lee',
      name: 'Ana Lee',
      type: 'customer',
    })
    expect(await findMember(ports, 'ana@example.COM')).toBe(ana.key)
    expect(await findMember(ports, 'ANA.LEE')).toBe(ana.key)
    expect(await findMember(ports, ana.key.toUpperCase())).toBe(ana.key)
    expect((await refusal(findMember(ports, 'nobody@example.com'))).kind).toBe('not_found')
    expect(ana).toMatchObject({
      login: 'ana.lee',
      name: 'Ana Lee',
      type: 'customer',
      approved: true,
      locked: false,
      signsIn: 'provider',
    })
  })

  test('new and changed: a field not named is kept, values converted, a duplicate e-mail refused', async () => {
    const { ports } = await site()
    await newGroup(ports, 'Subscribers')
    const made = await newMember(ports, SENSITIVE, {
      email: 'grace@example.com',
      type: 'customer',
      groups: ['subscribers'],
      sets: [
        ['nickname', 'Gracie'],
        ['newsletter', 'true'],
        ['creditLimit', '5000'],
      ],
      password: 'correct-horse-battery',
    })
    expect(made.login).toBe('grace@example.com')
    expect(made.signsIn).toBe('password')
    expect(made.groups).toEqual(['Subscribers'])
    expect(made.values.find((v) => v.property === 'newsletter')?.value).toBe(true)

    const renamed = await changeMember(ports, SENSITIVE, 'grace@example.com', { name: 'Grace H' })
    expect(renamed.changed).toBe(true)
    expect(renamed.member).toMatchObject({ name: 'Grace H', groups: ['Subscribers'] })
    expect(renamed.member.values.map((v) => v.property).sort()).toEqual([
      'creditLimit',
      'newsletter',
      'nickname',
    ])
    expect(renamed.member.signsIn).toBe('password')

    const same = await changeMember(ports, SENSITIVE, 'grace@example.com', { approved: true })
    expect(same.changed).toBe(false)
    const unset = await changeMember(ports, SENSITIVE, 'grace@example.com', {
      unset: ['nickname'],
    })
    expect(unset.member.values.some((v) => v.property === 'nickname')).toBe(false)

    await newMember(ports, SENSITIVE, { email: 'alan@example.com', type: 'customer' })
    const clash = await refusal(
      changeMember(ports, SENSITIVE, 'alan@example.com', { email: 'GRACE@example.com' }),
    )
    expect(clash.kind).toBe('conflict')
    expect(
      (await refusal(newMember(ports, SENSITIVE, { email: 'grace@example.com', type: 'customer' })))
        .kind,
    ).toBe('conflict')
    expect(
      (await refusal(newMember(ports, SENSITIVE, { email: 'x@example.com', type: 'nothing' })))
        .kind,
    ).toBe('not_found')
    expect(
      (
        await refusal(
          newMember(ports, SENSITIVE, {
            email: 'y@example.com',
            type: 'customer',
            sets: [['shoeSize', '9']],
          }),
        )
      ).message,
    ).toContain('no property "shoeSize"')

    const listed = await listMembers(ports, SENSITIVE, { group: 'Subscribers' })
    expect(listed.items.map((m) => m.email)).toEqual(['grace@example.com'])
    expect((await listMembers(ports, SENSITIVE, { type: 'customer' })).total).toBe(2)
    expect((await listMembers(ports, SENSITIVE, { find: 'alan' })).items[0]?.email).toBe(
      'alan@example.com',
    )
  })

  test('a sensitive value is refused outside Sensitive data, and kept by their saves', async () => {
    const { ports } = await site()
    await newMember(ports, SENSITIVE, {
      email: 'grace@example.com',
      type: 'customer',
      sets: [['creditLimit', '5000']],
    })
    const refused = await refusal(
      changeMember(ports, EDITOR, 'grace@example.com', { sets: [['creditLimit', '9000']] }),
    )
    expect(refused.message).toBe('Only the Sensitive data group can change creditLimit.')
    expect((await showMember(ports, EDITOR, 'grace@example.com')).values).toEqual([])

    await changeMember(ports, EDITOR, 'grace@example.com', { sets: [['nickname', 'Gracie']] })
    const all = await showMember(ports, SENSITIVE, 'grace@example.com')
    expect(all.values.find((v) => v.property === 'creditLimit')?.value).toBe('5000')
    expect(all.values.find((v) => v.property === 'nickname')?.value).toBe('Gracie')
  })

  test('approve, lock, unlock, a new password and a second factor removed', async () => {
    const { ports } = await site()
    await newMember(ports, SENSITIVE, { email: 'ext@example.com', type: 'customer' })
    expect(
      (await refusal(changeMember(ports, SENSITIVE, 'ext@example.com', { generatePassword: true })))
        .message,
    ).toContain('only through an identity provider')
    const given = await changeMember(ports, SENSITIVE, 'ext@example.com', {
      password: 'a-password-given-1',
    })
    expect(given).toMatchObject({ changed: true, password: null })
    expect(given.member.signsIn).toBe('password')
    const made = await changeMember(ports, SENSITIVE, 'ext@example.com', {
      generatePassword: true,
    })
    expect(made.password?.length).toBeGreaterThan(10)

    expect(
      (await changeMember(ports, SENSITIVE, 'ext@example.com', { locked: true })).changed,
    ).toBe(true)
    expect((await showMember(ports, SENSITIVE, 'ext@example.com')).locked).toBe(true)
    expect(
      (await changeMember(ports, SENSITIVE, 'ext@example.com', { locked: false })).member.locked,
    ).toBe(false)
    expect(
      (await changeMember(ports, SENSITIVE, 'ext@example.com', { locked: false })).changed,
    ).toBe(false)
    expect(
      (await changeMember(ports, SENSITIVE, 'ext@example.com', { twoFactor: false })).changed,
    ).toBe(false)
  })

  test('groups joined and left; a member in a group removed, and the group still there', async () => {
    const { ports } = await site()
    await newGroup(ports, 'Staff')
    expect((await refusal(newGroup(ports, 'STAFF'))).kind).toBe('conflict')
    await newMember(ports, SENSITIVE, { email: 'ana@example.com', type: 'customer' })
    const joined = await changeMember(ports, SENSITIVE, 'ana@example.com', { addGroups: ['staff'] })
    expect(joined.member.groups).toEqual(['Staff'])
    expect(
      (await changeMember(ports, SENSITIVE, 'ana@example.com', { addGroups: ['Staff'] })).changed,
    ).toBe(false)
    expect((await groupsOf(ports)).find((g) => g.name === 'Staff')?.members).toBe(1)
    const left = await changeMember(ports, SENSITIVE, 'ana@example.com', {
      removeGroups: ['Staff'],
    })
    expect(left.member.groups).toEqual([])
    expect(
      (await refusal(changeMember(ports, SENSITIVE, 'ana@example.com', { addGroups: ['Nope'] })))
        .kind,
    ).toBe('not_found')

    await changeMember(ports, SENSITIVE, 'ana@example.com', { addGroups: ['Staff'] })
    const gone = await removeMember(ports, SENSITIVE, 'ana@example.com')
    expect(gone.groups).toEqual(['Staff'])
    expect((await refusal(findMember(ports, 'ana@example.com'))).kind).toBe('not_found')
    expect((await groupsOf(ports)).find((g) => g.name === 'Staff')?.members).toBe(0)
  })
})

describe("a page's access", () => {
  test('set by group and by member, both refused together, pages kept, cleared, and an ancestor shown', async () => {
    const { site: made, ports } = await site()
    const db = made.h.server.db
    const operations = (await siteDocumentOperations(db, made.h.server.config)).operations
    const actor = operatorActor('the command line')
    const home = await createPage(made, 'Home')
    const members = await createPage(made, 'Members', home)
    const inside = await createPage(made, 'Inside', members)
    const signIn = await createPage(made, 'Sign in', home)
    const noAccess = await createPage(made, 'Subscribe', home)
    await newGroup(ports, 'Subscribers')
    await newMember(ports, SENSITIVE, {
      email: 'ana@example.com',
      login: 'ana',
      type: 'customer',
    })

    expect(await pageAccess(db, members)).toMatchObject({ rule: 'none', groups: [] })
    const needsPages = await refusal(
      setPageAccess(ports, operations, actor, members, { groups: ['Subscribers'] }),
    )
    expect(needsPages.message).toContain('sign-in page')
    const both = await refusal(
      setPageAccess(ports, operations, actor, members, {
        groups: ['Subscribers'],
        members: ['ana'],
        loginPage: signIn,
        noAccessPage: noAccess,
      }),
    )
    expect(both.message).toContain('not both')

    const set = await setPageAccess(ports, operations, actor, members, {
      groups: ['subscribers'],
      loginPage: signIn,
      noAccessPage: noAccess,
    })
    expect(set).toMatchObject({
      page: { path: '/Home/Members' },
      rule: 'own',
      groups: ['Subscribers'],
      loginPage: { path: '/Home/Sign in' },
      noAccessPage: { path: '/Home/Subscribe' },
    })

    const byMember = await setPageAccess(ports, operations, actor, members, {
      members: ['ANA@example.com'],
    })
    expect(byMember).toMatchObject({ groups: [], members: ['ana'], loginPage: { key: signIn } })

    expect(await pageAccess(db, inside)).toMatchObject({
      rule: 'ancestor',
      protectedBy: { path: '/Home/Members' },
      members: ['ana'],
    })

    const cleared = await clearPageAccess(db, operations, actor, members)
    expect(cleared.changed).toBe(true)
    expect(cleared.access.rule).toBe('none')
    expect((await clearPageAccess(db, operations, actor, members)).changed).toBe(false)
  })

  test('a group a page names is removed only when confirmed', async () => {
    const { site: made, ports } = await site()
    const db = made.h.server.db
    const operations = (await siteDocumentOperations(db, made.h.server.config)).operations
    const actor = operatorActor('the command line')
    const page = await createPage(made, 'Members')
    const signIn = await createPage(made, 'Sign in')
    await newGroup(ports, 'Subscribers')
    await setPageAccess(ports, operations, actor, page, {
      groups: ['Subscribers'],
      loginPage: signIn,
      noAccessPage: signIn,
    })
    const refused = await refusal(removeGroup(ports, 'Subscribers', false))
    expect(refused.details).toEqual(['/Members'])
    expect((await removeGroup(ports, 'Subscribers', true)).pages).toEqual([
      { key: page, path: '/Members' },
    ])
    expect(await groupsOf(ports)).toEqual([])
  })
})
