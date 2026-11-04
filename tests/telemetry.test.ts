/**
 * Story 262: traces, metrics and logs over OpenTelemetry, read here from a
 * collector stub as they arrive. Nothing is sent without an endpoint; with
 * one, a page's request, render and statements are one trace, its log lines
 * carry the trace's id, and nothing sent carries an attribute outside the
 * allow-list below, which is the one place that list lives.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComponentRepository, ContentTypeRepository } from '@crombolo/data'
import {
  activeSpan,
  describeTelemetry,
  flushTelemetry,
  isTrustedProxy,
  pairsOf,
  requestContext,
  routeOf,
  statementSummary,
  stopTelemetry,
  telemetryEndpoint,
  telemetryStatus,
  traceIdOf,
} from '@crombolo/server'
import { dialectUnderTest } from './support/db.ts'
import { type Harness, ORIGIN, signedInServer, V1 } from './support/harness.ts'

/**
 * Every attribute anything sent may carry: shapes, ids and names the site
 * chose, never a member, an address, a form's answer, a query's values or a
 * page's content.
 */
const ALLOWED = new Set([
  // the resource
  'service.name',
  'service.version',
  'service.instance.id',
  'crombolo.node.role',
  'telemetry.sdk.language',
  'telemetry.sdk.name',
  'telemetry.sdk.version',
  // requests
  'http.request.method',
  'http.route',
  'http.response.status_code',
  'url.path',
  'crombolo.content.type',
  // renders
  'crombolo.template',
  'crombolo.render.status',
  'crombolo.render.skipped',
  // statements
  'db.system.name',
  'db.operation.name',
  'db.query.summary',
  'db.query.text',
  // jobs, webhooks and e-mail
  'crombolo.job.name',
  'crombolo.job.attempt',
  'crombolo.job.outcome',
  'crombolo.webhook.event',
  'crombolo.webhook.attempt',
  'crombolo.webhook.outcome',
  'crombolo.email.provider',
  'crombolo.email.sent',
  // the published cache, and logs
  'crombolo.cache.result',
  'crombolo.log.category',
  // an exception's type, never its message
  'exception.type',
])

interface Exported {
  traces: Record<string, unknown>[]
  metrics: Record<string, unknown>[]
  logs: Record<string, unknown>[]
}

let collector: ReturnType<typeof Bun.serve>
const received: Exported = { traces: [], metrics: [], logs: [] }
beforeAll(() => {
  collector = Bun.serve({
    port: 0,
    async fetch(request) {
      const signal = new URL(request.url).pathname.replace('/v1/', '') as keyof Exported
      if (signal in received)
        received[signal].push((await request.json()) as Record<string, unknown>)
      return Response.json({})
    },
  })
})
afterAll(() => collector.stop(true))

const open: Harness[] = []
const dirs: string[] = []
afterEach(async () => {
  while (open.length > 0)
    await open
      .pop()
      ?.server.close()
      .catch(() => {})
  await stopTelemetry()
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
  delete process.env.OTEL_EXPORTER_OTLP_PROTOCOL
  for (const signal of Object.keys(received) as (keyof Exported)[]) received[signal] = []
})

async function site(telemetry: Record<string, string> | undefined) {
  const root = mkdtempSync(join(process.cwd(), 'output', 'telemetry-'))
  dirs.push(root)
  for (const dir of ['schema/content-types', 'components'])
    mkdirSync(join(root, dir), { recursive: true })
  writeFileSync(join(root, 'schema', 'schema.toml'), '[schema]\nversion = "1.0.0"\n')
  writeFileSync(
    join(root, 'schema', 'content-types', 'page.toml'),
    `[content-type]
alias = "page"
name = "Page"
allow-at-root = true
components = ["page", "broken"]
default-component = "page"
`,
  )
  writeFileSync(
    join(root, 'components', 'page.tsx'),
    'export default ({ model }) => <main>{model.name}</main>\n',
  )
  writeFileSync(
    join(root, 'components', 'broken.tsx'),
    "export default () => { throw new Error('a@b.example is not here') }\n",
  )
  // JSON, so the stub can read what arrives; a site's default is protobuf.
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL = 'http/json'
  const h = await signedInServer({
    config: {
      siteDir: root,
      schemaDir: join(root, 'schema'),
      componentsDir: join(root, 'components'),
      componentsCacheDir: join(root, '.crombolo'),
      ...(telemetry ? { telemetry } : {}),
    },
  })
  open.push(h)
  const created = await h.post(`${V1}/document`, {
    documentType: { id: (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key },
    template: { id: (await new ComponentRepository(h.server.db).byAlias('page'))?.key },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Home' }],
  })
  const key = created.headers.get('umb-generated-resource') as string
  expect((await h.put(`${V1}/document/${key}/publish`, { publishSchedules: [] })).status).toBe(200)
  const broken = await h.post(`${V1}/document`, {
    documentType: { id: (await new ContentTypeRepository(h.server.db).byAlias('page'))?.key },
    template: { id: (await new ComponentRepository(h.server.db).byAlias('broken'))?.key },
    parent: null,
    values: [],
    variants: [{ culture: null, segment: null, name: 'Broken' }],
  })
  const brokenKey = broken.headers.get('umb-generated-resource') as string
  expect(
    (await h.put(`${V1}/document/${brokenKey}/publish`, { publishSchedules: [] })).status,
  ).toBe(200)
  return h
}

type Span = {
  name: string
  traceId: string
  spanId: string
  parentSpanId?: string
  attributes: { key: string }[]
}

const spansIn = () =>
  received.traces.flatMap((body) =>
    (body.resourceSpans as { scopeSpans: { spans: Span[] }[] }[]).flatMap((r) =>
      r.scopeSpans.flatMap((s) => s.spans),
    ),
  )
const attributeOf = (span: Span, key: string) =>
  (span.attributes as { key: string; value: Record<string, unknown> }[]).find((a) => a.key === key)
    ?.value

/** Every attribute key anywhere in what was sent: resources, spans, data points and log records. */
function keysIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysIn(item, into)
  else if (value && typeof value === 'object')
    for (const [name, inner] of Object.entries(value)) {
      if (name === 'attributes' && Array.isArray(inner))
        for (const attribute of inner as { key: string }[]) into.add(attribute.key)
      keysIn(inner, into)
    }
  return into
}

describe(`telemetry (${dialectUnderTest})`, () => {
  test('with no endpoint, nothing is started or sent, and the diagnostics say so', async () => {
    const h = await site(undefined)
    expect((await h.server.fetch(new Request(`${ORIGIN}/`))).status).toBe(200)
    expect(telemetryStatus().enabled).toBe(false)
    expect(activeSpan()).toBeUndefined()
    await flushTelemetry()
    expect(received.traces).toEqual([])
    expect(describeTelemetry(telemetryStatus())).toBe('Not sent anywhere')
  })

  test('a page’s request, render and statements are one trace, and its log lines carry it', async () => {
    const h = await site({
      endpoint: `http://127.0.0.1:${collector.port}`,
      serviceName: 'riverside',
    })
    expect(telemetryStatus()).toMatchObject({
      enabled: true,
      serviceName: 'riverside',
      role: 'all',
    })
    expect((await h.server.fetch(new Request(`${ORIGIN}/`))).status).toBe(200)
    expect((await h.server.fetch(new Request(`${ORIGIN}/no-such-page`))).status).toBe(404)
    await flushTelemetry()

    const spans = spansIn()
    const request = spans.find(
      (s) => s.name === 'GET /{page}' && attributeOf(s, 'url.path')?.stringValue === '/',
    ) as Span
    expect(request).toBeDefined()
    expect(attributeOf(request, 'http.response.status_code')).toEqual({ intValue: 200 })
    expect(attributeOf(request, 'crombolo.content.type')).toEqual({ stringValue: 'page' })
    const render = spans.find((s) => s.name === 'render' && s.traceId === request.traceId) as Span
    expect(render?.parentSpanId).toBe(request.spanId)
    expect(attributeOf(render, 'crombolo.template')).toEqual({ stringValue: 'page' })
    const statements = spans.filter(
      (s) => s.traceId === request.traceId && attributeOf(s, 'db.system.name'),
    )
    expect(statements.length).toBeGreaterThan(0)

    const metricNames = received.metrics.flatMap((body) =>
      (body.resourceMetrics as { scopeMetrics: { metrics: { name: string }[] }[] }[]).flatMap((r) =>
        r.scopeMetrics.flatMap((s) => s.metrics.map((m) => m.name)),
      ),
    )
    expect(metricNames).toEqual(
      expect.arrayContaining([
        'http.server.request.duration',
        'crombolo.render.duration',
        'crombolo.published_cache.lookups',
        'crombolo.job.queue.depth',
      ]),
    )

    // A job's run is a span of its own.
    await h.server.jobs.runWebhooks()
    // A failing page logs under its request's trace, and its log line holds no value.
    expect((await h.server.fetch(new Request(`${ORIGIN}/broken`))).status).toBe(500)
    await flushTelemetry()
    expect(spansIn().some((s) => s.name === 'job webhooks')).toBe(true)
    const failed = spansIn().find(
      (s) => s.name === 'GET /{page}' && attributeOf(s, 'url.path')?.stringValue === '/broken',
    ) as Span
    expect(failed).toBeDefined()
    const records = received.logs.flatMap((body) =>
      (
        body.resourceLogs as {
          scopeLogs: { logRecords: { traceId?: string; body: unknown }[] }[]
        }[]
      ).flatMap((r) => r.scopeLogs.flatMap((s) => s.logRecords)),
    )
    expect(records.some((record) => record.traceId === failed.traceId)).toBe(true)
    for (const record of records) expect(JSON.stringify(record.body)).not.toContain('a@b.example')

    // Nothing sent carries an attribute the allow-list does not name.
    const keys = keysIn(received)
    expect([...keys].filter((key) => !ALLOWED.has(key))).toEqual([])
    expect(describeTelemetry(telemetryStatus())).toBe(
      `Sent to http://127.0.0.1:${collector.port} as riverside (all)`,
    )
  })
})

describe('the telemetry policy', () => {
  test('starts only with an endpoint, from the standard variables first', () => {
    expect(telemetryEndpoint(undefined, {})).toBeUndefined()
    expect(telemetryEndpoint({ endpoint: 'http://a' }, {})).toBe('http://a')
    expect(
      telemetryEndpoint({ endpoint: 'http://a' }, { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://b' }),
    ).toBe('http://b')
    expect(telemetryEndpoint(undefined, { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://t' })).toBe(
      'http://t',
    )
  })

  test('reads headers and resource attributes as the specification writes them', () => {
    expect(pairsOf('api-key=abc,Authorization=Basic%20xyz')).toEqual({
      'api-key': 'abc',
      Authorization: 'Basic xyz',
    })
    expect(pairsOf(undefined)).toEqual({})
    expect(pairsOf('broken,=x,a=1')).toEqual({ a: '1' })
  })

  test('follows a trace only from a trusted proxy', () => {
    expect(isTrustedProxy('10.1.2.3', ['10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxy('::ffff:10.1.2.3', ['10.0.0.0/8'])).toBe(true)
    expect(isTrustedProxy('11.1.2.3', ['10.0.0.0/8'])).toBe(false)
    expect(isTrustedProxy('192.168.1.1', ['192.168.1.1'])).toBe(true)
    expect(isTrustedProxy('192.168.1.1', [])).toBe(false)
    expect(isTrustedProxy(undefined, ['10.0.0.0/8'])).toBe(false)
    const request = new Request(ORIGIN, {
      headers: { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' },
    })
    expect(traceIdOf(requestContext(request, false))).toBeUndefined()
  })

  test('names a route by its template and a statement by its shape, never its values', () => {
    expect(routeOf('/news/today', '/crombolo')).toBe('/{page}')
    expect(routeOf('/umbraco/delivery/api/v2/content', '/crombolo')).toBe('/umbraco/delivery/api/*')
    expect(routeOf('/crombolo/management/api/v1/document', '/crombolo')).toBe(
      '/crombolo/management/api/*',
    )
    expect(statementSummary('select * from "node" where id = ?')).toEqual({
      operation: 'SELECT',
      summary: 'SELECT node',
    })
    expect(statementSummary('insert into job (id) values ($1)')).toEqual({
      operation: 'INSERT',
      summary: 'INSERT job',
    })
  })
})
