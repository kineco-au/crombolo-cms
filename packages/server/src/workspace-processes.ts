/**
 * The processes a node runs a workspace's renders in (story 378): one for each
 * workspace that changed its views, started at its first render and given it.
 * A render that runs over its time is answered with an error naming the
 * workspace, and its process stopped; a crash is the same, and the next render
 * starts it again. A process is stopped when idle, over its memory, when its
 * workspace is merged or discarded, and, past the node's limit, the least
 * recently used. The rest of the site never waits on one.
 */
import { fileURLToPath } from 'node:url'
import { Outcome, type OutcomeStatus } from '@crombolo/core'
import type { DialectName, NodeSchemaState, WorkspaceScope } from '@crombolo/data'
import type {
  PublishedCache,
  PublishedContent,
  Renderer,
  RenderRequest,
  RenderResult,
} from '@crombolo/render'
import type { ChildAnswer, ChildInit, ChildRender, PlainRequest } from './workspace-render-child.ts'

const CHILD = fileURLToPath(new URL('./workspace-render-child.ts', import.meta.url))

/** What a render in a workspace's process came to. */
export type ProcessRender = Extract<ChildAnswer, { type: 'rendered' }>

interface Running {
  workspace: WorkspaceScope & { name: string }
  proc: ReturnType<typeof Bun.spawn>
  ready: Promise<void>
  waiting: Map<number, (answer: ProcessRender) => void>
  usedAt: number
  rss: number
}

export interface WorkspaceProcessOptions {
  dialect: DialectName
  sqliteFile: string
  nodeState: NodeSchemaState
  nodeId: string
  /** The environment whose own values its pages show (story 387). */
  environment?: string
  componentsCacheDir: string
  /** How many run at once on this node. */
  limit: number
  idleMs: number
  memoryMb: number
  renderMs: number
}

export function createWorkspaceProcesses(options: WorkspaceProcessOptions) {
  const running = new Map<string, Running>()
  let next = 1

  const stop = (key: string, why: string) => {
    const one = running.get(key)
    if (!one) return
    running.delete(key)
    for (const answer of one.waiting.values())
      answer({ type: 'rendered', id: 0, status: 'error', error: why })
    one.waiting.clear()
    one.proc.kill()
  }

  const sweep = () => {
    const now = Date.now()
    for (const [key, one] of running) {
      if (one.waiting.size > 0) continue
      if (now - one.usedAt > options.idleMs) stop(key, 'It was left idle.')
      else if (one.rss > options.memoryMb * 1024 * 1024) stop(key, 'It grew past its memory.')
    }
    while (running.size > Math.max(1, options.limit)) {
      const oldest = [...running.entries()].sort((a, b) => a[1].usedAt - b[1].usedAt)[0]
      if (!oldest) break
      stop(oldest[0], 'Another workspace needed its place.')
    }
  }
  const timer = setInterval(sweep, 30_000)
  timer.unref?.()

  function start(workspace: WorkspaceScope & { name: string }): Running {
    let ready!: () => void
    const one: Running = {
      workspace,
      usedAt: Date.now(),
      rss: 0,
      waiting: new Map(),
      ready: new Promise<void>((resolve) => {
        ready = resolve
      }),
      proc: Bun.spawn(['bun', CHILD], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        env: { ...process.env },
        ipc(message: ChildAnswer) {
          if (message.type === 'ready') ready()
          else if (message.type === 'memory') one.rss = message.rss
          else {
            const answer = one.waiting.get(message.id)
            one.waiting.delete(message.id)
            answer?.(message)
          }
        },
        onExit() {
          if (running.get(workspace.key) === one)
            stop(workspace.key, `The workspace "${workspace.name}" stopped while it was rendering.`)
        },
      }),
    }
    const init: ChildInit = {
      type: 'init',
      dialect: options.dialect,
      sqliteFile: options.sqliteFile,
      workspace: { id: workspace.id, key: workspace.key },
      nodeState: options.nodeState,
      nodeId: options.nodeId,
      ...(options.environment ? { environment: options.environment } : {}),
      componentsCacheDir: options.componentsCacheDir,
      renderTimeoutMs: options.renderMs,
    }
    one.proc.send(init)
    running.set(workspace.key, one)
    sweep()
    return one
  }

  /** One page in the workspace's process, starting it if it is not running. */
  async function render(
    workspace: WorkspaceScope & { name: string },
    page: Omit<ChildRender, 'type' | 'id'>,
  ): Promise<ProcessRender> {
    const one = running.get(workspace.key) ?? start(workspace)
    one.usedAt = Date.now()
    const id = next++
    const answered = new Promise<ProcessRender>((resolve) => one.waiting.set(id, resolve))
    const limit = new Promise<ProcessRender>((resolve) => {
      const t = setTimeout(() => {
        if (!one.waiting.has(id)) return
        // Over its time: this render is answered, and its process is stopped.
        stop(
          workspace.key,
          `The workspace "${workspace.name}" took longer than ${Math.round(options.renderMs / 1000)} seconds to render this page.`,
        )
        resolve({
          type: 'rendered',
          id,
          status: 'error',
          error: `The workspace "${workspace.name}" took longer than ${Math.round(options.renderMs / 1000)} seconds to render this page.`,
        })
      }, options.renderMs)
      t.unref?.()
    })
    await Promise.race([one.ready, limit])
    const message: ChildRender = { type: 'render', id, ...page }
    if (running.get(workspace.key) === one) one.proc.send(message)
    return Promise.race([answered, limit])
  }

  return {
    render,

    /**
     * A renderer for the workspace's site that renders its pages in its process:
     * the node resolves the page and settles who may see it, as `Renderer` does,
     * and the process renders it. Everything else is Shared's renderer's.
     */
    rendererFor(
      workspace: WorkspaceScope & { name: string },
      cache: PublishedCache,
      shared: Renderer,
      revision: () => string,
    ): Renderer {
      const inProcess = async (
        content: PublishedContent,
        culture: string | null,
        request: RenderRequest,
      ): Promise<RenderResult> => {
        if (!content.componentAlias) return { status: 'noTemplate', content }
        const answer = await render(workspace, {
          key: content.key,
          culture,
          draft: request.preview === true,
          request: plainOf(request),
          revision: revision(),
        })
        return resultOf(answer, content)
      }
      return new Proxy(shared, {
        get(target, property) {
          if (property === 'render')
            return async (route: string, host = '', request: RenderRequest = {}) => {
              const resolved = await cache.resolve(host, route)
              if (!resolved) return { status: 'notFound' }
              if (resolved.redirect)
                return {
                  status: 'redirect',
                  location: resolved.redirect,
                  content: resolved.content,
                }
              const content = await permitted(cache, resolved.content, resolved.culture, request)
              if (!content) return { status: 'notFound' }
              return inProcess(content, resolved.culture, request)
            }
          if (property === 'renderModel') return inProcess
          const value = Reflect.get(target, property, target)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    },

    /** Stops a workspace's process: merged, discarded, or done with. */
    stop: (key: string) => stop(key, 'It was closed.'),

    /** The process id running a workspace's renders, if one is: for tests and the status page. */
    pidOf: (key: string) => running.get(key)?.proc.pid,

    get size(): number {
      return running.size
    },

    /** Checks the limits now, as the timer does. */
    sweep,

    /** Stops them all, as the node stops. */
    close(): void {
      clearInterval(timer)
      for (const key of [...running.keys()]) stop(key, 'The site is stopping.')
    },
  }
}

export type WorkspaceProcesses = ReturnType<typeof createWorkspaceProcesses>

const MAX_ACCESS_SUBSTITUTIONS = 5

/** The page to show in place of this one, as `Renderer` settles it; undefined for none. */
async function permitted(
  cache: PublishedCache,
  content: PublishedContent,
  culture: string | null,
  request: RenderRequest,
): Promise<PublishedContent | undefined> {
  if (!request.access) return content
  let current = content
  for (let step = 0; step < MAX_ACCESS_SUBSTITUTIONS; step++) {
    const decision = await request.access(current)
    if (decision.status === 'allowed') return current
    if (decision.contentKey.toLowerCase() === current.key.toLowerCase()) return undefined
    const next = await cache.byKey(decision.contentKey, culture)
    if (!next) return undefined
    current = next
  }
  return undefined
}

function plainOf(request: RenderRequest): PlainRequest {
  const plain: PlainRequest = {}
  for (const key of [
    'member',
    'origin',
    'url',
    'seo',
    'preview',
    'antiforgery',
    'submission',
    'part',
  ] as const)
    if (request[key] !== undefined) (plain as Record<string, unknown>)[key] = request[key]
  if (request.headers) plain.headers = [...request.headers.entries()]
  return plain
}

function resultOf(answer: ProcessRender, content: PublishedContent): RenderResult {
  const caching = {
    personal: answer.personal ?? false,
    ...(answer.revalidate !== undefined ? { revalidate: answer.revalidate } : {}),
    ...(answer.memberFiles ? { memberFiles: answer.memberFiles } : {}),
  }
  switch (answer.status) {
    case 'ok':
      return { status: 'ok', html: answer.html ?? '', content, ...caching }
    case 'outcome':
      return {
        status: 'outcome',
        outcome: Outcome.of((answer.outcome?.status ?? 404) as OutcomeStatus, {
          ...(answer.outcome?.message ? { message: answer.outcome.message } : {}),
          ...(answer.outcome?.location ? { location: answer.outcome.location } : {}),
        }),
        content,
        ...caching,
      }
    case 'redirect':
      return { status: 'redirect', location: answer.location ?? '/', content }
    case 'noTemplate':
      return { status: 'noTemplate', content }
    case 'notFound':
      return { status: 'notFound' }
    default:
      return {
        status: 'error',
        error: new Error(answer.error ?? 'It could not be rendered.'),
        content,
      }
  }
}
