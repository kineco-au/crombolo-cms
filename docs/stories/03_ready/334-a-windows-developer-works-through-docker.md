# 334 — A Windows developer works through Docker

**Epic:** E — Cross-cutting · **Priority:** could · **Size:** S
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

`.gitattributes` is also in story 333's scope. Whichever of the two stories lands
first adds it, and the other's criterion is then met.

Not in scope: Windows natively without Docker (story 333 measures it); the
Next.js front end's own tooling; making CI run anything on Windows beyond what it
does now.

## Acceptance criteria

- [ ] `.gitattributes` makes every checkout use LF line endings.
- [ ] On a Windows 11 machine with Docker Desktop, from a fresh clone in WSL2:
      setup, `bun run docker:up` (the CMS answering on port 8080),
      `bun run docker:test:sqlite`, `bun run docker:test:all` and `bun run check`
      all work as the README describes, and a change to a component reloads.
- [ ] The same from a clone on a Windows drive, through PowerShell, with whatever
      `docker:setup` and the hook need; or, if the trial shows it is too slow or
      too fragile to recommend, the README says so and why, with the timings.
- [ ] The README's "Crombolo development" has an "On Windows" part: which setup to
      use, its steps, and what does not work.
- [ ] The trial's results (the machine, Docker Desktop's version, the timings,
      anything that failed and its fix) are recorded in this story.
