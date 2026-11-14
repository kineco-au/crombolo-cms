/**
 * An administrator's back-office session seen as user groups, for up to an hour
 * (story 314). `<plugin>/api/view-as` says whether this session is (GET), starts
 * it (POST `{ groups }`) and switches back (DELETE). docs/backoffice-hosting.md,
 * "Viewing as a group".
 */
import type { AuthService, ResolvedIdentity, ViewingAs } from '@crombolo/auth'
import { currentAuditContext, type Db, UserGroupRepository } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'

export interface ViewAsStatus {
  /** What this session is viewing as, or null when it is its user's own. */
  viewing: { groups: Array<{ key: string; name: string }>; until: string } | null
  /** Whether this person may view as groups: an administrator in their own right. */
  allowed: boolean
  /** The groups to choose from, for one who may. */
  groups: Array<{ key: string; name: string }>
}

const named = (view: ViewingAs) => view.groups.map((g) => g.name).join(', ')

export function createViewAs(db: Db, auth: Pick<AuthService, 'startViewing' | 'stopViewing'>) {
  const status = async (
    identity: ResolvedIdentity,
    viewing: ViewingAs | undefined,
  ): Promise<ViewAsStatus> => {
    // Viewing as groups is only ever on for an administrator, whatever the groups are.
    const allowed = identity.isAdmin || identity.viewingAs !== undefined
    return {
      viewing: viewing ? { groups: viewing.groups, until: viewing.until.toISOString() } : null,
      allowed,
      groups: allowed
        ? (await new UserGroupRepository(db).all()).map((g) => ({ key: g.key, name: g.name }))
        : [],
    }
  }

  const audit = (
    identity: ResolvedIdentity,
    action: string,
    detail: string,
    client: { ipAddress: string | null; forwardedFor: string | null },
  ) => {
    // The entry names the groups itself; the request's own view is not added to it.
    const context = currentAuditContext()
    if (context) context.viewing = undefined
    return recordAudit(db, {
      category: 'permission',
      action,
      source: 'request',
      userKey: identity.user.key,
      userName: identity.user.userName,
      entityType: 'User',
      entityKey: identity.user.key,
      entityName: identity.user.userName,
      detail,
      ...client,
    })
  }

  return {
    async handle(
      request: Request,
      identity: ResolvedIdentity,
      client: { ipAddress: string | null; forwardedFor: string | null },
    ): Promise<Response> {
      if (request.method === 'GET') return Response.json(await status(identity, identity.viewingAs))
      if (request.method === 'DELETE') {
        const was = await auth.stopViewing(identity.sessionId)
        if (was) await audit(identity, 'Switched back', `from viewing as ${named(was)}`, client)
        return Response.json(await status(identity, undefined))
      }
      if (request.method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { groups?: unknown }
        const keys = Array.isArray(body?.groups)
          ? body.groups.filter((k): k is string => typeof k === 'string')
          : []
        const started = await auth.startViewing(identity.sessionId, keys)
        if (started === 'refused')
          return Response.json(
            { message: 'Only an administrator can view the back office as a group.' },
            { status: 403 },
          )
        if (started === 'no-groups')
          return Response.json({ message: 'Choose at least one group.' }, { status: 400 })
        await audit(identity, 'Started viewing as', named(started), client)
        return Response.json(await status(identity, started))
      }
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'GET, POST, DELETE' },
      })
    },
  }
}
