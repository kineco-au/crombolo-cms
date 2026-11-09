/**
 * Story 285: an import in a process of its own reaches every running node, with
 * no watcher to help, as on a folder shared over a network. Two nodes share one
 * database and one folder; the import runs through the command line.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  appendCacheInstruction,
  ComponentRepository,
  ContentTypeRepository,
  cacheInstructionsAfter,
  type Db,
  instructionEffects,
  latestCacheInstructionId,
  oldestCacheInstructionId,
} from '@crombolo/data'
import { contentHash, hashedAddress } from '@crombolo/render'
import {
  CacheInstructionPoller,
  changedFileSections,
  installBundleContent,
  PublicFiles,
  type ServerHandle,
  SiteAssets,
} from '@crombolo/server'
import { ROOT } from '../scripts/packages.ts'
import { dialectUnderTest } from './support/db.ts'
import { bootServer, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const BIN = join(ROOT, 'packages/cli/bin/crombolo.ts')
const harnesses: Harness[] = []
const servers: ServerHandle[] = []
const closers: Array<() => void> = []
const dirs: string[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) close()
  while (servers.length > 0) await servers.pop()?.close()
  while (harnesses.length > 0)
    await harnesses
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const temp = (name: string) => {
  const dir = mkdtempSync(join(process.cwd(), 'output', `reaches-nodes-${name}-`))
  dirs.push(dir)
  return dir
}

const write = (root: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
}

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

const view = (words: string) =>
  `import { asset } from '@crombolo/crombolo'
export default () => (
  <html><head><link rel="stylesheet" href={asset('/css/site.css')} /></head>
  <body><h1>${words}</h1></body></html>
)
`

const STRUCTURE = {
  'schema/schema.toml': '[schema]\nversion = "1.0.0"\n',
  'schema/content-types/page.toml': PAGE_TOML,
}

/** Two nodes on one database and folder, neither watching it. */
async function cluster() {
  const root = temp('site')
  write(root, {
    ...STRUCTURE,
    'components/page.tsx': view('The old view'),
    'css/site.css': 'body { color: red }\n',
    'scripts/site.js': 'console.log("old")\n',
    'public/kept.txt': 'kept\n',
    'public/gone.txt': 'gone\n',
    'public/changed.txt': 'old\n',
  })
  const paths = {
    siteDir: root,
    sqliteFile: join(root, 'site.sqlite'),
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    componentsCacheDir: join(root, '.crombolo-a'),
    stylesheetsDir: join(root, 'css'),
    scriptsDir: join(root, 'scripts'),
    publicDir: join(root, 'public'),
    mediaDir: join(root, 'media'),
  }
  const quiet = { watchSiteFiles: false }
  const h = await signedInServer({ config: { ...paths, nodeId: 'node-a' }, server: quiet })
  harnesses.push(h)
  const b = await bootServer({
    keepDatabase: true,
    config: { ...paths, nodeId: 'node-b', componentsCacheDir: join(root, '.crombolo-b') },
    server: quiet,
  })
  servers.push(b)
  const created = await h.post(`${V1}/document`, {
    documentType: { id: (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key },
    template: { id: (await new ComponentRepository(h.server.db).byAlias('page'))?.key },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  const key = created.headers.get('umb-generated-resource') as string
  expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(200)
  await b.poll()
  const visit = (node: ServerHandle, path: string) => node.fetch(new Request(`${ORIGIN}${path}`))
  return { h, b, root, visit, nodes: [h.server, b] as ServerHandle[] }
}

/** Runs the command line beside the nodes, in a process of its own. */
function crombolo(cwd: string, args: string[]) {
  const proc = Bun.spawnSync(['bun', BIN, ...args], {
    cwd,
    env: {
      ...process.env,
      CROMBOLO_SQLITE_FILE: join(cwd, 'site.sqlite'),
      CROMBOLO_COMPONENTS_DIR: join(cwd, 'components'),
      CROMBOLO_MEDIA_DIR: join(cwd, 'media'),
      CROMBOLO_SECRET_KEY: 'a-test-secret-key-that-is-long-enough-to-use',
    },
    stdin: 'ignore',
  })
  const err = proc.stderr.toString()
  const out = proc.stdout.toString()
  expect(proc.exitCode, `${err}\n${out}`).toBe(0)
  return out
}

function bundleOf(files: Record<string, string>) {
  const source = temp('source')
  write(source, { ...STRUCTURE, 'components/page.tsx': view('The old view'), ...files })
  const out = join(temp('bundle'), 'bundle')
  crombolo(source, ['site', 'build', source, '--out', out])
  return out
}

/** Instructions of a kind since `after`. */
const kinds = async (db: Db, after: number) =>
  (await cacheInstructionsAfter(db, after)).map((row) => row.kind)

const until = async (done: () => Promise<boolean>) => {
  const deadline = Date.now() + 8000
  while (!(await done()) && Date.now() < deadline) await Bun.sleep(50)
  expect(await done()).toBe(true)
}

describe(`an import in its own process (${dialectUnderTest})`, () => {
  test('reaches a view, a stylesheet, a script and public files on every node', async () => {
    const { h, root, visit, nodes } = await cluster()
    for (const node of nodes)
      expect(await (await visit(node, '/')).text()).toContain('The old view')
    const oldHash = contentHash('body { color: red }\n')
    const sheet = 'body { color: blue }\n'
    const before = await latestCacheInstructionId(h.server.db)

    const bundle = bundleOf({
      'components/page.tsx': view('The new view'),
      'css/site.css': sheet,
      'scripts/site.js': 'console.log("new")\n',
      'public/kept.txt': 'kept\n',
      'public/changed.txt': 'new\n',
      'public/added.txt': 'added\n',
    })
    // What a replace takes out is `changedFileSections`'s, below; here, only that a node hears.
    rmSync(join(root, 'public', 'gone.txt'))
    crombolo(root, ['site', 'apply', bundle, '--replace-files', '--backup-taken'])

    // A node's own connection may still be inside a job's transaction.
    await until(async () => (await kinds(h.server.db, before)).length >= 2)
    const told = await kinds(h.server.db, before)
    expect(told).toContain('components')
    expect(told).toContain('public-files')

    // `asset()` is one resolver per process, so both nodes hear before either is read.
    for (const node of nodes) await node.poll()
    for (const node of nodes) {
      await until(async () => (await (await visit(node, '/')).text()).includes('The new view'))
      const page = await (await visit(node, '/')).text()
      const address = hashedAddress('/css/site.css', contentHash(sheet))
      expect(page).toContain(address)
      expect(page).not.toContain(oldHash)
      expect(await (await visit(node, address)).text()).toBe(sheet)
      expect(await (await visit(node, '/css/site.css')).text()).toBe(sheet)
      expect(await (await visit(node, '/scripts/site.js')).text()).toBe('console.log("new")\n')
      expect(await (await visit(node, '/added.txt')).text()).toBe('added\n')
      expect(await (await visit(node, '/changed.txt')).text()).toBe('new\n')
      expect((await visit(node, '/gone.txt')).status).toBe(404)
    }
  }, 60_000)

  test('that changes nothing tells nobody', async () => {
    const { h, root } = await cluster()
    const same = {
      'components/page.tsx': readFileSync(join(root, 'components', 'page.tsx'), 'utf8'),
      'css/site.css': 'body { color: red }\n',
      'scripts/site.js': 'console.log("old")\n',
      'public/kept.txt': 'kept\n',
      'public/gone.txt': 'gone\n',
      'public/changed.txt': 'old\n',
    }
    const bundle = bundleOf(same)
    const before = await latestCacheInstructionId(h.server.db)
    crombolo(root, ['site', 'apply', bundle, '--backup-taken'])
    // A poll lets any job holding this connection finish, so absence means something.
    await h.server.poll()
    const told = await kinds(h.server.db, before)
    expect(told).not.toContain('components')
    expect(told).not.toContain('public-files')
  }, 60_000)

  test('that touches only public/ leaves the views alone', async () => {
    const { h, root } = await cluster()
    const bundle = bundleOf({ 'public/new.txt': 'new\n' })
    const before = await latestCacheInstructionId(h.server.db)
    crombolo(root, ['site', 'apply', bundle, '--backup-taken'])
    await until(async () => (await kinds(h.server.db, before)).includes('public-files'))
    const told = await kinds(h.server.db, before)
    expect(told).not.toContain('components')
  }, 60_000)
})

describe(`a revert, and an import inside a node (${dialectUnderTest})`, () => {
  test('a revert from the command line reaches the nodes too', async () => {
    const { h, root, visit, nodes } = await cluster()
    const bundle = bundleOf({ 'public/new.txt': 'new\n' })
    const applied = crombolo(root, ['site', 'apply', bundle, '--backup-taken', '-o', 'json'])
    const { runId } = JSON.parse(applied) as { runId: string }
    for (const node of nodes) await node.poll()
    for (const node of nodes) expect((await visit(node, '/new.txt')).status).toBe(200)

    const before = await latestCacheInstructionId(h.server.db)
    crombolo(root, ['site', 'revert', runId, '--backup-taken'])
    await until(async () => (await kinds(h.server.db, before)).includes('public-files'))
    for (const node of nodes) await node.poll()
    for (const node of nodes) expect((await visit(node, '/new.txt')).status).toBe(404)
  }, 60_000)

  test('an import run by a node reaches that node, with no watcher', async () => {
    const { h, visit, nodes } = await cluster()
    const bundle = bundleOf({
      'components/page.tsx': view('The new view'),
      'public/new.txt': 'new\n',
    })
    const result = await installBundleContent(h.server.db, h.server.config, {
      bundle,
      backupTaken: true,
      replaceFiles: true,
    })
    expect(result.runId).toBeDefined()
    for (const node of nodes) await node.poll()
    for (const node of nodes) {
      await until(async () => (await (await visit(node, '/')).text()).includes('The new view'))
      expect(await (await visit(node, '/new.txt')).text()).toBe('new\n')
    }
  }, 60_000)
})

describe('what an install changed', () => {
  const config = (root: string) => ({
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    stylesheetsDir: join(root, 'css'),
    scriptsDir: join(root, 'scripts'),
    publicDir: join(root, 'public'),
  })
  const plan = (files: Array<[string, 'create' | 'overwrite' | 'unchanged']>) => ({
    files: files.map(([path, action]) => ({ path, target: path, action })),
    dictionaryItems: 0,
    migrations: [],
    schema: undefined,
    sections: [],
  })
  const changed = (
    root: string,
    carries: Record<string, string[]>,
    files: Array<[string, 'create' | 'overwrite' | 'unchanged']>,
    options: { replace?: boolean; withoutFiles?: boolean } = {},
  ) =>
    changedFileSections(
      config(root) as never,
      { carries, files: new Map() },
      plan(files),
      options,
    ).sort()

  test('is what the plan creates or overwrites, and never schema', () => {
    const root = temp('plan')
    expect(
      changed(root, {}, [
        ['components/a.tsx', 'create'],
        ['styles/a.css', 'unchanged'],
        ['public/a.png', 'overwrite'],
        ['schema/a.toml', 'overwrite'],
      ]),
    ).toEqual(['components', 'public'])
  })

  test('is what a replace takes out, dotfiles too, and nothing it keeps', () => {
    const root = temp('plan')
    write(root, { 'public/.well-known/old.txt': 'x', 'css/kept.css': 'x' })
    const carries = { styles: ['styles/kept.css'] }
    expect(changed(root, carries, [], { replace: true })).toEqual(['public'])
    expect(changed(root, carries, [])).toEqual([])
  })

  test('is nothing when the files were left out', () => {
    const root = temp('plan')
    expect(changed(root, {}, [['public/a.png', 'create']], { withoutFiles: true })).toEqual([])
  })
})

describe('the instruction', () => {
  test('moves no checkpoint and leaves pages and media alone', async () => {
    const h = await signedInServer()
    harnesses.push(h)
    expect(await appendCacheInstruction(h.server.db, { kind: 'public-files' })).toBeNull()
    expect(instructionEffects('public-files', {})).toEqual({ pages: false, media: 'keep' })
  })
})

describe('a node told of a change', () => {
  test('lists public/ again, and again as a slow folder catches up', async () => {
    const root = temp('slow')
    write(root, { 'public/first.txt': '1' })
    const files = new PublicFiles(join(root, 'public'), '/crombolo', {
      watch: false,
      relistAfterMs: [100, 200],
    })
    files.start()
    closers.push(() => files.close())
    write(root, { 'public/second.txt': '2' })
    expect(files.has('/second.txt')).toBe(false)
    files.changed()
    expect(files.has('/second.txt')).toBe(true)
    // Told before the folder shows it.
    write(root, { 'public/third.txt': '3' })
    expect(files.has('/third.txt')).toBe(false)
    await until(async () => files.has('/third.txt'))
  })

  test('hashes its stylesheets again, forgets one that went, and finds a nested folder', () => {
    const root = temp('assets')
    write(root, { 'css/a.css': 'a', 'css/b.css': 'b' })
    const assets = new SiteAssets([{ prefix: '/css', dir: join(root, 'css'), extension: '.css' }], {
      watch: false,
    })
    assets.start()
    closers.push(() => assets.close())
    expect(assets.address('/css/a.css')).toBe(hashedAddress('/css/a.css', contentHash('a')))
    rmSync(join(root, 'css', 'b.css'))
    write(root, { 'css/a.css': 'changed', 'css/deep/c.css': 'c' })
    assets.rescan()
    expect(assets.address('/css/a.css')).toBe(hashedAddress('/css/a.css', contentHash('changed')))
    expect(assets.address('/css/b.css')).toBeUndefined()
    expect(assets.address('/css/deep/c.css')).toBe(
      hashedAddress('/css/deep/c.css', contentHash('c')),
    )
  })
})

describe('a node that fell behind', () => {
  const poller = (h: Harness, onMissed: () => void) =>
    new CacheInstructionPoller({
      db: h.server.db,
      nodeId: 'behind',
      nodeState: h.server.schema.nodeState,
      onInstruction: () => {},
      onMissed,
    })

  test('looks again when the rows it had not read were pruned, once', async () => {
    const h = await signedInServer()
    harnesses.push(h)
    const db = h.server.db
    await appendCacheInstruction(db, { kind: 'components' })
    const missed = spyOn({ onMissed() {} }, 'onMissed')
    const node = poller(h, missed)
    await node.start(0)
    await appendCacheInstruction(db, { kind: 'public-files' })
    await appendCacheInstruction(db, { kind: 'public-files' })
    await appendCacheInstruction(db, { kind: 'public-files' })
    const newest = await latestCacheInstructionId(db)
    await db.exec('DELETE FROM cache_instruction WHERE id < ?', [newest])
    expect(await oldestCacheInstructionId(db)).toBe(newest)
    await node.poll()
    expect(missed).toHaveBeenCalledTimes(1)
    await node.poll()
    expect(missed).toHaveBeenCalledTimes(1)
    node.stop()
  })

  test('does not when it has read everything', async () => {
    const h = await signedInServer()
    harnesses.push(h)
    const db = h.server.db
    const missed = spyOn({ onMissed() {} }, 'onMissed')
    await appendCacheInstruction(db, { kind: 'components' })
    const node = poller(h, missed)
    await node.start(0)
    await appendCacheInstruction(db, { kind: 'public-files' })
    await node.poll()
    expect(missed).not.toHaveBeenCalled()
    node.stop()
  })
})
