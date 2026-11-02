/**
 * Stories 163 and 167: `crombolo bundle build --check`, `bundle apply`,
 * `bundle export --source` and `start --bundle .`,
 * through the CLI against a SQLite site of its own. What a seed compiles to,
 * and how it applies, is tested on both dialects in seed.test.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, type Db, DocumentRepository } from '@crombolo/data'
import { seedKey } from '@crombolo/server'
import { ERROR_KINDS, OUTCOMES } from '../packages/cli/src/errors.ts'
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
  const file = join(site, 'content', path.replace(/^content\//, 'pages/'))
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

describe('bundle build --check', () => {
  test('names each problem by file and line, and exits 20', () => {
    writeSeed('content/home.toml', 'type = "page"\n\n[values]\ntitle = "Home"\nsubtitle = "x"\n')
    const run = cli(['bundle', 'build', '--check'])
    expect(run.code).toBe(OUTCOMES.problems_found.code)
    expect(run.out).toContain('content/pages/home.toml:5  "page" has no property "subtitle"')
    const json = JSON.parse(cli(['bundle', 'build', '--check', '-o', 'json']).out) as {
      findings: Array<{ file: string; line: number; code: string }>
    }
    expect(json.findings).toEqual([
      expect.objectContaining({
        file: 'content/pages/home.toml',
        line: 5,
        code: 'unknown-property',
      }),
    ])
  })

  test('a seed with nothing wrong is all good', () => {
    writeSeed('content/home.toml', 'type = "page"\n\n[values]\ntitle = "Home"\n')
    writeSeed('content/home/about.toml', 'type = "page"\n\n[values]\ntitle = "About"\n')
    const run = cli(['bundle', 'build', '--check'])
    expect(run.code, run.err).toBe(0)
    expect(run.out).toContain('2 page(s)')
  })
})

describe('bundle build and apply', () => {
  test('bundle build: the site, schema and views with its content', () => {
    const out = join(site, 'built')
    const run = cli(['bundle', 'build', '--out', out])
    expect(run.code, run.err).toBe(0)
    expect(existsSync(join(out, 'package.json'))).toBe(true)
    expect(existsSync(join(out, 'schema', 'content-types', 'page.toml'))).toBe(true)
    expect(JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8')).counts).toEqual({
      document: 2,
    })
  })

  test('a dry run writes nothing; apply creates and publishes; again changes nothing', async () => {
    const dry = cli(['bundle', 'apply', '--dry-run'])
    expect(dry.code, dry.err).toBe(0)
    expect(dry.out).toContain('2 create')
    expect(await title(seedKey('content/home'))).toBeUndefined()

    const applied = cli(['bundle', 'apply', '--publish', '-o', 'json'])
    expect(applied.code, applied.err).toBe(0)
    const result = JSON.parse(applied.out) as { counts: { create: number }; published: number }
    expect(result.counts.create).toBe(2)
    expect(result.published).toBe(2)
    expect(await title(seedKey('content/home/about'))).toBe('About')

    const again = JSON.parse(cli(['bundle', 'apply', '-o', 'json']).out) as {
      counts: { create: number; update: number }
    }
    expect(again.counts).toMatchObject({ create: 0, update: 0 })
  })

  test('a changed seed file updates its page', async () => {
    writeSeed('content/home/about.toml', 'type = "page"\n\n[values]\ntitle = "About us"\n')
    const run = cli(['bundle', 'apply'])
    expect(run.code, run.err).toBe(0)
    expect(run.out).toContain('changed in the bundle since it was last imported')
    expect(await title(seedKey('content/home/about'))).toBe('About us')
  })
})

describe('content find (story 183)', () => {
  test('finds the seeded pages by type, place and value, and refuses what names nothing', () => {
    const found = cli(['content', 'find', '--type', 'page', '-o', 'json'])
    expect(found.code, found.err).toBe(0)
    const result = JSON.parse(found.out) as {
      total: number
      exact: boolean
      items: Array<{ name: string; state: string; path: Array<{ name: string }> }>
    }
    expect(result).toMatchObject({ total: 2, exact: true })
    expect(result.items.map((i) => i.name)).toEqual(['About', 'Home'])

    const under = JSON.parse(
      cli(['content', 'find', '--under', '/Home', '--where', 'title eq about us', '-o', 'json'])
        .out,
    ) as typeof result
    expect(under.items.map((i) => [i.name, i.path.map((p) => p.name)])).toEqual([
      ['About', ['Home']],
    ])

    const text = cli(['content', 'find', '--type', 'page'])
    expect(text.out).toContain('Home / About')

    expect(cli(['content', 'find', '--where', 'nothing exists']).code).toBe(
      ERROR_KINDS.refused.exitCode,
    )
    expect(cli(['content', 'find', '--where', 'title sounds-like x']).code).toBe(2)
  })
})

describe('bundle export --source', () => {
  test('writes the pages back as seed files, keeping their keys', () => {
    rmSync(join(site, 'content'), { recursive: true, force: true })
    const run = cli(['bundle', 'export', '--source', '--root', '/Home'])
    expect(run.code, run.err).toBe(0)
    const about = readFileSync(join(site, 'content', 'pages', 'home', 'about.toml'), 'utf8')
    expect(about).toContain('type = "page"')
    expect(about).toContain('title = "About us"')
    // Exported from where its file is, so the key it derives is the one it has.
    expect(about).not.toContain('key =')
    expect(cli(['bundle', 'build', '--check']).code).toBe(0)
  })
})

describe('media in folders on a site never started (story 180)', () => {
  test('a seed that puts an image in a folder checks and applies with no server ever run', () => {
    // The smallest PNG there is: one transparent pixel.
    const file = join(site, 'content', 'media', 'images', 'pixel.png')
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(
      file,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    try {
      const check = cli(['bundle', 'build', '--check'])
      expect(check.code, check.out + check.err).toBe(0)
      const apply = cli(['bundle', 'apply'])
      expect(apply.code, apply.out + apply.err).toBe(0)
    } finally {
      rmSync(join(site, 'content', 'media'), { recursive: true, force: true })
    }
  })
})

describe('start --bundle .', () => {
  test('applies a seed once per change to it', async () => {
    const start = async () => {
      const proc = Bun.spawn(['bun', BIN, 'start', '--bundle', '.'], {
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
