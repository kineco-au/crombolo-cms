# 454 — Extensions in a workspace

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** XL
**Depends on:** 311, 312, 323, 378, 384

## Story

As someone working in a workspace, I want the extensions I choose to work there as they do
in Shared, on data of the workspace's own, and the rest to be out of reach, so that what I
do in a workspace never reaches the live site through an extension before the workspace is
merged.

## Context

Extensions don't know workspaces exist:
- **Installing is site-wide and immediate:** a grant makes an extension live in Shared at
  once.
- **Its components don't render in a workspace with views of its own.** Such a workspace
  renders in a process of its own (`378`), which has no channel to the extension
  processes (`312`).
- **Its screens, routes, events and jobs act on Shared** (`323`), and its tables
  (`data-model.md`) aren't scoped. Whatever it writes from a workspace lands in the live
  site.

## Decided (2026-11-28)

1. **Chosen when the workspace is made.** The New workspace dialog (and the command line
   and the API) lists the site's installed extensions; the person ticks the ones enabled
   in that workspace.
2. **An enabled extension gets its own copy in the workspace:**
   - **its own process:** a second Deno process of the same extension, at the same
     version and settings, answering only that workspace's requests, screens, routes,
     events and component renders, including the workspace's own render process;
   - **its own tables:** isolated copies of the tables it declares `workspace` (4), which
     only the workspace's process reads and writes; its `shared` tables are Shared's own.
3. **An extension not enabled is locked in the workspace:**
   - its screens are shown read-only, with a note that it isn't enabled in this
     workspace;
   - its routes and actions that would change anything are refused there;
   - what it owns in the content model (its content types, data types and Library items)
     can't be edited in the workspace;
   - its components still render in the workspace's previews, from Shared's process,
     reading only.
4. **The extension declares how it works in a workspace,** since only it knows what its
   tables hold (member settings must never be overwritten; a catalogue is content to
   stage). In its manifest:
   - `workspaces: true` says it may be enabled in a workspace. One that says nothing may
     not, and is locked there (3), so every extension written so far is safe as it is.
   - Each table says what a workspace's copy does with it:
     - `shared`, read and write: the copy reads and writes Shared's live table, as
       Shared's own process does. For operational data such as member settings or orders.
     - `shared`, read only: the copy reads Shared's live table, and its writes are
       refused.
     - `workspace`: the table is copied for the workspace, and the workspace's changes
       are merged back when it is merged.
   - Optionally, a `merge` hook: the extension applies a workspace's changes to its
     `workspace` tables itself, for data where merging row by row makes no sense.
5. **Only extensions Shared has, as they are.** A workspace chooses among the installed
   extensions, at Shared's version and settings. Installing, upgrading, changing settings
   and removing stay site-wide actions; trying a new extension in a workspace is a later
   story.
6. **Enabled later, and disabled with a warning.** An extension can be enabled in an open
   workspace at any time, on the workspace's page or with the command line: its copy and
   its `workspace` tables are made then, from Shared as it is then. Disabling one stops its
   copy and drops its `workspace` tables and their changes, after a warning naming what
   would be lost.
7. **Side effects are the extension's to declare.** As with its tables, the extension
   states for each capability (outbound hosts, e-mail, webhooks, jobs, schedules) whether
   its workspace copy may use it. Undeclared, the copy's outbound requests and e-mails are
   refused and its jobs and schedules don't run there, so a preview can't e-mail customers
   or charge a card. A refusal is logged and, on a screen, says it is because of the
   workspace.
8. **Copies start on use and stop when idle.** A workspace's copy of an extension starts on
   the first request that needs it and stops after 15 minutes idle, starting again when
   needed. A setting (`extensions.workspaceCopies`, default 4) caps how many run at once,
   the least recently used stopped first.
9. **None ticked by default.** A new workspace starts with no extension enabled; a person
   opts in to each.
10. **A `workspace` table merges row by row** unless the extension has a `merge` hook: the
    workspace's inserts, updates and deletes are applied to Shared's table, and a row
    changed on both sides since the copy was made is a conflict to settle in the merge
    view, as a page is. So every `workspace` table needs a primary key, and the copy
    starts as Shared's rows at the moment it is made, the base the changes are measured
    from.
11. **Not in this story:** extensions working inside a workspace on Shared's data (option 1
   of the options discussed), and holding back an extension's side effects (option 4).

## The design

- **The manifest:** `workspaces`, each table's `workspace` (`shared-read-write`,
  `shared-read-only` or `workspace`) and each capability's use in a workspace are part of
  the extension's description (`311`), checked at install: a `workspace` table without a
  primary key is refused, saying so. The workspace copy's Deno flags are its grant
  narrowed to what it declares for a workspace.

- **Storage:** a table of the extensions enabled per workspace. The isolated tables are
  the extension's tables made again under a name of the workspace's (on Postgres, a schema
  per workspace copy, owned by the extension's role), created when the workspace is made
  and dropped when it is discarded.
- **Processes:** `startExtension` gains a workspace scope: the copy is started with the same
  build and grant, its tables' connection pointing at the workspace's copies, on the first
  request that needs it, and stopped when the workspace is merged or discarded, or after
  it has been idle a while.
- **Routing:** a request carrying the workspace header goes to the workspace's copy of an
  enabled extension, and is refused or answered read-only for one that isn't. The
  workspace's render process asks the main server to render extension components, naming
  its workspace.
- **Locking:** the content-model checks that already guard what a workspace may change
  refuse changes to what an extension not enabled there owns, saying why.

## Acceptance criteria

- [ ] **The manifest:** `workspaces`, each table's `workspace` and each capability's use in
      a workspace are read from an extension's description; a `workspace` table with no
      primary key is refused at install, saying so. An extension that declares nothing
      can't be enabled in a workspace.
- [ ] **Choosing:** the New workspace dialog, the command line and the API list the
      installed extensions that allow workspaces, none ticked; one can be enabled in an
      open workspace later, and disabled after a warning naming what is lost.
- [ ] **An enabled extension's copy** answers the workspace's screens, routes, events and
      component renders, including in the workspace's own render process, and Shared's
      process answers none of them.
- [ ] **Its tables:** a `workspace` table is copied from Shared when the extension is
      enabled and only the copy is read and written in the workspace; a
      `shared-read-write` table is Shared's live table; a `shared-read-only` table refuses
      the copy's writes.
- [ ] **The merge** applies a `workspace` table's changes row by row, a row changed on both
      sides being a conflict settled in the merge view; an extension's `merge` hook, when
      it has one, applies them instead. Discarding the workspace drops its copies.
- [ ] **Side effects:** the copy's outbound requests, e-mails, webhooks, jobs and schedules
      run only as the extension declares for a workspace; anything undeclared is refused,
      logged, and said on a screen.
- [ ] **An extension not enabled is locked** in the workspace: its screens read-only with a
      note, its changing routes and actions refused, what it owns in the content model
      not editable there, its components rendered from Shared's process.
- [ ] **Copies start on use and stop after 15 minutes idle;** at most
      `extensions.workspaceCopies` (default 4) run at once, the least recently used
      stopped first.
- [ ] **Tests:** the manifest's checks, the routing between Shared's process and a
      workspace's copy, each kind of table, the row merge and its conflicts, a `merge`
      hook, the side-effect rules, the lock, starting and stopping copies, on both
      dialects; a browser journey: enable an extension in a new workspace, change its data
      there, see Shared unchanged, merge, see it in Shared.
- [ ] **Docs:** `docs/extensions.md` (workspaces, and how to declare), `docs/workspaces.md`,
      the extension SDK's reference, the settings reference, and the release notes.
