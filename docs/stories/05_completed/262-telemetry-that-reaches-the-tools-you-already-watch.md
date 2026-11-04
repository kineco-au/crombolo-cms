# 262 — Telemetry that reaches the tools you already watch

**Epic:** E — Cross-cutting · **Priority:** should · **Size:** L
**Depends on:** 047

## Story

As someone running a site, I want its traces, metrics and logs sent to the
tool my team already watches, Datadog, Grafana, Honeycomb or my own
collector, so that a slow page or a failing job shows up where everything
else does, with the request it belonged to, and not only in a log file on
the server.

## Context

Story `047` built the back office's diagnostics screens and set Umbraco's
usage telemetry to Minimal, honestly answering that nothing is sent
anywhere; it left "an external metrics or tracing pipeline" out of scope.
Logging goes through LogTape (`packages/server`, `@logtape/logtape`): message
templates with properties, written as CLEF to a file a day
(`CROMBOLO_LOGS_DIR`) and to the console. There are no metrics and no traces.

OpenTelemetry is the one protocol every such tool takes. OTLP over HTTP is
plain `fetch` with protobuf or JSON bodies, which suits Bun; the Node SDK's
automatic instrumentation does not, since it hooks `require`, so the spans
here are made by hand at the seams the server already has. LogTape has an
OpenTelemetry sink, so the logs join the same pipeline with the same trace
ids.

A hosting platform running this CMS gives a customer its code settings and
secrets; with the standard `OTEL_*` variables honoured, pointing a site at a
collector is a setting, and the platform needs no plumbing of its own.

### Decisions

- **How it is produced and sent. Decided (2026-11-04): OpenTelemetry's API
  and SDK packages.** `@opentelemetry/api` with the SDK's tracer, meter and
  log providers and the OTLP/HTTP exporters, and LogTape's OpenTelemetry sink
  for the logs. Batching, retries, sampling and the `OTEL_*` variables are
  the SDK's, and a site's or bundle's own code adds spans through the same
  API. The SDK is loaded only when an endpoint is set. Spans are still made
  by hand at the server's seams, since the Node SDK's automatic
  instrumentation hooks `require` and does not run on Bun. A hand-written
  OTLP exporter was turned down for keeping up with the specification
  ourselves, and the API alone with our own exporter for the same.

- **A trace that arrives with a request. Decided (2026-11-04): followed
  only from trusted proxies.** An incoming W3C `traceparent` continues the
  trace only when the request's own peer address is one of the site's
  trusted proxies; anything else starts a new one, so a visitor cannot
  choose trace ids or force sampling. The site had no such list (its
  `X-Forwarded-For` is only recorded), so this adds one:
  `CROMBOLO_TRUSTED_PROXIES`, or `trustedProxies` in `crombolo.config.ts`,
  addresses or ranges such as `10.0.0.0/8`. Unset, no incoming trace is
  followed. The server's own outgoing calls
  (webhooks, `fetch` from a page) always send `traceparent`. Following every
  incoming one, OpenTelemetry's default, and following none were turned down.
- **How much is traced. Decided (2026-11-04): every trace, unless
  `OTEL_TRACES_SAMPLER` says otherwise**, as the specification does:
  `OTEL_TRACES_SAMPLER` and `OTEL_TRACES_SAMPLER_ARG` (such as
  `parentbased_traceidratio` at `0.1`) cut it for a busy site, and a trace
  continued from a trusted proxy keeps that proxy's choice. Metrics count
  every request either way. A tenth by default was turned down for losing a
  quiet site's slow page, and keeping errors and slow traces for needing tail
  sampling, which is a collector's job.
- **Where it is configured. Decided (2026-11-04): settings only, shown
  read-only.** The `OTEL_*` variables or `telemetry` in `crombolo.config.ts`,
  as a hosting platform hands a site its secrets. The Settings screen shows
  whether it is on, the endpoint, the service name and the node's role, and
  never the headers, which usually hold an API key. Editing it in the back
  office was turned down for keeping a key in the database and reconfiguring
  the SDK while running.
- **Off unless an endpoint is set. Decided (2026-11-04), as proposed.** `OTEL_EXPORTER_OTLP_ENDPOINT` (or
  `telemetry.endpoint` in `crombolo.config.ts`) turns it on; without it nothing
  is instrumented beyond a no-op, and `047`'s screen keeps saying nothing is
  sent. It honours `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`,
  `OTEL_RESOURCE_ATTRIBUTES` and the per-signal endpoint and protocol
  variables as the specification names them, and nothing invented.
- **What a span covers. Decided (2026-11-04), as proposed.** In this order of worth: a request (route,
  status, the page's content type, the node's role), a render (template,
  components, cache hit or miss), a database query (the statement's shape,
  never its values), a Delivery API call, a job run, a webhook delivery, an
  e-mail. Each carries the trace id into the log lines written under it.
- **What is measured. Decided (2026-11-04), as proposed.** Request count and duration by route and
  status; render duration; published-cache hits and misses; job runs and
  their outcome; webhook deliveries and retries; the queue's depth. Named as
  the semantic conventions name them where one exists.
- **What is never sent. Decided (2026-11-04), as proposed.** No member identity, no e-mail address, no form
  answer, no query values, no page content: attributes are shapes and ids,
  and a test holds the attribute set to an allow-list. The back office's
  Settings screen says what is sent and where.
- **Where it runs. Decided (2026-11-04), as proposed.** Every role, including `worker` (`223`), each naming its
  role in the resource attributes, so a trace that crosses a job and a page
  reads as one.

## Acceptance criteria

- [x] With no endpoint set, nothing is exported, no SDK is initialised, and
      the diagnostics screen still says nothing is sent.
- [x] With `OTEL_EXPORTER_OTLP_ENDPOINT` set, traces, metrics and logs reach
      an OTLP/HTTP collector, with the standard headers, service name and
      resource attributes honoured; a test runs a collector stub and reads
      what arrives.
- [x] A rendered page's trace holds its request, render and query spans,
      and the log lines written during it carry its trace id.
- [x] A job's run and a webhook's delivery are traced, on the role that ran
      them.
- [x] The metrics listed above are exported with the names decided.
- [x] No attribute carries a value from the allow-list's complement; the
      test that holds this is the one place the list lives.
- [x] The Settings screen names the endpoint when one is set, and the
      documentation (`operations.md`, `configuration.md`) shows Datadog,
      Grafana Cloud and a local collector as three worked examples.
- [x] Tests on SQLite and Postgres; the exporter's cost at idle measured and
      recorded here.

## Out of scope

- Umbraco's own usage telemetry, which stays at Minimal (`047`).
- Browser telemetry: islands and the back office send nothing.
- A hosted collector or dashboards of our own.

## Implementation

- `packages/server/src/telemetry.ts`: `startTelemetry` loads OpenTelemetry's
  SDK 3.0 (`@opentelemetry/sdk-trace`, `-metrics`, `-logs`, the OTLP/HTTP
  exporters in protobuf or JSON by `OTEL_EXPORTER_OTLP_PROTOCOL`) only when an
  endpoint is set, from `core.ts`, so every role starts it. The 3.0 trace SDK
  no longer reads `OTEL_TRACES_SAMPLER`, so `samplerFromEnv` does, as the
  specification names it. The resource names the site (`OTEL_SERVICE_NAME`
  winning), the version, the node and its role, with
  `OTEL_RESOURCE_ATTRIBUTES` merged. The exporters read the endpoint, headers
  and timeout variables themselves; `telemetry.endpoint` in code adds each
  signal's path.
- **Spans:** a request (`server.ts`, `fetch`, by `routeOf`'s template, its
  status and the page's content type), its render, the Delivery API, each
  database statement under a request or job (`tracedDb`, operation, first
  table and the text with placeholders), a bundle job's run (`owner-jobs.ts`),
  each core background job (`jobs.ts`, `tracedJob`; the search index's tick
  and the queue's upkeep left out so a quiet site sends little), a webhook
  delivery, which also sends `traceparent` (`webhooks.ts`), and an e-mail
  (`tracedEmail`, its provider only).
- **Incoming traces:** `requestContext` follows `traceparent` only when the
  peer is in `CROMBOLO_TRUSTED_PROXIES` / `trustedProxies` (`isTrustedProxy`,
  addresses and IPv4 ranges).
- **Metrics:** `http.server.request.duration`, `crombolo.render.duration`,
  `crombolo.published_cache.lookups` (`PublishedCache`'s `onRead`),
  `crombolo.job.runs`, `crombolo.job.duration`, `crombolo.webhook.deliveries`,
  `crombolo.webhook.retries` and `crombolo.job.queue.depth`.
- **Logs:** `telemetryLogSink` sends each line as its template with its
  category, never its values, under the span it was written in; the CLEF file
  gains `TraceId` and `SpanId`.
- **Settings:** System information's "Telemetry" line (`describeTelemetry`),
  never the headers. The `OTEL_*` variables and `CROMBOLO_TRUSTED_PROXIES`
  are declared in `settings.ts`, so `configuration.md` lists them.
- **Tests:** `tests/telemetry.test.ts` runs a collector stub and reads what
  arrives: nothing without an endpoint; a request, its render and its
  statements as one trace; a failing page's log line under its trace with no
  value in it; a job's run; the metrics' names; and every attribute held to
  the allow-list, which lives only there. On SQLite and Postgres.
- **Cost at idle**, measured 2026-11-04 in the test container, an idle
  server over 60 seconds after a 5-second settle: telemetry off 384 ms of
  CPU (0.64% of a core), 107 MB resident; on, with a collector stub, 591 ms
  (0.99%), 120 MB, and 16.9 KB sent. About a third of a percent of a core and
  13 MB.
