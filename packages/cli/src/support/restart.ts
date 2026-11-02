/**
 * `crombolo restart` (story 241): a new server for a site, from the `crombolo
 * start` that supervises it, here by a signal or on a remote through the remote
 * protocol. The old server serves until the new one does, and keeps serving
 * when the new one fails.
 */
import { join } from 'node:path'
import { CliError } from '../errors.ts'
import { problemOf } from '../remote/client.ts'
import { connectRemote, needEnvironment } from './remote.ts'
import type { Io } from './site.ts'
import { RESTART_FILE, readRestart, readSupervisor } from './supervise.ts'

export interface Restarted {
  ok: boolean
  reason?: string
}

/** Longer than the supervisor gives a new server to boot, so its answer is the one reported. */
const WAIT_MS = 150_000

/** Signals the site's supervisor and waits for what the restart came to. */
export async function restartLocal(io: Io, siteDir: string): Promise<Restarted> {
  const supervisor = readSupervisor(siteDir)
  if (!supervisor)
    throw new CliError('unavailable', 'No `crombolo start` is running for this site.', {
      hint: 'Start it with `crombolo start`; a site its host runs is restarted the way that host restarts it.',
    })
  const asked = Date.now()
  process.kill(supervisor.pid, 'SIGHUP')
  io.progress(`  restarting  the server on port ${supervisor.port}`)
  const deadline = asked + WAIT_MS
  while (Date.now() < deadline) {
    await Bun.sleep(250)
    const last = readRestart(siteDir)
    if (last && Date.parse(last.at) >= asked)
      return { ok: last.ok, ...(last.reason ? { reason: last.reason } : {}) }
  }
  throw new CliError('unavailable', 'The restart did not finish in time.', {
    hint: `${join(siteDir, RESTART_FILE)} says how it ended.`,
  })
}

/** Asks a remote for a new server, and waits for its answer. */
export async function restartRemote(
  io: Io,
  flags: { remote?: string; env?: string },
): Promise<Restarted> {
  const { entry, client, discovery, environment } = await connectRemote(flags.remote, flags.env)
  const env = needEnvironment(environment, discovery)
  if (!discovery.capabilities.includes('restart'))
    throw new CliError('refused', `${entry.name} cannot be restarted from here.`, {
      hint: 'It was not started with `crombolo start`, or its CROMBOLO_REMOTE_ACCESS is not all; restart it the way its host does.',
    })
  io.progress(`  restarting  ${entry.name}`)
  const response = await client.api(`environments/${env}/restart`, { method: 'POST' })
  if (response.status === 502) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string }
    return { ok: false, ...(body.detail ? { reason: body.detail } : {}) }
  }
  if (!response.ok) throw await problemOf(response)
  return { ok: true }
}
