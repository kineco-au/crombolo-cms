/**
 * Story 409: editing paused and resumed by a request to the running site, for a set
 * time or until resumed, as a host does around a deployment. `GET` says whether it is
 * paused, for the back office's banner; `POST` pauses or resumes, for a caller who may
 * apply a change (Apply changes), as a host promoting one does. docs/operations.md,
 * "Pausing editing".
 */
import type { Principal } from '@crombolo/api-management/domain'
import {
  type Db,
  pauseWrites,
  readWritesPaused,
  resumeWrites,
  type WritesPaused,
} from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'

export interface MaintenanceApiOptions {
  db: Db
  /** Whether the principal may see the Settings section: who paused, and when. */
  mayReadAll: (principal: Principal) => boolean
  /** Whether the principal may pause and resume: Apply changes, as applying a change asks. */
  mayPause: (principal: Principal) => boolean
  now?: () => Date
}

/** What a pause request asks for, or why it cannot be. Pure. */
export function pauseRequest(
  body: Record<string, unknown>,
  now: Date,
):
  | { action: 'resume' }
  | { action: 'pause'; reason: string; until: Date | null }
  | { refused: string } {
  if (body.action === 'resume') return { action: 'resume' }
  if (body.action !== 'pause') return { refused: 'Say whether to pause or resume, as action.' }
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : ''
  const hasFor = body.forSeconds !== undefined && body.forSeconds !== null
  const hasUntil = body.until !== undefined && body.until !== null
  if (hasFor && hasUntil) return { refused: 'Give forSeconds or until, not both.' }
  if (hasFor) {
    const seconds = Number(body.forSeconds)
    if (!Number.isFinite(seconds) || seconds < 1)
      return { refused: 'forSeconds is a number of seconds, at least 1.' }
    return { action: 'pause', reason, until: new Date(now.getTime() + seconds * 1000) }
  }
  if (hasUntil) {
    const until = typeof body.until === 'string' ? new Date(body.until) : new Date(Number.NaN)
    if (Number.isNaN(until.getTime())) return { refused: 'until is a time, as ISO 8601.' }
    if (until.getTime() - now.getTime() < 1000)
      return { refused: 'until is at least a second from now, by this site’s clock.' }
    return { action: 'pause', reason, until }
  }
  return { action: 'pause', reason, until: null }
}

export function createMaintenanceApi(options: MaintenanceApiOptions) {
  const { db } = options
  const now = options.now ?? (() => new Date())
  const view = (paused: WritesPaused | undefined, full: boolean) =>
    paused
      ? {
          paused: {
            reason: paused.reason || null,
            until: paused.until,
            ...(full ? { by: paused.by, at: paused.at } : {}),
          },
        }
      : { paused: null }

  return {
    async handle(request: Request, principal: Principal): Promise<Response> {
      const full = options.mayReadAll(principal)
      if (request.method === 'GET')
        return Response.json(view(await readWritesPaused(db, now()), full))
      if (request.method !== 'POST') return new Response(null, { status: 405 })
      if (!options.mayPause(principal))
        return Response.json(
          { message: 'Pausing editing needs "Apply changes" (Crombolo.Remote.ApplyChanges).' },
          { status: 403 },
        )
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
      const asked = pauseRequest(body, now())
      if ('refused' in asked) return Response.json({ message: asked.refused }, { status: 400 })
      if (asked.action === 'resume') {
        const was = await readWritesPaused(db, now())
        await resumeWrites(db)
        if (was) await audit(principal, 'ResumeEditing', 'Editing resumed')
        return Response.json(view(undefined, full))
      }
      const paused = await pauseWrites(
        db,
        { reason: asked.reason, by: principal.name ?? principal.id, until: asked.until },
        now(),
      )
      await audit(
        principal,
        'PauseEditing',
        `Editing paused${asked.reason ? `: ${asked.reason}` : ''}${asked.until ? `, until ${asked.until.toISOString()}` : ', until resumed'}`,
      )
      return Response.json(view(paused, full))
    },
  }

  async function audit(principal: Principal, action: string, detail: string) {
    await recordAudit(db, {
      category: 'system',
      action,
      source: 'request',
      userKey: principal.id,
      userName: principal.name,
      entityType: null,
      entityKey: null,
      entityName: null,
      detail,
      ipAddress: null,
      forwardedFor: null,
    })
  }
}
