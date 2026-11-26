/**
 * Backoffice extensions as npm dependencies, which replaced `App_Plugins`.
 * docs/bundles.md.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectManifests,
  createBackOfficePaths,
  createExtensionRegistry,
  discoverExtensions,
  EXTENSION_KEYWORD,
  resolvePackageDir,
  resolveStaticFile,
} from '@crombolo/backoffice-host'
import { VERSION, warnAboutAppPlugins } from '@crombolo/server'
import { linkedDependencies, moveIntoRoot, toCurrentLayout } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

const dirs: string[] = []
const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

interface FixturePackage {
  /** What goes in the dependency's own package.json. */
  json: Record<string, unknown>
  /** Files to write inside the package, by relative path. */
  files?: Record<string, string>
}

/**
 * A site directory with a package.json and a node_modules holding the fixtures.
 *
 * Under `output/` rather than the system temp directory: a site's views cache
 * has to resolve `@crombolo/crombolo/jsx-runtime` by walking up to a `node_modules` that
 * carries it, which nothing outside the repository tree can do.
 */
function siteWith(
  dependencies: Record<string, FixturePackage>,
  options: { declared?: string[] } = {},
): string {
  const parent = join(import.meta.dir, '..', 'output')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'extension-site-'))
  dirs.push(root)
  // Its own empty views tree. Nothing here renders a page, and the suite's
  // shared `output/test-views` is written to by other files as they run — so
  // snapshotting it would put these fixtures in the way of tests that do render.
  mkdirSync(join(root, 'components'), { recursive: true })
  const declared = options.declared ?? Object.keys(dependencies)
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'a-site',
      dependencies: Object.fromEntries(declared.map((name) => [name, '^1.0.0'])),
    }),
  )
  for (const [name, fixture] of Object.entries(dependencies)) {
    const dir = join(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    const json: Record<string, unknown> = {
      name,
      version: '1.2.3',
      peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
      ...fixture.json,
    }
    // An extension unless it says otherwise, as every bundle must (story 306).
    const field = json.crombolo as Record<string, unknown> | undefined
    if (field && typeof field === 'object' && !('bundleType' in field))
      json.crombolo = { bundleType: 'extension', ...field }
    writeFileSync(join(dir, 'package.json'), JSON.stringify(json))
    for (const [path, content] of Object.entries(fixture.files ?? {})) {
      const file = join(dir, path)
      mkdirSync(join(file, '..'), { recursive: true })
      writeFileSync(file, content)
    }
    toCurrentLayout(dir)
  }
  return root
}

const extension = (over: Record<string, unknown> = {}) => ({
  crombolo: {
    bundleType: 'extension',
    id: 'acme-seo',
    extensions: [
      { type: 'headerApp', alias: 'Acme.HeaderApp.Seo', name: 'SEO', meta: { label: 'SEO' } },
    ],
    ...over,
  },
})

describe('discovery', () => {
  test('finds a dependency that declares extensions', () => {
    const root = siteWith({ '@acme/seo': { json: extension() } })
    const found = discoverExtensions(root)
    expect(found).toHaveLength(1)
    expect(found[0]?.packageName).toBe('@acme/seo')
    expect(found[0]?.version).toBe('1.2.3')
    expect(found[0]?.manifest.id).toBe('acme-seo')
  })

  test('ignores a dependency that declares nothing', () => {
    const root = siteWith({ lodash: { json: {} }, '@acme/seo': { json: extension() } })
    expect(discoverExtensions(root).map((e) => e.packageName)).toEqual(['@acme/seo'])
  })

  test('ignores an empty extensions array, which declares nothing either', () => {
    const root = siteWith({ '@acme/seo': { json: { crombolo: { extensions: [] } } } })
    expect(discoverExtensions(root)).toEqual([])
  })

  /**
   * The point of reading `dependencies` rather than walking `node_modules`: a
   * package someone else depends on cannot put a dashboard in this backoffice.
   */
  test('ignores an installed package the site does not declare', () => {
    const root = siteWith(
      {
        '@acme/seo': { json: extension() },
        '@other/sneaky': { json: extension({ id: 'sneaky' }) },
      },
      { declared: ['@acme/seo'] },
    )
    expect(discoverExtensions(root).map((e) => e.packageName)).toEqual(['@acme/seo'])
  })

  test('a site with no package.json has no extensions, and does not throw', () => {
    const root = mkdtempSync(join(tmpdir(), 'crombolo-bare-'))
    dirs.push(root)
    expect(discoverExtensions(root)).toEqual([])
  })

  test('a site whose dependency is not installed has no extensions', () => {
    const root = siteWith({}, { declared: ['@acme/never-installed'] })
    expect(discoverExtensions(root)).toEqual([])
  })

  test('a malformed package.json is ignored rather than fatal', () => {
    const root = siteWith({ '@acme/seo': { json: extension() } })
    writeFileSync(join(root, 'node_modules', '@acme/seo', 'package.json'), '{ not json')
    expect(discoverExtensions(root)).toEqual([])
  })

  test('resolves a dependency hoisted to a parent node_modules', () => {
    const root = siteWith({ '@acme/seo': { json: extension() } })
    const nested = join(root, 'apps', 'site')
    mkdirSync(nested, { recursive: true })
    writeFileSync(
      join(nested, 'package.json'),
      JSON.stringify({ name: 'nested', dependencies: { '@acme/seo': '^1.0.0' } }),
    )
    expect(discoverExtensions(nested).map((e) => e.packageName)).toEqual(['@acme/seo'])
  })

  test('refuses a dependency name that tries to climb out of node_modules', () => {
    const root = siteWith({ '@acme/seo': { json: extension() } })
    expect(resolvePackageDir(root, '../../etc')).toBeUndefined()
    expect(resolvePackageDir(root, '/etc/passwd')).toBeUndefined()
  })
})

describe('an extension’s entries', () => {
  test('each names the bundle it came from, for Settings to group by', () => {
    const root = siteWith({
      tool: {
        json: {
          crombolo: {
            id: 'tool',
            name: 'Acme tools',
            extensions: [{ type: 'dashboard', alias: 'Tool.Dashboard', meta: {} }],
          },
        },
      },
    })
    const first = discoverExtensions(root)[0]?.manifest.extensions[0] as Record<string, unknown>
    expect(first.cromboloBundle).toEqual({ name: 'Acme tools', packageName: 'tool' })
  })

  test('none of its files is served, and App_Plugins is gone (story 431)', () => {
    const paths = createBackOfficePaths()
    expect(resolveStaticFile(paths, '/bundles/@acme/seo/dist/seo.js')).toBeUndefined()
    expect(resolveStaticFile(paths, '/App_Plugins/@acme/seo/dist/seo.js')).toBeUndefined()
  })
})

describe('the registry', () => {
  test('memoizes, and a new install is seen after invalidate', () => {
    const root = siteWith({ '@acme/seo': { json: extension() } })
    const registry = createExtensionRegistry(root)
    expect(registry.list()).toHaveLength(1)

    const added = join(root, 'node_modules', 'later')
    mkdirSync(added, { recursive: true })
    writeFileSync(
      join(added, 'package.json'),
      JSON.stringify({
        name: 'later',
        version: '2.0.0',
        peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
        ...extension({ id: 'later' }),
      }),
    )
    toCurrentLayout(added)
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'a-site', dependencies: { '@acme/seo': '^1', later: '^2' } }),
    )
    expect(registry.list()).toHaveLength(1)
    registry.invalidate()
    expect(registry.list()).toHaveLength(2)
  })

  test('reads the disk every time when caching is off, which development needs', () => {
    const root = siteWith({ '@acme/seo': { json: extension() } })
    const registry = createExtensionRegistry(root, { cache: false })
    expect(registry.list()).toHaveLength(1)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'a-site', dependencies: {} }))
    expect(registry.list()).toHaveLength(0)
  })
})

describe('manifests', () => {
  test('an installed extension joins the framework manifests', () => {
    const root = siteWith({ '@acme/seo': { json: extension() } })
    const set = collectManifests(createBackOfficePaths(), discoverExtensions(root))
    expect(set.all.some((manifest) => manifest.id === 'acme-seo')).toBe(true)
    // And the framework's own is still there.
    expect(set.all.some((manifest) => manifest.id === 'Crombolo.Core')).toBe(true)
  })

  test('the keyword packages publish is the one the docs name', () => {
    expect(EXTENSION_KEYWORD).toBe('crombolo-extension')
  })
})

describe('over HTTP', () => {
  test('the manifest endpoint carries an installed extension once granted', async () => {
    const root = siteWith({
      '@acme/seo': {
        json: extension({ schemaVersion: 6, permissions: { 'content.read': 'Reads pages' } }),
      },
    })
    // Into a root of its own (story 326), linked, as one built here is.
    moveIntoRoot(root, '@acme/seo')
    linkedDependencies(root)
    const h = await signedInServer({
      config: { siteDir: root, componentsDir: join(root, 'components') },
    })
    open.push(h)
    const listed = async () =>
      (await h.json<Array<{ id?: string | null }>>(`${V1}/manifest/manifest`)).some(
        (manifest) => manifest.id === 'acme-seo',
      )
    // It shows once granted (story 309).
    expect(await listed()).toBe(false)
    expect(
      (
        await h.post(`${BACKOFFICE}/crombolo/api/bundles/grant`, {
          id: 'acme-seo',
          grant: ['content.read'],
        })
      ).status,
    ).toBe(200)
    expect(await listed()).toBe(true)
    expect((await h.call('/bundles/@acme/seo/package.json')).status).toBe(404)
  })
})

describe('the App_Plugins notice', () => {
  const log = () => {
    const warnings: Array<{ message: string; properties?: Record<string, unknown> }> = []
    return {
      warnings,
      warning: (message: string, properties?: Record<string, unknown>) =>
        warnings.push({ message, properties }),
    }
  }

  test('warns when a site still has files in App_Plugins', () => {
    const root = siteWith({})
    mkdirSync(join(root, 'App_Plugins', 'old-package'), { recursive: true })
    writeFileSync(join(root, 'App_Plugins', 'old-package', 'umbraco-package.json'), '{}')
    const sink = log()
    warnAboutAppPlugins(root, sink)
    expect(sink.warnings).toHaveLength(1)
    expect(sink.warnings[0]?.message).toContain('no longer read')
    expect(sink.warnings[0]?.properties?.count).toBe(1)
  })

  test('says nothing when the directory is absent or empty', () => {
    const root = siteWith({})
    const absent = log()
    warnAboutAppPlugins(root, absent)
    expect(absent.warnings).toEqual([])

    mkdirSync(join(root, 'App_Plugins'), { recursive: true })
    writeFileSync(join(root, 'App_Plugins', '.gitkeep'), '')
    const empty = log()
    warnAboutAppPlugins(root, empty)
    expect(empty.warnings).toEqual([])
  })
})
