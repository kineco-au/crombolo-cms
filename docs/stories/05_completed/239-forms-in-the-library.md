# 239 — Forms in the Library

**Epic:** J — Forms · **Priority:** should · **Size:** L
**Depends on:** 027, 202

## Story

As an editor, I want to create a form in the Library from the same Create menu
as any other element, choosing which of the site's forms it is, and write its
words myself. As a developer, I want the form's structure to stay in the TOML I
own. Together, one form a developer defined can be used in several places, each
with its own heading, thank-you and recipients, without anyone editing a file.

## Context

Found 2026-11-01. Today a form is one thing: a file in `schema/forms/`
(`docs/forms.md`), edited by a developer in the Forms section's designer and
picked directly by a page's form picker (story 202). That file holds:

- **its structure:** pages, groups, fields, conditions, validation;
- **its behaviour:** `store-entries`, `requires-approval`, workflows;
- **its words around the fields:** `submit-label`, `message-on-submit`, and a
  workflow's `to`.

Whoever writes a page's words cannot change the form's without a developer, and
the same form cannot say different things on two pages.

Two ideas were considered and turned down:

- **The Forms screens as entries in Library's sidebar.** This moves the screens
  without changing who owns what.
- **Forms as items in Library's tree, in its folders.** Forms are files, kept
  in git, while Library's folders are content in one environment's database. A
  form filed in a folder would have a place no other environment knows.

## Decisions (2026-11-01)

1. **The split.** The developer owns the form: its TOML, edited in the Forms
   designer as now. The editor owns a **Library form**, an element that uses
   one form and carries the words around it. One form can back many Library
   forms ("Contact – Sales", "Contact – Support").
2. **Each configured form is a type in Library's Create menu**, next to
   element types such as Bullet List. The server derives one element type per
   form from its TOML, allowed in the Library, so there is still only one
   definition. Nothing is copied into a content type by hand.
3. **A Library form is an ordinary element.** It sits in folders, is published
   and versioned, follows the Library's permissions, and moves between
   environments as elements do. The tree, its folders and the fork are
   unchanged.
4. **What an editor sets** on a Library form is the words and the routing,
   not the structure:
   - the heading and an introduction;
   - the submit button's text (the TOML's `submit-label` is the default);
   - the thank-you message (`message-on-submit` is the default), or a page to
     go to after sending;
   - who is e-mailed about each entry, which overrides the `to` of the form's
     e-mail workflows.

   Field labels, help text, validation and workflows stay in the TOML. A value
   left empty falls back to the TOML.
5. **The page picks through the existing Form picker** (planned 2026-11-02).
   It offers Library forms, grouped by form, and stores a Library form's key.
   A value naming a form file still renders, in the TOML's own words. Templates
   still get a ready-to-render form, now in the Library form's words, so no
   template changes and no page migration. A new element-based picker was
   turned down: every site's templates would change.
6. **The derived types show in Structure, locked, in a "Forms" folder.**
   Opening one shows a banner naming the form it was made from and where to
   change it. Nothing in it can be saved, and the server refuses changes as it
   does for the built-in types. Hiding them was turned down: block lists'
   allowed-type pickers and developers could no longer find them.
7. **An unpublished or deleted Library form shows no form**, as a removed form
   file does today. The picker shows it as unavailable until cleared (story
   202). Falling back to the TOML was turned down: it would bring back the
   default recipients and thank-you the editor had replaced.
8. **The introduction is rich text**, in the site's standard editor, so it can
   hold a link or a short list.

## Plan

1. **Derived types** (`packages/schema/src/sync.ts`).
   - **Where:** `loadSchemaDirectory` already loads the forms (`loaded.set.forms`),
     so `syncSchema` adds one `ContentTypeAggregate` per form beside the files'
     own. Each is an element type, allowed in the Library, in a "Forms" folder,
     named after the form.
   - **Key:** `derivedKey('form-type', form.key ?? form.alias)`; properties
     key from it with `propertyKeyFor`, as types without a `key` do (story 161).
   - **Properties** (built-in data types): heading (Textstring), introduction
     (Rich text), submit text (Textstring), thank-you message (Textarea),
     follow-on page (Content picker), recipients (a list of e-mail addresses).
   - **Changes:** `watchSchema` already re-syncs when a form's file changes. A
     form removed retires its type, as a removed content type is retired, so
     its Library forms remain.
2. **Locked.** A flag on the aggregate, or a key check beside
   `isSystemContentType`, makes the management API refuse to save, rename or
   delete a derived type (`api-management/src/handlers/content-type.ts`). The
   plugin shows the banner in the type's editor (from `read-only-banner.js`).
   The type is never written to a TOML file.
3. **The picker** (`Crombolo.FormPicker`, its element and
   `render/src/values.ts`).
   - **Lists:** published Library forms, grouped by form.
   - **Resolves:** a stored key that is a Library form gives the form with the
     item's words laid over it; otherwise the form file it names, as now;
     otherwise null. An unpublished or deleted Library form is null.
   - **Overlay:** each non-empty value replaces the TOML's: submit text
     `submitLabel`, thank-you `messageOnSubmit`, follow-on page `redirectTo`.
     The heading and introduction are new fields on what templates get.
4. **Rendering** (`render/src/forms.ts`). `Form` draws the heading and the
   introduction's rich text above the fields when present. The Delivery API's
   form output (`api-delivery/src/forms.ts`, `api-delivery/src/output.ts`)
   carries the same words.
5. **Submission** (`server/src/form-submit.ts`, `server.ts`). The address stays
   `/crombolo/forms/<form>`. The Library form's key goes in the signed token
   beside the form's own, so it cannot be swapped. The thank-you and follow-on
   page come from the Library form the token names.
6. **Entries.** Migration 059 adds `form_entry.library_key` (nullable,
   indexed with `form_key`), with the release it ships in. `FormEntryQuery`
   gains `libraryKey`, the entries endpoints take it, and the Entries view gets
   a picker for it. Older entries have none and show as the form's own.
7. **Recipients.** At submission the Library form's recipients are copied into
   the queued run's payload (`form_workflow_run.payload`), and
   `WorkflowContext` carries them. `sendEmail` uses them in place of `to`
   (`server/src/form-workflows.ts`), with `{alias}` substitution as now. A
   later edit or unpublish does not change a run already queued.
8. **Tests.**
   - **Unit:** derived types created, changed and retired; locked against
     edits; the overlay and each fallback; the signed key; the migration (with
     every rewind helper); the entries filter; the recipients override.
   - **Browser:** Library → Create → a form, filled and published, then picked
     on a page and submitted, and the entry seen under its Library form.
9. **Docs.** `docs/forms.md`: the split, the derived types, what an editor sets,
   the picker and entries. The release notes.

## Acceptance criteria

- [x] Library's Create menu lists each configured form as a type beside the
      element types.
- [x] A Library form is created, edited, published, filed in a folder and
      versioned like any element.
- [x] Its heading, introduction, submit text, thank-you (or follow-on page) and
      recipients are used when the form is shown and sent; each empty one
      falls back to the TOML.
- [x] Field structure, labels, validation and workflows come only from the
      TOML, and the Forms designer is unchanged for developers.
- [x] A page's form picker picks a Library form, and a page that names a form
      file still renders.
- [x] Entries record and filter by the Library form they came through.
- [x] A form's file changed or removed updates its derived type, and its
      Library forms survive.
- [x] Unit tests cover the derived types, the words laid over the TOML, the
      recipients and the entries filter. Browser tests cover Create offering
      the form (`library.browser.ts`) and the page picker choosing a Library
      form (`forms.browser.ts`); seeing it on a page is in the unit tests.

## Implementation (2026-11-02)

- **Core** (`core/src/form-library.ts`): the property list, the type's key
  (`derivedKey('form-type', key ?? alias)`) and alias (`<alias>Form`), the
  recipients parser, and `applyLibraryForm`, which lays the words over the
  form. `SchemaForm.library` carries the heading, introduction and recipients,
  and is never written to a file. `formTokenSubject` and
  `FORM_LIBRARY_FIELD` are in `core/src/form-submissions.ts`.
- **Data:**
  - **Migration 059** (`AddFormLibrary`, `data/src/schema/form-library.ts`)
    adds `content_type.form_key`, `form_entry.library_key` and an index on
    `(form_key, library_key)`. It is undone in every rewind helper.
  - **`ensureFormLibraryTypes`** (`data/src/schema/form-library-types.ts`)
    saves one type per form in a "Forms" folder. It saves only what changed,
    retires the type of a removed form when no element uses it, and reports
    an alias already taken by another type as a clash.
  - **`listLibraryForms`** lists the elements of those types.
  - **`FormEntryRepository`** stores and filters by `libraryKey`. A queued
    run's column holds `{ values, recipients }` when there are recipients, and
    still reads the bare list.
- **Schema:** the sync's retirement, `crombolo schema export` and the drift
  check skip a type with a `form_key`. `syncSchemaDirectory` runs
  `ensureFormLibraryTypes` after every sync that is not refused, so boot, the
  watcher and the CLI all keep the types in step. The schema hash is
  untouched, so an upgrade does not count as a schema change.
- **Server:**
  - **Changes to a type:** the management API refuses to save or delete a
    type made from a form.
  - **Forms API:** `api/forms/library-forms` and `api/forms/library-types`
    list the Library forms and the types made from forms. The entries list
    takes `library`. A form saved or deleted in the designer re-derives the
    types.
  - **Submission** verifies the token over the form and the Library form, and
    reads the Library form from the published cache
    (`PublishedCache.libraryForm`).
  - **Workflows:** a send-e-mail workflow uses the run's recipients in place
    of `to`. On approval, the Library form's current recipients are used.
- **Render:** the published cache's form lookup tries a published element
  first, so a page's picker value resolves to the Library form. `<Form>` draws
  the heading and introduction, and posts the Library form's key. The Delivery
  API carries the heading, introduction and the field to post back.
- **Back office:**
  - **The Form picker** (`form-picker.js`, `form-picker-options.js`) lists
    Library forms grouped by form, marks one not yet published, and keeps a
    form a page names itself.
  - **Entries** gains a Library form filter, and names the Library form on
    each entry.
  - **A type made from a form** shows a footer note in its editor
    (`form-type-note.js`).
- **Tests:** `tests/form-library.test.ts` (17 with the picker's) covers:
  - the overlay and its fallbacks;
  - the derived types, kept in step, locked and retired;
  - a Library form on a page, and a page naming the form itself;
  - an unpublished Library form;
  - the picker list;
  - a submission's thank-you, entry, filter and recipients;
  - a token that cannot be swapped.

  `tests/form-picker.test.ts` covers the picker's choices and the entries
  filter's.
- **Release version:** migration 059 names `0.44.0`, the release it ships
  in, and the packages are versioned 0.44.0 to match (with story 238).
- **The derived types run before the sync** in `syncSchemaDirectory`. Run
  after it, they widened the gap between the sync recording a new schema
  state and the import moving the node to it. Postgres caught that in
  `schema-import.test.ts`: the poller saw the node behind and made it
  read-only.
