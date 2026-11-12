/**
 * Story 342: the schema exported from Settings as TOML, and schema files
 * uploaded to wait for an administrator's approval on the Changes dashboard.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_BACKOFFICE_PATH } from '@crombolo/core'
import { ContentTypeRepository } from '@crombolo/data'
import { schemaPathOf } from '@crombolo/server'
import { readZip, writeZip, ZipError } from '../packages/server/src/zip.ts'
import { type Harness, signedInServer } from './support/harness.ts'

const API = `${DEFAULT_BACKOFFICE_PATH}/crombolo/api`
const EXPORT = `${API}/schema-transfer/export`
const IMPORT = `${API}/schema-transfer/import`
const LIMITS = { maxEntries: 50, maxEntryBytes: 1024, maxTotalBytes: 4096 }

const dirs: string[] = []
const open: Harness[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const encoder = new TextEncoder()
const type = (alias: string, name: string) =>
  `[content-type]\nalias = "${alias}"\nname = "${name}"\nallow-at-root = true\n`

async function site(options: { writable?: boolean } = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const schemaDir = mkdtempSync(join(process.cwd(), 'output', 'schema-transfer-'))
  dirs.push(schemaDir)
  mkdirSync(join(schemaDir, 'content-types'), { recursive: true })
  writeFileSync(join(schemaDir, 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(schemaDir, 'content-types', 'home-page.toml'), type('homePage', 'Home Page'))
  const h = await signedInServer({
    config: { schemaDir, schemaWritable: options.writable ?? true, development: false },
  })
  open.push(h)
  return { h, schemaDir }
}

const upload = (h: Harness, name: string, body: Uint8Array) =>
  h.call(`${IMPORT}?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: new Blob([body as Uint8Array<ArrayBuffer>]),
  })

const zipOf = (files: Record<string, string>) =>
  writeZip(Object.entries(files).map(([path, text]) => ({ path, bytes: encoder.encode(text) })))

const audited = async (h: Harness) =>
  (
    await h.server.db.q
      .selectFrom('audit_entry')
      .select(['action', 'entity_type', 'detail'])
      .orderBy('id')
      .execute()
  ).filter((row) => /schema|e-?mail/i.test(row.entity_type ?? ''))

describe('the schema layout an import accepts (story 342)', () => {
  test('TOML in the folders a schema has, with or without the schema folder around it', () => {
    expect(schemaPathOf('schema/content-types/article.toml')).toBe('content-types/article.toml')
    expect(schemaPathOf('content-types/article.toml')).toBe('content-types/article.toml')
    expect(schemaPathOf('languages.toml')).toBe('languages.toml')
    expect(schemaPathOf('forms/contact/enquiry.toml')).toBe('forms/contact/enquiry.toml')
    // Code never arrives this way, nor anything outside the layout.
    expect(schemaPathOf('migrations/001-rename.ts')).toBeUndefined()
    expect(schemaPathOf('content-types/nested/article.toml')).toBeUndefined()
    expect(schemaPathOf('../content-types/article.toml')).toBeUndefined()
    expect(schemaPathOf('elsewhere.toml')).toBeUndefined()
    expect(schemaPathOf('content-types/.hidden.toml')).toBeUndefined()
  })
})

describe('reading an uploaded zip', () => {
  test('gives back what was written', () => {
    const entries = readZip(zipOf({ 'a.toml': 'one', 'b/c.toml': 'two'.repeat(50) }), LIMITS)
    expect(entries.map((e) => [e.path, new TextDecoder().decode(e.bytes)])).toEqual([
      ['a.toml', 'one'],
      ['b/c.toml', 'two'.repeat(50)],
    ])
  })

  test('refuses what is not a zip, or unpacks past the limits', () => {
    expect(() => readZip(encoder.encode('not a zip at all'), LIMITS)).toThrow(ZipError)
    expect(() => readZip(zipOf({ 'big.toml': 'x'.repeat(2000) }), LIMITS)).toThrow('too large')
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`${i}.toml`, 'x']))
    expect(() => readZip(zipOf(many), LIMITS)).toThrow('more than 50 files')
  })
})

describe('exporting the schema (story 342)', () => {
  test('downloads every TOML file under a schema folder, and nothing else', async () => {
    const { h, schemaDir } = await site()
    mkdirSync(join(schemaDir, 'migrations'))
    writeFileSync(join(schemaDir, 'migrations', '001.ts'), 'export default {}')
    const response = await h.call(EXPORT)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/zip')
    const paths = readZip(new Uint8Array(await response.arrayBuffer()), LIMITS).map((e) => e.path)
    expect(paths).toEqual(['schema/content-types/home-page.toml', 'schema/schema.toml'])
  })

  test('importing it back into the same site finds nothing to change', async () => {
    const { h } = await site()
    const exported = new Uint8Array(await (await h.call(EXPORT)).arrayBuffer())
    const response = await upload(h, 'schema.zip', exported)
    expect(response.status).toBe(400)
    expect(((await response.json()) as { message: string }).message).toContain('nothing to import')
  })
})

describe('importing the schema (story 342)', () => {
  test('an upload waits for approval, changing nothing, then applies', async () => {
    const { h, schemaDir } = await site()
    const response = await upload(
      h,
      'from-staging.zip',
      zipOf({ 'schema/content-types/article.toml': type('article', 'Article') }),
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, added: ['content-types/article.toml'] })
    expect(existsSync(join(schemaDir, 'content-types', 'article.toml'))).toBe(false)
    expect(await new ContentTypeRepository(h.server.db).byAlias('article')).toBeUndefined()

    // The Changes dashboard shows it to an administrator.
    const report = await h.json<{ schemaImport: { added: string[]; blocked: boolean } }>(
      `${API}/change-report`,
    )
    expect(report.schemaImport).toMatchObject({
      added: ['content-types/article.toml'],
      blocked: false,
    })

    const applied = await h.call(`${IMPORT}/apply`, { method: 'POST' })
    expect(applied.status).toBe(200)
    expect(readFileSync(join(schemaDir, 'content-types', 'article.toml'), 'utf8')).toContain(
      'article',
    )
    expect(await new ContentTypeRepository(h.server.db).byAlias('article')).toBeDefined()
    expect((await h.json<{ pending: unknown }>(IMPORT)).pending).toBeNull()
  })

  test('a single file goes in the folder its first table names', async () => {
    const { h } = await site()
    const response = await upload(h, 'article.toml', encoder.encode(type('article', 'Article')))
    expect(await response.json()).toMatchObject({ added: ['content-types/article.toml'] })
  })

  test('a single file for a type the site has replaces that type’s file, whatever it is called', async () => {
    const { h } = await site()
    const response = await upload(
      h,
      'download (1).toml',
      encoder.encode(type('homePage', 'Landing')),
    )
    expect(await response.json()).toMatchObject({
      added: [],
      changed: ['content-types/home-page.toml'],
    })
  })

  test('a changed file is shown as changed, and discarding it leaves the site as it was', async () => {
    const { h, schemaDir } = await site()
    await upload(
      h,
      'rename.zip',
      zipOf({ 'content-types/home-page.toml': type('homePage', 'Landing Page') }),
    )
    expect((await h.json<{ pending: { changed: string[] } }>(IMPORT)).pending.changed).toEqual([
      'content-types/home-page.toml',
    ])
    expect((await h.call(IMPORT, { method: 'DELETE' })).status).toBe(200)
    expect(readFileSync(join(schemaDir, 'content-types', 'home-page.toml'), 'utf8')).toContain(
      'Home Page',
    )
    expect((await h.call(`${IMPORT}/apply`, { method: 'POST' })).status).toBe(404)
  })

  test('refuses code, files outside the layout, and files that do not load', async () => {
    const { h } = await site()
    const code = await upload(h, 's.zip', zipOf({ 'migrations/001.ts': 'export default {}' }))
    expect(code.status).toBe(400)
    expect(((await code.json()) as { problems: string[] }).problems[0]).toContain(
      'migrations/001.ts',
    )
    const broken = await upload(
      h,
      's.zip',
      zipOf({ 'content-types/broken.toml': '[content-type]\nname = "No alias"\n' }),
    )
    expect(broken.status).toBe(400)
    expect(((await broken.json()) as { problems: string[] }).problems.length).toBeGreaterThan(0)
    expect((await h.json<{ pending: unknown }>(IMPORT)).pending).toBeNull()
  })

  test('is refused where the schema changes only with a deploy; export still works', async () => {
    const { h } = await site({ writable: false })
    expect((await h.call(EXPORT)).status).toBe(200)
    const refused = await upload(h, 'a.toml', encoder.encode(type('article', 'Article')))
    expect(refused.status).toBe(409)
  })

  test('each upload, apply and discard is audited once, saying what it changed', async () => {
    const { h } = await site()
    await upload(h, 'one.toml', encoder.encode(type('article', 'Article')))
    await h.call(IMPORT, { method: 'DELETE' })
    await upload(h, 'two.toml', encoder.encode(type('article', 'Article')))
    await h.call(`${IMPORT}/apply`, { method: 'POST' })
    const rows = (await audited(h)).filter((row) => row.entity_type === 'Schema')
    expect(rows.map((row) => row.action)).toEqual(['Upload', 'Discard', 'Upload', 'Apply'])
    expect(rows.at(-1)?.detail).toContain('content-types/two.toml')
  })
})

describe('routes that write their own audit entry', () => {
  test('are not recorded a second time as a generic write', async () => {
    const { h } = await site()
    await h.put(`${API}/email/settings`, {
      provider: 'custom',
      from: 'a@example.org',
      url: 'https://mail.example.org/send',
    })
    const rows = await audited(h)
    expect(rows.map((row) => [row.entity_type, row.action])).toEqual([['E-mail', 'Save']])
  })
})
