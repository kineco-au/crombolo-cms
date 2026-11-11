/**
 * The extension's end of the channel (story 311), run under Deno. The CMS
 * builds an entry that imports the extension and calls `run` with it: this
 * builds the extension from its factory, describes it to the CMS, then answers
 * routes, events, jobs, workflows and backfills as the CMS sends them.
 *
 * Everything the extension does to the site goes back over the channel: each
 * capability is a function the CMS lent for this one call, and its tables are a
 * Kysely whose queries the CMS runs on the connection that reaches only them.
 * docs/extensions.md, "The channel".
 */
import { schemaBuilder } from '@crombolo/data/tables-builder'
import { RawHtml } from '@crombolo/render/html'
import { type Child, renderToString } from '@crombolo/render/jsx-runtime'
import {
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from 'kysely'
import {
  CHUNK_BYTES,
  decode,
  encode,
  errorFrom,
  type Frame,
  frameBytes,
  fromBase64,
  readFrames,
  toBase64,
} from './channel.ts'

declare const Deno: {
  stdin: { readable: ReadableStream<Uint8Array> }
  stdout: { writable: WritableStream<Uint8Array> }
  exit(code: number): never
}

// biome-ignore lint/suspicious/noExplicitAny: an extension's bundle is untyped here
type Bundle = Record<string, any>

/** What the CMS learns of the extension at start, to mount it. */
export interface ExtensionDescription {
  id: string
  section: string
  capabilities: string[]
  routes: { index: number; path: string; options: Record<string, unknown>; methods: string[] }[]
  tables?: {
    id: string
    steps: {
      name: string
      release: string
      ops: unknown[]
      backfill: boolean
      sql: boolean
    }[]
  }
  media?: unknown
  events: string[]
  jobs: string[]
  schedules?: unknown
  workflows: { type: string; label: string; settings?: unknown }[]
  fields: number
  middleware: boolean
  /** Its components (story 312), each with the layout alias it suggests. */
  components: { name: string; layout?: string }[]
  /** Its screens (story 323), each with the actions its buttons may name. */
  screens: { id: string; actions: string[] }[]
}

/** A component as the factory declares it: its render function, or its module. */
type DeclaredComponent =
  | ((props: object) => unknown)
  | { default: (props: object) => unknown; layout?: string }

const renderOf = (component: DeclaredComponent | undefined) =>
  typeof component === 'function'
    ? component
    : typeof component?.default === 'function'
      ? component.default
      : undefined

function describe(bundle: Bundle): ExtensionDescription {
  return {
    id: bundle.id,
    section: bundle.section,
    capabilities: [...(bundle.capabilities ?? [])],
    routes: (bundle.routes ?? []).map(
      (
        route: { path: string; options?: Record<string, unknown>; handlers?: object },
        index: number,
      ) => ({
        index,
        path: route?.path,
        options: route?.options ?? {},
        methods: Object.keys(route?.handlers ?? {}),
      }),
    ),
    tables: bundle.tables
      ? {
          id: bundle.tables.id,
          steps: bundle.tables.steps.map((step: Bundle) => ({
            name: step.name,
            release: step.release,
            ops: typeof step.up === 'function' ? [step.up(schemaBuilder)].flat() : [],
            backfill: typeof step.backfill === 'function',
            sql: 'sql' in step,
          })),
        }
      : undefined,
    media: bundle.media,
    events: Object.keys(bundle.events ?? {}),
    jobs: Object.keys(bundle.jobs ?? {}),
    schedules: bundle.schedules,
    workflows: (bundle.forms?.workflows ?? []).map(
      (workflow: { type: string; label: string; settings?: unknown }) => ({
        type: workflow.type,
        label: workflow.label,
        settings: workflow.settings,
      }),
    ),
    fields: (bundle.forms?.fields ?? []).length,
    middleware: bundle.middleware !== undefined,
    components: Object.entries((bundle.components ?? {}) as Record<string, DeclaredComponent>)
      .filter(([, component]) => renderOf(component))
      .map(([name, component]) => ({
        name,
        ...(typeof component === 'object' && typeof component.layout === 'string'
          ? { layout: component.layout }
          : {}),
      })),
    screens: Object.entries((bundle.screens ?? {}) as Record<string, Bundle>)
      .filter(([, screen]) => typeof screen?.view === 'function')
      .map(([id, screen]) => ({
        id,
        actions: Object.entries(screen.actions ?? {})
          .filter(([, action]) => typeof action === 'function')
          .map(([name]) => name),
      })),
  }
}

const hasAny = (value: unknown) =>
  value !== null &&
  value !== undefined &&
  value !== '' &&
  !(Array.isArray(value) && value.length === 0)

/**
 * A page or element whose values came with it (story 312): `value()`, `text()`,
 * `html()` and `hasValue()` answer at once, as a site component's do. With
 * options, or for a value that did not come, they ask the CMS.
 */
function withValues(target: Bundle, values: Record<string, Bundle>): Bundle {
  const live = {
    value: target.value,
    text: target.text,
    html: target.html,
    hasValue: target.hasValue,
  }
  const sent = (alias: string, options: unknown) =>
    options === undefined && Object.hasOwn(values, alias) ? values[alias] : undefined
  target.value = (alias: string, options?: unknown) =>
    sent(alias, options)?.value ?? (sent(alias, options) ? undefined : live.value?.(alias, options))
  target.text = (alias: string, options?: unknown) =>
    sent(alias, options)?.text ?? live.text?.(alias, options)
  target.html = (alias: string, options?: unknown) =>
    sent(alias, options)?.html ?? live.html?.(alias, options)
  target.hasValue = (alias: string, options?: unknown) =>
    sent(alias, options) ? hasAny(sent(alias, options)?.value) : live.hasValue?.(alias, options)
  return target
}

/** Starts the extension's end of the channel: never returns while the CMS keeps it open. */
export async function run(module: Record<string, unknown>, exportName: string): Promise<void> {
  const writer = Deno.stdout.writable.getWriter()
  let queue: Promise<void> = Promise.resolve()
  const send = (frame: Frame): Promise<void> => {
    queue = queue.then(() => writer.write(frameBytes(frame))).catch(() => {})
    return queue
  }

  // Standard output is the channel, so the console is sent to the site's log instead.
  const text = (part: unknown) => {
    if (typeof part === 'string') return part
    if (part instanceof Error) return part.stack ?? part.message
    try {
      return JSON.stringify(part)
    } catch {
      return String(part)
    }
  }
  for (const [method, level] of [
    ['log', 'info'],
    ['info', 'info'],
    ['debug', 'debug'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const)
    console[method] = (...parts: unknown[]) => {
      send({ t: 'log', level, message: parts.map(text).join(' ') })
    }
  globalThis.addEventListener?.('unhandledrejection', (event: Event) => {
    event.preventDefault()
    const reason = (event as PromiseRejectionEvent).reason
    send({ t: 'log', level: 'error', message: `Unhandled: ${text(reason)}` })
  })

  let bundle: Bundle | undefined
  let dialect: 'sqlite' | 'postgres' = 'sqlite'
  let nextId = 1
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const ask = (frame: Frame): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      send({ ...frame, id })
    })

  const signals = new Map<number, AbortController>()
  const waiting = new Map<number, { controller: ReadableStreamDefaultController; done(): void }>()
  const incoming = new WeakMap<Request, number>()
  const databases = new Map<string, Kysely<never>>()

  class ChannelConnection implements DatabaseConnection {
    conn: number | undefined
    constructor(readonly db: string) {}
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      const value = await ask({
        t: 'sql',
        db: this.db,
        conn: this.conn,
        query: await encode(compiled.query),
      })
      return decode(value) as QueryResult<R>
    }
    // biome-ignore lint/correctness/useYield: streaming is refused before anything is yielded
    async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
      throw new Error('Streaming a query is not offered to an extension.')
    }
  }

  class ChannelDriver implements Driver {
    constructor(readonly db: string) {}
    async init() {}
    async acquireConnection() {
      return new ChannelConnection(this.db)
    }
    async beginTransaction(connection: DatabaseConnection) {
      ;(connection as ChannelConnection).conn = (await ask({ t: 'begin', db: this.db })) as number
    }
    async commitTransaction(connection: DatabaseConnection) {
      const c = connection as ChannelConnection
      await ask({ t: 'commit', db: this.db, conn: c.conn })
      c.conn = undefined
    }
    async rollbackTransaction(connection: DatabaseConnection) {
      const c = connection as ChannelConnection
      await ask({ t: 'rollback', db: this.db, conn: c.conn })
      c.conn = undefined
    }
    async releaseConnection() {}
    async destroy() {}
  }

  const databaseFor = (db: string): Kysely<never> => {
    let found = databases.get(db)
    if (found) return found
    const pg = dialect === 'postgres'
    found = new Kysely<never>({
      dialect: {
        createAdapter: () => (pg ? new PostgresAdapter() : new SqliteAdapter()),
        createDriver: () => new ChannelDriver(db),
        createIntrospector: (k) => (pg ? new PostgresIntrospector(k) : new SqliteIntrospector(k)),
        createQueryCompiler: () => (pg ? new PostgresQueryCompiler() : new SqliteQueryCompiler()),
      },
    })
    databases.set(db, found)
    return found
  }

  const decodeFor =
    (call: number) =>
    (value: unknown): unknown =>
      decode(value, {
        fn:
          (fn) =>
          (...args: unknown[]) =>
            callHost(call, fn, args),
        signal: (marker, aborted) => {
          let controller = signals.get(marker)
          if (!controller) {
            controller = new AbortController()
            signals.set(marker, controller)
          }
          if (aborted) controller.abort()
          return controller.signal
        },
        special: (tagged): unknown => {
          if ('$database' in tagged) return databaseFor(String(tagged.$database))
          if ('$html' in tagged) return new RawHtml(String(tagged.$html))
          if ('$values' in tagged) {
            const { $values, ...rest } = tagged
            return withValues(
              decodeFor(call)(rest) as Bundle,
              decodeFor(call)($values) as Record<string, Bundle>,
            )
          }
          return undefined
        },
      })

  async function callHost(call: number, fn: number, args: unknown[]): Promise<unknown> {
    const encoded = await encode(args, {
      // The request a route was given goes back as itself, its body unread.
      special: (value) =>
        value instanceof Request && incoming.has(value) && !value.bodyUsed
          ? { $incoming: incoming.get(value) }
          : undefined,
    })
    return decodeFor(call)(await ask({ t: 'host', call, fn, args: encoded }))
  }

  function requestFor(
    id: number,
    given: { url: string; method: string; headers: [string, string][]; hasBody: boolean },
  ) {
    const body = given.hasBody
      ? new ReadableStream<Uint8Array>({
          pull: (controller) =>
            new Promise<void>((done) => {
              waiting.set(id, { controller, done })
              send({ t: 'pull', id })
            }),
        })
      : undefined
    const request = new Request(given.url, {
      method: given.method,
      headers: given.headers,
      body,
      ...(body ? { duplex: 'half' } : {}),
    } as RequestInit)
    incoming.set(request, id)
    return request
  }

  const cookiesFrom = (pairs: [string, string][]) => {
    const all = pairs.map(([name, value]) => ({ name, value }))
    return {
      get: (name: string) => all.find((cookie) => cookie.name === name),
      getAll: (name?: string) => (name ? all.filter((cookie) => cookie.name === name) : [...all]),
      has: (name: string) => all.some((cookie) => cookie.name === name),
      size: all.length,
      [Symbol.iterator]: () =>
        all.map((cookie) => [cookie.name, cookie] as const)[Symbol.iterator](),
    }
  }

  const noSite = () => {
    throw new Error("An extension cannot use site(): read the site's content through bundle.api.")
  }

  async function dispatch(frame: Frame): Promise<unknown> {
    if (!bundle) throw new Error('The extension has not started.')
    const id = frame.id as number
    const context = decodeFor(id)(frame.context) as Bundle
    switch (frame.kind) {
      case 'route': {
        const route = bundle.routes?.[frame.route as number]
        const handler = route?.handlers?.[frame.method as string]
        if (typeof handler !== 'function') throw new Error('No such route.')
        context.cookies = cookiesFrom((frame.cookies as [string, string][]) ?? [])
        context.site = noSite
        return handler(requestFor(id, frame.request as never), context)
      }
      case 'event':
        return bundle.events[frame.name as string](context)
      case 'job':
        return bundle.jobs[frame.name as string](context.payload, context.context)
      case 'workflow': {
        const workflow = (bundle.forms?.workflows ?? []).find(
          (candidate: { type: string }) => candidate.type === frame.name,
        )
        if (!workflow) throw new Error(`No workflow type "${frame.name}".`)
        return workflow.run(context)
      }
      case 'render': {
        const render = renderOf(bundle.components?.[frame.name as string])
        if (!render) throw new Error(`No component "${frame.name}".`)
        // Asked of the CMS only when read, since reading them makes the page personal.
        const read = context.readSearchParams
        delete context.readSearchParams
        if (typeof read === 'function')
          Object.defineProperty(context, 'searchParams', {
            get: () => read(),
            enumerable: true,
          })
        return renderToString(render(context) as Child)
      }
      case 'screen': {
        const screen = Object.hasOwn(bundle.screens ?? {}, frame.screen as string)
          ? bundle.screens[frame.screen as string]
          : undefined
        const handler = frame.action
          ? Object.hasOwn(screen?.actions ?? {}, frame.action as string)
            ? screen.actions[frame.action as string]
            : undefined
          : screen?.view
        if (typeof handler !== 'function') throw new Error('No such screen or action.')
        return handler(context)
      }
      case 'backfill': {
        const step = bundle.tables?.steps.find(
          (candidate: { name: string }) => candidate.name === frame.name,
        )
        if (typeof step?.backfill !== 'function')
          throw new Error(`No backfill for "${frame.name}".`)
        return step.backfill(databaseFor(String(frame.db)))
      }
      default:
        throw new Error(`Unknown call "${frame.kind}".`)
    }
  }

  async function answer(frame: Frame) {
    const id = frame.id as number
    try {
      const value = await dispatch(frame)
      if (value instanceof Response) {
        send({
          t: 'respond',
          id,
          status: value.status,
          statusText: value.statusText,
          headers: [...value.headers],
        })
        if (value.body) {
          const reader = value.body.getReader()
          for (;;) {
            const { value: chunk, done } = await reader.read()
            if (done) break
            for (let at = 0; at < chunk.length; at += CHUNK_BYTES)
              await send({ t: 'rchunk', id, data: toBase64(chunk.subarray(at, at + CHUNK_BYTES)) })
          }
        }
        send({ t: 'rchunk', id, end: true })
      } else send({ t: 'done', id, value: await encode(value) })
    } catch (error) {
      send({ t: 'error', id, error: await encode(error) })
    }
  }

  async function start(frame: Frame) {
    dialect = frame.dialect === 'postgres' ? 'postgres' : 'sqlite'
    try {
      const factory = module[exportName]
      if (typeof factory !== 'function')
        throw new Error(
          `The package names "${exportName}" as its server half, which it does not export.`,
        )
      bundle = (await factory(frame.settings ?? {})) as Bundle
      send({ t: 'ready', description: await encode(describe(bundle)) })
    } catch (error) {
      send({ t: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  for await (const frame of readFrames(Deno.stdin.readable)) {
    switch (frame.t) {
      case 'init':
        await start(frame)
        break
      case 'call':
        answer(frame)
        break
      case 'reply': {
        const waiter = pending.get(frame.id as number)
        pending.delete(frame.id as number)
        if (!waiter) break
        // An error the host threw arrives encoded, so a refusal keeps its message and its name.
        if (frame.error)
          waiter.reject(
            '$error' in (frame.error as object) || '$outcome' in (frame.error as object)
              ? (decode(frame.error) as Error)
              : errorFrom(frame.error as { name: string; message: string }),
          )
        else waiter.resolve(frame.value)
        break
      }
      case 'chunk': {
        const body = waiting.get(frame.id as number)
        waiting.delete(frame.id as number)
        if (!body) break
        if (frame.end) body.controller.close()
        else body.controller.enqueue(fromBase64(frame.data as string))
        body.done()
        break
      }
      case 'abort':
        signals.get(frame.signal as number)?.abort()
        break
      case 'ping':
        send({ t: 'pong', id: frame.id })
        break
    }
  }
  Deno.exit(0)
}
