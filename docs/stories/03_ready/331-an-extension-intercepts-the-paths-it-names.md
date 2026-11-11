# 331 — An extension intercepts the paths it names

**Epic:** I — Hardening · **Priority:** could · **Size:** L
**Depends on:** 311, 327

## Story

As the author of a geo-router, an experiment splitter or a redirects engine the core one
cannot express, I want my extension to decide per request on the paths it names, so that
request-time behaviour is possible without running inside the CMS.

## Context

An isolated extension may not offer `middleware` (story 311): it would put a round trip on
every request. Most request-time needs are behaviour as data a host engine applies, which
redirect rules already are and headers, rewrites and robots entries could be. What remains
is logic per request. Cloudflare Workers and Vercel's middleware run untrusted code for that
with a budget per request.

## Decisions (2026-11-11)

- **A permission, `routes.intercept`, with the path patterns named**, shown in the install
  panel under Adds as "decides what happens at /shop/* before the site does".
- **Each matching request is one channel call**, answering `redirect`, `rewrite`, `headers` or
  `pass`. It never sees the body, and never answers the response itself.
- **A hard budget** of a few milliseconds, declared `failOpen` or `failClosed` when exceeded,
  and its latency in the activity view (story 327).
- **Never `/*` without a warning** in the panel: the cost is on every request.

## Acceptance criteria

- [ ] An extension declares patterns and a handler, and matching requests reach it before the
      site answers, with non-matching requests untouched.
- [ ] The budget is enforced, with the declared outcome when exceeded.
- [ ] The install panel names the paths; the activity view shows the calls and their latency.
- [ ] Covering tests; `extensions.md`, the threat model and release notes.
