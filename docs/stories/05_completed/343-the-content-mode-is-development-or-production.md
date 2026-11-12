# 343 — The content mode is development or production

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** S
**Depends on:** 337

## Story

As whoever hosts a site, I want one setting that says whether the site is in
development or production, so that I can lock the site's files in production and
anyone signed in can see which mode the site is in.

## Context

Story 337 added `CROMBOLO_CONTENT_FILES_READONLY=true`, which keeps the back office
from changing templates, stylesheets and scripts. The back office learns it as
Umbraco's runtime mode (`Production` or `BackofficeDevelopment`), which Home's System
information box showed as it came: "Mode: BackofficeDevelopment".

Umbraco's own production mode locks templates, since its views are compiled when
the site is built; types stay editable. The schema here keeps its own switch,
`CROMBOLO_SCHEMA_WRITABLE`.

## The design

- **`CROMBOLO_CONTENT_MODE`**: `development` (the default, when unset) or
  `production`. Production keeps templates, stylesheets and scripts read-only in
  the back office, as `CROMBOLO_CONTENT_FILES_READONLY=true` did. Any other value
  stops the server, naming the two.
- **`CROMBOLO_CONTENT_FILES_READONLY` is refused** at start, saying to set
  `CROMBOLO_CONTENT_MODE` instead, as `CROMBOLO_REMOTE_ENABLED` is: a site that had
  locked its files must not quietly become editable.
- **Home → System information** shows "Content mode: Development" or "Production".
  The runtime mode the back office is told is unchanged, since its editors read it.

## Acceptance criteria

- [x] Unset or `development` leaves the files editable; `production` locks them
- [x] An unknown value, or the old setting, stops the server with a message naming
      what to set
- [x] Home's System information shows the content mode in words
- [x] The configuration reference and release notes say what changed

## Built

- `packages/server/src/config.ts`: `contentMode` (`development` | `production`) from
  `CROMBOLO_CONTENT_MODE`, in place of `contentFilesReadOnly`; `contentFilesLocked(config)`
  is what the template, stylesheet and script ports and the runtime mode ask. An unknown
  value, or `CROMBOLO_CONTENT_FILES_READONLY` set at all, stops the server.
- `settings.ts` declares the new setting; `tests/settings-list.test.ts` names the old one
  as retired, read only to refuse it.
- Home's System information shows "Content mode" through `contentModeOf`
  (`overview-format.js`). The back office's own All details dialog still shows Umbraco's
  runtime mode.
- Tests: `tests/content-files-readonly.test.ts` (both modes, the default under
  `NODE_ENV=production`, the refusals) and `tests/overview.test.ts`.
