/**
 * Story 320: `crombolo extension migrate` rewrites a schema 4 extension to
 * the layout this release takes: its server code under `src/server/`, its manifest
 * and exports following. One that runs its own code in the back office is refused,
 * saying to describe its screens (story 431).
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
  test('moves its server half, rewriting the manifest and an import that leaves its folder', () => {
    const dir = schema4(
      { server: 'seo', permissions: { 'content.read': 'Reads pages' } },
      {
        'src/index.ts':
          "import manifest from '../package.json' with { type: 'json' }\nimport { words } from './words.ts'\nexport const seo = () => ({ manifest, words })\n",
        'src/words.ts': "export const words = 'hi'\n",
      },
      { exports: { '.': './src/index.ts' } },
    )
    const plan = planMigration(dir)
    expect(plan.problems).toEqual([])
    expect(plan.moves).toEqual([
      { from: 'src/index.ts', to: 'src/server/index.ts' },
      { from: 'src/words.ts', to: 'src/server/words.ts' },
    ])
    applyMigration(dir, plan)

    const json = readPackageJson(join(dir, 'package.json'))
    expect(json?.exports).toEqual({ '.': './src/server/index.ts' })
    expect(json?.crombolo).toMatchObject({
      schemaVersion: 6,
      permissions: { 'content.read': 'Reads pages' },
    })
    expect(readFileSync(join(dir, 'src/server/index.ts'), 'utf8')).toContain("'../../package.json'")
    expect(validateBundlePackage(json as never, dir)).toEqual([])
  })

  test('one that runs its own code in the back office is refused, saying to describe its screens (story 431)', () => {
    const screens = schema4(
      { server: 'seo', permissions: {}, extensions: [SCREEN] },
      { 'plugin/seo.js': '' },
    )
    const plan = planMigration(screens)
    expect(plan.moves).toEqual([])
    expect(plan.problems.join()).toContain('it runs its own code in the back office (Acme.Seo)')
    expect(plan.problems.join()).toContain('Describe each of its screens in its server half')

    const five = schema4(
      {
        server: 'seo',
        schemaVersion: 5,
        permissions: { 'backoffice.code': 'Shows its report' },
        extensions: [{ type: 'dashboard', alias: 'Acme.Seo', element: 'src/backoffice/seo.js' }],
      },
      {},
    )
    expect(planMigration(five).problems.join()).toContain('"backoffice.code" out of its manifest')
  })

  test('refuses a list of permissions, and a package already at 6', () => {
    const listed = schema4({ server: 'seo', schemaVersion: 3, permissions: ['redirects.read'] }, {})
    expect(planMigration(listed).problems.join()).toContain('give each its reason')

    const current = schema4({ schemaVersion: 6, permissions: {} }, {})
    expect(planMigration(current).problems.join()).toContain('already written for bundle schema 6')
  })

  test('takes schema 5 to 6 with nothing moved', () => {
    const five = schema4(
      { server: 'seo', schemaVersion: 5, permissions: { 'content.read': 'Reads pages' } },
      {},
    )
    const plan = planMigration(five)
    expect(plan.problems).toEqual([])
    expect(plan.moves).toEqual([])
    expect((plan.json.crombolo as { schemaVersion: number }).schemaVersion).toBe(6)
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
