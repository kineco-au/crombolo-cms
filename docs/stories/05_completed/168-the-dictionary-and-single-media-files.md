# 168 — The dictionary and single media files

**Epic:** Q — A site from the command line · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As a developer setting a site up from the command line, I want to write the
dictionary as a file I can read, and to upload one media file with its alt text,
so that the last small pieces of setup need neither the back office nor a
hand-made XML file.

## Context

The dictionary moves in and out as Umbraco's `.udt` XML (`crombolo dictionary
import|export`): fine for carrying it between sites, not something anyone
writes by hand. `crombolo media import <dir>` uploads a directory tree (story
153) but not a single file, and sets no alt text or focal point.

## Acceptance criteria

- [x] `crombolo dictionary import` and `export` also take a TOML file — a key,
      its children, and a value per culture — chosen by extension; the same
      format is accepted in seed files (story 163) when that lands
- [x] `crombolo dictionary set <key> --culture <iso> <value>` and
      `dictionary list [--missing <iso>]`, to find untranslated keys
- [x] `crombolo media import <file> [--under <path>] [--name] [--alt]
      [--focal x,y]` uploads one file
- [x] Idempotent, `--dry-run`, `-o json`, audited
- [x] Tests on SQLite and Postgres
- [x] The Image media type has an `altText` field on every site, and a site that already
      has a field of that name keeps it
- [x] A dictionary written from the command line reaches a running server without a
      restart

## Findings (2026-11-06)

- **No media type has alt text.** Image holds the file, width, height, size and extension,
  and nothing in `packages/render` reads alt text from media. `--alt` has nowhere to land.
- **`crombolo dictionary import` leaves running servers stale.** It calls
  `importDictionaryUdt` directly, and only the back office's adapter
  (`adapters/dictionary.ts`) appends the cache instruction. This is a bug today, and every
  command in this story needs the same fix.
- **Story 163 has landed,** so "when that lands" now applies, and seed files have no
  dictionary at all. `bundle build` does carry a `dictionary.udt`, but it comes from the
  throwaway build database, which is empty.
- **Item names are unique across the whole dictionary** (`byName`), not per parent, and a
  `.udt` upserts by key. A hand-written file has no keys to give.
- **`media import` has no shared single-file path.** Its logic sits inside `walk`. The
  first argument is `dir`, and `statSync` refuses anything else.
- **A focal point only means something on an image cropper.** `file-intake.ts` keeps
  `focalPoint` on that editor alone, so a PDF or an SVG cannot hold one.
- **The rule that keeps shipped fields does not cover media types.**
  `checkSystemContentTypeFile` reads `SYSTEM_CONTENT_TYPES` only, so an Image file written
  before `altText` is not refused. It says what the type holds, so that site has no
  `altText` until it adds one.
- **Neither `dictionary` command has `--dry-run`.**

## Decisions (2026-11-06)

- **`altText` joins the Image type** (the maintainer's choice): a text field, not
  mandatory, added by a migration. Editors see it, and a seed sidecar can set it. It goes
  on Image only: alt text on a PDF or a video is not this field's job.
- **A site's own `altText` wins.** If Image already has that alias, the migration leaves
  it alone. `--alt` writes to it if it is a text field, and refuses by name if not.
- **The TOML format is a table per item:** a string is a translation, a table is a child.

  ```toml
  [Nav]
  en-US = "Navigation"
  fr-FR = "Navigation"

  [Nav."Nav.Home"]
  en-US = "Home"
  ```

  A key is the item's whole stored name, not a path, since names are unique across the
  dictionary. Nothing can be mistaken for anything else, and no reserved word is needed.
- **The file names items, the site keeps keys.** An item is matched by name. A new item's
  key is a version 5 uuid of its name, as seed keys are, so two sites built from one file
  share keys and a later `.udt` lines up.
- **A file adds and changes, and never deletes,** like a `.udt`. Languages the file does
  not mention are kept. If it places an item under another parent, the item moves.
- **A language the site lacks:** a file skips it and says so, as a `.udt` does.
  `dictionary set` is refused, because a typed `--culture` is a mistake worth stopping.
- **`dictionary set` makes a missing item at the root,** with `--parent <name>` to place
  it, so a site can be set up one line at a time.
- **`dictionary list` shows all items,** and `--missing <iso>` narrows them to items with
  no translation, or an empty one, in that language.
- **Seed files use `content/dictionary.toml`,** in the same format. An unknown language is
  a finding there, as a seed's other mistakes are, rather than a skip. It travels as the
  bundle's existing `dictionary.udt`, so it applies by key: an item made in the back office
  under the same name keeps its own, unlike a command-line import.
- **`media import` takes a file or a folder.** The argument becomes `path`. `--name`,
  `--alt` and `--focal` are refused with a folder.
- **Running it again converges.** The same bytes under the same name skip the upload and
  update `--alt` and `--focal` when they differ. Different bytes are reported and left
  alone, as a folder import does.
- **`--focal x,y`** takes numbers from 0 to 1, and is refused on a file with no cropper.

## Plan

1. **Shared dictionary writes.** In `dictionary-transfer.ts`, one `applyDictionary(db,
   tree, options)` behind `.udt`, TOML and `set`, returning what changed, with a `dryRun`
   that writes nothing. It appends the cache instruction when something changed.
   `adapters/dictionary.ts` and `importDictionaryUdt` use it too.
2. **The TOML format.** New `packages/server/src/dictionary-toml.ts`: `readDictionaryToml`
   and `writeDictionaryToml`, with problems named by item. A value that is neither a
   string nor a table is one. The writer's output must read back the same.
3. **Commands.**
   - `dictionary import` and `export` choose by extension, and `import` gains `--dry-run`.
     `--key` on `export` also takes a name.
   - New `dictionary set <key> --culture <iso> <value>` with `--parent` and `--dry-run`,
     audited like `import`.
   - New `dictionary list [--missing <iso>]`, `read_only`.
4. **Seed.** `seed/read.ts` reads `content/dictionary.toml` and `compileSeed` reports its
   findings. `bundle build` applies it to the throwaway database before `siteSections`, so
   the existing `dictionary.udt` section carries it. `start --bundle .` applies it too.
5. **`altText`.**
   - The property joins `built-in-media-types.ts`, and a migration adds it to existing
     sites, naming the next release, skipping a site that has the alias.
   - The rewinds: `tests/support/db.ts`, `tests/upgrade-from-release.test.ts`,
     `tests/integration/first-boot.integration.ts`, and any test that lists the steps.
6. **`media import`.** Extract `importFile` from `walk`. A file goes straight to it under
   `--under`. Add `--name`, `--alt`, `--focal`, with `--dry-run` reporting the update.
7. **Docs.** `docs/cli/` through `cli:spec`, `docs/content-transfer.md`, the seed section
   of the docs, `docs/schema-as-code.md`, a line in `docs/writing-components.md` on reading
   `altText`, and the release notes, with the migration listed.

### Tests

- New `tests/dictionary-files.test.ts`: TOML round trip, nesting, names with dots, a bad
  value, an unknown language, moving, and keys matching across two sites.
- `set` and `list` through the CLI, with `--dry-run`, `-o json`, a second run changing
  nothing, and an audit entry.
- A cache instruction after each command, proved by a running server showing the change.
- `media import` for one file: `--name`, `--alt`, `--focal`, a repeat, changed alt,
  different bytes, a folder with those flags, a file with no type, and focal on a PDF.
- The migration on a plain site, on one with its own `altText`, and through
  `tests/upgrade-from-release.test.ts`.
- Seed: `content/dictionary.toml` in `bundle build` and in `start --bundle .`.
- The full SQLite, Postgres and integration suites, since this adds a migration.

### Risks

- **`altText` on every site's Image.** It appears in the back office and in exports, so a
  bundle from a site on this release names a field an older site lacks.
- **The hand-written name decides identity.** Renaming a key in the file makes a new item
  and leaves the old one, since a file never deletes. The output will say what it created.
- **Moving a child by file** can surprise a site whose tree was arranged in the back office.
  `--dry-run` shows moves.

## Implementation (2026-11-06)

- `packages/server/src/dictionary-toml.ts` reads and writes the file.
  `dictionary-transfer.ts` gains `applyDictionaryEntries` and `writingDictionary`, which
  makes a dry run the real write undone.
- The back office's own adapter keeps its write path; the commands use the shared one.
- `AddImageAltText` is one statement, because `planUpgrade` shows a step's statements and
  a step that reads is unplannable. The field goes last on Image on a new site too, so a
  fresh site and an upgraded one match.
- `content/dictionary.toml` travels as `dictionary.udt`, so it applies by key: an item made
  in the back office under the same name keeps its own. `compileSeed` puts its text into
  the seed's identity, so a change is a new bundle.
- `media import`'s `dir` argument is now `path`.
- Tests: `tests/dictionary-files.test.ts`, `tests/cli-operations.test.ts`,
  `tests/seed.test.ts`, `tests/built-in-media-types.test.ts`.

## Out of scope

- Reading `altText` automatically in a rendered image. Templates read it as a field.
- A `dictionary delete` command.
- Alt text on media types other than Image.
