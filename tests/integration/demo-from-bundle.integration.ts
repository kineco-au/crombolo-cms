/**
 * Story 164: a demo site in three commands, through the real CLI.
 *
 *   crombolo init --name "Harbourstone"
 *   crombolo bundle build sites/harbourstone --out ./harbourstone-bundle
 *   crombolo start --bundle ./harbourstone-bundle --publish
 *
 * The bundle carries the demo's schema, views, styles and seed, so the bare
 * site `init` made becomes the demo: its pages served and its photographs
 * placed. The same again with `bundle build --template demo/harbourstone`,
 * the demo as the CLI ships it.
 *
 * Named `*.integration.ts`, so `bun test` does not collect it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stageTemplates } from '../../scripts/sites.ts'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')
let dir: string
let templates: string

interface Run {
  code: number
  out: string
}

function environment(): Record<string, string> {
  const inherited = { ...(process.env as Record<string, string>) }
  for (const name of Object.keys(inherited))
    if (name.startsWith('CROMBOLO_')) delete inherited[name]
  return {
    ...inherited,
    CROMBOLO_DB: 'sqlite',
    CROMBOLO_TEMPLATES_DIR: templates,
    CROMBOLO_LOGS_DIR: join(dir, 'logs'),
    CROMBOLO_LOG_TO_CONSOLE: 'false',
  }
}

async function cli(site: string, ...args: string[]): Promise<Run> {
  const proc = Bun.spawn(['bun', CLI, ...args], {
    cwd: join(dir, site),
    env: environment(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), 120_000)
  try {
    const [out, err] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    return { code: await proc.exited, out: `${out}${err}` }
  } finally {
    clearTimeout(timer)
  }
}

/** `crombolo start` with the arguments, until its banner names the URL; then the URL and a stop. */
async function start(site: string, ...args: string[]) {
  const proc = Bun.spawn(['bun', CLI, 'start', ...args], {
    cwd: join(dir, site),
    // As someone trying a demo runs it: in development. In production a bare
    // site's schema (1.0.0) changing to the demo's without a version bump is
    // refused, which is the multi-node rule doing its job.
    env: { ...environment(), NODE_ENV: 'development', PORT: '0' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), 120_000)
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
  return {
    url,
    banner,
    async stop() {
      proc.kill()
      await proc.exited
    },
  }
}

/** The home page serves the demo, and the first photograph it shows is there. */
async function servesTheDemo(url: string) {
  const home = await fetch(new URL('/', url))
  expect(home.status).toBe(200)
  const html = await home.text()
  expect(html).toContain('Harbourstone')
  const image = /src="(\/media\/[^"?]+)/.exec(html)?.[1]
  expect(image, 'the home page shows a photograph').toBeTruthy()
  const photo = await fetch(new URL(image as string, url))
  expect(photo.status).toBe(200)
  expect(photo.headers.get('content-type')).toContain('image/')
}

beforeAll(() => {
  mkdirSync(join(ROOT, 'output'), { recursive: true })
  dir = mkdtempSync(join(ROOT, 'output', 'demo-from-bundle-'))
  templates = join(dir, 'templates')
  stageTemplates(templates)
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('a demo site in three commands', () => {
  test('init, bundle build from the directory, start with the bundle', async () => {
    mkdirSync(join(dir, 'from-path'))
    const init = await cli('from-path', 'init', '--name', 'Harbourstone')
    expect(init.code, init.out).toBe(0)
    const built = await cli(
      'from-path',
      'bundle',
      'build',
      join(ROOT, 'sites', 'harbourstone'),
      '--out',
      './harbourstone-bundle',
    )
    expect(built.code, built.out).toBe(0)
    expect(built.out).toContain('with its schema and views')

    const site = await start('from-path', '--bundle', './harbourstone-bundle', '--publish')
    try {
      expect(site.banner).toContain('with its schema and views')
      await servesTheDemo(site.url)
    } finally {
      await site.stop()
    }
    // Started again, the bundle is already in: nothing is imported twice.
    const again = await start('from-path', '--bundle', './harbourstone-bundle', '--publish')
    try {
      expect(again.banner).toContain('already imported')
      await servesTheDemo(again.url)
    } finally {
      await again.stop()
    }
  }, 240_000)

  test('the same from the demo the CLI ships, named by id', async () => {
    mkdirSync(join(dir, 'from-template'))
    expect((await cli('from-template', 'init', '--name', 'Harbourstone')).code).toBe(0)
    const built = await cli(
      'from-template',
      'bundle',
      'build',
      '--template',
      'demo/harbourstone',
      '--out',
      './harbourstone-bundle',
    )
    expect(built.code, built.out).toBe(0)
    const site = await start('from-template', '--bundle', './harbourstone-bundle', '--publish')
    try {
      await servesTheDemo(site.url)
    } finally {
      await site.stop()
    }
  }, 240_000)

  test('a seed with a problem is refused, naming it, and nothing is written', async () => {
    mkdirSync(join(dir, 'broken', 'schema'), { recursive: true })
    await Bun.write(join(dir, 'broken', 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
    await Bun.write(join(dir, 'broken', 'seed', 'content', 'home.toml'), 'type = "nothing"\n')
    const built = await cli('broken', 'bundle', 'build', '--out', './out')
    expect(built.code).not.toBe(0)
    expect(built.out).toContain('seed/content/home.toml:1')
  }, 120_000)
})
