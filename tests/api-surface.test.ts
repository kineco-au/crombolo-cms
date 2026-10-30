/**
 * The supported API (story 173): what `@crombolo/crombolo`'s entry points
 * export, held to a committed snapshot; who may import what; and an outside
 * consumer that uses nothing else. `docs/api.md`.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { currentSurface, SNAPSHOT, type Surface, UMBRELLA } from '../scripts/api-surface.ts'
import { ROOT } from '../scripts/packages.ts'
import { GREETINGS_ID, greetings } from './fixtures/consumers/bundle.ts'
import config from './fixtures/consumers/crombolo.config.ts'
import { hostConfig, vet } from './fixtures/consumers/host.ts'
import { siteDeclaring } from './support/bundles.ts'
import { BACKOFFICE, type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
afterAll(async () => {
  for (const h of open) await h.db.close()
})

const snapshot = () => JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Surface
const bare = (name: string) => name.replace(/^type /, '')

describe('the supported surface', () => {
  test('is what the snapshot says, with no wildcard exports', () => {
    const { surface, problems } = currentSurface()
    expect(problems).toEqual([])
    // A deliberate change runs `bun run api:snapshot` and commits the result.
    expect(surface).toEqual(snapshot())
  })

  test('is exposed through the agreed entry points and no others', () => {
    const manifest = JSON.parse(readFileSync(join(UMBRELLA, 'package.json'), 'utf8')) as {
      exports: Record<string, string>
    }
    expect(Object.keys(manifest.exports).sort()).toEqual(
      [
        '.',
        './bundle',
        './host',
        './branding',
        './navigation',
        './headers',
        './server',
        './middleware',
        './routes',
        './islands-react',
        './jsx-runtime',
        './jsx-dev-runtime',
        './loose/jsx-runtime',
        './loose/jsx-dev-runtime',
      ].sort(),
    )
  })

  test('keeps every deprecated root name working, and offers it where it moved', async () => {
    const surface = snapshot()
    const root = surface['@crombolo/crombolo']
    const moved = new Set(
      [
        ...(surface['@crombolo/crombolo/bundle']?.names ?? []),
        ...(surface['@crombolo/crombolo/host']?.names ?? []),
      ].map(bare),
    )
    const module = (await import('@crombolo/crombolo')) as Record<string, unknown>
    const values = new Set((root?.names ?? []).filter((n) => !n.startsWith('type ')))
    for (const name of root?.deprecated ?? []) {
      expect(moved.has(name), name).toBe(true)
      if (values.has(name)) expect(module[name], name).toBeDefined()
    }
  })

  test('each entry point resolves, with the values the snapshot names', async () => {
    for (const [entry, { names }] of Object.entries(snapshot())) {
      const module = (await import(entry)) as Record<string, unknown>
      for (const name of names.filter((n) => !n.startsWith('type ')))
        expect(module[name], `${entry} ${name}`).toBeDefined()
    }
  })
})

/** Supported entry points, and the bundle packages a site wires. */
const ALLOWED = new Set([
  '@crombolo/crombolo',
  '@crombolo/crombolo/bundle',
  '@crombolo/crombolo/host',
  '@crombolo/crombolo/branding',
  '@crombolo/crombolo/navigation',
  '@crombolo/crombolo/headers',
  '@crombolo/crombolo/server',
  '@crombolo/crombolo/middleware',
  '@crombolo/crombolo/routes',
  '@crombolo/crombolo/islands-react',
  '@crombolo/common',
  '@crombolo/crombolo/jsx-runtime',
  '@crombolo/crombolo/jsx-dev-runtime',
  '@crombolo/simple-redirects',
  '@crombolo/entra',
  // Supported in their own right (docs/api.md), for a site's Next.js front end.
  '@crombolo/delivery-client',
  '@crombolo/next-integration',
  '@crombolo/next-integration/cache-15',
  '@crombolo/next-integration/cache-16',
  '@crombolo/next-integration/client',
  '@crombolo/next-integration/components',
  '@crombolo/next-integration/image-loader',
  '@crombolo/next-integration/middleware',
  '@crombolo/next-integration/route-handlers',
])

/** The code held to the boundary: first-party bundles, the sites, and the outside consumer. */
const BOUNDED = ['packages/simple-redirects', 'packages/entra', 'sites', 'tests/fixtures/consumers']

const SKIPPED = new Set(['node_modules', '.crombolo', 'output', 'logs', 'media', 'seed'])

/** Source files under the bounded folders, never descending into installs, caches or output. */
function boundedFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!SKIPPED.has(entry.name)) walk(path)
      } else if (/\.(ts|tsx|js)$/.test(entry.name)) found.push(relative(ROOT, path))
    }
  }
  for (const dir of BOUNDED) walk(join(ROOT, dir))
  return found
}

describe('the import boundary', () => {
  test('first-party bundles, sites and the outside consumer import only supported entry points', () => {
    const files = boundedFiles()
    // It looked where it should, rather than passing on an empty list.
    for (const expected of [
      'packages/simple-redirects/src/index.ts',
      'packages/entra/src/index.ts',
      'sites/starter/server.ts',
      'tests/fixtures/consumers/bundle.ts',
    ])
      expect(files).toContain(expected)
    const crossings: string[] = []
    for (const path of files) {
      const source = readFileSync(join(ROOT, path), 'utf8')
      for (const [, specifier] of source.matchAll(/from\s+['"](@crombolo\/[^'"]+)['"]/g))
        if (!ALLOWED.has(specifier as string)) crossings.push(`${path}: ${specifier}`)
    }
    expect(crossings).toEqual([])
  })

  test('first-party bundles declare no internal package as a dependency', () => {
    for (const pkg of ['simple-redirects', 'entra']) {
      const json = JSON.parse(
        readFileSync(join(ROOT, 'packages', pkg, 'package.json'), 'utf8'),
      ) as { dependencies?: Record<string, string> }
      const internal = Object.keys(json.dependencies ?? {}).filter((name) =>
        name.startsWith('@crombolo/'),
      )
      expect([pkg, internal]).toEqual([pkg, []])
    }
  })
})

describe('an outside consumer', () => {
  test('boots a site with its own bundle wired, through supported entry points only', async () => {
    const dir = siteDeclaring('api-consumer', {
      'greetings-bundle': {
        json: {
          crombolo: { id: GREETINGS_ID, server: 'greetings', schemaVersion: 3, permissions: [] },
        },
      },
    })
    expect(config.bundles?.map((b) => b.id)).toEqual([GREETINGS_ID])
    const h = await signedInServer({
      config: { siteDir: dir, componentsDir: join(dir, 'components'), bundles: [greetings()] },
    })
    open.push(h)
    const response = await h.call(`${BACKOFFICE}/crombolo/api/bundle/${GREETINGS_ID}/hello`)
    expect(response.status).toBe(200)
    expect(((await response.json()) as { hello: string }).hello).toBeTruthy()
  })

  test('a host builds a config and vets a package with the CMS’s own rules', () => {
    const dir = siteDeclaring('api-host', {})
    expect(hostConfig({ siteName: 'Hosted' }, dir).siteName).toBe('Hosted')
    expect(relative(ROOT, dir).startsWith('output')).toBe(true)
    const valid = {
      name: '@acme/greetings',
      version: '1.0.0',
      peerDependencies: { '@crombolo/crombolo': '>=0.1.0' },
      crombolo: { id: 'greetings', server: 'greetings', schemaVersion: 3, permissions: [] },
    }
    expect(vet(valid)).toEqual([])
    expect(vet({ ...valid, peerDependencies: { '@crombolo/crombolo': '<0.1.0' } })[0]).toContain(
      'is written for',
    )
  })
})
