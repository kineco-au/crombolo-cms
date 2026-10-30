/**
 * Bundles ask for permissions (story 222): what a package may declare, how a
 * bundle's capabilities are held to it, and a bundle that is off until an
 * administrator grants all of it. docs/bundles.md, "Permissions".
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { validateBundlePackage } from '@crombolo/backoffice-host'
import { bundleGrant } from '@crombolo/cli'
import { route } from '@crombolo/common'
import { BundleGrantRepository, connect, cromboloPlan, migrate } from '@crombolo/data'
import {
  type BundleRedirects,
  createBundleGrants,
  gated,
  grantCovers,
  loadConfig,
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

describe(`grants (${dialectUnderTest})`, () => {
  test('a bundle is on once its grant covers everything it declares, and off when it asks for more', async () => {
    const db = await freshDb()
    try {
      await migrate(db, cromboloPlan)
      let pkg = stubBundlePackage('notes', {
        field: { id: 'notes', server: 'notes', schemaVersion: 3, permissions: ['redirects.read'] },
      })
      const grants = createBundleGrants({ db, packages: () => new Map([['notes', pkg]]) })
      await grants.refresh()
      expect(grants.isOn('notes')).toBe(false)
      await grants.grant(pkg, 'an administrator')
      expect(grants.isOn('notes')).toBe(true)
      // A new version asking for more is off until all of it is approved.
      pkg = {
        ...pkg,
        version: '1.1.0',
        field: { ...pkg.field, permissions: ['redirects.read', 'redirects.write'] },
      }
      expect(grants.isOn('notes')).toBe(false)
      expect(grants.state(pkg).missing).toEqual(['redirects.write'])
      await grants.withdraw('notes')
      expect(grants.state(pkg).grant).toBeUndefined()
      // Asking for nothing needs no grant.
      expect(grantCovers([], undefined)).toBe(true)
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
  test('is off until granted: its routes say so, its screens are left out, and the server lists it', async () => {
    const { dir, bundle } = notesSite()
    const h = await signedInServer({
      ungranted: true,
      config: { siteDir: dir, componentsDir: join(dir, 'components'), bundles: [bundle] },
    })
    open.push(h)
    const waiting = await h.call('/notes')
    expect(waiting.status).toBe(503)
    expect(((await waiting.json()) as { detail: string }).detail).toContain(
      'waiting for an administrator',
    )
    expect(h.server.waitingBundles()).toEqual([{ id: 'notes', missing: ['redirects.read'] }])
    const aliases = async () =>
      JSON.stringify(await (await h.call(`${V1}/manifest/manifest`)).json()).includes(
        'Acme.Notes.Dashboard',
      )
    expect(await aliases()).toBe(false)

    const listing = await h.json<{
      items: { id: string; on: boolean; permissions: { allows: string }[] }[]
    }>(`${BACKOFFICE}/crombolo/api/bundles/installed`)
    const notes = listing.items.find((item) => item.id === 'notes')
    expect(notes?.on).toBe(false)
    expect(notes?.permissions.map((p) => p.allows)).toEqual(["See the site's redirects"])

    const granted = await h.call(`${BACKOFFICE}/crombolo/api/bundles/grant`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'notes' }),
    })
    expect(((await granted.json()) as { on: boolean }).on).toBe(true)
    expect((await h.call('/notes')).status).toBe(200)
    expect(await aliases()).toBe(true)
    expect(h.server.waitingBundles()).toEqual([])

    // It may read redirects, and saving one is refused, naming the permission.
    const saved = await h.call('/notes', { method: 'POST' })
    expect(saved.status).toBe(500)

    const withdrawn = await h.call(`${BACKOFFICE}/crombolo/api/bundles/withdraw`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'notes' }),
    })
    expect(((await withdrawn.json()) as { on: boolean }).on).toBe(false)
    expect((await h.call('/notes')).status).toBe(503)

    const audit = await h.server.db.q
      .selectFrom('audit_entry')
      .select(['action', 'detail'])
      .where('entity_type', '=', 'Bundle')
      .orderBy('id')
      .execute()
    expect(audit.map((row) => row.action)).toEqual(['Grant', 'Withdraw'])
  })

  test('an operator grants it from the command line', async () => {
    if (dialectUnderTest !== 'sqlite') return
    const { dir } = notesSite()
    const config = loadConfig({
      siteDir: dir,
      sqliteFile: join(dir, 'crombolo.sqlite'),
      dialect: 'sqlite',
    })
    const granted = await bundleGrant(config, 'notes', { by: 'deploy' })
    expect(granted.permissions).toEqual(['redirects.read'])
    const db = await connect({ dialect: 'sqlite', file: config.sqliteFile })
    try {
      expect((await new BundleGrantRepository(db).get('notes'))?.grantedBy).toBe('deploy')
    } finally {
      await db.close()
    }
    await expect(bundleGrant(config, 'nobody')).rejects.toThrow('No package this site depends on')
  })
})
