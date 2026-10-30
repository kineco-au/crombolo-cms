# 192 — A site's bundle carries its code

**Epic:** B — Packaging and upgrades · **Priority:** should · **Size:** M
**Depends on:** 063, 181

## Story

As a developer whose site has server code of its own, I want `crombolo bundle
build` to pack that code beside the site's schema, components and content,
checked and installable from the bundle alone, so that one artifact is what I
deploy, whoever runs the server.

## Context

`crombolo bundle build <site dir>` turns a site's `schema/`, `components/`,
`css/`, `scripts/` and `seed/` into a bundle that installs into a bare site. A
site's code is not in it: its `package.json`, its lockfile, its
`crombolo.config.ts` (which wires its server bundles, `docs/bundles.md` Part 3)
and its own source. A self-hosted site deploys that from its repository; a host
that runs the server for its customers has no way to receive it, and would
have to invent a format and a check of its own.

Raised by a site that is part application, whose recording, moderation and
imports are server bundles, on a host that runs every site's `server.ts`
itself.

**Decided (2026-10-27):**
- **Which files are the code.** The site's `package.json` declares them, as
  globs in a `crombolo.code` list, like npm's `files`.
  `crombolo bundle build --code <glob>…` overrides the list. `package.json`,
  `bun.lock` and `crombolo.config.ts` are always included.
- **Where.** A `code/` folder at the bundle's root, with the site's paths kept
  (`code/src/…`). The bundle's manifest says it carries code.
- **Applying it means a restart.** A bundle carrying code still imports its
  content into a running site as before, and the import leaves `code/` alone.
  Installing the code is a step of its own, followed by a restart, because a
  server half is wired only at boot.

**Decided (2026-10-28):**
- **A site depends on `@crombolo/*` as peers.** A site lists `@crombolo/*`
  under `peerDependencies`, not `dependencies`. Its server bundles from the
  `@crombolo` scope count too. `bun install` still installs peers, so local
  development is unchanged. `install-code` runs
  `bun install --frozen-lockfile --ignore-scripts --omit peer` (checked on Bun
  1.4.2), so the CMS that runs the site supplies them, and `bundle check`
  refuses any `@crombolo/*` package that is installed anyway, which happens
  when another package depends on one directly. `crombolo init` and the sites
  in `sites/` change to match.
- **`server.ts` passes the config in.** Before, the scaffolded `server.ts`
  called `crombolo()` without its config, so anything that ran `server.ts`
  booted without the site's `bundles`. This was fixed ahead of this story, and
  the check relies on it.
- **Where `code/` sits: at the package root, with a hash of its own.** It goes
  in `code/` beside `content/`, and `package.json` declares
  `crombolo.code: { dir, integrity }`. The payload's hash could not cover it:
  the payload loader reads only `content/`, and refuses paths that climb out
  of it.

## As built (2026-10-28)

- **Format.** `packages/transfer/src/code.ts`:
  - `selectCodeFiles` and `isNeverCode` choose the files.
  - `codeIntegrity` takes the same hash as the payload's, through the new
    `filesIntegrity`, but over bytes.
  - `loadBundleCode` reads the code back and verifies it.
  - `writeBundlePackage` takes `code` and writes `code/` and the field.
- **Never packed:** `node_modules`, `.git`, `.env` and `.env.*` files, SQLite
  files, `schema/`, `components/`, `css/`, `scripts/`, `seed/`, `media/`,
  `logs/` and `.crombolo/`. Secrets and databases were added to the story's
  list.
- **Build.** A glob that matches nothing, or a site with no `bun.lock`, stops
  the build rather than packing less than was meant.
- **Check and install.** These are in `packages/server/src/bundle-code.ts`.
  The check:
  - copies the code to a scratch directory;
  - runs `bun install --frozen-lockfile --ignore-scripts --omit peer`;
  - reports any `@crombolo/*` package left anywhere under `node_modules`;
  - symlinks this CMS's `@crombolo/*` packages for the peers the site
    declares, as a host provides them;
  - reads the config in a `bun` process with `env: {}` and a 60-second limit,
    which prints each wired bundle's id, section, capabilities, routes and
    tables;
  - feeds that to `discoverBundles` and `validateServerBundles`, and checks
    the peer range of every declared bundle that is not wired.
- **Discovery reads `peerDependencies`** as well as `dependencies`, and so
  does the Marketplace's range lookup. Without that, a site that peers on
  `@crombolo/simple-redirects` would fail its own boot.
- **`crombolo init`** writes `@crombolo/*` under `peerDependencies`.
  Non-`@crombolo` bundles stay under `dependencies`. The sites in `sites/` keep
  `workspace:*` dependencies: they are workspace members, never deployed this
  way.
- **CLI.**
  - `bundle build --code`;
  - `bundle check`;
  - `bundle install-code`, which refuses a directory that already holds files;
  - `describeBundle` and `start --bundle` print one line when a bundle
    carries code (`BundleSummary.carriesCode`).
- **Tests.** `tests/bundle-code.test.ts` has 17 tests. Its fixtures vendor
  their packages as `file:` dependencies and stub `@crombolo/crombolo`, so they
  need no registry.

## Acceptance criteria

- [x] `crombolo bundle build` packs the files `crombolo.code` names, and the
      files given by `--code` instead where it is passed. `package.json`,
      `bun.lock` and `crombolo.config.ts` are always packed, and
      `node_modules`, `.git` and the bundle's own folders never are. A site
      with neither builds the bundle it does today.
- [x] `crombolo bundle check <bundle>` checks the code against the CMS it runs
      on, and lists every problem:
      - a frozen install from the bundle's lockfile, with no lifecycle
        scripts;
      - every bundle `crombolo.config.ts` wires belongs to a declared package
        with a server half (the rule `validateServerBundles` applies at boot);
      - each declared bundle's peer range includes the running version;
      - no second copy of `@crombolo/*` below a package.

      The config is read in a process of its own, given none of the caller's
      environment.
- [x] `crombolo bundle install-code <bundle> <dir>` installs the code into a
      directory, ready to start. The `@crombolo/*` packages and their own
      dependencies are left to the CMS that runs it, so a host that provides
      the CMS carries no second copy.
- [x] `content import` and `crombolo start --bundle` leave `code/` alone, and
      say that the bundle carries code to install.
- [x] The checks and the install are exported for a host to run in its own
      process (`@crombolo/crombolo`), as `validateBundlePackage` and
      `peerRangeProblem` are (`181`).
- [x] `docs/bundles.md` describes a site's bundle with code, and
      `docs/packaging-and-upgrades.md` the deploy it makes.

## Out of scope

- Restarting a server after the code is installed: that is the host's.
- Which keys of a site's config a host honours.
