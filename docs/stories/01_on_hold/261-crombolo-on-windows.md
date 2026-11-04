# 261 — Crombolo on Windows

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** L
**Depends on:** —

## Story

As a developer on Windows, I want to make, run and ship a crombolo site from a
Windows terminal, without WSL, so that the walkthrough works on the machine I
already use.

## Context

Crombolo is supported on macOS and Linux, and on Windows through WSL 2, which is
what "A site from the command line" says in its first step. Nothing has run on
Windows itself: every CI job is `ubuntu-latest`, and local tests run in Linux
containers. A survey of the code (2026-11-03) found what is known to break, and
what probably does:

**Known to break**

- `crombolo restart` sends SIGHUP to the supervisor (`cli/src/support/restart.ts`,
  `supervise.ts`), and the new server takes over the port with `reusePort`
  (`support/serve.ts`). Windows has neither: the restart would become a message
  over the supervisor's IPC channel, which already carries `ready`, and the
  handover needs another way to switch servers, or a short gap.
- `CROMBOLO_PG_DUMP` runs through `sh -c` (`server/src/backup.ts`); Bun's shell
  runs on every platform.
- Bundles with code link a folder with `symlinkSync(…, 'dir')`
  (`server/src/bundle-code.ts`), which needs administrator rights or developer
  mode on Windows; a junction does not.
- Git on Windows can check files out with CRLF line endings, which would change
  the definitions' hash, so every build there would raise the version. A new
  site needs a `.gitattributes`, or the hash must ignore line endings.

**Probably breaks**

- Paths turned into names: about 40 `relative()` calls and 110 recursive folder
  reads, some converting `\` to `/` and some not, feeding component names,
  bundle file lists, content file paths and the schema watcher.
- About 33 renames over an existing file (atomic writes, swapping the database
  on a pull or restore), which Windows refuses while the file is open.
- SIGTERM handling, which Windows never sends; Ctrl+C works.

**Already fine:** recursive file watching, SQLite, opening a browser
(`cli/src/support/remote.ts`), and Postgres through Docker Desktop.

The tests are likely the larger cost: about 3,600 of them have never run on
Windows, and many build `/` paths or call shell commands.

## Plan

1. A `windows-latest` CI job running only the walkthrough's integration test
   (`tests/integration/cli-site.integration.ts`). About a day, and its failures
   turn the lists above into a real one.
2. The fixes it finds, then the unit suite on Windows, then the integration
   suite.

## Acceptance criteria

- [ ] A Windows CI job runs the walkthrough end to end, from `init` to a bundle
      served by a second site, and is required to pass.
- [ ] The unit and integration suites pass on Windows.
- [ ] `crombolo restart` hands over to a new server on Windows.
- [ ] A site's definitions hash the same on every platform, whatever its line
      endings.
- [ ] `CROMBOLO_PG_DUMP` and bundles with code work on Windows without
      administrator rights.
- [ ] The walkthrough's "Check your system" step names Windows as supported.

## Out of scope

- The browser suite on Windows.
- Windows-specific installers or services.
