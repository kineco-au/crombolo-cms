/**
 * Story 284: `public/` in a bundle. Its files are bytes, so an image survives
 * the trip unchanged; `public.json` is what the bundle's hash covers, so an
 * edited, added or missing file is refused; and a whole-site replace carries
 * the folder and says what it removes.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  buildBundleFromDirectory,
  type CromboloConfig,
  exportSite,
  extractTarball,
  installBundleContent,
  replaceSummary,
  restoreSectionFiles,
} from '@crombolo/server'
import {
  BUNDLE_FORMAT_VERSION,
  loadBundle,
  OLDEST_BUNDLE_FORMAT_VERSION,
  PUBLIC_MANIFEST,
  selectCodeFiles,
} from '@crombolo/transfer'
import { type Harness, signedInServer } from './support/harness.ts'

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80, 0xc3])

const temp = (name: string) => {
  const dir = mkdtempSync(join(process.cwd(), 'output', `public-transfer-${name}-`))
  dirs.push(dir)
  return dir
}

const write = (root: string, path: string, body: string | Uint8Array) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), body)
}

function siteFiles(root: string) {
  write(root, 'schema/schema.toml', '[schema]\nversion = "1.0.0"\n')
  mkdirSync(join(root, 'components'), { recursive: true })
}

const withPublicFiles = (root: string) => {
  write(root, 'public/images/logo.png', LOGO)
  write(root, 'public/.well-known/security.txt', 'Contact: a@example.com\n')
  write(root, 'public/.gitkeep', '')
  write(root, 'public/.env', 'SECRET=1\n')
}

async function site() {
  const root = temp('site')
  siteFiles(root)
  const config: Partial<CromboloConfig> = {
    siteDir: root,
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    stylesheetsDir: join(root, 'css'),
    scriptsDir: join(root, 'scripts'),
    publicDir: join(root, 'public'),
  }
  const h = await signedInServer({ config })
  open.push(h)
  return { h, root, config: h.server.config, db: h.server.db }
}

/** A site's whole file, unpacked. Before a second `site()`, which clears Postgres. */
async function exported(from: Awaited<ReturnType<typeof site>>) {
  const out = join(temp('out'), 'site.tgz')
  const result = await exportSite(from.db, from.config, { out })
  const dir = temp('unpacked')
  await extractTarball(out, dir)
  return { result, dir }
}

async function built(root: string) {
  const result = await buildBundleFromDirectory(root)
  expect(result.problems).toEqual([])
  const out = temp('bundle')
  for (const file of result.files ?? []) {
    if (file.source) write(out, file.path, readFileSync(file.source))
    else write(out, file.path, file.bytes ?? (file.text as string))
  }
  return { result, out }
}

const problemsOf = (dir: string) => loadBundle(dir).problems.map((problem) => problem.message)

describe('a bundle built from a site', () => {
  test('carries public/ as format 7, without its dotfiles', async () => {
    const root = temp('source')
    siteFiles(root)
    withPublicFiles(root)
    const { out, result } = await built(root)
    const loaded = loadBundle(out)
    expect(loaded.problems).toEqual([])
    expect(BUNDLE_FORMAT_VERSION).toBe(7)
    expect(loaded.set?.manifest.formatVersion).toBe(7)
    expect(loaded.set?.manifest.carries?.public).toEqual([
      'public/.gitkeep',
      'public/.well-known/security.txt',
      'public/images/logo.png',
    ])
    expect(result.publicFiles?.find((f) => f.path.endsWith('logo.png'))?.size).toBe(LOGO.length)
    expect(existsSync(join(out, 'public', '.env'))).toBe(false)
    const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'))
    expect(pkg.files).toContain('public')
    expect(pkg.files).toContain(PUBLIC_MANIFEST)
  })

  test('with no folder is as it was, and has no list', async () => {
    const root = temp('source')
    siteFiles(root)
    const { out } = await built(root)
    expect(existsSync(join(out, PUBLIC_MANIFEST))).toBe(false)
    expect(loadBundle(out).set?.manifest.carries?.public).toBeUndefined()
  })

  test('a code glob leaves public/ to its own section', () => {
    const root = temp('source')
    write(root, 'public/a.js', 'x')
    write(root, 'src/a.ts', 'x')
    write(root, 'package.json', '{}')
    write(root, 'bun.lock', '')
    expect(selectCodeFiles(root, ['**/*.{js,ts}']).paths).toEqual([
      'bun.lock',
      'package.json',
      'src/a.ts',
    ])
  })
})

describe('reading one', () => {
  const made = async () => {
    const root = temp('source')
    siteFiles(root)
    withPublicFiles(root)
    return (await built(root)).out
  }

  test('refuses a file edited, added or taken away', async () => {
    const edited = await made()
    appendFileSync(join(edited, 'public', 'images', 'logo.png'), 'x')
    expect(problemsOf(edited).join()).toContain('is not the file public.json lists')

    const sameSize = await made()
    write(
      sameSize,
      'public/images/logo.png',
      LOGO.map((byte) => byte ^ 1),
    )
    expect(problemsOf(sameSize).join()).toContain('is not the file public.json lists')

    const added = await made()
    write(added, 'public/extra.txt', 'x')
    expect(problemsOf(added).join()).toContain('not listed in public.json')

    const missing = await made()
    rmSync(join(missing, 'public', 'images', 'logo.png'))
    expect(problemsOf(missing).join()).toContain('says this file is carried')
  })

  test('refuses a changed list, which the bundle hash covers', async () => {
    const dir = await made()
    const list = JSON.parse(readFileSync(join(dir, PUBLIC_MANIFEST), 'utf8'))
    list.files.pop()
    writeFileSync(join(dir, PUBLIC_MANIFEST), JSON.stringify(list))
    expect(problemsOf(dir).join()).toContain('integrity does not match')
  })

  test('refuses a path that climbs out, and a list nothing declares', async () => {
    const climbing = await made()
    const list = JSON.parse(readFileSync(join(climbing, PUBLIC_MANIFEST), 'utf8'))
    list.files.push({ path: 'public/../../secret', size: 1, sha256: 'x' })
    writeFileSync(join(climbing, PUBLIC_MANIFEST), JSON.stringify(list))
    expect(problemsOf(climbing).join()).toContain('no usable path')

    const undeclared = await made()
    const manifest = JSON.parse(readFileSync(join(undeclared, 'bundle.json'), 'utf8'))
    delete manifest.publicManifest
    writeFileSync(join(undeclared, 'bundle.json'), JSON.stringify(manifest))
    expect(problemsOf(undeclared).join()).toContain('bundle.json does not declare this file')
  })

  test('ignores paths the manifest lists under carries: only the list counts', async () => {
    const dir = await made()
    const manifest = JSON.parse(readFileSync(join(dir, 'bundle.json'), 'utf8'))
    manifest.carries = { ...manifest.carries, public: ['public/forged.txt'] }
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify(manifest))
    expect(loadBundle(dir).set?.manifest.carries?.public).not.toContain('public/forged.txt')
  })

  test('a format 6 bundle is still read, and a newer one refused by name', async () => {
    expect(OLDEST_BUNDLE_FORMAT_VERSION).toBeLessThanOrEqual(6)
    const root = temp('source')
    siteFiles(root)
    const dir = (await built(root)).out
    const manifest = JSON.parse(readFileSync(join(dir, 'bundle.json'), 'utf8'))
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify({ ...manifest, formatVersion: 6 }))
    expect(problemsOf(dir)).toEqual([])
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify({ ...manifest, formatVersion: 8 }))
    expect(problemsOf(dir).join()).toContain('upgrade crombolo')
  })
})

describe('a whole site, from one server to another', () => {
  test('the file carries public/, and a replace lands it byte for byte', async () => {
    const a = await site()
    withPublicFiles(a.root)
    const { result, dir } = await exported(a)
    expect(result.sections.public).toBe(3)
    expect(loadBundle(dir).problems).toEqual([])

    const b = await site()
    write(b.root, 'public/old.txt', 'only here')
    const installed = await installBundleContent(b.db, b.config, {
      bundle: dir,
      replace: 'replace',
      backupTaken: true,
    })
    expect(installed.problems).toEqual([])
    expect(new Uint8Array(readFileSync(join(b.root, 'public', 'images', 'logo.png')))).toEqual(LOGO)
    expect(readFileSync(join(b.root, 'public', '.well-known', 'security.txt'), 'utf8')).toContain(
      'Contact',
    )
    expect(existsSync(join(b.root, 'public', 'old.txt'))).toBe(false)
  })

  test('a replace says what it would take out of public/', async () => {
    const a = await site()
    write(a.root, 'public/old.txt', 'only here')
    write(a.root, 'public/.well-known/old.txt', 'only here')
    write(a.root, 'public/kept.txt', 'both')
    const summary = await replaceSummary(
      a.db,
      { nodes: [] } as never,
      new Set(['public/kept.txt']),
      [{ section: 'public', dir: a.config.publicDir }],
      'replace',
    )
    expect(
      summary.filesRemoved.map((path) => path.slice(a.config.publicDir.length + 1)).sort(),
    ).toEqual(['.well-known/old.txt', 'old.txt'])
  })
})

describe('installing a bundle on a site', () => {
  test('adds its files, asks before replacing one, and a revert puts it all back', async () => {
    const source = temp('source')
    siteFiles(source)
    write(source, 'public/images/logo.png', LOGO)
    write(source, 'public/new.txt', 'new')
    const { out } = await built(source)

    const b = await site()
    write(b.root, 'public/images/logo.png', 'the site’s own logo')
    write(b.root, 'public/mine.txt', 'mine')
    const refused = await installBundleContent(b.db, b.config, { bundle: out, backupTaken: true })
    expect(refused.runId).toBeUndefined()
    expect(readFileSync(join(b.root, 'public', 'images', 'logo.png'), 'utf8')).toBe(
      'the site’s own logo',
    )

    const installed = await installBundleContent(b.db, b.config, {
      bundle: out,
      backupTaken: true,
      replaceFiles: true,
    })
    expect(installed.runId).toBeDefined()
    expect(new Uint8Array(readFileSync(join(b.root, 'public', 'images', 'logo.png')))).toEqual(LOGO)
    expect(readFileSync(join(b.root, 'public', 'mine.txt'), 'utf8')).toBe('mine')

    restoreSectionFiles(b.config, installed.runId as string)
    expect(readFileSync(join(b.root, 'public', 'images', 'logo.png'), 'utf8')).toBe(
      'the site’s own logo',
    )
    expect(existsSync(join(b.root, 'public', 'new.txt'))).toBe(false)
    expect(readFileSync(join(b.root, 'public', 'mine.txt'), 'utf8')).toBe('mine')
  })

  test('an identical file is unchanged, so an install does not need permission', async () => {
    const source = temp('source')
    siteFiles(source)
    write(source, 'public/images/logo.png', LOGO)
    const { out } = await built(source)
    const b = await site()
    write(b.root, 'public/images/logo.png', LOGO)
    const installed = await installBundleContent(b.db, b.config, { bundle: out, backupTaken: true })
    expect(installed.runId).toBeDefined()
  })
})
