# 161 — Schema files without the raw keys

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** L
**Depends on:** —

## Story

As a developer modelling a site from the command line, I want to write and
scaffold every kind of schema file by alias, with the options I need as flags,
and never see a uuid in one, so that I never copy a key out of the back office
or hand-edit TOML to finish what a command started.

## Context

Content, media, member and element types, data types, languages, forms and
webhooks are already files under `schema/`, applied by `crombolo types sync`
(`docs/schema-as-code.md`). Most references between them are already by alias:
a property's `type`, `compositions`, `allow-children`, `collection`, and an
approval workflow's `applies-to.content-types`. What still puts uuids in the
files:

- **Data-type config names types by key.** A picker or block editor limited to
  some types stores their keys in its raw editor config, e.g.
  `config = { allowedContentTypes = "2e4e319f-…" }` in
  `sites/harbourstone/schema/data-types/highlight-picker.toml`. The key exists
  only once the type has synced, and `types export` and back-office edits write
  keys there. Nothing validates config today (`validateSchemaSet` never looks
  inside it).
- **A webhook's `content-types` are keys** (`packages/server/src/webhook-files.ts`).
- **Every file carries its own keys.** Each type, property, data type, form,
  form field, form workflow and approval workflow has a `key = "…"` line,
  written back by sync in development (`writeKeysBack`) and required in
  production (`elementsWithoutKeys` in `packages/schema/src/sync.ts`). That
  production rule is what stops two nodes minting different keys for one alias.
- **`types new` stops short.** It writes a type with `--at-root`, `--element`
  and `--no-view`, but compositions, allowed children, culture and segment
  variance, `allow-in-library` and list views are TOML edits afterwards. There
  is no `types new data-type`.
- **No scaffolds** for a language (`languages.toml`), a form, an approval
  workflow or a webhook, although each is a file.
- **The canonical writer flattens nested config to a JSON string**
  (`scalar()` in `packages/schema/src/write.ts`). So block config, or
  `validationLimit = { min, max }`, does not survive `types rewrite`, export or
  key write-back as real TOML.

## Decisions

- **Aliases throughout.** Every reference from one schema file to a type or
  data type is an alias. A config value shaped like a uuid is still read as a
  key, so existing files keep working, but nothing we write contains one:
  export, `types rewrite` and back-office edits write aliases. References to
  things with no alias stay keys: the content nodes in a workflow's
  `applies-to.branches`, and a picker's start node.
- **No key lines.** A file no longer carries its own key. Instead, sync derives
  each key deterministically from what it names: a fixed hash of the kind and
  alias for a type, data type, form or workflow, and of the owner's key and the
  alias for a property or form field. Every node and environment computes the
  same key, which keeps the multi-node guarantee the production rule gave. The
  rule itself goes. Sync chooses a key in this order:
  1. a key written in the file;
  2. otherwise the existing row with that alias, so existing databases keep
     their keys;
  3. otherwise a built-in type's shipped key;
  4. otherwise the derived key.

  The writer emits a key only when it differs from the derived one: for files
  that already carry one, and for a type renamed in the back office, which keeps
  its content attached. A hand rename of an alias in a file makes a new type,
  and the old one is retired with its data.
- **Blocks as `[[data-type.block]]` tables**, by element alias, compiled into
  the editor's config at sync. This applies to block list, block grid and
  rich-text blocks. Groups are named, and their keys are derived from the name.
  The raw `config.blocks` form stays readable.

  ```toml
  [data-type]
  alias = "pageBlocks"
  editor = "Umbraco.BlockList"
  config = { validationLimit = { min = 1 } }

  [[data-type.block]]
  element = "feature"
  settings = "featureSettings"
  label = "{{title}}"
  size = "medium"

  [[data-type.block]]
  element = "quote"
  group = "Text"
  ```
- **New commands sync what they write**, as `types new` does today. Sync
  validates first, so a bad file is refused with exit 8 and never half-applied.
  Webhooks sit outside the schema set, so they are parsed and validated
  instead.
- **One story.** Derived keys land with the alias work rather than separately.

- **Everything with an alias loses its key line**: types and their properties,
  data types, forms (the form, its fields and its workflows) and approval
  workflows. Webhooks have no alias today, so they gain one. The file is named
  after the alias, and `content-types` become aliases.

## Known edges

- A type created in the back office gets its key from the browser, so its file
  keeps a key line. Its alias is still the only thing other files refer to.
- A developer whose database predates this keeps the old random keys (found by
  alias), and a development sync writes them back into the files. Resetting the
  database gives derived keys instead. The product site's bundle is rebuilt
  with derived keys; the templates are seeds and need no rebuild (story 164).
- Block values in content store the element type's key, so content moved
  between two environments whose keys differ (legacy random keys on one side)
  still needs the keys to match, as today.

## Implementation (2026-10-25)

Built as planned. Where it differs:

- **Forms and approval workflows have no derived key.** Both are already found
  by `key ?? alias` (form sync, `syncWorkflows`), so a keyless file needs
  nothing derived, and the writer leaves out a key only where a file had none.
  The Harbourstone contact form keeps its own `key`, because its seed's Contact
  page stores that UUID in `enquiryForm`; its fields' keys are gone.
- **`--list-view` takes no value.** oclif has no optional-value string flag,
  so `--list-view` gives the built-in `listViewContent`, and
  `--list-view-type <alias>` names another.
- **Built-in media types** (Video, Audio, Article, Vector Graphics) resolve to
  their shipped keys by rule 3. The writer therefore treats those keys as
  derived and leaves them out, so the demo files carry none.
- **Webhook files** are named `<alias>.toml`. A back-office webhook takes its
  alias from its name (`webhookAliasFor`), else `webhook<8 hex of its key>`.
  A legacy `<key>.toml` is read, and replaced by the alias file on its next
  save. An unknown content-type alias resolves to a filter that matches nothing,
  so the webhook never widens.
- **`types new`** (and each new command) checks the new file with
  `validateSchemaSet` against the loaded set before writing, so an alias that
  names nothing is refused with no file left behind
  (`refuseOwnProblems`, `packages/cli/src/support/types.ts`).
- **Tests:**
  - `tests/schema-references.test.ts`: config aliases, block tables, and
    syncing on both dialects;
  - `tests/schema-sync.test.ts`: derived keys;
  - `tests/schema-scaffold.test.ts`: the scaffold options and presets;
  - `tests/cli.test.ts`: every new command, its conflict and refusal, `types
    check --static`, and the commands in `crombolo schema`;
  - `tests/webhooks.test.ts`: alias files;
  - `tests/templates.test.ts`: the demos keyless, with pickers by alias.

  The CLI journey is a unit test of the commands rather than a step in
  `tests/integration/new-site.integration.ts`, because nothing in it needs a
  served site.
- **Demo sites:** a one-off script stripped the key lines and rewrote the four
  picker configs to aliases, keeping comments. `bun run build:template` then
  regenerated the product site's bundle.

## Acceptance criteria

- [x] A data type's config may name element types, content types and media
      types by alias wherever it takes a key: pickers, block list, block grid,
      rich-text blocks and the multi-node tree picker. Aliases are resolved to
      keys at sync, as a list or a comma-separated string. An unknown alias
      fails `types check` with the file and the alias. Keys still read
- [x] Block list, block grid and rich-text blocks can be written as
      `[[data-type.block]]` tables. Each table gives the content and settings
      types by alias, plus label, size, group and the grid's spans and areas.
      Groups are named
- [x] Type keys are settled before data types sync, so config can name a type
      added in the same change
- [x] Keys are derived as described above; files carry no key lines unless
      one differs from the derived key; the production key rule is removed;
      two nodes syncing the same new files assign the same keys
- [x] `types export`, `types rewrite` and back-office edits write aliases in
      config and omit derived keys; the canonical writer writes nested config
      and block tables as TOML, not JSON strings
- [x] `types new content-type` takes `--compose <alias>…`,
      `--allow-child <alias>…`, `--vary-by-culture`, `--vary-by-segment`,
      `--library` and `--list-view`
- [x] `types new data-type <alias> --editor <preset>` with presets for the
      common editors (textstring, textarea, rich text, number, toggle, date,
      dropdown, content/media/element picker, block list, block grid), each
      taking its main options as flags
- [x] `crombolo languages add <iso> [--default] [--fallback <iso>]` writes
      `languages.toml`; `languages list`
- [x] `crombolo forms new <alias>`, `workflows new <alias>` and
      `webhooks new <alias> --url --event…` write a starting file
- [x] Every new command is in `crombolo schema` (clispec) and takes `-o json`,
      and syncs what it wrote (webhooks: parsed and validated)
- [x] The demo sites' schema files carry no keys and their data types use
      aliases; their seeds still check clean, and the product site's bundle is
      rebuilt
- [x] `docs/schema-as-code.md` updated, including the multi-node rules; tests
      on SQLite and Postgres

## Findings (2026-10-25), since the plan was written

Stories 163 and 164 changed what this story touches.

- **Seed files already name types by alias.** `seed/` (story 163) refers to
  content, element and media types by alias, and the compiler reads their keys
  from the database at build time. Derived type keys therefore need no change to
  any seed file. A block in a seed is `{ type = "<alias>" }`.
- **The demo sites are seeds now** (story 164). Their content lives in
  `sites/<x>/seed/` and `packages/cli/templates/basic/files/seed/`, and the
  TypeScript builders are gone.
  - Only the product site still has a committed bundle, built by `bun run
    build:template`, which wraps `crombolo bundle build`. It carries a copy of
    the site's schema.
  - Phase 7 is therefore: strip the keys in `sites/*/schema` and
    `packages/cli/templates/basic/files/schema`, then run `bun run
    build:template`. The schema copy inside the product bundle is regenerated
    rather than edited.
  - The templates have no bundle to rebuild.
- **Content keys in seed files are separate.** Story 164 kept the demo
  content's node keys as `key = "…"` lines in the seed files. Those are content
  keys and stay. This story removes only schema keys.
- **Built-in media types keep a key line.** `crombolo init` writes Umbraco's
  Video, Audio, Article and Vector Graphics media types into every site with
  Umbraco's own keys (`siteMediaTypeFiles`). Rule 3 keeps those keys, and since
  they differ from the derived keys, the writer keeps their key lines. That is
  expected, not a leak.
- **Every code path the plan names still exists:**
  - `writeKeysBack` (`schema/src/export.ts`);
  - `elementsWithoutKeys` and its production refusal (`schema/src/sync.ts`);
  - `scalar()` (`schema/src/write.ts`);
  - `content-types` as keys in `server/src/webhook-files.ts`;
  - `staticProblems` (`cli/src/support/types.ts`);
  - `tests/fixtures/clispec-v0.3.json`.

  Data-type config names element types by key in four demo files:
  `sites/crombolo/schema/data-types/{feature,step}-picker.toml` and
  `sites/harbourstone/schema/data-types/{highlight,tasting-note}-picker.toml`.
  There is no `apps/site/schema` any more (`apps/site` holds no schema), so
  phase 7's list drops it.

### Decided while re-planning (2026-10-25)

- **One key helper.** Seed keys (story 163) are RFC 4122 version 5 uuids from
  `packages/server/src/seed/keys.ts`. Rather than a second, sha-256 "v4-style"
  scheme, `derivedKey(...parts)` in `@crombolo/core` is a version 5 uuid of the
  parts joined by `\0`, under a fixed schema namespace. `uuidV5` and the seed
  namespace move into core beside it, and the seed code imports them from
  there.
  - **Unchanged:** `docsKey` (`stableKey`, sha-256) and `pickKey` stay as they
    are, because the keys they made are already in shipped content.
  - **Phase 1 changes** from "move `stableKey` into core" to "add
    `derivedKey`, and move `uuidV5` into core".

## Plan

The phases are in build order. Each lands with its own tests, and the suite
stays green between them.

### 1. Derived keys

- Add `derivedKey(...parts)` to `@crombolo/core`: a version 5 uuid of the parts
  under a fixed schema namespace. `uuidV5` moves there from
  `packages/server/src/seed/keys.ts`, which imports it back. The parts are
  fixed and versioned in one place:

  | What | Parts |
  |---|---|
  | content, media, member type | `type`, kind, alias |
  | property | owner type key, alias |
  | data type | `data-type`, alias |
  | form | `form`, alias |
  | form field | form key, field alias |
  | form workflow | form key, `workflow`, name; names must be unique within a form, which `validate-forms.ts` checks |
  | approval workflow | `workflow`, alias |
  | webhook | `webhook`, alias |
  | block group | data type key, group name |
  | grid area | data type key, element alias, area alias |

- `sync.ts`: each key is chosen in the order given under Decisions. The
  property and data-type paths follow the same rule. Remove
  `elementsWithoutKeys` and the production refusal. `report.assignedKeys` only
  lists keys that differ from the derived one (a legacy row found by alias), so
  `writeKeysBack` (`export.ts`) writes nothing for new types.
- Forms (`sync.ts` form sync) and approval workflows (`syncWorkflows`) use the
  same order.
- Writers omit `key` when it equals the derived key: `write.ts`
  (`writeContentType`, `writeDataType`, properties), `write-forms.ts` and
  `workflows.ts`.
- `packages/cli/src/support/types.ts` `staticProblems`: drop "missing keys"
  from `types check --static`.
- Tests (`tests/schema-sync.test.ts`, `tests/schema.test.ts`):
  - a file with no keys syncs to the derived keys;
  - two databases synced from the same files get the same keys;
  - a legacy key in a file wins;
  - an existing row found by alias keeps its key, and development writes that
    key back;
  - renaming an alias by hand retires the old type;
  - a production node with no key lines syncs;
  - the writer omits derived keys and keeps others.

### 2. Type keys settled before data types

- A pre-pass, `settleKeys(tx, set)` in `sync.ts`, runs before data types sync.
  It resolves every type key of every kind with phase 1's rule, plus every
  data-type key, into one `KeyPlan` (alias → key per kind). The per-kind
  `typeKeyByAlias` and `dataTypeKeyByAlias` read from it rather than filling as
  they go. The second pass for `allow-children` stays, because it is about
  saving order, not keys.

### 3. Aliases in data-type config

- New `packages/schema/src/config-references.ts`: one table of which config
  fields hold which kind of key, per editor.

  | Editor | Field | Kind |
  |---|---|---|
  | `Umbraco.ElementPicker` | `allowedContentTypes` | element types |
  | `Umbraco.MediaPicker3` | `filter` | media types |
  | `Umbraco.MultiNodeTreePicker` | `filter` | by `startNode.type`: document, media or member types |
  | `Umbraco.BlockList`, `Umbraco.BlockGrid`, `Umbraco.RichText` | `blocks[].contentElementTypeKey`, `blocks[].settingsElementTypeKey` | element types |
  | `Umbraco.BlockGrid` | `blocks[].areas[].specifiedAllowance[].elementTypeKey` | element types |

  It exports `resolveConfig(dataType, plan)` (aliases → keys, in Umbraco's own
  shape: a comma string where the editor expects one) and
  `aliasConfig(dataType, keyToAlias)` (keys → aliases, written as a list).
  Values shaped like a uuid pass through unchanged.
- `validate.ts`: check every reference field.
  - An unknown alias reports `unknown type "x"` on that field's path.
  - A non-element type where an element is required, or the wrong kind,
    reports the same way.
- `sync.ts`: `dataTypes.save` takes the config from `resolveConfig`.
- `generate.ts` (`blockElements`, element picker): match by alias as well as by
  key.
- Export (`export.ts` `toSchemaDataType`) and the back office's file writes
  (`packages/server/src/adapters/schema-files.ts`) go through `aliasConfig`.
- Tests:
  - every editor row resolves an alias;
  - a mixed list of aliases and keys works;
  - an unknown alias, a non-element alias, or the wrong media/document kind
    fails `types check` with the file and path;
  - a data type naming a type added in the same change syncs;
  - export round-trips to aliases;
  - a back-office edit of a picker writes aliases.

### 4. Block tables

- `parse.ts`: `DATA_TYPE_KEYS` gains `block`. `[[data-type.block]]` has these
  keys:
  - `element` and `settings` (aliases);
  - `label`, `size`, `background`, `icon-color`, `thumbnail`, `group` (a name);
  - grid only: `allow-at-root`, `allow-in-areas`, `column-spans` (a list of
    numbers), `row-span = { min, max }` and `area-columns`;
  - `[[data-type.block.area]]` with `alias`, `column-span`, `row-span`,
    `create-label`, `min`, `max`, and `allow`, a list of element aliases or
    group names, each with an optional `{ min, max }`.

  Raw `config.blocks` together with `block` tables in one file is a problem.
- New `packages/schema/src/blocks.ts`:
  - `compileBlocks(dataType, plan)` produces `config.blocks` and
    `config.blockGroups`, with group and area keys derived as in phase 1.
  - `decompileBlocks(config, keyToAlias)` goes the other way, for export and
    back-office writes. It falls back to raw `config.blocks` when a block uses a
    field the table can't say.
- `write.ts`:
  - `scalar()` writes nested objects as inline tables and arrays of objects as
    arrays of inline tables, not JSON strings;
  - `writeDataType` writes `[[data-type.block]]` tables.
- Tests:
  - block list, block grid (groups, areas, allowances) and rich-text blocks
    compile to the config the back office reads;
  - the compiled config renders through the existing value converters (reuse
    the `tests/value-converters.test.ts` fixtures, rewritten as tables);
  - decompile round-trips;
  - nested config such as `validationLimit` survives `types rewrite`.

### 5. Webhooks by alias

- `webhook-files.ts`:
  - `alias` is required on write;
  - `content-types` are aliases (a uuid-shaped value is still a key);
  - files are `schema/webhooks/<alias>.toml`, and a legacy `<key>.toml` is
    still read;
  - the key is derived from the alias unless the file has one.
- `webhooks.ts` resolves `content-types` aliases to keys when it loads, through
  the content-type repository. An unknown alias is logged and that filter is
  dropped, never widened to every type.
- The back office's webhook editor writes aliases.
- Tests: a webhook filtered by alias fires only for that type; a legacy keyed
  file still loads; the editor writes an alias file.

### 6. CLI

- `types new content-type`: add `--compose <alias>…`, `--allow-child <alias>…`,
  `--vary-by-culture`, `--vary-by-segment`, `--library` and
  `--list-view [data-type alias]` (with no value, `listViewContent`). These go
  through `newType` (`scaffold.ts`), and unknown aliases fail before anything
  is written.
- `types new data-type <alias> --editor <preset>`: the kind argument gains
  `data-type`. Presets live in `packages/schema/src/presets.ts`, each giving an
  editor, an editor UI and flag → config mappings:

  | Preset | Flags |
  |---|---|
  | `textstring` | `--max-chars` |
  | `textarea` | `--rows`, `--max-chars` |
  | `rich-text` | `--block <alias>…` |
  | `number` | `--min`, `--max`, `--step` |
  | `toggle` | `--default-on`, `--label` |
  | `date` | `--with-time` |
  | `dropdown` | `--option <value>…`, `--multiple` |
  | `content-picker` | `--allow <alias>…` (MNTP, content) |
  | `media-picker` | `--allow <media type alias>…`, `--multiple`, `--min`, `--max` |
  | `element-picker` | `--allow <element alias>…` |
  | `block-list` | `--block <alias>…`, `--min`, `--max` |
  | `block-grid` | `--block <alias>…`, `--columns` |

- New topics, each a directory under `packages/cli/src/commands/` with a
  `spec`:
  - `languages add <iso> [--name] [--default] [--mandatory] [--fallback <iso>]`
    and `languages list`, which read and write `languages.toml` through
    `parseLanguages` and the canonical writer;
  - `forms new <alias> [--name]` writes a one-page form with a name and an
    email field, and a store-entries workflow;
  - `workflows new <alias> [--content-type <alias>…]` writes one approval
    stage;
  - `webhooks new <alias> --url <url> --event <event>… [--content-type <alias>…]`.
- Every command refuses an existing alias (`conflict`), writes the file, then
  runs `applySchema` (webhooks: `parseWebhookFile` and validation). It returns
  `{ created: [paths], … }` for `-o json`.
- Register the topics in `package.json` `oclif.topics` and in `CLI_PAGES`
  (`reference.ts`), and update the clispec fixture
  (`tests/fixtures/clispec-*.json`).
- Tests:
  - `tests/schema-scaffold.test.ts` for the scaffold model, presets and flags;
  - `tests/cli.test.ts` for each command's `-o json`, conflict and refusal
    exits;
  - `tests/integration/new-site.integration.ts`: build a site from nothing
    with only these commands, then `types check --static`.

### 7. Demo sites

- Strip every key line and rewrite data-type config to aliases in:
  - every `sites/*/schema`;
  - `packages/cli/templates/basic/files/schema`.

  A script does it once: sync each site into a scratch database, then export
  with derived keys omitted. Then run `bun run build:template`, which
  regenerates the product site's bundle, including its schema copy (story
  164). The templates' seeds reference types by alias and need nothing.
- A test holds that each demo's seed still checks clean (`seed check`) against
  its keyless schema, and that `bundle build` of each site succeeds.
- Before stripping, grep the tests and builders for hard-coded type and
  property keys from the demo sites, and replace them with lookups by alias.

### 8. Docs

- `docs/schema-as-code.md`:
  - rewrite "Four rules that make it safe across nodes" for derived keys;
  - "A data type": aliases in config, block tables;
  - the "A content type" examples without keys;
  - the new commands under "Writing one".
- `docs/forms.md`, `docs/workflows.md` and `docs/webhooks.md`: examples
  without keys; webhook aliases.
- The CLI reference regenerates from the specs.

### Out of scope

- The approval workflow's `applies-to.branches` and picker start nodes stay
  content keys; seed files (163) are where content gets paths.
