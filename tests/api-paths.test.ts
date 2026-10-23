/**
 * The Management API and the live-update hubs under the back office's own path,
 * the Delivery API at crombolo's fixed path, and Umbraco's paths still answering.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  contractPathFor,
  MANAGEMENT_API_PREFIX,
  rehomeClientModule,
  SERVER_EVENT_HUB_PATH,
} from '@crombolo/core'
import type { ServerHandle } from '@crombolo/server'
import {
  BACKOFFICE,
  bootServer,
  type Harness,
  LEGACY_V1,
  ORIGIN,
  signedInServer,
  V1,
} from './support/harness.ts'

const open: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.close()
      .catch(() => {})
})

async function signedIn(): Promise<Harness> {
  const h = await signedInServer()
  open.push(h.db)
  return h
}

async function mountedAt(backOfficePath: string): Promise<ServerHandle> {
  const server = await bootServer({ config: { backOfficePath } })
  open.push(server)
  return server
}

const get = (server: ServerHandle, path: string) => server.fetch(new Request(`${ORIGIN}${path}`))

describe('the paths', () => {
  test('the new ones are routed as the contract names them, and nothing else is', () => {
    expect(contractPathFor('/crombolo', '/crombolo/management/api/v1/document/a')).toBe(
      `${MANAGEMENT_API_PREFIX}v1/document/a`,
    )
    expect(contractPathFor('/admin', '/admin/management/api/v1/culture')).toBe(
      `${MANAGEMENT_API_PREFIX}v1/culture`,
    )
    expect(contractPathFor('/admin', '/crombolo/delivery/api/v2/content')).toBe(
      '/umbraco/delivery/api/v2/content',
    )
    expect(contractPathFor('/admin', '/admin/serverEventHub')).toBe(SERVER_EVENT_HUB_PATH)
    expect(contractPathFor('/admin', '/crombolo/management/api/v1/culture')).toBeUndefined()
    expect(contractPathFor('/crombolo', '/crombolo/section/content')).toBeUndefined()
  })

  test("the client's request addresses move with the back office", () => {
    const source = [
      "url: '/umbraco/management/api/v1/culture'",
      '(server)/umbraco/serverEventHub',
      '(server)/umbraco/PreviewHub',
      "'/umbraco/backoffice/assets/logo.svg'",
    ].join('\n')
    expect(rehomeClientModule(source, '/admin')).toBe(
      [
        "url: '/admin/management/api/v1/culture'",
        '(server)/admin/serverEventHub',
        '(server)/admin/PreviewHub',
        "'/umbraco/backoffice/assets/logo.svg'",
      ].join('\n'),
    )
  })
})

describe('the Management API', () => {
  test("answers under the back office and at Umbraco's path alike", async () => {
    const h = await signedIn()
    expect(V1.startsWith(`${BACKOFFICE}/management/api/`)).toBe(true)
    const here = await h.json<{ id: string }>(`${V1}/user/current`)
    const there = await h.json<{ id: string }>(`${LEGACY_V1}/user/current`)
    expect(here.id).toBe(there.id)
  })

  test('a created item is located at the path it was asked on', async () => {
    const h = await signedIn()
    const created = await h.post(`${V1}/dictionary`, {
      name: 'Greeting',
      parent: null,
      translations: [],
    })
    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toContain(`${BACKOFFICE}/management/api/v1/`)
    const legacy = await h.post(`${LEGACY_V1}/dictionary`, {
      name: 'Farewell',
      parent: null,
      translations: [],
    })
    expect(legacy.headers.get('location')).toContain(`${MANAGEMENT_API_PREFIX}v1/`)
  })

  test('its contract is served with the paths this site answers on', async () => {
    const h = await signedIn()
    const contract = (await (await h.call(`${BACKOFFICE}/management/api/openapi.json`)).json()) as {
      paths: Record<string, unknown>
    }
    const paths = Object.keys(contract.paths)
    expect(paths.length).toBeGreaterThan(100)
    expect(paths.every((path) => path.startsWith(`${BACKOFFICE}/management/api/`))).toBe(true)
  })

  test("follows a back office mounted elsewhere, and only there and at Umbraco's path", async () => {
    const server = await mountedAt('/admin')
    expect((await get(server, '/admin/management/api/v1/server/status')).status).toBe(200)
    expect((await get(server, `${MANAGEMENT_API_PREFIX}v1/server/status`)).status).toBe(200)
    expect((await get(server, '/crombolo/management/api/v1/server/status')).status).toBe(404)
  })
})

describe('the vendored client', () => {
  test('is served asking for the API under the back office it is mounted at', async () => {
    const server = await mountedAt('/admin')
    const assets = server.paths.assetsPath
    const sdk = await (await get(server, `${assets}/packages/core/backend-api/sdk.gen.js`)).text()
    expect(sdk).toContain("'/admin/management/api/v1/culture'")
    expect(sdk).not.toContain('/umbraco/management/api')
  })
})
