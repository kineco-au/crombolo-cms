/**
 * Story 241: installed bundles managed from the CLI and the remote protocol.
 * `--wire`'s edit to crombolo.config.ts; the bundle admin behind Settings →
 * Bundles, the remote and the CLI; and the remote's gates: the site's level,
 * ApplyStructure, and "Install code on this site", which an administrator
 * holds only when a group gives it to them.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createExtensionRegistry } from '@crombolo/backoffice-host'
import { AuditLog, connect } from '@crombolo/data'
import {
  createBundleAdmin,
  createMarketplace,
  loadConfig,
  REMOTE_API_PATH,
  type RemoteSettings,
  restartPending,
  VERSION,
} from '@crombolo/server'
import { grantGaps, parseSpec } from '../packages/cli/src/support/bundles.ts'
import { newConfigWiring, wireBundle } from '../packages/cli/src/support/wire.ts'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, ORIGIN, signedInServer, signInAsGroup, V1 } from './support/harness.ts'

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

const temp = (name: string) => {
  const parent = join(process.cwd(), 'output')
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, `${name}-`))
  dirs.push(dir)
  return dir
}

const SERVER = { server: 'crm', schemaVersion: 3, permissions: ['documents.read'] }

const manifest = (name: string, version: string, field: Record<string, unknown> = {}) => ({
  name,
  version,
  peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
  crombolo: {
    id: name.replace(/[^a-z0-9]+/g, '-').replace(/^-+/, ''),
    extensions: [{ type: 'dashboard', alias: `${name}.d`, name, element: 'd.js' }],
    ...field,
  },
})

/** A site whose node_modules an install writes to. */
function site(installed: Record<string, Record<string, unknown>> = {}) {
  const root = temp('bundle-manage-site')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'a-site', dependencies: {} }))
  for (const [name, field] of Object.entries(installed)) addPackage(root, name, field)
  return root
}

function addPackage(root: string, name: string, field: Record<string, unknown>) {
  const dir = join(root, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest(name, '1.0.0', field)))
  const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  json.dependencies[name] = '^1.0.0'
  writeFileSync(join(root, 'package.json'), JSON.stringify(json))
}

/** A registry answering one bundle, with a server half asking for `documents.read`. */
const registry = (name: string) =>
  (async () =>
    Response.json({
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': manifest(name, '1.0.0', SERVER) },
    })) as unknown as typeof fetch

describe('--wire: the bundle turned on in crombolo.config.ts', () => {
  const BARE =
    "import { defineConfig } from '@crombolo/crombolo'\n\nexport default defineConfig({\n  siteName: 'Acme',\n})\n"

  test('adds the import and a bundles entry, and changes nothing the second time', () => {
    const once = wireBundle(BARE, 'crm', '@acme/crm')
    expect(once).toMatchObject({ ok: true, changed: true })
    if (!once.ok) return
    expect(once.text).toContain("import { crm } from '@acme/crm'")
    expect(once.text).toContain('bundles: [crm()],')
    expect(once.text).toContain("siteName: 'Acme'")
    expect(wireBundle(once.text, 'crm', '@acme/crm')).toMatchObject({ ok: true, changed: false })
  })

  test('appends to a bundles list there already, and to an import of the same package', () => {
    const source =
      "import { defineConfig } from '@crombolo/crombolo'\nimport { other } from '@acme/crm'\nimport { redirects } from '@crombolo/simple-redirects'\n\nexport default defineConfig({\n  bundles: [redirects(), other()],\n})\n"
    const wired = wireBundle(source, 'crm', '@acme/crm')
    expect(wired.ok).toBe(true)
    if (!wired.ok) return
    expect(wired.text).toContain("import { other, crm } from '@acme/crm'")
    expect(wired.text).toContain('bundles: [redirects(), other(), crm()]')
  })

  test('fills an empty list, and an empty config', () => {
    const empty = wireBundle(
      "import { defineConfig } from '@crombolo/crombolo'\nexport default defineConfig({ bundles: [] })\n",
      'crm',
      '@acme/crm',
    )
    expect(empty.ok && empty.text).toContain('bundles: [crm()]')
    const none = wireBundle(
      "import { defineConfig } from '@crombolo/crombolo'\nexport default defineConfig({})\n",
      'crm',
      '@acme/crm',
    )
    expect(none.ok && none.text).toContain('bundles: [crm()],')
  })

  test('refuses a config it cannot edit safely, giving the two lines to add by hand', () => {
    for (const source of [
      'export default { bundles: [] }\n',
      "import { defineConfig } from '@crombolo/crombolo'\nconst list = []\nexport default defineConfig({ bundles: list })\n",
    ]) {
      const refused = wireBundle(source, 'crm', '@acme/crm')
      expect(refused.ok).toBe(false)
      if (refused.ok) continue
      expect(refused.lines).toEqual(["import { crm } from '@acme/crm'", 'bundles: [crm()]'])
    }
  })

  test('writes a whole config for a site with none', () => {
    const text = newConfigWiring('crm', '@acme/crm')
    expect(text).toContain("import { defineConfig } from '@crombolo/crombolo'")
    expect(wireBundle(text, 'crm', '@acme/crm')).toMatchObject({ ok: true, changed: false })
  })
})

describe('naming what is installed and granted', () => {
  test('a spec is a name, a scoped name with a version, or a packed file', () => {
    expect(parseSpec('@acme/crm@2.1.0')).toEqual({ name: '@acme/crm', version: '2.1.0' })
    expect(parseSpec('@acme/crm')).toEqual({ name: '@acme/crm' })
    expect(parseSpec('crm@^2')).toEqual({ name: 'crm', version: '^2' })
    expect(parseSpec('./crm-1.0.0.tgz').file).toMatch(/crm-1\.0\.0\.tgz$/)
  })

  test('a grant names exactly what is asked: what it leaves out, and what it adds', () => {
    expect(grantGaps(['a', 'b'], ['a', 'b'])).toEqual({ missing: [], extra: [] })
    expect(grantGaps(['a', 'b'], ['a', 'c'])).toEqual({ missing: ['b'], extra: ['c'] })
  })
})

describe('the bundle admin', () => {
  async function admin(root: string) {
    // The audit log is not under test here, so a database with no tables will do.
    const db = await connect({ file: ':memory:' })
    const config = loadConfig({ siteDir: root, dialect: 'sqlite', sqliteFile: ':memory:' }, root)
    const extensions = createExtensionRegistry(root, { cache: false })
    const marketplace = createMarketplace({
      registry: 'https://registry.example',
      keyword: 'crombolo-bundle',
      marketplaceUrl: 'https://example',
      extensions,
      siteDir: root,
      fetch: registry('@acme/crm'),
      // The install `bun add` would do: the package lands under node_modules.
      install: async (action, specifier) => {
        if (action === 'add') addPackage(root, specifier.replace(/@[^@/]*$/, ''), SERVER)
        else rmSync(join(root, 'node_modules', specifier), { recursive: true, force: true })
        return { ok: true, output: '' }
      },
    })
    const state = new Map<string, boolean>()
    const grants = {
      disable: async (pkg: { id: string }) => {
        state.set(pkg.id, false)
        return { on: false } as never
      },
      enable: async (pkg: { id: string }) => {
        state.set(pkg.id, true)
        return { on: true } as never
      },
    }
    return {
      db,
      bundles: createBundleAdmin({
        db,
        config,
        marketplace,
        extensions,
        bundleGrants: grants,
      }),
    }
  }

  test('an install with server code marks a restart, and refuses a grant that does not match', async () => {
    const root = site()
    const { bundles, db } = await admin(root)
    try {
      const actor = { id: null, name: 'someone', email: null, source: 'cli' as const }
      const refused = await bundles.install(actor, {
        name: '@acme/crm',
        acceptServerCode: true,
        grant: [],
      })
      expect(refused).toMatchObject({ ok: false, needsServerConsent: true })
      expect(restartPending(root)).toBeUndefined()

      const installed = await bundles.install(actor, {
        name: '@acme/crm',
        acceptServerCode: true,
        grant: ['documents.read'],
      })
      expect(installed).toMatchObject({ ok: true, restartPending: true })
      expect(restartPending(root)?.reasons).toEqual(['@acme/crm@1.0.0 installed'])
      expect((await bundles.installed()).restartPending?.reasons).toHaveLength(1)
    } finally {
      await db.close()
    }
  })
})

describe(`installed bundles on a remote (${dialectUnderTest})`, () => {
  async function remote(remoteSettings: Partial<RemoteSettings>, root = site()) {
    const h = await signedInServer({
      config: {
        siteDir: root,
        remote: {
          enabled: true,
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 2,
          ...remoteSettings,
        },
      },
    })
    open.push(h)
    const api = (client: Harness, path: string, init: RequestInit = {}) =>
      client.server.fetch(
        new Request(`${ORIGIN}${REMOTE_API_PATH}/environments/production/${path}`, {
          ...init,
          headers: {
            cookie: client.cookie(),
            'content-type': 'application/json',
            ...(init.headers as Record<string, string>),
          },
        }),
      )
    return { h, api, root }
  }

  /** A group that may change the site, with or without installing code. */
  async function deployer(h: Harness, alias: string, installCode: boolean) {
    const made = await h.post(`${V1}/user-group`, {
      name: alias,
      alias,
      sections: ['Umb.Section.Content'],
      languages: [],
      hasAccessToAllLanguages: true,
      documentRootAccess: true,
      documentStartNode: null,
      mediaRootAccess: true,
      mediaStartNode: null,
      elementRootAccess: false,
      elementStartNode: null,
      fallbackPermissions: [
        'Crombolo.Remote.Pull',
        'Crombolo.Remote.Push',
        'Crombolo.Remote.ApplyStructure',
        ...(installCode ? ['Crombolo.Remote.InstallCode'] : []),
      ],
      permissions: [],
    })
    expect(made.status).toBe(201)
    return signInAsGroup(h, alias)
  }

  test('lists at read, and says bundle-manage in discovery', async () => {
    const { h, api } = await remote({ access: 'read' }, site({ '@acme/crm': SERVER }))
    const discovery = await (
      await h.server.fetch(new Request(`${ORIGIN}/.well-known/crombolo-remote`))
    ).json()
    expect(discovery.capabilities).toContain('bundle-manage')
    const listed = (await (await api(h, 'installed')).json()) as {
      items: Array<{ packageName: string }>
      restartPending: unknown
    }
    expect(listed.items.map((item) => item.packageName)).toEqual(['@acme/crm'])
    expect(listed.restartPending).toBeNull()
    const refused = await api(h, 'installed/@acme%2Fcrm', { method: 'DELETE' })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { code: string }).code).toBe('access-level')
  })

  test('an administrator may not install or remove code until a group gives them that', async () => {
    const { h, api } = await remote({ access: 'all' })
    const asAdmin = await api(h, 'installed/@acme%2Fcrm', { method: 'DELETE' })
    expect(asAdmin.status).toBe(403)
    expect(((await asAdmin.json()) as { code: string }).code).toBe('forbidden-code')

    const without = await deployer(h, 'deployers', false)
    expect(
      (
        (await (await api(without, 'installed/@acme%2Fcrm', { method: 'DELETE' })).json()) as {
          code: string
        }
      ).code,
    ).toBe('forbidden-code')

    const log = new AuditLog(h.server.db)
    const floor = (await log.page({}, { limit: 1 })).items[0]?.id ?? 0
    const allowed = await deployer(h, 'installers', true)
    const removed = await api(allowed, 'installed/@acme%2Fcrm', { method: 'DELETE' })
    expect(removed.status, await removed.clone().text()).toBe(200)
    const entries = (await log.page({}, { after: floor, limit: 20 })).items.filter(
      (entry) => entry.entityType === 'Bundle',
    )
    expect(entries.map((entry) => [entry.action, entry.entityName])).toEqual([
      ['Uninstall', '@acme/crm'],
    ])
  })

  test('an install whose grant does not match is refused, naming what is missing', async () => {
    const npm = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': manifest('@acme/crm', '1.0.0', SERVER) },
        }),
    })
    try {
      const root = site()
      const h = await signedInServer({
        config: {
          siteDir: root,
          npmRegistry: `http://localhost:${npm.port}`,
          remote: {
            enabled: true,
            access: 'all',
            environment: 'production',
            protected: false,
            approvals: false,
            maxUploadBytes: 1024 ** 2,
          },
        },
      })
      open.push(h)
      const allowed = await deployer(h, 'installers', true)
      const response = await allowed.server.fetch(
        new Request(`${ORIGIN}${REMOTE_API_PATH}/environments/production/installed`, {
          method: 'POST',
          headers: { cookie: allowed.cookie(), 'content-type': 'application/json' },
          body: JSON.stringify({ name: '@acme/crm', grant: [] }),
        }),
      )
      expect(response.status).toBe(409)
      const problem = (await response.json()) as { code: string; items: string[] }
      expect(problem.code).toBe('grant-mismatch')
      expect(problem.items).toEqual(['not granted: documents.read'])
    } finally {
      npm.stop(true)
    }
  })

  test('a site that does not install while it runs says so', async () => {
    const off = await signedInServer({
      config: {
        siteDir: site(),
        runtimeInstalls: false,
        remote: {
          enabled: true,
          access: 'all',
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 2,
        },
      },
    })
    open.push(off)
    const there = await deployer(off, 'installers', true)
    const response = await there.server.fetch(
      new Request(`${ORIGIN}${REMOTE_API_PATH}/environments/production/installed/x`, {
        method: 'DELETE',
        headers: { cookie: there.cookie() },
      }),
    )
    expect(response.status).toBe(409)
    expect(((await response.json()) as { code: string }).code).toBe('installs-elsewhere')
  })

  test('an administrator turns a bundle off and on; nobody else may', async () => {
    const { h, api } = await remote({ access: 'all' }, site({ '@acme/crm': SERVER }))
    const writer = await deployer(h, 'deployers', true)
    expect((await api(writer, 'installed/acme-crm/disable', { method: 'POST' })).status).toBe(403)
    const off = await api(h, 'installed/acme-crm/disable', { method: 'POST' })
    expect(off.status).toBe(200)
    expect(await off.json()).toMatchObject({ ok: true, on: false })
    const listed = (await (await api(h, 'installed')).json()) as {
      items: Array<{ on: boolean }>
    }
    expect(listed.items[0]?.on).toBe(false)
    expect(
      await (await api(h, 'installed/acme-crm/enable', { method: 'POST' })).json(),
    ).toMatchObject({ ok: true, on: true })
    expect((await api(h, 'installed/nothing/enable', { method: 'POST' })).status).toBe(404)
  })
})
