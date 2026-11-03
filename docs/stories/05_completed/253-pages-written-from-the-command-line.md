# 253 — Pages written from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** XL
**Depends on:** —

## Story

As someone setting a site up from the command line, I want to create a page,
set its values and add its blocks with commands, so that building a site's
first content needs neither the back office nor a hand-written content file.

## Context

Found by the walkthrough in `docs/building-a-site-from-the-cli.md`. Every
definition has a command (stories 247–251), but content does not:

- `crombolo content` copies, moves, sorts, publishes, deletes and finds pages
  that already exist; nothing creates one or changes its values.
- The walkthrough's two pages were written by hand as content files
  (`content/pages/home.toml`), which is the very file editing story 252 hides.

## Decided (planning, 2026-11-03)

- **The database, as the back office.** Commands write a page through the same
  document operations as the back office and every other `content` command, so
  a page made here and then edited in the back office is the same page. Values
  are read in the content-file shorthand (Markdown for rich text, a path for a
  picked page or media item) by the converter `bundle apply` uses. Starting
  content ships with the site by `bundle export --source`, which writes the
  pages out as content files.
- **Blocks get aliases.** A block may carry an alias, unique within its
  property on that page. This is a feature of blocks everywhere, not only of
  the CLI:
  - the back office shows and sets it;
  - content files carry it (`{ type = "highlight", alias = "sourdough", values = { … } }`);
  - views can pick a block by it.
- **A command names a block by its alias or its key, never its position.**

## Plan (2026-11-03)

1. **The value converter, shared.** The shorthand conversion in
   `packages/server/src/seed/compile.ts` (`convert`, `blocks`, `elementValues`,
   rich text links, pickers by path) moves into a module that both
   `bundle apply` and the commands call. Content files keep reading exactly as
   they do.
2. **Block aliases.**
   - **Stored value:** an optional `alias` on the block's entry in the stored
     value. A test in the fork shows that a back office save keeps it.
   - **Back office (the fork):** an Alias field on a block, unique within the
     property, checked on save.
   - **Content files:** a block's `alias` is read and written by apply and
     export.
   - **Views:** `BlockItem.alias`, and `blocks.byAlias('…')` for picking one
     block out.
   - **Delivery API:** each block item includes its alias.
3. **`crombolo content show <page>`.** Shows:
   - the page's type, state and address;
   - each value in the shorthand, per language;
   - its blocks, each with its type, alias and key.

   `-o json` gives the same. The other commands start from this.
4. **`crombolo content new <path> --type <type>`.** The path's last segment is
   the page's name, and the rest names its parent: `"/Home/Visit us"`.
   - Refused when the parent does not allow the type, or a page is already at
     that path.
   - `--set <property>=<value>`, `--set-file <property>=<file>` for long text,
     `--culture`, `--view`.
   - The page is a draft unless `--publish` is given, which goes through
     approval as `content publish` does.
   - Its key is the one a content file at that path derives (`seedKey`), so
     the same command makes the same page in every environment, and an export
     needs no key line.
5. **`crombolo content update <page>`.** Takes:
   - `--set`, `--set-file` and `--unset <property>`;
   - `--name`, `--culture` and `--view`.

   It saves a draft, like the back office's Save, and `--publish` saves and
   publishes. A value the property's editor cannot read is refused with the
   reason, and nothing is saved.
6. **`crombolo content block add|update|move|remove <page> <property>`.**
   - **add:** `--type <element>`, `--alias`, `--set`, `--settings-set` and
     `--before`/`--after <alias|key>`. Its output prints the new block's key.
   - **update** and **remove:** name the block by alias or key.
   - **move:** takes `--before`/`--after <alias|key>`.
   - `--alias` on update gives an existing block an alias, or changes it.
   - A block list or a block grid's top level. A grid's areas, and blocks
     inside a block, are left to a later story.
7. Every command has `--dry-run` and `-o json`, and is checked before anything
   is saved.
8. Docs: the CLI reference, `docs/writing-components.md` (`byAlias`), the
   content files guide (`alias` on a block), the delivery API docs and the
   release note.
9. Tests:
   - on SQLite: a page created, its values set in each shorthand, blocks
     added, aliased, moved and removed, then rendered, with a view picking a
     block by alias;
   - each refusal;
   - an export of the page reading back the same through `bundle apply`;
   - a duplicate alias refused;
   - the fork's block test, that an alias survives a back office save;
   - the converter's unit tests, shared with apply.

## Implementation (2026-11-03)

- **The converter, shared:** `packages/server/src/seed/values.ts`.
  - `schemaLookup` gives types and each property's editor and data type
    settings, looked up once each.
  - `valueWriter` turns the shorthand into stored values. Content files read
    through it, with refs to the seeded files, and the commands do too, with
    refs to the site's own pages.
  - `shorthandReader` turns stored values back into the shorthand, with async
    path lookups. `bundle export --source` and `content show` both use it.
  - `compile.ts` and `export.ts` keep their behaviour.
- **Block aliases:**
  - **Stored value:** `alias` on the block's layout entry. A content file's
    block reads and writes `alias`, and two blocks of one list sharing one are
    refused at build.
  - **Saves:** `duplicateBlockAlias` in `packages/content/src/block-aliases.ts`
    refuses a create or save that shares one (`invalid`). It covers grid areas
    and blocks inside blocks.
  - **Views:** `BlockItem.alias`, and the list or grid value is a
    `BlockListValue` with `byAlias`, case-insensitive. Generated model types
    name `BlockListValue`.
  - **Delivery API:** a block item gains `alias` only when it has one.
- **Back office (the fork, commit `06bc8ccc`, pinned and vendored):**
  - an Alias field in the block workspace header
    (`block-workspace-editor.element.ts`);
  - `getOtherBlockAliases()` on the block workspace context;
  - `umbBlockAliasProblem` in `block-alias.function.ts`, with its
    web-test-runner test.

  The workspace keeps the whole layout entry and merges updates into it, so
  the alias rides along on a save. `tests/browser/block-alias.browser.ts`
  proves it: the field shows a block's alias, refuses one another block in the
  list has, and a page save keeps both blocks' aliases.
- **Block values carry their editor:** each value inside a block is stored
  with `editorAlias`, as the back office stores it. Blocks from content files
  had been stored without it, and the back office logged
  "Editor alias not found" for each when the page was opened.
- **The CLI:**
  - `support/pages.ts` holds the site, `findPage`, `typedValue` (text as typed
    for text and rich text, JSON otherwise), `setsOf`, `withValuesSet` and
    `savePage`. With `--publish`, `savePage` calls `saveAndPublish`.
  - `support/blocks.ts` edits the stored block value in place, so nothing the
    commands do not touch is rewritten.
  - The commands are `content new` (`createAndPublish` with `--publish`),
    `content update`, `content show`, and `content block
    add|update|move|remove`.
- **Tests:** `tests/content-pages.test.ts` covers:
  - `byAlias`, the Delivery API alias and the save check;
  - pages made with each kind of value;
  - a publish refused while the parent is a draft, with nothing made;
  - each refusal;
  - blocks added, aliased, changed, moved and removed;
  - an export with aliases read back through `bundle apply`, and a duplicate
    alias in a content file refused;
  - the page served, its view picking a block out by `byAlias`.

## Acceptance criteria

- [x] `crombolo content new <path> --type <type>` creates a page, named by the path's last part,
      under the page at that path; refused when the parent does not allow the
      type.
- [x] `crombolo content update <path> --set <property>=<value>` sets values,
      read by the property's editor as content files read them (Markdown for
      rich text, a path for a picked page or media item), with `--culture`
      for a value in a language.
- [x] `crombolo content block add|update|move|remove <path> <property>` edits a
      block list's blocks, naming each by its alias or key.
- [x] **Block aliases:** a block may have an alias, unique within its property
      on the page. It is set in the back office and in content files, kept by
      a back office save, and readable from views (`byAlias`) and the Delivery
      API.
- [x] `crombolo content show <path>` shows a page's values and blocks.
- [x] `--dry-run` and `-o json`, checked before anything is written, as every
      definition command is.
- [x] Tests on SQLite: a page created, its values and blocks set, and the result
      rendered; each refusal.
