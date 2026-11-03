# 247 — The schema read from the command line

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** —

## Story

As a developer setting a site up from the command line, I want to list and
inspect the site's content types, media types, member types, data types and
their properties from the CLI, so that I can see what the site is made of
without opening its files or the back office.

## Context

Part of making the CLI the primary way to set up a site, with the schema's
TOML files an implementation detail nobody has to open (stories 247–252,
planned 2026-11-03). Today the CLI writes definitions (`types new`,
`types add-property`, `forms new`, `workflows new`, `webhooks new`,
`languages add`) and checks and applies them (`types check`, `types sync`), but
reading one means opening `schema/content-types/<alias>.toml`. Every later
story in this set needs the same view of a definition to show what a change
will do, so this comes first.

## Plan (2026-11-03)

No decision outstanding. These are the defaults, each the narrower choice:

- **One `types` group for every kind.** `types show <alias>` finds the alias
  among content, element, media, member and data types. An alias used by more
  than one kind (a content type and a media type both called `image`) is refused,
  naming the kinds and `--kind` to choose; nothing is guessed.
- **The files are what is shown**, as `loadTypes` reads them and the server
  will, so it is right before a sync and is what the commands of 248 to 251
  change. When the site's database is reachable, each type also says whether
  what is shown is applied ("not applied yet", from the same comparison
  `types check` makes) and how many items use it; without a database those are
  left out, said once. `--from-database` shows what is applied instead.
- **Built-in data types are listed**, marked built in; `--own` leaves them out.
  Types made from a form (story 239) are listed as such and are read-only here.
- **A data type's settings by their own names and values**, with plain words for
  the options `types new data-type` already names (most characters, rows,
  minimum and so on). Every editor's settings in plain words, and the list of
  editors, is `types editors` in story 249.
- **Local only.** A remote's schema is the site directory deployed to it (story
  241), so reading a remote is out of scope.

1. **`packages/schema/src/describe.ts`** (new, pure): from a `SchemaSet`, the
   rows `types list` prints and the detail `types show` prints, and a "used by"
   index over the set: allowed children and compositions in other types,
   blocks in block lists and grids, and the types a picker allows, each by type
   and property. Stories 248 to 251 reuse it for what a change touches.
2. **The database's side** (`packages/cli/src/support/types.ts` or beside it):
   item counts per type in one grouped query, and the applied state from the
   comparison `types check` already makes, both only when the site's database
   opens.
3. **`commands/types/list.ts`** and **`commands/types/show.ts`**, with `--kind`,
   `--own`, `--from-database` and `-o json`, following the `spec` and
   `outputFields` conventions of the other `types` commands. Each ends by naming
   the command that changes what it showed.
4. **The JSON shapes** in `docs/cli` (the CLI reference) and the human output in
   the product site's content types guide, which starts using `types show`.
5. **Tests:** `describe.ts` on a schema with compositions, block lists, pickers,
   element and form types; `types list` and `show` through the CLI on a SQLite
   site, synced and not, and with no database; an ambiguous alias refused; the
   JSON shapes; no output naming a file or TOML.

## Acceptance criteria

- [x] `crombolo types list [--kind content|media|member|element|data]`: each type's
      alias, name, kind, icon, and counts of properties and items using it.
- [x] `crombolo types show <alias>`: its settings (name, description, icon, at the
      root, allowed children, compositions, views, variance, Library, list view),
      its tabs and properties in order (alias, name, data type, mandatory,
      variance, description), and what uses it (child rules in other types,
      compositions, block lists, pickers).
- [x] `crombolo types show <data type>` for a data type: its editor, its settings
      in plain words, and the properties using it.
- [x] Every one is `-o json` with a documented shape, read from the site's
      definitions as the server loads them, so it is right whether or not the
      database has been synced; `--from-database` reads what is applied.
- [x] Nothing in the output names a file or TOML; each says how to change what
      it shows with the commands of stories 248 and 249.
- [x] Tests: list and show for each kind, compositions and block lists in
      "used by", JSON shapes.

## Implementation (2026-11-03)

- `packages/schema/src/describe.ts`: `listTypes`, `describeType` (an alias two
  kinds share is `ambiguous`, never guessed), `usesOf` (allowed children,
  compositions, properties of a data type, blocks and block settings, picker
  `filter` and `allowedContentTypes`), plain names for the preset settings.
- `packages/cli/src/support/schema-view.ts`: `appliedSchema` opens only a
  database that exists (never creates or migrates one) and reads the applied
  definitions (`exportSchemaSet`) and item counts per type in one grouped query;
  `appliedStateOf` compares each definition as written, keys aside.
- `commands/types/list.ts` and `commands/types/show.ts`: `--kind`, `--own`,
  `--from-database`, `-o json`; each ends with the command that changes what
  it showed.
- **Deviation:** types made from a form (story 239) live only in the database,
  so the files have none to list; they belong to their form (`forms show`,
  story 251).
- Tests: `tests/types-show.test.ts`. Docs: the product site's schema guide,
  "Seeing what a site has"; release note.
