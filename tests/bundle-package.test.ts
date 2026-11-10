/**
 * A bundle is an npm package: the `crombolo` field of its `package.json` is the
 * manifest, read and validated in one place. docs/bundles.md, story 063.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CORE_PACKAGE,
  declaresBundle,
  describePermissions,
  discoverBundles,
  type PackageJson,
  peerRangeProblem,
  readBundlePackage,
  validateBundlePackage,
} from '@crombolo/backoffice-host'
import { VERSION } from '@crombolo/server'
import { bundlePeerRange } from '@crombolo/transfer'
import { siteDeclaring, stubBundlePackage } from './support/bundles.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const valid = (over: Record<string, unknown> = {}, crombolo: Record<string, unknown> = {}) =>
  ({
    name: '@acme/tasks',
    version: '1.0.0',
    peerDependencies: { [CORE_PACKAGE]: `^${VERSION}` },
    crombolo: {
      bundleType: 'extension',
      id: 'acme-tasks',
      name: 'Tasks',
      server: 'tasks',
      schemaVersion: 5,
      permissions: {},
      ...crombolo,
    },
    ...over,
  }) as PackageJson

const problemsOf = (json: PackageJson, directory?: string) =>
  validateBundlePackage(json, directory).join('\n')

describe('the manifest', () => {
  test('accepts a bundle that declares a server half', () => {
    expect(validateBundlePackage(valid())).toEqual([])
  })

  test('requires an id that is a route segment', () => {
    for (const id of [undefined, 'Acme.Tasks', 'a', '../x', 'acme_tasks', 'x'.repeat(40)])
      expect(problemsOf(valid({}, { id })), String(id)).toContain('"crombolo.id"')
  })

  test('requires a package name and version', () => {
    expect(problemsOf(valid({ name: undefined }))).toContain('no "name"')
    expect(problemsOf(valid({ version: undefined }))).toContain('no "version"')
  })

  test('requires a peer range on core', () => {
    expect(problemsOf(valid({ peerDependencies: undefined }))).toContain(
      `peerDependencies["${CORE_PACKAGE}"]`,
    )
  })

  test('refuses a bundle that declares nothing to do', () => {
    const json = valid({}, { server: undefined, extensions: [] })
    expect(problemsOf(json)).toContain('a bundle that does nothing')
  })

  test('refuses a server half that is not an export name', () => {
    expect(problemsOf(valid({}, { server: './src/index.ts' }))).toContain('"crombolo.server"')
  })

  test('refuses content that names a folder: the old layout, to be rebuilt', () => {
    for (const content of ['content', '../elsewhere'])
      expect(problemsOf(valid({}, { content })), content).toContain(
        'written before crombolo 0.33.1, with its content in a folder',
      )
    expect(problemsOf(valid({}, { content: false }))).toContain('"crombolo.content" is true')
  })

  test('refuses content that holds no payload', () => {
    const root = siteDeclaring('bundle-package', {
      '@acme/tasks': { json: valid({}, { content: true }) },
    })
    dirs.push(root)
    const dir = join(root, 'node_modules', '@acme/tasks')
    expect(problemsOf(valid({}, { content: true }), dir)).toContain(
      'holds no bundle.json at its root',
    )
  })

  test('reports every problem at once', () => {
    const json = valid({ version: undefined, peerDependencies: undefined }, { id: 'X' })
    expect(validateBundlePackage(json)).toHaveLength(3)
  })

  test('core itself is never a bundle, though it carries a crombolo field', () => {
    expect(declaresBundle({ name: CORE_PACKAGE, crombolo: { migrations: 'compatible' } })).toBe(
      false,
    )
    expect(declaresBundle(valid())).toBe(true)
    expect(declaresBundle({ name: 'lodash' })).toBe(false)
  })
})

describe('reading one', () => {
  test('a package with content carries it, with its manifest at the root', () => {
    const root = siteDeclaring('bundle-package', {
      '@acme/tasks': {
        json: valid({}, { content: true, server: undefined }),
        files: { 'bundle.json': '{}' },
      },
    })
    dirs.push(root)
    const { bundle, problems } = readBundlePackage(join(root, 'node_modules', '@acme/tasks'))
    expect(problems).toEqual([])
    expect(bundle?.carries).toEqual({ extensions: false, content: true, server: false })
    expect(bundle?.contentDir).toBe(join(root, 'node_modules', '@acme/tasks'))
    expect(bundle?.name).toBe('Tasks')
  })

  test('discovery reports a malformed bundle by package, and keeps the rest', () => {
    const root = siteDeclaring('bundle-package', {
      '@acme/tasks': { json: valid() },
      '@acme/broken': { json: valid({ name: '@acme/broken' }, { id: 'Broken' }) },
      lodash: { json: { name: 'lodash' } },
    })
    dirs.push(root)
    const found = discoverBundles(root)
    expect(found.bundles.map((bundle) => bundle.packageName)).toEqual(['@acme/tasks'])
    expect(found.problems.map((problem) => problem.packageName)).toEqual(['@acme/broken'])
  })
})

describe('the peer range', () => {
  test('admits the running release when it should', () => {
    expect(peerRangeProblem(stubBundlePackage('tasks'), VERSION)).toBeUndefined()
  })

  test('names the bundle, its range and the running version when it does not', () => {
    const problem = peerRangeProblem(stubBundlePackage('tasks', { peerRange: '^0.1.0' }), VERSION)
    expect(problem).toContain('@acme/tasks')
    expect(problem).toContain('^0.1.0')
    expect(problem).toContain(VERSION)
  })

  test('a bundle crombolo writes installs on its release and every later one, never an earlier', () => {
    // An environment exported at 0.12.1 reaches a production one minor ahead.
    const exported = stubBundlePackage('export', { peerRange: bundlePeerRange('0.12.1') })
    expect(exported.peerRange).toBe('>=0.12.1')
    for (const later of ['0.12.1', '0.12.9', '0.13.0', '1.2.0'])
      expect(peerRangeProblem(exported, later), later).toBeUndefined()
    expect(peerRangeProblem(exported, '0.12.0')).toContain('>=0.12.1')
  })

  test('refuses a range that is not one', () => {
    expect(
      peerRangeProblem(stubBundlePackage('tasks', { peerRange: 'not a range' }), VERSION),
    ).toBeDefined()
  })
})

/** A package directory under `output/` holding these files, for the checks that read it. */
function packageAt(json: PackageJson, files: Record<string, string>): string {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'output', 'bundle-layout-'))
  dirs.push(dir)
  for (const [path, text] of Object.entries({ 'package.json': JSON.stringify(json), ...files })) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

describe('the layout (story 320)', () => {
  const screen = { type: 'dashboard', alias: 'Acme.D', name: 'D', element: 'src/backoffice/d.ts' }
  const withScreen = (permissions: Record<string, string>, extra: Record<string, unknown> = {}) =>
    valid(
      { exports: { '.': './src/server/index.ts' } },
      { extensions: [screen], permissions, ...extra },
    )

  test('takes server code under src/server and back-office code under src/backoffice', () => {
    const json = withScreen({ 'backoffice.code': 'Shows its dashboard' })
    const dir = packageAt(json, {
      'src/server/index.ts': 'export const tasks = () => ({})',
      'src/backoffice/d.ts': 'export default class {}',
    })
    expect(validateBundlePackage(json, dir)).toEqual([])
  })

  test('refuses back-office code that does not ask for backoffice.code, and the ask without the code', () => {
    expect(problemsOf(withScreen({}))).toContain('does not ask for "backoffice.code"')
    expect(
      problemsOf(valid({}, { permissions: { 'backoffice.code': 'Shows nothing' } })),
    ).toContain('has no back-office code')
  })

  test('refuses a module outside src/backoffice, or one that is not a file in the package', () => {
    const at = (element: string) =>
      problemsOf(
        valid(
          {},
          {
            extensions: [{ ...screen, element }],
            permissions: { 'backoffice.code': 'Shows its dashboard' },
          },
        ),
      )
    expect(at('plugin/d.js')).toContain('under src/backoffice/')
    expect(at('/umbraco/elsewhere.js')).toContain('not a file under src/backoffice/')
    expect(at('https://cdn.example.com/d.js')).toContain('not a file under src/backoffice/')
    expect(at('src/backoffice/../server/index.ts')).toContain('not a file under src/backoffice/')
  })

  test('refuses an export outside src/server, and the layout before schema 5', () => {
    expect(problemsOf(valid({ exports: { '.': './src/index.ts' } }))).toContain(
      'must be under src/server/, not src/index.ts',
    )
    const dir = packageAt(valid(), { 'plugin/d.js': '', 'src/helpers/x.ts': '' })
    expect(problemsOf(valid(), dir)).toContain('it holds plugin/')
    expect(problemsOf(valid(), dir)).toContain('it holds src/helpers')
  })

  test('refuses schema 4, naming the command that moves it', () => {
    const problems = problemsOf(valid({}, { schemaVersion: 4 }))
    expect(problems).toContain('bundle schema 4')
    expect(problems).toContain('crombolo extension migrate')
  })

  test('says what backoffice.code grants, with its warning', () => {
    const [described] = describePermissions([
      { permission: 'backoffice.code', reason: 'Shows its dashboard' },
    ])
    expect(described?.allows).toBe('Runs in your back office as each person using it')
    expect(described?.warning).toContain("Don't install this from a publisher you don't trust")
  })
})
