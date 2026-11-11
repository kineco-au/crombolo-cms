/**
 * A site's bundle carrying its code (story 192): which files are packed, the
 * hash over them, and the check and install a host runs, with the extension
 * roots it carries (story 332). The fixtures install from `file:` packages
 * under the site, so nothing reaches a registry.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  discoverBundles,
  INSTALLED_AS_DEPENDENCY,
  packageInRoot,
  recordExtension,
  recordProblems,
  validateBundlePackage,
} from '@crombolo/backoffice-host'
import {
  buildBundleFromDirectory,
  checkBundleCode,
  installBundleCode,
  readBundle,
} from '@crombolo/server'
import { loadBundleCode, selectCodeFiles } from '@crombolo/transfer'
import { copyTemplateFiles, findSite } from '../scripts/sites.ts'
import { integrityOf, packedServerExtension } from './support/bundles.ts'
import { BACKOFFICE, signedInServer } from './support/harness.ts'

const roots: string[] = []
const scratch = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'crombolo-code-test-'))
  roots.push(dir)
  return dir
}

const write = (dir: string, path: string, text: string | Uint8Array): void => {
  mkdirSync(join(dir, path, '..'), { recursive: true })
  writeFileSync(join(dir, path), text)
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** A server bundle as a vendored package, wired by id. */
function vendorBundle(site: string, id: string, peerRange = '>=0.1.0'): void {
  write(
    site,
    `vendor/${id}/package.json`,
    json({
      name: `${id}-bundle`,
      version: '1.0.0',
      type: 'module',
      main: 'src/server/index.js',
      crombolo: { bundleType: 'extension', id, server: id, schemaVersion: 6, permissions: {} },
      peerDependencies: { '@crombolo/crombolo': peerRange },
    }),
  )
  write(
    site,
    `vendor/${id}/src/server/index.js`,
    `export const ${id} = () => ({ id: '${id}', section: 'content', capabilities: [], routes: [{ method: 'GET', path: 'ping', handler: () => new Response('ok') }] })\n`,
  )
}

interface SiteOptions {
  config?: string
  dependencies?: Record<string, string>
  code?: string[]
  bundles?: Array<{ id: string; peerRange?: string }>
  /** More files, written before the fixture installs. */
  files?: Record<string, string>
}

/**
 * The starter site, given server code of its own: a vendored bundle it wires,
 * source under `src/`, a binary file, and things that must never travel.
 */
async function siteWithCode(options: SiteOptions = {}): Promise<string> {
  const site = join(scratch(), 'site')
  copyTemplateFiles(findSite('starter') as NonNullable<ReturnType<typeof findSite>>, site)
  // The CMS itself, as a stub: the real one is linked in by the check, as a host provides it.
  write(site, 'vendor/core/package.json', json({ name: '@crombolo/crombolo', version: '0.0.0' }))
  const bundles = options.bundles ?? [{ id: 'fx' }]
  for (const bundle of bundles) vendorBundle(site, bundle.id, bundle.peerRange)
  write(
    site,
    'package.json',
    json({
      name: 'code-site',
      private: true,
      type: 'module',
      crombolo: { code: options.code ?? ['src/**', 'vendor/**'] },
      dependencies: {
        ...Object.fromEntries(
          bundles.map((bundle) => [`${bundle.id}-bundle`, `file:./vendor/${bundle.id}`]),
        ),
        ...options.dependencies,
      },
      peerDependencies: { '@crombolo/crombolo': 'file:./vendor/core' },
    }),
  )
  write(
    site,
    'crombolo.config.ts',
    options.config ??
      `import { defineConfig } from '@crombolo/crombolo'
${bundles.map((b) => `import { ${b.id} } from '${b.id}-bundle'`).join('\n')}

export default defineConfig({ siteName: 'Code site', bundles: [${bundles.map((b) => `${b.id}()`).join(', ')}] })
`,
  )
  write(site, 'src/records.ts', 'export const records = 1\n')
  write(site, 'src/logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1]))
  write(site, 'src/.env', 'SECRET=1\n')
  write(site, '.env', 'SECRET=1\n')
  write(site, 'crombolo.sqlite', 'not a database')
  for (const [path, text] of Object.entries(options.files ?? {})) write(site, path, text)
  const install = Bun.spawn([process.execPath, 'install', '--ignore-scripts'], {
    cwd: site,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if ((await install.exited) !== 0)
    throw new Error(`fixture install failed: ${await new Response(install.stderr).text()}`)
  return site
}

async function built(site: string, code?: string[]): Promise<string> {
  const result = await buildBundleFromDirectory(site, { code })
  expect(result.problems).toEqual([])
  const out = join(scratch(), 'bundle')
  for (const file of result.files ?? []) write(out, file.path, file.bytes ?? (file.text as string))
  return out
}

let site: string
let bundle: string

beforeAll(async () => {
  site = await siteWithCode()
  bundle = await built(site)
}, 120_000)

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

describe('which files are the code', () => {
  test('what the patterns name, with the files every install needs', () => {
    const { paths, problems } = selectCodeFiles(site, ['src/**', 'vendor/**'])
    expect(problems).toEqual([])
    expect(paths).toContain('src/records.ts')
    expect(paths).toContain('src/logo.png')
    expect(paths).toContain('vendor/fx/src/server/index.js')
    for (const always of ['package.json', 'bun.lock', 'crombolo.config.ts'])
      expect(paths).toContain(always)
  })

  test('never secrets, databases, installs, or the folders the bundle already carries', () => {
    const { paths } = selectCodeFiles(site, ['**'])
    expect(paths).not.toContain('.env')
    expect(paths).not.toContain('src/.env')
    expect(paths).not.toContain('crombolo.sqlite')
    expect(paths.some((path) => path.includes('node_modules'))).toBe(false)
    expect(paths.some((path) => path.startsWith('schema/') || path.startsWith('content/'))).toBe(
      false,
    )
  })

  test('a pattern that matches nothing, or reaches out of the site, is said', () => {
    const { problems } = selectCodeFiles(site, ['lib/**', '../elsewhere/**'])
    expect(problems).toEqual([
      '"lib/**" matches no file the bundle can carry',
      '"../elsewhere/**" reaches outside the site',
    ])
  })

  test('code without a lockfile is refused, since it could not be installed as tested', () => {
    const bare = scratch()
    write(bare, 'package.json', json({ name: 'bare' }))
    write(bare, 'src/a.ts', '')
    expect(selectCodeFiles(bare, ['src/**']).problems).toEqual([
      'the site has no bun.lock, so its code could not be installed as it was tested',
    ])
  })
})

describe('a bundle built with code', () => {
  test('carries it under code/, listed in bundle.json at the root like any section', () => {
    const manifest = JSON.parse(readFileSync(join(bundle, 'package.json'), 'utf8'))
    expect(manifest.files).toContain('bundle.json')
    expect(manifest.files).toContain('code')
    expect(manifest.files).toContain('nodes')
    expect(manifest.crombolo.content).toBe(true)
    expect(manifest.crombolo.code).toBeUndefined()
    expect(validateBundlePackage(manifest, bundle)).toEqual([])
    const payload = JSON.parse(readFileSync(join(bundle, 'bundle.json'), 'utf8'))
    expect(payload.carries.code).toContain('code/src/logo.png')
    expect(payload.carries.code).toContain('code/crombolo.config.ts')
    expect(readFileSync(join(bundle, 'code/src/logo.png'))).toEqual(
      readFileSync(join(site, 'src/logo.png')),
    )
    expect(existsSync(join(bundle, 'code/.env'))).toBe(false)
    expect(loadBundleCode(bundle).problems).toEqual([])
  })

  test('--code names the files in place of the package.json list', async () => {
    const result = await buildBundleFromDirectory(site, { code: ['src/records.ts'] })
    expect(result.code).toEqual([
      'bun.lock',
      'crombolo.config.ts',
      'package.json',
      'src/records.ts',
    ])
  })

  test('a site that names no code builds the bundle it always did', async () => {
    const plain = scratch()
    copyTemplateFiles(findSite('starter') as NonNullable<ReturnType<typeof findSite>>, plain)
    const result = await buildBundleFromDirectory(plain)
    expect(result.problems).toEqual([])
    expect(result.code).toBeUndefined()
    expect(result.files?.some((file) => file.path.startsWith('code/'))).toBe(false)
  })

  test('code changed after the build fails the bundle’s one hash', async () => {
    const copy = await built(site)
    writeFileSync(join(copy, 'code/src/records.ts'), 'export const records = 2\n')
    expect(loadBundleCode(copy).problems.join('\n')).toContain('integrity does not match')
  })

  test('still installs its content as before, and says it carries code', () => {
    const resolved = readBundle(bundle, site)
    expect(resolved.set.nodes.length).toBeGreaterThan(0)
    expect(resolved.set.manifest.carries?.code).toContain('code/src/records.ts')
  })
})

describe('checking the code against this CMS', () => {
  test('a sound site passes, naming the server bundles its packages carry', async () => {
    const result = await checkBundleCode(bundle)
    expect(result.problems).toEqual([])
    expect(result.serverBundles).toEqual(['fx'])
  }, 60_000)

  test('lists every problem: a stray @crombolo package and a peer range', async () => {
    const bad = await built(
      await siteWithCode({
        bundles: [{ id: 'old', peerRange: '<0.1.0' }],
        files: { 'vendor/stub/package.json': json({ name: '@crombolo/stub', version: '1.0.0' }) },
        dependencies: { '@crombolo/stub': 'file:./vendor/stub' },
      }),
    )
    const result = await checkBundleCode(bad)
    const problems = result.problems.join('\n')
    expect(problems).toContain('package.json lists @crombolo/stub under dependencies')
    expect(problems).toContain('node_modules/@crombolo/stub is installed with the code')
    expect(problems).toContain('old-bundle (old) is written for @crombolo/crombolo <0.1.0')
  }, 120_000)

  test('never runs the site’s config: a host has not yet accepted its code', async () => {
    const sentinel = join(scratch(), 'ran')
    const nosy = await built(
      await siteWithCode({
        config: `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(sentinel)}, 'ran')
import { fx } from 'fx-bundle'
export default { bundles: [fx()] }
`,
      }),
    )
    const result = await checkBundleCode(nosy)
    expect(result.problems).toEqual([])
    expect(existsSync(sentinel)).toBe(false)
  }, 120_000)
})

describe('installing the code', () => {
  test('into an empty directory, leaving @crombolo to the CMS', async () => {
    const target = join(scratch(), 'site')
    const result = await installBundleCode(bundle, target)
    expect(result.problems).toEqual([])
    expect(existsSync(join(target, 'src/records.ts'))).toBe(true)
    expect(existsSync(join(target, 'node_modules/fx-bundle/src/server/index.js'))).toBe(true)
    expect(existsSync(join(target, 'node_modules/@crombolo'))).toBe(false)
  }, 60_000)

  // Story 241: `bundle install-code` became `bundle install --code-into`.
  test('through the CLI, as `extension install <extension> --code-into <dir>`', () => {
    const target = join(scratch(), 'site')
    const run = Bun.spawnSync(
      [
        'bun',
        join(import.meta.dir, '..', 'packages/cli/bin/crombolo.ts'),
        'extension',
        'install',
        bundle,
        '--code-into',
        target,
        '-o',
        'json',
      ],
      {
        cwd: scratch(),
        env: { ...process.env, CROMBOLO_LOG_TO_CONSOLE: 'false' },
        stdin: 'ignore',
      },
    )
    expect(run.exitCode, run.stderr.toString()).toBe(0)
    expect(JSON.parse(run.stdout.toString())).toMatchObject({ dir: target })
    expect(existsSync(join(target, 'src/records.ts'))).toBe(true)
  }, 60_000)

  test('never over another site’s files', async () => {
    const target = scratch()
    write(target, 'keep.txt', 'mine')
    const result = await installBundleCode(bundle, target)
    expect(result.problems[0]).toContain('already holds files')
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('mine')
  })

  test('refuses code that fails its hash, installing nothing', async () => {
    const copy = await built(site)
    writeFileSync(join(copy, 'code/src/records.ts'), 'tampered\n')
    const target = join(scratch(), 'site')
    expect((await installBundleCode(copy, target)).problems.join('\n')).toContain(
      'integrity does not match',
    )
    expect(existsSync(target)).toBe(false)
  })
})

describe('a bundle a site lists as a peer', () => {
  test('is discovered, as one under dependencies is', () => {
    const peerSite = scratch()
    write(peerSite, 'package.json', json({ name: 'p', peerDependencies: { 'fx-bundle': '1.0.0' } }))
    write(
      peerSite,
      'node_modules/fx-bundle/package.json',
      readFileSync(join(site, 'vendor/fx/package.json'), 'utf8'),
    )
    expect(discoverBundles(peerSite).bundles.map((b) => b.id)).toEqual(['fx'])
  })
})

/** An extension's root in the site, installed from a kept file, with its line in the record (story 326). */
async function addRoot(site: string, id: string): Promise<void> {
  const name = `@acme/${id}`
  const { tarball } = packedServerExtension(name, id)
  const file = `bundles/acme-${id}-1.0.0.tgz`
  write(site, file, tarball)
  write(
    site,
    `extensions/${id}/package.json`,
    json({ name: `${id}-root`, private: true, dependencies: { [name]: `file:../../${file}` } }),
  )
  const install = Bun.spawn([process.execPath, 'install', '--ignore-scripts'], {
    cwd: join(site, 'extensions', id),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if ((await install.exited) !== 0)
    throw new Error(`root install failed: ${await new Response(install.stderr).text()}`)
  recordExtension(site, id, { name, version: '1.0.0', integrity: integrityOf(tarball) })
}

describe('extension roots the code carries (story 332)', () => {
  let rooted: string

  beforeAll(async () => {
    const withRoot = await siteWithCode()
    await addRoot(withRoot, 'coderoot')
    rooted = await built(withRoot)
  }, 120_000)

  test('are checked, and their server halves named with the rest', async () => {
    const result = await checkBundleCode(rooted)
    expect(result.problems).toEqual([])
    expect(result.serverBundles.sort()).toEqual(['coderoot', 'fx'])
  }, 60_000)

  test('are installed from their own lockfiles, and the extension in one boots', async () => {
    // Under the repository, whose node_modules the views resolve the CMS from.
    const parent = join(process.cwd(), 'output')
    mkdirSync(parent, { recursive: true })
    const target = join(mkdtempSync(join(parent, 'code-root-')), 'site')
    roots.push(dirname(target))
    const result = await installBundleCode(rooted, target)
    expect(result.problems).toEqual([])
    expect(result.roots).toEqual([{ id: 'coderoot', ok: true }])
    expect(recordProblems(target)).toEqual([])
    const h = await signedInServer({
      config: {
        siteDir: target,
        componentsDir: join(target, 'components'),
        extensions: { coderoot: { grant: ['content.read'] } },
      },
    })
    try {
      const answered = await h.call(`${BACKOFFICE}/crombolo/api/bundle/coderoot/settings`)
      expect(answered.status, await answered.clone().text()).toBe(200)
      expect(await answered.json()).toEqual({ greeting: 'hello' })
    } finally {
      await h.db.close().catch(() => {})
    }
  }, 60_000)

  test('a root whose lockfile will not install is named, and the others still install', async () => {
    const site = await siteWithCode()
    await addRoot(site, 'goodroot')
    await addRoot(site, 'badroot')
    // A dependency its lockfile does not hold: a frozen install refuses it.
    const manifest = join(site, 'extensions/badroot/package.json')
    const declared = JSON.parse(readFileSync(manifest, 'utf8'))
    declared.dependencies['left-pad'] = '1.3.0'
    writeFileSync(manifest, json(declared))
    const target = join(scratch(), 'site')
    const result = await installBundleCode(await built(site), target)
    expect(result.roots).toEqual([
      { id: 'badroot', ok: false, problem: expect.stringContaining('bun.lock') },
      { id: 'goodroot', ok: true },
    ])
    expect(result.problems).toEqual([expect.stringContaining('extensions/badroot/: ')])
    expect(existsSync(packageInRoot(target, 'goodroot', '@acme/goodroot'))).toBe(true)
  }, 120_000)

  test('an extension the code lists as a dependency is named, as the boot would', async () => {
    const site = await siteWithCode({
      files: {
        'vendor/dep/package.json': json({
          name: 'dep-bundle',
          version: '1.0.0',
          main: 'src/server/index.js',
          crombolo: {
            bundleType: 'extension',
            id: 'dep',
            server: 'dep',
            schemaVersion: 6,
            permissions: {},
          },
          peerDependencies: { '@crombolo/crombolo': '>=0.1.0' },
        }),
        'vendor/dep/src/server/index.js': 'export const dep = () => ({ id: "dep" })\n',
      },
      dependencies: { 'dep-bundle': 'file:./vendor/dep' },
    })
    const result = await checkBundleCode(await built(site))
    expect(result.problems).toEqual([`dep-bundle (dep): ${INSTALLED_AS_DEPENDENCY}`])
  }, 120_000)
})
