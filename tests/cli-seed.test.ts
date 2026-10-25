/**
 * Story 163: `crombolo seed check | build | apply | export` and `start --seed`,
 * through the CLI against a SQLite site of its own. What a seed compiles to,
 * and how it applies, is tested on both dialects in seed.test.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, type Db, DocumentRepository } from '@crombolo/data'
import { seedKey } from '@crombolo/server'
import { OUTCOMES } from '../packages/cli/src/errors.ts'
import { ROOT } from '../scripts/packages.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
let site: string

const env = () => ({
  ...process.env,
  CROMBOLO_DB: 'sqlite',
  CROMBOLO_SQLITE_FILE: join(site, 'site.sqlite'),
  CROMBOLO_MEDIA_DIR: join(site, 'media'),
  CROMBOLO_COMPONENTS_DIR: join(site, 'components'),
  CROMBOLO_SCHEMA_DIR: join(site, 'schema'),
  CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
  CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
  CROMBOLO_LOG_TO_CONSOLE: 'false',
})

function cli(args: string[]) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], { cwd: site, env: env(), stdin: 'ignore' })
  return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() }
}

async function withDb<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
  try {
    return await work(db)
  } finally {
    await db.close()
  }
}

const title = (key: string) =>
  withDb(async (db) => {
    const doc = await new DocumentRepository(db, {
      nodeState: { version: '1.0.0', revision: '0' },
    }).byKey(key)
    return doc?.values.find((v) => v.alias === 'title')?.value
  })

const writeSeed = (path: string, text: string) => {
  const file = join(site, 'seed', path)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

beforeAll(() => {
  site = mkdtempSync(join(process.cwd(), 'output', 'cli-seed-'))
  mkdirSync(join(site, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(site, 'components'), { recursive: true })
  writeFileSync(join(site, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(
    join(site, 'schema', 'content-types', 'page.toml'),
    '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\nallow-children = ["page"]\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\n',
  )
  writeFileSync(join(site, 'components', 'page.tsx'), 'export default () => <main />\n')
  expect(cli(['types', 'sync']).code).toBe(0)
})
afterAll(() => rmSync(site, { recursive: true, force: true }))

describe('seed check', () => {
  test('names each problem by file and line, and exits 20', () => {
    writeSeed('content/home.toml', 'type = "page"\n\n[values]\ntitle = "Home"\nsubtitle = "x"\n')
    const run = cli(['seed', 'check'])
    expect(run.code).toBe(OUTCOMES.problems_found.code)
    expect(run.out).toContain('seed/content/home.toml:5  "page" has no property "subtitle"')
    const json = JSON.parse(cli(['seed', 'check', '-o', 'json']).out) as {
      findings: Array<{ file: string; line: number; code: string }>
    }
    expect(json.findings).toEqual([
      expect.objectContaining({
        file: 'seed/content/home.toml',
        line: 5,
        code: 'unknown-property',
      }),
    ])
  })

  test('a seed with nothing wrong is all good', () => {
    writeSeed('content/home.toml', 'type = "page"\n\n[values]\ntitle = "Home"\n')
    writeSeed('content/home/about.toml', 'type = "page"\n\n[values]\ntitle = "About"\n')
    const run = cli(['seed', 'check'])
    expect(run.code, run.err).toBe(0)
    expect(run.out).toContain('2 page(s)')
  })
})

describe('seed build and apply', () => {
  test('seed build is bundle build now: the site, schema and views with its seed', () => {
    const out = join(site, 'built')
    const run = cli(['seed', 'build', '--out', out])
    expect(run.code, run.err).toBe(0)
    expect(run.err).toContain('deprecated')
    expect(existsSync(join(out, 'package.json'))).toBe(true)
    expect(existsSync(join(out, 'content', 'schema', 'content-types', 'page.toml'))).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'content', 'bundle.json'), 'utf8')).counts).toEqual({
      document: 2,
    })
  })

  test('a dry run writes nothing; apply creates and publishes; again changes nothing', async () => {
    const dry = cli(['seed', 'apply', '--dry-run'])
    expect(dry.code, dry.err).toBe(0)
    expect(dry.out).toContain('2 create')
    expect(await title(seedKey('content/home'))).toBeUndefined()

    const applied = cli(['seed', 'apply', '--publish', '-o', 'json'])
    expect(applied.code, applied.err).toBe(0)
    const result = JSON.parse(applied.out) as { counts: { create: number }; published: number }
    expect(result.counts.create).toBe(2)
    expect(result.published).toBe(2)
    expect(await title(seedKey('content/home/about'))).toBe('About')

    const again = JSON.parse(cli(['seed', 'apply', '-o', 'json']).out) as {
      counts: { create: number; update: number }
    }
    expect(again.counts).toMatchObject({ create: 0, update: 0 })
  })

  test('a changed seed file updates its page', async () => {
    writeSeed('content/home/about.toml', 'type = "page"\n\n[values]\ntitle = "About us"\n')
    const run = cli(['seed', 'apply'])
    expect(run.code, run.err).toBe(0)
    expect(run.out).toContain('changed in the bundle since it was last imported')
    expect(await title(seedKey('content/home/about'))).toBe('About us')
  })
})

describe('seed export', () => {
  test('writes the pages back as seed files, keeping their keys', () => {
    rmSync(join(site, 'seed'), { recursive: true, force: true })
    const run = cli(['seed', 'export', '/Home'])
    expect(run.code, run.err).toBe(0)
    const about = readFileSync(join(site, 'seed', 'content', 'home', 'about.toml'), 'utf8')
    expect(about).toContain('type = "page"')
    expect(about).toContain('title = "About us"')
    // Exported from where its file is, so the key it derives is the one it has.
    expect(about).not.toContain('key =')
    expect(cli(['seed', 'check']).code).toBe(0)
  })
})

describe('media in folders on a site never started (story 180)', () => {
  test('a seed that puts an image in a folder checks and applies with no server ever run', () => {
    // The smallest PNG there is: one transparent pixel.
    const file = join(site, 'seed', 'media', 'images', 'pixel.png')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    try {
      const check = cli(['seed', 'check'])
      expect(check.code, check.out + check.err).toBe(0)
      const apply = cli(['seed', 'apply'])
      expect(apply.code, apply.out + apply.err).toBe(0)
    } finally {
      rmSync(join(site, 'seed', 'media'), { recursive: true, force: true })
    }
  })
})

describe('start --seed', () => {
  test('applies a seed once per change to it', async () => {
    const start = async () => {
      const proc = Bun.spawn(['bun', BIN, 'start', '--seed'], {
        cwd: site,
        env: { ...env(), NODE_ENV: 'production', PORT: '0' },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const decoder = new TextDecoder()
      let banner = ''
      const timer = setTimeout(() => proc.kill(), 60_000)
      for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
        banner += decoder.decode(chunk)
        if (banner.includes('└─')) break
      }
      clearTimeout(timer)
      proc.kill()
      await proc.exited
      return banner
    }
    writeSeed('content/home/team.toml', 'type = "page"\n\n[values]\ntitle = "Team"\n')
    const first = await start()
    expect(first).toMatch(/bundle\s+\S+: 1 created/)
    expect(await title(seedKey('content/home/team'))).toBe('Team')
    const second = await start()
    expect(second).toContain('already imported')
  }, 120_000)
})
