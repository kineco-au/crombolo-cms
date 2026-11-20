# 391 — The code setting says what it locks

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** S
**Depends on:** 343, 385

## Story

As whoever runs a site, I want the setting that stops the back office changing templates,
components, stylesheets and scripts to say so in its name, so that nobody reads
"production" as something wider than it is.

## Context

Story `343` named it `CROMBOLO_CONTENT_MODE`, `development` or `production`. All it does is
keep the Code place (`385`) read-only in the back office; content, types and everything
else are unaffected, and from `377` a workspace's file changes are refused under it too.
The maintainer asked for a name that says plainly what it locks (2026-11-20).

## Decisions (2026-11-20, the maintainer's)

- **`CROMBOLO_CODE=editable|locked`** (`code: 'editable' | 'locked'` in the config), naming
  the Code place the back office shows. Unset is `editable`.
- **`CROMBOLO_CONTENT_MODE` is refused at start,** naming the new setting and its value, as
  `343` refused `CROMBOLO_CONTENT_FILES_READONLY`: a site that set it must change it before
  upgrading.

## The design

- `contentMode` in `CromboloConfig` becomes `code`; `contentFilesLocked(config)` reads it.
- Home's System information shows "Code: Editable" or "Code: Locked".
- The read-only notes in the Code tree and editors say the code is locked on this site.
- `docs/configuration.md` (regenerated), `docs/examples/crombolo.config.ts`, the release
  notes' upgrade step, and every doc naming content mode.

## Acceptance criteria

- [ ] **`CROMBOLO_CODE=locked`** keeps templates, components, stylesheets and scripts
      read-only in the back office, as `production` did; `editable` or unset leaves them
      editable.
- [ ] **`CROMBOLO_CONTENT_MODE` set at all** stops the server, naming what to set instead.
- [ ] **Home's System information** says "Code: Editable" or "Code: Locked".
- [ ] **Tests;** the configuration reference and release notes say what changed.
