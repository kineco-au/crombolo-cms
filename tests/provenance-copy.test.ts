/**
 * Story 060: a signed bundle keeps its signature through every copy this
 * repository makes of it, and the release signs the bundles it ships.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { PROVENANCE_FILE, type ProvenanceResult, packageDigest } from '@crombolo/server'
import { componentFiles, listTemplates } from '../packages/cli/src/templates.ts'
import { isBundlePackage, publishedBundles } from '../scripts/packages.ts'
import { demoBundleName } from '../scripts/release-demo-bundles.ts'
import { releaseProblem } from '../scripts/release-verify-signatures.ts'
import { listSites, stageTemplate } from '../scripts/sites.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})
const temp = () => {
  const dir = mkdtempSync(join(process.cwd(), 'output', 'provenance-copy-'))
  dirs.push(dir)
  return dir
}

function signedLooking(dir: string) {
  mkdirSync(join(dir, 'content', 'nodes'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{ "name": "acme-bundle", "version": "1.0.0" }\n')
  writeFileSync(join(dir, 'content', 'bundle.json'), '{}\n')
  writeFileSync(join(dir, 'content', 'nodes', 'a.json'), '{ "key": "a" }\n')
  writeFileSync(join(dir, PROVENANCE_FILE), '{ "format": 1 }\n')
}

describe('the package digest', () => {
  test('survives a byte-for-byte copy, and leaves out only the signature', () => {
    const source = temp()
    signedLooking(source)
    const before = packageDigest(source)
    const copy = join(temp(), 'copy')
    cpSync(source, copy, { recursive: true })
    expect(packageDigest(copy)).toBe(before)

    writeFileSync(join(copy, PROVENANCE_FILE), '{ "format": 1, "other": true }\n')
    expect(packageDigest(copy)).toBe(before)
    mkdirSync(join(copy, 'node_modules', 'x'), { recursive: true })
    writeFileSync(join(copy, 'node_modules', 'x', 'index.js'), '')
    expect(packageDigest(copy)).toBe(before)

    writeFileSync(join(copy, 'content', 'nodes', 'a.json'), '{ "key": "b" }\n')
    expect(packageDigest(copy)).not.toBe(before)
  })
})

describe('copies this repository makes', () => {
  test('a staged template carries no bundle for staging to rewrite', () => {
    const into = temp()
    for (const site of listSites().filter((candidate) => candidate.distribute)) {
      const staged = stageTemplate(site, into)
      expect(existsSync(join(staged, 'files', 'bundles'))).toBe(false)
      expect(readdirSync(join(staged, 'files')).some((name) => name === PROVENANCE_FILE)).toBe(
        false,
      )
    }
  })

  test('crombolo init copies a template’s files as they are, never rewritten', () => {
    for (const template of listTemplates())
      for (const file of componentFiles(template)) expect(file.copyFrom).toBeTruthy()
  })
})

describe('the release', () => {
  test('signs the packages that are bundles, and only those', () => {
    expect(publishedBundles().map((pkg) => pkg.name)).toEqual([
      '@crombolo/entra',
      '@crombolo/simple-redirects',
    ])
    expect(isBundlePackage({ name: '@crombolo/crombolo', version: '1.0.0' })).toBe(false)
  })

  test('names each demo bundle for its site and version', () => {
    expect(demoBundleName('demo/harbourstone', '1.2.3')).toBe('demo-harbourstone-1.2.3.tgz')
  })

  test('takes only a bundle signed from this repository at this tag', () => {
    const signed = (repository: string, ref: string): ProvenanceResult => ({
      state: 'signed',
      source: { issuer: '', repository, ref, commit: 'abc', workflow: '', run: null },
    })
    const repo = 'kineco-au/crombolo-cms'
    expect(releaseProblem(signed(repo, 'refs/tags/v1.2.3'), repo, 'v1.2.3')).toBeUndefined()
    expect(releaseProblem(signed(repo, 'refs/tags/v1.2.2'), repo, 'v1.2.3')).toContain(
      'not at v1.2.3',
    )
    expect(releaseProblem(signed(repo, 'refs/heads/main'), repo, 'v1.2.3')).toContain(
      'takes signed bundles only from',
    )
    expect(releaseProblem(signed('someone/else', 'refs/tags/v1.2.3'), repo, 'v1.2.3')).toContain(
      'github.com/someone/else',
    )
    expect(releaseProblem({ state: 'unsigned' }, repo, 'v1.2.3')).toContain('only signed bundles')
  })
})
