# 218 — Build islands ahead of time

**Epic:** O — Building a site · **Priority:** could · **Size:** S
**Depends on:** 209

## Story

As someone running a site on a host whose filesystem is read-only at runtime,
or who wants an immutable deploy image, I want `crombolo build` to bundle the
site's islands ahead of time, so the server serves them without writing
anything.

## Context

Story 209 builds a generation's island code when the generation is taken
(`buildIslands`, `packages/server/src/islands.ts`). It writes `.islands/out/`
and `manifest.json` beside the snapshot, so a page and its browser code always
match. That needs a writable views cache, which snapshots need anyway, and a
few hundred milliseconds at boot. Decided while planning 209: build at runtime
now, with an ahead-of-time command to follow, writing the same manifest.

## Acceptance criteria

- [ ] `crombolo build` bundles `components/`'s client modules,
      `components/client/*` and React's mount into a directory, with the same
      `manifest.json` shape the runtime build writes.
- [ ] A server started with that output (`islands.prebuilt`, or found by
      convention) serves it and builds nothing, as long as the views it was
      built from are the views being served. When they are not, it says so
      at boot and builds as today.
- [ ] `docs/rendering.md` "Islands" and `docs/operations.md` describe it. Unit
      tests cover the command, serving the output, and the mismatch.
