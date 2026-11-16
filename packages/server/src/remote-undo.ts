/**
 * The remote protocol's routes for undoing a change (story 353): a page's
 * history, a version shown, rolled back and kept, and the recycle bin listed and
 * restored from. Each answers as the signed-in person, through the operations the
 * back office's handlers use; CI is refused, since these act for a person.
 */
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import {
  type DocumentOperations,
  MEDIA_JOBS,
  type MediaOperations,
  type Refusal,
  userActor,
} from '@crombolo/content'
import { type Db, DocumentRepository, JobRepository } from '@crombolo/data'
import {
  type BinItem,
  type BinKind,
  binItems,
  pageHistory,
  pageVersion,
  placeGone,
} from './undo.ts'

interface Problem {
  code: string
  title: string
  detail?: string
  items?: string[]
}

export interface UndoRouteOptions {
  db: Db
  operations: { documents: DocumentOperations; media: MediaOperations }
  problem(status: number, body: Problem): Response
  /** A refusal when the site's remote access level takes no changes to content. */
  levelRefusal(): Response | undefined
}

const KEY = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
const UUID = new RegExp(`^${KEY}$`)
const SECTION: Record<BinKind, 'content' | 'media'> = { content: 'content', media: 'media' }

const CODES: Partial<Record<Refusal['kind'], string>> = {
  notFound: 'not-found',
  forbidden: 'forbidden',
  needsApproval: 'needs-approval',
  invalid: 'invalid',
  conflict: 'conflict',
  blocked: 'blocked',
  validation: 'invalid',
  stale: 'conflict',
}

const body = async (request: Request): Promise<Record<string, unknown>> => {
  const read = await request.json().catch(() => ({}))
  return read && typeof read === 'object' ? (read as Record<string, unknown>) : {}
}

export function createUndoRoutes(options: UndoRouteOptions) {
  const { db, operations, problem } = options
  const refused = (
    result: Refusal & { blocked?: Array<{ key: string; reasons: string[] }> },
  ): Response =>
    problem(result.kind === 'needsApproval' ? 409 : result.status || 400, {
      code: CODES[result.kind] ?? 'refused',
      title: result.reason,
      ...(result.blocked ? { items: result.blocked.flatMap((b) => b.reasons) } : {}),
    })
  const actorOf = (principal: Principal, request: Request, skipApproval = false) =>
    userActor(
      principal,
      { source: 'request', forwardedFor: request.headers.get('x-forwarded-for') },
      { skipApproval },
    )
  const notHere = (title: string) => problem(404, { code: 'not-found', title })
  const noSection = (what: string) =>
    problem(403, { code: 'forbidden', title: `You may not ${what} here` })

  async function rollback(request: Request, principal: Principal, id: string) {
    const level = options.levelRefusal()
    if (level) return level
    const asked = await body(request)
    const publish = asked.publish === true
    const skipApproval = asked.skipApproval === true
    if (skipApproval && !principal.isAdmin)
      return problem(403, { code: 'forbidden', title: 'Only an administrator can skip approval' })
    if (skipApproval && principal.viaExchange)
      return problem(403, {
        code: 'forbidden',
        title: 'A sign-in through a provider cannot skip approval',
        detail: 'Sign in with your own command-line sign-in to skip it.',
      })
    const version = await pageVersion(db, id)
    if (!version) return notHere('There is no such version')
    const actor = actorOf(principal, request, skipApproval)
    const rolled = await operations.documents.rollback(actor, id, { overwrite: true })
    if (!rolled.ok) return refused(rolled)
    if (publish) {
      const published = await operations.documents.publishMany(
        actor,
        [version.page.key],
        null,
        'publish',
      )
      if (!published.ok)
        return refused({
          ...published,
          reason: `It was rolled back to a draft, and not published: ${published.reason}`,
        })
    }
    return Response.json({ page: version.page, version: id, published: publish })
  }

  async function keep(request: Request, id: string) {
    const level = options.levelRefusal()
    if (level) return level
    const keeping = (await body(request)).keep !== false
    if (!(await pageVersion(db, id))) return notHere('There is no such version')
    await new DocumentRepository(db).setPreventCleanup(id, keeping)
    return Response.json({ version: id, kept: keeping })
  }

  const kindsFor = (principal: Principal, asked: string | null): BinKind[] | Response => {
    const held = (['content', 'media'] as const).filter((kind) =>
      hasSection(principal, SECTION[kind]),
    )
    if (asked === 'content' || asked === 'media')
      return held.includes(asked) ? [asked] : noSection(`see the ${asked} recycle bin`)
    if (asked) return problem(400, { code: 'bad-query', title: 'kind is content or media' })
    return held.length > 0 ? held : noSection('see the recycle bin')
  }

  async function restore(request: Request, principal: Principal, key: string) {
    const level = options.levelRefusal()
    if (level) return level
    const item = (await binItems(db)).find((candidate) => candidate.key === key.toLowerCase())
    if (!item) return notHere('That is not in the recycle bin')
    if (!hasSection(principal, SECTION[item.kind]))
      return noSection(`restore ${item.kind === 'media' ? 'media' : 'pages'}`)
    const asked = await body(request)
    const target = asked.target
    if (
      target !== undefined &&
      target !== null &&
      !(typeof target === 'string' && UUID.test(target))
    )
      return problem(400, { code: 'bad-key', title: 'target is a key, or null for the top level' })
    const gone = placeGone(item)
    if (target === undefined && gone)
      return problem(409, {
        code: 'place-gone',
        title: gone,
        detail: 'Name another place to restore it to.',
      })
    const actor = actorOf(principal, request)
    const to = target === undefined ? undefined : (target as string | null)
    const done =
      item.kind === 'media'
        ? await operations.media.restore(actor, item.key, to)
        : await operations.documents.restore(actor, item.key, to)
    if (!done.ok) return refused(done)
    const queued = (done as { queued?: string }).queued
    if (queued) return Response.json({ item: described(item), queued }, { status: 202 })
    return Response.json({ item: described(item), restored: true })
  }

  const described = (item: BinItem) => ({ key: item.key, name: item.name, kind: item.kind })

  async function restoreJob(principal: Principal, id: string) {
    if (!hasSection(principal, 'media')) return noSection('restore media')
    const job = await new JobRepository(db).get(id)
    if (!job || job.name !== MEDIA_JOBS.restore) return notHere('There is no such restore')
    return Response.json({
      state: job.state,
      progress: job.progress,
      error: job.state === 'failed' ? job.lastError : null,
    })
  }

  return {
    /** Answers one of these routes, or undefined when `what` is none of them. */
    async handle(
      request: Request,
      url: URL,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const history = new RegExp(`^content/(${KEY})/history$`).exec(what)
      const version = /^content\/versions\/(\d+)(?:\/(rollback|keep))?$/.exec(what)
      const bin = new RegExp(`^recycle-bin(?:/(${KEY})/restore|/jobs/(${KEY}))?$`).exec(what)
      if (!history && !version && !bin) return undefined
      if (principal.ci)
        return problem(403, {
          code: 'needs-person',
          title: 'Undoing a change needs a person',
          detail: 'Sign in as yourself: CI cannot do this.',
        })
      const method = request.method
      if (history || version) {
        if (!hasSection(principal, 'content')) return noSection('see the history of pages')
        if (history && method === 'GET') {
          const found = await pageHistory(db, history[1] as string)
          return found ? Response.json(found) : notHere('There is no such page')
        }
        const [, id, action] = version as unknown as [string, string, string | undefined]
        if (!action && method === 'GET') {
          const shown = await pageVersion(db, id, { diff: url.searchParams.get('diff') === 'true' })
          return shown ? Response.json(shown) : notHere('There is no such version')
        }
        if (action === 'rollback' && method === 'POST') return rollback(request, principal, id)
        if (action === 'keep' && method === 'PUT') return keep(request, id)
        return new Response(null, { status: 405 })
      }
      const [, restoreKey, jobId] = bin as unknown as [
        string,
        string | undefined,
        string | undefined,
      ]
      if (restoreKey)
        return method === 'POST'
          ? restore(request, principal, restoreKey)
          : new Response(null, { status: 405 })
      if (jobId)
        return method === 'GET' ? restoreJob(principal, jobId) : new Response(null, { status: 405 })
      if (method !== 'GET') return new Response(null, { status: 405 })
      const kinds = kindsFor(principal, url.searchParams.get('kind'))
      if (kinds instanceof Response) return kinds
      const days = url.searchParams.get('olderThan')
      if (days !== null && !/^\d+$/.test(days))
        return problem(400, { code: 'bad-query', title: 'olderThan is a whole number of days' })
      return Response.json({
        items: await binItems(db, {
          kinds,
          ...(days !== null ? { olderThanDays: Number(days) } : {}),
        }),
      })
    },
  }
}
