---
title: Schema as code
summary: Content types, data types and languages as TOML files in schema/, how they reach the database, and the commands that write and check them.
order: 2
---

In crombolo your content model lives in your repository. Content types, media types, member types, data types and languages are plain TOML files in the site's `schema/` folder, and the database keeps a copy of them that is brought up to date when the site starts.

That means a schema change is a diff you can review in a pull request, every environment runs the content model its deploy carries, and nothing drifts between staging and production because someone clicked a button in one of them.

## What lives where

The rule is one question: what changes it?

| Changes with | Lives in | Examples |
| --- | --- | --- |
| a deploy | files | content types, data types, languages, templates, `crombolo.config.ts` |
| editing | the database | pages, media, members, users, the dictionary |
| an environment | the database | domains and hostnames, which differ between staging and production |

## The layout

```text
schema/
├── schema.toml              the schema version
├── content-types/
│   ├── home-page.toml
│   └── article.toml
├── media-types/
├── member-types/
├── data-types/
├── forms/
└── languages.toml
```

One type per file. The file name is up to you; the `alias` inside the file is what counts, and files written by crombolo are named after it.

`schema/schema.toml` holds the version of the schema the site is at:

```toml
[schema]
version = "1.0.0"
```

## A content type

```toml
[content-type]
alias = "article"
name = "Article"
description = "A news story"
icon = "icon-document"
allow-at-root = true
compositions = ["seoFields"]
components = ["pages/article"]
default-component = "pages/article"

[[tab]]
name = "Content"

[[tab.property]]
alias = "title"
name = "Title"
type = "textstring"
mandatory = true

[[tab.property]]
alias = "summary"
name = "Summary"
type = "textarea"
default = "To follow"
```

A few things worth knowing:

- **No IDs.** A type's identity comes from its alias, and every server works out the same one, so the files need no `key` lines. A file may still carry one where the identity was made some other way, such as a type created in the back office or one from an older site. Leave it as it is: it keeps the type's pages attached.
- **`components`** names the templates a page of this type may use, by their path under `components/`. `pages/article` is `components/pages/article.tsx`.
- **`type`** on a property is a data type alias. The common ones are built in (`textstring`, `textarea`, `richtext`, `numeric`, `trueFalse`, `datePicker`, `contentPicker`, `imageMediaPicker`, `tags` and more); a file in `data-types/` adds your own or overrides one.
- **`default`** fills in a new property on pages that already exist. Without one, adding a mandatory property to a type with content leaves each page for a person to fill in.
- **Order in the file is the order in the editor.**
- **`description` and `notes`** are kept when the file is rewritten. Ordinary `#` comments are not, because the back office writes these files too; put anything you want to keep in `notes`.

An element type, the kind block editors hold, is a content type with `is-element = true`. It has no URL, so it has no template.

## A data type

A data type is an editor with its settings. Where it names the types it offers, it names them by alias:

```toml
[data-type]
alias = "tastingNotePicker"
name = "Tasting Note Picker"
editor = "Umbraco.ElementPicker"

[data-type.config]
allowedContentTypes = ["tastingNote"]
```

A block list or block grid lists its blocks as tables:

```toml
[data-type]
alias = "pageBlocks"
name = "Page blocks"
editor = "Umbraco.BlockList"

[data-type.config]
validationLimit = { min = 1 }

[[data-type.block]]
element = "feature"
label = "{{heading}}"
group = "Layout"

[[data-type.block]]
element = "quote"
group = "Layout"
```

An alias that names nothing, or a type of the wrong kind, is reported by `types check`, with the file.

## Writing files

You can write files by hand, or have the command line write them:

```sh
bunx crombolo types new content-type feature --element
bunx crombolo types new data-type pageBlocks --editor block-list --block feature
bunx crombolo types new content-type article --at-root --compose seoFields
bunx crombolo types add-property article blocks --type pageBlocks
bunx crombolo languages add fr-FR --fallback en-US
bunx crombolo forms new contact
bunx crombolo workflows new article-sign-off --content-type article
bunx crombolo webhooks new searchIndex --url https://search.example/hook --event Umbraco.ContentPublish
```

`types new` writes the type's file and a starting template at `components/article.tsx` (`--no-view` leaves the template out; `--element` writes an element type). A content type also takes `--allow-child`, `--vary-by-culture`, `--vary-by-segment`, `--library` and `--list-view`. A data type takes `--editor` and that editor's settings: `textstring`, `textarea`, `rich-text`, `number`, `toggle`, `date`, `dropdown`, `content-picker`, `media-picker`, `element-picker`, `block-list` or `block-grid`. `add-property` appends a property to a tab.

Each command refuses a name that is taken, or one that points at something the site doesn't have, before it writes anything. Then it applies the change straight away, through the same step a start runs.

The back office writes the same files. In development, saving a content type under **Settings** writes its `.toml` file, which you then commit like any other change. In production the files are read-only, and the editor says which file to change in source control.

If you have a site whose types were made in the back office before you started committing them, `types export` writes the database's types out as files. It never deletes a file.

## Applying files to the database

When the site starts, it compares `schema/` with what the database has and applies the difference:

- **In development** any change is applied, and the folder is watched, so an edit to a file takes effect without a restart.
- **In production** a change is applied only when the schema version in `schema.toml` has gone up, or a newer `CROMBOLO_SCHEMA_REVISION` is deployed. The same version with different files is refused, naming the files that differ.

`CROMBOLO_SCHEMA_REVISION` is how a pipeline orders deploys without anyone bumping the version by hand: set it to the build number, or to `git rev-list --count HEAD`, and each deploy is newer than the last. Keep the version in `schema.toml` for saying something, such as "this goes live in 2.1".

A site of several nodes is safe during a rolling deploy. The apply runs under a lock, a node whose files are older than the database never writes to it, and an older node keeps serving pages until it is replaced.

To run the apply as a pipeline step rather than at start-up, set `CROMBOLO_SYNC_SCHEMA_AT_BOOT=false` and run:

```sh
bunx crombolo types sync
```

### Removing things

Removing a property from a file retires it. Its values stay in the database, out of sight, and putting the property back brings them back. To delete retired properties and their values for good, once you are sure:

```sh
bunx crombolo types purge --older-than 90
```

`--older-than` is in days. Removing a whole content type that still has pages is refused, because hiding pages is a content decision; `types sync --force-retire-types` retires it anyway, and its pages stay where they are.

## Checking in CI

```sh
bunx crombolo types check --static   # the files alone: parse, validate, every alias found
bunx crombolo types check            # and what applying them would do to this database
```

`--static` needs no database, so it belongs on every pull request. `types check` exits with code 20 when it finds problems, and 21 when something needs a person to decide first. The full list is in the [exit codes](/docs/reference/exit-codes/).

## Typed templates

```sh
bunx crombolo generate
```

`generate` writes `schema/content-types.d.ts`, an interface for each content type with every property it has, compositions included. Name one in `PageProps` and the template is typed:

```tsx
import type { PageProps } from '@crombolo/crombolo'
import type { Article } from '../../schema/content-types'

export default function ArticlePage({ model }: PageProps<Article>) {
  return <h1>{model.text('title')}</h1>
}
```

A misspelt property name is now a compile error, which `crombolo components check` reports in CI. Commit the generated file with the schema change, and run `generate` again whenever a type changes.

## After an upgrade

When a crombolo release changes the file format, `types rewrite` rewrites every file in `schema/` in the current layout, so the change arrives as one reviewable commit.

## Where next

- [The `types` commands](/docs/reference/command-line/types/), with every flag
- [Deploying](/docs/guides/deploying/): how schema changes and upgrades reach production
