/**
 * Bundles ask for permissions (story 222): what a package may declare, how a
 * bundle's capabilities are held to it; a bundle wired in the config approved
 * by it, and one an administrator disables (story 225). docs/bundles.md,
 * "Permissions".
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { validateBundlePackage } from '@crombolo/backoffice-host'
import { route } from '@crombolo/common'
import { cromboloPlan, migrate } from '@crombolo/data'
import {
  type BundleRedirects,
  createBundleGrants,
  gated,
  PermissionRefusedError,
  permissionProblems,
  type ServerBundle,
} from '@crombolo/server'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { dialectUnderTest, freshDb } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

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

const manifest = (crombolo: Record<string, unknown>) => ({
  name: '@acme/notes',
  version: '1.0.0',
  peerDependencies: { '@crombolo/crombolo': '*' },
  crombolo: { id: 'notes', server: 'notes', schemaVersion: 3, permissions: [], ...crombolo },
})

describe('what a package declares', () => {
  test('a server half declares its permissions, from the list this release offers', () => {
    expect(validateBundlePackage(manifest({ permissions: ['redirects.read'] }))).toEqual([])
    expect(validateBundlePackage(manifest({ permissions: undefined })).join('\n')).toContain(
      'declares no "crombolo.permissions"',
    )
    expect(validateBundlePackage(manifest({ permissions: ['members.read'] })).join('\n')).toContain(
      'which this release does not offer',
    )
    expect(
      validateBundlePackage(manifest({ permissions: ['media.read', 'media.read'] })).join('\n'),
    ).toContain('names a permission twice')
  })

  test('a server half written for schema 2 is refused, naming what changed', () => {
    const problems = validateBundlePackage(manifest({ schemaVersion: 2 })).join('\n')
    expect(problems).toContain('this release reads 3')
    expect(problems).toContain('"crombolo.permissions"')
  })
})

describe('capabilities against permissions', () => {
  test('a capability needs one of its permissions, media also member.delegate, and none is spare', () => {
    expect(permissionProblems('notes', ['redirects', 'log'], ['redirects.read'])).toEqual([])
    expect(permissionProblems('notes', ['redirects'], []).join('\n')).toContain(
      'uses "redirects" but declares none of its permissions',
    )
    expect(permissionProblems('notes', ['media'], ['media.write']).join('\n')).toContain(
      'needs "member.delegate"',
    )
    expect(permissionProblems('notes', ['log'], ['documents.read']).join('\n')).toContain(
      'which none of its capabilities uses',
    )
  })

  test('a capability serves only the methods its permissions allow', async () => {
    const calls: string[] = []
    const host = {
      list: async () => {
        calls.push('list')
        return { total: 0, items: [] }
      },
      save: async () => {
        calls.push('save')
        return {}
      },
    } as unknown as BundleRedirects
    const readOnly = gated('notes', 'redirects', host, ['redirects.read'])
    await readOnly.list()
    expect(() => readOnly.save({} as never)).toThrow(PermissionRefusedError)
    expect(() => readOnly.save({} as never)).toThrow('"redirects.write"')
    expect(calls).toEqual(['list'])
  })
})

describe(`approvals and disabling (${dialectUnderTest})`, () => {
  test('a wired bundle runs with no row; its approval is recorded once per change; disabled holds through an upgrade', async () => {
    const db = await freshDb()
    try {
      await migrate(db, cromboloPlan)
      let pkg = stubBundlePackage('notes', {
        field: { id: 'notes', server: 'notes', schemaVersion: 3, permissions: ['redirects.read'] },
      })
      const grants = createBundleGrants({ db, packages: () => new Map([['notes', pkg]]) })
      await grants.refresh()
      expect(grants.isOn('notes')).toBe(true)
      expect(grants.isOn('elsewhere')).toBe(false)
      expect(await grants.grant(pkg, "the site's code")).toBe(true)
      expect(await grants.grant(pkg, "the site's code")).toBe(false)
      expect(grants.state(pkg).grant).toMatchObject({
        grantedBy: "the site's code",
        permissions: ['redirects.read'],
      })

      const off = await grants.disable(pkg, 'admin@example.com')
      expect(off).toMatchObject({ on: false, disabledBy: 'admin@example.com' })
      expect(grants.isOn('notes')).toBe(false)
      // A new version asking for more is recorded, and stays disabled.
      pkg = {
        ...pkg,
        version: '1.1.0',
        field: { ...pkg.field, permissions: ['redirects.read', 'redirects.write'] },
      }
      expect(await grants.grant(pkg, "the site's code")).toBe(true)
      expect(grants.isOn('notes')).toBe(false)
      expect(grants.state(pkg).grant?.permissions).toEqual(['redirects.read', 'redirects.write'])

      expect(await grants.enable(pkg)).toMatchObject({ on: true, disabledBy: null })
      expect(grants.isOn('notes')).toBe(true)
    } finally {
      await db.close()
    }
  })

  test('a bundle disabled before any approval was recorded is off, and its approval keeps it so', async () => {
    const db = await freshDb()
    try {
      await migrate(db, cromboloPlan)
      const pkg = stubBundlePackage('notes', {
        field: { id: 'notes', server: 'notes', schemaVersion: 3, permissions: ['redirects.read'] },
      })
      const grants = createBundleGrants({ db, packages: () => new Map([['notes', pkg]]) })
      await grants.refresh()
      await grants.disable(pkg, null)
      expect(await grants.grant(pkg, "the site's code")).toBe(true)
      expect(grants.state(pkg)).toMatchObject({ on: false, disabledBy: null })
    } finally {
      await db.close()
    }
  })
})

/** A site whose bundle lists redirects in a route, with a screen, asking only to read them. */
function notesSite() {
  const dir = siteDeclaring('bundle-permissions', {
    '@acme/notes': {
      json: {
        version: '1.0.0',
        crombolo: {
          id: 'notes',
          name: 'Notes',
          server: 'notes',
          permissions: ['redirects.read'],
          extensions: [{ type: 'dashboard', alias: 'Acme.Notes.Dashboard', name: 'Notes' }],
        },
      },
    },
  })
  dirs.push(dir)
  const bundle: ServerBundle<'redirects'> = {
    id: 'notes',
    section: 'settings',
    capabilities: ['redirects'],
    routes: [
      route<unknown, unknown, { bundle: { redirects: BundleRedirects } }>('/notes', {
        async GET(_request, { bundle }) {
          return Response.json({ total: (await bundle.redirects.list()).total })
        },
        async POST(_request, { bundle }) {
          await bundle.redirects.save({ path: '/from', target: '/to' } as never)
          return new Response('saved')
        },
      }),
    ],
  }
  return { dir, bundle: bundle as unknown as ServerBundle }
}

describe(`a wired bundle (${dialectUnderTest})`, () => {
  test("runs on first boot, approved by the site's code; disabled, its routes and screens are off until enabled", async () => {
    const { dir, bundle } = notesSite()
    const h = await signedInServer({
      config: { siteDir: dir, componentsDir: join(dir, 'components'), bundles: [bundle] },
    })
    open.push(h)
    const aliases = async () =>
      JSON.stringify(await (await h.call(`${V1}/manifest/manifest`)).json()).includes(
        'Acme.Notes.Dashboard',
      )
    expect((await h.call('/notes')).status).toBe(200)
    expect(await aliases()).toBe(true)
    expect(h.server.disabledBundles()).toEqual([])
    // It may read redirects, and saving one is refused, naming the permission.
    expect((await h.call('/notes', { method: 'POST' })).status).toBe(500)

    type Listing = {
      items: {
        id: string
        on: boolean
        disabledBy: string | null
        granted?: { by: string | null }
        permissions: { allows: string }[]
      }[]
    }
    const notes = async () =>
      (await h.json<Listing>(`${BACKOFFICE}/crombolo/api/bundles/installed`)).items.find(
        (item) => item.id === 'notes',
      )
    expect(await notes()).toMatchObject({
      on: true,
      granted: { by: "the site's code" },
      permissions: [{ allows: "See the site's redirects" }],
    })

    const post = (action: string) =>
      h.call(`${BACKOFFICE}/crombolo/api/bundles/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'notes' }),
      })
    expect(((await (await post('disable')).json()) as { on: boolean }).on).toBe(false)
    const off = await h.call('/notes')
    expect(off.status).toBe(503)
    expect(((await off.json()) as { detail: string }).detail).toContain(
      'disabled by an administrator',
    )
    expect(await aliases()).toBe(false)
    expect(h.server.disabledBundles()).toEqual([{ id: 'notes', by: expect.any(String) }])
    expect((await notes())?.on).toBe(false)

    expect(((await (await post('enable')).json()) as { on: boolean }).on).toBe(true)
    expect((await h.call('/notes')).status).toBe(200)

    const audit = await h.server.db.q
      .selectFrom('audit_entry')
      .select(['action', 'source'])
      .where('entity_type', '=', 'Bundle')
      .orderBy('id')
      .execute()
    expect(audit).toEqual([
      { action: 'Grant', source: 'boot' },
      { action: 'Disable', source: 'request' },
      { action: 'Enable', source: 'request' },
    ])
  })
})
