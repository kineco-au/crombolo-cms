# 224 — A route handler's signal is let go once it has answered

**Epic:** O — Building a site · **Priority:** should · **Size:** S
**Depends on:** 211

## Story

As someone running a site whose route handlers listen for a cancelled
request, I want each request's signal to be let go once it has answered, so
that a busy API route does not grow the process until it runs out of memory.

## Context

A route handler (`211`) gets `context.signal`, aborted when the visitor leaves
or `CROMBOLO_ROUTE_TIMEOUT_MS` passes. `docs/rendering.md` ("Errors and time")
shows it passed straight to `fetch(url, { signal })`.

`packages/server/src/routes.ts` builds it as
`AbortSignal.any([request.signal, deadline.signal])`. Story `175` found that
Bun keeps such a signal, its sources and everything they reach alive while any
listener is on it. Measured 2026-10-31 over 20,000 requests, on Bun 1.4.2 and
1.4.3:

| Handler | Resident memory growth |
| --- | --- |
| does not touch the signal | 6–30 MB |
| adds an `abort` listener and never removes it | 106–110 MB, about 5 KB a request, for good |
| the same, with the signal aborted once it has answered | 8–28 MB |
| `fetch(url, { signal })` | 15–44 MB, aborted or not |

`fetch` removes its own listener once it is done, so it does not leak. A
handler leaks when its code, or a library it calls, adds a listener and leaves
it there, as a cancellable job or a stream reader typically does.

The page renderer had the same fault and was fixed in `175`
(`#withDeadline` in `packages/render/src/renderer.ts`): it removes its own
listener and aborts the signal with "The page has rendered." once the page is
done. A render's signal is finished with by then; a route's may not be.

- A handler can answer with a streamed body that is still being read, for
  example a `ReadableStream` piped from `fetch(url, { signal })`. Aborting the
  signal when the handler returns would cut that body off part-way.
- The deadline timer is cleared once the handler returns, so today a stream
  that outlives the handler has only the visitor leaving to stop it.

## Decisions (2026-10-31)

1. **The signal ends when the answer has been sent** (option 1 below).
2. **The route timeout covers the handler only, as now.** A body still
   streaming once the handler has answered is limited by the visitor leaving
   and by the stream ending, not by `CROMBOLO_ROUTE_TIMEOUT_MS`, so a long
   download or a feed of server-sent events keeps working. Not chosen: the
   timeout covering the whole answer, which cuts off every stream longer than
   it; a per-route limit for the body, one more option nobody has asked for.

The options decision 1 chose from, for when the signal ends:

1. **When the answer has been sent** (chosen). A response with no body aborts
   the signal as the handler returns; a body is wrapped, and the signal is
   aborted when it has been read to its end, fails or is cancelled. A visitor
   leaving still aborts it at any point. A streamed body keeps working; work a
   handler leaves running after it answers, still listening to the signal, is
   stopped once the answer has been sent.
2. **When the handler returns.** It's the simplest, and the same as the
   renderer. But it breaks a streamed body that reads from the signal, and the
   docs would have to tell such a handler to make its own controller.
3. **Not ended when the request is over: a plain controller instead of
   `AbortSignal.any`.** The visitor leaving and the deadline are forwarded to
   it by listeners that the route removes when the answer is sent. That avoids
   the Bun behaviour rather than ending the signal, but it still needs option
   1's end-of-body hook to remove the visitor listener, and code holding the
   signal never learns that the request is over.

## Plan

1. **End the signal with the answer** (`packages/server/src/routes.ts`,
   `invoke`). An `answered` function aborts `deadline` with
   `new Error('The answer has been sent.')`, once, so every listener runs and
   Bun lets the signal go:
   - a `HEAD`, or a body of `null`: called as the response is built;
   - any body, a 500's problem included: passed through a `TransformStream`
     whose `flush` and `cancel` call it, so it runs when the body has been read
     to its end, fails, or the visitor leaves part-way;
   - a 504: the deadline has already aborted it. Checked on Bun: `Content-Length` is kept for a
     fixed body, and `cancel` runs when the client disconnects.
2. **The timeout, as now** (decision 2): the timer is still cleared when the
   handler answers.
3. **Tests** (`tests/routes.test.ts`):
   - a handler that adds an `abort` listener and never removes it: once the
     answer is read, the signal is aborted with "The answer has been sent.",
     and a `WeakRef` to an object the listener holds is empty after
     `Bun.gc(true)`;
   - a streamed body that reads from the signal is read to its end, and the
     signal is aborted only after its last chunk;
   - a visitor who cancels a streamed body part-way aborts the signal;
   - a `HEAD`, a 500 and a 504 each end it; the existing timeout test stands.
4. **Docs:** `docs/rendering.md`, "Errors and time": the signal is aborted
   when the visitor leaves, when the handler overruns, and once the answer has
   been sent, so work still listening is stopped then; the timeout covers the
   time to the handler's answer, not a body that streams after it. A line in
   the release notes.

## Acceptance criteria

- [x] A route handler that listens to `context.signal` and answers leaves
      nothing reachable once its answer is sent: the signal is aborted with
      "The answer has been sent.", and what its listener holds is collected.
- [x] The visitor leaving, and the route timeout, still abort the signal while
      the handler runs, and a 504 still answers an overrun.
- [x] A streamed body is read to its end, and the signal ends after it, or
      when the visitor cancels it part-way.
- [x] A route that adds an `abort` listener and never removes it no longer
      grows the process: the measurement above, repeated through
      `server.fetch`, grows as the handler that does not touch the signal does.
- [x] `docs/rendering.md` ("Errors and time") says when the signal ends, and
      that the timeout covers the handler, not a body streamed after it.

## What was built

- `invoke` in `packages/server/src/routes.ts` aborts the route's deadline with
  `ANSWERED` ("The answer has been sent.") once the answer is sent: at once for
  a `HEAD` or an empty body, otherwise from the `flush` or `cancel` of a
  `TransformStream` the body passes through. Checked on Bun 1.4: `cancel` runs
  when the visitor disconnects and when the body's source fails, and a fixed
  body keeps its `Content-Length`.
- The timeout is unchanged (decision 2).
- Tests in `tests/routes.test.ts`, "a route's signal once it has answered": a
  listener's hold is collected, a streamed body reads to its end, a visitor's
  cancel, a `HEAD`, a 500 and a 504.
- Measured through `createRoutes`, 20,000 requests with a listener left on the
  signal: resident memory flat (−12 MB), as with none (−11 MB).
- `docs/rendering.md`, "Errors and time" and "When `signal` ends"; the release
  notes.

## Out of scope

Signals elsewhere: the renderer's is fixed (`175`), and nothing else in the
server uses `AbortSignal.any`.
