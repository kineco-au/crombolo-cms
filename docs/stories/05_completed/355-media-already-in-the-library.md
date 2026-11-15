# 355 — Media already in the library

**Epic:** P — The command line · **Priority:** should · **Size:** M
**Depends on:** 349, 352, 353

## Story

As an editor, I want to find, inspect and change media already in the library
from the CLI, and say who may see it, so that fixing alt text or protecting a
folder is a command rather than a session in the back office.

## Context

Story 349, G4, G5 and G16. The CLI imports, moves, exports and deletes media,
but can't list it, show an item, change its name, alternative text, focal
point or file, make a folder, or set its permissions (story 204). Nothing in the
CLI says what uses a page or a media item before it is changed or deleted.

Each command here takes `--profile` (story 352) to act on another site, through the remote protocol, as the person signed in to it. A hosted site needs a new capability for these routes, checked by `packages/remote-conformance`. A CI identity is refused, since these act for a person (story 349, D2).

## What is there to build on

- **Media changes go through the media operations**
  (`packages/content/src/media-operations.ts`, `createMediaOperations`):
  - `create(actor, input)` makes an item or a folder where the actor may;
  - `save(actor, key, input)` saves an item's values and names, keeping its type,
    place and key;
  - both check the actor through `permits` (a user's media start nodes, a
    member's write rules), write the audit entry through the event sink
    (`mediaAuditEntryFor`), and append the cache instruction.

  `siteMediaOperations(db, config)` (`packages/server/src/content-operations.ts`)
  gives the CLI the same operations the server uses, as `recycle-bin empty` uses
  them, and `commandActor()` the actor.
- **The existing media commands write around them.** `media import`
  (`commands/media/import.ts`) calls `DocumentRepository.create` and `update`
  directly through `openMedia` (`support/media-tree.ts`), with no per-item
  permission check or audit entry. The new commands use the operations. Moving
  `media import` onto them is not part of this story.
- **A new file goes in through the upload path:**
  - `MediaFileStore.saveTemporary(id, file)`;
  - a `umbracoFile` value of `{ temporaryFileId }`;
  - `createFileIntake` (`packages/server/src/file-intake.ts`) then places the
    file, and fills in the width, height, size and extension.

  The item keeps its key, and pickers name media by key, so they keep working.
  `save` then removes the old file, as Umbraco does ("A replaced file is no
  longer anyone's").
- **A replaced file breaks images in rich text on rendered pages.** A rich text
  image is stored with its file's address in `src` and the item in `data-udi`.
  - The Delivery API rewrites `src` from `data-udi` (`api-delivery/src/rich-text.ts`).
  - `@crombolo/render` does not: `resolveLocalLinks` (`render/src/values.ts`)
    resolves only `{localLink:…}`.

  So after a replace, a template-rendered page still points at the file `save`
  deleted. The back office's own replace has the same fault today. See D1.
- **Alternative text and focal point.** The alt text is the `altText` property
  (`IMAGE_ALT_TEXT_ALIAS`), on types whose property is a text box or text area.
  The focal point is `focalPoint` on an image cropper's `umbracoFile` value.
  `media import` already checks both, and sets them, for one file (`checkDetails`,
  `updateDetails`, `focalPoint`). That logic moves to `support/media-tree.ts`, to
  be shared.
- **References are derived, not stored.** The back office's "Used by" is
  `ReferenceRepository.referencedBy(key, skip, take)`
  (`packages/data/src/repositories/references.ts`), through `createReferencePort`
  (`server/src/adapters/references.ts`). It scans current values for the key,
  in either spelling, so it finds pickers, links and `data-udi` in rich text.
  `relations.ts` holds only the relation types and the "parent on delete"
  relation, so it is not what this builds on.
- **Media permissions** (stories 196, 198, 204):
  - `createMediaAccess` (`packages/server/src/media-access.ts`):
    - `describe(key)` is what the dialog shows: the item's own rule, the
      inherited rule and where it comes from, the item's policies, the member
      groups, and the bundles using the folder;
    - `handle` checks the Media section, the start nodes and
      `MediaPermissions.Update`, then saves a rule, or removes it with `rule: null`.
      It is HTTP only;
    - `parseRuleBody` checks a rule.
  - The dialog's own rules are pure functions in
    `packages/backoffice-host/plugin/media-access.js`:
    - `formFor` and `accessMode`: Enabled, Disabled or Custom for reading,
      private or Custom for changing;
    - `inheritsParent`, and `requestFor`, which turns the form into the body sent;
    - `describeAccess`, the one-line summary.

    `tests/bundle-media.test.ts` already imports them. The file also holds the
    fetch calls and the element registrations, which read `document` only when
    called.
  - **Groups are member groups, by name.** A rule holds
    `{ name, read, write }` per group (`MediaAccessGroup`). Member groups have no
    alias. So the criterion's `--group <alias>` is `--group <name>`, corrected
    below. "Change" is the rule's `write`.
  - "Inherit" isn't a flag in a rule. An item inherits when it has no rule of its
    own and its policies are `inherit`, and unticking it starts its own rule from
    the folder above's. `--inherit` and `--no-inherit` do the same.
  - A rule also holds "anyone with the link" (`publicRead`), chosen members, all
    signed-in members, member uploads (file types and size) and the defaults for
    new files. The criterion names only groups, so how much `set` covers is D3.
  - The dialog's save is audited by the generic plugin-route entry (`media-access`
    in `PLUGIN_AREAS`), with no detail of what changed.
- **The remote protocol** (`packages/server/src/remote.ts`):
  - routes under `environments/{id}/…`, as the signed-in person, and
    `content/query` (capability `content-query`) checks the section the same way;
  - **`environments/{id}/media/{key}` is taken**: `GET` streams a file for a pull,
    `PUT` takes one for a push, both under the remote permissions, and
    `isUpload` streams any `PUT media/…`. The new routes go under
    `media-items/`, so neither collides;
  - a CI principal carries `principal.ci`;
  - `packages/remote-conformance` checks discovery capabilities one by one, and
    skips what a host doesn't list.
- **Paths on a hosted site.** `content find` refuses a path with `--profile`
  (`commands/content/find.ts`: "takes a page's uuid on a hosted site"). Here the
  routes resolve a path or a key themselves with `resolveNodeRef`, so
  `media show /Gallery/hero.jpg --profile live` works.
- **`content show`** (`commands/content/show.ts`, `support/pages.ts`) is local
  only. Story 353 adds a remote route that answers a page version through the same
  formatter. Whether `content show` itself gains `--profile` is D4.

The fifth criterion is corrected: `--group` takes a member group's name, since
groups have no alias, and `--change` is the rule's write.

## Decisions

- **D1: rich text images after a file is replaced.**
  - (a) `@crombolo/render` rewrites an `<img>`'s `src` from its `data-udi`, to the
    item's current address, as the Delivery API and Umbraco's
    `HtmlImageSourceParser` do. *Recommended:* it is the only option under which
    "what uses it keeps working" holds for every reference. It also mends the
    back office's own replace and any later move of a file, and it uses the media
    lookup `resolveLocalLinks` already makes.
  - (b) keep the old file when it is replaced. Nothing breaks, but files pile up
    that nothing uses, which Umbraco avoids on purpose, and a protected item's
    old file stays readable at its address.
  - (c) leave it, and say in the docs that rich text keeps the old address.
    Smallest, but it breaks the criterion for the most common reference to an image.

  **Decided 2026-11-15: (a).** The release notes list it as a fix to the back
  office's replace too.
- **D2: how the CLI uses the Permissions dialog's rules.**
  - (a) move the pure functions out of `plugin/media-access.js` into a
    browser-free `plugin/media-access-rules.js`, exported by `@crombolo/backoffice-host`
    as `./media-access-rules`, with JSDoc types. The dialog, the CLI and the tests
    import that one file. *Recommended:* one copy of the rules, no build step for
    the plugin, and the CLI already depends on `@crombolo/backoffice-host`.
  - (b) port them to TypeScript in `@crombolo/core`, keeping the dialog's copy, with
    a test that runs both over the same cases. Typed, but two copies to keep in step.
  - (c) the server works out the rule from the command's flags. That needs no
    sharing, but it is a second reading of the dialog that nothing checks.

  **Decided 2026-11-15: (a).**
- **D3: how much `media access set` covers.**
  - (a) who may see it: anyone with the link, only the back office, or chosen groups.
    Which groups may change it. Whether it follows the folder above.
    `media access show` reports everything, including what `set` can't change,
    and `set` keeps those parts as they are. *Recommended:* it is the story's
    case, protecting a folder, in a handful of flags. Chosen members and member
    uploads are a member's matter, for story 354's commands or a later story.
  - (b) everything the dialog has: chosen members by e-mail, all signed-in members,
    member uploads (`--upload-type`, `--upload-max`) and the defaults for new files.
    Complete, but about twice the flags and tests, for settings few people script.

  **Decided 2026-11-15: (a).**
- **D4: `content show --references` on a hosted site.**
  - (a) `content show` gains `--profile` in full. A remote route answers the page
    through the formatter story 353 builds for a version, with its references on
    request. *Recommended:* the criterion asks for `--profile` on each command,
    and a page shown with only its references would be a command that half works.
    353 is ready and builds the formatter, so this story follows it.
  - (b) only `--references` reaches a hosted site, through
    `GET content-items/{key}/references`, and `content show --profile` without it is
    refused. Less server code, but an odd command.
  - (c) `--references` stays local for pages. Media references still reach a
    hosted site through `media show`.

  **Decided 2026-11-15: (a).** 355 is built after 353.

## Plan

1. **A shared core**, `packages/server/src/media-library.ts`, used by the CLI
   locally and by the remote routes. Each function takes the actor, and a
   person's start nodes limit what they see, as in the back office:
   - `listMedia(db, actor, { under, type, skip, take })` and
     `findMedia(db, actor, { name, under, type, skip, take })`. Each answers the
     total and a page of items: name, key, path, type, size, and whether it is a
     folder;
   - `showMedia(db, actor, ref)`: its type, folder, file and its address, size,
     width and height, alternative text, focal point, and a one-line summary of
     who may see it, from the same summary `describeAccess` writes;
   - `mediaReferences(db, key, { skip, take })` and `pageReferences(db, key, …)`,
     through `ReferenceRepository.referencedBy`. Each answers the name, kind,
     path and type of what uses it;
   - `updateMedia(db, config, actor, ref, { name, alt, focal, file })`:
     - checks `alt` and `focal` against the type, as `media import` does;
     - saves a new file to the temporary store, and the item through
       `MediaOperations.save` with `{ temporaryFileId }`, keeping its focal point;
     - refuses a file its type doesn't take (`typesForExtension`), naming the
       types that would;
   - `makeFolders(db, config, actor, path)`: each missing folder along the path
     through `MediaOperations.create`, and none of those already there;
   - `mediaAccess(db, actor, ref)` and `setMediaAccess(db, actor, ref, change)`,
     moved out of `createMediaAccess.handle` with its checks: the Media section,
     start nodes and `MediaPermissions.Update`. `handle` calls them, so the
     dialog's route is unchanged. The rule is worked out with the dialog's
     functions (D2).
2. **Local commands**, each through `commandActor()`:
   - `media list [--under <folder>] [--type <alias>] [--skip] [--take]` and
     `media find --name <text> [--under] [--type]`: `access: 'site'`, Media section.
     Paging follows `content find`: 25 by default, at most 100, and "Showing
     26–50 of 120". `-o json` gives `total` and `items`;
   - `media show <item> [--references]`: Media;
   - `media update <item> [--name <name>] [--alt <text>] [--focal <x,y>] [--file <path>]
     [--dry-run]`: Media, audited by the operations. With `--file` it says how many
     things use the item and that they keep working;
   - `media folder new <path>`: Media. It says which folders it made, and changes
     nothing when they are all there;
   - `media access show <item>`: Media. It gives the dialog's summary line, then
     the parts: anyone with the link, only the back office, or which groups may see
     and change it; inherited from which folder; and members, uploads and
     new-file defaults where set;
   - `media access set <item>` (D3 (a)): Media, `static audit = { category:
     'media', action: 'SetPermissions', entityType: 'MediaAccess' }`.
     - `--anyone` or `--back-office-only` chooses who may see it.
     - `--group <name> --read|--change|--none` grants a group, and repeats.
       `--read` alone chooses groups.
     - `--inherit` follows the folder above again, alone.
     - `--no-inherit` starts its own settings from the folder above's.
     - An unknown group is refused, naming the site's member groups.
     - It prints the summary line after the change.
   - `content show <page> --references`: the existing Content section.
3. **Remote routes**, under `environments/{id}/`, each as the signed-in person
   through `userActor`, refusing a CI identity with "Changing media needs a
   person" (or "Reading…" for the reads), and checking the section as
   `content/query` does:
   - `GET media-items?under=&type=&name=&skip=&take=`,
     `GET media-items/{ref}[?references=true]`;
   - `PATCH media-items/{ref}` (name, alt, focal) and `PUT media-items/{ref}/file`,
     streamed as `isUpload` streams a push's media, with the file name in a header;
   - `POST media-items/folders` with the path;
   - `GET media-items/{ref}/access` and `PUT media-items/{ref}/access`;
   - `GET content-items/{ref}` (D4 (a)), with `?references=true`.

   `{ref}` is a key or an encoded path. Discovery lists `media-library`,
   `media-access` and `content-show`. `packages/remote-conformance` gains checks
   for each: a read, a refused CI identity, and a change and its undo on a host
   that allows it. `docs/remote-protocol.md` documents them.
4. **`--profile`** on each command, through `hostedOrHere` and `connectSite`
   (story 352). A hosted site whose discovery lacks the capability is refused
   with "This site needs a newer crombolo to …".
5. **Rich text images** (D1 (a)): `@crombolo/render` rewrites `<img data-udi>`'s
   `src` to the item's current address while it resolves local links, with the
   media lookup it already makes, so a page with no image pays nothing.
6. **Words.** "Used by 3 pages and 1 media item", "Anyone with the link can see
   this", "Only Gold members can see this". No "rule", "policy" or "udi". `-o json`
   gives keys and the full form.
7. **Docs.**
   - `docs/operations.md`, "Running a site from the command line": the media
     commands beside `media import`, and the command access table;
   - `docs/rendering.md`, "Protected media": `media access`;
   - `docs/rendering.md` on rich text images following their item (D1);
   - `docs/remote-protocol.md`;
   - `bun run cli:spec`;
   - the release notes under Unreleased.
8. **Tests.**
   - `tests/media-library.test.ts`, for the core:
     - list and find paged, by folder and type, within a person's start nodes;
     - show, with alt text, focal point and size;
     - references from a picker, a link and a rich text image;
     - an update refused where the type has no alt text or focal point;
     - a file of the wrong type refused;
     - folders made only where missing.
   - `tests/media-cli.test.ts`, for the commands, locally and against a test
     server with `--profile`:
     - each command, and `-o json`;
     - `media update --file` keeping the key: a media picker, a multi-URL link and
       a rich text image on a published page still render the new file, and the
       old file is gone;
     - the audit entries, naming the signed-in person;
     - at `sign-in`, a person without Media refused, and one outside the item's
       start node refused;
     - a CI identity refused on each route;
     - an old site's missing capability.
   - `tests/media-access-cli.test.ts`:
     - `show` matching the dialog's summary for the same item;
     - `set` for anyone, the back office only, groups that read and change,
       `--inherit` and `--no-inherit`;
     - a file then read by a member of the group and refused to a visitor,
       through `/media/…`;
     - an unknown group refused;
     - parts `set` doesn't change kept.
   - `tests/media-access.test.ts` and `tests/bundle-media.test.ts`: the dialog's
     functions from their new module (D2), unchanged in behaviour.
   - `tests/content-pages.test.ts`: `content show --references`, and with
     `--profile` (D4 (a)).
   - A rendering test in `tests/media-rendering.test.ts`: a rich text image whose
     file moved renders the current address.
   - `packages/remote-conformance`'s new checks run in its own test.
   - SQLite only: no table or column changes, only reads and writes through
     existing repositories and operations.
   - No browser tests: the dialog's behaviour is unchanged, and its rules are
     covered by the unit tests above.

## Acceptance criteria

- [x] `crombolo media list [--under <folder>] [--type <alias>]` and `media find --name
      <text>`, a page at a time
- [x] `media show <item> [--references]`: its type, folder, file, size, alternative
      text and focal point, and with `--references` the pages and media that use it
- [x] `media update <item> [--name] [--alt] [--focal <x,y>] [--file <path>]`,
      replacing the file keeping the item's key, so what uses it keeps working
- [x] `media folder new <path>`, making the folders it names that are missing
- [x] `crombolo media access show <item>` and `media access set <item> --group <name>
      --read|--change [--inherit|--no-inherit]`, with the rules story 204's screen
      uses. A group is a member group, named as the screen lists it
- [x] `content show <page> --references`, listing what uses the page
- [x] Each takes `--profile`; `-o json`; changes audited
- [x] Tests for each command, locally and through a test server, including a replaced
      file keeping its references working
- [x] The CLI reference regenerated

## Built

Built 2026-11-15, as planned with D1–D4 all (a):
- the core is `packages/server/src/media-library.ts`: `listMedia` and `findMedia`
  (a page, within a person's start nodes), `showMedia`, `referencesTo` and
  `usedByWords`, `updateMedia` (alternative text, focal point, name and a new file,
  through `MediaOperations.save` with `{ temporaryFileId }`), `makeFolders` (through
  `MediaOperations.create`), and `mediaAccess` and `setMediaAccess`, with
  `describeMediaAccess`, `mediaAccessRefusal` and `saveMediaAccess` moved out of
  `createMediaAccess`, whose `handle` now calls them, so the dialog's route is unchanged.
  `checkMediaDetails` and `parseFocalPoint` are `media import`'s checks, shared;
- the dialog's rules are `packages/backoffice-host/plugin/media-access-rules.js`,
  exported as `@crombolo/backoffice-host/media-access-rules` with JSDoc types; the
  dialog, its info panel, the server's core and the tests import it (D2);
- `@crombolo/render`'s `resolveLocalLinks` sets each `<img data-udi>`'s `src` to its
  item's file now, query kept, with the media lookup its links make, and only for markup
  with such an image (D1). An image whose item is gone keeps its saved address;
- `pageShown` in `packages/server/src/undo.ts` gives a page as `content show` does,
  through 353's `pageReader`; `content show` uses it here, and takes `--profile` and
  `--references` (D4);
- the remote routes are `packages/server/src/remote-media-library.ts`, mounted by
  `createRemote` when it has the operations: `media-items…` and `content-items/{page}`.
  Discovery lists `media-library`, `media-access` and `content-show`; `environments`
  says `may.mediaLibrary` and `may.contentShow`. A new file is streamed past the body
  limit as a push's media is. The server hands the remote `onMediaAccessChange`, for its
  media cache;
- the commands are `media list`, `find`, `show`, `update`, `folder new`, `access show`
  and `access set`, over `packages/cli/src/support/media-library.ts`, whose
  `withMediaLibrary` makes the same calls here or on a hosted site;
- the conformance suite lists media, shows one with its references, renames it and
  back, reads its access and refuses a change it can't read, and shows a page;
- tests: `tests/media-library.test.ts` (the core), `tests/media-cli.test.ts`,
  `tests/media-access-cli.test.ts`, a rich-text test in `tests/media-rendering.test.ts`,
  `content show --references` and `--profile` in `tests/content-pages.test.ts`, the
  rules' new module in `tests/media-access.test.ts` and `tests/bundle-media.test.ts`,
  and additions to `tests/cli-access.test.ts`, `tests/remote.test.ts` and
  `tests/remote-conformance.test.ts`, with `tests/support/media-commands.ts`. **The tests
  are written but not yet run:** the maintainer runs the full suites once, at the
  release. `bun run check` passes.

Where it differs from the plan, or fills it in:
- **`media import`'s checks moved to the server's core,** not `support/media-tree.ts`,
  since the remote routes need them too; `media import` calls `checkMediaDetails`. Its
  refusal now reads "no text field for its alternative text" rather than "for --alt".
- **One `referencesTo`** answers for a page and a media item alike, rather than
  `mediaReferences` and `pageReferences`; each reference has a `kind` (`page`, `media`,
  `library`, `member`, `other`) and its path.
- **`media list` gives a folder's own items, `media find` everything below `--under`.**
- **`--read`, `--change` and `--none` apply to every `--group` given,** since a flag
  can't be paired with the `--group` before it; giving groups different levels is two
  commands. `--change` lets the group see and change it; `--read` alone also makes the
  item seen only by the groups chosen; `--read` with `--anyone` or `--back-office-only`
  is refused.
- **A change other than `--inherit` gives the item its own settings,** starting from
  what it inherited, as the dialog does once "Inherit parent permissions" is unticked.
- **A hosted `access set` is audited by the site** (`SetPermissions` of `MediaAccess`,
  with the summary); a local one by the command, as `crombolo media access set`.
- **Refusals on the remote:** 404 for an item not found or in the recycle bin, 403
  `forbidden` outside the person's start nodes, 422 `refused` for what its type can't
  take, 400 for a body that is not one. A change needs the `content` access level.
- **An item in the recycle bin is not shown or changed,** with a hint to restore it.
