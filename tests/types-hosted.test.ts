/**
 * Story 374: a hosted site's schema and a checkout's `schema/` changed together
 * from the command line. `types check --against` lists where they differ,
 * `types export --from` brings the site's into the files, and the type
 * commands' `--to` change the files and then the site, refusing before anything
 * is written where the site has moved on, unless --force; --all makes the site
 * match the files.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository } from '@crombolo/data'
import { fileKeychain, saveSignIn } from '@crombolo/server/remote-credentials'
import { ERROR_KINDS, OUTCOMES } from '../packages/cli/src/errors.ts'
import { laterVersion, schemaDiff } from '../packages/cli/src/support/hosted-schema.ts'
import { ROOT } from '../scripts/packages.ts'
import { ADMIN, BACKOFFICE, bootServer, type Harness, signIn, V1 } from './support/harness.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const SECRET = 'a-test-secret-key-that-is-long-enough-to-use'
const ARTICLE = 'schema/content-types/article.toml'

const write = (root: string, files: Record<string, string>) => {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), body)
  }
}

describe('comparing two schemas', () => {
  test('lists each file only here, only there or different; the version is not a difference', () => {
    const here = new Map([
      ['schema.toml', '[schema]\nversion = "1.2.0"\n'],
      ['content-types/a.toml', 'a'],
      ['content-types/b.toml', 'b'],
    ])
    const there = new Map([
      ['schema.toml', '[schema]\nversion = "1.5.0"\n'],
      ['content-types/b.toml', 'b2'],
      ['content-types/c.toml', 'c'],
    ])
    expect(schemaDiff(here, there)).toEqual([
      { path: 'content-types/a.toml', change: 'only-here' },
      { path: 'content-types/b.toml', change: 'differs' },
      { path: 'content-types/c.toml', change: 'only-there' },
    ])
  })

  test('a later version is later part by part, not by its text', () => {
    expect(laterVersion('1.10.0', '1.9.0')).toBe(true)
    expect(laterVersion('2', '1.9')).toBe(true)
    expect(laterVersion('1.1.0', '1.1')).toBe(false)
    expect(laterVersion('1.0.9', '1.1.0')).toBe(false)
  })
})

describe('a hosted site and the files, together (story 374)', () => {
  let local: string
  let hosted: string
  let server: Awaited<ReturnType<typeof bootServer>>
  let listening: ReturnType<typeof Bun.serve>
  let admin: Harness
  let token: string

  const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8')
  const there = (path: string) => read(hosted, path)
  const here = (path: string) => read(local, path)

  /** Spawned, not spawnSync: the hosted site answering it runs in this process. */
  const cli = async (...args: string[]) => {
    const proc = Bun.spawn(['bun', BIN, ...args], {
      cwd: local,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...(process.env as Record<string, string>),
        CROMBOLO_DB: 'sqlite',
        CROMBOLO_SQLITE_FILE: join(local, 'site.sqlite'),
        CROMBOLO_MEDIA_DIR: join(local, 'media'),
        CROMBOLO_COMPONENTS_DIR: join(local, 'components'),
        CROMBOLO_SCHEMA_DIR: join(local, 'schema'),
        CROMBOLO_ADMIN_LOGIN: 'admin@crombolo.local',
        CROMBOLO_SECRET_KEY: SECRET,
        CROMBOLO_LOG_TO_CONSOLE: 'false',
        CROMBOLO_PROFILES_FILE: join(local, 'profiles'),
        // Signed in to the hosted site as a person at a checkout is, not by
        // CROMBOLO_TOKEN, which would name this folder's site too.
        CROMBOLO_CREDENTIALS: 'file',
        CROMBOLO_CREDENTIALS_FILE: join(local, 'credentials'),
      },
    })
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, out: out + err }
  }
  const ok = async (...args: string[]) => {
    const run = await cli(...args)
    expect(run.code, run.out).toBe(0)
    return run
  }

  beforeAll(async () => {
    const schema = {
      'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
      'schema/content-types/page.toml':
        '[content-type]\nalias = "page"\nname = "Page"\nallow-at-root = true\n',
    }
    local = mkdtempSync(join(process.cwd(), 'output', 'types-hosted-here-'))
    hosted = mkdtempSync(join(process.cwd(), 'output', 'types-hosted-there-'))
    write(local, schema)
    write(hosted, schema)
    server = await bootServer({
      keepDatabase: true,
      config: {
        dialect: 'sqlite',
        sqliteFile: join(hosted, 'site.sqlite'),
        siteDir: hosted,
        schemaDir: join(hosted, 'schema'),
        componentsDir: join(hosted, 'components'),
        schemaWritable: true,
        development: true,
        secretKey: SECRET,
        cliTokens: true,
        remote: {
          enabled: true,
          environment: 'production',
          protected: false,
          approvals: false,
          maxUploadBytes: 1024 ** 2,
          oidcIssuers: [],
        },
      },
    })
    listening = Bun.serve({ port: 0, fetch: (request) => server.fetch(request) })
    admin = await signIn(server, ADMIN)
    token = (
      (await (
        await admin.post(`${BACKOFFICE}/crombolo/api/cli-tokens`, { name: 'types' })
      ).json()) as {
        token: string
      }
    ).token
    const origin = `http://localhost:${listening.port}`
    writeFileSync(join(local, 'profiles'), `[prod]\nurl = "${origin}"\n`)
    await saveSignIn(fileKeychain(join(local, 'credentials')), origin, {
      accessToken: token,
      refreshToken: '',
      expiresAt: Date.now() + 60 * 60_000,
      tokenUrl: `${origin}/token`,
      clientId: 'crombolo-cli',
    })
    await ok('types', 'sync')
  }, 120_000)

  afterAll(async () => {
    await listening?.stop(true)
    await server?.close()
    for (const dir of [local, hosted]) if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test('the same definitions check as the same', async () => {
    const same = await ok('types', 'check', '--against', 'prod')
    expect(same.out).toContain('prod has the same definitions as the files')
  })

  test('a new type goes into the files, then onto the site, whose version the files take', async () => {
    const made = await ok(
      'types',
      'new',
      'content-type',
      'article',
      '--at-root',
      '--no-view',
      '--to',
      'prod',
      '-o',
      'json',
    )
    const result = JSON.parse(made.out) as {
      hosted: { site: string; applied: boolean; version: string }
    }
    expect(result.hosted).toMatchObject({ site: 'prod', applied: true, version: '1.1.0' })
    expect(there(ARTICLE)).toBe(here(ARTICLE))
    expect(here('schema/schema.toml')).toContain('1.1.0')
    expect(await new ContentTypeRepository(server.db).byAlias('article')).toBeDefined()
    await ok('types', 'check', '--against', 'prod')
  }, 10_000)

  test('a site changed since is refused before anything is written, and the difference listed', async () => {
    writeFileSync(
      join(hosted, ARTICLE),
      there(ARTICLE).replace('name = "Article"', 'name = "News"'),
    )
    const before = here(ARTICLE)
    const refused = await cli('types', 'update', 'article', '--name', 'Story', '--to', 'prod')
    expect(refused.code, refused.out).toBe(ERROR_KINDS.conflict.exitCode)
    expect(refused.out).toContain('content-types/article.toml')
    expect(refused.out).toContain('types export --from prod')
    expect(here(ARTICLE)).toBe(before)

    const differs = await cli('types', 'check', '--against', 'prod', '-o', 'json')
    expect(differs.code).toBe(OUTCOMES.problems_found.code)
    expect(
      (JSON.parse(differs.out) as { against: { differences: unknown[] } }).against.differences,
    ).toEqual([{ path: 'content-types/article.toml', change: 'differs' }])
  }, 10_000)

  test("types export --from brings the site's definitions into the files", async () => {
    await ok('types', 'export', '--from', 'prod', '--yes')
    expect(here(ARTICLE)).toContain('name = "News"')
    await ok('types', 'check', '--against', 'prod')
    await ok('types', 'update', 'article', '--name', 'Story', '--to', 'prod')
    expect(there(ARTICLE)).toContain('name = "Story"')
    expect(here(ARTICLE)).toBe(there(ARTICLE))
  }, 10_000)

  test('--force changes it there though the site has moved on', async () => {
    writeFileSync(
      join(hosted, ARTICLE),
      there(ARTICLE).replace('name = "Story"', 'name = "Elsewhere"'),
    )
    await ok('types', 'update', 'article', '--name', 'Feature', '--to', 'prod', '--force')
    expect(there(ARTICLE)).toContain('name = "Feature"')
    expect(here(ARTICLE)).toBe(there(ARTICLE))
  })

  test('--all makes the site match the files, removing what only it has', async () => {
    write(hosted, {
      'schema/content-types/extra.toml':
        '[content-type]\nalias = "extra"\nname = "Extra"\nallow-at-root = true\n',
    })
    const unasked = await cli(
      'types',
      'update',
      'article',
      '--name',
      'Piece',
      '--to',
      'prod',
      '--all',
    )
    expect(unasked.code, unasked.out).toBe(ERROR_KINDS.confirmation_required.exitCode)
    expect(unasked.out).toContain('content-types/extra.toml')
    await ok('types', 'update', 'article', '--name', 'Piece', '--to', 'prod', '--all', '--yes')
    expect(existsSync(join(hosted, 'schema/content-types/extra.toml'))).toBe(false)
    expect(there(ARTICLE)).toContain('name = "Piece"')
    await ok('types', 'check', '--against', 'prod')
  }, 10_000)

  test('a rename goes to the site, unless views or content files name the alias', async () => {
    await ok('types', 'new', 'content-type', 'note', '--at-root', '--no-view', '--to', 'prod')
    await ok('types', 'rename', 'note', 'memo', '--to', 'prod')
    expect(await new ContentTypeRepository(server.db).byAlias('memo')).toBeDefined()
    await ok('types', 'check', '--against', 'prod')

    write(local, {
      'components/article.tsx':
        "export default ({ model }) => <main class={model.contentType.alias === 'article' ? 'a' : ''} />\n",
    })
    const before = here(ARTICLE)
    const refused = await cli('types', 'rename', 'article', 'story', '--everywhere', '--to', 'prod')
    expect(refused.code, refused.out).toBe(ERROR_KINDS.refused.exitCode)
    expect(refused.out).toContain('components/article.tsx')
    expect(here(ARTICLE)).toBe(before)
    expect(here('components/article.tsx')).toContain("'article'")
    rmSync(join(local, 'components/article.tsx'))
  }, 10_000)

  test('a type with pages on the site is refused there before the files change, unless retired', async () => {
    const type = await new ContentTypeRepository(server.db).byAlias('article')
    const created = await admin.post(`${V1}/document`, {
      documentType: { id: type?.key },
      template: null,
      parent: null,
      values: [],
      variants: [{ culture: null, segment: null, name: 'First' }],
    })
    expect(created.status).toBe(201)
    const refused = await cli('types', 'remove', 'article', '--to', 'prod')
    expect(refused.code, refused.out).toBe(ERROR_KINDS.conflict.exitCode)
    expect(refused.out).toContain('--retire')
    expect(existsSync(join(local, ARTICLE))).toBe(true)
    await ok('types', 'remove', 'article', '--retire', '--to', 'prod')
    expect(existsSync(join(local, ARTICLE))).toBe(false)
    expect(existsSync(join(hosted, ARTICLE))).toBe(false)
  })

  test('the flags that go with --to are refused without it', async () => {
    const run = await cli('types', 'update', 'page', '--name', 'Pages', '--force')
    expect(run.code, run.out).toBe(ERROR_KINDS.usage.exitCode)
    expect(run.out).toContain('go with --to')
  })
})
