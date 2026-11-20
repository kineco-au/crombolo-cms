/**
 * The remote protocol's route for a host to merge a workspace (story 380):
 * `GET workspaces/{key}/merge` says what a merge would do, and `POST` does it,
 * `{ accept?, rehearse? }`, at the `content` level. The rules are the workspace
 * routes' own: the merge permission and each change's verbs, as the person.
 */
import type { Principal } from '@crombolo/api-management/domain'

interface Problem {
  code: string
  title: string
  detail?: string
  items?: string[]
}

export interface WorkspaceRouteOptions {
  /** The workspace routes, as `<plugin>/api/workspaces` answers them. */
  workspaces: () =>
    | {
        handle(
          request: Request,
          principal: Principal,
          rest: string,
          client: { ipAddress: string | null; forwardedFor: string | null },
        ): Promise<Response>
      }
    | undefined
  enabled: () => boolean
  problem(status: number, body: Problem): Response
  atLeast(level: 'content'): boolean
  notAtLevel(level: 'content', what: string): Response
}

const MERGE_PATH = /^workspaces\/([0-9a-f-]{36})\/merge$/i

export function createWorkspaceRoutes(options: WorkspaceRouteOptions) {
  return {
    capabilities(): string[] {
      return options.enabled() && options.atLeast('content') && options.workspaces()
        ? ['workspace-merge']
        : []
    },

    /** Answers the route, or undefined when `what` is not it. */
    async handle(
      request: Request,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const key = what.match(MERGE_PATH)?.[1]
      const routes = options.workspaces()
      if (!key || !routes) return undefined
      if (request.method !== 'GET' && request.method !== 'POST')
        return new Response(null, { status: 405 })
      if (!options.atLeast('content')) return options.notAtLevel('content', 'merging a workspace')
      if (!options.enabled())
        return options.problem(404, {
          code: 'not-enabled',
          title: 'Workspaces are not turned on for this site',
        })
      const answered = await routes.handle(request, principal, `/${key}/merge`, {
        ipAddress: null,
        forwardedFor: null,
      })
      if (answered.ok) return answered
      const body = (await answered.json().catch(() => ({}))) as {
        message?: string
        blockers?: string[]
        refusals?: string[]
      }
      const items = body.blockers ?? body.refusals
      return options.problem(answered.status, {
        code:
          answered.status === 409 ? 'conflict' : answered.status === 403 ? 'forbidden' : 'refused',
        title: body.message ?? 'The workspace cannot be merged',
        ...(items ? { items } : {}),
      })
    },
  }
}
