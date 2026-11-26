/**
 * Story 431: an extension runs none of its own code in the back office. One whose
 * manifest names back-office modules, holds `src/backoffice/`, or asks for the
 * retired `backoffice.code` is refused, saying to describe its screens; and the
 * server half's process never reads back-office code.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readBundlePackage } from '@crombolo/backoffice-host'
import { denoArguments, processReads, VERSION } from '@crombolo/server'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function problemsOf(crombolo: Record<string, unknown>, files: Record<string, string> = {}): string {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const dir = mkdtempSync(join(process.cwd(), 'output', 'extension-backoffice-'))
  dirs.push(dir)
  const json = {
    name: '@acme/seo',
    version: '1.0.0',
    peerDependencies: { '@crombolo/crombolo': `^${VERSION}` },
    crombolo: { bundleType: 'extension', id: 'acme-seo', schemaVersion: 6, ...crombolo },
  }
  for (const [path, text] of Object.entries({ 'package.json': JSON.stringify(json), ...files })) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return readBundlePackage(dir).problems.join('; ')
}

describe('an extension’s own back-office code', () => {
  test('is refused, saying to describe its screens', () => {
    const named = problemsOf(
      {
        permissions: {},
        extensions: [
          { type: 'dashboard', alias: 'Acme.Seo', name: 'SEO', element: 'src/backoffice/seo.ts' },
        ],
      },
      { 'src/backoffice/seo.ts': 'export default class {}\n' },
    )
    expect(named).toContain('it has its own back-office code (src/backoffice/seo.ts)')
    expect(named).toContain('describe its screens')
  })

  test('a src/backoffice folder alone is refused too', () => {
    expect(problemsOf({ permissions: {} }, { 'src/backoffice/notes.ts': 'export {}\n' })).toContain(
      'it has its own back-office code (src/backoffice/)',
    )
  })

  test('story 435: one that brings a page into the site’s public folder is refused, by name', () => {
    const problems = problemsOf(
      { permissions: {} },
      { 'public/badge.svg': '<svg/>', 'public/landing.html': '<p/>', 'public/logo.png': 'png' },
    )
    expect(problems).toContain('it carries public/badge.svg')
    expect(problems).toContain('it carries public/landing.html')
    expect(problems).not.toContain('logo.png')
  })

  test('asking for backoffice.code is refused as retired', () => {
    expect(problemsOf({ permissions: { 'backoffice.code': 'Shows the SEO report' } })).toContain(
      '"backoffice.code" is retired',
    )
  })
})

describe('the server half’s process', () => {
  test('reads its own server half and its build, and never the back-office code', () => {
    const reads = processReads({ directory: '/site/node_modules/@acme/seo' }, '/site/build')
    expect(reads).toEqual(['/site/node_modules/@acme/seo/src/server', '/site/build'])
    const args = denoArguments({
      serverFile: '/site/build/server.js',
      reads,
      origins: [],
      memoryMb: 256,
    })
    const allowed = args.find((arg) => arg.startsWith('--allow-read='))
    expect(allowed).not.toContain('src/backoffice')
    expect(allowed?.split('=')[1]?.split(',')).not.toContain('/site/node_modules/@acme/seo')
    // Story 435: it writes nowhere, reads no data of its own, and runs no code from text.
    expect(args.some((arg) => arg.startsWith('--allow-write'))).toBe(false)
    expect(allowed).not.toContain('/data')
    expect(args.find((arg) => arg.startsWith('--v8-flags='))).toContain(
      '--disallow-code-generation-from-strings',
    )
  })
})
