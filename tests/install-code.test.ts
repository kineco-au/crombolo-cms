/**
 * Story 241: installing code is a choice a group makes, administrators included;
 * a site bundle always sends what installing and wiring a bundle changes; and a
 * deploy sends only what is committed.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasPermission, RemotePermissions } from '@crombolo/core'
import { buildBundleFromDirectory } from '@crombolo/server'
import { ERROR_KINDS } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

function site(files: Record<string, string>) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'install-code-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

describe('Install code on this site', () => {
  const admin = { isAdmin: true, global: new Set<string>(), granular: new Map() }

  test('an administrator holds every permission but this one', () => {
    expect(hasPermission(admin, RemotePermissions.ApplyStructure)).toBe(true)
    expect(hasPermission(admin, RemotePermissions.InstallCode)).toBe(false)
  })

  test('a group that names it gives it, to an administrator too', () => {
    const named = new Set<string>([RemotePermissions.InstallCode])
    expect(hasPermission({ ...admin, global: named }, RemotePermissions.InstallCode)).toBe(true)
    expect(
      hasPermission(
        { isAdmin: false, global: named, granular: new Map() },
        RemotePermissions.InstallCode,
      ),
    ).toBe(true)
  })
})

describe('a site bundle with no code of its own', () => {
  const lock = '{\n  "lockfileVersion": 1,\n  "workspaces": { "": { "name": "s" } }\n}\n'

  test('carries package.json, bun.lock and crombolo.config.ts once there is a lockfile', async () => {
    const built = await buildBundleFromDirectory(
      site({
        'package.json': '{ "name": "s", "private": true }\n',
        'bun.lock': lock,
        'crombolo.config.ts': 'export default {}\n',
      }),
    )
    expect(built.problems).toEqual([])
    expect(built.code).toEqual(['bun.lock', 'crombolo.config.ts', 'package.json'])
  })

  test('carries no code without a lockfile, as before', async () => {
    const built = await buildBundleFromDirectory(
      site({ 'package.json': '{ "name": "s", "private": true }\n' }),
    )
    expect(built.problems).toEqual([])
    expect(built.code).toBeUndefined()
  })
})

describe('bundle deploy', () => {
  const deploy = (cwd: string) => {
    const proc = Bun.spawnSync(
      [
        'bun',
        join(ROOT, 'packages/cli/bin/crombolo.ts'),
        'bundle',
        'deploy',
        '--remote',
        'nowhere',
      ],
      { cwd, stdin: 'ignore', env: { ...process.env, CROMBOLO_LOG_TO_CONSOLE: 'false' } },
    )
    return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() }
  }
  const git = (cwd: string, ...args: string[]) =>
    Bun.spawnSync(['git', ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    })

  test('refuses a site outside git, and one with changes not committed', () => {
    const outside = mkdtempSync(join('/tmp', 'install-code-deploy-'))
    dirs.push(outside)
    mkdirSync(join(outside, 'schema'))
    const notGit = deploy(outside)
    expect(notGit.code).toBe(ERROR_KINDS.refused.exitCode)
    if (!Bun.which('git')) {
      expect(notGit.out).toContain('git is not installed')
      return
    }
    expect(notGit.out).toContain('not in a git repository')

    git(outside, 'init', '-q')
    writeFileSync(join(outside, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    const dirty = deploy(outside)
    expect(dirty.code).toBe(ERROR_KINDS.refused.exitCode)
    expect(dirty.out).toContain('not committed')
  })
})
