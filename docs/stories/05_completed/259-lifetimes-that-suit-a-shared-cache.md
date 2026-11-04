# 259 — Lifetimes that suit a shared cache

**Epic:** F — Headless · **Priority:** should · **Size:** S
**Depends on:** 057, 258

## Story

As someone running a site behind a CDN, I want a setting that tells the
cache to keep copies but check with the site before serving them, and to
keep serving them if the site is down, so that visitors get a fast answer, a
publish is seen at the next check, and an outage shows the last good page
rather than an error.

## Context

Story `057`'s lifetime is one number for everyone: `public, max-age=N,
stale-while-revalidate=M`, and nothing at all when unset. With `258`'s cheap
validator, the shape that needs no purge is different: a lifetime of zero
with a long `stale-while-revalidate`, so a shared cache serves what it has
at once and checks behind the visitor, and the site answers `304` for
nothing. CloudFront, Cloudflare and Fastly all honour
`stale-while-revalidate` and `stale-if-error`; browsers honour the first.

That shape cannot be written today: `maxAge: 0` means "keep nothing"
(`chosenLifetime`), and there is no `stale-if-error`.

### Decisions

- **How 'check' meets the ETag. Decided (2026-11-04): a floor for body
  ETags.** Behind a CDN, `max-age=0` with `stale-while-revalidate` means the
  copy is stale again after every check, so the site is asked about once
  per request per CDN location. With `258`'s `published` ETag that answer
  is a `304` without rendering, so `check` sends `max-age=0`. With the
  default `body` ETag every check renders the page, which is as much work as
  having no CDN, so `check` sends a short `max-age`, a minute by default
  (`cache.checkFloor`), and each location renders a page at most once a
  minute. The page's own validator decides, so a type set to `body` on a
  `published` site gets the floor. `maxAge` overrides either. A site with
  `check` and any `body` pages logs one line at start-up saying `published`
  is the cheaper setting where pages do not show the time. Nothing is
  turned on for the site, since only the site knows which pages read the
  clock. Making `check` turn on `published`, and refusing `check` without
  it, were turned down.
- **A named mode, not a recipe. Decided (2026-11-04), as proposed:** `cache.mode: 'check'` (or
  `CROMBOLO_CACHE_MODE=check`), which sends `public, max-age=0,
  stale-while-revalidate=<N>, stale-if-error=<M>` with generous defaults
  (a day and a week), overridable by `staleWhileRevalidate` and a new
  `staleIfError`. "Keep copies for" on a type, page or item still wins, as
  the editor's choice; *Don't keep copies* still sends `no-store`. The
  alternative, teaching `maxAge: 0` to mean "check" when
  `staleWhileRevalidate` is set, changes a shipped meaning.
- **Browsers. Decided (2026-11-04), as proposed.** `max-age=0` makes a browser check too, which is right: a
  returning visitor's own copy is validated against the site, and `258`
  makes that cheap. `stale-while-revalidate` lets the browser show its copy
  first; a site that would rather the browser wait would set
  `cache.browser: 'wait'`, adding `must-revalidate`; only the default ships,
  and the docs note the option.
- **The Delivery API. Decided (2026-11-04), as proposed:** it takes the same mode; a members-only or private
  answer stays `private, no-store`.
- **`stale-if-error`. Decided (2026-11-04), as proposed:** for every mode, including `057`'s
  lifetimes, defaulting to a week when any lifetime is set and to nothing
  when none is: a site that keeps nothing keeps nothing on an error either.

## Acceptance criteria

- [x] `cache.mode: 'check'` sends `public, max-age=0,
      stale-while-revalidate=86400, stale-if-error=604800` on public pages
      and API answers with no lifetime of their own and a `published` ETag,
      and `max-age=60` in its place for one whose ETag is over its body.
- [x] `staleWhileRevalidate` and `staleIfError` at the site and type levels
      override the defaults; "Keep copies for" on a type, page or item wins
      over the mode.
- [x] A `057` lifetime gains `stale-if-error`, a week unless set.
- [x] Private answers are unchanged.
- [x] `configuration.md` lists the new settings; `operations.md` "Behind a
      CDN" shows `check` as the recommended setting for a CDN with no purge
      hook, and when a lifetime is the better choice.
- [x] Tests on SQLite and Postgres.

## Out of scope

- A separate lifetime for shared caches and browsers (`s-maxage` or
  `CDN-Cache-Control`). CloudFront does not read `CDN-Cache-Control`; with
  `max-age=0` and `258` there is nothing to separate.
- Purge tags and the publish webhook, which stay as `057` built them.

## Implementation

- `packages/render/src/cache-policy.ts`: `CacheMode`; `lifetimeOf` gives a
  `check` lifetime, `max-age=0` with `stale-while-revalidate` a day and
  `stale-if-error` a week and `check: true`, when the mode is `check` and no
  `maxAge` is set, and adds `stale-if-error` (a week unless set) to every
  lifetime. A type in `check` mode naming only how long stale copies last is
  a `check` lifetime with those. `chosenLifetime` and a template's
  `revalidate` carry the site's `staleIfError`. `cacheControl` writes
  `stale-if-error`, and the floor in place of `max-age=0` for a `check`
  lifetime; `cacheable` passes the floor only when the ETag is over the
  body, so the page's own validator decides.
- `CROMBOLO_CACHE_MODE`, `CROMBOLO_CACHE_STALE_IF_ERROR`,
  `CROMBOLO_CACHE_CHECK_FLOOR`; the server logs one line at start-up when
  `check` meets pages whose ETag is over their body.
- Tests: `tests/cache-headers.test.ts`, "check"; every earlier expectation
  of a kept page now carries `stale-if-error=604800`. SQLite and Postgres.
