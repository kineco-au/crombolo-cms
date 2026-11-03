/**
 * Story 252: a site built with commands alone, from `crombolo init` to pages
 * served, with a form, a group, a workflow and a webhook, then shipped as a
 * bundle to a second site that serves the same pages. No command's text output
 * names a definition file: only `init`'s one line about what to commit, and the
 * commands whose job is files (`generate`, `bundle export`, `bundle build`).
 *
 * Named `*.integration.ts`, so `bun test` does not collect it: it spawns
 * processes and boots servers. `bun run test:integration` runs it, and CI does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')

/** The commands whose job is files, which name them. */
const FILE_COMMANDS = ['generate', 'bundle export', 'bundle build']

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

  test('from init to pages served and a bundle applied elsewhere, by command alone', async () => {
    mkdirSync(siteDir('bakery'))
    const init = await ok('bakery', 'init', '--name', 'Riverside Bakery')
    expect(init.out).toContain('A site called "Riverside Bakery", on SQLite.')
    const s = (...args: string[]) => ok('bakery', ...args)

    // The types: a block, the list that offers it, and a page with both
    await s('types', 'new', 'data-type', 'shortText', '--editor', 'textstring', '--max-chars', '80')
    await s(
      'types',
      'new',
      'content-type',
      'highlight',
      '--element',
      '--name',
      'Highlight',
      '--no-view',
    )
    await s(
      'types',
      'property',
      'add',
      'highlight',
      'heading',
      '--type',
      'shortText',
      '--name',
      'Heading',
    )
    await s(
      'types',
      'new',
      'data-type',
      'pageBlocks',
      '--editor',
      'block-list',
      '--block',
      'highlight',
    )
    await s('types', 'new', 'content-type', 'contentPage', '--name', 'Content page', '--at-root')
    await s(
      'types',
      'property',
      'add',
      'contentPage',
      'blocks',
      '--type',
      'pageBlocks',
      '--name',
      'Blocks',
    )
    await s('types', 'update', 'contentPage', '--allow-child', 'contentPage')

    // Views are code, written as code
    await s('components', 'new', '--block', 'highlight')
    writeFileSync(
      join(siteDir('bakery'), 'components', 'contentPage.tsx'),
      `export default function ContentPage({ model }) {
  return <main><h1>{model.text('title')}</h1><p class="lead">{model.value('blocks')?.byAlias('sourdough')?.content.text('heading')}</p></main>
}
`,
    )
    await s('generate')

    // A form on the page, a group, a workflow and a webhook
    await s('forms', 'new', 'contact', '--name', 'Contact us')
    await s(
      'forms',
      'field',
      'add',
      'contact',
      'message',
      '--type',
      'long-answer',
      '--caption',
      'Message',
      '--mandatory',
    )
    await s(
      'types',
      'property',
      'add',
      'contentPage',
      'contactForm',
      '--type',
      'formPicker',
      '--name',
      'Contact form',
    )
    await s(
      'users',
      'groups',
      'new',
      'editors',
      '--name',
      'Editors',
      '--section',
      'content',
      '--permission',
      'content:read',
      '--permission',
      'content:publish',
      '--language',
      'all',
    )
    await s(
      'workflows',
      'new',
      'sign-off',
      '--content-type',
      'contentPage',
      '--approver',
      'editors',
    )
    await s(
      'webhooks',
      'new',
      'published',
      '--url',
      'https://example.test/hook',
      '--event',
      'content-published',
    )

    // The pages, by command (story 253)
    await s('content', 'new', '/Home', '--type', 'contentPage', '--set', 'title=Riverside Bakery')
    await s(
      'content',
      'block',
      'add',
      '/Home',
      'blocks',
      '--type',
      'highlight',
      '--alias',
      'sourdough',
      '--set',
      'heading=Sourdough',
    )
    await s(
      'content',
      'new',
      '/Home/Visit us',
      '--type',
      'contentPage',
      '--set',
      'title=Visit us',
      '--set',
      'contactForm=contact',
    )
    await s('content', 'publish', '/Home', '--descendants', '--skip-approval')

    const shown = JSON.parse((await s('site', 'show', '-o', 'json')).out)
    expect(shown.name).toBe('Riverside Bakery')
    expect(shown.forms).toEqual([{ alias: 'contact', name: 'Contact us' }])
    expect(shown.workflows.map((w: { alias: string }) => w.alias)).toEqual(['sign-off'])
    expect(shown.userGroups).toContainEqual({ alias: 'editors', name: 'Editors', source: 'site' })
    expect(shown.webhooks.map((w: { alias: string }) => w.alias)).toEqual(['published'])
    await s('types', 'check')

    const served = await serve('bakery')
    const home = await page(served, '/')
    expect(home).toContain('<h1>Riverside Bakery</h1>')
    expect(home).toContain('<p class="lead">Sourdough</p>')
    expect(await page(served, '/visit-us')).toContain('<h1>Visit us</h1>')
    await served.stop()

    // Shipped: the pages exported as content files, the site built as a bundle,
    // and the bundle applied to a second, new site.
    await s('bundle', 'export', '--source', '--root', '/Home')
    await s('bundle', 'build', '.', '--out', join(dir, 'bundle'))
    mkdirSync(siteDir('copy'))
    await ok('copy', 'init', '--name', 'Riverside Bakery copy')
    // A new site's starting definitions give way to the bundle's
    const copy = await serve(
      'copy',
      '--bundle',
      join(dir, 'bundle'),
      '--publish',
      '--replace-files',
    )
    const copied = await page(copy, '/')
    expect(copied).toContain('<h1>Riverside Bakery</h1>')
    expect(copied).toContain('<p class="lead">Sourdough</p>')
    expect(await page(copy, '/visit-us')).toContain('<h1>Visit us</h1>')

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
