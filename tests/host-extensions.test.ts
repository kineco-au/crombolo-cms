/**
 * Story 332: a host installs extensions into their roots with the CMS's own
 * install, `installExtension` and `removeExtension` from
 * `@crombolo/crombolo/host`, held to the site's signature policy. A registry
 * stub serves packed fixtures, and `bun add` installs them for real.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  installExtension,
  readRecord,
  recordProblems,
  removeExtension,
  rootOf,
} from '@crombolo/crombolo/host'
import { integrityOf, packedServerExtension, siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const site = (packages: Parameters<typeof siteDeclaring>[1] = {}): string => {
  const dir = siteDeclaring('host-extensions', packages)
  dirs.push(dir)
  return dir
}

/** The packages the stub registry serves, by name and version. */
const published = new Map<
  string,
  Map<string, { json: object; tarball?: Uint8Array<ArrayBuffer> }>
>()
const tarballs = new Map<string, Uint8Array<ArrayBuffer>>()

const registry = Bun.serve({
  port: 0,
  fetch(request) {
    const url = new URL(request.url)
    const tarball = tarballs.get(url.pathname)
    if (tarball) return new Response(tarball)
    const name = decodeURIComponent(url.pathname.slice(1))
    const versions = published.get(name)
    if (!versions) return new Response('Not Found', { status: 404 })
    const latest = [...versions.keys()].sort(Bun.semver.order).at(-1) as string
    return Response.json({
      name,
      'dist-tags': { latest },
      versions: Object.fromEntries(
        [...versions].map(([version, entry]) => {
          const path = `/-/${name.replace('/', '-')}-${version}.tgz`
          return [
            version,
            {
              ...entry.json,
              ...(entry.tarball
                ? {
                    dist: {
                      tarball: `${url.origin}${path}`,
                      integrity: integrityOf(entry.tarball),
                    },
                  }
                : {}),
            },
          ]
        }),
      ),
    })
  },
})
const REGISTRY = `http://localhost:${registry.port}`
afterAll(() => registry.stop(true))

/** Publishes a manifest, with its tarball when it has one. */
function publish(json: { name: string; version: string }, tarball?: Uint8Array<ArrayBuffer>): void {
  const versions = published.get(json.name) ?? new Map()
  versions.set(json.version, { json, tarball })
  published.set(json.name, versions)
  if (tarball) tarballs.set(`/-/${json.name.replace('/', '-')}-${json.version}.tgz`, tarball)
}

/** A server extension, packed and published. */
function publishCrm(name: string, id: string): { tarball: Uint8Array } {
  const { tarball, json } = packedServerExtension(name, id)
  publish(json, tarball)
  return { tarball }
}

describe('installExtension', () => {
  test('installs into the root and writes the line the boot runs, and removeExtension takes both out', async () => {
    const { tarball } = publishCrm('@acme/host-crm', 'hostcrm')
    const dir = site()
    const installed = await installExtension(dir, { name: '@acme/host-crm', registry: REGISTRY })
    if (!installed.ok) throw new Error(installed.problems.join('\n'))
    expect(installed.id).toBe('hostcrm')
    expect(installed.root).toBe(rootOf(dir, 'hostcrm'))
    expect(installed.line).toEqual({
      name: '@acme/host-crm',
      version: '1.0.0',
      integrity: integrityOf(tarball),
    })
    expect(installed.provenance.state).toBe('unsigned')
    expect(readRecord(dir)).toEqual({ hostcrm: installed.line })
    expect(recordProblems(dir)).toEqual([])
    // Pinned to the version checked, and never a dependency of the site.
    const root = JSON.parse(readFileSync(join(installed.root, 'package.json'), 'utf8'))
    expect(root.dependencies).toEqual({ '@acme/host-crm': '1.0.0' })
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies).toEqual({})

    // Granted by the site's config, it runs and is listed in Installed; nothing was granted by the install.
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        extensions: { hostcrm: { grant: ['content.read'] } },
      },
    })
    open.push(h)
    const answered = await h.call(`${BACKOFFICE}/crombolo/api/bundle/hostcrm/settings`)
    expect(answered.status, await answered.clone().text()).toBe(200)
    expect(await answered.json()).toEqual({ greeting: 'hello' })
    const listed = await h.json<{ items: { id: string; granted?: { by: string } }[] }>(
      `${BACKOFFICE}/crombolo/api/bundles/installed`,
    )
    expect(listed.items.find((item) => item.id === 'hostcrm')?.granted?.by).toBe("the site's code")
    await open.pop()?.db.close()

    // What it left in the site's own folders stays, for the host to decide about.
    const home = join(dir, '.crombolo', 'extensions', 'hostcrm')
    expect(existsSync(home)).toBe(true)
    expect(removeExtension(dir, 'hostcrm')).toEqual({ removed: true })
    expect(existsSync(installed.root)).toBe(false)
    expect(readRecord(dir)).toEqual({})
    expect(existsSync(home)).toBe(true)
    expect(removeExtension(dir, 'hostcrm')).toEqual({ removed: false })
  }, 60_000)

  test('a wrong integrity is refused, and leaves no root and no line', async () => {
    publishCrm('@acme/host-wrong', 'hostwrong')
    const dir = site()
    const result = await installExtension(dir, {
      name: '@acme/host-wrong',
      integrity: 'sha512-not-the-one',
      registry: REGISTRY,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problems.join('\n')).toContain('sha512-not-the-one')
    expect(existsSync(rootOf(dir, 'hostwrong'))).toBe(false)
    expect(readRecord(dir)).toEqual({})
  })

  test('the site’s signature policy applies, unless the host passes its own', async () => {
    publishCrm('@acme/host-unsigned', 'hostunsigned')
    const dir = site()
    Bun.env.CROMBOLO_BUNDLE_SIGNATURES = 'required'
    try {
      const refused = await installExtension(dir, {
        name: '@acme/host-unsigned',
        registry: REGISTRY,
      })
      expect(refused.ok).toBe(false)
      if (!refused.ok)
        expect(refused.problems.join('\n')).toContain('CROMBOLO_BUNDLE_SIGNATURES=required')
      expect(existsSync(rootOf(dir, 'hostunsigned'))).toBe(false)
      const installed = await installExtension(dir, {
        name: '@acme/host-unsigned',
        registry: REGISTRY,
        policy: { signatures: 'optional', sources: [] },
      })
      expect(installed.ok).toBe(true)
      expect(Object.keys(readRecord(dir))).toEqual(['hostunsigned'])
    } finally {
      delete Bun.env.CROMBOLO_BUNDLE_SIGNATURES
    }
  }, 60_000)

  test('a site package and an extension written for an older schema are refused', async () => {
    publish({
      name: '@acme/host-site',
      version: '1.0.0',
      crombolo: { bundleType: 'site', id: 'host-site' },
    } as { name: string; version: string })
    publish({
      name: '@acme/host-old',
      version: '1.0.0',
      peerDependencies: { '@crombolo/crombolo': '*' },
      crombolo: {
        bundleType: 'extension',
        id: 'hostold',
        server: 'hostold',
        schemaVersion: 5,
        permissions: {},
      },
    } as { name: string; version: string })
    const dir = site()
    const sitePackage = await installExtension(dir, { name: '@acme/host-site', registry: REGISTRY })
    expect(sitePackage.ok).toBe(false)
    if (!sitePackage.ok) expect(sitePackage.problems[0]).toContain('is a site package')
    const old = await installExtension(dir, { name: '@acme/host-old', registry: REGISTRY })
    expect(old.ok).toBe(false)
    if (!old.ok) expect(old.problems[0]).toContain('bundle schema 5')
    expect(existsSync(join(dir, 'extensions'))).toBe(false)
    expect(readRecord(dir)).toEqual({})
  })

  test('installs a packed file, kept in the site’s bundles/', async () => {
    const { tarball } = publishCrm('@acme/host-file', 'hostfile')
    const dir = site()
    const file = join(dir, 'host-file.tgz')
    writeFileSync(file, tarball)
    const installed = await installExtension(dir, { name: '@acme/host-file', file })
    if (!installed.ok) throw new Error(installed.problems.join('\n'))
    expect(installed.line).toEqual({
      name: '@acme/host-file',
      version: '1.0.0',
      integrity: integrityOf(tarball),
    })
    expect(existsSync(join(dir, 'bundles', 'acme-host-file-1.0.0.tgz'))).toBe(true)
    expect(recordProblems(dir)).toEqual([])
  }, 60_000)
})
