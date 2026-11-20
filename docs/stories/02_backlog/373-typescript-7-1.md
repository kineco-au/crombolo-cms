# 373 — TypeScript 7.1

**Epic:** E — Cross-cutting · **Priority:** could · **Size:** S
**Depends on:** — (TypeScript 7.1's stable release)

## Story

As a maintainer, I want the build on TypeScript 7.1 once it is stable, so that
the typecheck keeps pace with the compiler, and the API snapshot can hold
signatures if 7.1's JavaScript API makes that cheap.

## Context

Found 2026-11-17. The repo is on `typescript@7.0.2`, npm's `latest`.
`7.1.0-beta` came out on 2026-10-20 and nightlies follow (`7.1.0-dev.*`);
there is no stable 7.1 yet, which is all that keeps it in the backlog.

The beta's main entry still exports only `version`, as 7.0's does
([`architecture.md`](../../architecture.md), "Why openapi-typescript is held at
v6"). The compiler API returns on subpaths instead: `typescript/sync`,
`typescript/async`, `typescript/ast`, `typescript/ast/factory` and others. So
7.1 on its own unblocks none of the three places TypeScript 7 held back:

- **openapi-typescript stays at v6.** 7.13.0 still peers `typescript ^5.x` and
  reaches for `ts.factory` on the main entry. It moves only once it is
  released against the new subpaths.
- **A site on Next.js 15 keeps TypeScript 5**
  ([`delivery-api.md`](../../delivery-api.md), story `208`): Next 15 reads
  `next.config.ts` through the old API.
- **The API snapshot holds names, not signatures** ([`api.md`](../../api.md),
  story `173`). This is the one 7.1 may change: `typescript/sync` could read
  each export's signature. Untried against the beta.

## Acceptance criteria

- [ ] `typescript` is on the stable 7.1 in the root `package.json` and in
      `sites/harbourstone-next/web` and `sites/harbourstone-spa/web`, with
      `bun.lock` agreeing.
- [ ] `bun run typecheck` and `bun run check` pass, every new error fixed
      rather than suppressed.
- [ ] `architecture.md`'s toolchain table names 7.1, and its openapi-typescript
      section says what 7.1 does and does not export.
- [ ] Whether openapi-typescript has a release that works on 7.1 is checked;
      if one does, moving to it is proposed as its own story, not folded in.
- [ ] Whether `typescript/sync` can snapshot export signatures is tried and the
      finding recorded here; building it, if worthwhile, is its own story.
