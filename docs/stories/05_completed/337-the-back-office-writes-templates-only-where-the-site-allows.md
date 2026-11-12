# 337 — The back office writes templates only where the site allows

**Epic:** I — Hardening · **Priority:** should · **Size:** S
**Depends on:** —

## Story

As someone who runs a site, I want one switch that stops the back office changing
templates, stylesheets and scripts, enforced by the server as well as shown in the
screens, so that a site whose files come from its repository can't have them
changed from the back office.

## Context

The back office edits three file areas through `FileSystemPort`
(`adapters/file-system.ts`, wired in `ports.ts:479`):
- the components tree: `.tsx` templates the server imports and runs;
- stylesheets;
- scripts, which reach visitors' browsers.

The Template API writes templates too, through
`createTemplateFileStore(componentsDir)` (`ports.ts:581`).

What happens today (read 2026-11-12):
- **The server never refuses.** Create, update, rename, delete and folder changes
  work in every area, for anyone with the Settings section, in any mode.
- **The vendored client** is told the site's mode by `runtimeMode`
  (`ports.ts:125`): `BackofficeDevelopment` in development, `Production`
  otherwise. In production it makes templates read-only:
  - `UMB_IS_SERVER_PRODUCTION_MODE_CONDITION_ALIAS` hides Create, Rename, Delete
    and folder actions on the templates tree;
  - the template editor is read-only (`partial-view-workspace-editor.element.ts:44`).

  Nothing else in the client uses the mode.
- **Stylesheets and scripts** have no such restriction in the client.

So the restriction is only in the screens, it covers only templates, and the site
can't choose it.

## The design

Planned 2026-11-12.

- **One setting, read-only by choice:** `contentFilesReadOnly`
  (`CROMBOLO_CONTENT_FILES_READONLY`).
  - Unset means writable, in production too, and a schema store doesn't change
    it. Setting it to `true` makes templates, stylesheets and scripts read-only
    in the back office.
  - No permission beyond the Settings section is needed to edit them; turning
    the switch on or off is the site owner's decision.
- **The server enforces it.** When the setting is on:
  - the three file areas refuse create, update, rename, delete and folder
    changes;
  - so does the Template API's save and delete;
  - the refusal says, in plain words, that this site doesn't allow changes to
    these files in the back office.

  Reading the files, and building a bundle from them, work as now. Bundle installs
  are not affected: story 336 holds them to the code rules.
- **The client's mode follows the setting.** `runtimeMode` is `Production` when the
  files are read-only and `BackofficeDevelopment` otherwise, so the client's
  existing read-only templates switch with it. This changes today's behaviour:
  production sites, which see templates read-only now, can edit them unless they
  set the switch.
- **Fork:**
  - The stylesheet and script trees get the same production-mode conditions on
    Create, Rename, Delete and folders as templates.
  - Their editors are read-only in production mode, as the template editor is.
- **"Document type with template"** on a read-only site creates the type without
  writing the template file, and says to add the template in the site's code.
- **Docs:**
  - `configuration.md`, regenerated with `bun run docs:config`.
  - `operations.md`: when to set the switch, such as files deployed from a
    repository, containers that start afresh, or several nodes.
  - The release notes' upgrade notes: production sites now allow templates to be
    edited, and `CROMBOLO_CONTENT_FILES_READONLY=true` keeps them read-only.

## Acceptance criteria

- [x] With `CROMBOLO_CONTENT_FILES_READONLY=true`:
  - creating, saving, renaming or deleting a template, stylesheet or script, or
    a folder of them, through the Management API is refused with a plain
    message, and nothing on disk changes;
  - so is saving or deleting a template through the Template API.
- [x] Unset or `false`, they work as now, in development and in production.
- [x] Reading them, and building a bundle, work either way.
- [x] `runtimeMode` is `Production` exactly when the files are read-only.
- [x] In the back office, read-only templates, stylesheets and scripts offer no
      Create, Rename or Delete and show their editors read-only.
- [x] "Document type with template" on a read-only site adds no template file, and
      says to add it in the site's code; the type itself is already saved.
- [x] The setting is documented, a test covers each value, and the upgrade notes
      say what changed for production sites.

## Implementation

- **Setting:** `contentFilesReadOnly` in `config.ts`, from
  `CROMBOLO_CONTENT_FILES_READONLY` (true only when it says `true`), listed in
  `settings.ts` and `configuration.md`.
- **Server:**
  - `createFileSystemPort` takes `readOnly`, and wraps the port so that every
    change answers `ReadOnly`. The file handlers turn that into a 403 problem
    with `CONTENT_FILES_READ_ONLY` (`ports-files.ts`) as its detail.
  - `createTemplateFileStore` takes `readOnly` as a backstop that throws.
  - `TemplatePort.readOnly` makes `PostTemplate`, `PutTemplateById` and
    `DeleteTemplateById` refuse.
  - `createTemplate` on a content type refuses a template that doesn't exist yet.
  - Only the back office's ports are read-only: bundle builds and installs use
    their own.
- **Mode:** `runtimeMode` (`ports.ts`) is `Production` exactly when the files
  are read-only.
- **Fork,** commit `6ed5d226` on `umbraco/crombolo`:
  - every stylesheet and script entity, collection and workspace action
    (delete, rename, create, folder delete, collection create, save) has
    `UMB_IS_SERVER_PRODUCTION_MODE_CONDITION_ALIAS` `match: false`;
  - the script editor and the stylesheet code view are read-only in production
    mode, as the template editor is.
- **Docs:** `operations.md`, "Templates, stylesheets and scripts in the back
  office", and the release notes, with the upgrade note for production sites.
- **Tests:** `tests/content-files-readonly.test.ts`:
  - each area refuses every change and still reads;
  - the Template API and document type templates refuse;
  - `runtimeMode` follows the switch;
  - unset is writable;
  - the setting is parsed correctly.

  The client change has no browser test. The browser suite runs one development
  site, and the change uses the same condition as Umbraco's own template locking.
