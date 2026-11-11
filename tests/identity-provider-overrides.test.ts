/**
 * Story 305: a provider the config or the server locks takes no change from
 * the back office, and a kept secret goes only to the issuer and client id it
 * was set for, the config's only to the config's own.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  createBundleIdentityProviders,
  effectiveProvider,
  entra,
  IdentityProviderOverrides,
  lockOf,
  oidc,
} from '@crombolo/server'
import { type Harness, signedInServer } from './support/harness.ts'

const KEY = 'a-secret-key-for-sealing-client-secrets-305'
const code = oidc({
  id: 'corp',
  name: 'Corp',
  issuer: 'https://login.corp.example',
  clientId: 'cms',
  clientSecret: 'from-config',
})

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

describe('lockOf', () => {
  test('the config, the environment, or neither', () => {
    expect(lockOf({ ...code, locked: true })).toBe('config')
    expect(lockOf({ ...code, locked: true }, 'all')).toBe('config')
    expect(lockOf(code, ['other', 'corp'])).toBe('environment')
    expect(lockOf(code, 'all')).toBe('environment')
    expect(lockOf(code, ['other'])).toBeUndefined()
    expect(lockOf(code)).toBeUndefined()
  })
})

describe('where a secret goes', () => {
  test("the config's goes only to the config's issuer and client id", () => {
    expect(effectiveProvider(code, { name: 'Ours' }).oidc.clientSecret).toBe('from-config')
    for (const change of [{ issuer: 'https://evil.example' }, { clientId: 'other' }]) {
      const moved = effectiveProvider(code, change)
      expect(moved.oidc.clientSecret, JSON.stringify(change)).toBeUndefined()
      expect(moved.unavailable).toContain('has no client secret of its own')
    }
    const tenant = entra({ tenantId: 't1', clientId: 'cms', clientSecret: 'from-config' })
    expect(effectiveProvider(tenant, { tenantId: 't2' }).unavailable).toBeDefined()
  })

  test('a kept secret goes only where it was set for', () => {
    const at = { issuer: 'https://new.example', clientId: 'cms' }
    expect(
      effectiveProvider(code, { issuer: at.issuer, clientSecret: 'kept', secretFor: at }).oidc
        .clientSecret,
    ).toBe('kept')
    const elsewhere = effectiveProvider(code, {
      issuer: 'https://third.example',
      clientSecret: 'kept',
      secretFor: at,
    })
    expect(elsewhere.oidc.clientSecret).toBeUndefined()
    expect(elsewhere.unavailable).toBeDefined()
    // From before 305: nothing says where it was set for, so where it sends now.
    expect(
      effectiveProvider(code, { issuer: 'https://new.example', clientSecret: 'kept' }).oidc
        .clientSecret,
    ).toBe('kept')
  })

  test('a provider the config gave no secret is never unavailable for want of one', () => {
    const open = oidc({ id: 'pub', name: 'Pub', issuer: 'https://a.example', clientId: 'c' })
    expect(effectiveProvider(open, { issuer: 'https://b.example' }).unavailable).toBeUndefined()
  })
})

describe(`changing a provider (${process.env.CROMBOLO_DB ?? 'sqlite'})`, () => {
  async function host(locked: readonly string[] | 'all' = []) {
    const h = await signedInServer()
    open.push(h)
    const audit: { action: string; name: string; detail: string | null }[] = []
    const providers = createBundleIdentityProviders({
      overrides: new IdentityProviderOverrides(h.server.db, KEY, locked),
      members: [],
      backoffice: [code],
      memberCallbackPath: '/m',
      backofficeCallbackPath: '/b',
      groups: async () => [],
      audit: async (action, provider, detail) => {
        audit.push({ action, name: provider.name, detail })
      },
    })
    const store = new IdentityProviderOverrides(h.server.db, KEY)
    return { h, providers, audit, store }
  }

  test('a new issuer without its own secret is refused; with one, it replaces the old', async () => {
    const { providers, store } = await host()
    const refused = await providers.update('user', 'corp', { issuer: 'https://new.example' })
    expect(refused).toEqual({
      ok: false,
      error:
        'A new issuer needs its own secret: give Corp the client secret for https://new.example in the same save.',
    })
    expect(
      await providers.update('user', 'corp', {
        issuer: 'https://new.example',
        clientSecret: 'new-secret',
      }),
    ).toEqual({ ok: true })
    expect((await store.apply('user', code)).oidc.clientSecret).toBe('new-secret')
    // Back to the config's issuer: the kept secret goes, and the config's applies.
    expect(await providers.update('user', 'corp', { issuer: '' })).toEqual({ ok: true })
    expect(await store.get('user', 'corp')).toEqual({ overrides: {}, hasClientSecret: false })
    expect((await store.apply('user', code)).oidc.clientSecret).toBe('from-config')
  })

  test('changes and resets are audited, never with a secret', async () => {
    const { providers, audit } = await host()
    await providers.update('user', 'corp', {
      issuer: 'https://new.example',
      clientSecret: 'new-secret',
    })
    await providers.update('user', 'corp', { name: 'Corp' })
    await providers.reset('user', 'corp')
    expect(audit).toEqual([
      {
        action: 'identity provider changed',
        name: 'Corp',
        detail: 'issuer, client secret set',
      },
      { action: 'identity provider changed', name: 'Corp', detail: 'name' },
      { action: 'identity provider reset', name: 'Corp', detail: null },
    ])
    expect(JSON.stringify(audit)).not.toContain('new-secret')
  })

  test('a locked one refuses every change, shows what it ignores, and resets', async () => {
    const { h, store } = await host()
    await store.update('user', code, { name: 'Renamed' })
    for (const locked of [['corp'], 'all'] as const) {
      const providers = createBundleIdentityProviders({
        overrides: new IdentityProviderOverrides(h.server.db, KEY, locked),
        members: [],
        backoffice: [code],
        memberCallbackPath: '/m',
        backofficeCallbackPath: '/b',
        groups: async () => [],
      })
      const refused = await providers.update('user', 'corp', { name: 'Again' })
      expect(refused.ok ? '' : refused.error).toContain(
        "locked by the server's CROMBOLO_LOCKED_IDENTITY_PROVIDERS",
      )
      const [listed] = await providers.list()
      expect(listed).toMatchObject({
        name: 'Corp',
        locked: 'environment',
        ignored: ['name'],
        overridden: [],
      })
    }
    const byConfig = createBundleIdentityProviders({
      overrides: new IdentityProviderOverrides(h.server.db, KEY),
      members: [],
      backoffice: [{ ...code, locked: true }],
      memberCallbackPath: '/m',
      backofficeCallbackPath: '/b',
      groups: async () => [],
    })
    const refused = await byConfig.update('user', 'corp', { name: 'Again' })
    expect(refused.ok ? '' : refused.error).toContain("locked by the site's configuration")
    expect(await byConfig.reset('user', 'corp')).toBe(true)
    expect((await byConfig.list())[0]).toMatchObject({ locked: 'config', ignored: [] })
  })
})
