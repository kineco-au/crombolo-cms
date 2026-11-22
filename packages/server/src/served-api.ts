/**
 * Story 395's routes. A host reports each change it applied to the served copy
 * (`PUT <plugin>/api/changes/served`) and reads back the newest (`GET`), and leaves
 * a person a notice of how it went (`POST <plugin>/api/notices`): each needs Apply
 * changes. The back office takes a person's own notices (`GET .../notices/mine`).
 */

import type { Principal } from '@crombolo/api-management/domain'
import { normaliseUuid } from '@crombolo/core'
import {
  BackofficeNoticeRepository,
  ChangeRepository,
  type Db,
  ServedChangeRepository,
} from '@crombolo/data'
import { servedView } from './served-schema.ts'

export interface ServedApiOptions {
  /** Whether the caller may apply changes here, as the change routes decide it. */
  mayApply(principal: Principal): Promise<boolean>
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const json = (body: unknown, status = 200) => Response.json(body, { status })
const refused = (message: string, status: number) => json({ message }, status)

/** A link a notice may carry: a path in the back office, or a web address. Pure. */
export const noticeLink = (link: unknown): string | null | undefined => {
  if (link === undefined || link === null || link === '') return null
  if (typeof link !== 'string' || link.length > 1000) return undefined
  if (link.startsWith('/') && !link.startsWith('//')) return link
  try {
    const url = new URL(link)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

export function createServedApi(db: Db, options: ServedApiOptions) {
  const served = new ServedChangeRepository(db)
  const notices = new BackofficeNoticeRepository(db)

  async function servedRoute(request: Request, principal: Principal): Promise<Response> {
    if (!(await options.mayApply(principal)))
      return refused('Reporting what the live site holds needs the Apply changes right.', 403)
    if (request.method === 'PUT') {
      const body = (await request.json().catch(() => undefined)) as { key?: unknown } | undefined
      const key = typeof body?.key === 'string' ? body.key.trim() : ''
      if (!UUID.test(key)) return refused('Name the change applied there by its key.', 400)
      const held = await new ChangeRepository(db).held([key])
      if (!held.has(normaliseUuid(key))) return refused('There is no such change here.', 404)
      await served.report(key, principal.id)
    } else if (request.method !== 'GET') return new Response(null, { status: 405 })
    const newest = await served.newest()
    const view = await servedView(db)
    const waiting = new Set(
      [...(view?.pending.values() ?? [])].flatMap((i) => i.changes.map((c) => c.key)),
    )
    return json({
      newest: newest
        ? { key: newest.key, name: newest.name, reportedAt: newest.reportedAt.toISOString() }
        : null,
      waiting: waiting.size,
    })
  }

  async function post(request: Request, principal: Principal): Promise<Response> {
    if (!(await options.mayApply(principal)))
      return refused('Leaving someone a notice needs the Apply changes right.', 403)
    const body = (await request.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined
    const user = typeof body?.user === 'string' ? body.user.trim() : ''
    if (!UUID.test(user)) return refused('Name the person by their key.', 400)
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message || message.length > 1000)
      return refused('Say what happened, in at most 1000 characters.', 400)
    const kind = body?.kind ?? 'success'
    if (kind !== 'success' && kind !== 'failure')
      return refused('A notice is a success or a failure.', 400)
    const link = noticeLink(body?.link)
    if (link === undefined) return refused('A link is a back office path or a web address.', 400)
    const found = await db.q
      .selectFrom('user_account')
      .select('id')
      .where('key', '=', normaliseUuid(user))
      .execute()
    if (found.length === 0) return refused('There is no such person here.', 404)
    const id = await notices.add({ userKey: user, kind, message, link })
    return json({ id }, 201)
  }

  return {
    /** Answers the route at `rest` under the changes path, if it is this one. */
    async changes(
      request: Request,
      principal: Principal,
      rest: string,
    ): Promise<Response | undefined> {
      return rest === '/served' ? servedRoute(request, principal) : undefined
    },

    /** Answers `<plugin>/api/notices` and `/notices/mine`. */
    async notices(request: Request, principal: Principal, rest: string): Promise<Response> {
      if (rest === '' && request.method === 'POST') return post(request, principal)
      if (rest === '/mine' && request.method === 'GET') {
        const taken = await notices.take(principal.id)
        return json({
          items: taken.map((n) => ({
            kind: n.kind,
            message: n.message,
            link: n.link,
            createdAt: n.createdAt.toISOString(),
          })),
        })
      }
      return new Response(null, { status: rest === '' || rest === '/mine' ? 405 : 404 })
    },
  }
}
