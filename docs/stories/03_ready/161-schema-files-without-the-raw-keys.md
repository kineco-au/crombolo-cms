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

## Open question

**Which files lose their key lines?**

- (a) Everything with an alias: types and their properties, data types, forms
  (the form, its fields and its workflows) and approval workflows. Webhooks have
  no alias today, so `webhooks new` gives them one, names the file after it, and
  their `content-types` become aliases. Recommended.
- (b) Types, properties and data types only; forms, approval workflows and
  webhooks keep their keys for now.

## Known edges

- A type created in the back office gets its key from the browser, so its file
  keeps a key line. Its alias is still the only thing other files refer to.
- A developer whose database predates this keeps the old random keys (found by
  alias), and a development sync writes them back into the files. Resetting the
  database gives derived keys instead. The demo sites' bundles are rebuilt with
  derived keys.
- Block values in content store the element type's key, so content moved
  between two environments whose keys differ (legacy random keys on one side)
  still needs the keys to match, as today.

## Acceptance criteria

- [ ] A data type's config may name element types, content types and media
      types by alias wherever it takes a key: pickers, block list, block grid,
      rich-text blocks and the multi-node tree picker. Aliases are resolved to
      keys at sync, as a list or a comma-separated string. An unknown alias
      fails `types check` with the file and the alias. Keys still read
- [ ] Block list, block grid and rich-text blocks can be written as
      `[[data-type.block]]` tables. Each table gives the content and settings
      types by alias, plus label, size, group and the grid's spans and areas.
      Groups are named
- [ ] Type keys are settled before data types sync, so config can name a type
      added in the same change
- [ ] Keys are derived as described above; files carry no key lines unless
      one differs from the derived key; the production key rule is removed;
      two nodes syncing the same new files assign the same keys
- [ ] `types export`, `types rewrite` and back-office edits write aliases in
      config and omit derived keys; the canonical writer writes nested config
      and block tables as TOML, not JSON strings
- [ ] `types new content-type` takes `--compose <alias>…`,
      `--allow-child <alias>…`, `--vary-by-culture`, `--vary-by-segment`,
      `--library` and `--list-view`
- [ ] `types new data-type <alias> --editor <preset>` with presets for the
      common editors (textstring, textarea, rich text, number, toggle, date,
      dropdown, content/media/element picker, block list, block grid), each
      taking its main options as flags
- [ ] `crombolo languages add <iso> [--default] [--fallback <iso>]` writes
      `languages.toml`; `languages list`
- [ ] `crombolo forms new <alias>`, `workflows new <alias>` and
      `webhooks new <alias> --url --event…` write a starting file
- [ ] Every new command is in `crombolo schema` (clispec) and takes `-o json`,
      and syncs what it wrote (webhooks: parsed and validated)
- [ ] The demo sites' schema files carry no keys and their data types use
      aliases; their bundles are rebuilt
- [ ] `docs/schema-as-code.md` updated, including the multi-node rules; tests
      on SQLite and Postgres
