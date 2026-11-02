/**
 * Story 241: `crombolo start` supervises its server, and `crombolo restart`
 * swaps in a new one with no outage; a new server that fails to boot leaves the
 * old one serving. Real processes, so an integration test.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')
const CLI = join(ROOT, 'packages/cli/bin/crombolo.ts')

interface Run {
  code: number
  out: string
}

describe('restarting a supervised site, end to end', () => {
  let dir: string
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
  let url = ''
  const site = () => join(dir, 'site')
  const read = (path: string) => JSON.parse(readFileSync(join(site(), path), 'utf8'))

  function environment(): Record<string, string> {
    const inherited = { ...(process.env as Record<string, string>) }
    for (const name of [
      'CROMBOLO_SQLITE_FILE',
      'CROMBOLO_COMPONENTS_DIR',
      'CROMBOLO_SCHEMA_DIR',
      'CROMBOLO_MEDIA_DIR',
      'CROMBOLO_CSS_DIR',
      'CROMBOLO_SITE_NAME',
    ])
      delete inherited[name]
    return {
      ...inherited,
      CROMBOLO_DB: 'sqlite',
      CROMBOLO_LOGS_DIR: join(dir, 'logs'),
      CROMBOLO_LOG_TO_CONSOLE: 'false',
      CROMBOLO_ADMIN_PASSWORD: 'integration-password',
    }
  }

  async function cli(...args: string[]): Promise<Run> {
    const run = Bun.spawn(['bun', CLI, ...args], {
      cwd: site(),
      env: environment(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => run.kill(), 180_000)
    const [out, err] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
    ])
    clearTimeout(timer)
    return { code: await run.exited, out: `${out}${err}` }
  }

  const healthy = async () => (await fetch(new URL('health', url))).status

  beforeAll(async () => {
    mkdirSync(join(ROOT, 'output'), { recursive: true })
    dir = mkdtempSync(join(ROOT, 'output', 'restart-'))
    mkdirSync(site(), { recursive: true })
    const init = await cli('init', '--name', 'Restarts', '--template', 'basic')
    expect(init.code, init.out).toBe(0)
  })
  afterAll(async () => {
    if (proc) {
      proc.kill()
      await proc.exited
    }
    rmSync(dir, { recursive: true, force: true })
  })

  test('start supervises: the server is its child, and says where it answers', async () => {
    proc = Bun.spawn(['bun', CLI, 'start', '--keep-admin'], {
      cwd: site(),
      env: { ...environment(), NODE_ENV: 'production', PORT: '0' },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc?.kill(), 90_000)
    const decoder = new TextDecoder()
    let banner = ''
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      banner += decoder.decode(chunk)
      if (banner.includes('└─')) break
    }
    clearTimeout(timer)
    url = /(?:site|backoffice)\s+(http:\/\/[^/\s]+\/)/.exec(banner)?.[1] ?? ''
    expect(url, banner).not.toBe('')
    expect(await healthy()).toBe(200)
    // Written once the server is up, which a moment after the banner it is.
    for (let i = 0; i < 40; i++) {
      try {
        read('.crombolo/supervisor.json')
        break
      } catch {
        await Bun.sleep(250)
      }
    }
    const supervisor = read('.crombolo/supervisor.json')
    expect(supervisor.pid).toBe(proc.pid)
    expect(supervisor.child).not.toBe(proc.pid)
    expect(String(supervisor.port)).toBe(new URL(url).port)
  }, 120_000)

  test('restart: a new server takes over on the same port, and nothing waits for one', async () => {
    const before = read('.crombolo/supervisor.json')
    mkdirSync(join(site(), '.crombolo'), { recursive: true })
    writeFileSync(
      join(site(), '.crombolo', 'restart-pending.json'),
      JSON.stringify({ since: new Date().toISOString(), reasons: ['a bundle'] }),
    )
    const run = await cli('restart', '-o', 'json')
    expect(run.code, run.out).toBe(0)
    const after = read('.crombolo/supervisor.json')
    expect(after.child).not.toBe(before.child)
    expect(after.port).toBe(before.port)
    expect(await healthy()).toBe(200)
    expect(read('.crombolo/restart.json').ok).toBe(true)
    expect(() => read('.crombolo/restart-pending.json')).toThrow()
  }, 200_000)

  test('a new server that fails to boot leaves the old one serving, and says why', async () => {
    const config = join(site(), 'crombolo.config.ts')
    const kept = readFileSync(config, 'utf8')
    const before = read('.crombolo/supervisor.json')
    appendFileSync(config, "\nthrow new Error('broken on purpose')\n")
    try {
      const run = await cli('restart')
      expect(run.code).not.toBe(0)
      expect(run.out).toContain('broken on purpose')
      const last = read('.crombolo/restart.json')
      expect(last.ok).toBe(false)
      expect(last.reason).toContain('broken on purpose')
      expect(read('.crombolo/supervisor.json').child).toBe(before.child)
      expect(await healthy()).toBe(200)
    } finally {
      writeFileSync(config, kept)
    }
  }, 200_000)

  test('a stop takes the supervisor and its server down together', async () => {
    const supervisor = read('.crombolo/supervisor.json')
    proc?.kill()
    expect(await proc?.exited).toBe(0)
    proc = undefined
    expect(() => process.kill(supervisor.child, 0)).toThrow()
    expect(() => read('.crombolo/supervisor.json')).toThrow()
  }, 60_000)
})
