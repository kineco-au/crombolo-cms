/**
 * Code installed but not yet running (story 241). Installing a bundle, or the
 * code a bundle carries, changes the site's files; the server only loads code
 * at boot, so the change is live after `crombolo restart`. Each install adds a
 * reason here, and a server that boots clears it, since it now runs that code.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILE = join('.crombolo', 'restart-pending.json')

export interface RestartPending {
  /** When the first change waiting for a restart was made. */
  since: string
  /** What is waiting, one line each, in the order it was installed. */
  reasons: string[]
}

/** What is waiting for a restart on this site, or undefined when nothing is. */
export function restartPending(siteDir: string): RestartPending | undefined {
  const file = join(siteDir, FILE)
  if (!existsSync(file)) return undefined
  try {
    const read = JSON.parse(readFileSync(file, 'utf8')) as Partial<RestartPending>
    return {
      since: typeof read.since === 'string' ? read.since : new Date(0).toISOString(),
      reasons: Array.isArray(read.reasons)
        ? read.reasons.filter((r): r is string => typeof r === 'string')
        : [],
    }
  } catch {
    return undefined
  }
}

/** Records that installed code waits for a restart. */
export function markRestartPending(siteDir: string, reason: string): RestartPending {
  const now = restartPending(siteDir)
  const next: RestartPending = {
    since: now?.since ?? new Date().toISOString(),
    reasons: [...(now?.reasons ?? []), reason],
  }
  const file = join(siteDir, FILE)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

/** A server that booted runs the site's code as it is now. */
export function clearRestartPending(siteDir: string): void {
  rmSync(join(siteDir, FILE), { force: true })
}
