/**
 * Story 284: a site's `public/` folder, served at the root of the site at the
 * same paths. Only a file in the index answers, so an unknown path costs
 * nothing and nothing built from the URL reaches the disk. A file wins over a
 * route, a page and a generated `robots.txt`, and never over the CMS's paths.
 */
import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import fs, { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ok, route } from '@crombolo/common'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import { contentHash, hashedAddress } from '@crombolo/render'
import type { CromboloConfig, ServerHandle } from '@crombolo/server'
import { isReservedPublicPath, PublicFiles, publicClashes } from '@crombolo/server'
import { scaffoldFiles } from '../packages/cli/src/templates.ts'
import { bootServer, type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

const open: ServerHandle[] = []
const harnesses: Harness[] = []
const lists: PublicFiles[] = []
const dirs: string[] = []
afterEach(async () => {
  for (const list of lists.splice(0)) list.close()
  while (open.length > 0) await open.pop()?.close()
  while (harnesses.length > 0)
    await harnesses
      .pop()
      ?.db.close()
      .catch(() => {})
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

const write = (root: string, path: string, body: string | Uint8Array) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), body)
}

const PAGE_TOML = `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page"]
default-component = "page"
`

const LOGO = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80])

function folder() {
  const root = mkdtempSync(join(process.cwd(), 'output', 'public-folder-'))
  dirs.push(root)
  mkdirSync(join(root, 'schema'), { recursive: true })
  mkdirSync(join(root, 'components'), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  return root
}

async function site(config: Partial<CromboloConfig> = {}, root = folder()) {
  write(root, 'public/images/logo.png', LOGO)
  write(root, 'public/images/my logo.txt', 'spaced\n')
  write(root, 'public/empty.txt', '')
  write(root, 'public/google1234.html', '<p>verified</p>')
  write(root, 'public/app.3f9a1c2b.js', 'vendor\n')
  write(root, 'public/.env', 'SECRET=1\n')
  write(root, 'public/.hidden/file.txt', 'no\n')
  write(root, 'public/.well-known/security.txt', 'Contact: a@example.com\n')
  write(root, 'public/.well-known/.nested', 'no\n')
  write(root, 'public/.well-known/crombolo-remote', 'mine\n')
  write(root, 'public/css/site.css', 'shadowing\n')
  write(root, 'public/media/x.txt', 'shadowing\n')
  write(root, 'public/health', 'shadowing\n')
  write(root, 'public/crombolo/x.txt', 'shadowing\n')
  write(root, 'outside.txt', 'outside\n')
  symlinkSync(join(root, 'outside.txt'), join(root, 'public', 'out.txt'))
  symlinkSync(join(root, 'public', 'google1234.html'), join(root, 'public', 'in.html'))
  const paths = {
    siteDir: root,
    sqliteFile: join(root, 'site.sqlite'),
    schemaDir: join(root, 'schema'),
    componentsDir: join(root, 'components'),
    componentsCacheDir: join(root, '.crombolo'),
    publicDir: join(root, 'public'),
  }
  // A `web` or `api` node does not migrate, so an `all` node sets the database up first.
  const first = await bootServer({ config: { ...paths, ...config, role: 'all' } })
  if (!config.role || config.role === 'all') open.push(first)
  else await first.close()
  const server =
    !config.role || config.role === 'all'
      ? first
      : await bootServer({ keepDatabase: true, config: { ...paths, ...config } })
  if (server !== first) open.push(server)
  const visit = (path: string, init: RequestInit = {}) =>
    server.fetch(new Request(`${ORIGIN}${path}`, init))
  return { server, root, visit }
}

const control = (response: Response) => response.headers.get('cache-control')

describe.each(['all', 'web'] as const)('a public file on an `%s` node', (role) => {
  test('answers at its path, with its type, an ETag and a conditional request', async () => {
    const { visit } = await site({ role })
    const logo = await visit('/images/logo.png')
    expect(logo.status).toBe(200)
    expect(logo.headers.get('content-type')).toBe('image/png')
    expect(logo.headers.get('x-content-type-options')).toBe('nosniff')
    expect(control(logo)).toBe('no-cache')
    expect(new Uint8Array(await logo.arrayBuffer())).toEqual(LOGO)
    const etag = logo.headers.get('etag') as string
    expect(etag).toBeTruthy()
    const again = await visit('/images/logo.png', { headers: { 'if-none-match': etag } })
    expect(again.status).toBe(304)
  })

  test('takes a name with a space, an empty file, and HEAD', async () => {
    const { visit } = await site({ role })
    expect(await (await visit('/images/my%20logo.txt')).text()).toBe('spaced\n')
    const empty = await visit('/empty.txt')
    expect(empty.status).toBe(200)
    expect(await empty.text()).toBe('')
    const head = await visit('/images/logo.png', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('image/png')
  })

  test('is bytes: HTML and scripts are served, not run', async () => {
    const { visit } = await site({ role })
    const page = await visit('/google1234.html')
    expect(await page.text()).toBe('<p>verified</p>')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('no dotfile, no symlink out and no climbing answers, and .well-known does', async () => {
    const { visit } = await site({ role })
    for (const path of [
      '/.env',
      '/.hidden/file.txt',
      '/.well-known/.nested',
      '/out.txt',
      '/images/%2e%2e/%2e%2e/outside.txt',
      '/..%2foutside.txt',
      '/images/%E0%A4%A',
    ])
      expect((await visit(path)).status, path).toBe(404)
    expect(await (await visit('/.well-known/security.txt')).text()).toContain('Contact:')
    expect(await (await visit('/in.html')).text()).toBe('<p>verified</p>')
  })

  test('cannot take a reserved path', async () => {
    const { visit, root } = await site({ role, stylesheetsDir: join(folder(), 'css') })
    expect((await visit('/css/site.css')).status).toBe(404)
    expect((await visit('/media/x.txt')).status).toBe(404)
    expect((await visit('/crombolo/x.txt')).status).toBe(404)
    expect(await (await visit('/health')).text()).not.toContain('shadowing')
    expect(root).toBeTruthy()
  })

  test('replaces the generated robots.txt only when there is one', async () => {
    const generated = await site({ role })
    expect(await (await generated.visit('/robots.txt')).text()).toContain('User-agent')
    const root = folder()
    write(root, 'public/robots.txt', 'mine\n')
    const replaced = await site({ role }, root)
    expect(await (await replaced.visit('/robots.txt')).text()).toBe('mine\n')
  })

  test('falls through for a method a file does not take', async () => {
    const { visit } = await site({ role })
    const posted = await visit('/images/logo.png', { method: 'POST', body: 'x' })
    expect(posted.headers.get('content-type')).not.toBe('image/png')
  })

  test('wins over a route, and runs through the middleware', async () => {
    const seen: string[] = []
    const { visit } = await site({
      role,
      routes: [route('/empty.txt', { GET: () => ok('the route') })],
      middleware: {
        request: [
          {
            name: 'staging password',
            handle(request, next) {
              seen.push(new URL(request.url).pathname)
              return request.headers.get('x-locked')
                ? new Response('locked', { status: 401 })
                : next(request)
            },
          },
        ],
      },
    })
    expect(await (await visit('/empty.txt')).text()).toBe('')
    expect(seen).toContain('/empty.txt')
    const locked = await visit('/images/logo.png', { headers: { 'x-locked': '1' } })
    expect(locked.status).toBe(401)
  })

  test('has a hashed address kept for a year, and a stale one is nothing', async () => {
    const { visit, root } = await site({ role })
    const hash = contentHash(LOGO)
    const kept = await visit(hashedAddress('/images/logo.png', hash))
    expect(kept.status).toBe(200)
    expect(control(kept)).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await kept.arrayBuffer())).toEqual(LOGO)
    const stale = await visit('/images/logo.00000000.png')
    expect(stale.status).toBe(404)
    expect(control(stale)).toBe('no-store')
    // A file named like a hashed address is itself, as a vendor's build names them.
    expect(await (await visit('/app.3f9a1c2b.js')).text()).toBe('vendor\n')
    // A change the watcher has yet to report is never kept under the old address.
    write(root, 'public/images/logo.png', 'a new logo')
    expect((await visit(hashedAddress('/images/logo.png', hash))).status).toBe(404)
  })
})

describe('a page at the same address', () => {
  test('loses to the file', async () => {
    const root = folder()
    mkdirSync(join(root, 'schema', 'content-types'), { recursive: true })
    write(root, 'schema/content-types/page.toml', PAGE_TOML)
    write(root, 'components/page.tsx', 'export default () => <h1>The page</h1>\n')
    const h = await signedInServer({
      config: {
        siteDir: root,
        schemaDir: join(root, 'schema'),
        componentsDir: join(root, 'components'),
        componentsCacheDir: join(root, '.crombolo'),
        publicDir: join(root, 'public'),
      },
    })
    harnesses.push(h)
    const page = async (name: string) => {
      const created = await h.post(`${V1}/document`, {
        documentType: { id: (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key },
        template: { id: (await new ComponentRepository(h.server.db).byAlias('page'))?.key },
        parent: null,
        values: [],
        variants: [{ culture: null, segment: null, name }],
      })
      const key = created.headers.get('umb-generated-resource') as string
      const published = await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })
      expect(published.status).toBe(200)
    }
    await page('Home')
    await page('About')
    const visit = (path: string) => h.server.fetch(new Request(`${ORIGIN}${path}`))
    expect(await (await visit('/about')).text()).toContain('The page')
    write(root, 'public/about', 'the file')
    await Bun.sleep(300)
    expect(await (await visit('/about')).text()).toBe('the file')
  })
})

describe('a new site', () => {
  test('has the folder, which git keeps and nothing serves', () => {
    expect(scaffoldFiles().map((file) => file.path)).toContain('public/.gitkeep')
  })
})

describe('an `api` node', () => {
  test('answers nothing for a public file', async () => {
    const { visit } = await site({ role: 'api' })
    expect((await visit('/images/logo.png')).status).toBe(404)
    expect(await (await visit('/robots.txt')).text()).not.toContain('Disallow: /mine')
  })
})

describe('the index', () => {
  const started = (root: string) => {
    const files = new PublicFiles(join(root, 'public'), '/crombolo')
    files.start()
    lists.push(files)
    return files
  }
  const request = (path: string) => new Request(`${ORIGIN}${path}`)
  const until = async (done: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!done() && Date.now() < deadline) await Bun.sleep(20)
    expect(done()).toBe(true)
  }

  test('a site with no folder has nothing, and a miss touches no file', async () => {
    const root = folder()
    const empty = started(root)
    expect(empty.paths()).toEqual([])
    write(root, 'second/public/a.txt', 'a')
    const files = started(join(root, 'second'))
    const stat = spyOn(fs, 'statSync')
    const exists = spyOn(fs, 'existsSync')
    const read = spyOn(fs, 'readdirSync')
    try {
      expect(await files.serve(request('/about'), '/about')).toBeUndefined()
      expect(
        await files.serve(request('/about.12345678.png'), '/about.12345678.png'),
      ).toBeUndefined()
      expect(files.has('/about')).toBe(false)
      expect(stat).not.toHaveBeenCalled()
      expect(exists).not.toHaveBeenCalled()
      expect(read).not.toHaveBeenCalled()
    } finally {
      stat.mockRestore()
      exists.mockRestore()
      read.mockRestore()
    }
  })

  test('sees a file added, removed and changed, without a restart', async () => {
    const root = folder()
    write(root, 'public/a.txt', 'a')
    const files = started(root)
    write(root, 'public/deep/down/b.txt', 'b')
    await until(() => files.has('/deep/down/b.txt'))
    const before = files.address('/a.txt')
    write(root, 'public/a.txt', 'changed, and longer')
    await until(() => files.address('/a.txt') !== before)
    rmSync(join(root, 'public', 'a.txt'))
    await until(() => !files.has('/a.txt'))
  })

  test('sees a folder made after the server started', async () => {
    const root = folder()
    const files = started(root)
    write(root, 'public/first.txt', 'first')
    await until(() => files.has('/first.txt'))
    write(root, 'public/second.txt', 'second')
    await until(() => files.has('/second.txt'))
  })

  test('says which files hide a page', async () => {
    const root = folder()
    write(root, 'public/about', 'a file')
    write(root, 'public/logo.png', LOGO)
    const files = started(root)
    const pages = new Set(['/about', '/contact'])
    expect(await files.hiding(async (path) => pages.has(path))).toEqual(['/about'])
  })

  test('names the address of a file it has, and not of one it has not', () => {
    const root = folder()
    write(root, 'public/images/logo.png', LOGO)
    const files = started(root)
    expect(files.address('/images/logo.png')).toBe(
      hashedAddress('/images/logo.png', contentHash(LOGO)),
    )
    expect(files.address('/images/none.png')).toBeUndefined()
  })
})

describe('clashes, from the files alone', () => {
  test('a reserved path, a route and a generated file are each named', () => {
    const root = folder()
    write(root, 'public/css/site.css', 'x')
    write(root, 'public/.well-known/crombolo-remote', 'x')
    write(root, 'public/robots.txt', 'x')
    write(root, 'public/shop/item', 'x')
    write(root, 'public/fine.png', 'x')
    const clashes = publicClashes({
      publicDir: join(root, 'public'),
      backOfficePath: '/crombolo',
      routes: [{ path: '/shop/:id' }],
    })
    expect(clashes.map(({ kind, address }) => [kind, address]).sort()).toEqual([
      ['generated', '/robots.txt'],
      ['reserved', '/.well-known/crombolo-remote'],
      ['reserved', '/css/site.css'],
      ['route', '/shop/item'],
    ])
  })

  test('the back office path and the case of a path count', () => {
    expect(isReservedPublicPath('/office/a.png', '/office')).toBe(true)
    expect(isReservedPublicPath('/CSS/a.css', '/crombolo')).toBe(true)
    expect(isReservedPublicPath('/images/a.png', '/crombolo')).toBe(false)
    expect(isReservedPublicPath('/robots.txt', '/crombolo')).toBe(false)
  })

  test('a site with no folder has none', () => {
    expect(publicClashes({ publicDir: join(folder(), 'public'), backOfficePath: '/x' })).toEqual([])
  })
})
