/**
 * Story 304: an identity provider's test reaches only what the site sends to,
 * and says only whether it answered, never its status or what it said.
 */
import { describe, expect, test } from 'bun:test'
import {
  createBundleIdentityProviders,
  type IdentityProviderOverrides,
  loadConfig,
  oidc,
} from '@crombolo/server'

const PUBLIC = async () => ['93.184.216.34']

function providers(issuer: string, answer?: () => Response) {
  const calls: string[] = []
  const host = createBundleIdentityProviders({
    overrides: {
      apply: async (_audience: unknown, code: unknown) => code,
    } as unknown as IdentityProviderOverrides,
    members: [],
    backoffice: [oidc({ id: 'corp', name: 'Corp', issuer, clientId: 'cms' })],
    memberCallbackPath: '/m',
    backofficeCallbackPath: '/b',
    groups: async () => [],
    outbound: {
      lookup: PUBLIC,
      fetch: (async (url: string) => {
        calls.push(String(url))
        return answer ? answer() : new Response('{}')
      }) as unknown as typeof fetch,
    },
  })
  return { test: () => host.test('user', 'corp'), calls }
}

describe("an identity provider's test (story 304)", () => {
  test('an issuer on this machine or its network is not asked', async () => {
    for (const issuer of ['http://127.0.0.1:8080', 'http://10.0.0.1', 'http://169.254.169.254']) {
      const { test: run, calls } = providers(issuer)
      const result = await run()
      expect(calls, issuer).toEqual([])
      expect(result.ok).toBe(false)
      expect(result.message).toContain('which this site does not send to')
    }
  })

  test('a failure says neither the status nor what came back', async () => {
    for (const answer of [
      () => new Response('internal admin page', { status: 500 }),
      () => new Response('<html>internal admin page</html>', { status: 200 }),
      () => Response.json({ users: ['internal admin page'] }),
    ]) {
      const { test: run } = providers('https://login.example.com', answer)
      const result = await run()
      expect(result).toEqual({
        ok: false,
        message:
          'https://login.example.com did not answer with an OpenID Connect discovery document.',
      })
    }
  })

  test('a discovery document is an answer', async () => {
    const { test: run, calls } = providers('https://login.example.com', () =>
      Response.json({ authorization_endpoint: 'https://login.example.com/authorize' }),
    )
    expect(await run()).toEqual({
      ok: true,
      message: 'Corp answered at https://login.example.com.',
    })
    expect(calls).toEqual(['https://93.184.216.34/.well-known/openid-configuration'])
  })
})

describe('CROMBOLO_ALLOW_PRIVATE_ADDRESSES (story 304)', () => {
  test('replaces webhooks.allowPrivateAddresses, and is on in development only', () => {
    expect(() =>
      loadConfig({ webhooks: { allowPrivateAddresses: true } as { headerVariables?: string[] } }),
    ).toThrow('CROMBOLO_ALLOW_PRIVATE_ADDRESSES')
    expect(loadConfig({ development: false }).allowPrivateAddresses).toBe(false)
    expect(loadConfig({ development: true }).allowPrivateAddresses).toBe(true)
    expect(
      loadConfig({ development: false, allowPrivateAddresses: true }).allowPrivateAddresses,
    ).toBe(true)
  })
})
