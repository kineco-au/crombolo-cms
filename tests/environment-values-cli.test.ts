/**
 * Story 387 from the command line: `content update … --set title@production=…` sets
 * one environment's value, and a content file's `"title@production"` does too, the
 * shared value left as it was. A property that does not vary by environment refuses one.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connect, type Db, DocumentRepository } from '@crombolo/data'
import { seedKey } from '@crombolo/server'
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

/** Each of a page's title values, by the environment it is for: the shared one under "". */
async function titles(key: string): Promise<Record<string, unknown>> {
  const db: Db = await connect({ dialect: 'sqlite', file: join(site, 'site.sqlite') })
  try {
    const doc = await new DocumentRepository(db, {
      nodeState: { version: '1.0.0', revision: '0' },
    }).byKey(key)
    return Object.fromEntries(
      (doc?.values ?? [])
        .filter((v) => v.alias === 'title')
        .map((v) => [v.environment ?? '', v.value]),
    )
  } finally {
    await db.close()
  }
}

beforeAll(() => {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  site = mkdtempSync(join(process.cwd(), 'output', 'environment-values-cli-'))
  mkdirSync(join(site, 'schema', 'content-types'), { recursive: true })
  mkdirSync(join(site, 'components'), { recursive: true })
  writeFileSync(
    join(site, 'schema', 'schema.toml'),
    '[schema]\nversion = "1.0.0"\n\n[environments]\nnames = ["staging", "production"]\n',
  )
  writeFileSync(
    join(site, 'schema', 'content-types', 'page.toml'),
    '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\ncomponents = ["page"]\ndefault-component = "page"\n\n[[property]]\nalias = "title"\nname = "Title"\ntype = "textstring"\nvaries-by-environment = true\n\n[[property]]\nalias = "intro"\nname = "Intro"\ntype = "textstring"\n',
  )
  writeFileSync(join(site, 'components', 'page.tsx'), 'export default () => <main />\n')
  expect(cli(['types', 'sync']).code).toBe(0)
}, 60_000)
afterAll(() => rmSync(site, { recursive: true, force: true }))

describe('a value per environment from the command line', () => {
  test('content update sets one environment’s value, and refuses one where it does not vary', async () => {
    const made = cli(['content', 'new', '/Home', '--type', 'page', '--set', 'title=Welcome'])
    expect(made.code, made.err).toBe(0)
    const set = cli(['content', 'update', '/Home', '--set', 'title@production=Live'])
    expect(set.code, set.err).toBe(0)
    expect(await titles(seedKey('content/home'))).toEqual({ '': 'Welcome', production: 'Live' })
    const refused = cli(['content', 'update', '/Home', '--set', 'intro@production=x'])
    expect(refused.code).not.toBe(0)
    expect(refused.out + refused.err).toContain('same in every environment')
    const cleared = cli(['content', 'update', '/Home', '--unset', 'title@production'])
    expect(cleared.code, cleared.err).toBe(0)
    expect(await titles(seedKey('content/home'))).toEqual({ '': 'Welcome' })
  }, 30_000)

  test('a content file sets one environment’s value beside the shared one', async () => {
    mkdirSync(join(site, 'content', 'pages'), { recursive: true })
    writeFileSync(
      join(site, 'content', 'pages', 'about.toml'),
      'type = "page"\n\n[values]\ntitle = "About"\n"title@production" = "About us, live"\n',
    )
    const applied = cli(['site', 'apply'])
    expect(applied.code, applied.err).toBe(0)
    expect(await titles(seedKey('content/about'))).toEqual({
      '': 'About',
      production: 'About us, live',
    })
  }, 30_000)
})
