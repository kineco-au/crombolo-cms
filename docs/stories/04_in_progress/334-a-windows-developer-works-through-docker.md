# 334 — A Windows developer works through Docker

**Epic:** E — Cross-cutting · **Priority:** could · **Size:** M
**Depends on:** —

## Story

As a developer on Windows, I want to set up the repository, run the CMS and run
the tests through Docker, as the README says to on a Mac, so that I can work on
crombolo without making Windows run everything natively.

## Context

The project already runs its tests in containers (`compose.yaml`; `AGENTS.md`,
"Testing"): `cms-test-sqlite`, `cms-test` (Postgres) and `cms-test-browser`, with
the source mounted at `/app` and `node_modules` in a named volume. The `docker:*`
package scripts are plain `docker compose` calls, and Bun runs package scripts
through its own shell, which works on Windows. So the containers should run a
Windows checkout unchanged. Nobody has tried it. Reading the repository
(2026-11-11) turns up these problems:

- **Line endings.** There is no `.gitattributes`, and Git for Windows checks out
  with CRLF by default. `docker/cms-entrypoint.sh` then fails in the container
  (`/bin/sh^M: bad interpreter`), and tests that hash or snapshot checked-in files
  disagree with the files.
- **The host half of setup is not Docker.** The README's set-up runs on the host:
  - `bun install`;
  - `bun run fork:checkout`, a git checkout of Umbraco's client;
  - `bun run vendor:backoffice`, which builds that client with Node 24 and npm 11;
  - `bun run generate:types`.

  The back office build is the likeliest to fail on Windows, and every test that
  serves the back office needs its output.
- **The pre-push hook** (`.githooks/pre-push`, a `sh` script, which Git for Windows
  runs) runs `check` and the SQLite suite on the host. On Windows that is the
  native suite, which story 333 measures and does not fix.
- **Speed.** A bind mount of a folder on an NTFS drive into a Linux container is
  many times slower than one from a Mac or from the WSL2 file system. A suite of
  this size may be impractical that way.
- **Watching for changes.** File watching (`live-reload.ts`, `schema.ts`) gets no
  events through a bind mount from an NTFS drive, so a CMS run in a container from
  such a checkout does not reload on a change.
- **GitHub's Windows runners cannot run Linux containers,** so CI cannot prove this
  works. It has to be tried on a Windows machine.

## Proposed

Two ways, tried on a real Windows 11 machine with Docker Desktop (WSL2 back end),
and the better one recommended:

1. **The checkout in WSL2** (recommended unless the trial says otherwise). Clone
   into the WSL2 distribution's own file system and run everything from its shell:
   to the repository that is Linux, so the README's steps hold as written, and the
   bind mount is fast and watched. What it needs is the setup written down:
   - WSL2, a distribution, Docker Desktop's WSL integration;
   - Bun, Node 24 and npm installed inside the distribution;
   - opening the folder from Windows editors (`\\wsl$\…`, or VS Code's WSL remote).
2. **The checkout on a Windows drive**, with the scripts run from PowerShell. Bun on
   Windows only starts the containers; everything else happens inside them:
   - `.gitattributes` with `* text=auto eol=lf`, so the checkout matches what the
     containers and the tests expect;
   - the host steps of setup moved into the image where they would otherwise run
     on Windows: a `docker:setup` script that runs `bun install`, `generate:types`
     and the back office build in a container, writing into the mounted checkout;
   - the pre-push hook running the containerised suite when it finds itself on
     Windows (`docker:test:sqlite` instead of the host suite), or saying how to skip
     it;
   - polling for file changes in the container when the checkout is on a Windows
     drive (`CROMBOLO_WATCH_POLL`, or the equivalent the watchers can take), if the
     trial shows a dev run is otherwise unusable;
   - the timings of `docker:test:sqlite` this way, against WSL2's, written down so
     the README can say plainly which to use.

3. **Set up, one section per platform** (planned 2026-11-14). The README's
   "Crombolo development → Set up" is one sequence of host commands written for a
   Mac, which a Windows reader has to translate as they go. It becomes two
   sections, each complete on its own, so nobody reads the other's steps:

   - **On macOS.** What is there today, made explicit:
     - prerequisites and where each comes from: Bun 1.3 or later, Node 24 and
       npm 11 (for the back office build), Docker Desktop with Compose v2 (or an
       equivalent runtime the trial confirms, such as OrbStack or Colima), and Git;
     - clone, `bun install`, `fork:checkout`, `vendor:backoffice`,
       `generate:types`, `check`, `hooks:install`;
     - running it (`start:local`, `docker:up`) and the tests
       (`docker:test:sqlite`, `docker:test:all`);
     - one line that Linux follows the same steps.
   - **On Windows.** The recommended route first, as the trial decides it:
     - **In WSL2** (expected): installing WSL2 and a distribution, Docker
       Desktop's WSL integration, then Bun, Node 24 and npm inside the
       distribution; cloning into its own file system, not `/mnt/c`; from there
       the macOS steps hold as written, run from the WSL shell; opening the folder
       from Windows (VS Code's WSL remote, or `\\wsl$\…`);
     - **From a Windows drive** (only if the trial shows it is usable):
       PowerShell, `docker:setup` in place of the host build steps, the hook's
       containerised path, polling for changes, and its timings against WSL2's;
     - **what does not work**, plainly: the native suite (story 333), file
       watching from an NTFS drive, and anything the trial finds.

   "Run it from source", "The sites in this repository" and "Running the tests"
   stay shared, after the two set-up sections, with a platform note only where a
   command differs. `docs/testing.md` points at the right section rather than
   repeating either.

4. **A quick Windows job in CI** (planned 2026-11-14). GitHub's Windows runners
   cannot run Linux containers, so CI cannot prove the containers run from a Windows
   checkout. It can hold the host's half, in about five minutes beside the existing
   `extensions (windows-latest)` job, on every push:
   - after checkout, `git ls-files --eol` finds no CRLF in the working tree, so
     `.gitattributes` does what it is for;
   - `bun install --frozen-lockfile`, the first host step;
   - `docker compose config`, so `compose.yaml` and its mounts parse with a Windows
     path to the checkout (the Docker CLI, no Linux containers);
   - the pre-push hook under Git for Windows' `sh`, with Docker absent: it runs the
     containerised suite or says how to skip, whichever it is built to do;
   - `bun run check`, so format, lint and types run natively for a Windows editor;
   - a curated set of unit test files, grown from story 333's survey: those that
     pass natively, and the path-sensitive ones as they are fixed.

   What it cannot hold stays with the trial: the containers from a Windows
   checkout, file watching through the mount, and how fast the suite runs that way.

`.gitattributes` is also in story 333's scope. Whichever of the two stories lands
first adds it, and the other's criterion is then met.

Not in scope: Windows natively without Docker (story 333 measures it); the
Next.js front end's own tooling; making CI run anything on Windows beyond what it
does now.

## Acceptance criteria

- [x] `.gitattributes` makes every checkout use LF line endings.
- [ ] On a Windows 11 machine with Docker Desktop, from a fresh clone in WSL2:
      setup, `bun run docker:up` (the CMS answering on port 8080),
      `bun run docker:test:sqlite`, `bun run docker:test:all` and `bun run check`
      all work as the README describes, and a change to a component reloads.
- [ ] The same from a clone on a Windows drive, through PowerShell, with whatever
      `docker:setup` and the hook need; or, if the trial shows it is too slow or
      too fragile to recommend, the README says so and why, with the timings.
- [x] The README's "Crombolo development → Set up" is two sections, **On macOS** and
      **On Windows**, each complete on its own: prerequisites and where to get
      them, the clone and setup commands, running the CMS and the tests. macOS
      says Linux follows its steps; Windows leads with the recommended route,
      says which to use and why, and lists what does not work.
- [ ] Every command in both sections was run on its platform as written, from a
      fresh clone, and the steps that only one platform needs appear only in its
      section.
- [x] CI has a Windows job of about five minutes, on every push: line endings, the
      frozen install, `docker compose config`, the pre-push hook's Windows path,
      `bun run check` and a curated set of unit tests.
- [ ] The trial's results (the machine, Docker Desktop's version, the timings,
      anything that failed and its fix) are recorded in this story.

## Built so far

2026-11-14, everything that does not need a Windows machine:

- **`.gitattributes`** with `* text=auto eol=lf`. Every file in the repository was
  already LF, so renormalising changed nothing.
- **The README:** "Set up on macOS" and "Set up on Windows", each complete on its own.
  - macOS lists its prerequisites and where they come from, and says Linux follows the
    same steps.
  - Windows leads with WSL2: installing it, Docker Desktop's WSL integration, the tools
    inside Ubuntu, cloning into the Linux file system, and opening the folder from an
    editor. It then lists what does not work.
- **The pre-push hook**, under Git for Windows' `sh`, runs its gate in the SQLite test
  container. It says how to skip when Docker is missing, and `CROMBOLO_HOOK_DRY_RUN`
  prints what it would run.
- **CI's `windows host` job:**
  - the checkout's line endings;
  - `bun install --frozen-lockfile`;
  - `docker compose config` with a Windows path;
  - the hook's Windows path, by its dry run;
  - `bun run check` natively. It passed on the job's first run (2026-11-14), so it gates
    like the rest.
- `docs/testing.md` describes the job.

**Not built:** `docker:setup`, and polling for changes from a Windows drive. Both are
for the Windows-drive route, which the README now advises against. If the trial shows
that route is usable after all, they are its work.

**Still open, needing a Windows 11 machine with Docker Desktop:**
- the WSL2 trial and the Windows-drive trial, with their timings;
- running both README sections' commands as written from a fresh clone;
- recording the results here.

Until then the Windows steps are written but untried.
