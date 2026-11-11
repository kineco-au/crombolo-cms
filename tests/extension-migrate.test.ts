/**
 * Story 320: `crombolo extension migrate` rewrites a schema 4 extension to
 * schema 5's layout: its server code under `src/server/`, its back-office code
 * under `src/backoffice/`, its manifest and exports following, and
 * `backoffice.code` asked for with the reason given.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readPackageJson, validateBundlePackage } from '@crombolo/backoffice-host'
import { VERSION } from '@crombolo/server'
import { applyMigration, planMigration } from '../packages/cli/src/support/extension-migrate.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

/** A schema 4 extension as it was written before 0.59.0. */
function schema4(
  crombolo: Record<string, unknown>,
  files: Record<string, string>,
  over: Record<string, unknown> = {},
): string {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'output', 'extension-migrate-'))
  dirs.push(dir)
  const json = {
    name: '@acme/seo',
    version: '1.0.0',
    files: ['plugin', 'src', 'NOTICE'],
    peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
    crombolo: { bundleType: 'extension', id: 'acme-seo', schemaVersion: 4, ...crombolo },
    ...over,
  }
  for (const [path, text] of Object.entries({ 'package.json': JSON.stringify(json), ...files })) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const SCREEN = { type: 'dashboard', alias: 'Acme.Seo', name: 'SEO', element: 'plugin/seo.js' }

describe('extension migrate', () => {
  test('moves both halves, rewrites the manifest and an import that leaves its folder', () => {
    const dir = schema4(
      { server: 'seo', permissions: { 'content.read': 'Reads pages' }, extensions: [SCREEN] },
      {
        'src/index.ts':
          "import manifest from '../package.json' with { type: 'json' }\nimport { words } from './words.ts'\nexport const seo = () => ({ manifest, words })\n",
        'src/words.ts': "export const words = 'hi'\n",
        'plugin/seo.js':
          "import { call } from './client.js'\nexport default class extends HTMLElement {}\n",
        'plugin/client.js': 'export const call = () => {}\n',
      },
      { exports: { '.': './src/index.ts' } },
    )
    const plan = planMigration(dir, { reason: 'Shows the SEO report' })
    expect(plan.problems).toEqual([])
    expect(plan.moves).toEqual([
      { from: 'src/index.ts', to: 'src/server/index.ts' },
      { from: 'src/words.ts', to: 'src/server/words.ts' },
      { from: 'plugin/client.js', to: 'src/backoffice/client.js' },
      { from: 'plugin/seo.js', to: 'src/backoffice/seo.js' },
    ])
    applyMigration(dir, plan)

    const json = readPackageJson(join(dir, 'package.json'))
    expect(json?.exports).toEqual({ '.': './src/server/index.ts' })
    expect((json as { files: string[] }).files).toEqual(['NOTICE', 'src'])
    expect(json?.crombolo).toMatchObject({
      schemaVersion: 6,
      extensions: [{ element: 'src/backoffice/seo.js' }],
      permissions: { 'backoffice.code': 'Shows the SEO report', 'content.read': 'Reads pages' },
    })
    expect(readFileSync(join(dir, 'src/server/index.ts'), 'utf8')).toContain("'../../package.json'")
    // An import within the half that moved together stays as it was.
    expect(readFileSync(join(dir, 'src/backoffice/seo.js'), 'utf8')).toContain("'./client.js'")
    expect(existsSync(join(dir, 'plugin'))).toBe(false)
    expect(validateBundlePackage(json as never, dir)).toEqual([])
  })

  test('a server half alone asks for nothing more; screens alone ask for backoffice.code', () => {
    const server = schema4(
      { server: 'seo', permissions: {} },
      { 'src/index.ts': 'export const seo = () => ({})\n' },
      { exports: './src/index.ts' },
    )
    const serverPlan = planMigration(server)
    expect(serverPlan.problems).toEqual([])
    expect(serverPlan.asksForBackOfficeCode).toBe(false)

    const screens = schema4({ permissions: {}, extensions: [SCREEN] }, { 'plugin/seo.js': '' })
    expect(planMigration(screens).problems.join()).toContain('give it with --reason')
    expect(planMigration(screens, { reason: 'Shows it' }).asksForBackOfficeCode).toBe(true)
  })

  test('refuses a file both halves use, a list of permissions, and a package already at 5', () => {
    const shared = schema4(
      { server: 'seo', permissions: {}, extensions: [SCREEN] },
      {
        'src/index.ts': "import { x } from './shared.ts'\nexport const seo = () => ({ x })\n",
        'src/shared.ts': 'export const x = 1\n',
        'plugin/seo.js': "import { x } from '../src/shared.ts'\nexport default x\n",
      },
      { exports: './src/index.ts' },
    )
    const plan = planMigration(shared, { reason: 'Shows it' })
    expect(plan.problems.join()).toContain('src/shared.ts is used by both')
    expect(plan.moves).toEqual([])

    const listed = schema4({ server: 'seo', schemaVersion: 3, permissions: ['redirects.read'] }, {})
    expect(planMigration(listed).problems.join()).toContain('give each its reason')

    const current = schema4({ schemaVersion: 6, permissions: {} }, {})
    expect(planMigration(current).problems.join()).toContain('already written for bundle schema 6')
  })

  test('takes schema 5 to 6 with nothing moved, naming entries that could be screens (story 329)', () => {
    const five = schema4(
      {
        server: 'seo',
        schemaVersion: 5,
        permissions: { 'backoffice.code': 'Shows its report' },
        extensions: [{ type: 'dashboard', alias: 'Acme.Seo', element: 'src/backoffice/seo.js' }],
      },
      {},
    )
    const plan = planMigration(five)
    expect(plan.problems).toEqual([])
    expect(plan.moves).toEqual([])
    expect((plan.json.crombolo as { schemaVersion: number }).schemaVersion).toBe(6)
    expect(plan.couldBeScreens).toEqual(['Acme.Seo'])
  })

  test('a signature no longer matches, so it is removed', () => {
    const dir = schema4(
      { server: 'seo', permissions: {} },
      { 'src/index.ts': 'export const seo = () => ({})\n', 'provenance.json': '{}' },
      { exports: './src/index.ts' },
    )
    const plan = planMigration(dir)
    expect(plan.dropsSignature).toBe(true)
    applyMigration(dir, plan)
    expect(existsSync(join(dir, 'provenance.json'))).toBe(false)
  })
})
