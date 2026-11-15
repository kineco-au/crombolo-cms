# 361 — Library elements and menus from the command line

**Epic:** P — The command line · **Priority:** could · **Size:** L
**Depends on:** 349

## Story

As an editor, I want to change Library elements and menus with the same
commands I use for pages, so that a menu or shared element doesn't need a
content file and a `site apply`.

## Context

Story 349, G14. The `content` commands act on pages. Library elements (story
242) and menus (story 141) are written by content files and `site apply`, or in
the back office.

## What is there to build on

- **The Library's own port.** The back office's Library handlers
  (`packages/api-management/src/handlers/element.ts`) call `createElementPort`
  (`packages/server/src/adapters/elements.ts`), not the content operations:
  - `create`, `update`, `createAndPublish`, `updateAndPublish`, `publish`,
    `unpublish`, `copy`, `move`, `moveToRecycleBin`, `moveFolder` and
    `folderToRecycleBin`;
  - each takes a `principal` only to name the version's author;
  - each change appends a cache instruction (`elements: true`), so a running server's
    pages and menus refresh after a write from the command line;
  - the menu alias rule lives in the port's `withMenuAlias`. An alias is filled
    from the name, and one another menu has is refused.
- **A surprise: the rules are around the port, not in it.** What the content
  operations do for a page is done for an element in the HTTP layer:
  - **Permissions**: `ELEMENT_RULES` in `packages/api-management/src/authorization.ts`
    gives each operation's Library verbs (`ElementPermissions`, `packages/core/src/permissions.ts`),
    held as the groups' fallback permissions (`fallbackPermissions`). They are
    group-wide, with no start nodes;
  - **Audit**: the HTTP audit layer (`packages/api-management/src/audit.ts`) writes
    `content` / `Element` entries by operation. The port records no events;
  - **Approvals**: there are none. An element publishes when asked.

  So the CLI can't get those rules by calling the port alone; see D1.
- **There is no "Library" node.** Elements and their folders (`Element`,
  `ElementContainer`) sit under the same root (`-1`) as the site's top-level pages
  (`treePage` in the port). `resolveNodeRef` (`packages/data/src/node-ref.ts`) walks
  the object types it is given, so a Library path is a page path walked over the
  Library's two types. A prefix has to say a path is in the Library, and one that
  looks like a page path (`/Library/`) would collide with a top-level page named
  "Library"; see D2. Content files name Library items
  without the prefix (`/contact/main-enquiry`, story 242), because the property or
  the `content/library` folder already says where to look.
- **How the content commands find things.** `findPage` (`support/pages.ts`) and
  `resolveItem` (`support/tree.ts`) take only `ObjectTypes.Document`, and
  `withPages` gives the document operations. `siteRefs` already resolves `library`
  references for values, and the shorthand reader and writer work on element types,
  so `--set` and `content show` need no new value code.
- **`content sort` has nothing to call.** The back office has no sort for the Library:
  the contract has no element sort operation, and the tree is in node order. So
  `sort` is dropped from the first criterion.
- **Publishing is what changes a menu.** `menu()` and the Delivery API's `menus/{alias}`
  read published menus only (docs/rendering.md, "Menus"). The criterion's commands
  leave out `publish` and `unpublish`, without which no change made here would
  reach a template. Both are added.
- **`content find`** is `queryDocuments` (`packages/data/src/content-query.ts`), which
  is fixed to `ObjectTypes.Document`. It gains the Library's object type as an
  option.
- **Menus** (story 141, `packages/core/src/content-types.ts`):
  - a Menu element has an `alias` and `items`. The items are a block list of Menu
    items, each a `link` (the `menuLink` multi-URL picker), a `label` and `children`,
    another such block list;
  - `packages/render/src/menus.ts` reads that tree;
  - the content-file shorthand for a multi-URL picker (`packages/server/src/seed/values.ts`)
    already reads a link as a URL with a scheme, else a media path, else a page path.
    `content menu add`'s link argument is read the same way.
- **The block commands don't reach nesting.** `support/blocks.ts` edits a block list's
  top level only. So the menu commands edit the menu's tree themselves, keeping each
  item's key and what they don't touch, and save the whole `items` value back.

## Decisions

- **D1: how the CLI writes a Library element.**
  - (a) the CLI calls `createElementPort`, as the back office does, and does the two
    things the HTTP layer adds itself:
    - the Library verbs, checked through an `elementVerbsAllow(principal, operationId)`
      exported from `authorization.ts` beside `ELEMENT_RULES`, so there is one table;
    - an audit entry per write, `content` / `Element` with the back office's action
      names, through `recordCommand` with a per-run audit spec on `BaseCommand`.

    *Recommended:* it calls the code the back office calls, with the same rule table,
    and keeps the story at M.
  - (b) a Library operations layer in `packages/content`, beside the document and
    media operations: actor-aware, checking the verbs, and recording the audit and
    events in the write's transaction. The back office's handlers move onto it too.
    That's the right home long term, as pages and media have one. But it is a
    refactor of the Library's every write, and makes this story L.

  **Decided 2026-11-15: (b).** The Library gets operations of its own, and the
  back office and the CLI both write through them.
- **D2: what a Library path looks like.**
  - (a) `/Library/…`, as story 349 wrote it. When the site has a top-level page
    named "Library", a `/Library/…` path is refused as ambiguous, naming both, so a
    script never silently changes what it acts on. That page is then named by its key.
    *Recommended:* it reads as the back office's section does, and works with every
    command's existing path argument.
  - (b) a `--library` flag on each command, with paths as content files write them
    (`/Menus/Main`). There is no collision, but there is one more flag to remember, and
    a path means different things with and without it.
  - (c) a scheme, `library:/Menus/Main`. There is no collision and no flag, but it
    is a form nothing else in the CLI uses.

  **Decided 2026-11-15: (c).** A Library item is `library:/<folder…>/<name>`, and
  `library:/` is the Library's top. The rest of the path is written as content files
  write it. A key works too, as for a page. A path with no scheme is always a page,
  so nothing is ambiguous and no top-level page name is reserved.

## Plan

0. **Library operations** (with D1 (b)), `packages/content/src/element-operations.ts`,
   beside `operations.ts` and `media-operations.ts` and built the same way:
   - `createElementOperations(repo, options)` takes an `Actor` on every write:
     `create`, `save`, `createAndPublish`, `saveAndPublish`, `publish`,
     `unpublish`, `copy`, `move`, `trash`, and the folder writes (`createFolder`,
     `renameFolder`, `moveFolder`, `trashFolder`);
   - **the verbs** move out of `ELEMENT_RULES` in `api-management/src/authorization.ts`
     into `packages/content/src/rules.ts`, as a table keyed by write, with no HTTP
     operation ids. The operations check it for a `user` actor, and the operator and
     system actors pass, as for pages. `authorization.ts` reads the same table, so
     there is one;
   - **the audit and events** are recorded in the write's transaction, through the
     content events (`events.ts`), as page writes are. The Element entries keep the
     back office's category and action names;
   - **the menu alias rule** (`withMenuAlias`) and the cache instruction stay in the
     elements adapter, which becomes the storage beneath the operations;
   - **the back office moves onto them**: `handlers/element.ts` calls the
     operations with `actorOf(ctx)`, and the HTTP audit layer stops writing Element
     entries, so none is written twice;
   - `tests/element-operations.test.ts` covers each write's verbs, audit entry and
     events, for a user, an operator and a system actor. The existing Library
     handler tests and browser-free back-office tests still pass unchanged, which
     shows the move kept the back office's behaviour.
1. **`support/library.ts`**:
   - `libraryPath(ref)`: with D2 (c), whether a reference is in the Library, and the
     path after `library:`. A key is looked up among pages and the Library alike;
   - `findElement(site, ref)`: resolved over `Element` and `ElementContainer`,
     answering the element with its type and editors, as `findPage` does, or the
     folder;
   - `withLibrary(work)`: the Library operations from step 0, beside the page site,
     each write made as `commandActor()`.
2. **The content commands branch on a Library path.** Each one's `section` becomes
   `['content', 'library']`. After resolving, it checks the section its path needs:
   Library for a Library path, Content for a page.
   The writes below name the port's methods. Each is made through the operation of
   the same name in step 0, never the port directly.
   - `new library:/<folder…>/<name> --type <element type>` uses `port.create`, or
     `createAndPublish` with `--publish`:
     - a type that isn't an element type is refused;
     - so is a folder that doesn't exist. Folders are made in the back office or by
       content files, which this story doesn't change;
     - `--view` is refused, since an element has no template;
     - `--skip-approval` changes nothing, since the Library has no approvals.
   - `update` uses `port.update` or `updateAndPublish`, with `--set`, as for a page.
   - `show` shows values, blocks and whether it is published, through the same
     reader.
   - `find --under library:/[…]` searches the Library through `queryDocuments` with
     the element object type. It is local only (story 349); with `--profile`, a
     Library scope is refused, saying so.
   - `move` uses `port.move`, or `moveFolder` for a folder; `--to library:/` is the
     top.
   - `copy` uses `port.copy`.
   - `delete` uses `moveToRecycleBin`, or `folderToRecycleBin`.
   - `publish` and `unpublish` use `port.publish` and `port.unpublish`.
   - `sort` on a Library path is refused: "The Library keeps no order of its own."
   - A selection that mixes pages and Library items is refused, so each command
     checks one kind of rule.
3. **`content menu`**, under `commands/content/menu/`, each with `access: 'site'` and
   the Library section, the menu named by its alias:
   - a `menuByAlias(db, alias)` is exported from the elements adapter. It is the
     port's `menuAliasTaken` query, answering the draft's key;
   - **an item is named** as a page is: by its label path as `menu show` prints it
     (`About/Our team`), or by its block key. An ambiguous one is refused with its
     keys;
   - `menu show <alias>` prints the draft's items as a tree: label, what each links
     to, and whether the menu has changes not yet published. `-o json` gives the tree
     with keys;
   - `menu add <alias> <page|media|url> [--label] [--under <item>]
     [--first|--before|--after <item>] [--target _blank]`:
     - the link is read by the content-file shorthand through `valueWriter`;
     - `--label` with no link makes a heading, as the back office allows;
     - the new item's key is printed;
   - `menu move <alias> <item> [--under <item>|--top] [--first|--before|--after
     <item>]` moves it with the items below it. Moving an item under itself is
     refused;
   - `menu remove <alias> <item>` removes it and the items below it, saying how many;
   - each edits the stored `items` tree and saves through `port.update`. The draft
     is what changes, and `--publish` publishes the menu too, as the content commands
     do; without it, the output says "A draft: `crombolo content publish
     library:/…` or --publish takes it live";
   - the verbs are `E.Update`, with `E.Publish` for `--publish`, and `E.Read` for
     `show`.
4. **Words.** "Library", "menu", "item" and "heading" are the back office's words.
   Neither block keys nor block lists appear in text output.
5. **Docs.**
   - `docs/rendering.md`, "Menus": building one from the command line;
   - `docs/building-a-site-from-the-cli.md`: a Library element and a menu;
   - `bun run cli:spec`;
   - the release notes under Unreleased.
6. **Tests.**
   - `tests/cli-library.test.ts`, for the content commands on Library paths:
     - `new` in a folder, and refused for a page type, for a missing folder and with
       `--view`;
     - `update`, `show`, `find --under library:/`, `move` of an element and of a
       folder, `copy`, `delete` and `publish`;
     - `sort` refused;
     - a top-level page named "Library" still reached by `/Library`, and a Library
       folder of that name by `library:/Library`;
     - a page path given where a Library item is needed, and the reverse, refused
       with a hint at the other form;
     - at `sign-in`: a person with Content but not the Library section refused, and one
       without the Library's Update verb refused;
     - the audit entries for each write, written once, by the operations.
   - `tests/menu-cli.test.ts`, for the menu commands:
     - `add` of a page, a media item, a URL and a heading, `--under`, `--before`;
     - `move` with the items below it, and under itself refused;
     - `remove` with the items below it;
     - keys and untouched items kept;
     - after `--publish`, `menu()` from `packages/render` and the Delivery API's
       `menus/{alias}` answering the new order and nesting;
     - a draft not yet changing either.
   - SQLite only: no table or column changes. `queryDocuments` gains a filter on an
     existing column, so the data layer's dialect tests aren't needed for it.
   - The Library handlers' tests cover the back office's move onto the operations.
     No browser tests: what the back office shows and does is unchanged.
   - The full SQLite suite and `test:integration`, since the back office's Library
     writes move.

## Acceptance criteria

- [ ] The `content` commands that make sense for an element take a Library path
      (`library:/...`): `new`, `update`, `show`, `find`, `move`,
      `copy`, `delete`, `publish` and `unpublish`. There is no `sort`, since the
      Library keeps no order of its own, and a menu changes the site only once
      published
- [ ] `crombolo content menu show <alias>`, and `content menu add <alias>
      <page|media|url> [--under <item>] [--label]`, `content menu move` and `content
      menu remove`, keeping a menu's order and nesting
- [ ] `-o json`; audited
- [ ] Tests for each, and that a template's `menu()` and the Delivery API's menus
      follow
- [ ] The CLI reference regenerated
