/**
 * From an empty directory to a working "Hello, world" site without leaving the
 * command line: scaffold it, give it a page type with a title, write its home
 * page as a seed file and apply it, publish it, put an image in a media folder,
 * get into the back office, check it, start it and read the page.
 *
 * Each step is a test of its own, in order, so a step the command line cannot do
 * fails by name. It is the worked example of a site built from the command line
 * (`docs/operations.md`).
 *
 * Named `*.integration.ts`, so `bun test` does not collect it: it spawns the CLI
 * per step and boots the site. `bun run test:integration` runs it, and CI does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')

interface Run {
  code: number
  out: string
  err: string
}

let dir: string
let server: { url: string; stop(): Promise<void> } | undefined

/** The site's own defaults: nothing the test harness aims elsewhere. */
function environment(): Record<string, string> {
  const inherited = { ...(process.env as Record<string, string>) }
  for (const name of Object.keys(inherited))
    if (name.startsWith('CROMBOLO_') && name !== 'CROMBOLO_TEMPLATES_DIR') delete inherited[name]
  return {
    ...inherited,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_LOGS_DIR: join(dir, 'logs'),
    CROMBOLO_LOG_TO_CONSOLE: 'false',
  }
}

/** A command in the site's directory, as somebody standing in it would run it. */
async function cli(...args: string[]): Promise<Run> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd: dir,
    env: environment(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), 60_000)
  try {
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    return { code: await proc.exited, out, err }
  } finally {
    clearTimeout(timer)
  }
}

const said = (run: Run) => `${run.out}${run.err}`

beforeAll(() => {
  mkdirSync(join(ROOT, 'output'), { recursive: true })
  dir = mkdtempSync(join(ROOT, 'output', 'hello-world-'))
})

afterAll(async () => {
  await server?.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('an empty directory to "Hello, world", through the command line alone', () => {
  let login = ''
  let password = ''

  test('1. scaffolds a site with no template', async () => {
    const run = await cli('init', '--name', 'Hello World')
    expect(run.code, said(run)).toBe(0)
    expect(existsSync(join(dir, 'schema', 'schema.toml'))).toBe(true)
  })

  test('2. a page type that may sit at the top of the tree, with its view', async () => {
    const run = await cli('types', 'new', 'content-type', 'page', '--name', 'Page', '--at-root')
    expect(run.code, said(run)).toBe(0)
    expect(existsSync(join(dir, 'components', 'page.tsx'))).toBe(true)
  })

  test('3. a body text beside the title it came with', async () => {
    const run = await cli('types', 'add-property', 'page', 'body', '--type', 'textarea')
    expect(run.code, said(run)).toBe(0)
  })

  test('4. the view shows the title', () => {
    const view = readFileSync(join(dir, 'components', 'page.tsx'), 'utf8')
    expect(view).toContain("model.text('title')")
  })

  test('5. the schema is in a good state', async () => {
    const run = await cli('types', 'check')
    expect(run.code, said(run)).toBe(0)
  })

  // Content is declared in seed files and applied (story 163), not typed into a command.
  test('6. the home page, as a seed file, applied', async () => {
    mkdirSync(join(dir, 'seed', 'content'), { recursive: true })
    writeFileSync(
      join(dir, 'seed', 'content', 'home.toml'),
      'type = "page"\nname = "Home"\n\n[values]\ntitle = "Hello, world"\n',
    )
    const check = await cli('seed', 'check')
    expect(check.code, said(check)).toBe(0)
    const run = await cli('seed', 'apply')
    expect(run.code, said(run)).toBe(0)
  })

  test('7. publishes it', async () => {
    const run = await cli('content', 'publish', '/Home')
    expect(run.code, said(run)).toBe(0)
  })

  // Story 180: Folder holds images on a site no server has ever run.
  test('8. an image goes into a media folder', async () => {
    const files = join(dir, 'to-upload', 'images')
    mkdirSync(files, { recursive: true })
    // The smallest PNG there is: one transparent pixel.
    writeFileSync(
      join(files, 'pixel.png'),
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      ),
    )
    const imported = await cli('media', 'import', join(dir, 'to-upload'))
    expect(imported.code, said(imported)).toBe(0)
    const out = await cli('media', 'move', '/images/pixel.png', '--to', '/')
    expect(out.code, said(out)).toBe(0)
    // A folder holds images on a site that has only ever been run from here.
    const back = await cli('media', 'move', '/pixel.png', '--to', '/images')
    expect(back.code, said(back)).toBe(0)
  })

  test('9. an administrator can get into the back office', async () => {
    const run = await cli('admin', 'reset-password', '-o', 'json')
    expect(run.code, said(run)).toBe(0)
    const reset = JSON.parse(run.out) as { login?: string; password?: string }
    login = reset.login ?? ''
    password = reset.password ?? ''
    expect(password.length).toBeGreaterThan(8)
  })

  test('10. the health checks pass', async () => {
    const run = await cli('health')
    expect(run.code, said(run)).toBe(0)
  })

  test('11. starts', async () => {
    const proc = Bun.spawn(['bun', CLI, 'start'], {
      cwd: dir,
      env: { ...environment(), NODE_ENV: 'production', PORT: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(), 60_000)
    const decoder = new TextDecoder()
    let banner = ''
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      banner += decoder.decode(chunk)
      if (banner.includes('└─')) break
    }
    clearTimeout(timer)
    const url = /site\s+(http:\/\/\S+)/.exec(banner)?.[1] ?? ''
    if (!url) {
      const error = await new Response(proc.stderr).text()
      throw new Error(`the site did not start:\n${banner}${error}`)
    }
    server = {
      url,
      async stop() {
        proc.kill()
        await proc.exited
      },
    }
    expect((await fetch(new URL('/health', url))).status).toBe(200)
  })

  test('12. serves the home page', async () => {
    if (!server) throw new Error('the site is not running')
    const home = await fetch(new URL('/', server.url))
    expect(home.status).toBe(200)
    expect(await home.text()).toContain('Hello, world')
  })

  test('13. the back office takes the administrator’s password', async () => {
    if (!server) throw new Error('the site is not running')
    const response = await fetch(
      new URL('/crombolo/management/api/v1/security/back-office/login', server.url),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: login, password }),
      },
    )
    expect(response.status, await response.text()).toBe(200)
  })
})
