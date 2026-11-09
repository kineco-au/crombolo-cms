/**
 * Story 309: a grant is what lets an extension run. It runs while its grant
 * covers what its installed version asks for; a version that asks for more
 * waits for a grant, and one that asks for less is narrowed and stays on.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { BundlePackage } from '@crombolo/backoffice-host'
import { cromboloPlan, migrate } from '@crombolo/data'
import { createBundleGrants, grantGaps } from '@crombolo/server'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'
import { dialectUnderTest, freshDb } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
})

/** An extension asking for these permissions, at this version. */
const asking = (version: string, permissions: Record<string, unknown>): BundlePackage =>
  stubBundlePackage('crm', {
    version,
    field: {
      bundleType: 'extension',
      id: 'crm',
      server: 'crm',
      schemaVersion: 4,
      permissions: permissions as never,
    },
  })

const grant = (permissions: string[], over: Record<string, unknown> = {}) => ({
  bundleId: 'crm',
  packageName: '@acme/crm',
  version: '1.0.0',
  permissions,
  origins: [] as string[],
  actAs: null,
  grantedBy: 'admin@example.com',
  grantedAt: new Date(),
  recorded: true,
  disabledBy: null,
  disabledAt: null,
  ...over,
})

describe('what a grant leaves out', () => {
  test('permissions, origins, and whom actAs acts for', () => {
    const pkg = asking('1.0.0', {
      'content.read': 'x',
      'http.outbound': { reason: 'x', origins: ['https://api.acme.com'] },
      actAs: 'x',
    })
    expect(grantGaps(pkg, undefined)).toEqual(['content.read', 'http.outbound', 'actAs'])
    expect(grantGaps(pkg, grant(['content.read', 'http.outbound', 'actAs']))).toEqual([
      'http.outbound https://api.acme.com',
      'actAs: whom it acts for',
    ])
    expect(
      grantGaps(
        pkg,
        grant(['content.read', 'http.outbound', 'actAs'], {
          origins: ['https://api.acme.com'],
          actAs: 'caller',
        }),
      ),
    ).toEqual([])
  })

  test('a schema 3 grant of documents.read covers content.read', () => {
    const pkg = stubBundlePackage('crm', {
      field: {
        bundleType: 'extension',
        id: 'crm',
        server: 'crm',
        schemaVersion: 3,
        permissions: ['documents.read'],
      },
    })
    expect(grantGaps(pkg, grant(['documents.read']))).toEqual([])
  })
})

describe(`on means granted (${dialectUnderTest})`, () => {
  test('off with no grant, on once granted; more waits, less is narrowed and stays on', async () => {
    const db = await freshDb()
    try {
      await migrate(db, cromboloPlan)
      let pkg = asking('1.0.0', { 'content.read': 'Shows pages' })
      const grants = createBundleGrants({ db, packages: () => new Map([['crm', pkg]]) })
      await grants.refresh()
      expect(grants.state(pkg)).toMatchObject({ on: false, status: 'not-granted' })
      expect(grants.granted('crm')).toEqual([])

      await grants.grant(pkg, 'admin@example.com')
      expect(grants.state(pkg)).toMatchObject({ on: true, status: 'on' })
      expect(grants.granted('crm')).toEqual(['content.read'])

      // A version asking for more waits, saying what.
      pkg = asking('1.1.0', { 'content.read': 'Shows pages', 'members.read': 'Lists members' })
      expect(grants.state(pkg)).toMatchObject({
        on: false,
        status: 'waiting',
        missing: ['members.read'],
      })
      expect(grants.isOn('crm')).toBe(false)

      // One asking for less stays on, its grant narrowed.
      pkg = asking('1.2.0', {})
      expect(grants.isOn('crm')).toBe(true)
      expect(await grants.narrow(pkg)).toBe(true)
      expect(grants.state(pkg).grant).toMatchObject({ version: '1.2.0', permissions: [] })
      expect(await grants.narrow(pkg)).toBe(false)
    } finally {
      await db.close()
    }
  })

  test('turning off one never granted records no grant', async () => {
    const db = await freshDb()
    try {
      await migrate(db, cromboloPlan)
      const pkg = asking('1.0.0', {})
      const grants = createBundleGrants({ db, packages: () => new Map([['crm', pkg]]) })
      await grants.refresh()
      await grants.disable(pkg, 'admin@example.com')
      await grants.enable(pkg)
      expect(grants.state(pkg)).toMatchObject({ on: false, status: 'not-granted' })
    } finally {
      await db.close()
    }
  })
})

describe(`an extension's screens (${dialectUnderTest})`, () => {
  test('are not shown nor served until it is granted, and then are', async () => {
    const dir = siteDeclaring('extension-grants', {
      '@acme/seo': {
        json: {
          crombolo: {
            id: 'acme-seo',
            extensions: [
              {
                type: 'dashboard',
                alias: 'Acme.Dashboard.Seo',
                name: 'SEO',
                element: 'dist/seo.js',
              },
            ],
          },
        },
        files: { 'dist/seo.js': 'export default class {}\n' },
      },
    })
    const h = await signedInServer({
      config: { siteDir: dir, componentsDir: join(dir, 'components') },
    })
    open.push(h)
    const shown = async () =>
      JSON.stringify(await (await h.call(`${V1}/manifest/manifest`)).json()).includes(
        'Acme.Dashboard.Seo',
      )
    const file = () => h.call(`/bundles/@acme/seo/dist/seo.js`)
    expect(await shown()).toBe(false)
    expect((await file()).status).toBe(404)

    const granted = await h.post(`${BACKOFFICE}/crombolo/api/bundles/grant`, {
      id: 'acme-seo',
      grant: [],
    })
    expect(granted.status, await granted.clone().text()).toBe(200)
    expect(await shown()).toBe(true)
    expect((await file()).status).toBe(200)
  })
})
