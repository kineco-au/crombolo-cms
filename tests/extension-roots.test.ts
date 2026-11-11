/**
 * Story 326: an extension installs into a root of its own, `extensions/<id>/`,
 * and the site records it in `crombolo.extensions.json`. Nothing of it is a
 * dependency of the site, a site package carries the record and each root's
 * two files, and one installed as a dependency the old way is named, not run.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createExtensionRegistry,
  discoverBundles,
  grantHashOf,
  INSTALLED_AS_DEPENDENCY,
  packageInRoot,
  readRecord,
  recordExtension,
  recordProblems,
  writeRecord,
} from '@crombolo/backoffice-host'
import { createMarketplace, processReads } from '@crombolo/server'
import { extensionRootFiles, localBundlePath } from '@crombolo/transfer'
import { siteDeclaring } from './support/bundles.ts'
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

const site = (packages: Parameters<typeof siteDeclaring>[1] = {}) => {
  const dir = siteDeclaring('extension-roots', packages)
  dirs.push(dir)
  return dir
}

const SEO = {
  json: {
    crombolo: {
      id: 'acme-seo',
      extensions: [{ type: 'dashboard', alias: 'Acme.Seo', name: 'SEO', element: 'dist/seo.js' }],
    },
  },
  files: { 'dist/seo.js': 'export default class {}\n' },
}

describe('the record', () => {
  test('is written sorted by id, and read back line by line', () => {
    const dir = site()
    writeRecord(dir, {
      zeta: { name: '@acme/zeta', version: '1.0.0' },
      alpha: { name: '@acme/alpha', version: '2.0.0', integrity: 'sha512-x', linked: true },
    })
    const text = readFileSync(join(dir, 'crombolo.extensions.json'), 'utf8')
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zeta'))
    expect(readRecord(dir)).toEqual({
      alpha: { name: '@acme/alpha', version: '2.0.0', integrity: 'sha512-x', linked: true },
      zeta: { name: '@acme/zeta', version: '1.0.0' },
    })
  })

  test('names a root it does not record, and a line with no root', () => {
    const dir = site({ '@acme/seo': SEO })
    expect(recordProblems(dir)).toEqual([])
    mkdirSync(join(dir, 'extensions', 'stray'), { recursive: true })
    recordExtension(dir, 'gone', { name: '@acme/gone', version: '1.0.0' })
    expect(recordProblems(dir)).toEqual([
      expect.stringContaining("extensions/stray/ is an extension's root"),
      expect.stringContaining('names @acme/gone@1.0.0 as "gone", which is not installed'),
    ])
  })

  test('a grant’s hash is the same whatever order it is given in', () => {
    expect(grantHashOf(['content.read', 'http.outbound'], ['https://b', 'https://a'])).toBe(
      grantHashOf(['http.outbound', 'content.read'], ['https://a', 'https://b']),
    )
    expect(grantHashOf(['content.read'])).not.toBe(grantHashOf(['content.write']))
  })
})

describe('discovery', () => {
  test('finds an extension in its root, and the site’s dependencies say nothing of it', () => {
    const dir = site({ '@acme/seo': SEO })
    const json = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(json.dependencies).toEqual({})
    const [found] = discoverBundles(dir).bundles
    expect(found).toMatchObject({
      packageName: '@acme/seo',
      root: join(dir, 'extensions', 'acme-seo'),
      directory: packageInRoot(dir, 'acme-seo', '@acme/seo'),
    })
    expect(found?.dependency).toBeUndefined()
  })

  test('marks an extension installed as a dependency the old way', () => {
    const dir = site()
    const to = join(dir, 'node_modules', '@acme', 'seo')
    mkdirSync(to, { recursive: true })
    writeFileSync(
      join(to, 'package.json'),
      JSON.stringify({
        name: '@acme/seo',
        version: '1.0.0',
        peerDependencies: { '@crombolo/crombolo': '*' },
        crombolo: {
          bundleType: 'extension',
          id: 'acme-seo',
          extensions: [{ type: 'dashboard', alias: 'Acme.Seo', name: 'SEO' }],
        },
      }),
    )
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'a-site', dependencies: { '@acme/seo': '^1.0.0' } }),
    )
    const [found] = discoverBundles(dir).bundles
    expect(found?.dependency).toBe(true)
    expect(found?.root).toBeUndefined()
  })
})

describe('a developer’s link', () => {
  test('a dependency that links to a package on this machine is linked, not the old way', () => {
    const dir = site()
    const real = join(dir, 'elsewhere', 'seo')
    mkdirSync(real, { recursive: true })
    writeFileSync(
      join(real, 'package.json'),
      JSON.stringify({
        name: '@acme/seo',
        version: '1.0.0',
        peerDependencies: { '@crombolo/crombolo': '*' },
        crombolo: {
          bundleType: 'extension',
          id: 'acme-seo',
          extensions: [{ type: 'dashboard', alias: 'Acme.Seo', name: 'SEO' }],
        },
      }),
    )
    mkdirSync(join(dir, 'node_modules', '@acme'), { recursive: true })
    symlinkSync(real, join(dir, 'node_modules', '@acme', 'seo'))
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'a-site', dependencies: { '@acme/seo': 'link:@acme/seo' } }),
    )
    const [found] = discoverBundles(dir).bundles
    expect(found?.linked).toBe(true)
    expect(found?.dependency).toBeUndefined()
  })
})

describe('installing and removing', () => {
  /** A marketplace whose `bun add` lands the package where it is run, as Bun does. */
  const market = (dir: string, calls: string[]) =>
    createMarketplace({
      registry: 'https://registry.example',
      keyword: 'crombolo-extension',
      marketplaceUrl: 'https://www.npmjs.com',
      extensions: createExtensionRegistry(dir, { cache: false }),
      siteDir: dir,
      fetch: (async () =>
        Response.json({
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: '@acme/kit',
              version: '1.0.0',
              peerDependencies: { '@crombolo/crombolo': '*' },
              crombolo: {
                bundleType: 'extension',
                id: 'acme-kit',
                extensions: [{ type: 'dashboard', alias: 'Acme.Kit', name: 'Kit' }],
              },
              dist: { integrity: 'sha512-kit' },
            },
          },
        })) as never,
      verify: async () => ({ state: 'unsigned' as const }),
      install: async (action, specifier, where) => {
        calls.push(`${action} ${specifier} in ${where.slice(dir.length)}`)
        const into = join(where, 'node_modules', '@acme', 'kit')
        mkdirSync(into, { recursive: true })
        writeFileSync(
          join(into, 'package.json'),
          JSON.stringify({
            name: '@acme/kit',
            version: '1.0.0',
            peerDependencies: { '@crombolo/crombolo': '*' },
            crombolo: {
              bundleType: 'extension',
              id: 'acme-kit',
              extensions: [{ type: 'dashboard', alias: 'Acme.Kit', name: 'Kit' }],
            },
          }),
        )
        return { ok: true, output: '' }
      },
    })

  test('installs into its root, records it, and leaves the site’s package.json and bun.lock alone', async () => {
    const dir = site()
    writeFileSync(join(dir, 'bun.lock'), 'the site’s own\n')
    const before = readFileSync(join(dir, 'package.json'), 'utf8')
    const calls: string[] = []
    const outcome = await market(dir, calls).install('@acme/kit', undefined, { isAdmin: true })
    expect(outcome.ok, outcome.message).toBe(true)
    expect(calls).toEqual(['add @acme/kit in /extensions/acme-kit'])
    expect(readRecord(dir)).toEqual({
      'acme-kit': { name: '@acme/kit', version: '1.0.0', integrity: 'sha512-kit' },
    })
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before)
    expect(readFileSync(join(dir, 'bun.lock'), 'utf8')).toBe('the site’s own\n')
    expect(outcome.message).toContain('Commit extensions/acme-kit/ and crombolo.extensions.json')

    const removed = await market(dir, calls).uninstall('@acme/kit')
    expect(removed.ok).toBe(true)
    expect(existsSync(join(dir, 'extensions', 'acme-kit'))).toBe(false)
    expect(readRecord(dir)).toEqual({})
  })
})

describe('what a site package carries', () => {
  test('the record and each root’s package.json and bun.lock, never its node_modules', () => {
    const dir = site({ '@acme/seo': SEO })
    writeFileSync(join(dir, 'extensions', 'acme-seo', 'bun.lock'), '{}\n')
    expect(extensionRootFiles(dir)).toEqual([
      'crombolo.extensions.json',
      'extensions/acme-seo/package.json',
      'extensions/acme-seo/bun.lock',
    ])
  })

  test('a kept file a root names is found from two folders down', () => {
    expect(localBundlePath('file:../../bundles/acme-crm-1.2.0.tgz')).toBe(
      'bundles/acme-crm-1.2.0.tgz',
    )
    expect(localBundlePath('file:../bundles/acme-crm-1.2.0.tgz')).toBeUndefined()
  })
})

describe('its process', () => {
  test('reads its own server half and its build, and none of its root’s other packages', () => {
    const dir = site({ '@acme/seo': SEO })
    const [found] = discoverBundles(dir).bundles
    const reads = processReads(found as never, '/build')
    expect(reads).toEqual([join(found?.directory as string, 'src/server'), '/build'])
    expect(reads.some((path) => path === join(dir, 'extensions', 'acme-seo', 'node_modules'))).toBe(
      false,
    )
  })
})

describe('on a real server', () => {
  test('an extension installed as a dependency is named, and not started', async () => {
    const dir = site()
    const to = join(dir, 'node_modules', '@acme', 'old')
    mkdirSync(join(to, 'src', 'server'), { recursive: true })
    writeFileSync(
      join(to, 'src', 'server', 'index.js'),
      'export const old = () => ({ id: "acme-old", section: "settings", capabilities: [] })\n',
    )
    writeFileSync(
      join(to, 'package.json'),
      JSON.stringify({
        name: '@acme/old',
        version: '1.0.0',
        exports: './src/server/index.js',
        peerDependencies: { '@crombolo/crombolo': '*' },
        crombolo: {
          bundleType: 'extension',
          id: 'acme-old',
          server: 'old',
          schemaVersion: 6,
          permissions: {},
        },
      }),
    )
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'a-site', dependencies: { '@acme/old': '^1.0.0' } }),
    )
    const h = await signedInServer({
      config: {
        siteDir: dir,
        componentsDir: join(dir, 'components'),
        extensions: { 'acme-old': { grant: [] } },
      },
    })
    open.push(h)
    const installed = await h.json<{ items: { id: string; couldNotStart?: string }[] }>(
      `${BACKOFFICE}/crombolo/api/extensions/installed`,
    )
    expect(installed.items.find((item) => item.id === 'acme-old')?.couldNotStart).toBe(
      INSTALLED_AS_DEPENDENCY,
    )
  })
})
