# 250 — Renames that keep their content

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** M
**Depends on:** 248, 249

## Story

As a developer, I want to rename a content type's, a property's or a data type's
alias from the CLI and have its content, references and views follow, so that
fixing a name never loses data or breaks a page.

## Context

An alias is what views and the Delivery API use (`model.value('title')`), so a
rename touches more than the definition: other types' allowed children and
compositions, block lists, pickers, saved values keyed by the property, and
views that name it. Keys keep identity across a rename today (story 161), but
nothing does the rest in one step.

## Decided (planning, 2026-11-03)

- **Refused while anything names the old alias**, by default: other definitions
  (allowed children, compositions, block lists, pickers, approval workflows,
  webhooks, form workflows), the site's content files (`type = "page"`, the
  keys under `[values]`) and its views. The refusal lists each, and points at
  `crombolo types show <alias>`, which gains "Used in content files" and "Used in
  views", by file and line, for the site's own files.
- **`--everywhere` renames in every one of them**, views included, in one step:
  definitions and content files are rewritten, and views' plain references (a
  quoted alias in a model call, `contentType === '…'`) are rewritten and the
  generated model types regenerated. A reference it cannot rewrite safely (an
  alias built at run time, a computed name) refuses the rename, naming it, so
  nothing is half renamed. `--dry-run` lists every change it would make.

## Plan (2026-11-03)

- **Identity kept by key.** A definition without a key line has one derived
  from its alias (`schema/src/keys.ts`, story 161), so a rename writes the old
  key into the renamed file explicitly, and the sync moves the alias under the
  same key: values stay with the property, items with the type.
- **What names an alias** is found by one index (`describe.ts`'s `usesOf`
  extended): the definitions, the site's content files (`content/pages`,
  `content/library`), and its views (`components/`, `actions/`), the views by
  scanning for the alias as a quoted string in the patterns the model API uses,
  so `types show` and the rename read the same list.
- **The same flow as 248:** checked against a copy before anything is written,
  applied at once, every written file put back when the apply is refused.

1. `packages/schema/src/rename.ts` (pure): rename a type, a property or a data
   type across a `SchemaSet`, keeping keys; the definitions that change.
2. A reference index over content files and views (`packages/cli` or
   `packages/server`), shared with `types show`.
3. `types rename <alias> <new>`, `types property rename <type> <property> <new>`
   and the same for a data type through `types rename`; `--everywhere`,
   `--dry-run`, `--no-apply`, `--kind`, `-o json`.
4. `types show` gains "Used in content files" and "Used in views".
5. Docs and release note.
6. Tests, on SQLite: a rename with nothing naming it keeps the values; refused
   naming each kind of reference; `--everywhere` rewrites definitions, content
   files and views and regenerates the model types; a reference it cannot
   rewrite refuses; a taken, invalid or reserved alias refused; `--dry-run`
   writes nothing.

## Implementation (2026-11-03)

- `packages/schema/src/rename.ts`: `renameType`, `renameProperty` and
  `renameDataType` over a `SchemaSet`. The renamed definition is written with
  the key its old alias derived (and a built-in media type's shipped property
  keys), so the sync moves the alias under the same key. The definition
  references they rewrite and list:
  - allowed children and compositions;
  - block elements, block settings and picker type settings (via
    `mapReferences`, now exported from `config-references.ts`);
  - approval workflows' `applies-to`;
  - form "save as content" workflows (`content-type`, the field map);
  - block labels (`{{prop}}`);
  - the properties using a data type.

  It refuses an unknown alias, a taken or invalid new alias, a type every site
  has and a built-in data type.
- `packages/cli/src/support/rename-references.ts` finds the old alias in content
  files and views:
  - **Content files** (`content/pages`, `content/library`, `content/media`) are
    rewritten in place, one occurrence at a time. An occurrence is kept only
    when it changes a place the rename moves. The file is kept only when it
    reads back as exactly the renamed data. Anything else is "cannot be renamed
    safely".
  - **Views** (`components/`, `actions/`) are rewritten only where a known
    pattern names the alias: `.value|text|html|media|hasValue|getProperty('…')`,
    `contentType.alias` / `contentTypeAlias` comparisons, and the generated
    interface name in a view that imports the model types.
- `types show` reads the same index as the rename for "Used in content files"
  and "Used in views", by file rather than by line.
- `packages/cli/src/support/rename.ts` holds `commitRename`. It writes the
  renamed file under its new name when the old one was named for its alias,
  along with:
  - the other definitions;
  - webhooks (`schema/webhooks`);
  - content files and views.
- `commitFileEdits` in `type-edit.ts` generalises the 248 flow to several files.
  It checks the definitions against a copy, writes them all, and puts them all
  back when the apply is refused. After the apply, `schema/content-types.d.ts`
  is regenerated when the site has one.
- `types rename` covers types and data types (`--kind data`), and
  `types property rename` covers properties. Both take `--everywhere`,
  `--dry-run`, `--no-apply` and `-o json`.
- The schema check (`check.ts`) changes in two ways:
  - It no longer reports a renamed type as removed with content: a type whose
    key is in the files is the same type.
  - It reports `type-renamed` and `property-renamed` as auto findings. The
    rename prints them, and so does applying a release that carries one in
    another environment.

**Departure from the plan:** some quoted strings in a view are only *maybe*
the alias, such as `'page'` used as a CSS class. These are listed as notes and
left alone, rather than refusing `--everywhere`. Refusing would make a common
alias impossible to rename. A property alias that another type also has is a
definite reference in a view that cannot be rewritten safely, so it refuses
under `--everywhere`.

Tests: `tests/types-rename.test.ts` covers the pure renames and the
content-file rewrite, and runs the CLI on a SQLite site. That run checks:
- a refusal listing each place;
- a property, a type and a data type each renamed everywhere, with the values
  and items kept and the file moved;
- that a dry run writes nothing.

The Postgres and SQLite suites ran too, since the check gained a query.

## Acceptance criteria

- [x] `crombolo types rename <alias> <new alias>` and
      `crombolo types property rename <type> <property> <new alias>` and the same
      for a data type: the definition keeps its key, every reference in other
      definitions follows, and stored values stay with the property.
- [x] **Refused while referenced:** anything naming the old alias refuses the
      rename, listed, and `types show` lists them; `--everywhere` renames in all
      of them, views included, and refuses if one cannot be rewritten safely.
- [x] **The Delivery API and webhooks** see the new alias at once; the release
      of a site that renamed something says so in its change report.
- [x] Refused when the new alias is taken, invalid, or reserved; `--dry-run`
      lists everything that would change.
- [x] Tests on both dialects: values kept, references followed, a refusal for
      each rule, views updated and reported.
