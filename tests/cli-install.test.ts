/**
 * Story 087: `crombolo install` refuses a site that would not run on this crombolo before it
 * installs anything, naming the image tag that would, as an image build relies on.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { VERSION } from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'

const ROOT = join(import.meta.dir, '..')
const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const site = (manifest?: object) => {
  const dir = mkdtempSync(join(ROOT, 'output', 'cli-install-'))
  dirs.push(dir)
  if (manifest) writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  return dir
}

const install = (dir: string) => {
  const proc = Bun.spawnSync(['bun', BIN, 'install'], {
    cwd: dir,
    stdin: 'ignore',
    env: { ...process.env, CROMBOLO_LOG_TO_CONSOLE: 'false' },
  })
  return { code: proc.exitCode, err: proc.stderr.toString() }
}

test('no package.json is no site', () => {
  expect(install(site()).code).toBe(ERROR_KINDS.not_found.exitCode)
})

test('a site without crombolo, or on another version, is refused naming the image tag', () => {
  expect(install(site({ name: 'x', dependencies: {} })).code).toBe(ERROR_KINDS.refused.exitCode)
  const other = install(site({ name: 'x', dependencies: { '@crombolo/crombolo': '0.1.0' } }))
  expect(other.code).toBe(ERROR_KINDS.refused.exitCode)
  expect(other.err).toContain(`and this is ${VERSION}`)
  expect(other.err).toContain('ghcr.io/kineco-au/crombolo:0.1.0')
})
