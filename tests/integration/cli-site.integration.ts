/**
 * Story 252: a site built with commands alone, from `crombolo init` to pages
 * served, with a form, a group, a workflow and a webhook, then shipped as a
 * bundle to a second site that serves the same pages. The steps are the
 * walkthrough's own, read from "A site from the command line", so the page
 * cannot drift from what the commands do. No command's text output
 * names a definition file: only `init`'s one line about what to commit, and the
 * commands whose job is files (`generate`, `bundle export`, `bundle build`).
 *
 * Named `*.integration.ts`, so `bun test` does not collect it: it spawns
 * processes and boots servers. `bun run test:integration` runs it, and CI does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { DOCS_DIR, parseGuide, walkthroughOf } from '../../scripts/docs-site.ts'
import { words } from '../support/doc-commands.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')

/** The commands whose job is files, which name them. */
const FILE_COMMANDS = ['generate', 'content export', 'site export', 'site build']

const WALKTHROUGH = 'getting-started/from-the-command-line.md'

interface Run {
  args: string[]
  code: number
  out: string
}

interface Serving {
  url: string
  stop(): Promise<void>
}

describe('a site built from the command line, and shipped as a bundle', () => {
  let dir: string
  const runs: Run[] = []
  const running: Serving[] = []
  const siteDir = (name: string) => join(dir, name)

  function environment(site: string): Record<string, string> {
    const inherited = { ...(process.env as Record<string, string>) }
    for (const name of [
      'CROMBOLO_SQLITE_FILE',
      'CROMBOLO_COMPONENTS_DIR',
      'CROMBOLO_SCHEMA_DIR',
      'CROMBOLO_MEDIA_DIR',
      'CROMBOLO_CSS_DIR',
      'CROMBOLO_SCRIPTS_DIR',
      'CROMBOLO_SITE_NAME',
    ])
      delete inherited[name]
    return {
      ...inherited,
      CROMBOLO_DB: 'sqlite',
      CROMBOLO_LOGS_DIR: join(dir, 'logs', site),
      CROMBOLO_LOG_TO_CONSOLE: 'false',
      CROMBOLO_ADMIN_PASSWORD: 'integration-password',
    }
  }

  async function cli(site: string, ...args: string[]): Promise<Run> {
    const proc = Bun.spawn(['bun', CLI, ...args], {
      cwd: siteDir(site),
      env: environment(site),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(), 60_000)
    try {
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ])
      const run = { args, code: await proc.exited, out: `${out}${err}` }
      runs.push(run)
      return run
    } finally {
      clearTimeout(timer)
    }
  }

  const ok = async (site: string, ...args: string[]) => {
    const run = await cli(site, ...args)
    expect(run.code, `crombolo ${args.join(' ')}\n${run.out}`).toBe(0)
    return run
  }

  async function serve(site: string, ...args: string[]): Promise<Serving> {
    const proc = Bun.spawn(['bun', CLI, 'start', ...args], {
      cwd: siteDir(site),
      env: { ...environment(site), NODE_ENV: 'production', PORT: '0' },
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
      await proc.exited
      throw new Error(`${site} did not start:\n${banner}${error}`)
    }
    const server: Serving = {
      url,
      async stop() {
        proc.kill()
        await proc.exited
        running.splice(running.indexOf(server), 1)
      },
    }
    running.push(server)
    return server
  }

  const page = async (server: Serving, path: string) => {
    const response = await fetch(new URL(path, server.url))
    expect(response.status, `${path} on ${server.url}`).toBe(200)
    return await response.text()
  }

  beforeAll(() => {
    mkdirSync(join(ROOT, 'output'), { recursive: true })
    dir = mkdtempSync(join(ROOT, 'output', 'cli-site-'))
  })

  afterAll(async () => {
    for (const server of [...running]) await server.stop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test('the walkthrough, step by step: from init to pages served and a bundle applied elsewhere', async () => {
    const guide = parseGuide(WALKTHROUGH, readFileSync(join(DOCS_DIR, WALKTHROUGH), 'utf8'))
    const walk = walkthroughOf(WALKTHROUGH, guide.body, guide.choice)
    // What each start serves, in order: the home page, then the pages and
    // block, then the same again from the second site the bundle made.
    const served: Array<Record<string, string[]>> = [
      { '/': ['<h1>Home</h1>'] },
      {
        '/': ['<h1>Home</h1>', '<h2 class="highlight">Sourdough, baked daily</h2>'],
        '/visit-us': ['<h1>Visit us</h1>'],
      },
    ]
    served.push(served[1] as Record<string, string[]>)
    let at = ''
    let starts = 0
    const start = async (...args: string[]) => {
      const server = await serve(at, ...args)
      for (const [path, wanted] of Object.entries(served[starts++] ?? {})) {
        const html = await page(server, path)
        for (const text of wanted) expect(html, `${path}, start ${starts}`).toContain(text)
      }
      await server.stop()
    }
    // The first option of the page's choice, SQLite, as a reader who picks nothing
    const shown = (step: { only?: string }) => !step.only || step.only === walk.choice?.options[0]
    for (const stage of walk.stages)
      for (const step of stage.steps.filter(shown))
        for (const code of step.code) {
          if (code.file) {
            writeFileSync(join(siteDir(at), code.file), code.text)
            continue
          }
          if (code.lang !== 'sh') continue
          for (const line of code.text.replaceAll(/\\\n\s*/g, ' ').split('\n'))
            for (const segment of line.split('&&')) {
              const [first, ...rest] = words(segment)
              // Checks of the reader's own machine change nothing here
              if (first === 'uname' || (first === 'bun' && rest[0] === '--version')) continue
              if (first === 'mkdir') mkdirSync(join(dir, at, rest[0] as string))
              else if (first === 'cd') at = relative(dir, join(dir, at, rest[0] as string))
              else if (first === 'bun' && rest[0] === 'start') await start()
              else if (first === 'bunx') {
                const args = rest.slice(1)
                if (args[0] === 'start') await start(...args.slice(1))
                else await ok(at, ...args)
              } else if (!(first === 'bun' && rest[0] === 'install') && first !== undefined)
                throw new Error(`${step.title}: no way to run "${segment.trim()}"`)
            }
        }
    expect(starts).toBe(served.length)

    const site = JSON.parse((await ok('riverside-bakery', 'site', 'show', '-o', 'json')).out)
    expect(site.name).toBe('Riverside Bakery')
    expect(site.forms).toEqual([{ alias: 'contact', name: 'Contact us' }])
    expect(site.workflows.map((w: { alias: string }) => w.alias)).toEqual(['sign-off'])
    expect(site.userGroups).toContainEqual({ alias: 'editors', name: 'Editors', source: 'site' })
    expect(site.webhooks.map((w: { alias: string }) => w.alias)).toEqual(['published'])
    await ok('riverside-bakery', 'types', 'check')

    // No command named a definition file, apart from init's one line and the
    // commands whose job is files.
    for (const run of runs) {
      const command = run.args.join(' ')
      if (FILE_COMMANDS.some((c) => command.startsWith(c))) continue
      const out = run.args[0] === 'init' ? run.out.replace(/^.*kept in schema\/.*$/m, '') : run.out
      expect(out, `crombolo ${command}`).not.toMatch(/toml|schema\//i)
    }
  }, 600_000)
})
