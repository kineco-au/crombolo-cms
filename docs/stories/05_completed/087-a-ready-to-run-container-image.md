# 087 — A ready-to-run container image

**Epic:** I — Hardening · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As someone running crombolo on my own cloud account, I want to start it from a
published container image, so that I can stand a site up from my provider's
console without building an image myself.

## Context

Story `080` decided there is no install wizard. A clickops install is a
container started from a cloud console with environment variables filled in,
then the "Set up your new site" screen. That only works if there is an image to
start. The images in `docker/` are for development and testing: they run over a
bind mount of the source and install dependencies at start.

## Findings (2026-11-26)

- `docker/Dockerfile.cms` is `oven/bun:1-slim`, Debian because extensions run under Deno
  (story 311), which publishes glibc builds only (`extension-process.ts` says so on musl).
- `crombolo start` runs in a site folder; first boot from a console is `CROMBOLO_SETUP_CODE`
  and "Set up your new site" (`docs/operations.md`, "First boot").
- There is no `crombolo install`: a site's packages install with `bun install`. The
  maintainer asked for one (2026-11-26), decision 5.

## Decisions (2026-11-26, the maintainer's)

1. **GitHub's registry only:** `ghcr.io/kineco-au/crombolo:<version>`, with `:latest` and
   `:<major>.<minor>`, public, pushed by the Release workflow with the repository's token.
2. **Built from the published npm packages** by the Release workflow after it publishes:
   `@crombolo/crombolo` and the CLI at the release's version into `oven/bun:1-slim`, for
   `linux/amd64` and `linux/arm64`.
3. **The site lives in the volume, made on first start:** `/data` holds the site folder
   beside the database, media and logs. A first start finding it empty makes a site there
   from `CROMBOLO_TEMPLATE` (`empty` by default, or any template `crombolo init` offers),
   its files writable, so types and templates made in the back office persist. A later
   start uses what is there.
4. **The pipeline route layers the site on top:** `FROM ghcr.io/kineco-au/crombolo:<version>`,
   `COPY . /site`, `RUN crombolo install --production`. A site at `/site` is used in place of the
   volume's, its files read-only, with the database, media and logs still in `/data`. A site
   naming another `@crombolo/crombolo` than the image's is refused at build, naming the tag
   that matches.

5. **`crombolo install`** (asked for by the maintainer, 2026-11-26), in place of
   `bun install`, using Bun's installer underneath so the lockfile and registry behave as
   today. Beyond installing, it refuses a site whose `@crombolo/crombolo` is not the CLI's
   own version (naming the image tag that matches), runs `crombolo extension check` over
   the site's extensions and bundles, and builds what `crombolo start` would build on first
   boot (the site's views, its back-office modules), so a read-only site starts at once.
   `--production` leaves development dependencies out. It works outside the image too.

## Acceptance criteria

- [x] An image published on each release, tagged with the release version, that
      starts `crombolo start` from an empty directory with no source mounted.
- [x] It runs as a non-root user and keeps state (the site folder, SQLite file, media,
      logs) under `/data`, documented; a first start into an empty `/data` makes the site
      from `CROMBOLO_TEMPLATE`.
- [x] A site's own schema, components and bundles are layered on top in the three-line
      Dockerfile of decision 4, documented.
- [x] `crombolo install [--production]` installs the site's packages, refuses a crombolo
      version other than its own naming the matching tag, refuses an extension
      `extension check` refuses, and builds ahead what a first start would; in
      `docs/cli/commands.md` and the CLI spec, with tests.
- [x] Built for `linux/amd64` and `linux/arm64` and pushed to GitHub's registry by the
      Release workflow after npm, with its tags; a release whose image fails says so.
- [x] Started with only `CROMBOLO_SETUP_CODE` set, it reaches "Set up your new
      site"; with Postgres variables set, it uses Postgres.
- [x] `/health` is the container health check.
- [x] Deno runs in it, so an extension starts.
- [x] `docs/operations.md`, the README and the release notes; a test that builds the
      image and starts it with a setup code, in CI.

## What was built

- `docker/image/Dockerfile` and `entrypoint.sh`: `oven/bun:1-slim`, crombolo from npm at the
  release's version (or this checkout's packages, `CROMBOLO_FROM=local`), user `crombolo`
  (uid 10001), state under `/data`, the site made there on first start from
  `CROMBOLO_TEMPLATE`, or the one built in at `/site` (its files not written by the back
  office), `/health` as the health check.
- `.github/workflows/release.yml` `image`: after npm serves the version, built for amd64 and
  arm64 and pushed to `ghcr.io/kineco-au/crombolo` as the version, its minor and latest.
- `.github/workflows/ci.yml` `image`: on `main`, `bun run image:build` (this checkout's
  packages, `scripts/image-context.ts`) and `bun run image:check` (`scripts/image-check.ts`):
  a setup code reaches "Set up your new site" as a user other than root, state in `/data`,
  Deno there; Postgres settings, a healthy site on Postgres.
- `crombolo install [--production]` (`packages/cli/src/commands/install.ts`): the version
  check naming the image tag, Bun's install, the extension checks, and `buildAhead`
  (`packages/server/src/build-ahead.ts`), the views and back-office screens built as a
  start builds them.
- Found: a start rebuilds the views and the site's back-office screens into the site's
  `.crombolo` each time, so a built-in site's `.crombolo` belongs to the user it runs as;
  `install` building them first is a check that they build, not a saving at start.
- Not checked in CI: the layered Dockerfile, whose `crombolo install` installs the site's
  crombolo from npm, which a release has not published when CI runs. Checked by hand once
  the version is on npm.
- Tests: `cli-install.test.ts`, `cli-access.test.ts`.
- Docs: `operations.md` ("The container image"), the README, the release notes.
