/**
 * Story 178: the back office vouches for its user to the host's own service —
 * a short-lived token, signed with the host's key, that the host checks with
 * nothing but that key.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { AuditLog } from '@crombolo/data'
import { checkHost, type HostConfig, loadConfig } from '@crombolo/server'
import { decodeProtectedHeader, jwtVerify } from 'jose'
import {
  BACKOFFICE,
  bootServer,
  type Harness,
  ORIGIN,
  signedInServer,
  signInAsGroup,
  V1,
} from './support/harness.ts'

const HOST: HostConfig = {
  origin: 'https://tools.example.com',
  signingKey: 'a key of at least thirty-two bytes, kept by the host',
  keyId: 'installation-7',
}
const key = new TextEncoder().encode(HOST.signingKey)
const PATH = `${BACKOFFICE}/crombolo/api/host-token`

const open: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.close()
      .catch(() => {})
})

async function hosted(host: HostConfig | null = HOST): Promise<Harness> {
  const h = await signedInServer({ config: { host: host ?? undefined } })
  open.push(h.db)
  return h
}

const ask = (h: Harness, headers: Record<string, string> = {}) =>
  h.call(PATH, { method: 'POST', headers })

async function token(h: Harness): Promise<string> {
  const response = await ask(h)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = (await response.json()) as { token: string; expiresIn: number }
  expect(body.expiresIn).toBe(300)
  return body.token
}

describe('the configuration', () => {
  test('without a host there is no route', async () => {
    const h = await hosted(null)
    expect((await ask(h)).status).toBe(404)
  })

  test('a host that could not be used refuses to start, naming the field', () => {
    expect(() => checkHost({ ...HOST, origin: 'http://tools.example.com' })).toThrow('host.origin')
    expect(() => checkHost({ ...HOST, origin: 'https://tools.example.com/path' })).toThrow(
      'host.origin',
    )
    expect(() => checkHost({ ...HOST, signingKey: 'too short' })).toThrow('host.signingKey')
    expect(() => checkHost({ ...HOST, keyId: ' ' })).toThrow('host.keyId')
    expect(() => loadConfig({ host: { ...HOST, signingKey: 'short' } })).toThrow('host.signingKey')
    expect(() => checkHost({ ...HOST, origin: 'http://localhost:4000' })).not.toThrow()
  })
})

describe('the token', () => {
  test('a host checks it with the key alone, for its own origin', async () => {
    const h = await hosted()
    const issued = await token(h)
    const { payload, protectedHeader } = await jwtVerify(issued, key, {
      audience: HOST.origin,
      algorithms: ['HS256'],
    })
    expect(protectedHeader.kid).toBe(HOST.keyId)
    expect((payload.exp as number) - (payload.iat as number)).toBeLessThanOrEqual(300)
    const me = await h.json<{ id: string; name: string }>(`${V1}/user/current`)
    expect(payload).toMatchObject({
      sub: me.id,
      name: me.name,
      site: { nodeId: h.server.config.nodeId },
    })
    expect(payload.groups).toContain('admin')
    expect(payload.sections).toContain('Umb.Section.Settings')

    await expect(
      jwtVerify(issued, key, { audience: 'https://elsewhere.example' }),
    ).rejects.toThrow()
    await expect(
      jwtVerify(issued, new TextEncoder().encode('another key that is also long enough!!')),
    ).rejects.toThrow()
    expect(decodeProtectedHeader(issued).alg).toBe('HS256')
  })

  test('says what the person holds now', async () => {
    const h = await hosted()
    const writer = await signInAsGroup(h, 'writer')
    const before = (await jwtVerify(await token(writer), key, { audience: HOST.origin })).payload
    expect(before.groups).toEqual(['writer'])
    const me = await writer.json<{ id: string }>(`${V1}/user/current`)
    const groups = await h.json<{ items: Array<{ id: string; alias: string }> }>(
      `${V1}/user-group?take=100`,
    )
    const editor = groups.items.find((group) => group.alias === 'editor')?.id as string
    expect((await h.post(`${V1}/user-group/${editor}/users`, [{ id: me.id }])).status).toBe(200)
    const after = (await jwtVerify(await token(writer), key, { audience: HOST.origin })).payload
    expect([...(after.groups as string[])].sort()).toEqual(['editor', 'writer'])
  })
})

describe('who gets one', () => {
  test('nobody signed in, signed out, or disabled', async () => {
    const h = await hosted()
    const server = await bootServer({ config: { host: HOST }, keepDatabase: true })
    open.push(server)
    expect((await server.fetch(new Request(`${ORIGIN}${PATH}`, { method: 'POST' }))).status).toBe(
      401,
    )

    const writer = await signInAsGroup(h, 'writer')
    await token(writer)
    const me = await writer.json<{ id: string }>(`${V1}/user/current`)
    expect((await h.post(`${V1}/user/disable`, { userIds: [{ id: me.id }] })).status).toBe(200)
    expect((await ask(writer)).status).toBe(401)

    const out = await h.call(
      `${V1}/security/back-office/signout?post_logout_redirect_uri=${encodeURIComponent(`${ORIGIN}${BACKOFFICE}/logout`)}`,
    )
    expect(out.status).toBe(302)
    expect((await ask(h)).status).toBe(401)
  })

  test('not a request from another site', async () => {
    const h = await hosted()
    expect((await ask(h, { origin: 'https://evil.example' })).status).toBe(403)
  })

  test('no more than ten a minute each', async () => {
    const h = await hosted()
    for (let i = 0; i < 10; i++) expect((await ask(h)).status).toBe(200)
    const limited = await ask(h)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
  })

  test('an issue is not an audit entry', async () => {
    const h = await hosted()
    const before = (await new AuditLog(h.server.db).query({}, { skip: 0, take: 500 })).total
    await token(h)
    const after = (await new AuditLog(h.server.db).query({}, { skip: 0, take: 500 })).total
    expect(after).toBe(before)
  })
})
