# 357 — Every data type editor from the command line

**Epic:** P — The command line · **Priority:** should · **Size:** M
**Depends on:** 349

## Story

As a developer, I want to create a data type with any editor the back office
offers, from the CLI, so that a site's definitions never need the back office.

## Context

Story 349, G10. `types new data-type --editor` knows 13 editors
(`DATA_TYPE_PRESETS`, `packages/schema/src/presets.ts`). The back office offers
the rest too: tags, colour picker, eye dropper, slider, multi-URL picker, upload,
image cropper, Markdown, code editor, e-mail address, checkbox list, radio list,
member picker, multi-node tree picker, decimal and label. Other settings can be
set with `types update --set`, but a data type with another editor can't be
created at all.

## What is there to build on

- **Presets** are `DATA_TYPE_PRESETS` in `packages/schema/src/presets.ts`. There
  are 14 now, `single-block` included (story 345). Each preset has:
  - `editor` and `editorUi`;
  - `takes`, the options it accepts;
  - `build`, which turns those options into config and blocks.

  `presetDataType` builds one, and refuses an unknown preset or an option the
  preset doesn't take. `PresetOptions` is one flat set of options, shared by
  every preset, and `PRESET_OPTIONS` lists them.
- **Who uses them:**
  - `types new data-type` (`packages/cli/src/commands/types/new.ts`), whose
    `--editor` flag has `options: Object.keys(DATA_TYPE_PRESETS)`. oclif refuses
    any other value before the command runs, so a full name needs that
    restriction removed and checked in `presetDataType` instead.
  - `types editors` (`commands/types/editors.ts`), which lists the presets.
  - `updateDataType` in `packages/schema/src/edit.ts` (`types update`).
    `presetFor` finds a data type's preset by its `editor` alone. That is
    unambiguous today. It must also match `editorUi` once a preset's editor can
    have another UI, such as `Umbraco.Plain.String` for the code editor.
  - `types update --set` stores any setting as given (`parseSet`). `types new`
    has no `--set`.
- **`--min`, `--max` and `--step` are integer flags.** The decimal and slider
  editors need fractions, so these become number flags. The `number` preset
  then refuses a fraction itself.
- **What the back office offers**, from the vendored manifests
  (`packages/backoffice-dist/dist/packages/**/manifests.js`). Each editor UI names
  its schema (`propertyEditorSchemaAlias`). Each schema names its default UI and
  its settings, and many give `defaultData`: the values the data type editor
  fills in for a new data type. A preset that leaves those out opens in the
  back office with values it didn't write. For example, the slider's
  `minVal = 0`, `maxVal = 100` and `step = 1`, and the code editor's
  `language`, `height`, `lineNumbers`, `minimap` and `wordWrap`.
- **"Multi-node tree picker" is already a preset.** In this back office the
  "Content Picker" UI (`Umb.PropertyEditorUi.ContentPicker`) is
  `Umbraco.MultiNodeTreePicker`, and that is the `content-picker` preset. The
  editor missing is the single **Document Picker**
  (`Umb.PropertyEditorUi.DocumentPicker` on `Umbraco.ContentPicker`), which the
  seeded `contentPicker` data type uses. The criterion below says so. The
  `content-picker` preset only ever picks pages, while its editor also picks
  media or members (`startNode.type`), so it gains a flag for that.
- **Back-office editors not in the story's list:**
  - multiple text strings (`Umbraco.MultipleTextstring`) and date and time with a
    time zone (`Umbraco.DateTimeWithTimeZone`). crombolo already stores, converts
    and renders both (`JSON_VALUE_EDITORS` in `packages/core/src/property-values.ts`,
    the seeded `dateTimeWithTimeZone`);
  - date only, time only, date and time without a zone, the member group picker,
    the user picker and the entity data picker. crombolo has no value handling for
    these, so their values reach a template as stored text. They are for
    `--editor <full name>` only.
- **Values on a page.** `every-editor.test.ts` saves and renders a value for each
  seeded data type (`DEFAULT_DATA_TYPES`, `packages/data/src/schema/content-seed.ts`).
  That covers tags, colour, multi-URL, upload, image cropper, checkbox and radio
  lists, member and document pickers, and label. The eye dropper, slider,
  Markdown, code editor, e-mail address and decimal are seeded by none, so they
  have no such test.
- **Markdown reaches a template as its text.** `toPublishedValue` passes it
  through unchanged, and the Delivery API (`api-delivery/src/output.ts`) does
  too. Umbraco's value converter gives HTML.
- **Generated model types** (`packages/schema/src/generate.ts`, `tsTypeFor`) give
  `unknown` for the slider, both colour editors, Markdown, the code editor, the
  image cropper, the member picker and the label.
- **Validation** (`packages/schema/src/validate.ts`) checks config references
  through `CONFIG_REFERENCES` (`config-references.ts`), but not the editor alias.
  An unknown `--editor` full name would be written without complaint, and opens
  in the back office as a missing editor.

The first two criteria are corrected. The document picker replaces the
multi-node tree picker, and a full name that has a preset uses it. If D2 is
(b), the story's list also gains the multiple text string and the date with a
time zone.

## Decisions

- **D1: where the CLI learns each editor's UI and default settings.** A full
  `--editor` name needs its UI, and every preset should write what the back
  office would.
  - (a) a generated table in `packages/schema` (`editors.gen.ts`), made from the
    vendored manifests by a script. It holds each editor's default UI, each UI's
    editor, and each one's settings and `defaultData`. A test regenerates it and
    fails when it differs, so updating `backoffice-dist` shows what changed.
    *Recommended:* the schema package stays free of the client, the CLI reads no
    JavaScript at run time, and an unknown name can be refused with the close
    matches named.
  - (b) read the manifests from `@crombolo/backoffice-dist` when the command runs.
    Always current, but `@crombolo/schema` comes to depend on the client's file
    layout, and on the client being installed wherever the CLI runs.
  - (c) a hand-kept table, with `--editor-ui` for anything outside it. Smallest,
    but it drifts without anything saying so.

  **Decided 2026-11-15: (a).**
- **D2: which editors become presets.**
  - (a) the story's list, with the document picker in place of the multi-node
    tree picker. Everything else uses `--editor <full name>`.
  - (b) the same, plus multiple text strings and date and time with a time zone.
    *Recommended:* crombolo already handles both end to end, and they are common.
    The editors crombolo doesn't handle yet stay full-name only, so a preset
    never promises a value crombolo can't give back.
  - (c) every editor the back office offers. That includes the six whose values
    crombolo doesn't handle, so a preset would promise more than a page gives.

  **Decided 2026-11-15: (c),** with a naming rule: **no short name carries an
  `Umbraco` or `Umb` prefix.** A short name is the editor's own name, in lower case
  with dashes, with any `Umbraco.` or `Umb.` taken off (`Umbraco.ColorPicker` →
  `color-picker`), shortened where the plan's table does. A test fails a preset
  whose name starts with `umbraco` or `umb`. The six editors crombolo has no value
  handling for get presets too, and a template receives their values as stored
  text until value handling for them is built.
- **D3: what a Markdown value is on a page.**
  - (a) its text, as today. A template converts it if it wants HTML.
    *Recommended:* this story is about making data types. Changing what
    templates and the Delivery API receive would change the output of every
    site that already has a Markdown property.
  - (b) HTML, as Umbraco's value converter gives, with `marked` (already a
    dependency of the repo) in `@crombolo/core`. Matches Umbraco, but it is a
    rendering change for existing sites, and wants its own release note and an
    upgrade note.

  **Decided 2026-11-15: (b).** A Markdown value reaches a template and the Delivery
  API as HTML, as Umbraco's does. Step 5a builds it.

## Plan

1. **The editor table** (D1 (a)):
   - `scripts/editors-table.ts` reads `packages/backoffice-dist/dist/packages/**/manifests.js`
     and the schema manifests beside them, and writes
     `packages/schema/src/editors.gen.ts`: for each schema, its default UI, its
     settings and `defaultData`; for each UI, its schema, label, settings and
     `defaultData`;
   - `bun run editors:table` runs it, and the README's tool chain table names it.
2. **Presets** in `presets.ts`. Each starts its config from the table's
   `defaultData` for its schema and UI, then applies its flags:

   | Preset | Editor / UI | Flags |
   | --- | --- | --- |
   | `tags` | `Umbraco.Tags` | `--group <name>` |
   | `color-picker` | `Umbraco.ColorPicker` | `--color <hex>[=<label>]…` (`items`, `useLabel` when any has a label) |
   | `eye-dropper` | `Umbraco.ColorPicker.EyeDropper` | `--alpha`, `--palette` |
   | `slider` | `Umbraco.Slider` | `--min`, `--max`, `--step`, `--range` |
   | `multi-url-picker` | `Umbraco.MultiUrlPicker` | `--min`, `--max` (`minNumber`, `maxNumber`) |
   | `upload` | `Umbraco.UploadField` | `--extension <ext>…` |
   | `image-cropper` | `Umbraco.ImageCropper` | `--crop <alias>:<width>x<height>…` |
   | `markdown` | `Umbraco.MarkdownEditor` | `--preview` |
   | `code` | `Umbraco.Plain.String` / `CodeEditor` | `--language <name>` |
   | `email` | `Umbraco.EmailAddress` | none |
   | `checkbox-list` | `Umbraco.CheckBoxList` | `--option <value>…` |
   | `radio-list` | `Umbraco.RadioButtonList` | `--option <value>…` |
   | `member-picker` | `Umbraco.MemberPicker` | none |
   | `document-picker` | `Umbraco.ContentPicker` / `DocumentPicker` | `--allow <alias>…` |
   | `decimal` | `Umbraco.Decimal` | `--min`, `--max`, `--step` |
   | `label` | `Umbraco.Label` | `--value-type <string\|number\|date\|time\|decimal…>` |
   | `multiple-text` | `Umbraco.MultipleTextstring` | `--min`, `--max` |
   | `date-with-zone` | `Umbraco.DateTimeWithTimeZone` | none |
   | `date-only` | `Umbraco.DateOnly` | none |
   | `time-only` | `Umbraco.TimeOnly` | none |
   | `date-time` | `Umbraco.DateTimeUnspecified` | none |
   | `member-group-picker` | `Umbraco.MemberGroupPicker` | none |
   | `user-picker` | `Umbraco.UserPicker` | none |
   | `entity-data-picker` | `Umbraco.EntityDataPicker` | settings by `--set` |

   The last six editors' full names are checked against the generated table when
   this is built, and corrected here if the client names them differently. With
   D2 (c), every editor the back office offers has a preset, so `--editor <full
   name>` (step 3) is left for an editor a bundle adds.

   - `content-picker` gains `--of pages|media|members` (`startNode.type`), and
     `--allow` then names types of that kind, as `CONFIG_REFERENCES` already reads
     them;
   - a flag's config name and range come from the table, so `--step 0.5` on a
     slider and `--extension` on an upload match what the data type editor shows;
   - `presetFor` in `edit.ts` matches on `editor` and `editorUi`, so `types
     update` gives each one its named settings.
3. **`--editor <full name>`**:
   - `--editor` loses its oclif `options`. `presetDataType` takes a preset name, an
     editor's full name or a UI's full name (`Umb.PropertyEditorUi.CodeEditor`);
   - a full name with a preset is that preset, so both ways write the same file;
   - any other known name is written with its default UI and the table's
     `defaultData`, and its settings come from `--set` (now on `types new` too,
     through `parseSet`);
   - an unknown name is refused, naming the closest editors, and `types editors
     --all` lists every editor the back office offers, preset or not.
4. **Flags.** `--min`, `--max` and `--step` become number flags. A preset that
   takes only whole numbers (`number`, a picker's counts) refuses a fraction,
   naming the flag.
5a. **Markdown as HTML** (with D3 (b)):
   - `toPublishedValue` (`packages/core/src/property-values.ts`) converts a
     `Umbraco.MarkdownEditor` value with `marked`, GitHub-flavoured, as Umbraco's
     converter does. `marked` moves from the root's dependencies into
     `@crombolo/core`'s, since a published package needs it. It is already the
     repo's, so nothing new comes in;
   - `render` gives it as HTML a template writes without escaping, as rich text is.
     Like rich text, it is the editors' own markup and isn't sanitised, which
     `docs/rendering.md` says;
   - the Delivery API (`api-delivery/src/output.ts`) gives the HTML as a string, as
     Umbraco's does, and `generate --delivery` types it as `string`;
   - search's text (`valueText`) still reads the Markdown, not the HTML, so
     nothing changes in what search finds;
   - a template that already converted the text itself now gets HTML, so the
     release notes carry an **upgrade note**: a site that runs Markdown through a
     converter in its template removes that, or it converts twice. Nothing in this
     repo's sites does (`demo/`, `sites/`, the templates), which the change checks.
5. **Model types** in `generate.ts`:
   - `string` for Markdown, as HTML, code, e-mail and the eye dropper;
   - `number` for the decimal;
   - `number | { from: number; to: number }` for the slider, as its range is set;
   - `{ value: string; label: string } | null` for the colour picker;
   - the image cropper's and member picker's types as `render` gives them.
6. **Docs.**
   - `docs/schema-as-code.md`, the preset table: every new preset and its flags,
     full names, and `--set` on `types new`;
   - `docs/building-a-site-from-the-cli.md` if its example list names presets;
   - the README for the editor table script;
   - `bun run cli:spec`;
   - `docs/rendering.md`: a Markdown property gives HTML;
   - the release notes under Unreleased, with the Markdown upgrade note.
7. **Tests.**
   - `tests/schema-scaffold.test.ts`, "data types by preset": each new preset's
     config, with and without flags, and a full name with and without a preset.
   - `tests/markdown-value.test.ts`: a Markdown value rendered by a template and
     given by the Delivery API as HTML, headings, lists, links and code included;
     an empty value as nothing; search still finding its words.
   - `tests/editors-table.test.ts`:
     - the generated table matches the vendored manifests;
     - every preset's editor and UI are in it, every setting a preset writes
       is one the back office has, and every one of its `defaultData` is
       present. This stands in for opening each in the data type editor.
     - every editor the back office offers has a preset (D2 (c)), and no preset's
       name starts with `umbraco` or `umb`;
   - `tests/data-type-presets.test.ts`, for each preset through the CLI:
     - `types new data-type` and then `types show` reading it back;
     - the file re-read and re-written unchanged;
     - the same file from the full name with `--set`;
     - a property of that type on a page, its value saved through the
       Management API and rendered, as `every-editor.test.ts` does.
   - `tests/data-types-edit.test.ts`: `types update` with a new preset's named
     settings, and `types editors` listing them.
   - `tests/value-converters.test.ts` (or the generate tests beside it): the new
     model types.
   - SQLite only: no table or column changes, and data types go through the
     schema sync that exists.
   - No browser tests: the manifest check covers the data type editor, and the
     back office is unchanged.

## Acceptance criteria

- [ ] Each of those editors is a preset, with a short name, its editor and UI, and
      flags for the settings a person sets most, so `types editors` lists it.
      The document picker (`Umbraco.ContentPicker`) is one of them. The
      multi-node tree picker is the `content-picker` preset already, which gains
      a choice of pages, media or members
- [ ] `--editor` also takes an editor's full name (`Umbraco.ColorPicker`) for anything
      with no preset, the settings then given with `--set`. A full name that has a
      preset uses it
- [ ] A data type made either way reads back the same through `types show`, writes the
      same file, and opens in the back office's data type editor without changes
- [ ] Tests for each preset: made, shown, round-tripped through its file, and its
      value saved and rendered on a page
- [ ] The CLI reference regenerated
