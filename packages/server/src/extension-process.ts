/**
 * Each extension in a Deno process of its own (story 311). The CMS builds the
 * extension's server half into one file with the extension SDK, starts Deno with
 * read access to the package and that build only, write access to its own data
 * folder, network access to the origins its grant names, and no environment.
 * Over the channel the extension is described, then mounted as an ordinary
 * `ServerBundle` whose handlers send each call to it.
 *
 * Every capability the extension uses is a function lent for one call and
 * checked as it is in-process; its tables are queried by the CMS, on the
 * connection that reaches only them. docs/extensions.md.
 */
import { AsyncResource } from 'node:async_hooks'
import { mkdirSync, realpathSync } from 'node:fs'
import { dirname, extname, join, sep } from 'node:path'
import { BACKOFFICE_DIR, type BundlePackage, SERVER_DIR } from '@crombolo/backoffice-host/registry'
import {
  CHUNK_BYTES,
  decode,
  type EncodeHooks,
  encode,
  type Frame,
  frameBytes,
  fromBase64,
  readFrames,
  toBase64,
} from '@crombolo/extension/channel'
import type { ExtensionDescription } from '@crombolo/extension/runner'
import { RawHtml } from '@crombolo/render'
import type { Kysely } from 'kysely'
import type { BundleLog, ServerBundle } from './bundles.ts'
import { extensionSqlProblem } from './extension-sql.ts'

/** The Deno binary the `deno` package installed for this platform, or `CROMBOLO_DENO`. */
export function denoBinary(): string {
  const given = Bun.env.CROMBOLO_DENO
  if (given) return given
  const platform = process.platform
  if (platform === 'linux' && isMusl())
    throw new Error(
      'Extensions run under Deno, which publishes no build for musl Linux (Alpine). Use a glibc image such as oven/bun:1-slim, or set CROMBOLO_DENO to a Deno binary.',
    )
  const target = `${platform}-${process.arch}${platform === 'linux' ? '-glibc' : ''}`
  const deno = dirname(Bun.resolveSync('deno/package.json', import.meta.dir))
  const pkg = dirname(Bun.resolveSync(`@deno/${target}/package.json`, deno))
  return join(pkg, platform === 'win32' ? 'deno.exe' : 'deno')
}

function isMusl(): boolean {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } }
  return !report?.header?.glibcVersionRuntime
}

const SOURCE = /\.[cm]?[jt]sx?$/
const MACRO = /\btype\s*:\s*['"]macro['"]/
/** A module whose first statement says it runs in the browser, or renders on its own. */
const BROWSER_CODE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use (client|deferred)['"]/

/**
 * The extension's server half as one file for Deno: its code and its own
 * dependencies, with the SDK in place of `@crombolo/crombolo/bundle`. Nothing of
 * it runs here: a Bun macro, which would, is refused.
 */
export async function buildExtension(
  pkg: BundlePackage,
  siteDir: string,
  outDir: string,
): Promise<string> {
  const entryFile = Bun.resolveSync(pkg.packageName, siteDir)
  // As the build sees it: a workspace link resolves to its real place.
  const backOffice = `${join(realpathSync(pkg.directory), BACKOFFICE_DIR)}${sep}`
  mkdirSync(outDir, { recursive: true })
  const wrapper = join(outDir, 'entry.ts')
  const runner = Bun.resolveSync('@crombolo/extension/runner', import.meta.dir)
  await Bun.write(
    wrapper,
    `import * as extension from ${JSON.stringify(entryFile)}\nimport { run } from ${JSON.stringify(runner)}\nawait run(extension, ${JSON.stringify(pkg.field.server)})\n`,
  )
  const sdk = Bun.resolveSync('@crombolo/extension', import.meta.dir)
  const common = Bun.resolveSync('@crombolo/common', import.meta.dir)
  const jsx = Bun.resolveSync('@crombolo/render/jsx-runtime', import.meta.dir)
  // The CMS's own packages the SDK is built from; the extension reaches none of them itself.
  const own = [sdk, common, jsx].map((file) => dirname(dirname(file)))
  const ownCode = (importer: string) => own.some((dir) => importer.startsWith(dir))
  const result = await Bun.build({
    entrypoints: [wrapper],
    outdir: outDir,
    naming: 'server.js',
    target: 'node',
    format: 'esm',
    throw: false,
    jsx: { runtime: 'automatic', importSource: '@crombolo/crombolo' },
    plugins: [
      {
        name: 'crombolo-extension',
        setup(build) {
          build.onResolve({ filter: /^@crombolo\// }, (args) => {
            if (/^@crombolo\/(crombolo\/bundle|extension)$/.test(args.path)) return { path: sdk }
            if (args.path === '@crombolo/common') return { path: common }
            if (/^@crombolo\/(crombolo|render)\/jsx-(dev-)?runtime$/.test(args.path))
              return { path: jsx }
            if (ownCode(args.importer)) return undefined
            throw new Error(
              `${args.importer} imports ${args.path}, which is the CMS's own: an extension uses @crombolo/extension.`,
            )
          })
          build.onLoad({ filter: SOURCE }, async (args) => {
            if (args.path.startsWith(backOffice))
              throw new Error(
                `${args.path} is the back-office code's, which the server half never imports.`,
              )
            const contents = await Bun.file(args.path).text()
            if (MACRO.test(contents))
              throw new Error(`${args.path} imports a Bun macro, which would run in the CMS.`)
            if (BROWSER_CODE.test(contents))
              throw new Error(
                `${args.path} is browser code ('use client' or 'use deferred'), which an extension's components cannot carry yet.`,
              )
            const ext = extname(args.path).replace(/^\.[cm]?/, '.')
            const loader =
              ext === '.ts' ? 'ts' : ext === '.tsx' ? 'tsx' : ext === '.jsx' ? 'jsx' : 'js'
            return { contents, loader }
          })
        },
      },
    ],
  })
  if (!result.success)
    throw new Error(
      `It could not be built to run apart from the CMS: ${result.logs.map((log) => log.message).join('; ')}`,
    )
  return join(outDir, 'server.js')
}

/** What its process may read: its own server half and its build, never its back-office code (story 320). */
export function processReads(
  pkg: Pick<BundlePackage, 'directory'>,
  build: string,
  extra: readonly string[] = [],
): string[] {
  return [join(pkg.directory, SERVER_DIR), build, ...extra]
}

/** `--allow-net`'s hosts for a set of origins: host, and port where one is named. */
export function netHosts(origins: readonly string[]): string[] {
  return [
    ...new Set(
      origins.flatMap((origin) => {
        try {
          return [new URL(origin).host]
        } catch {
          return []
        }
      }),
    ),
  ]
}

/** The arguments Deno is started with: what the extension may read, write and reach, and nothing else. */
export function denoArguments(options: {
  serverFile: string
  reads: readonly string[]
  dataDir: string
  origins: readonly string[]
  memoryMb: number
}): string[] {
  const hosts = netHosts(options.origins)
  return [
    'run',
    '--no-prompt',
    '--no-remote',
    '--cached-only',
    '--no-config',
    '--no-npm',
    '--no-lock',
    '--node-modules-dir=none',
    `--allow-read=${[...options.reads, options.dataDir].join(',')}`,
    `--allow-write=${options.dataDir}`,
    ...(hosts.length > 0 ? [`--allow-net=${hosts.join(',')}`] : []),
    `--v8-flags=--max-old-space-size=${options.memoryMb}`,
    options.serverFile,
  ]
}

/** What a process needs of its environment to start, and nothing of the site's. */
function processEnv(cacheDir: string): Record<string, string> {
  const env: Record<string, string> = {
    NO_COLOR: '1',
    DENO_NO_UPDATE_CHECK: '1',
    DENO_NO_PACKAGE_JSON: '1',
    DENO_DIR: cacheDir,
  }
  if (process.platform === 'win32')
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP'])
      if (process.env[key]) env[key] = process.env[key] as string
  return env
}

/** A call that did not finish: the extension failed, stopped or did not answer in time. */
export class ExtensionCallError extends Error {
  override readonly name = 'ExtensionCallError'
}

interface Pending {
  fns: ((...args: unknown[]) => unknown)[]
  /** Objects lent by reference for this call, such as a page the extension may hand back. */
  refs: object[]
  /** How what this call lends is encoded: its replies lend the same way. */
  hooks: EncodeHooks
  request?: Request
  reader?: ReadableStreamDefaultReader<Uint8Array>
  body?: ReadableStreamDefaultController<Uint8Array>
  resolve(result: { value?: unknown; response?: Response }): void
  reject(error: unknown): void
  timer?: ReturnType<typeof setTimeout>
}

export interface ExtensionProcessOptions {
  pkg: BundlePackage
  siteDir: string
  /** `<site>/.crombolo/extensions/<id>`: its build, its data and Deno's cache. */
  home: string
  settings: Record<string, unknown>
  dialect: 'sqlite' | 'postgres'
  /** What its grant lets it reach: `http.outbound`'s origins. */
  origins: readonly string[]
  /** More to read, from the config's `dev` on a developer's machine. */
  reads?: readonly string[]
  log: BundleLog
  /** How long a route, event or workflow may take before it fails. */
  timeoutMs?: number
  /** Stopped after this long without a call, unless it serves routes. */
  idleMs?: number
  memoryMb?: number
}

const START_TIMEOUT_MS = 30_000

/** One extension's process: started when first needed, restarted after it stops, with a back-off. */
export class ExtensionProcess {
  readonly id: string
  description: ExtensionDescription | undefined
  #options: ExtensionProcessOptions
  #serverFile: string | undefined
  #child: ReturnType<typeof Bun.spawn> | undefined
  #starting: Promise<void> | undefined
  #pending = new Map<number, Pending>()
  #replies = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  #nextId = 1
  #nextSignal = 1
  #databases = new Map<string, Kysely<never>>()
  #transactions = new Map<number, { trx: Kysely<never>; finish(commit: boolean): Promise<void> }>()
  #crashes = 0
  #lastCrash = 0
  #idle: ReturnType<typeof setTimeout> | undefined
  #stderr: string[] = []
  #stopped = false

  constructor(options: ExtensionProcessOptions) {
    this.#options = options
    this.id = options.pkg.id
  }

  /** What a person calls it: its manifest's name. */
  get name(): string {
    return this.#options.pkg.name
  }

  /** The settings it was started with. */
  get settings(): Readonly<Record<string, unknown>> {
    return this.#options.settings
  }

  /** Builds, starts and describes it: the boot's first look at what it offers. */
  async start(): Promise<ExtensionDescription> {
    await this.#ensure()
    return this.description as ExtensionDescription
  }

  async #ensure(): Promise<void> {
    if (this.#stopped) throw new ExtensionCallError(`The extension ${this.id} has been stopped.`)
    if (this.#child) return
    this.#starting ??= this.#spawn().finally(() => {
      this.#starting = undefined
    })
    return this.#starting
  }

  async #spawn(): Promise<void> {
    // After a crash, wait a little longer each time before starting again.
    if (this.#crashes > 0) {
      const wait = Math.min(1000 * 2 ** (this.#crashes - 1), 60_000)
      const since = Date.now() - this.#lastCrash
      if (since < wait) await Bun.sleep(wait - since)
    }
    const { pkg, home } = this.#options
    const build = join(home, 'build')
    const data = join(home, 'data')
    mkdirSync(data, { recursive: true })
    this.#serverFile ??= await buildExtension(pkg, this.#options.siteDir, build)
    const child = Bun.spawn(
      [
        denoBinary(),
        ...denoArguments({
          serverFile: this.#serverFile,
          reads: processReads(pkg, build, this.#options.reads),
          dataDir: data,
          origins: this.#options.origins,
          memoryMb: this.#options.memoryMb ?? 256,
        }),
      ],
      {
        cwd: data,
        env: processEnv(join(home, 'cache')),
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    this.#child = child
    this.#stderr = []
    this.#readErrors(child.stderr as ReadableStream<Uint8Array>)
    const ready = new Promise<void>((resolve, reject) => {
      this.#replies.set(0, {
        resolve: (description) => {
          this.description = description as ExtensionDescription
          resolve()
        },
        reject,
      })
    })
    this.#listen(child)
    this.#send({ t: 'init', settings: this.#options.settings, dialect: this.#options.dialect })
    const timer = setTimeout(
      () =>
        this.#replies
          .get(0)
          ?.reject(new ExtensionCallError(`The extension ${this.id} did not start in time.`)),
      START_TIMEOUT_MS,
    )
    try {
      await ready
    } catch (error) {
      this.#kill()
      throw error
    } finally {
      clearTimeout(timer)
      this.#replies.delete(0)
    }
    this.#touch()
  }

  async #readErrors(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder()
    for await (const chunk of stream) {
      for (const line of decoder.decode(chunk).split('\n').filter(Boolean)) {
        this.#stderr.push(line)
        if (this.#stderr.length > 20) this.#stderr.shift()
      }
    }
  }

  async #listen(child: ReturnType<typeof Bun.spawn>) {
    const exited = child.exited.then((code) => code)
    try {
      for await (const frame of readFrames(child.stdout as ReadableStream<Uint8Array>))
        this.#receive(frame).catch((error) =>
          this.#options.log.error('The channel to {id} failed: {error}', {
            id: this.id,
            error: String(error),
          }),
        )
    } catch (error) {
      this.#options.log.error('The channel to {id} broke: {error}', {
        id: this.id,
        error: String(error),
      })
      this.#kill()
    }
    const code = await exited
    if (this.#child !== child) return
    this.#child = undefined
    if (!this.#stopped) {
      this.#crashes += 1
      this.#lastCrash = Date.now()
      this.#options.log.warn('The extension {id} stopped ({code}): {detail}', {
        id: this.id,
        code,
        detail: this.#stderr.slice(-3).join(' | '),
      })
    }
    const error = new ExtensionCallError(
      `The extension ${this.id} stopped before it answered.${this.#stderr.length > 0 ? ` ${this.#stderr.slice(-3).join(' ')}` : ''}`,
    )
    this.#replies.get(0)?.reject(error)
    for (const [id, call] of this.#pending) {
      clearTimeout(call.timer)
      call.body?.error(error)
      call.reject(error)
      this.#pending.delete(id)
    }
    for (const [, reply] of this.#replies) reply.reject(error)
    this.#replies.clear()
  }

  #send(frame: Frame) {
    const child = this.#child
    if (!child) return
    const sink = child.stdin as import('bun').FileSink
    sink.write(frameBytes(frame))
    sink.flush()
  }

  #kill() {
    const child = this.#child
    this.#child = undefined
    child?.kill()
  }

  #touch() {
    clearTimeout(this.#idle)
    const idleMs = this.#options.idleMs ?? 5 * 60_000
    if ((this.description?.routes.length ?? 0) > 0 || idleMs <= 0) return
    this.#idle = setTimeout(() => {
      if (this.#pending.size === 0) this.#kill()
    }, idleMs)
  }

  /** Stops it for good: the server is closing. */
  async stop(): Promise<void> {
    this.#stopped = true
    clearTimeout(this.#idle)
    const child = this.#child
    this.#kill()
    await child?.exited
  }

  /** Lends a database for one backfill, under an id the extension's queries name. */
  lendDatabase(db: Kysely<never>): string {
    const id = `lent-${this.#nextId++}`
    this.#databases.set(id, db)
    return id
  }

  returnDatabase(id: string) {
    this.#databases.delete(id)
  }

  /**
   * Sends one call and waits for its answer. `context` is lent for the call:
   * its functions are what the extension may call back, and stop working once
   * the call has answered.
   */
  async call(
    kind: string,
    fields: Record<string, unknown>,
    context: unknown,
    options: {
      request?: Request
      timeoutMs?: number | null
      /** More to send with each object it lends, such as a page's values. */
      extra?: EncodeHooks['extra']
    } = {},
  ): Promise<{ value?: unknown; response?: Response }> {
    await this.#ensure()
    const id = this.#nextId++
    const fns: Pending['fns'] = []
    const refs: object[] = []
    const hooks: EncodeHooks = {
      // Bound to this call's async context, so a render's own scope still applies
      // when the extension calls back.
      fn: (fn) => fns.push(AsyncResource.bind(fn)) - 1,
      ref: (value) => refs.push(value) - 1,
      extra: options.extra,
      signal: (signal) => {
        const marker = this.#nextSignal++
        signal.addEventListener('abort', () => this.#send({ t: 'abort', signal: marker }), {
          once: true,
        })
        return marker
      },
      special: (value, key) => {
        // Markup travels as markup, so the extension's JSX puts it in unescaped.
        if (value instanceof RawHtml) return { $html: value.value }
        if (
          key === 'database' &&
          value &&
          typeof (value as Kysely<never>).selectFrom === 'function'
        ) {
          this.#databases.set('main', value as Kysely<never>)
          return { $database: 'main' }
        }
        return undefined
      },
    }
    const encoded = await encode(context, hooks)
    const timeoutMs =
      options.timeoutMs === undefined ? (this.#options.timeoutMs ?? 30_000) : options.timeoutMs
    return new Promise((resolve, reject) => {
      const call: Pending = {
        fns,
        refs,
        hooks,
        request: options.request,
        resolve: (result) => {
          this.#finish(id)
          resolve(result)
        },
        reject: (error) => {
          this.#finish(id)
          reject(error)
        },
      }
      if (timeoutMs !== null)
        call.timer = setTimeout(() => {
          call.reject(new ExtensionCallError(`The extension ${this.id} did not answer in time.`))
          this.#checkAlive()
        }, timeoutMs)
      this.#pending.set(id, call)
      this.#send({ t: 'call', id, kind, ...fields, context: encoded })
    })
  }

  #finish(id: number) {
    const call = this.#pending.get(id)
    if (!call) return
    clearTimeout(call.timer)
    // A streamed response keeps the call's entry until its body has been sent.
    if (!call.body) this.#pending.delete(id)
    this.#touch()
  }

  /** After a call timed out: a process that does not answer a ping is hung, and is stopped. */
  #checkAlive() {
    const child = this.#child
    if (!child) return
    const id = this.#nextId++
    const timer = setTimeout(() => {
      this.#replies.delete(id)
      if (this.#child === child) {
        this.#options.log.warn('The extension {id} stopped answering, and was restarted.', {
          id: this.id,
        })
        this.#kill()
      }
    }, 2000)
    this.#replies.set(id, {
      resolve: () => clearTimeout(timer),
      reject: () => clearTimeout(timer),
    })
    this.#send({ t: 'ping', id })
  }

  #reply(id: unknown, value: { value?: unknown; error?: unknown }) {
    this.#send({ t: 'reply', id, ...value })
  }

  async #receive(frame: Frame) {
    switch (frame.t) {
      case 'ready':
        this.#replies.get(0)?.resolve(decode(frame.description))
        return
      case 'failed':
        this.#replies.get(0)?.reject(new ExtensionCallError(String(frame.message)))
        return
      case 'pong':
        this.#replies.get(frame.id as number)?.resolve(undefined)
        this.#replies.delete(frame.id as number)
        return
      case 'log': {
        const level = frame.level === 'error' ? 'error' : frame.level === 'warn' ? 'warn' : 'info'
        this.#options.log[level](String(frame.message).slice(0, 4000))
        return
      }
      case 'done': {
        const call = this.#pending.get(frame.id as number)
        call?.resolve({ value: decode(frame.value) })
        return
      }
      case 'error': {
        const call = this.#pending.get(frame.id as number)
        call?.reject(decode(frame.error))
        return
      }
      case 'respond': {
        const call = this.#pending.get(frame.id as number)
        if (!call) return
        const status = frame.status as number
        const empty = status === 204 || status === 304 || (status >= 100 && status < 200)
        let body: ReadableStream<Uint8Array> | null = null
        if (!empty)
          body = new ReadableStream<Uint8Array>({
            start: (controller) => {
              call.body = controller
            },
          })
        const response = new Response(body, {
          status,
          statusText: frame.statusText as string,
          headers: frame.headers as [string, string][],
        })
        call.resolve({ response })
        return
      }
      case 'rchunk': {
        const id = frame.id as number
        const call = this.#pending.get(id)
        if (!call) return
        if (frame.end) {
          try {
            call.body?.close()
          } catch {}
          this.#pending.delete(id)
        } else call.body?.enqueue(fromBase64(frame.data as string))
        return
      }
      case 'pull': {
        const id = frame.id as number
        const call = this.#pending.get(id)
        const request = call?.request
        if (!call || !request?.body) {
          this.#send({ t: 'chunk', id, end: true })
          return
        }
        call.reader ??= request.body.getReader()
        const { value, done } = await call.reader.read()
        if (done || !value) this.#send({ t: 'chunk', id, end: true })
        else
          for (let at = 0; at < value.length; at += CHUNK_BYTES)
            this.#send({ t: 'chunk', id, data: toBase64(value.subarray(at, at + CHUNK_BYTES)) })
        return
      }
      case 'host': {
        const call = this.#pending.get(frame.call as number)
        const fn = call?.fns[frame.fn as number]
        if (!fn) {
          this.#reply(frame.id, {
            error: { name: 'Error', message: 'That call has finished: its capabilities are gone.' },
          })
          return
        }
        try {
          const args = decode(frame.args, {
            special: (tagged) =>
              '$incoming' in tagged
                ? this.#pending.get(tagged.$incoming as number)?.request
                : undefined,
            ref: (marker) => call?.refs[marker],
          }) as unknown[]
          this.#reply(frame.id, { value: await encode(await fn(...args), call?.hooks) })
        } catch (error) {
          this.#reply(frame.id, { error: await encode(error) })
        }
        return
      }
      case 'sql':
      case 'begin':
      case 'commit':
      case 'rollback':
        try {
          this.#reply(frame.id, { value: await encode(await this.#database(frame)) })
        } catch (error) {
          this.#reply(frame.id, {
            error: {
              name: 'DatabaseError',
              message: error instanceof Error ? error.message : String(error),
            },
          })
        }
        return
    }
  }

  async #database(frame: Frame): Promise<unknown> {
    const db = this.#databases.get(String(frame.db))
    if (!db) throw new Error('No database is open for this extension.')
    if (frame.t === 'begin') {
      const id = this.#nextId++
      return new Promise((resolve, reject) => {
        let settle: { commit(): void; rollback(): void } | undefined
        const finished = db
          .transaction()
          .execute(
            (trx) =>
              new Promise<void>((commit, rollback) => {
                settle = { commit: () => commit(), rollback: () => rollback(ROLLBACK) }
                this.#transactions.set(id, {
                  trx: trx as unknown as Kysely<never>,
                  finish: async (yes) => {
                    if (yes) settle?.commit()
                    else settle?.rollback()
                    await finished.catch((error) => {
                      if (error !== ROLLBACK) throw error
                    })
                  },
                })
                resolve(id)
              }),
          )
          .catch((error) => {
            if (error !== ROLLBACK) reject(error)
          })
      })
    }
    if (frame.t === 'commit' || frame.t === 'rollback') {
      const tx = this.#transactions.get(frame.conn as number)
      this.#transactions.delete(frame.conn as number)
      await tx?.finish(frame.t === 'commit')
      return null
    }
    const target = frame.conn ? this.#transactions.get(frame.conn as number)?.trx : db
    if (!target) throw new Error('That transaction has finished.')
    const executor = target.getExecutor()
    const compiled = executor.compileQuery(decode(frame.query) as never, {
      queryId: crypto.randomUUID(),
    })
    const problem = extensionSqlProblem(compiled.sql, this.#options.dialect)
    if (problem) throw new Error(problem)
    return target.executeQuery(compiled)
  }
}

const ROLLBACK = Symbol('rollback')

/**
 * The extension, as the CMS mounts it: what it described, with each handler
 * sending its call to the process. The host's checks run on this as they do on
 * one in-process, before anything is sent.
 */
export function isolatedBundle(process: ExtensionProcess): ServerBundle {
  const d = process.description as ExtensionDescription
  const handlerFor =
    (index: number, method: string) =>
    async (
      request: Request,
      context: Record<string, unknown> & { cookies?: Iterable<[string, { value: string }]> },
    ) => {
      const cookies = request.headers.has('cookie')
        ? [...(context.cookies ?? [])].map(([name, cookie]) => [name, cookie.value])
        : []
      const { value, response } = await process.call(
        'route',
        {
          route: index,
          method,
          cookies,
          request: {
            url: request.url,
            method: request.method,
            headers: [...request.headers],
            hasBody: request.body !== null,
          },
        },
        {
          params: context.params,
          url: context.url,
          setCookie: context.setCookie,
          member: context.member,
          signal: context.signal,
          bundle: context.bundle,
          caller: context.caller,
          principal: context.principal,
        },
        { request },
      )
      return response ?? value
    }
  return {
    id: d.id,
    section: d.section as ServerBundle['section'],
    capabilities: d.capabilities as ServerBundle['capabilities'],
    routes: d.routes.map((route) => ({
      path: route.path,
      options: route.options,
      handlers: Object.fromEntries(
        route.methods.map((method) => [method, handlerFor(route.index, method)]),
      ),
    })) as ServerBundle['routes'],
    ...(d.tables
      ? {
          tables: {
            id: d.tables.id,
            steps: d.tables.steps.map((step) =>
              step.sql
                ? { name: step.name, release: step.release, sql: [] }
                : {
                    name: step.name,
                    release: step.release,
                    up: () => step.ops,
                    ...(step.backfill
                      ? {
                          backfill: async (db: Kysely<never>) => {
                            const lent = process.lendDatabase(db)
                            try {
                              await process.call(
                                'backfill',
                                { name: step.name, db: lent },
                                undefined,
                                {
                                  timeoutMs: null,
                                },
                              )
                            } finally {
                              process.returnDatabase(lent)
                            }
                          },
                        }
                      : {}),
                  },
            ),
          } as unknown as ServerBundle['tables'],
        }
      : {}),
    ...(d.media ? { media: d.media as ServerBundle['media'] } : {}),
    ...(d.events.length > 0
      ? {
          events: Object.fromEntries(
            d.events.map((alias) => [
              alias,
              async (context: { signal?: AbortSignal }) =>
                (await process.call('event', { name: alias }, context)).value as never,
            ]),
          ),
        }
      : {}),
    ...(d.jobs.length > 0
      ? {
          jobs: Object.fromEntries(
            d.jobs.map((name) => [
              name,
              async (payload: unknown, context: unknown) =>
                (await process.call('job', { name }, { payload, context }, { timeoutMs: null }))
                  .value,
            ]),
          ),
        }
      : {}),
    ...(d.schedules ? { schedules: d.schedules as ServerBundle['schedules'] } : {}),
    ...((d.screens ?? []).length > 0
      ? {
          screens: Object.fromEntries(
            (d.screens ?? []).map((screen) => {
              const handler =
                (action?: string) =>
                async (context: { signal?: AbortSignal } & Record<string, unknown>) =>
                  (
                    await process.call(
                      'screen',
                      { screen: screen.id, ...(action ? { action } : {}) },
                      {
                        bundle: context.bundle,
                        caller: context.caller,
                        principal: context.principal,
                        state: context.state,
                        input: context.input,
                        signal: context.signal,
                      },
                    )
                  ).value as never
              return [
                screen.id,
                {
                  view: handler(),
                  actions: Object.fromEntries(screen.actions.map((name) => [name, handler(name)])),
                },
              ]
            }),
          ) as unknown as ServerBundle['screens'],
        }
      : {}),
    ...(d.workflows.length > 0
      ? {
          forms: {
            workflows: d.workflows.map((workflow) => ({
              type: workflow.type,
              label: workflow.label,
              settings: workflow.settings as never,
              run: async (context: unknown) =>
                (
                  await process.call('workflow', { name: workflow.type }, context, {
                    timeoutMs: null,
                  })
                ).value as never,
            })),
          },
        }
      : {}),
  }
}

/** Why a described extension cannot run apart from the CMS, if it cannot. */
export function isolationProblems(description: ExtensionDescription): string[] {
  const problems: string[] = []
  if (description.middleware)
    problems.push(
      "it offers middleware, which only the site's own code may: middleware runs on every request",
    )
  if (description.fields > 0)
    problems.push('it adds form field types, which an extension cannot add until story 312')
  return problems
}
