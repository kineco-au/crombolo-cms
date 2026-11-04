/**
 * Traces, metrics and logs over OpenTelemetry (story 262), sent to whatever
 * collector the site names, and nothing at all without one. The SDK is loaded
 * only when an endpoint is set; until then `@opentelemetry/api` answers every
 * span and instrument with a no-op. Spans are made by hand at the server's own
 * seams, since automatic instrumentation does not run on Bun.
 * docs/operations.md, "Telemetry".
 *
 * What is sent is shapes and ids: never a member, an e-mail address, a form's
 * answer, a query string's values or a page's content.
 * `tests/telemetry.test.ts` holds every attribute to its allow-list.
 */

import { type Db, queryFor } from '@crombolo/data'
import type { Sink } from '@logtape/logtape'
import {
  type Attributes,
  type Context,
  type Counter,
  context,
  type Histogram,
  logs,
  metrics,
  propagation,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { VERSION } from './config.ts'
import type { EmailPort } from './email.ts'

export interface TelemetryOptions {
  /** The collector's base address, as `OTEL_EXPORTER_OTLP_ENDPOINT`, which wins. */
  endpoint?: string
  /** The service's name, as `OTEL_SERVICE_NAME`, which wins; the site's name otherwise. */
  serviceName?: string
}

/** Whether anything is sent, where, and as what: for the diagnostics screen. */
export interface TelemetryStatus {
  enabled: boolean
  endpoint?: string
  serviceName?: string
  role?: string
}

type Environment = Record<string, string | undefined>

let status: TelemetryStatus = { enabled: false }
let shutdown: (() => Promise<void>) | undefined
let flush: (() => Promise<void>) | undefined

export const telemetryStatus = (): TelemetryStatus => status

/** The collector named by the standard variables or the site's config; undefined for none. Pure. */
export function telemetryEndpoint(
  options: TelemetryOptions | undefined,
  env: Environment = process.env,
): string | undefined {
  const named =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
    options?.endpoint
  return named?.trim() || undefined
}

const instruments = {
  requestDuration: undefined as Histogram | undefined,
  renderDuration: undefined as Histogram | undefined,
  cacheLookups: undefined as Counter | undefined,
  jobRuns: undefined as Counter | undefined,
  jobDuration: undefined as Histogram | undefined,
  webhookDeliveries: undefined as Counter | undefined,
  webhookRetries: undefined as Counter | undefined,
}

/**
 * Starts the SDK when a collector is named, for this node's role. Once per
 * process: a second server in the same process shares the first's.
 */
export async function startTelemetry(options: {
  telemetry?: TelemetryOptions
  siteName: string
  role: string
  nodeId: string
  db?: Db
  env?: Environment
}): Promise<TelemetryStatus> {
  const env = options.env ?? process.env
  const endpoint = telemetryEndpoint(options.telemetry, env)
  if (!endpoint || status.enabled) return status
  const [
    { AsyncLocalStorageContextManager },
    { W3CTraceContextPropagator },
    { resourceFromAttributes },
    { TracerProvider, BatchSpanProcessor },
    { MeterProvider, PeriodicExportingMetricReader },
    { LoggerProvider, BatchLogRecordProcessor },
    exporters,
  ] = await Promise.all([
    import('@opentelemetry/context-async-hooks'),
    import('@opentelemetry/core'),
    import('@opentelemetry/resources'),
    import('@opentelemetry/sdk-trace'),
    import('@opentelemetry/sdk-metrics'),
    import('@opentelemetry/sdk-logs'),
    loadExporters(env),
  ])
  const serviceName = env.OTEL_SERVICE_NAME || options.telemetry?.serviceName || options.siteName
  const resource = resourceFromAttributes({
    'service.name': serviceName,
    'service.version': VERSION,
    'service.instance.id': options.nodeId,
    'crombolo.node.role': options.role,
  }).merge(resourceFromAttributes(pairsOf(env.OTEL_RESOURCE_ATTRIBUTES)))
  // The variables name the collector's base; the config's does too, so each signal's path is added.
  const url = (signal: string) =>
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    env[`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`] ||
    !options.telemetry?.endpoint
      ? undefined
      : `${options.telemetry.endpoint.replace(/\/+$/, '')}/v1/${signal}`
  // Read here, not left to the exporters, so a reader of this file sees every variable.
  const headers = pairsOf(env.OTEL_EXPORTER_OTLP_HEADERS)
  const at = (signal: string) => {
    const address = url(signal)
    return { ...(address ? { url: address } : {}), headers }
  }

  const contextManager = new AsyncLocalStorageContextManager().enable()
  context.setGlobalContextManager(contextManager)
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
  const tracerProvider = new TracerProvider({
    resource,
    sampler: await samplerFromEnv(env),
    spanProcessors: [new BatchSpanProcessor({ exporter: new exporters.Trace(at('traces')) })],
  })
  trace.setGlobalTracerProvider(tracerProvider)
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new exporters.Metric(at('metrics')),
        exportIntervalMillis: Number(env.OTEL_METRIC_EXPORT_INTERVAL) || 60_000,
      }),
    ],
  })
  metrics.setGlobalMeterProvider(meterProvider)
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new BatchLogRecordProcessor({ exporter: new exporters.Log(at('logs')) })],
  })
  logs.setGlobalLoggerProvider(loggerProvider)
  createInstruments(options.db)

  status = {
    enabled: true,
    endpoint: url('traces')?.replace(/\/v1\/traces$/, '') ?? endpoint,
    serviceName,
    role: options.role,
  }
  flush = async () => {
    await Promise.all([
      tracerProvider.forceFlush(),
      meterProvider.forceFlush(),
      loggerProvider.forceFlush(),
    ])
  }
  shutdown = async () => {
    await Promise.all([
      tracerProvider.shutdown(),
      meterProvider.shutdown(),
      loggerProvider.shutdown(),
    ]).catch(() => {})
    trace.disable()
    metrics.disable()
    logs.disable()
    propagation.disable()
    context.disable()
    for (const name of Object.keys(instruments))
      instruments[name as keyof typeof instruments] = undefined
    status = { enabled: false }
  }
  return status
}

/** Sends what is waiting now; for a test, and before a node stops. */
export const flushTelemetry = async (): Promise<void> => flush?.()

/** Stops the SDK, sending what is waiting. */
export async function stopTelemetry(): Promise<void> {
  const stop = shutdown
  shutdown = undefined
  flush = undefined
  await stop?.()
}

/** `a=1,b=two%20words`, as the specification writes headers and resource attributes. Pure. */
export function pairsOf(text: string | undefined): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const part of (text ?? '').split(',')) {
    const at = part.indexOf('=')
    if (at <= 0) continue
    const name = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    try {
      pairs[decodeURIComponent(name)] = decodeURIComponent(value)
    } catch {
      pairs[name] = value
    }
  }
  return pairs
}

/** The exporters for `OTEL_EXPORTER_OTLP_PROTOCOL`: protobuf, as the specification's default, or JSON. */
async function loadExporters(env: Environment) {
  const protocol = (signal: string) =>
    env[`OTEL_EXPORTER_OTLP_${signal}_PROTOCOL`] ||
    env.OTEL_EXPORTER_OTLP_PROTOCOL ||
    'http/protobuf'
  const json = (signal: string) => protocol(signal) === 'http/json'
  const [traces, metricsExporter, logsExporter] = await Promise.all([
    json('TRACES')
      ? import('@opentelemetry/exporter-trace-otlp-http')
      : import('@opentelemetry/exporter-trace-otlp-proto'),
    json('METRICS')
      ? import('@opentelemetry/exporter-metrics-otlp-http')
      : import('@opentelemetry/exporter-metrics-otlp-proto'),
    json('LOGS')
      ? import('@opentelemetry/exporter-logs-otlp-http')
      : import('@opentelemetry/exporter-logs-otlp-proto'),
  ])
  return {
    Trace: traces.OTLPTraceExporter,
    Metric: metricsExporter.OTLPMetricExporter,
    Log: logsExporter.OTLPLogExporter,
  }
}

/** `OTEL_TRACES_SAMPLER` and its argument, as the specification names them; every trace by default. */
async function samplerFromEnv(env: Environment) {
  const { AlwaysOffSampler, AlwaysOnSampler, ParentBasedSampler, TraceIdRatioBasedSampler } =
    await import('@opentelemetry/sdk-trace')
  const ratio = () => {
    const value = Number(env.OTEL_TRACES_SAMPLER_ARG)
    return new TraceIdRatioBasedSampler(
      Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1,
    )
  }
  switch (env.OTEL_TRACES_SAMPLER?.trim()) {
    case 'always_on':
      return new AlwaysOnSampler()
    case 'always_off':
      return new AlwaysOffSampler()
    case 'traceidratio':
      return ratio()
    case 'parentbased_always_off':
      return new ParentBasedSampler({ root: new AlwaysOffSampler() })
    case 'parentbased_traceidratio':
      return new ParentBasedSampler({ root: ratio() })
    default:
      return new ParentBasedSampler({ root: new AlwaysOnSampler() })
  }
}

function createInstruments(db: Db | undefined) {
  const meter = metrics.getMeter('crombolo', VERSION)
  instruments.requestDuration = meter.createHistogram('http.server.request.duration', {
    unit: 's',
    description: 'How long the server took to answer a request.',
  })
  instruments.renderDuration = meter.createHistogram('crombolo.render.duration', {
    unit: 's',
    description: 'How long a page took to render.',
  })
  instruments.cacheLookups = meter.createCounter('crombolo.published_cache.lookups', {
    description: 'Reads of the published content, answered from the snapshot or after building it.',
  })
  instruments.jobRuns = meter.createCounter('crombolo.job.runs', {
    description: 'Background job runs, by outcome.',
  })
  instruments.jobDuration = meter.createHistogram('crombolo.job.duration', {
    unit: 's',
    description: 'How long a background job ran.',
  })
  instruments.webhookDeliveries = meter.createCounter('crombolo.webhook.deliveries', {
    description: 'Webhook deliveries, by outcome.',
  })
  instruments.webhookRetries = meter.createCounter('crombolo.webhook.retries', {
    description: 'Webhook deliveries that will be tried again.',
  })
  if (db) {
    const queue = meter.createObservableGauge('crombolo.job.queue.depth', {
      description: 'Background jobs waiting to run.',
    })
    queue.addCallback(async (result) => {
      const { JobRepository } = await import('@crombolo/data')
      const { total } = await new JobRepository(db).list({ state: 'queued', take: 0 })
      result.observe(total)
    })
  }
}

const tracer = () => trace.getTracer('crombolo', VERSION)

/** Runs `fn` in a span of its own, ending it however `fn` ends. */
export async function inSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  options: { kind?: SpanKind; parent?: Context } = {},
): Promise<T> {
  return tracer().startActiveSpan(
    name,
    { kind: options.kind ?? SpanKind.INTERNAL, attributes },
    options.parent ?? context.active(),
    async (span) => {
      try {
        return await fn(span)
      } catch (error) {
        span.recordException({ name: error instanceof Error ? error.name : 'Error' })
        span.setStatus({ code: SpanStatusCode.ERROR })
        throw error
      } finally {
        span.end()
      }
    },
  )
}

/** The span running now, if there is one. */
export const activeSpan = (): Span | undefined => trace.getActiveSpan()

/** Sets attributes on the span running now, if there is one. */
export function noteOnSpan(attributes: Attributes): void {
  trace.getActiveSpan()?.setAttributes(attributes)
}

/** The trace a request continues: its `traceparent` from a trusted proxy, or a new one. */
export function requestContext(request: Request, trusted: boolean): Context {
  if (!trusted || !request.headers.has('traceparent')) return ROOT_CONTEXT
  return propagation.extract(ROOT_CONTEXT, Object.fromEntries(request.headers))
}

/** The trace a context continues, if any. */
export const traceIdOf = (continued: Context): string | undefined =>
  trace.getSpanContext(continued)?.traceId

/** `headers` with this trace's `traceparent`, so a receiver can join it. */
export function withTraceHeaders(headers: Record<string, string>): Record<string, string> {
  const carrier: Record<string, string> = {}
  propagation.inject(context.active(), carrier)
  return { ...headers, ...carrier }
}

/** The route a request is counted under: a template, never the address itself. Pure. */
export function routeOf(pathname: string, backOfficePath: string): string {
  if (pathname === '/health') return '/health'
  if (pathname.startsWith('/umbraco/delivery/api/')) return '/umbraco/delivery/api/*'
  if (pathname.startsWith(`${backOfficePath}/management/api/`))
    return `${backOfficePath}/management/api/*`
  if (pathname === backOfficePath || pathname.startsWith(`${backOfficePath}/`))
    return `${backOfficePath}/*`
  if (pathname.startsWith('/umbraco/')) return '/umbraco/*'
  if (pathname.startsWith('/media/')) return '/media/*'
  if (pathname.startsWith('/css/')) return '/css/*'
  if (pathname.startsWith('/scripts/')) return '/scripts/*'
  if (pathname.startsWith('/crombolo/')) return '/crombolo/*'
  return '/{page}'
}

export const recordRequest = (seconds: number, attributes: Attributes) =>
  instruments.requestDuration?.record(seconds, attributes)
export const recordRender = (seconds: number, attributes: Attributes) =>
  instruments.renderDuration?.record(seconds, attributes)
export const recordCacheLookup = (hit: boolean) =>
  instruments.cacheLookups?.add(1, { 'crombolo.cache.result': hit ? 'hit' : 'miss' })
export const recordJob = (seconds: number, attributes: Attributes) => {
  instruments.jobRuns?.add(1, attributes)
  instruments.jobDuration?.record(seconds, attributes)
}
export const recordWebhook = (outcome: 'delivered' | 'failed', retry: boolean) => {
  instruments.webhookDeliveries?.add(1, { 'crombolo.webhook.outcome': outcome })
  if (retry) instruments.webhookRetries?.add(1)
}

/** `fn` as a job whose every run is a span and a count, by outcome. */
export function tracedJob<A extends unknown[], R>(
  name: string,
  fn: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    const started = performance.now()
    let outcome = 'succeeded'
    try {
      return await inSpan(`job ${name}`, { 'crombolo.job.name': name }, () => fn(...args))
    } catch (error) {
      outcome = 'failed'
      throw error
    } finally {
      if (status.enabled)
        recordJob((performance.now() - started) / 1000, {
          'crombolo.job.name': name,
          'crombolo.job.outcome': outcome,
        })
    }
  }
}

/** A statement as a span names it: its operation and first table, never its values. Pure. */
export function statementSummary(sql: string): { operation: string; summary: string } {
  const text = sql.trim().replace(/\s+/g, ' ')
  const operation = (/^\w+/.exec(text)?.[0] ?? 'QUERY').toUpperCase()
  const table = /\b(?:from|into|update|join|table)\s+"?([A-Za-z_][\w.]*)"?/i.exec(text)?.[1]
  return { operation, summary: table ? `${operation} ${table}` : operation }
}

/**
 * `db` with each statement a span (story 262): its operation, first table and
 * text with placeholders, which never holds a value. Transactions and
 * snapshots hand on a traced handle too.
 */
export function tracedDb(db: Db): Db {
  if (!status.enabled) return db
  const system = db.dialect.name === 'postgres' ? 'postgresql' : 'sqlite'
  const run = <T>(sql: string, fn: () => Promise<T>) => {
    // Only under a request's or a job's span: a poller's statements would each be a trace of their own.
    if (!trace.getActiveSpan()) return fn()
    const { operation, summary } = statementSummary(sql)
    return inSpan(
      summary,
      {
        'db.system.name': system,
        'db.operation.name': operation,
        'db.query.summary': summary,
        'db.query.text': sql,
      },
      () => fn(),
      { kind: SpanKind.CLIENT },
    )
  }
  const wrap = (handle: Db): Db => ({
    dialect: handle.dialect,
    locks: handle.locks,
    get q() {
      return queryFor(this)
    },
    query: (sql, params) => run(sql, () => handle.query(sql, params)),
    exec: (sql, params) => run(sql, () => handle.exec(sql, params)),
    transaction: (fn) => handle.transaction((tx) => fn(wrap(tx))),
    readSnapshot: (fn) => handle.readSnapshot((reader) => fn(wrap(reader))),
    close: () => handle.close(),
    ...(handle.confine
      ? {
          confine: (role: string, schema: string) =>
            wrap((handle.confine as NonNullable<Db['confine']>).call(handle, role, schema)),
        }
      : {}),
    ...(handle.listen ? { listen: handle.listen.bind(handle) } : {}),
  })
  return wrap(db)
}

/** The site's e-mail with each message a span: its provider and outcome, never its addresses. */
export function tracedEmail<T extends EmailPort | undefined>(email: T): T {
  if (!email) return email
  return {
    description: email.description,
    provider: email.provider,
    send: (message) =>
      inSpan(
        'email send',
        { 'crombolo.email.provider': email.provider },
        async (span) => {
          const result = await email.send(message)
          span.setAttribute('crombolo.email.sent', result.ok)
          return result
        },
        { kind: SpanKind.CLIENT },
      ),
  } as T
}

const SEVERITY = { trace: 1, debug: 5, info: 9, warning: 13, error: 17, fatal: 21 } as const

/**
 * Log lines over OpenTelemetry, under the span they were written in: the
 * message's template, never its values, which can name a member or an
 * address, and the logger's category.
 */
export function telemetryLogSink(): Sink {
  return (record) => {
    if (!status.enabled) return
    const template =
      typeof record.rawMessage === 'string' ? record.rawMessage : record.rawMessage.join('{}')
    logs.getLogger('crombolo', VERSION).emit({
      timestamp: record.timestamp,
      severityNumber: SEVERITY[record.level],
      severityText: record.level.toUpperCase(),
      body: template,
      attributes: { 'crombolo.log.category': record.category.join('.') },
      context: context.active(),
    })
  }
}

/** The trace and span ids a log line is written under, for the CLEF file; empty outside a span. */
export function activeTraceIds(): { TraceId?: string; SpanId?: string } {
  const span = trace.getActiveSpan()?.spanContext()
  if (!span || !status.enabled || span.traceId === '00000000000000000000000000000000') return {}
  return { TraceId: span.traceId, SpanId: span.spanId }
}

export { SpanKind }

/** Whether an address is one of the trusted proxies: an exact address, or an IPv4 range. Pure. */
export function isTrustedProxy(address: string | undefined, proxies: readonly string[]): boolean {
  if (!address || proxies.length === 0) return false
  const bare = address.replace(/^::ffff:/, '')
  return proxies.some((proxy) => {
    const [base, bits] = proxy.split('/')
    if (bits === undefined) return base === bare || base === address
    const prefix = Number(bits)
    const from = ipv4(base ?? '')
    const at = ipv4(bare)
    if (from === undefined || at === undefined || !(prefix >= 0 && prefix <= 32)) return false
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
    return (from & mask) === (at & mask)
  })
}

function ipv4(address: string): number | undefined {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return undefined
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0)
}
