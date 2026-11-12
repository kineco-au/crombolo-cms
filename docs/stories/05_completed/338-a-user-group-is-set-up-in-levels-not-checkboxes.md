# 338 — A user group is set up in levels, not checkboxes

**Epic:** C — The backoffice, end to end · **Priority:** should · **Size:** XL
**Depends on:** 302

## Story

As an administrator, I want to set up a user group by saying where its people may
work and how much they may do there, so that I don't have to understand forty-five
checkboxes to give a team the right access.

## Context

The group editor is Umbraco's, and it offers every verb the system has as a
checkbox: 18 for pages, 9 for library items, 5 for library folders, 2 for media, 5
for forms, 6 for moving sites, plus extensions' own, then grids of the same verbs
per page, per library item and per field. Three start-node pickers each carry a
root toggle. Counted on 2026-11-12, that is around 45 checkboxes before any
exception is added, with no hint which matter.

The storage is not the problem. Verbs are strings in `user_group_permission`, and
per-page ones in `user_group_granular_permission`, so the catalogue can be pruned
and the screen redrawn with no change to the tables.

The design: https://claude.ai/artifact/4RMq55Er2m3h9iZJk1kvoz (six screens, in
the back office's own style).

## The design

**Five tabs**, each answering one question about the group:

1. **Access**: where they may work. One section per area of the back office
   (Content, Library, Media, Forms, Members, Settings, Users, Translation,
   Workflow), led by an on/off switch. An area that is on opens to its settings:
   - Content: Pages "Everywhere" or "Only under …", and the content languages;
   - Library and Media: their folders, likewise.

   The root-access toggles go: "Everywhere" is the root. An area that is off is one
   collapsed row with a one-line description.
2. **Permissions**: how much they may do, per kind of content, as one choice each:
   - Pages: None · See · Edit · Edit and publish · Full control;
   - Media: None · See · Upload and edit;
   - Library: Same as pages, or chosen separately;
   - Forms: None · See forms and answers · Manage forms, plus "Can see answers
     marked sensitive".

   A "Customise" link under a choice opens the verbs it stands for, in plain
   words, for a group that needs, say, publish without delete. A kind whose area is
   off under Access is shown greyed, with "Access is off" and a link to turn it on,
   never hidden.
3. **Exceptions**: a list of sentences, one per place the permissions differ:
   "News › Press releases: See only, instead of Edit and publish", "Product ›
   Price: can't change it", each with Change and Remove, and a count on the tab.
   "Add an exception" is a three-step panel: what it is for (a page and everything
   below, or one field on a page type), which one, and what they may do there, with
   a sentence reading back the result before it is added.
4. **Data Transfer**: the remote permissions as four plain sentences in two groups,
   Content and Structure and code, with "Install code on this site" in its own
   warning box. Administrators only.
5. **People**: members with search, the owners box (story 302), and the group's
   name and description.
**Levels are a way of writing verbs**, never stored. `@crombolo/core` defines each
level as a named verb set with one function each way: level → verbs, and verbs →
level or `custom`. The database, the group files, bundles, CI rules and the remote
protocol keep naming verbs, and the Management API's group contract keeps its
shape. A group whose verbs match no level shows as Custom with its verbs open.

**The catalogue is pruned**, in one migration that rewrites stored rows, default
and granular, and in the seed and `KNOWN_PERMISSIONS`:

| Today | Becomes |
|---|---|
| `Umb.ElementContainer.{Read,Create,Update,Delete,Move}` | the matching `Umb.Element.*` verb |
| `Umb.Document.Notifications` | dropped: anyone who can see a page may subscribe to it |
| `Umb.Document.PropertyValue.Read` | dropped: it only hid the field in the editor, and the API still answered the value |
| `Umb.Document.CreateBlueprint` | `Umb.Document.Create` |

`Crombolo.Remote.PullFull` stays: a full pull carries members' and users' personal
data, so it is its own permission, indented under the content copy on Data Transfer.

Every place that checks a dropped verb checks its replacement, or nothing. A group
file that names a dropped verb is read and rewritten to its replacement, so a file
written before still loads; a verb that is gone with no replacement is dropped with
a finding. The documentation of permissions (`bundles.md`, `remote-protocol.md`,
`operations.md`, the Umbraco comparison) says what each level grants.

**Where it is built.** The group screen is crombolo's own, replacing the vendored
workspace's details view and the permission grids, in the plugin as the Bundles
and Settings screens are. The vendored client keeps the user group routes, the
tree and the collection; the fork change is to point the workspace's view at the
plugin's element, or register the plugin's view with a higher weight and hide the
old one.

Not in scope: per-user start nodes, which story 339 removes; extension-declared
permissions, which stay as checkboxes in the Customise list of the kind they
belong to.

## The plan

Planned 2026-11-12. Decided: the verbs are pruned for real, in storage and in the
fork's checks; the editor is built in the crombolo plugin; a full pull stays its own
permission.

**Levels** (`packages/core/src/permission-levels.ts`), each a verb set, cumulative:

| Kind | Level | Verbs |
|---|---|---|
| Pages | See | `Umb.Document.Read` |
| | Edit | + `Create`, `Update`, `Move`, `Duplicate`, `Sort`, `PropertyValue.Write` |
| | Edit and publish | + `Publish`, `Unpublish`, `Rollback` |
| | Full control | + `Delete`, `RecycleBin.Restore`, `PublicAccess`, `CultureAndHostnames`, `Permissions` |
| Library | See … Full control | the same, with the `Umb.Element.*` verbs; Full control adds only `Delete` |
| Media | See | `Crombolo.Media.Read` |
| | Upload and edit | + `Crombolo.Media.Update` |
| Forms | See forms and answers | `Crombolo.Form.Read`, `Crombolo.FormEntry.Read` |
| | Manage forms | + `Crombolo.Form.Manage`, `Crombolo.FormEntry.Manage` |
| | Sensitive answers | `Crombolo.FormEntry.Sensitive`, a toggle beside either |

`levelOfVerbs(kind, verbs)` returns the level whose set is exactly `verbs`, else
`custom`. "Same as pages" for the Library is true when its verbs are the Pages
level's translated. A field exception is the absence of `PropertyValue.Write` on
that field: "can't change it".

**Pruning**, migration 075:
- Default rows (`user_group_permission`) and granular rows
  (`user_group_granular_permission`) rewritten:
  - `Umb.ElementContainer.X` becomes `Umb.Element.X`;
  - `Umb.Document.CreateBlueprint` becomes `Umb.Document.Create`;
  - `Umb.Document.Notifications` and `Umb.Document.PropertyValue.Read` are
    deleted;
  - duplicates are removed after the rewrite.
- A field that had neither Read nor Write is now visible but unchangeable. Read
  never kept a value from the API, so this widens only what the editor shows. The
  release notes say so.
- The seed, `KNOWN_PERMISSIONS` and `permission-names.ts` lose the pruned verbs.
- The group file parser reads a pruned verb as its replacement, so an old file
  loads, and rewrites it on the next write-back.
- Server checks: `content-query.ts` and `bundle-api.ts` stop asking for
  `PropertyValue.Read`, and Read on the page is enough. `authorization.ts`'s
  library-folder operations ask for the `Umb.Element.*` verb, and Create blueprint
  asks for `Create`.

**Fork** (`umbraco/crombolo`), Umbraco's own checks moved to match:
- the Create blueprint action is gated on `Umb.Document.Create`;
- the Notifications action is gated on `Umb.Document.Read`;
- library folder actions are gated on the `Umb.Element.*` verbs;
- the property-value Read condition always passes, so the editor shows every field
  and Write alone decides what can change;
- the user-group workspace's details view gets a condition that never matches, so
  the plugin's view takes its place.

**The editor** (plugin):
- `group-editor.js` is the user-group workspace view, with the five tabs inside it.
  It reads and writes through the fork's `UMB_USER_GROUP_WORKSPACE_CONTEXT`
  (`updateProperty`, `setFallbackPermissions`, `setPermissions`, owners), so
  Save, routing, the tree, read-only for non-administrators (302) and the members
  box stay as they are.
- `group-editor-words.js` is pure, as the other `*-words.js` files are: the
  levels' names and lines, the Customise labels, exception sentences, and "Access
  is off". It is unit-tested without a browser.
- Exceptions list the granular rows as sentences. The add panel writes a
  granular row for a page (its level's verbs, translated for the Library) or a
  field (`PropertyValue.Write` withheld).
- Data Transfer shows the remote verbs as sentences:
  - Pull;
  - Pull full, indented under Pull;
  - Push;
  - Push protected, indented under Push;
  - Apply structure;
  - Install code, in its warning box.

  The tab is shown only to administrators.
- Extension-declared permissions are listed in the Customise list of their kind,
  under the extension's name.

**Tests:**
- unit tests for the levels both ways, every kind;
- the migration on SQLite and Postgres, with the five rewind places;
- the group file parser reading pruned verbs;
- the server checks with the pruned verbs gone;
- the words;
- a browser test that sets a group up by levels, adds an exception, and checks
  the stored verbs and what a member of the group can then do.

## Acceptance criteria

- [x] The group editor has the five tabs, and no verb appears on it outside a
      Customise list.
- [x] Each level writes exactly its verbs, and a group with those verbs shows that
      level; any other set shows Custom with the verbs open.
- [x] A kind of content whose area is off under Access is shown greyed with
      "Access is off" and a link to Access.
- [x] Exceptions list every granular permission the group has as a sentence, and
      the panel adds one in three steps.
- [x] The migration rewrites every stored row of a pruned verb to its replacement or
      removes it, and a group file naming one loads with its replacement.
- [x] No check anywhere reads a dropped verb.
- [x] The group API, the group files, bundles, CI rules and the remote protocol are
      unchanged except for the pruned verbs.
- [x] A browser test sets a group up through the new screen and the server holds the
      verbs the levels stand for.
- [x] The release notes list the pruned verbs and what replaced each.

## Implementation

- **Levels:**
  - `packages/core/src/permission-levels.ts` (`levelVerbs`, `levelOfVerbs`,
    `withLevel`, `kindVerbs`).
  - The plugin's copy in `group-editor-words.js` is held to it by
    `tests/permission-levels.test.ts`.
- **Pruning:**
  - `PRUNED_PERMISSIONS` and `withoutPrunedPermissions` in `permissions.ts`.
    `ElementContainerPermissions` and the three Document verbs are gone from the
    catalogue, `permission-names.ts` and the seed.
  - Migration 075 `PruneGroupPermissions` (`pruned-permissions.ts`): a
    per-page or per-field set left empty becomes Umbraco's empty "nothing here"
    verb, never no row.
  - Group files read old verbs through `withoutPrunedPermissions`.
  - `authorization.ts`: folders check the `Umb.Element.*` verbs, and a
    blueprint checks Create.
  - `content-query.ts` and `bundle-api.ts` no longer ask for field Read.
- **Fork,** commit `07768bfb` on `umbraco/crombolo`:
  - the Library folder constants are the `Umb.Element.*` verbs;
  - the Notifications action is gated on Read, and Create blueprint on Create;
  - the field view guard always allows;
  - Umbraco's group details view is unregistered;
  - the members box is registered for the plugin.
- **Editor:**
  - `plugin/group-editor.js`, registered as `Crombolo.WorkspaceView.UserGroup.Editor`.
  - It reads and writes through `UMB_USER_GROUP_WORKSPACE_CONTEXT`, so Save,
    owners, `canManageMembers` and read-only for non-administrators come from
    302 unchanged.
  - Exceptions resolve names through the document, element and document type
    repositories.
- **Where it differs from the design:**
  - The group's name, icon and description stay in the workspace header, where
    Umbraco keeps them, rather than moving to People.
  - Exceptions can also be made for a Library folder.
  - Extension-declared permissions are kept as the group holds them, but not
    yet listed in Customise.
- **Tests:**
  - `tests/permission-levels.test.ts`: the levels both ways, plugin parity, the
    words, pruned verbs, group files, and migration 075.
  - `tests/authorization.test.ts`: folder verbs.
  - `tests/browser/users.browser.ts`: the editor sets a group up by level, shows
    "Access is off" and an exception as a sentence, and the server keeps the
    verbs. The owners test now opens People.
