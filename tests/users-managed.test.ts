/**
 * Story 389: a site whose back-office people come from a directory outside it. Only
 * the API clients `users.managedBy` names change a person or whom a group holds;
 * a person's own language, avatar and password stay theirs; API users and groups'
 * permissions stay the administrator's.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { SUPER_USER_KEY, UserGroupRepository, UserRepository } from '@crombolo/data'
import { type CromboloConfig, loadConfig, managedHref, oidc } from '@crombolo/server'
import {
  applyManaged,
  MANAGED_HIDDEN,
  OPEN_IN_DIRECTORY,
} from '../packages/backoffice-host/plugin/users-managed.js'
import { dialectUnderTest } from './support/db.ts'
import { type FakeOidc, startFakeOidc } from './support/fake-oidc.ts'
import { BACKOFFICE, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const DIRECTORY = { id: 'crombolo-back-office-directory', secret: 'a-directory-secret-1' }
const AT = 'https://people.example.test/users/{email}?key={key}'
const PLUGIN = `${BACKOFFICE}/crombolo/api/users-managed`

const open: Harness[] = []
const fakes: FakeOidc[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (fakes.length > 0) fakes.pop()?.stop()
})

async function site(config: Partial<CromboloConfig> = {}) {
  const h = await signedInServer({
    config: {
      apiClient: DIRECTORY,
      users: { managedBy: [DIRECTORY.id], managedAt: AT },
      ...config,
    },
  })
  open.push(h)
  const granted = await h.server.fetch(
    new Request(`${ORIGIN}${V1}/security/back-office/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: DIRECTORY.id,
        client_secret: DIRECTORY.secret,
      }).toString(),
    }),
  )
  const { access_token } = (await granted.json()) as { access_token: string }
  const directory = (method: string, path: string, body?: unknown) =>
    h.server.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${access_token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    )
  const editor = (await new UserGroupRepository(h.server.db).byAlias('editor'))?.key as string
  const writer = (await new UserGroupRepository(h.server.db).byAlias('writer'))?.key as string
  return { h, directory, editor, writer }
}

const person = (email: string, groups: string[]) => ({
  kind: 'Default',
  email,
  userName: email,
  name: email,
  userGroupIds: groups.map((id) => ({ id })),
})

describe('the setting', () => {
  test('is read from the environment, and a bad one in the config file is refused', () => {
    const before = { ...process.env }
    try {
      process.env.CROMBOLO_USERS_MANAGED_BY = ' a-client , b-client ,'
      process.env.CROMBOLO_USERS_MANAGED_AT = 'https://dir.example/{userName}'
      expect(loadConfig({}).users).toEqual({
        managedBy: ['a-client', 'b-client'],
        managedAt: 'https://dir.example/{userName}',
      })
      delete process.env.CROMBOLO_USERS_MANAGED_BY
      delete process.env.CROMBOLO_USERS_MANAGED_AT
      expect(loadConfig({}).users).toEqual({ managedBy: [], managedAt: undefined })
      expect(() => loadConfig({ users: { managedBy: [''] } })).toThrow(/list of API client ids/)
      expect(() => loadConfig({ users: { managedBy: ['a'], managedAt: 'dir/{key}' } })).toThrow(
        /http or https address/,
      )
    } finally {
      process.env = before
    }
  })

  test("fills the directory's address for one person", () => {
    expect(managedHref(AT, { key: 'k1', email: 'a+b@example.test', userName: 'a' })).toBe(
      'https://people.example.test/users/a%2Bb%40example.test?key=k1',
    )
  })
})

describe(`users managed from outside the site (${dialectUnderTest})`, () => {
  test('the named client creates, changes, groups and disables people', async () => {
    const { h, directory, editor, writer } = await site()
    const created = await directory('POST', `${V1}/user`, person('ada@example.test', [editor]))
    expect(created.status).toBe(201)
    const key = created.headers.get('umb-generated-resource') as string
    const changed = await directory('PUT', `${V1}/user/${key}`, {
      email: 'ada@example.test',
      userName: 'ada@example.test',
      name: 'Ada',
      languageIsoCode: 'en-US',
      userGroupIds: [{ id: editor }],
      documentStartNodeIds: [],
      hasDocumentRootAccess: true,
      mediaStartNodeIds: [],
      hasMediaRootAccess: true,
      elementStartNodeIds: [],
      hasElementRootAccess: true,
    })
    expect(changed.status).toBe(200)
    const grouped = await directory('POST', `${V1}/user/set-user-groups`, {
      userIds: [{ id: key }],
      userGroupIds: [{ id: writer }],
    })
    expect(grouped.status).toBe(200)
    expect((await directory('POST', `${V1}/user/disable`, { userIds: [{ id: key }] })).status).toBe(
      200,
    )
    const ada = await new UserRepository(h.server.db).byKey(key)
    expect(ada).toMatchObject({ name: 'Ada', isApproved: false, groupKeys: [writer] })
  })

  test("an administrator's change to a person or whom a group holds is refused, with the reason", async () => {
    const { h, directory, editor, writer } = await site()
    const created = await directory('POST', `${V1}/user`, person('bo@example.test', [editor]))
    const key = created.headers.get('umb-generated-resource') as string

    const refusals = [
      await h.post(`${V1}/user`, person('cy@example.test', [editor])),
      await h.post(`${V1}/user/invite`, person('cy@example.test', [editor])),
      await h.put(`${V1}/user/${key}`, { email: 'bo@example.test', userName: 'bo@example.test' }),
      await h.post(`${V1}/user/disable`, { userIds: [{ id: key }] }),
      await h.post(`${V1}/user/enable`, { userIds: [{ id: key }] }),
      await h.post(`${V1}/user/unlock`, { userIds: [{ id: key }] }),
      await h.post(`${V1}/user/set-user-groups`, {
        userIds: [{ id: key }],
        userGroupIds: [{ id: writer }],
      }),
      await h.post(`${V1}/user/${key}/reset-password`, {}),
      await h.post(`${V1}/user/${key}/change-password`, { newPassword: 'another-long-one' }),
      await h.post(`${V1}/user-group/${writer}/users`, [{ id: key }]),
      await h.del(`${V1}/user/${key}`),
    ]
    for (const refused of refusals) {
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({
        title: 'Managed outside this site',
        operationStatus: 'ManagedOutside',
      })
    }
    const bo = await new UserRepository(h.server.db).byKey(key)
    expect(bo).toMatchObject({ isApproved: true, groupKeys: [editor] })
    expect(await new UserRepository(h.server.db).byEmail('cy@example.test')).toBeUndefined()
  })

  test('a person keeps their own language, avatar and password', async () => {
    const { h } = await site()
    expect((await h.put(`${V1}/user/current/profile`, { languageIsoCode: 'da-DK' })).status).toBe(
      200,
    )
    const password = await h.post(`${V1}/user/current/change-password`, {
      oldPassword: 'test-password',
      newPassword: 'a-new-long-password',
    })
    expect(password.status).toBe(200)
    expect((await h.del(`${V1}/user/current/avatar`)).status).toBe(200)
    expect((await new UserRepository(h.server.db).byKey(SUPER_USER_KEY))?.languageIsoCode).toBe(
      'da-DK',
    )
  })

  test("API users and a group's permissions are the administrator's as before", async () => {
    const { h, writer } = await site()
    const api = await h.post(`${V1}/user`, {
      kind: 'Api',
      email: 'robot@example.test',
      userName: 'robot@example.test',
      name: 'Robot',
      userGroupIds: [{ id: writer }],
    })
    expect(api.status).toBe(201)
    const key = api.headers.get('umb-generated-resource') as string
    expect((await h.post(`${V1}/user/disable`, { userIds: [{ id: key }] })).status).toBe(200)

    const group = await h.json<Record<string, unknown>>(`${V1}/user-group/${writer}`)
    const saved = await h.put(`${V1}/user-group/${writer}`, {
      ...group,
      fallbackPermissions: ['Umb.Document.Read'],
    })
    expect(saved.status).toBe(200)
    expect((await new UserGroupRepository(h.server.db).byKey(writer))?.permissions).toEqual([
      'Umb.Document.Read',
    ])
  })

  test('the back office is told, and links each person to the directory', async () => {
    const { h, directory, editor } = await site()
    expect(await h.json<unknown>(PLUGIN)).toEqual({ managed: true, linked: true })
    const created = await directory('POST', `${V1}/user`, person('di@example.test', [editor]))
    const key = created.headers.get('umb-generated-resource') as string
    expect(await h.json<unknown>(`${PLUGIN}?user=${key}`)).toEqual({
      href: `https://people.example.test/users/di%40example.test?key=${key}`,
    })
  })

  test('with the setting off nothing changes', async () => {
    const { h, editor } = await site({ users: { managedBy: [] } })
    expect(await h.json<unknown>(PLUGIN)).toEqual({ managed: false, linked: false })
    expect((await h.post(`${V1}/user`, person('ed@example.test', [editor]))).status).toBe(201)
  })

  test('a provider signs in only people that exist, and changes no groups', async () => {
    const fake = await startFakeOidc('crombolo-backoffice')
    fakes.push(fake)
    const { h, directory, editor } = await site({
      backofficeIdentityProviders: [
        oidc({
          id: 'fake',
          name: 'Fake',
          issuer: fake.issuer,
          clientId: 'crombolo-backoffice',
          linkByEmail: true,
          emailsVerified: true,
          groups: { map: { 'writers-claim': 'writer' } },
        }),
      ],
    })
    const visit = (path: string, init: RequestInit = {}) =>
      h.server.fetch(new Request(`${ORIGIN}${path}`, { redirect: 'manual', ...init }))
    const signInAs = async (claims: Parameters<FakeOidc['as']>[0]) => {
      fake.as(claims)
      const started = await visit(`${V1}/security/back-office/external/fake?returnUrl=%2F`)
      const flow = started.headers
        .getSetCookie()
        .map((c) => c.split(';')[0] as string)
        .find((c) => c.startsWith('crombolo-external-user=')) as string
      const atProvider = await fetch(started.headers.get('location') as string, {
        redirect: 'manual',
      })
      const callback = new URL(atProvider.headers.get('location') as string)
      return visit(`${callback.pathname}${callback.search}`, { headers: { cookie: flow } })
    }

    const stranger = await signInAs({ sub: 's-1', email: 'new@example.test', groups: [] })
    expect(stranger.headers.get('location')).toContain('No%20account')
    expect(await new UserRepository(h.server.db).byEmail('new@example.test')).toBeUndefined()

    const created = await directory('POST', `${V1}/user`, person('fi@example.test', [editor]))
    const key = created.headers.get('umb-generated-resource') as string
    const known = await signInAs({
      sub: 'f-1',
      email: 'fi@example.test',
      email_verified: true,
      groups: ['writers-claim'],
    })
    expect(known.status).toBe(302)
    expect(known.headers.get('location')).toBe('/')
    expect((await new UserRepository(h.server.db).byKey(key))?.groupKeys).toEqual([editor])
  })
})

describe('the Users section of a managed site', () => {
  const registry = () => {
    const excluded: string[] = []
    const registered: string[] = []
    return {
      excluded,
      registered,
      exclude: (alias: string) => excluded.push(alias),
      register: (manifest: { alias: string }) => registered.push(manifest.alias),
    }
  }

  test('hides what changes a person, keeps Save for API users, and links to the directory', () => {
    const r = registry()
    expect(applyManaged(r, { managed: true, linked: true })).toBe(true)
    expect(r.excluded).toEqual(MANAGED_HIDDEN)
    expect(r.excluded).toContain('Umb.WorkspaceAction.User.Save')
    expect(r.registered).toEqual([
      'Crombolo.Condition.User.IsApiUser',
      'Crombolo.WorkspaceAction.User.Save',
      OPEN_IN_DIRECTORY.alias,
    ])
  })

  test('offers no link where the site names no address, and changes nothing when off', () => {
    const linkless = registry()
    applyManaged(linkless, { managed: true, linked: false })
    expect(linkless.registered).not.toContain(OPEN_IN_DIRECTORY.alias)
    const off = registry()
    expect(applyManaged(off, { managed: false, linked: false })).toBe(false)
    expect(off.excluded).toEqual([])
    expect(off.registered).toEqual([])
  })
})
