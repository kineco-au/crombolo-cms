/**
 * Story 337: CROMBOLO_CONTENT_FILES_READONLY stops the back office changing
 * templates, stylesheets and scripts, on the server as well as in the screens,
 * whose production mode follows it.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ContentTypeRepository } from '@crombolo/data'
import { loadConfig } from '@crombolo/server'
import { type Harness, signedInServer, V1 } from './support/harness.ts'

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

const PAGE = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
`

async function site(contentFilesReadOnly: boolean) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'content-files-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components', 'css', 'scripts'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE)
  writeFileSync(join(root, 'components', 'nav.tsx'), 'export default () => <nav />\n')
  writeFileSync(join(root, 'css', 'site.css'), 'body { margin: 0 }\n')
  writeFileSync(join(root, 'scripts', 'site.js'), 'console.log(1)\n')
  const h = await signedInServer({
    config: {
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
      contentFilesReadOnly,
    },
  })
  open.push(h)
  return { h, root }
}

const enc = encodeURIComponent
const AREAS = [
  { route: 'partial-view', dir: 'components', file: 'nav.tsx', fresh: 'menu.tsx' },
  { route: 'stylesheet', dir: 'css', file: 'site.css', fresh: 'print.css' },
  { route: 'script', dir: 'scripts', file: 'site.js', fresh: 'extra.js' },
]

describe('read-only content files (story 337)', () => {
  test.each(AREAS)('$route: every change is refused, reading still works', async (area) => {
    const { h, root } = await site(true)
    const base = `${V1}/${area.route}`
    const before = readFileSync(join(root, area.dir, area.file), 'utf8')
    const refused = async (response: Response) => {
      expect(response.status).toBe(403)
      const problem = (await response.json()) as { operationStatus: string; detail: string }
      expect(problem.operationStatus).toBe('ReadOnly')
      expect(problem.detail).toContain("doesn't allow templates, stylesheets and scripts")
    }
    await refused(await h.post(base, { name: area.fresh, parent: null, content: 'x' }))
    await refused(await h.put(`${base}/${enc(`/${area.file}`)}`, { content: 'changed' }))
    await refused(await h.put(`${base}/${enc(`/${area.file}`)}/rename`, { name: area.fresh }))
    await refused(await h.del(`${base}/${enc(`/${area.file}`)}`))
    await refused(await h.post(`${base}/folder`, { name: 'shared', parent: null }))
    expect(readFileSync(join(root, area.dir, area.file), 'utf8')).toBe(before)
    expect(existsSync(join(root, area.dir, area.fresh))).toBe(false)
    expect(existsSync(join(root, area.dir, 'shared'))).toBe(false)
    const read = await h.call(`${base}/${enc(`/${area.file}`)}`)
    expect(read.status).toBe(200)
  })

  test('the Template API refuses too, and a type adds no template file', async () => {
    const { h, root } = await site(true)
    const created = await h.post(`${V1}/template`, { name: 'Home', alias: 'home' })
    expect(created.status).toBe(403)
    expect(((await created.json()) as { operationStatus: string }).operationStatus).toBe('ReadOnly')
    expect(existsSync(join(root, 'components', 'home.tsx'))).toBe(false)
    const type = (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key as string
    const withTemplate = await h.post(`${V1}/document-type/${type}/template`, {
      alias: 'page',
      name: 'Page',
      isDefault: true,
    })
    expect(withTemplate.status).toBe(403)
    expect(((await withTemplate.json()) as { detail: string }).detail).toContain(
      "Add the template to the site's code",
    )
    expect(existsSync(join(root, 'components', 'page.tsx'))).toBe(false)
  })

  test('the back office is told production mode exactly when the files are read-only', async () => {
    const mode = async (readOnly: boolean) => {
      const { h } = await site(readOnly)
      return (await h.json<{ runtimeMode: string }>(`${V1}/server/information`)).runtimeMode
    }
    expect(await mode(true)).toBe('Production')
    expect(await mode(false)).toBe('BackofficeDevelopment')
  })

  test('unset, the files can be changed as before', async () => {
    const { h, root } = await site(false)
    const created = await h.post(`${V1}/stylesheet`, {
      name: 'print.css',
      parent: null,
      content: 'a { color: black }',
    })
    expect(created.status).toBe(201)
    expect(readFileSync(join(root, 'css', 'print.css'), 'utf8')).toBe('a { color: black }')
  })

  test('the setting reads true only when it says so, in production too', () => {
    const env = Bun.env as Record<string, string | undefined>
    const read = (value: string | undefined, nodeEnv?: string) => {
      const before = [env.CROMBOLO_CONTENT_FILES_READONLY, env.NODE_ENV]
      try {
        env.CROMBOLO_CONTENT_FILES_READONLY = value
        if (value === undefined) delete env.CROMBOLO_CONTENT_FILES_READONLY
        if (nodeEnv) env.NODE_ENV = nodeEnv
        return loadConfig({}).contentFilesReadOnly
      } finally {
        env.CROMBOLO_CONTENT_FILES_READONLY = before[0]
        if (before[0] === undefined) delete env.CROMBOLO_CONTENT_FILES_READONLY
        env.NODE_ENV = before[1]
        if (before[1] === undefined) delete env.NODE_ENV
      }
    }
    expect(read(undefined)).toBe(false)
    expect(read(undefined, 'production')).toBe(false)
    expect(read('false')).toBe(false)
    expect(read('true')).toBe(true)
  })
})
