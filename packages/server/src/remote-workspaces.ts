/**
 * The remote protocol's workspace routes (stories 380, 386): a host merging one, and
 * the command line working in them. `workspaces` lists and opens; `workspaces/{key}`
 * and what is under it (members, diff, update, conflicts, files, check, pages, errors,
 * render, open, links, merge) are the workspace routes' own, at the `content` level,
 * as the person, by the same rules as the back office.
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
const UNDER = /^workspaces(?:\/(.*))?$/

export function createWorkspaceRoutes(options: WorkspaceRouteOptions) {
  return {
    capabilities(): string[] {
      return options.enabled() && options.atLeast('content') && options.workspaces()
        ? ['workspace-merge', 'workspaces']
        : []
    },

    /** Answers the route, or undefined when `what` is not it. */
    async handle(
      request: Request,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const routes = options.workspaces()
      const under = UNDER.exec(what)
      if (!under || !routes) return undefined
      const key = what.match(MERGE_PATH)?.[1]
      if (!options.atLeast('content'))
        return options.notAtLevel('content', key ? 'merging a workspace' : 'workspaces')
      if (!options.enabled())
        return options.problem(404, {
          code: 'not-enabled',
          title: 'Workspaces are not turned on for this site',
        })
      const answered = await routes.handle(request, principal, `/${under[1] ?? ''}`, {
        ipAddress: null,
        forwardedFor: null,
      })
      if (answered.ok || answered.status === 204) return answered
      const body = (await answered.json().catch(() => ({}))) as {
        message?: string
        blockers?: string[]
        refusals?: string[]
      }
      const items = body.blockers ?? body.refusals
      return options.problem(answered.status, {
        code:
          answered.status === 409 ? 'conflict' : answered.status === 403 ? 'forbidden' : 'refused',
        title: body.message ?? (key ? 'The workspace cannot be merged' : 'It was refused'),
        ...(items ? { items } : {}),
      })
    },
  }
}
