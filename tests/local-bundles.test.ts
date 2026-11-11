/**
 * Story 245: a bundle installed from a file is kept in the site's bundles/, as
 * `bundles/<name>-<version>.tgz`, installed from there, removed with the last
 * thing that names it, and carried in a site bundle with the lockfile.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createExtensionRegistry } from '@crombolo/backoffice-host'
import {
  buildBundleFromDirectory,
  createMarketplace,
  type PackageInstaller,
  VERSION,
  writeNpmTarball,
} from '@crombolo/server'
import { localBundlePath, selectCodeFiles } from '@crombolo/transfer'
import { scaffoldFiles } from '../packages/cli/src/templates.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const temp = (name: string) => {
  const dir = mkdtempSync(join(process.cwd(), 'output', `${name}-`))
  dirs.push(dir)
  return dir
}

const manifest = (version: string, extra = '') => ({
  name: '@acme/crm',
  version,
  description: `the CRM${extra}`,
  peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
  crombolo: {
    bundleType: 'extension',
    id: 'acme-crm',
    // A menu entry that runs no code, so it asks for nothing (story 320).
    extensions: [{ type: 'menuItem', alias: 'acme.crm', name: 'CRM', meta: { label: 'CRM' } }],
  },
})

/** A packed bundle somewhere outside the site, as a download would be. */
function packed(version = '1.2.0', extra = ''): string {
  const file = join(temp('download'), `acme-crm-${version}.tgz`)
  writeFileSync(
    file,
    writeNpmTarball([
      {
        path: 'package.json',
        bytes: new TextEncoder().encode(JSON.stringify(manifest(version, extra))),
      },
      { path: 'd.js', bytes: new TextEncoder().encode('export default 1\n') },
    ]),
  )
  return file
}

/** A site, and a marketplace whose installer does what `bun add` and `bun remove` would. */
function siteWith(dependencies: Record<string, string> = {}) {
  const root = temp('local-bundles-site')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'a-site', dependencies }))
  const calls: string[] = []
  // What `bun add` and `bun remove` do in the folder they run in: the site's, or an extension's root.
  const install: PackageInstaller = async (action, specifier, where) => {
    calls.push(`${action} ${specifier}`)
    const json = JSON.parse(readFileSync(join(where, 'package.json'), 'utf8'))
    json.dependencies ??= {}
    if (action === 'add') {
      const version = /-(\d+\.\d+\.\d+)\.tgz$/.exec(specifier)?.[1] ?? '1.2.0'
      json.dependencies['@acme/crm'] = specifier
      const dir = join(where, 'node_modules', '@acme', 'crm')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest(version)))
    } else {
      delete json.dependencies[specifier]
      rmSync(join(where, 'node_modules', '@acme', 'crm'), { recursive: true, force: true })
    }
    writeFileSync(join(where, 'package.json'), JSON.stringify(json))
    return { ok: true, output: '' }
  }
  const extensions = createExtensionRegistry(root, { cache: false })
  const market = createMarketplace({
    registry: 'https://registry.example',
    keyword: 'crombolo-bundle',
    marketplaceUrl: 'https://www.npmjs.com',
    extensions,
    siteDir: root,
    install,
    fetch: (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch,
  })
  return { root, market, calls }
}

const kept = (root: string, version = '1.2.0') => join(root, 'bundles', `acme-crm-${version}.tgz`)

describe('a bundle installed from a file', () => {
  test('is copied into bundles/ and installed from there, to commit', async () => {
    const { root, market, calls } = siteWith()
    const file = packed()
    const outcome = await market.installFile(file)
    expect(outcome.ok, outcome.message).toBe(true)
    expect(outcome.file).toBe('bundles/acme-crm-1.2.0.tgz')
    expect(outcome.message).toContain('Commit bundles/acme-crm-1.2.0.tgz')
    expect(readFileSync(kept(root)).equals(readFileSync(file))).toBe(true)
    expect(calls).toEqual(['add file:../../bundles/acme-crm-1.2.0.tgz'])
  })

  test('already in bundles/, or the same bytes again, is used as it is', async () => {
    const { root, market, calls } = siteWith()
    const file = packed()
    expect((await market.installFile(file)).ok).toBe(true)
    expect((await market.installFile(file)).ok).toBe(true)
    expect((await market.installFile(kept(root))).ok).toBe(true)
    expect(calls).toEqual(Array(3).fill('add file:../../bundles/acme-crm-1.2.0.tgz'))
  })

  test('another file of the same version is refused, and nothing is installed', async () => {
    const { root, market, calls } = siteWith()
    await market.installFile(packed())
    const before = readFileSync(kept(root))
    const outcome = await market.installFile(packed('1.2.0', ', changed'))
    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('one version is one file')
    expect(readFileSync(kept(root)).equals(before)).toBe(true)
    expect(calls).toHaveLength(1)
  })

  test('a refused install leaves no copy behind', async () => {
    const { root } = siteWith()
    const file = packed()
    const failing = createMarketplace({
      registry: 'https://registry.example',
      keyword: 'crombolo-bundle',
      marketplaceUrl: 'https://www.npmjs.com',
      extensions: createExtensionRegistry(root, { cache: false }),
      siteDir: root,
      install: async () => ({ ok: false, output: 'bun add failed' }),
    })
    expect((await failing.installFile(file)).ok).toBe(false)
    expect(existsSync(kept(root))).toBe(false)
  })

  test('a new version replaces the old file, and an uninstall removes it', async () => {
    const { root, market } = siteWith()
    await market.installFile(packed('1.2.0'))
    expect((await market.installFile(packed('1.3.0'))).ok).toBe(true)
    expect(existsSync(kept(root, '1.2.0'))).toBe(false)
    expect(existsSync(kept(root, '1.3.0'))).toBe(true)
    expect((await market.uninstall('@acme/crm')).ok).toBe(true)
    expect(existsSync(kept(root, '1.3.0'))).toBe(false)
  })

  test('a file another dependency still names is kept', async () => {
    const { root, market } = siteWith({ '@acme/crm-alias': './bundles/acme-crm-1.2.0.tgz' })
    await market.installFile(packed('1.2.0'))
    await market.installFile(packed('1.3.0'))
    expect(existsSync(kept(root, '1.2.0'))).toBe(true)
  })
})

describe('a site bundle', () => {
  const lock = '{\n  "lockfileVersion": 1,\n  "workspaces": { "": { "name": "a-site" } }\n}\n'
  const siteNaming = (present: boolean) => {
    const root = temp('local-bundles-build')
    mkdirSync(join(root, 'schema'), { recursive: true })
    writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'a-site',
        dependencies: { '@acme/crm': './bundles/acme-crm-1.2.0.tgz' },
      }),
    )
    writeFileSync(join(root, 'bun.lock'), lock)
    if (present) {
      mkdirSync(join(root, 'bundles'), { recursive: true })
      writeFileSync(kept(root), readFileSync(packed()))
    }
    return root
  }

  test('carries the bundles/ file its package.json names, with the lockfile', async () => {
    const built = await buildBundleFromDirectory(siteNaming(true))
    expect(built.problems).toEqual([])
    expect(built.code).toContain('bundles/acme-crm-1.2.0.tgz')
  })

  test('naming a file that is not there is a problem', () => {
    expect(selectCodeFiles(siteNaming(false), []).problems).toContain(
      'package.json names bundles/acme-crm-1.2.0.tgz, which is not in the site',
    )
  })

  test('either way of writing the range is read', () => {
    expect(localBundlePath('./bundles/a-1.0.0.tgz')).toBe('bundles/a-1.0.0.tgz')
    expect(localBundlePath('file:bundles/a-1.0.0.tgz')).toBe('bundles/a-1.0.0.tgz')
    expect(localBundlePath('../elsewhere/a.tgz')).toBeUndefined()
    expect(localBundlePath('^1.0.0')).toBeUndefined()
  })
})

describe('a scaffolded site', () => {
  test('commits bundles/: its .gitignore ignores neither the folder nor a .tgz', () => {
    const files = scaffoldFiles({ siteName: 'A site' })
    const ignore = files.find((file) => file.path === '.gitignore')?.text ?? ''
    const lines = ignore.split('\n')
    expect(lines.some((line) => /bundles|\.tgz/.test(line))).toBe(false)
  })
})
