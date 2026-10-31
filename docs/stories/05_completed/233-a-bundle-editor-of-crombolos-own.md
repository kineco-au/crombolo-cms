# 233 — A Bundle Editor of Crombolo's own

**Epic:** K — Moving content · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As an administrator making a bundle in Packages → Created, I want an editor
that Crombolo maintains, so that it can grow with what a Crombolo bundle carries
rather than being limited to what Umbraco's package builder knows.

## Context

Found 2026-10-31, planning story 226. Umbraco's package builder
(`Umb.Workspace.PackageBuilder`) draws its form as the workspace editor's
default content, and Umbraco's `umb-workspace-editor` shows that content only
while no workspace view is registered: its own comment says an added route
means "the slotted content would never be shown". Tabs cannot be added to it
without patching it.

Crombolo already owns the way in: its Created view
(`packages/backoffice-host/plugin/bundles-created.js`) routes
`package-builder/create` and `package-builder/edit/:unique` to whichever
workspace is registered for that entity type.

## Decisions (2026-10-31)

1. **Crombolo replaces the package editor with a Bundle Editor of its own,**
   rather than patching Umbraco's or adding a dialog beside it. It is reached
   from the same routes, opens the same saved definitions and saves through the
   same Management API endpoints, so definitions made before it open unchanged.
2. **It ships with what Umbraco's builder has, and nothing more;** story `226`
   adds the Forms, Workflows and User groups tabs to it. Not chosen: one story
   doing both.
3. **Its contents are split into tabs by kind:** **Content** (a page and
   optionally its children, media and optionally theirs, Library elements),
   **Types** (document, media and data types), **Code** (templates, partial
   views, stylesheets, scripts) and **Language** (languages, dictionary items),
   with the name above them. Story `226`'s three follow. It also says "Bundle"
   throughout, as Crombolo's other Packages views do, and Umbraco's builder is
   unregistered so nothing can open it. Not chosen: one Contents tab as
   Umbraco's is; a running summary beside it, a new feature in a parity story.

## Plan

1. **The editor** (`packages/backoffice-host/plugin/bundle-editor.js`): a
   workspace for the `package-builder` entity type, labelled Bundle Editor:
   - the name, and the four tabs of decision 3, holding everything Umbraco's
     builder offers;
   - the inputs Umbraco's builder itself is made of: `umb-input-document`,
     `umb-input-media`, `umb-input-element`, `umb-input-document-type`,
     `umb-input-media-type`, `umb-data-type-input`, `umb-input-language`, and
     `umb-input-entity` for templates, partial views, stylesheets, scripts and
     dictionary items;
   - save and download through Umbraco's own package repository
     (`saveCreatedPackage`, `updateCreatedPackage`), as its builder does.
2. **The route:** `bundles-created.js` opens the Bundle Editor, and Umbraco's
   builder workspace is unregistered.
3. **Room for tabs:** the editor's tabs are workspace views on its own
   workspace, so story `226`'s three are registrations, not edits.
4. **Tests:** saved definitions from before it open and save unchanged (each
   field round-trips through the Management API as the editor sends it); a
   browser test making, saving, reopening and downloading a bundle; the vendor
   test that Umbraco's builder is not routed to.
5. **Docs:** `docs/bundles.md` ("Created packages"), and the release notes.

## Acceptance criteria

- [x] Creating or editing in Packages → Created opens the Bundle Editor, never
      Umbraco's builder.
- [x] It offers everything Umbraco's builder did, and a bundle made in it
      downloads with the same contents as before.
- [x] Definitions saved before it open and save without losing a field.
- [x] Its tabs are workspace views on its own workspace, ready for story 226.
- [x] The vendored back office is unchanged.
- [x] `docs/bundles.md` and the release notes say so.

## What was built

- **The editor** (`packages/backoffice-host/plugin/`): `bundle-editor.js`, the
  workspace, with the name, Create or Save and Download; its manifest
  overwrites `Umb.Workspace.PackageBuilder` for the `package-builder` entity
  type. `bundle-editor-context.js` holds the definition and loads, saves and
  downloads through Umbraco's `UmbPackageRepository`. A workspace context
  (`UmbContextBase` on `UMB_WORKSPACE_CONTEXT`, alias
  `Crombolo.Workspace.BundleEditor`) is what the tabs' `Umb.Condition.WorkspaceAlias`
  reads.
- **The tabs** (`bundle-editor-sections.js` and a file each): Content, Types,
  Code and Language as workspace views, drawn with the inputs Umbraco's builder
  uses.
- **The route:** `bundle-editor-routing.js`'s `editorsOf` makes the Created view
  open the Bundle Editor alone whenever it is registered, which the browser
  showed was needed: `overwrites` did not keep Umbraco's builder from being
  routed to.
- **Removed:** `branding/bundle-builder-labels.js`, which rewrote the builder's
  labels after each render; the editor says "bundle" itself.
- **Tests:** `tests/bundles-backoffice.test.ts` (the manifests, the routing, every
  import against what Umbraco's modules export, the repository calls matching
  the builder's) and `tests/browser/bundle-editor.browser.ts` (create, list,
  reopen, every tab).
- **Docs:** `docs/bundles.md`, "The Bundle Editor".
