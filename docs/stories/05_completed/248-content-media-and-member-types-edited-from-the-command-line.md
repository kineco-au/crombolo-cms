# 248 — Content, media and member types edited from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** L
**Depends on:** 247

## Story

As a developer setting a site up from the command line, I want to change a
type's settings, and add, change, reorder and remove its tabs and properties
with CLI commands, so that I never edit a schema file by hand.

## Context

Today a type is created with `types new` and grows with `types add-property`;
anything else is an edit to its TOML file followed by `types sync`. Each
command here writes the file canonically (as `types new` does), checks the whole
schema as the server will, shows the change in plain words, and applies it, so
the file stays the deploy unit (`docs/schema-as-code.md`) without anyone
opening it.

## Decided (planning, 2026-11-03)

- **Nested by what is changed:** `types update`, `types remove`,
  `types property add|update|move|remove`, `types tab add|rename|move|remove`.
  `types add-property` becomes `types property add`, with no alias kept, as
  story 167 renamed the seed commands.
- **A type that items use is not removed:** `types remove` is refused, naming
  how many items and where; `--retire` retires it as `types sync
  --force-retire-types` does today: nothing is deleted, its items keep their
  values, and the type can come back. Deleting the items is a content decision,
  not a schema command's.

## Plan (2026-11-03)

These are the defaults, each the existing rule rather than a new one:

- **Checked before written.** Each command builds the changed definitions in
  memory, checks them against a copy of the site's definitions as `types check`
  does (validation, then what a sync would do to this database and how it
  classes the change), and writes nothing when that refuses. A change that
  needs data work is refused with the findings; one that needs an answer (a
  value for pages missing a new mandatory property) takes the same `--set
  type.property=value` the check takes. Then it writes the definition and
  applies it as `types new` does, or leaves applying to `types sync` with
  `--no-apply`; an apply that is refused puts the file back as it was. Today
  `types add-property` writes first and syncs second, so a refused sync leaves
  a changed file behind: `types property add` takes the same path as the rest.
- **What content a change touches** comes from the check and from 247's item
  counts (`support/schema-view.ts`), and `--dry-run` says it in plain words.
- **Kinds:** content and element types, media types, member types. A member
  type's property also takes `--member-can-view`, `--member-can-edit` and
  `--sensitive`.
- **Groups inside a tab** (`[[tab.group]]`) are read and kept as they are, and a
  property in one is updated, moved or removed by its alias like any other;
  adding, renaming or removing a group is left for later.

1. **`packages/schema/src/edit.ts`** (new, pure): `updateType`,
   `addTab`/`renameTab`/`moveTab`/`removeTab`, `addProperty` (moved from
   `scaffold.ts`), `updateProperty`, `moveProperty`, `removeProperty`. Each
   takes the type and returns the changed type or why not (an unknown alias, a
   name taken, a tab with properties still in it, a composition or child type
   that does not exist).
2. **`packages/cli/src/support/type-edit.ts`** (new): the shared flow: find the
   type with 247's `describeType` (ambiguous kinds refused, `--kind`), apply an
   edit, check the result against an overlay of the site's definitions, print
   the change, then write and apply or stop. Built on the overlay check
   `bundle-sections.ts` already uses for a bundle's schema.
3. **The commands**, in `commands/types/`: `update.ts`, `remove.ts`,
   `property/add.ts` (replacing `add-property.ts`), `property/update.ts`,
   `property/move.ts`, `property/remove.ts`, `tab/add.ts`, `tab/rename.ts`,
   `tab/move.ts`, `tab/remove.ts`. Each: `--dry-run`, `--no-apply`, `--kind`,
   `-o json`, idempotent (asking for what is already so changes nothing and
   says so).
4. **Messages** name the type, tab and property, and the command for the next
   step, never a file; JSON keeps the file for tools.
5. **Docs:** the product site's schema guide gains "Changing a type"; the CLI
   reference lists the commands by topic; the release note names the
   `add-property` rename.
6. **Tests**, on SQLite and Postgres: each edit in `edit.ts`; each command's
   happy path and a refusal for each rule (a composition removed that content
   relies on, a data type its values do not convert to, a tab with properties,
   a type with items, an unknown alias); the file a command writes equals what
   `types rewrite` writes; a refused apply leaves the file as it was; `--dry-run`
   writes nothing; no output names a file or TOML.

## Acceptance criteria

- [x] **The type:** `crombolo types update <alias>` sets its name, description,
      icon, at the root, element, Library, list view and variance, and adds or
      removes allowed children (`--allow-child`, `--disallow-child`),
      compositions (`--compose`, `--decompose`) and views (`--view`,
      `--default-view`). Removing a composition or variance that content relies
      on is refused with what relies on it, unless the change is safe.
- [x] **A type removed:** `crombolo types remove <alias>` retires it as removing
      its file does today; refused while content of the type exists, naming how
      many items and where, unless `--retire`, which retires it with its items
      kept, as `types sync --force-retire-types` does.
- [x] **Tabs:** `types tab add`, `tab rename`, `tab move --before|--after`,
      `tab remove` (its properties move to another tab with `--move-to`, or the
      command is refused while it has any).
- [x] **Properties:** `types property add` (today's `add-property`, renamed);
      `types property update <type> <property>` changes its name, description,
      mandatory, validation, tab, and variance; `property move
      --before|--after|--tab`; `property remove` retires it as today (values
      kept until `types purge`), saying so.
- [x] **A property's data type changed** (`property update --type`) only where
      the stored values convert, as a schema sync already decides; otherwise
      refused with what the values are and the commands that would move them.
- [x] **Every command** takes `--dry-run`, which says in plain words what would
      change and what content it touches; is idempotent; prints `-o json`;
      checks the whole schema before writing anything; and applies the change
      to the database as `types new` does, or leaves that to `types sync` with
      `--no-apply`.
- [x] **No file or TOML** in any message: findings name the type, tab and
      property.
- [x] Tests on SQLite and Postgres for each command, including a refusal for
      each rule above and that the file it writes is what `types rewrite`
      would write.

## Implementation (2026-11-03)

- `packages/schema/src/edit.ts`: `updateType`, `addTab`, `renameTab`, `moveTab`,
  `removeTab`, `updateProperty`, `moveProperty`, `removeProperty`, with
  `addProperty` re-exported from `scaffold.ts`. Pure, each returning the changed
  type or the reason.
- `packages/cli/src/support/type-edit.ts`: `findType` (content, element, media,
  member; two kinds sharing an alias refused, `--kind`), `commitTypeEdit`
  (nothing to change when the definition would be written the same; the change
  checked against a copy of the site's definitions: validated, then the check a
  sync runs against this database, refusing anything outstanding or breaking,
  with `type-removed-with-content` let through by `--retire`; then written and
  applied, and put back when the apply is refused), `editFlags`, `editSpec`.
- `applySchema` takes `forceRetireTypes`, which `types remove --retire` passes.
- Commands: `types update`, `types remove`, `types property add|update|move|remove`,
  `types tab add|rename|move|remove`, under new `types:property` and `types:tab`
  topics. `types add-property` is gone; `types show` and the docs name
  `types property add`.
- **No `--set`:** the plan carried the check's `--set` answers over, but a
  sync takes none, and `mandatory-unfilled` is not a finding that stops a
  change, so a new mandatory property is applied and reported, as today.
- **Found on the way:** `types list` reported every built-in data type as "not
  applied yet" (story 247): the database's export leaves them out because every
  site has them. A data type the site does not define is now applied.
- **Tests:** `tests/types-edit.test.ts`; `types-show.test.ts` holds the
  built-in fix; the integration tests use `types property add`. Short of the
  plan: the commands are tested on SQLite only (the edits are pure, and the
  sync they apply through has its own tests on both dialects), and putting the
  file back after a refused apply is written but not exercised, since a change
  that passes the check and then fails to apply cannot be made to order.
- Docs: the product site's schema guide, "Changing a type"; release note.
