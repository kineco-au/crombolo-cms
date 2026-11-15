# 363 — Crombolo development tried on a Windows machine

**Epic:** E — Cross-cutting · **Priority:** could · **Size:** S
**Depends on:** 334

## Story

As a developer on Windows, I want the README's Windows setup to have been tried on
a real machine, so that the steps I follow are known to work and the route it
recommends is the right one.

## Context

Split from story 334 on 2026-11-15. 334 built everything that doesn't need a
Windows machine: LF line endings for every checkout, the README's macOS and
Windows sections, the pre-push hook's Windows path, and CI's `windows host` job.
What is left needs a Windows 11 machine with Docker Desktop, which nobody had to
hand, so the Windows steps are written but untried.

334's "Built" section says what was left out on purpose. `docker:setup` and
polling for changes from a Windows drive belong to the Windows-drive route, which
the README advises against. If the trial below shows that route is usable after
all, they are this story's work.

## On hold

Until someone has a Windows 11 machine with Docker Desktop to try it on. The macOS
half of the third criterion can be checked at any time on a Mac.

## Acceptance criteria

- [ ] On a Windows 11 machine with Docker Desktop, from a fresh clone in WSL2:
      setup, `bun run docker:up` (the CMS answering on port 8080),
      `bun run docker:test:sqlite`, `bun run docker:test:all` and `bun run check`
      all work as the README describes, and a change to a component reloads.
- [ ] The same from a clone on a Windows drive, through PowerShell, with whatever
      `docker:setup` and the hook need; or, if the trial shows it is too slow or
      too fragile to recommend, the README says so and why, with the timings.
- [ ] Every command in both sections was run on its platform as written, from a
      fresh clone, and the steps that only one platform needs appear only in its
      section.
- [ ] The trial's results (the machine, Docker Desktop's version, the timings,
      anything that failed and its fix) are recorded in this story, and 334's README sections corrected where the trial shows they are wrong.
