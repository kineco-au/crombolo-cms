/**
 * Live reload in development (story 214): the event stream open pages listen
 * on, the changes it carries, and the background type check whose findings it
 * shows. docs/writing-components.md, "The development loop".
 */
import { watch } from 'node:fs'
import type { LiveChange, LiveTypes } from '@crombolo/render'

export interface LiveReloadOptions {
  /** This process's identity; a page that reconnects to a different one reloads. */
  bootId?: string
  /** A burst of changes within this long is one reload. */
  collectMs?: number
  /** A comment this often keeps a quiet stream open through proxies. */
  heartbeatMs?: number
}

export interface LiveReload {
  readonly bootId: string
  /** Something open pages show has changed. */
  changed(what: LiveChange): void
  /** The background type check's latest findings, sent now and to each page that connects. */
  types(findings: LiveTypes): void
  /** The `text/event-stream` answer for a page's `EventSource`. */
  stream(request: Request): Response
  /** How many pages are listening. */
  listeners(): number
  close(): void
}

const encoder = new TextEncoder()
const frame = (event: string, data: unknown) =>
  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

export function createLiveReload(options: LiveReloadOptions = {}): LiveReload {
  const bootId = options.bootId ?? crypto.randomUUID()
  const collectMs = options.collectMs ?? 200
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>()
  let latestTypes: LiveTypes = { count: 0 }
  const pending = new Set<LiveChange>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const send = (chunk: Uint8Array) => {
    for (const listener of listeners) {
      try {
        listener.enqueue(chunk)
      } catch {
        listeners.delete(listener)
      }
    }
  }
  const heartbeat = setInterval(
    () => send(encoder.encode(': still here\n\n')),
    options.heartbeatMs ?? 15_000,
  )
  heartbeat.unref?.()

  return {
    bootId,
    changed(what) {
      pending.add(what)
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        const reasons = [...pending]
        pending.clear()
        send(frame('reload', { reasons }))
      }, collectMs)
    },
    types(findings) {
      latestTypes = findings
      send(frame('types', findings))
    },
    stream(request) {
      let self: ReadableStreamDefaultController<Uint8Array> | undefined
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          self = controller
          listeners.add(controller)
          // A short retry, so a page finds a restarted server quickly.
          controller.enqueue(encoder.encode('retry: 500\n\n'))
          controller.enqueue(frame('hello', { boot: bootId }))
          controller.enqueue(frame('types', latestTypes))
          request.signal.addEventListener('abort', () => {
            listeners.delete(controller)
            try {
              controller.close()
            } catch {}
          })
        },
        cancel() {
          if (self) listeners.delete(self)
        },
      })
      return new Response(body, {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        },
      })
    },
    listeners: () => listeners.size,
    close() {
      clearInterval(heartbeat)
      clearTimeout(timer)
      for (const listener of listeners) {
        try {
          listener.close()
        } catch {}
      }
      listeners.clear()
    },
  }
}

export interface TypeWatchOptions {
  /** One check; aborted when a newer change starts another. */
  check(signal: AbortSignal): Promise<{ checked: boolean; problems: string[] }>
  /** A finished check's findings, only when they differ from the last. */
  onFindings(findings: { problems: string[]; types: LiveTypes }): void
}

/**
 * Runs the type check one at a time: a change while one runs stops it and
 * starts again, so the findings are always of the latest files.
 */
export function createTypeWatch(options: TypeWatchOptions) {
  let running: AbortController | undefined
  let last: string | undefined

  const run = async () => {
    running?.abort()
    const controller = new AbortController()
    running = controller
    try {
      const result = await options.check(controller.signal)
      if (controller.signal.aborted || !result.checked) return
      const key = result.problems.join('\n')
      if (key === last) return
      last = key
      options.onFindings({ problems: result.problems, types: typesOf(result.problems) })
    } catch (error) {
      if (!controller.signal.aborted) throw error
    } finally {
      if (running === controller) running = undefined
    }
  }

  return {
    /** Checks again, stopping a check already running. */
    schedule(): Promise<void> {
      return run()
    },
    stop() {
      running?.abort()
    },
  }
}

const TSC_LINE = /^(.+?)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.*)$/

/** The banner's summary of `tsc`'s lines: how many errors, and the first. */
export function typesOf(problems: readonly string[]): LiveTypes {
  const errors = problems.filter((line) => TSC_LINE.test(line))
  const match = errors[0] ? TSC_LINE.exec(errors[0]) : null
  return {
    count: errors.length,
    ...(match
      ? {
          first: {
            file: match[1] as string,
            line: Number(match[2]),
            message: match[3] as string,
          },
        }
      : {}),
  }
}

/** Calls `onChange` once a burst of changes under `dir` has settled; development only. */
export function watchDirectory(dir: string, onChange: () => void, settleMs = 100) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const watcher = watch(dir, { recursive: true }, () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, settleMs)
  })
  watcher.unref()
  return {
    close() {
      clearTimeout(timer)
      watcher.close()
    },
  }
}
