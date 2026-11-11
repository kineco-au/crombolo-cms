/**
 * Story 320: an extension's back-office code is built for the browser, its
 * TypeScript compiled and its own imports bundled, the back office's modules left
 * for its import map; the server half's folder is never in that build, and the
 * back-office code's is never readable by the server half's process.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type BundlePackage, readBundlePackage } from '@crombolo/backoffice-host'
import { denoArguments, processReads, VERSION } from '@crombolo/server'
import {
  buildBackOffice,
  createBackOfficeBuilds,
} from '../packages/server/src/extension-backoffice.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function extension(files: Record<string, string>): BundlePackage {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'output', 'extension-backoffice-'))
  dirs.push(dir)
  const json = {
    name: '@acme/seo',
    version: '1.0.0',
    peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
    crombolo: {
      bundleType: 'extension',
      id: 'acme-seo',
      schemaVersion: 6,
      permissions: { 'backoffice.code': 'Shows the SEO report' },
      extensions: [
        { type: 'dashboard', alias: 'Acme.Seo', name: 'SEO', element: 'src/backoffice/seo.ts' },
      ],
    },
  }
  for (const [path, text] of Object.entries({ 'package.json': JSON.stringify(json), ...files })) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const { bundle, problems } = readBundlePackage(dir)
  if (!bundle) throw new Error(problems.join('; '))
  return bundle
}

describe('building back-office code', () => {
  test('compiles TypeScript, bundles its own imports and leaves the back office’s', async () => {
    const pkg = extension({
      'src/backoffice/seo.ts': [
        "import { html } from '@umbraco-cms/backoffice/external/lit'",
        "import { label } from './label.ts'",
        'const greeting: string = label()',
        'export default class extends HTMLElement { text = greeting; view = html }',
      ].join('\n'),
      'src/backoffice/label.ts': "export const label = (): string => 'SEO report'",
    })
    const out = join(pkg.directory, 'built')
    await buildBackOffice(pkg, out)
    const built = readFileSync(join(out, 'seo.js'), 'utf8')
    expect(built).toContain('SEO report')
    expect(built).toContain('@umbraco-cms/backoffice/external/lit')
    expect(built).not.toContain(': string')
    expect(existsSync(join(out, 'label.js'))).toBe(false)
  })

  test('refuses back-office code that imports the server half', async () => {
    const pkg = extension({
      'src/backoffice/seo.ts':
        "import { secret } from '../server/secret.ts'\nexport default secret",
      'src/server/secret.ts': "export const secret = 'server only'",
    })
    await expect(buildBackOffice(pkg, join(pkg.directory, 'built'))).rejects.toThrow(
      "the server half's",
    )
  })

  test('one that cannot be built is left out of the back office, saying why', async () => {
    const good = extension({ 'src/backoffice/seo.ts': 'export default class {}' })
    const bad = extension({ 'src/backoffice/seo.ts': 'export default class {' })
    const site = mkdtempSync(join(process.cwd(), 'output', 'extension-backoffice-site-'))
    dirs.push(site)
    const builds = createBackOfficeBuilds(site, () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
    }))
    const asExtension = (bundle: BundlePackage) => ({
      packageName: bundle.packageName,
      version: bundle.version,
      directory: bundle.directory,
      bundle: { ...bundle, id: bundle === good ? 'acme-good' : 'acme-bad' },
      manifest: { name: bundle.name, extensions: [] },
    })
    const ready = await builds.ready([asExtension(good), asExtension(bad)])
    expect(ready.map((extension) => extension.bundle.id)).toEqual(['acme-good'])
    expect(ready[0]?.servedDir).toBe(
      join(site, '.crombolo', 'extensions', 'acme-good', 'backoffice'),
    )
    expect(existsSync(join(ready[0]?.servedDir as string, 'seo.js'))).toBe(true)
    expect(builds.failed()).toMatchObject([{ id: 'acme-bad' }])
  })
})

describe('the server half’s process', () => {
  test('reads its own server half and its build, and never the back-office code', () => {
    const reads = processReads({ directory: '/site/node_modules/@acme/seo' }, '/site/build')
    expect(reads).toEqual(['/site/node_modules/@acme/seo/src/server', '/site/build'])
    const args = denoArguments({
      serverFile: '/site/build/server.js',
      reads,
      dataDir: '/site/data',
      origins: [],
      memoryMb: 256,
    })
    const allowed = args.find((arg) => arg.startsWith('--allow-read='))
    expect(allowed).not.toContain('src/backoffice')
    expect(allowed?.split('=')[1]?.split(',')).not.toContain('/site/node_modules/@acme/seo')
  })
})
