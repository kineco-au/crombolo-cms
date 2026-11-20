/**
 * Story 378: a workspace that changed its views renders in a process of its own.
 * A template that never finishes or that crashes takes only that process with
 * it; the site's own pages go on being served. A process is stopped when idle,
 * over its memory, when its workspace closes, and past the node's limit.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { dialectUnderTest } from './support/db.ts'
import { BACKOFFICE, type Harness, signedInServer, V1 } from './support/harness.ts'

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

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

const WORKSPACES = `${BACKOFFICE}/crombolo/api/workspaces`
const enc = encodeURIComponent

async function site(settings: Record<string, unknown> = {}) {
  mkdirSync(join(process.cwd(), 'output'), { recursive: true })
  const root = mkdtempSync(join(process.cwd(), 'output', 'workspace-processes-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components/parts', 'css', 'scripts'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(join(root, 'schema', 'content-types', 'page.toml'), PAGE_TOML)
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    "import Heading from './parts/heading.tsx'\nexport default () => <main><Heading /></main>\n",
  )
  writeFileSync(
    join(root, 'components', 'parts', 'heading.tsx'),
    'export default () => <h1>Welcome</h1>\n',
  )
  writeFileSync(join(root, 'css', 'site.css'), 'body { color: black; }\n')
  writeFileSync(join(root, 'package.json'), '{ "name": "site" }\n')
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      stylesheetsDir: join(root, 'css'),
      scriptsDir: join(root, 'scripts'),
      componentsCacheDir: join(root, '.cache', 'components'),
      schemaWritable: true,
      workspaces: true,
      // A file, so a workspace's process can open the database too.
      sqliteFile: join(root, 'site.sqlite'),
      ...settings,
    },
  })
  open.push(h)
  const db = h.server.db
  const send = (method: string, path: string, body?: unknown, workspace?: string) =>
    h.call(path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(workspace ? { 'crombolo-workspace': workspace } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const opened = async (name: string) => {
    const response = await send('POST', WORKSPACES, { name })
    expect(response.status).toBe(201)
    return (await response.json()) as { key: string }
  }
  const typeKey = (await new ContentTypeRepository(db).byAlias('page'))?.key as string
  const componentKey = (await new ComponentRepository(db).byAlias('page'))?.key as string
  const created = await send('POST', `${V1}/document`, {
    documentType: { id: typeKey },
    template: { id: componentKey },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  expect(created.status).toBe(201)
  const home = created.headers.get('umb-generated-resource') as string
  expect(
    (await send('PUT', `${V1}/document/${home}/publish`, { publishSchedules: [{ culture: null }] }))
      .status,
  ).toBe(200)
  const sharedPage = async () => (await h.server.fetch(new Request('http://localhost/'))).text()
  const rendered = async (workspace: string) =>
    (await (await send('GET', `${WORKSPACES}/${workspace}/render?path=/`)).json()) as {
      status: string
      html?: string
      views: string
    }
  const saveView = (path: string, content: string, workspace?: string) =>
    send('PUT', `${V1}/partial-view/${enc(path)}`, { content }, workspace)
  return { h, db, root, send, opened, sharedPage, rendered, saveView }
}

const PID_VIEW = 'export default () => <h1>{String(process.pid)}</h1>\n'
const pidIn = (html = '') => Number(/<h1>(\d+)<\/h1>/.exec(html)?.[1])

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function ended(pid: number) {
  for (let n = 0; n < 100 && alive(pid); n++) await Bun.sleep(20)
  return !alive(pid)
}

describe(`a workspace's own process (${dialectUnderTest})`, () => {
  test('a workspace with a changed component renders in a process of its own', async () => {
    const { h, opened, rendered, saveView } = await site()
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', PID_VIEW, sale.key)
    const own = await rendered(sale.key)
    expect(own).toMatchObject({ status: 'ok', views: 'workspace' })
    const pid = pidIn(own.html)
    expect(pid).toBe(h.server.workspaceProcesses?.pidOf(sale.key) as number)
    expect(pid).not.toBe(process.pid)
    // The same process answers again.
    expect(pidIn((await rendered(sale.key)).html)).toBe(pid)
  }, 10_000)

  test('a workspace without changed files starts no process', async () => {
    const { h, opened, rendered } = await site()
    const sale = await opened('Spring sale')
    expect(await rendered(sale.key)).toMatchObject({ status: 'ok', views: 'shared' })
    expect(h.server.workspaceProcesses?.size).toBe(0)
  })

  test('an endless loop times out, naming the workspace, and Shared is served throughout', async () => {
    const { h, opened, rendered, saveView, sharedPage } = await site({ workspaceRenderSeconds: 1 })
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', 'export default () => { while (true) {} }\n', sale.key)
    const started = Date.now()
    const hanging = rendered(sale.key)
    await Bun.sleep(100)
    expect(await sharedPage()).toContain('<h1>Welcome</h1>')
    expect(Date.now() - started).toBeLessThan(900)
    const answer = await hanging
    expect(answer.status).toBe('error')
    expect(JSON.stringify(answer)).toContain('Spring sale')
    expect(h.server.workspaceProcesses?.pidOf(sale.key)).toBeUndefined()
  }, 10_000)

  test('a crash is reported against the workspace, and the next request starts it again', async () => {
    const { h, opened, rendered, saveView } = await site()
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', 'export default () => process.exit(1)\n', sale.key)
    const crashed = await rendered(sale.key)
    expect(crashed.status).toBe('error')
    expect(JSON.stringify(crashed)).toContain('Spring sale')
    await saveView('/parts/heading.tsx', PID_VIEW, sale.key)
    const again = await rendered(sale.key)
    expect(again.status).toBe('ok')
    expect(pidIn(again.html)).toBe(h.server.workspaceProcesses?.pidOf(sale.key) as number)
  }, 10_000)

  test('merged or discarded, its process ends', async () => {
    const { h, send, opened, rendered, saveView } = await site()
    for (const close of ['merge', 'discard'] as const) {
      const sale = await opened(`Sale ${close}`)
      // Each its own: the merge makes the first Shared's.
      await saveView('/parts/heading.tsx', `${PID_VIEW}// ${close}\n`, sale.key)
      const pid = pidIn((await rendered(sale.key)).html)
      expect(pid).not.toBe(process.pid)
      expect(alive(pid)).toBe(true)
      const closed =
        close === 'merge'
          ? await send('POST', `${WORKSPACES}/${sale.key}/merge`, {})
          : await send('DELETE', `${WORKSPACES}/${sale.key}`)
      expect(closed.status).toBeLessThan(300)
      expect(h.server.workspaceProcesses?.pidOf(sale.key)).toBeUndefined()
      expect(await ended(pid)).toBe(true)
    }
  }, 20_000)

  test('idle, it ends', async () => {
    const { h, opened, rendered, saveView } = await site({ workspaceProcessIdleMinutes: 0.001 })
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', PID_VIEW, sale.key)
    const pid = pidIn((await rendered(sale.key)).html)
    await Bun.sleep(100)
    h.server.workspaceProcesses?.sweep()
    expect(h.server.workspaceProcesses?.pidOf(sale.key)).toBeUndefined()
    expect(await ended(pid)).toBe(true)
  }, 10_000)

  test('over its memory, it ends', async () => {
    const { h, opened, rendered, saveView } = await site({ workspaceProcessMemoryMb: 1 })
    const sale = await opened('Spring sale')
    await saveView('/parts/heading.tsx', PID_VIEW, sale.key)
    const pid = pidIn((await rendered(sale.key)).html)
    // It reports its memory every two seconds.
    for (let n = 0; n < 40 && h.server.workspaceProcesses?.pidOf(sale.key); n++) {
      await Bun.sleep(100)
      h.server.workspaceProcesses?.sweep()
    }
    expect(h.server.workspaceProcesses?.pidOf(sale.key)).toBeUndefined()
    expect(await ended(pid)).toBe(true)
  }, 10_000)

  test('over the limit on processes, the least recently used ends', async () => {
    const { h, opened, rendered, saveView } = await site({ workspaceProcesses: 1 })
    const first = await opened('First')
    const second = await opened('Second')
    await saveView('/parts/heading.tsx', PID_VIEW, first.key)
    await saveView('/parts/heading.tsx', PID_VIEW, second.key)
    const pid = pidIn((await rendered(first.key)).html)
    expect((await rendered(second.key)).status).toBe('ok')
    expect(h.server.workspaceProcesses?.pidOf(first.key)).toBeUndefined()
    expect(h.server.workspaceProcesses?.size).toBe(1)
    expect(await ended(pid)).toBe(true)
  }, 10_000)
})
