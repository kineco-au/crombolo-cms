# 163 — Content as code: seed files

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** XL
**Depends on:** —

## Story

As a developer standing a site up from the command line, I want to write its
pages, Library elements and media as files in the repository and apply them,
so that a working, populated site comes from a clone and one command, with no
one typing content into the back office.

## Context

Everything but content can already be set up from files or commands (the
schema, components, hostnames, settings). Content cannot: there is no command
that creates a page or sets its values. A bundle carries content, but bundles
are machine-written — an integrity hash, keys everywhere, values in the shape
each editor stores — and are exported from a site that already holds the
content.

The way through is already proven inside the repository.
`scripts/build-template.ts` builds every demo site's content in TypeScript —
helpers `page`, `element`, `image`, `pick` and `richtext` over
`DocumentRepository` — in a throwaway site, then exports it as the bundle each
template ships. Seed files make that a feature: a format a person writes, and a
command that turns it into the **existing bundle format** and applies it
through the **existing import** — so a seed gets the dry run, the conflict
findings, one transaction with schema before content, revert, `--publish` and
`push` without a second write path.

This reverses the Epic P line "editing content… stays in the back office": the
back office stays where content is *edited*; seed files are how a site's
starting content, and content that belongs with the code (legal pages, the docs
section of the product site, fixtures), is *declared*.

## Decisions

- **Seed files, compiled to a bundle.** Not imperative `content create`
  commands: deep values (blocks, pickers) would be JSON on a command line, and
  ordering and idempotency would be every script's problem. A few imperative
  verbs for day-two work are story 165.

### Decisions (2026-10-24)

- **Re-applying is three-way, in the import, for every bundle.**
  - **What is recorded:** the import records, per node, what it last applied:
    each value by property, culture and segment, each culture's name, the sort
    order and the parent.
  - **What happens on re-apply:**

    | Since the last apply | Result |
    | --- | --- |
    | only the bundle changed | taken |
    | only the site changed | kept, and reported |
    | both changed, differently | a conflict for a person |
    | no record (a node imported before this) | today's comparison |

  - **Names, order and parent** of an existing node then follow the bundle
    under the same rule. Today they are overwritten (names) or ignored (order,
    parent).
  - **Who benefits:** pulls, pushes and `start --bundle` as well as seeds.
  - **Cost:** it needs a migration.
- **A seed compiles against the site's database**, as `content check` does.
  The database has the built-in types, the languages, and the content a path
  to a page outside the seed resolves to. `seed check` in CI therefore runs
  against a site booted from the schema.
- **Lines from a key-to-line scan.** `Bun.TOML` parses but gives no positions,
  so a finding's line comes from scanning the file for its table and key. TOML
  is line-oriented, so this is reliable for the shapes seeds use. A syntax
  error carries the parser's own line. No dependency.
- **Settled without a question:**
  - **Markdown** goes through `Bun.markdown.html`, which Bun 1.4 has, so no
    dependency is added.
  - **Keys** are RFC 4122 version 5 uuids under one fixed Crombolo seed
    namespace, named by kind and path (`content/about/team`). Two sites built
    from the same seed share keys, which is what lets pulls and pushes match
    them up.
  - **A seed's identity** (`manifest.id`) is derived from its content, so
    `start --seed` applies it again exactly when it changed. The three-way
    import makes that safe.

## Findings (2026-10-24)

- **The bundle writer is pure.** `writeBundle(set, blobs, sections)`
  (`transfer/src/write.ts:292`) takes an in-memory `ContentSet` and fills in
  the integrity hash and the blobs. `writeBundlePackage` (`package.ts:86`)
  wraps it as the npm package the import reads. A seed compiler builds the
  `ContentSet`, including `dependencies` and `blobs` as `export.ts:300-364`
  does, and `referenceCandidates` finds the references.
- **A node** is `{key, kind, contentType:{key,alias}, parent, sortOrder,
  template, variants:[{culture,segment,name,published}], values:[{property,
  culture,segment,editor,value}]}`, with each value in its editor's stored
  shape. A Library element is a node of `kind: 'element'`. A media blob's key
  is `<first 8 hex of the item's key>/<file>`.
- **The import has no base.** `check.ts:659-662` says so ("We cannot know
  whether somebody edited it here or the bundle is simply newer"). Every
  difference is a `local-edit` for a person.
  - Names of existing nodes are overwritten without a finding.
  - Order is applied only to nodes the run creates, and parent never.
  - An unchanged re-import writes no values but still records a run.
- **No `--dry-run` on import.** `content check` is the dry run (exit 21,
  `--save` writes `resolutions.json`). `--publish` publishes the variants
  marked published, parents first. Schema and content apply in one
  transaction (`installBundleContent`).
- **`start --bundle`** marks a bundle applied by its `manifest.id`
  (`content_transfer_run`). It is not per version, which is why
  `build-template.ts` pins its ids.
- **Stored shapes**, from `build-template.ts` and the readers in
  `render/src/values.ts`:
  - rich text: `{ markup, blocks: null }`, with links as
    `/{localLink:<key>}`;
  - content picker: `umb://document/<32 hex>`;
  - media picker: `[{ key, mediaKey, mediaTypeAlias, crops: [], focalPoint:
    null }]`, where `key` is derived from `mediaKey`;
  - element picker: an array of element keys;
  - block list: `{ layout: { 'Umbraco.BlockList': [{contentKey,
    settingsKey?}] }, contentData: [{key, contentTypeKey, values:[{alias,
    value}]}], settingsData: [] }`;
  - block grid: the same, with `columnSpan`, `rowSpan` and `areas` in the
    layout;
  - multi-URL picker: `[{ unique, type, name, target, url?, queryString? }]`;
  - tags: a string array;
  - date: an instant string;
  - toggle: a boolean;
  - number: a number;
  - a media item's `umbracoFile`: `{ src, crops: [], focalPoint: null }`, plus
    width, height, bytes and extension.
- **Validation:** `DocumentRepository.validate` checks only mandatory and
  regex rules, and nothing checks that a value fits its editor's shape. The
  transfer check catches unknown types and properties, editor mismatches,
  missing languages and unresolved references.
- **Reuse:**
  - `nameBasedUuid` (v3, `data/src/relations.ts`) exists; there is no v5.
  - `marked` is a root devDependency only.
  - The CLI's exit 20 is `OUTCOMES.problems_found`, set as `components check`
    does.
  - A new topic goes in `oclif.topics` and in `CLI_PAGES` (the reference test
    fails otherwise).
- **The journey test.** `tests/integration/hello-world.integration.ts` (story
  180) already writes `seed/content/home.toml` and runs `seed check` and
  `seed apply`, as `test.todo` until this lands.

## Plan

1. **Characterise the import**, with tests that fail today:
   - re-importing a bundle whose value changed, onto a site nobody touched,
     needs no resolution;
   - a back-office edit with an unchanged bundle is kept, not reported as a
     conflict;
   - a changed name, order and parent in the bundle reach an existing node.
2. **The applied record** (migration, in the next release, with
   `release:version` run for it):
   - a `content_applied` table: `node_key` (primary key), `run_id`,
     `applied_at`, and `state`, a JSON document of what was applied (values
     by property, culture and segment, names by culture, sort order and
     parent);
   - written inside the import's transaction for every node it creates or
     updates;
   - every test rewind undoes it (memory: four rewinds).
3. **Three-way in `check.ts` and `import.ts`.**
   - Each field is compared as bundle, site and base.
   - New finding codes:
     - `bundle-changed` (auto: taken);
     - `local-kept` (info: the site's edit stays);
     - `local-edit` (now only when both changed).
   - **Names, order and parent:** a changed name is a value like any other. A
     changed parent moves the node through the document operations, with the
     placement rule and redirects (story 165). Order is applied among the
     siblings the bundle carries.
   - A node with no base keeps today's comparison.
   - `revert` restores the base as it stood before the run.
4. **The seed compiler** (`packages/transfer/src/seed/`):
   - **`read.ts`** walks `seed/content`, `seed/library` and `seed/media` into
     items (path, file, parsed TOML, line map). Sidecars belong to their
     files.
   - **`lines.ts`** is the key-to-line scan.
   - **`keys.ts`** derives v5 keys from kind and path, unless an item gives
     `key`.
   - **`values.ts`** turns each shorthand into the stored shape for the
     property's editor, read from the site's content types and data types:
     - Markdown (`Bun.markdown.html`) or `{ html = "…" }` for rich text, with
       links to content paths turned into `localLink`;
     - a content path for a picker or link, a media path for a media picker,
       and a Library path for an element picker;
     - block items as `{ type, values, settings }`, compiled recursively, with
       derived keys;
     - natural TOML for tags, dates, numbers and toggles;
     - the stored shape passed through for any other editor, or when given
       as a table.
   - **`compile.ts`** builds the `ContentSet`: types by alias, template
     defaulting to the type's, order then name, `published = false`, cultures
     from `[values.<culture>]` and `[name]`. It fills dependencies and blobs
     (media bytes; keys and `umbracoFile` as `build-template.ts` makes them),
     and sets `manifest.id` from the content hash.
   - **`findings.ts`** records file, line, code and message for: an unknown
     type or property, a value its editor cannot take, a path that resolves
     to nothing, a missing culture, a type its parent does not allow, a
     renamed file (a new key where `seed export` recorded the old one), and
     duplicate keys.
5. **Commands** (`packages/cli/src/commands/seed/`, a new `seed` topic and a
   CLI reference page entry):
   - **`seed check`:** `read_only`; exits 20 (`problems_found`) with each
     finding as `file:line  message`; `-o json` gives `{ findings }`.
   - **`seed build --out <dir>`:** writes the bundle package.
   - **`seed apply [--publish] [--dry-run]`,** with the import's resolution
     flags: the compiled bundle goes through `installBundleContent`. The dry
     run is `content check`'s plan, showing new, changed, kept and
     conflicting.
   - **`seed export <path>…`:**
     - writes seed files from a site's content, in shorthand where an editor
       has one and stored shape where not;
     - keeps each node's key in the file when it is not the derived one, so a
       round trip names the same nodes.
   - **`start --seed`:** applies the seed when its id has not been applied,
     beside `--bundle` (`importStartupBundles`).
6. **Docs:**
   - a seed guide: `docs/seeds.md`, and a page in the product site's docs
     section;
   - `content-transfer.md` (the three-way import and the applied record);
   - `operations.md`, `release-notes.md` (the migration and how imports now
     behave), and the Epic P line in the story index.
7. **Tests, on both dialects:**
   - each shorthand, with a picker and a block of each kind;
   - cultures and segments;
   - media with sidecars, and the bytes in the bundle;
   - order;
   - a re-apply without changes changes nothing, adds no versions, and leaves
     the base as it was;
   - three-way: bundle-only, site-only and both-changed outcomes;
   - a parent change that the placement rule refuses;
   - `seed check`'s lines;
   - a round trip, `seed export` then `seed apply` onto an empty site;
   - `start --seed` once per change;
   - the journey in `hello-world.integration.ts`, step 6, once story 180
     un-todoes it.

## Acceptance criteria

- [ ] **Layout.** A `seed/` directory at the site root: `seed/content/` (the
      content tree), `seed/library/` (Library elements) and `seed/media/` (the
      files, in the folders they go in). The folder tree is the content tree;
      each item is one TOML file named for its URL segment, with its children
      in a folder of the same name
- [ ] **Identity.** An item may give a `key`; otherwise its key is derived from
      its path, so a rebuild names the same node and the bundle does not churn.
      Renaming a file is a new node, and `seed check` says so
- [ ] **Order.** Siblings are sorted by an `order` field, then by name
- [ ] **Values by property alias, with a shorthand per editor:** rich text as
      Markdown or HTML; a content picker or link by content path; a media picker
      by media path; an element picker by Library path; block list and block
      grid items as `{ type = "<element alias>", values = {…}, settings = {…} }`;
      multi-URL picker, tags, dates, numbers and toggles in their natural TOML
      form. Anything else may be given in the editor's stored shape
- [ ] **Cultures and segments.** Variant values and names per culture
      (`[values.en-US]`); a culture the site has no language for fails the check
- [ ] **Media.** A file under `seed/media/` becomes a media item of the type its
      extension implies; an optional sidecar (`photo.jpg.toml`) gives its name,
      alt text and focal point. The bytes travel in the bundle
- [ ] **Template and publish state.** An item may name a template (default: its
      type's) and `published = false`; everything else is published by
      `seed apply --publish`
- [ ] `crombolo seed check` validates every file against the site's schema
      (unknown type or property, a value the editor cannot take, a path that
      resolves to nothing, a missing culture) and exits 20 with each finding,
      file and line
- [ ] `crombolo seed build --out <dir>` writes the bundle; `crombolo seed apply
      [--publish] [--dry-run]` builds and imports it, showing the import's own
      findings (new, changed, conflicting) and taking its resolution flags
- [ ] **Idempotent, three-way.** Applying an unchanged seed changes nothing; a
      value edited in the back office since is kept and reported, never
      silently overwritten; a change to the seed where the site is untouched
      is taken; a change to both is a conflict for a person. The import
      records what it applied per node, for every bundle
- [ ] `crombolo start --seed` applies the seed once per seed version, as
      `--bundle` does today, so a fresh clone starts populated
- [ ] `crombolo seed export <path>…` writes seed files from content already in
      a site, so an existing site can move to seeds
- [ ] Commands in `crombolo schema` (clispec), with `-o json`
- [ ] A seed guide in `docs/` and on the product site's docs section; the Epic P
      line in `docs/stories/README.md` updated
- [ ] Tests on SQLite and Postgres: every shorthand, cultures, media with
      sidecars, ordering, re-apply without changes, a conflicting re-apply,
      and a round trip (`seed export` then `seed apply` onto an empty site)

## Out of scope

- Public access rules, users and members in seed files: story 166, after the
  open question in 162.
- Content templates (blueprints): a later addition once the format settles.
- Turning the demo sites into seeds: story 164.
