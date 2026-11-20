/**
 * A workspace's renders, in a process of its own (story 378). Started by the
 * server for a workspace that changed its views, it opens its own connection to
 * the site's database, builds the workspace's published cache and views from
 * what the workspace holds, and renders the pages it is asked for. A template
 * that hangs, crashes or grows only takes this process with it.
 *
 * Messages, over Bun's IPC: `init` (the database, the workspace, where to write
 * its views), then `render` with an id; it answers `ready`, `rendered` with the
 * same id, and `memory` now and then.
 */
import {
  connect,
  type Db,
  type DialectName,
  type NodeSchemaState,
  type WorkspaceScope,
} from '@crombolo/data'
import { contentForNode, PublishedCache, type RenderRequest } from '@crombolo/render'
import { createPublishedContentSource, loadDraftNode } from './adapters/documents.ts'
import type { CromboloConfig } from './config.ts'
import { siteSearchFor } from './site-search.ts'
import { createWorkspaceViews } from './workspace-views.ts'

export interface ChildInit {
  type: 'init'
  dialect: DialectName
  sqliteFile: string
  workspace: WorkspaceScope
  nodeState: NodeSchemaState
  nodeId: string
  /** Where its views are written: `<componentsCacheDir>-workspaces`. */
  componentsCacheDir: string
  renderTimeoutMs: number
}

/** What of a render's request can cross to the process: plain values only. */
export type PlainRequest = Pick<
  RenderRequest,
  'member' | 'origin' | 'url' | 'seo' | 'preview' | 'antiforgery' | 'submission' | 'part'
> & { headers?: Array<[string, string]> }

export interface ChildRender {
  type: 'render'
  id: number
  /** The page, its access already settled by the node: published, or its draft for a preview. */
  key: string
  culture: string | null
  draft: boolean
  request: PlainRequest
  /** The workspace's revision now: when it moved, the cache starts again. */
  revision: string
}

export type ChildAnswer =
  | { type: 'ready' }
  | { type: 'memory'; rss: number }
  | {
      type: 'rendered'
      id: number
      status: 'ok' | 'notFound' | 'noTemplate' | 'redirect' | 'outcome' | 'error'
      html?: string
      error?: string
      location?: string
      personal?: boolean
      revalidate?: number | false
      memberFiles?: string[]
      outcome?: { status: number; message?: string; location?: string }
    }

let db: Db | undefined
let cache: PublishedCache | undefined
let views: ReturnType<typeof createWorkspaceViews> | undefined
let workspace: WorkspaceScope | undefined
let revision = ''
let schema: { nodeState: NodeSchemaState; nodeId: string } | undefined

const send = (answer: ChildAnswer) => process.send?.(answer)

async function init(message: ChildInit) {
  db = await connect({ dialect: message.dialect, file: message.sqliteFile, poolSize: 2 })
  workspace = message.workspace
  schema = { nodeState: message.nodeState, nodeId: message.nodeId }
  cache = new PublishedCache(
    createPublishedContentSource(db, { nodeState: message.nodeState, workspace: workspace.id }),
    {},
  )
  views = createWorkspaceViews({
    db,
    config: {
      componentsCacheDir: message.componentsCacheDir,
      renderTimeoutMs: message.renderTimeoutMs,
    } as CromboloConfig,
    cache,
  })
  send({ type: 'ready' })
  setInterval(() => send({ type: 'memory', rss: process.memoryUsage().rss }), 2000).unref()
}

/** The page to render: the published one, or its draft as preview shows it. */
async function contentOf(message: ChildRender) {
  if (!cache || !db || !schema || !workspace) return undefined
  const published = await cache.byKey(message.key, message.culture)
  if (!message.draft) return published
  const draft = await loadDraftNode(db, message.key, { ...schema, workspace: workspace.id })
  if (!draft) return undefined
  const snapshot = await cache.snapshot()
  return contentForNode(
    draft,
    published?.url ?? `/${draft.key}`,
    message.culture,
    snapshot.languages,
  ).withValueContext(await cache.valueContext(message.culture))
}

async function render(message: ChildRender) {
  if (!cache || !views || !workspace || !db) return
  if (message.revision !== revision) {
    cache.invalidate()
    revision = message.revision
  }
  try {
    const renderer = await views.rendererFor(workspace, cache)
    const content = await contentOf(message)
    if (!renderer || !content) {
      send({ type: 'rendered', id: message.id, status: 'notFound' })
      return
    }
    const { headers, ...plain } = message.request
    const result = await renderer.renderModel(content, message.culture, {
      ...plain,
      ...(headers ? { headers: new Headers(headers) } : {}),
      search: siteSearchFor(db, cache, plain.member),
    })
    const answer: ChildAnswer = { type: 'rendered', id: message.id, status: result.status }
    if (result.status === 'ok' || result.status === 'outcome') {
      answer.personal = result.personal
      if (result.revalidate !== undefined) answer.revalidate = result.revalidate
      if (result.memberFiles) answer.memberFiles = result.memberFiles
    }
    if (result.status === 'ok') answer.html = result.html
    if (result.status === 'error') answer.error = result.error.message
    if (result.status === 'redirect') answer.location = result.location
    if (result.status === 'outcome')
      answer.outcome = {
        status: result.outcome.status,
        ...(result.outcome.message ? { message: result.outcome.message } : {}),
        ...(result.outcome.location ? { location: result.outcome.location } : {}),
      }
    send(answer)
  } catch (error) {
    send({ type: 'rendered', id: message.id, status: 'error', error: String(error) })
  }
}

process.on('message', (message: ChildInit | ChildRender) => {
  if (message.type === 'init') void init(message)
  else if (message.type === 'render') void render(message)
})
