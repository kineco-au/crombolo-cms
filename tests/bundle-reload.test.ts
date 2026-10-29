/**
 * Story 181: a host installs a site's bundles itself, and a running node takes
 * them up through `reloadBundles()`: the back office serves what is there now,
 * open back offices hear about it, and no server half is ever mounted.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createExtensionRegistry } from '@crombolo/backoffice-host'
import * as crombolo from '@crombolo/crombolo'
import {
  BUNDLES_CHANGED_EVENT,
  type BundleReload,
  createBundleReloader,
  VERSION,
} from '@crombolo/server'
import { type Harness, ORIGIN, signedInServer } from './support/harness.ts'

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

/** A site whose package.json and node_modules a host writes to mid-test. */
function site(): string {
  const parent = join(import.meta.dir, '..', 'output')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'bundle-reload-'))
  dirs.push(root)
  mkdirSync(join(root, 'components'), { recursive: true })
  depend(root, {})
  return root
}

const depend = (root: string, dependencies: Record<string, string>) =>
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'a-site', dependencies }))

/** Writes a valid bundle into node_modules, as a host's install would. */
function install(
  root: string,
  name: string,
  version = '1.0.0',
  field: Record<string, unknown> = {},
) {
  const dir = join(root, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'd.js'), 'export default class {}\n')
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version,
      peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
      crombolo: {
        id: name.replace(/[^a-z0-9]+/g, '-').replace(/^-+/, ''),
        extensions: [{ type: 'dashboard', alias: `${name}.d`, name, element: 'd.js' }],
        ...field,
      },
    }),
  )
}

describe('reloading what a host installed', () => {
  test('sees a package added, changed and removed, and says so once each', () => {
    const root = site()
    const heard: BundleReload[] = []
    const reloader = createBundleReloader({
      // Uncached, as development runs: the comparison is against what was seen.
      extensions: createExtensionRegistry(root, { cache: false }),
      wired: () => [],
      changed: (reload) => heard.push(reload),
    })

    install(root, 'acme-seo')
    depend(root, { 'acme-seo': '^1.0.0' })
    expect(reloader.reload().added.map((b) => [b.packageName, b.version])).toEqual([
      ['acme-seo', '1.0.0'],
    ])
    // Nothing changed since: nothing is said.
    expect(reloader.reload()).toEqual({ added: [], removed: [], changed: [], problems: [] })

    install(root, 'acme-seo', '1.1.0')
    expect(reloader.reload().changed).toEqual([
      { packageName: 'acme-seo', from: '1.0.0', to: '1.1.0' },
    ])

    depend(root, {})
    expect(reloader.reload().removed).toEqual([{ packageName: 'acme-seo', version: '1.1.0' }])
    expect(heard).toHaveLength(3)
  })

  test('a bundle with a server half is listed as found, and not wired', () => {
    const root = site()
    const reloader = createBundleReloader({
      extensions: createExtensionRegistry(root),
      wired: () => [],
      changed: () => {},
    })
    install(root, 'acme-forms', '1.0.0', { server: 'acmeForms', schemaVersion: 2 })
    depend(root, { 'acme-forms': '^1.0.0' })
    const [found] = reloader.reload().added
    expect(found?.carries.server).toBe(true)
    expect(found?.wired).toBe(false)
  })
})

describe('a running node (story 181)', () => {
  test('serves a bundle installed while it runs, and tells open back offices', async () => {
    const root = site()
    const h = await signedInServer({ config: { siteDir: root } })
    open.push(h)
    const sent: unknown[][] = []
    h.server.events.broadcast = (target, args) => {
      sent.push([target, ...args])
      return 1
    }
    const file = `${ORIGIN}/bundles/acme-seo/d.js`
    expect((await h.server.fetch(new Request(file))).status).toBe(404)

    install(root, 'acme-seo')
    depend(root, { 'acme-seo': '^1.0.0' })
    // Unseen until it is told: discovery is cached outside development.
    const reload = await h.server.reloadBundles()
    expect(reload.added.map((b) => b.packageName)).toEqual(['acme-seo'])
    expect((await h.server.fetch(new Request(file))).status).toBe(200)
    expect(sent).toEqual([['notify', BUNDLES_CHANGED_EVENT]])

    depend(root, {})
    expect((await h.server.reloadBundles()).removed.map((b) => b.packageName)).toEqual(['acme-seo'])
    expect((await h.server.fetch(new Request(file))).status).toBe(404)
  })
})

describe('the umbrella package (story 181)', () => {
  test('exports the checks a host runs and the handle it keeps', () => {
    expect(typeof crombolo.validateBundlePackage).toBe('function')
    expect(typeof crombolo.peerRangeProblem).toBe('function')
    expect(typeof crombolo.cromboloServer).toBe('function')
    expect(
      crombolo.validateBundlePackage({ name: 'x', version: '1.0.0', crombolo: {} }),
    ).not.toEqual([])
  })
})
