/**
 * The remote protocol's routes for the media library and for showing a page
 * (story 355): media listed, found, shown with what uses it, changed, given a
 * new file, folders made, and who may see an item read and set, through the core
 * the command line uses; and a page as `content show` gives it. Each answers as
 * the signed-in person, within their start nodes; CI is refused, since these act
 * for a person. An item is named by its key or its path, encoded as one segment.
 */
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasSection, type Principal } from '@crombolo/api-management/domain'
import { type MediaOperations, userActor } from '@crombolo/content'
import { hasPathAccess, ObjectTypes } from '@crombolo/core'
import { type Db, describeRefFailure, NodeRepository, resolveNodeRef } from '@crombolo/data'
import { recordAudit } from './adapters/audit.ts'
import type { MediaFileStore } from './media-files.ts'
import {
  findMedia,
  listMedia,
  MediaLibraryError,
  makeFolders,
  mediaAccess,
  parseFocalPoint,
  readAccessChange,
  referencesTo,
  setMediaAccess,
  showMedia,
  updateMedia,
} from './media-library.ts'
import { pageShown } from './undo.ts'

interface Problem {
  code: string
  title: string
  detail?: string
}

export interface MediaLibraryRouteOptions {
  db: Db
  media: MediaOperations
  files(): Promise<MediaFileStore>
  problem(status: number, body: Problem): Response
  /** A refusal when the site's remote access level takes no changes to content. */
  levelRefusal(): Response | undefined
  /** Streams a request's body to a file, refusing one past the site's upload limit. */
  receive(request: Request, path: string): Promise<{ size: number } | undefined>
  /** Told after an item's permissions change, for the media cache here. */
  onAccessChange?(key: string): void | Promise<void>
  /** This server's name, on the cache instruction a permissions change appends. */
  nodeId?: string
}

/** The header a new file's name comes in, encoded as a URI component. */
export const FILE_NAME_HEADER = 'crombolo-file-name'

const STATUS: Record<MediaLibraryError['kind'], [number, string]> = {
  not_found: [404, 'not-found'],
  usage: [400, 'bad-request'],
  refused: [422, 'refused'],
  forbidden: [403, 'forbidden'],
}

const body = async (request: Request): Promise<Record<string, unknown> | undefined> => {
  const read = await request.json().catch(() => undefined)
  return read && typeof read === 'object' ? (read as Record<string, unknown>) : undefined
}

export function createMediaLibraryRoutes(options: MediaLibraryRouteOptions) {
  const { db, problem } = options
  const refused = (error: unknown): Response => {
    if (!(error instanceof MediaLibraryError)) throw error
    const [status, code] = STATUS[error.kind]
    return problem(status, {
      code,
      title: error.message,
      ...(error.hint ? { detail: error.hint } : {}),
    })
  }
  const actorOf = (principal: Principal, request: Request) =>
    userActor(principal, {
      source: 'request',
      forwardedFor: request.headers.get('x-forwarded-for'),
    })
  const paging = (url: URL) => ({
    skip: Number(url.searchParams.get('skip')) || 0,
    take: Number(url.searchParams.get('take')) || 25,
  })
  const notAllowed = () => new Response(null, { status: 405 })

  async function mediaRoute(
    request: Request,
    url: URL,
    principal: Principal,
    rest: string[],
  ): Promise<Response> {
    const reading = request.method === 'GET'
    if (principal.ci)
      return problem(403, {
        code: 'ci-cannot-change-media',
        title: reading ? 'Reading media needs a person' : 'Changing media needs a person',
        detail: 'Sign in as yourself: CI cannot do this.',
      })
    if (!hasSection(principal, 'media'))
      return problem(403, { code: 'forbidden', title: 'You may not see media here' })
    if (!reading) {
      const level = options.levelRefusal()
      if (level) return level
    }
    const actor = actorOf(principal, request)
    const [named, part] = rest
    if (!named) {
      if (!reading) return notAllowed()
      const query = {
        under: url.searchParams.get('under') || undefined,
        type: url.searchParams.get('type') || undefined,
        ...paging(url),
      }
      const name = url.searchParams.get('name')
      return Response.json(
        name !== null
          ? await findMedia(db, actor, { ...query, name })
          : await listMedia(db, actor, query),
      )
    }
    if (named === 'folders' && !part) {
      if (request.method !== 'POST') return notAllowed()
      const path = (await body(request))?.path
      if (typeof path !== 'string')
        return problem(400, { code: 'bad-request', title: 'Send the path of the folder to make' })
      return Response.json(await makeFolders({ db, media: options.media }, actor, path))
    }
    const ref = decodeURIComponent(named)
    if (!part) {
      if (reading)
        return Response.json(
          await showMedia(db, actor, ref, {
            references: url.searchParams.get('references') === 'true',
            ...paging(url),
          }),
        )
      if (request.method !== 'PATCH') return notAllowed()
      const asked = await body(request)
      if (!asked) return problem(400, { code: 'bad-request', title: 'Send the change to make' })
      const focal = typeof asked.focal === 'string' ? parseFocalPoint(asked.focal) : undefined
      if (asked.focal !== undefined && !focal)
        return problem(400, {
          code: 'bad-request',
          title: 'focal is two numbers from 0 to 1, as 0.4,0.6',
        })
      for (const field of ['name', 'alt'] as const)
        if (asked[field] !== undefined && typeof asked[field] !== 'string')
          return problem(400, { code: 'bad-request', title: `${field} is text` })
      return Response.json(
        await updateMedia(
          { db, media: options.media, files: await options.files() },
          actor,
          ref,
          {
            ...(typeof asked.name === 'string' ? { name: asked.name } : {}),
            ...(typeof asked.alt === 'string' ? { alt: asked.alt } : {}),
            ...(focal ? { focal } : {}),
          },
          { dryRun: asked.dryRun === true },
        ),
      )
    }
    if (part === 'file') {
      if (request.method !== 'PUT') return notAllowed()
      const name = decodeURIComponent(request.headers.get(FILE_NAME_HEADER) ?? '').trim()
      if (!name)
        return problem(400, { code: 'bad-request', title: `${FILE_NAME_HEADER} names the file` })
      const local = join(tmpdir(), `crombolo-remote-file-${crypto.randomUUID()}`)
      try {
        let received: { size: number } | undefined
        try {
          received = await options.receive(request, local)
        } catch {
          return problem(413, {
            code: 'too-large',
            title: 'The file is larger than this remote takes',
          })
        }
        if (!received)
          return problem(400, { code: 'body-required', title: 'The request carried no file' })
        const file = new File([await Bun.file(local).bytes()], name)
        return Response.json(
          await updateMedia(
            { db, media: options.media, files: await options.files() },
            actor,
            ref,
            { file },
            { dryRun: url.searchParams.get('dryRun') === 'true' },
          ),
        )
      } finally {
        await rm(local, { force: true })
      }
    }
    if (part === 'access') {
      const context = { db, onChange: options.onAccessChange, nodeId: options.nodeId }
      if (reading) return Response.json(await mediaAccess(context, actor, ref))
      if (request.method !== 'PUT') return notAllowed()
      const change = readAccessChange(await body(request))
      if (typeof change === 'string') return problem(400, { code: 'bad-request', title: change })
      const set = await setMediaAccess(context, actor, ref, change)
      await recordAudit(db, {
        category: 'media',
        action: 'SetPermissions',
        entityType: 'MediaAccess',
        entityKey: set.key,
        entityName: set.path,
        detail: set.summary,
        source: 'request',
        userKey: principal.id,
        userName: principal.name,
        ipAddress: null,
        forwardedFor: request.headers.get('x-forwarded-for'),
      })
      return Response.json(set)
    }
    return problem(404, { code: 'not-found', title: 'There is nothing here' })
  }

  async function contentRoute(
    request: Request,
    url: URL,
    principal: Principal,
    named: string,
  ): Promise<Response> {
    if (request.method !== 'GET') return notAllowed()
    if (principal.ci)
      return problem(403, {
        code: 'ci-cannot-read-pages',
        title: 'Reading pages needs a person',
        detail: 'Sign in as yourself: CI cannot do this.',
      })
    if (!hasSection(principal, 'content'))
      return problem(403, { code: 'forbidden', title: 'You may not see pages here' })
    const ref = decodeURIComponent(named)
    const resolved = await resolveNodeRef(db, [ObjectTypes.Document], ref)
    if (!resolved.ok || resolved.node.objectType !== ObjectTypes.Document)
      return problem(404, {
        code: 'not-found',
        title: resolved.ok ? `"${ref}" is not a page.` : describeRefFailure(ref, resolved),
      })
    const node = resolved.node
    const ids = node.path
      .split(',')
      .map(Number)
      .filter((id) => id > 0)
    const chain = (await new NodeRepository(db).byIds(ids)).map((row) => row.key)
    if (!hasPathAccess(principal.startNodes.document, chain, node.trashed))
      return problem(403, { code: 'forbidden', title: `You may not see "${ref}".` })
    const page = await pageShown(db, node.key)
    if (!page) return problem(404, { code: 'not-found', title: `"${ref}" is not a page.` })
    return Response.json({
      ...page,
      ...(url.searchParams.get('references') === 'true'
        ? { references: await referencesTo(db, node.key, paging(url)) }
        : {}),
    })
  }

  return {
    /** The capabilities these routes add to discovery. */
    capabilities: ['media-library', 'media-access', 'content-show'],

    /** Whether a principal may use the media routes: a person with the Media section. */
    mayMedia: (principal: Principal) => !principal.ci && hasSection(principal, 'media'),

    /** Whether a principal may show pages: a person with the Content section. */
    mayContent: (principal: Principal) => !principal.ci && hasSection(principal, 'content'),

    /** Whether a request is a new file, streamed past the usual body limit. */
    isUpload: (what: string, method: string) =>
      method === 'PUT' && /^media-items\/[^/]+\/file$/.test(what),

    /** Answers one of these routes, or undefined when `what` is none of them. */
    async handle(
      request: Request,
      url: URL,
      principal: Principal,
      what: string,
    ): Promise<Response | undefined> {
      const [head, ...rest] = what.split('/')
      try {
        if (head === 'media-items') return await mediaRoute(request, url, principal, rest)
        if (head === 'content-items' && rest.length === 1 && rest[0])
          return await contentRoute(request, url, principal, rest[0])
        return undefined
      } catch (error) {
        return refused(error)
      }
    },
  }
}
