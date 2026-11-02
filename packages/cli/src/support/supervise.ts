/**
 * `crombolo start` as the supervisor of its own server (story 241). The server
 * runs as a child process; a restart starts a new child beside it on the same
 * port (`reusePort`), switches to it once it is serving, then stops the old
 * one, so a restart is never an outage and a new server that fails to boot
 * leaves the old one serving. docs/operations.md, "Restarting".
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Subprocess } from 'bun'

/** Set on the server child, so `start` serves instead of supervising. */
export const CHILD_ENV = 'CROMBOLO_SUPERVISED_CHILD'
/** Set on a child started by a restart: it boots before it listens, and does not retry. */
export const RESTART_ENV = 'CROMBOLO_SUPERVISED_RESTART'

/** Where a running supervisor says who it is, under the site's directory. */
export const SUPERVISOR_FILE = join('.crombolo', 'supervisor.json')
/** The outcome of the last restart, under the site's directory. */
export const RESTART_FILE = join('.crombolo', 'restart.json')

/** How long a restarted server gets to boot before the old one is kept. */
const READY_MS = 120_000
/** How long the old server keeps serving once the new one is up, so in-flight answers finish. */
const HANDOVER_MS = 1_000
/** How long a stop gets before the children are killed. */
const STOP_MS = 12_000

export interface SupervisorRecord {
  pid: number
  /** The server child serving now. */
  child: number
  port: number
  startedAt: string
}

export interface RestartRecord {
  at: string
  ok: boolean
  reason?: string
}

/** What a child says to its supervisor, and the supervisor's answer. */
export type ChildMessage = { type: 'ready'; port: number } | { type: 'restart'; id: number }
export type SupervisorMessage = { type: 'restarted'; id: number; ok: boolean; reason?: string }

export const isSupervisedChild = (): boolean => Bun.env[CHILD_ENV] === '1'
export const isRestartChild = (): boolean => Bun.env[RESTART_ENV] === '1'

const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

/** The supervisor running for a site, when one is. */
export function readSupervisor(siteDir: string): SupervisorRecord | undefined {
  const file = join(siteDir, SUPERVISOR_FILE)
  if (!existsSync(file)) return undefined
  try {
    const record = JSON.parse(readFileSync(file, 'utf8')) as SupervisorRecord
    process.kill(record.pid, 0)
    return record
  } catch {
    return undefined
  }
}

/** The last restart's outcome, when there has been one. */
export function readRestart(siteDir: string): RestartRecord | undefined {
  const file = join(siteDir, RESTART_FILE)
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RestartRecord
  } catch {
    return undefined
  }
}

/**
 * The arguments a server child runs with. `--from` made the site already, in
 * the supervisor, so a child only serves it; a restart never resets the
 * administrator's password, as a first development start does.
 */
export function childArgv(argv: readonly string[], restart: boolean, made: boolean): string[] {
  const valued = new Set(['--from', '--name'])
  const bare = new Set(['--postgres', '--no-install', '--allow-missing-media'])
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    const flag = arg.split('=')[0] as string
    if (made && valued.has(flag)) {
      if (!arg.includes('=')) i++
      continue
    }
    if (made && bare.has(arg)) continue
    out.push(arg)
  }
  if ((restart || made) && !out.includes('--keep-admin')) out.push('--keep-admin')
  return out
}

/** The last lines a child wrote to stderr, which say why it did not start. */
function tailOf(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-5)
    .join(' / ')
}

interface Child {
  proc: Subprocess<'inherit' | 'ignore', 'inherit', 'pipe'>
  stderr: string
  ready: Promise<number | undefined>
}

/**
 * Supervises the server until a signal stops it, or the serving child exits
 * on its own, whose exit code it leaves with.
 */
export async function supervise(argv: readonly string[], siteDir: string, made: boolean) {
  const bin = argv[0] as string
  const args = argv.slice(1)
  let port = 0
  let current: Child | undefined
  let replacing: Child | undefined
  let stopping = false
  let restarting: Promise<{ ok: boolean; reason?: string }> | undefined
  const retired = new Set<Subprocess>()

  const spawnChild = (asRestart: boolean): Child => {
    let readied: (port: number | undefined) => void = () => {}
    const ready = new Promise<number | undefined>((resolve) => {
      readied = resolve
    })
    const child: Child = { proc: undefined as never, stderr: '', ready }
    child.proc = Bun.spawn([process.execPath, bin, ...childArgv(args, asRestart, made)], {
      env: {
        ...process.env,
        [CHILD_ENV]: '1',
        ...(asRestart ? { [RESTART_ENV]: '1', PORT: String(port) } : {}),
      },
      stdin: asRestart ? 'ignore' : 'inherit',
      stdout: 'inherit',
      stderr: 'pipe',
      ipc(message: ChildMessage) {
        if (message.type === 'ready') readied(message.port)
        if (message.type === 'restart')
          void restart().then((outcome) => {
            const answer: SupervisorMessage = { type: 'restarted', id: message.id, ...outcome }
            try {
              child.proc.send(answer)
            } catch {
              // The asker has gone; the outcome is in restart.json.
            }
          })
      },
    })
    void (async () => {
      const decoder = new TextDecoder()
      for await (const chunk of child.proc.stderr) {
        process.stderr.write(chunk)
        child.stderr = (child.stderr + decoder.decode(chunk)).slice(-8_192)
      }
    })()
    void child.proc.exited.then(() => readied(undefined))
    return child
  }

  const record = () => {
    if (!current) return
    const now: SupervisorRecord = {
      pid: process.pid,
      child: current.proc.pid,
      port,
      startedAt: new Date().toISOString(),
    }
    writeJson(join(siteDir, SUPERVISOR_FILE), now)
  }

  const leave = (code: number) => {
    rmSync(join(siteDir, SUPERVISOR_FILE), { force: true })
    process.exit(code)
  }

  const restart = (): Promise<{ ok: boolean; reason?: string }> => {
    restarting ??= (async () => {
      const next = spawnChild(true)
      replacing = next
      const timer = setTimeout(() => next.proc.kill('SIGKILL'), READY_MS)
      const ready = await next.ready
      clearTimeout(timer)
      replacing = undefined
      let outcome: { ok: boolean; reason?: string }
      if (ready === undefined || stopping) {
        next.proc.kill('SIGKILL')
        await next.proc.exited
        outcome = {
          ok: false,
          reason: stopping
            ? 'the site is stopping'
            : tailOf(next.stderr) || `the new server exited with code ${next.proc.exitCode}`,
        }
      } else {
        const old = current
        current = next
        record()
        watch(next)
        outcome = { ok: true }
        if (old) {
          retired.add(old.proc)
          setTimeout(() => old.proc.kill('SIGTERM'), HANDOVER_MS).unref()
          void old.proc.exited.then(() => retired.delete(old.proc))
        }
      }
      const result: RestartRecord = { at: new Date().toISOString(), ...outcome }
      writeJson(join(siteDir, RESTART_FILE), result)
      process.stderr.write(
        outcome.ok
          ? 'crombolo: restarted; the new server is serving.\n'
          : `crombolo: the restart failed, and the server that was running still is: ${outcome.reason}\n`,
      )
      return outcome
    })().finally(() => {
      restarting = undefined
    })
    return restarting
  }

  /** The serving child exiting by itself takes the supervisor with it, as the server did before. */
  const watch = (child: Child) => {
    void child.proc.exited.then((code) => {
      if (current !== child) return
      if (stopping) return
      leave(code ?? 1)
    })
  }

  const stop = (signal: string) => {
    if (stopping) {
      for (const child of [current, replacing]) child?.proc.kill('SIGKILL')
      for (const proc of retired) proc.kill('SIGKILL')
      leave(130)
    }
    stopping = true
    setTimeout(() => {
      for (const child of [current, replacing]) child?.proc.kill('SIGKILL')
      leave(130)
    }, STOP_MS).unref()
    for (const child of [current, replacing]) child?.proc.kill('SIGTERM')
    for (const proc of retired) proc.kill('SIGTERM')
    void (async () => {
      const code = current ? await current.proc.exited : 0
      await Promise.all([...retired].map((proc) => proc.exited))
      leave(signal === 'SIGINT' && code === 130 ? 130 : (code ?? 0))
    })()
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop(signal))
  process.on('SIGHUP', () => {
    if (!stopping && current) void restart()
  })

  const first = spawnChild(false)
  current = first
  watch(first)
  const ready = await first.ready
  if (ready === undefined) return // It exited before serving; `watch` leaves with its code.
  port = ready
  record()
  // Serves until a signal, or the child, ends it.
  await new Promise(() => {})
}
