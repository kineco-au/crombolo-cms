/**
 * Story 356's core: a user's change merged into the whole user the port saves,
 * groups handed out by their owners, open sign-ins listed and ended, and where
 * a group starts and who owns it, with the file rule for owners (D3).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Principal } from '@crombolo/api-management/domain'
import { AuthStore } from '@crombolo/auth'
import {
  ComponentRepository,
  ContentTypeRepository,
  type Db,
  DbDate,
  SUPER_USER_KEY,
  type UserGroupRecord,
  UserGroupRepository,
  UserRepository,
} from '@crombolo/data'
import type { SchemaUserGroup } from '@crombolo/schema'
import {
  changeUser,
  createNodeLookup,
  createUserPorts,
  endSignIn,
  findUser,
  MediaFileStore,
  mediaStoreFor,
  placeGroup,
  removeUser,
  signIns,
  UserAdminError,
  type UserPorts,
} from '@crombolo/server'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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

const TYPE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
allow-children = ["page"]
components = ["page"]
default-component = "page"
`

type Declared = Parameters<typeof createUserPorts>[1]['declaredGroups']

async function site(declaredGroups?: Declared) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'user-admin-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), TYPE_TOML)
  writeFileSync(join(root, 'components', 'page.tsx'), 'export default () => <main />\n')
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      mediaDir: join(root, 'media'),
    },
  })
  open.push(h)
  const db = h.server.db
  const ports: UserPorts = {
    db,
    ...createUserPorts(db, {
      config: h.server.config,
      mediaFiles: new MediaFileStore(await mediaStoreFor(h.server.config)),
      nodes: createNodeLookup(db),
      endSessions: async () => {},
      ...(declaredGroups ? { declaredGroups } : {}),
    }),
  }
  const groups = new UserGroupRepository(db)
  const key = async (alias: string) => (await groups.byAlias(alias))?.key as string
  const user = async (email: string, aliases: string[]) => {
    const made = await ports.users.create(OPERATOR, {
      kind: 'Default',
      email,
      userName: email,
      name: email.split('@')[0] as string,
      groupKeys: await Promise.all(aliases.map(key)),
    })
    if (made.status !== 'Success') throw new Error(made.status)
    return made.value
  }
  const page = async (name: string) => {
    const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
    const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
    const response = await h.post(`${V1}/document`, {
      documentType: { id: typeKey },
      template: { id: componentKey },
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name }],
    })
    return response.headers.get('umb-generated-resource') as string
  }
  return { h, db, ports, key, user, page }
}

const OPERATOR = {
  id: '00000000-0000-4000-8000-0000000c1c1e',
  name: 'The command line',
  isAdmin: true,
  groupKeys: [],
} as unknown as Principal

const person = (id: string, groupKeys: string[], isAdmin = false) =>
  ({ id, name: 'Someone', isAdmin, groupKeys }) as unknown as Principal

const refusedWith = async (work: Promise<unknown>, kind: UserAdminError['kind'], words: string) => {
  const error = await work.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(UserAdminError)
  expect((error as UserAdminError).kind).toBe(kind)
  expect((error as UserAdminError).message).toContain(words)
}

/** An open sign-in for a user, with a refresh token still to renew; a terminal's when named. */
async function session(db: Db, userKey: string, options: { device?: string; ip?: string } = {}) {
  const user = (await new UserRepository(db).byKey(userKey)) as { id: number }
  const id = crypto.randomUUID()
  const store = new AuthStore(db)
  await store.recordLoginSuccess(user.id, id, options.ip)
  await store.createToken({
    token: crypto.randomUUID(),
    type: 'refresh',
    userId: user.id,
    sessionId: id,
    clientId: 'test',
    scope: '',
    expiresAt: new Date(Date.now() + 3_600_000),
  })
  if (options.device)
    await db.q
      .insertInto('device_authorization')
      .values({
        device_code_hash: crypto.randomUUID(),
        user_code: id.slice(0, 9),
        client_id: 'crombolo-cli',
        client_name: options.device,
        scope: '',
        status: 'issued',
        user_id: user.id,
        session_id: id,
        interval_seconds: 5,
        expires_at: DbDate.toDb(new Date(Date.now() + 600_000)),
        create_date: DbDate.toDb(new Date()),
      })
      .execute()
  return id
}

describe('a user changed', () => {
  test('the change is merged into the whole user, and the username follows the e-mail', async () => {
    const { ports, user } = await site()
    const ada = await user('ada@example.com', ['writer'])
    const done = await changeUser(ports, OPERATOR, ada, {
      name: 'Ada King',
      email: 'ada.king@example.com',
      uiLanguage: 'da-DK',
      addGroups: ['EDITOR'],
    })
    expect(done.changed).toEqual(['name', 'email', 'userName', 'groups', 'uiLanguage'])
    expect(done.user).toMatchObject({
      name: 'Ada King',
      email: 'ada.king@example.com',
      userName: 'ada.king@example.com',
      groups: ['writer', 'editor'],
      uiLanguage: 'da-DK',
    })
    const again = await changeUser(ports, OPERATOR, ada, { name: 'Ada King' })
    expect(again.changed).toEqual([])
    expect((await findUser(ports, OPERATOR, 'ADA.KING@example.com')).key).toBe(ada)
    await refusedWith(
      changeUser(ports, OPERATOR, ada, { addGroups: ['nope'] }),
      'not_found',
      'nope',
    )
    await refusedWith(
      changeUser(ports, OPERATOR, ada, { removeGroups: ['writer', 'editor'] }),
      'usage',
      'at least one group',
    )
  })

  test('an owner adds and removes the groups they own; anyone else is refused, and admins are an admin’s', async () => {
    const { ports, user, key } = await site()
    const ada = await user('ada@example.com', ['writer'])
    await new UserGroupRepository(ports.db).setOwners(await key('translator'), [
      await key('editor'),
    ])
    const owner = person(crypto.randomUUID(), [await key('editor')])
    expect(
      (await changeUser(ports, owner, ada, { addGroups: ['translator'] })).user.groups,
    ).toEqual(['writer', 'translator'])
    expect(
      (await changeUser(ports, owner, ada, { removeGroups: ['translator'] })).user.groups,
    ).toEqual(['writer'])
    const other = person(crypto.randomUUID(), [await key('writer')])
    await refusedWith(
      changeUser(ports, other, ada, { addGroups: ['translator'] }),
      'refused',
      'groups you own',
    )
    await refusedWith(
      changeUser(ports, owner, SUPER_USER_KEY, { name: 'Nope' }),
      'refused',
      "an administrator's account",
    )
  })

  test('removed when never signed in; refused for someone who has, yourself and the built-in administrator', async () => {
    const { ports, user, db } = await site()
    const never = await user('never@example.com', ['writer'])
    expect((await removeUser(ports, OPERATOR, never)).email).toBe('never@example.com')
    const been = await user('been@example.com', ['writer'])
    await session(db, been)
    await refusedWith(removeUser(ports, OPERATOR, been), 'refused', 'has signed in before')
    await refusedWith(
      removeUser(ports, person(been, [], true), been),
      'refused',
      "can't remove yourself",
    )
    await refusedWith(removeUser(ports, OPERATOR, SUPER_USER_KEY), 'refused', 'built-in')
  })
})

describe('sign-ins', () => {
  test('yours listed and ended; someone else’s by an administrator, and refused to anyone else', async () => {
    const { ports, user, db } = await site()
    const ada = await user('ada@example.com', ['writer'])
    const bob = await user('bob@example.com', ['writer'])
    const browser = await session(db, ada, { ip: '10.0.0.7' })
    const terminal = await session(db, ada, { device: "Ada's laptop" })
    const ended = await session(db, ada)
    await new AuthStore(db).endSession(ended)
    const bobs = await session(db, bob)
    const me = person(ada, [])

    const mine = await signIns(db, me, { current: terminal })
    expect(mine.map((s) => s.id).sort()).toEqual([browser, terminal].sort())
    expect(mine.find((s) => s.id === browser)).toMatchObject({
      kind: 'browser',
      device: null,
      address: '10.0.0.7',
      current: false,
      user: { key: ada },
    })
    expect(mine.find((s) => s.id === terminal)).toMatchObject({
      kind: 'terminal',
      device: "Ada's laptop",
      current: true,
    })

    await refusedWith(signIns(db, me, { user: bob }), 'refused', 'someone else’s sign-ins')
    await refusedWith(endSignIn(db, me, bobs.slice(0, 8)), 'refused', 'someone else’s')
    await refusedWith(endSignIn(db, me, 'abc'), 'usage', 'eight characters')
    await refusedWith(endSignIn(db, me, '00000000'), 'not_found', 'no open sign-in')

    expect((await endSignIn(db, me, browser.slice(0, 8))).id).toBe(browser)
    expect((await signIns(db, me)).map((s) => s.id)).toEqual([terminal])
    const admin = person(SUPER_USER_KEY, [], true)
    expect((await signIns(db, admin, { user: bob })).map((s) => s.id)).toEqual([bobs])
    expect((await endSignIn(db, admin, bobs)).user.key).toBe(bob)
    expect(await signIns(db, admin, { user: bob })).toEqual([])
    expect(ports.db).toBe(db)
  })
})

describe('where a group starts, and who owns it', () => {
  test('placed in each tree and owned, by an administrator; a dry run changes nothing', async () => {
    const { ports, page, key } = await site()
    await page('Home')
    const dry = await placeGroup(
      ports,
      OPERATOR,
      'writer',
      { content: '/Home', media: 'none', addOwners: ['editor'] },
      { dryRun: true },
    )
    expect(dry.changed).toEqual(['content', 'media', 'owners'])
    expect(dry.group.content).toMatchObject({ at: 'node', path: '/Home' })
    const before = await new UserGroupRepository(ports.db).byAlias('writer')
    expect(before?.owners).toEqual([])

    const placed = await placeGroup(ports, OPERATOR, 'Writer', {
      content: '/Home',
      media: 'none',
      library: 'root',
      addOwners: ['editor'],
    })
    expect(placed.changed).toEqual(expect.arrayContaining(['content', 'media', 'owners']))
    expect(placed.group).toMatchObject({
      alias: 'writer',
      content: { at: 'node', path: '/Home' },
      media: { at: 'none' },
      library: { at: 'root' },
      owners: ['editor'],
    })
    const after = await new UserGroupRepository(ports.db).byAlias('writer')
    expect(after?.owners).toEqual([await key('editor')])
    expect(after?.startNodes.media).toEqual({ root: false, key: null })

    const same = await placeGroup(ports, OPERATOR, 'writer', { content: '/Home' })
    expect(same.changed).toEqual([])
    const gone = await placeGroup(ports, OPERATOR, 'writer', { removeOwners: ['editor'] })
    expect(gone.group.owners).toEqual([])

    await refusedWith(
      placeGroup(ports, person(crypto.randomUUID(), [await key('editor')]), 'writer', {
        content: 'root',
      }),
      'refused',
      'Only an administrator',
    )
    await refusedWith(
      placeGroup(ports, OPERATOR, 'writer', { content: '/Nowhere' }),
      'not_found',
      'Nowhere',
    )
    await refusedWith(placeGroup(ports, OPERATOR, 'nope', { content: 'root' }), 'not_found', 'nope')
    await refusedWith(
      placeGroup(ports, OPERATOR, 'admin', { addOwners: ['editor'] }),
      'refused',
      "can't have owners",
    )
  })

  test("owners are the file's when it names them: refused where the files are not written (D3)", async () => {
    let file: SchemaUserGroup | undefined
    const { ports, key, page } = await site(() => ({
      groups: new Map(file ? [['editor', file]] : []),
      writable: false,
      write: () => {},
    }))
    const groups = new UserGroupRepository(ports.db)
    await groups.setOwners(await key('editor'), [await key('translator')])
    const editor = (await groups.byAlias('editor')) as UserGroupRecord
    // The file as a sync leaves the database: the same fields, and the owners it names.
    file = {
      alias: editor.alias,
      name: editor.name,
      ...(editor.description ? { description: editor.description } : {}),
      ...(editor.icon ? { icon: editor.icon } : {}),
      sections: editor.sections,
      permissions: editor.permissions,
      languages: editor.hasAccessToAllLanguages ? 'all' : editor.languages,
      owners: ['translator'],
    }
    await refusedWith(
      placeGroup(ports, OPERATOR, 'editor', { addOwners: ['writer'] }),
      'refused',
      "group's file",
    )
    // Where it starts is the database's, file or not.
    await page('Home')
    expect((await placeGroup(ports, OPERATOR, 'editor', { content: '/Home' })).changed).toEqual([
      'content',
    ])
  })
})
