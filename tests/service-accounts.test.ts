/**
 * Story 433: service accounts, the API users other systems and the site's own code sign in
 * as, looked after in Settings by administrators alone. Each says what it is used for; a
 * secret is shown once and may overlap the one it replaces; last use moves hourly; taking
 * away what the config names asks first.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { AuditLog, UserGroupRepository, UserRepository } from '@crombolo/data'
import { apiUserPrincipal } from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import {
  BACKOFFICE,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const API = `${BACKOFFICE}/crombolo/api/service-accounts`

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

async function server(config: Record<string, unknown> = {}): Promise<Harness> {
  const h = await signedInServer({ config })
  open.push(h)
  return h
}

type Account = {
  key: string
  name: string
  enabled: boolean
  groups: Array<{ key: string; name: string }>
  clients: Array<{
    clientId: string
    lastUsedAt: string | null
    oldSecretUntil: string | null
    usedFor: string[]
  }>
  lastUsedAt: string | null
  usedFor: string[]
}

async function account(h: Harness, name = 'Importer') {
  const writer = await new UserGroupRepository(h.server.db).byAlias('writer')
  const made = await h.post(API, { name, groupKeys: [writer?.key] })
  expect(made.status, await made.clone().text()).toBe(201)
  const created = (await made.json()) as Account
  const client = (await (await h.post(`${API}/${created.key}/clients`, {})).json()) as {
    clientId: string
    secret: string
  }
  return { ...created, ...client }
}

const token = (h: Harness, clientId: string, secret: string) =>
  h.server.fetch(
    new Request(`${ORIGIN}${V1}/security/back-office/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: secret,
      }).toString(),
    }),
  )

describe(`service accounts (${dialectUnderTest})`, () => {
  test('are made with a client id and a secret shown once, and listed apart from people', async () => {
    const h = await server()
    const made = await account(h)
    expect(made.clientId).toStartWith('crombolo-back-office-importer-')
    expect(made.secret.length).toBeGreaterThan(30)
    expect((await token(h, made.clientId, made.secret)).status).toBe(200)

    const list = await h.json<{ items: Account[]; groups: unknown[] }>(API)
    const listed = list.items.find((a) => a.key === made.key) as Account
    expect(listed.groups.map((g) => g.name)).toEqual(['Writers'])
    expect(listed.clients.map((c) => c.clientId)).toEqual([made.clientId])
    expect(JSON.stringify(list)).not.toContain(made.secret)
    expect(list.groups.length).toBeGreaterThan(0)

    // A person's Users lists people; the account opens from Service accounts.
    const users = await h.json<{ items: Array<{ id: string }> }>(`${V1}/filter/user?take=100`)
    expect(users.items.map((u) => u.id)).not.toContain(made.key)
    const plain = await h.json<{ items: Array<{ id: string }> }>(`${V1}/user?take=100`)
    expect(plain.items.map((u) => u.id)).not.toContain(made.key)
    expect((await h.call(`${V1}/user/${made.key}`)).status).toBe(200)

    const audit = await new AuditLog(h.server.db).query({ entityKey: made.key })
    expect(audit.items.map((e) => e.detail).join('\n')).toContain(
      `Client id ${made.clientId} added`,
    )
    expect(JSON.stringify(audit.items)).not.toContain(made.secret)
  })

  test('are refused to anyone but an administrator, by this API and the Management API', async () => {
    const h = await server()
    const made = await account(h)
    const groups = new UserGroupRepository(h.server.db)
    const writer = await groups.byAlias('writer')
    if (!writer) throw new Error('no writer group')
    await groups.save({
      ...writer,
      sections: [...new Set([...writer.sections, 'Umb.Section.Users'])],
    })
    const someone = await signInAsGroup(h, 'writer')
    expect((await someone.call(API)).status).toBe(403)
    expect((await someone.post(API, { name: 'Mine' })).status).toBe(403)
    expect((await someone.call(`${V1}/user/${made.key}/client-credentials`)).status).toBe(403)
    expect(
      (
        await someone.put(`${V1}/user/${made.key}`, {
          name: 'Taken',
          userName: made.name,
          email: '',
          languageIsoCode: 'en-US',
          userGroupIds: [{ id: writer.key }],
          documentStartNodeIds: [],
          mediaStartNodeIds: [],
          elementStartNodeIds: [],
          hasDocumentRootAccess: false,
          hasMediaRootAccess: false,
          hasElementRootAccess: false,
        })
      ).status,
    ).toBe(403)
    const api = await someone.post(`${V1}/user`, {
      kind: 'Api',
      email: 'robot@example.com',
      userName: 'robot@example.com',
      name: 'Robot',
      userGroupIds: [{ id: writer.key }],
    })
    expect(api.status).toBe(403)
  })

  test('a replaced secret works until the time chosen, and not after', async () => {
    const h = await server()
    const made = await account(h)
    const path = `${API}/${made.key}/clients/${made.clientId}/secret`
    const overlap = (await (await h.post(path, { oldStops: 'day' })).json()) as {
      secret: string
      oldSecretUntil: string
    }
    expect((await token(h, made.clientId, overlap.secret)).status).toBe(200)
    expect((await token(h, made.clientId, made.secret)).status).toBe(200)
    expect(Date.parse(overlap.oldSecretUntil) - Date.now()).toBeGreaterThan(23 * 3600 * 1000)

    // Once its time has passed, it no longer signs in.
    await h.server.db.q
      .updateTable('user_client_credential')
      .set({ old_secret_until: new Date(Date.now() - 1000).toISOString() })
      .where('client_id', '=', made.clientId)
      .execute()
    expect((await token(h, made.clientId, made.secret)).status).toBe(401)

    const atOnce = (await (await h.post(path, { oldStops: 'now' })).json()) as { secret: string }
    expect((await token(h, made.clientId, overlap.secret)).status).toBe(401)
    expect((await token(h, made.clientId, atOnce.secret)).status).toBe(200)
    expect((await h.post(path, { oldStops: 'month' })).status).toBe(400)
  })

  test('last use moves with a token and with the site’s code acting as it, at most hourly', async () => {
    const h = await server()
    const made = await account(h)
    const used = async () =>
      (await h.json<Account>(`${API}/${made.key}`)).clients[0]?.lastUsedAt ?? null
    expect(await used()).toBeNull()
    await token(h, made.clientId, made.secret)
    const first = await used()
    expect(first).not.toBeNull()
    await token(h, made.clientId, made.secret)
    expect(await used()).toBe(first)

    await h.server.db.q
      .updateTable('user_client_credential')
      .set({ last_used_at: null })
      .where('client_id', '=', made.clientId)
      .execute()
    await apiUserPrincipal(h.server.db, made.clientId)
    expect(await used()).toBeNull()
    await apiUserPrincipal(h.server.db, made.clientId, { used: true })
    expect(await used()).not.toBeNull()
  })

  test('removing a client id ends its sessions and leaves the account’s others', async () => {
    const h = await server()
    const made = await account(h)
    const other = (await (await h.post(`${API}/${made.key}/clients`, {})).json()) as {
      clientId: string
      secret: string
    }
    const signedIn = async (id: string, secret: string) =>
      ((await (await token(h, id, secret)).json()) as { access_token: string }).access_token
    const gone = await signedIn(made.clientId, made.secret)
    const kept = await signedIn(other.clientId, other.secret)
    const asIt = (access: string) =>
      h.server.fetch(
        new Request(`${ORIGIN}${V1}/user/current`, {
          headers: { authorization: `Bearer ${access}` },
        }),
      )
    expect((await asIt(gone)).status).toBe(200)
    expect((await h.del(`${API}/${made.key}/clients/${made.clientId}`)).status).toBe(200)
    expect((await asIt(gone)).status).toBe(401)
    expect((await asIt(kept)).status).toBe(200)
  })

  test('taking away what the config names says what stops, and asks; a used one may be deleted', async () => {
    const h = await server()
    const made = await account(h)
    h.server.config.content = { actAs: made.clientId }
    h.server.config.members = { ...h.server.config.members, actAs: made.clientId }

    const shown = await h.json<Account>(`${API}/${made.key}`)
    expect(shown.usedFor).toEqual([
      "Changes pages for the site's own code",
      'Reads and changes members for background jobs',
    ])

    for (const [path, method] of [
      [`${API}/${made.key}/disable`, 'POST'],
      [`${API}/${made.key}`, 'DELETE'],
      [`${API}/${made.key}/clients/${made.clientId}`, 'DELETE'],
    ] as const) {
      const refused = await h.call(path, { method })
      expect(refused.status).toBe(409)
      expect(((await refused.json()) as { uses: string[] }).uses).toContain(
        "Changes pages for the site's own code",
      )
    }
    // The Management API refuses it too, sending whoever asks to Service accounts.
    expect((await h.del(`${V1}/user/${made.key}`)).status).toBe(409)

    // A used account goes, once told; the audit log keeps its name.
    await token(h, made.clientId, made.secret)
    expect((await h.del(`${API}/${made.key}?confirm=true`)).status).toBe(200)
    expect(await new UserRepository(h.server.db).byKey(made.key)).toBeUndefined()
    const entries = await new AuditLog(h.server.db).query({ entityKey: made.key })
    expect(
      entries.items.find((e) => e.action === 'Delete' && e.source === 'request'),
    ).toMatchObject({
      entityName: 'Importer',
      detail: expect.stringContaining(
        "Deleted, though used for: Changes pages for the site's own code",
      ),
    })
  })

  test('one nothing names, used or not, is disabled, enabled and deleted', async () => {
    const h = await server()
    const made = await account(h)
    await token(h, made.clientId, made.secret)
    expect(
      ((await (await h.post(`${API}/${made.key}/disable`, {})).json()) as Account).enabled,
    ).toBe(false)
    expect((await token(h, made.clientId, made.secret)).status).toBe(401)
    expect(
      ((await (await h.post(`${API}/${made.key}/enable`, {})).json()) as Account).enabled,
    ).toBe(true)
    expect((await h.put(`${API}/${made.key}`, { name: 'Renamed' })).status).toBe(200)
    expect((await h.json<Account>(`${API}/${made.key}`)).name).toBe('Renamed')
    // Through the Management API too, as nothing depends on it.
    expect((await h.del(`${V1}/user/${made.key}`)).status).toBe(200)
  })
})
