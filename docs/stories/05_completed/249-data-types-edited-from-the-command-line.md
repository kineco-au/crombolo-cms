# 249 — Data types edited from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 247

## Story

As a developer setting a site up from the command line, I want to change a data
type's settings, rename it and remove it with CLI commands, so that an editor's
options, a picker's allowed types and a block list's blocks are set without a
file.

## Context

`types new data-type <alias> --editor <editor>` creates one with a handful of
settings flags (`--max-chars`, `--rows`, `--min`/`--max`/`--step`,
`--multiple`, `--with-time`, `--block`). Nothing changes one afterwards except
its file, and most editors' settings have no flag at all.

## Decided (planning, 2026-11-03)

- **`--set <setting>=<value>` stores what it is given, unchecked.** The setting
  takes effect when its name is one the editor uses, and is kept either way:
  no catalogue of every editor's settings is built or shipped. A value is read
  as JSON when it parses (`--set multiple=true`, `--set
  'validationLimit={"min":1,"max":3}'`), and as text otherwise. `--unset
  <setting>` takes one away. The named flags (`--max-chars`, `--multiple`
  and the rest) are the presets' own, written as `types new data-type` writes
  them.

- **The same commands as types:** `types update` and `types remove` take a data
  type's alias too; `--kind` tells two kinds apart.
- **Built-in data types are not changed in place:** refused, saying to make the
  site's own with `types new data-type`.
- **A picker's start node by path,** written as the key a content file's path
  gives where there is one, and otherwise this site's page, said so.

## Plan (2026-11-03)

- **The same commands as types.** `types update <alias>` and `types remove
  <alias>` (story 248) take a data type's alias too, found as 247's
  `describeType` finds it, two kinds sharing an alias refused with `--kind`.
  A type's flags given for a data type, or a data type's for a type, are
  refused, naming which apply.
- **The same flow.** 248's `commitTypeEdit` is generalised from a type to a
  definition: built in memory, checked against a copy of the site's
  definitions (validation, then the check a sync runs, so a lower limit or a
  block removed that existing values rely on is reported by `--dry-run` with
  what it touches, and refused when a sync would refuse it), then written and
  applied, and put back when the apply is refused. The data type's file is the
  one the loader recorded (`data-type:<alias>`).
- **Built-in data types** are not edited in place: `types update textstring`
  is refused, saying to make the site's own with `types new data-type` and use
  that.
- **A picker's start node by path:** `--start-at /Home/News`. A page from the
  site's content files has a key derived from its path, the same in every
  environment, and that key is written; otherwise the page is looked up on this
  site's database, and the command says the start node names a page of this
  site. `--start-at none` takes it away.

1. **`packages/schema/src/edit.ts`:** `updateDataType(dataType, changes)` with
   `set`, `unset`, the preset options (through `presets.ts`, so a flag writes
   the setting `types new data-type` would), `addBlock` (element, label,
   settings type), `removeBlock`, `allow` (a picker's allowed types) and
   `startNode`; refusals for a block already there or not there and a preset
   flag the editor does not take.
2. **`support/type-edit.ts`:** `findDefinition` (types and data types) and the
   commit generalised to write a data type with `writeDataType`.
3. **`types update`** gains the data type flags: `--set`, `--unset`, the preset
   flags, `--add-block <element> [--block-label] [--block-settings]`,
   `--remove-block <element>`, `--allow <type>…`, `--start-at <path|none>`;
   **`types remove`** removes a data type no property uses, and is refused
   naming the properties that do (from 247's `usesOf`).
4. **`crombolo types editors [<editor>]`** (new): the editors `types new
   data-type --editor` knows, each with its Umbraco editor and the flags it
   takes; one editor's in full. It says that any other setting can be stored
   with `--set`.
5. **Docs:** the product site's schema guide, "Changing a data type"; release
   note.
6. **Tests**, on SQLite: each change in `updateDataType`; `--set` and `--unset`
   round-trip, an unknown setting kept; a preset flag writing what `types new`
   writes; a block added and removed; a block removed that a page uses refused
   or reported as the check says; a picker's allowed types; `--start-at` by a
   content file's path; a built-in refused; `types remove` refused while used
   and done when not; `types editors`; no output naming a file.

## Acceptance criteria

- [x] `crombolo types update <data type>` sets any setting as `--set
      <setting>=<value>`, stored as given (decided above), with named flags for
      the common ones (those `types new` has) and `--unset`.
- [x] **Blocks:** `--add-block <element type>` and `--remove-block` on a block
      list or grid, with each block's label, settings type and view.
- [x] **Pickers:** the types a content, media or element picker allows, and its
      start node by path.
- [x] `crombolo types remove <data type>`, refused while a property uses it,
      naming them.
- [x] `crombolo types editors [<editor>]` lists the editors `types new` knows
      and the flags each takes, and says any other setting is stored with
      `--set`.
- [x] A change that existing values no longer satisfy (a lower maximum, a block
      removed) is reported by `--dry-run` with how many values it touches, and
      applied as a schema sync decides today.
- [x] `--dry-run`, `-o json`, idempotent, no file or TOML in messages; tests on
      both dialects.

## Implementation (2026-11-03)

- `packages/schema/src/edit.ts`: `updateDataType` (`set`, `unset`, the preset
  options written only where they change a setting, `addBlock`, `removeBlock`,
  `startNode`), refusing a preset flag the editor does not take and blocks on an
  editor without them.
- `packages/cli/src/support/type-edit.ts`: the commit generalised as
  `commitDefinitionEdit`, with `commitTypeEdit` and `commitDataTypeEdit` on it;
  `findDataType` (a built-in refused); `startNodeAt` (a content file's path gives
  `seedKey('content/<path>')`, otherwise this site's page, said so).
- `types update` takes a data type's alias with the data type flags, refusing
  the other kind's; `types remove` removes a data type no property uses, naming
  those that do; `types editors` is new.
- **Short of the plan:** a block removed while a page's values use it goes
  through the same check as any change, but no test sets such a value up.
- Tests: `tests/data-types-edit.test.ts`. Docs: the product site's schema guide,
  "Changing a data type"; release note.
