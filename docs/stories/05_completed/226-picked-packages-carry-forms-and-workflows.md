# 226 — Picked packages carry forms and approval workflows

**Epic:** K — Moving content · **Priority:** should · **Size:** M
**Depends on:** 233

## Story

As an administrator building a package in the back office, I want to pick the
site's forms and approval workflows as I pick its document types,
so that a package moves everything a section of the site needs.

## Context

Found 2026-10-31. A bundle built from a site directory (`crombolo bundle build`)
and a whole-site file carry every `.toml` under `schema/` (`wholeSchema` in
`packages/server/src/site-sections.ts`), so forms (`schema/forms/`) and approval
workflows (`schema/workflows/`) travel there. A package picked in Packages →
Created carries only what `SectionPicks` names: document types, media types,
data types, languages, components, stylesheets, scripts and dictionary items.
Member types have no picker either, which the code says outright.

Nothing tests that a form or a workflow survives either route: built or
exported on one site, installed on another, and used there.

## Decisions (2026-10-31)

1. **Three tabs on the Bundle Editor: Forms, Workflows and User groups.** The
   editor is Crombolo's own (story `233`), since Umbraco's package builder
   hides its own form once any tab is added; each tab is a workspace view on
   it. The picks are kept with the bundle's definition, through Crombolo's own
   endpoint; Umbraco's contract is unchanged. Member types are left to story
   `162`, with member groups. Not chosen: following from what is already
   picked, which cannot package a form no page uses; a dialog beside Umbraco's
   builder; patching Umbraco's builder.
2. **What a pick depends on is added automatically, and shown.** A picked
   workflow brings the document types it covers and the user groups its stages
   name; a picked form brings the document type its "save as content" step
   creates. Each added item is shown ticked on its tab (a document type on the
   Types tab), saying which pick added it ("for Article approval"), and can be unticked, with a warning that
   the pick may not work without it. The page a "save as content" step creates
   under is content and stays a reference: the step is skipped until that page
   exists where the package lands. Not chosen: refusing until each is picked;
   letting a pick travel alone.

## Plan

1. **Storage:** migration 058 adds `forms`, `workflows`, `user_groups` and
   `excluded` to `created_package`, JSON text like its other lists; undone in
   every test rewind.
2. **The endpoint** (plugin API, Packages section): `GET` and `PUT
   …/crombolo/api/packages/{id}/schema-picks` for the picks and exclusions,
   and `GET …/{id}/schema-picks/effective`, what the package will carry: each
   pick, and each dependency with the pick that added it.
3. **Dependencies** (a pure function over the schema set): a workflow's
   `applies-to` content types and its stages' approver groups; a form's
   `saveAsContent` document type; less what is excluded.
4. **The build** (`packages/server/src/site-sections.ts`): a picked package
   carries `schema/forms/`, `schema/workflows/` and `schema/user-groups/` files
   for its effective picks, and the dependent document types beside the ones
   Umbraco's picker chose; installing it syncs them as any schema file.
5. **The tabs:** three workspace views on the Bundle Editor (story `233`),
   each a list to tick, with an added item marked and its reason, and the
   Types tab ticking a dependent document type the same way; unticking one
   asks first.
6. **Tests** on both engines: dependencies worked out; picks and exclusions
   saved and read; a picked package carrying a form, a workflow and its groups
   installed on another site, where the form takes an entry and the workflow
   covers its pages; and a site-directory bundle doing the same.
7. **Docs:** `docs/bundles.md` (the tabs and what follows a pick),
   `docs/content-transfer.md` (what each route carries), the release notes.

## Acceptance criteria

- [x] The Bundle Editor has Forms, Workflows and User groups tabs, each listing
      the site's by name, and a package carries the files they pick.
- [x] Picking a workflow adds the document types it covers and the groups it
      names; picking a form adds the document type its "save as content" step
      creates; each is shown with what added it, and unticking one warns.
- [x] A round trip on both engines: a picked package and a site-directory bundle
      carrying a form, a workflow and its groups, installed on another site,
      where the form renders and takes an entry and the workflow covers its pages.
- [x] Migration 058 is undone in every test rewind.
- [x] `docs/bundles.md` and `docs/content-transfer.md` say what each route carries.

## What was built

- **Storage:** migration 058 (`data/src/schema/bundle-schema-picks.ts`,
  `AddBundleSchemaPicks`) adds one JSON column, `bundle.schema_picks`, holding
  `forms`, `workflows`, `userGroups` and `excluded` (`<kind>:<alias>`), as the
  table keeps its other lists, rather than the four columns the plan named.
  `BundleRepository.schemaPicks` / `setSchemaPicks`. Undone in every test
  rewind.
- **Dependencies:** `carriedPicks` (`server/src/schema-picks.ts`), pure over
  the schema set: each pick, then what each brings with the pick that brought
  it, an unticked one marked `excluded` rather than dropped.
  `schemaPickFiles` copies the site's own files for what is carried.
- **The endpoints** sit beside the Created view's others, under
  `<backoffice>/crombolo/api/bundles/`: `GET schema` (the site's forms,
  workflows and groups), `POST schema/carried` (what a set of picks carries,
  so a bundle not yet created shows it), and `GET`/`PUT created/<id>/schema`.
- **The build** (`adapters/bundles.ts`) adds a brought document type to the
  picked types, and the form, workflow and group files beside the sections.
  `PackagePortOptions.schemaDir` gives it the site's files.
- **The tabs:** `CromboloBundleFormsView`, `…WorkflowsView` and
  `…UserGroupsView` in `bundle-editor-sections.js`, with
  `<crombolo-bundle-brought-types>` on the Types tab. The editor's context
  keeps the picks and saves them after the definition. Unticking something a
  pick needs warns in place rather than asking first, as decision 2 has it.
- **Tests:** `tests/bundle-schema-picks.test.ts` (SQLite and Postgres): the
  dependency rules, the picks kept, the download's files, a round trip
  installed on a second site where the groups exist, the workflow covers
  articles and the form takes an entry, and a site-directory bundle carrying
  every form, workflow and group file. `tests/bundles-backoffice.test.ts`
  checks the tabs are registered; `tests/browser/bundle-editor.browser.ts`
  ticks a form, saves, and finds it ticked on reopening.
- **Docs:** `docs/bundles.md` ("Forms, approval workflows and user groups"),
  `docs/content-transfer.md`, the release notes.
