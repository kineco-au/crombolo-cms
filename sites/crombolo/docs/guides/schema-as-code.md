---
title: Content types
summary: Build and change the content model from the command line — types, their properties, compositions, data types, languages — and how a change is checked, applied and shipped.
order: 2
---

The content model is the site's types: what a page, a block, a media item or a member holds. You build it with the `types` commands, each checked against the site before anything changes and applied at once. It is kept as files under `schema/` that you commit, so a change to the model is a diff you can review, and every environment runs the model its deploy carries.

## What lives where

The rule is one question: what changes it?

| Changes with | Kept in | Examples |
| --- | --- | --- |
| a deploy | the site's files | types, data types, languages, forms, groups, workflows, views, `crombolo.config.ts` |
| editing | the database | pages, media, members, users, the dictionary |
| an environment | the database | domains and hostnames, which differ between staging and production |

## Seeing what a site has

```sh
bunx crombolo site show                  # the whole site in one place
bunx crombolo types list                 # every content, element, media, member and data type
bunx crombolo types list --kind data --own
bunx crombolo types show article         # its settings, tabs, properties, and what uses it
bunx crombolo types show pageBlocks      # a data type: its editor, settings, blocks and the properties using it
```

`types show` lists what uses a type: the types that allow it as a child or are composed of it, the block lists it is a block in, the pickers that allow it, the site's content files of it and the views that read it. A composed type lists the properties it takes from each composition, marked with where they come from. When the site has a database, each type also says how many items use it and whether it is applied. An alias two kinds share, such as a content type and a data type, is named with `--kind`. Both take `-o json`.

## A new type

```sh
bunx crombolo types new content-type article --name Article --at-root
bunx crombolo types new content-type feature --element --name Feature
bunx crombolo types new content-type landingPage --compose article --allow-child article
bunx crombolo types new media-type brochure
```

A content type starts with a mandatory title, and a view at `components/article.tsx` (`--no-view` leaves the view out). A type composed of one that has a title takes that one instead, and `--no-title` starts any type without. An element type, the kind blocks are made of, starts empty and has no view, since it has no page; `--title` and `--library` give it a title and offer it in the Library.

A content type also takes `--allow-child`, `--vary-by-culture`, `--vary-by-segment` and `--list-view`.

## Properties and tabs

```sh
bunx crombolo types property add article summary --type textarea --tab Content
bunx crombolo types property update article title --name Headline --mandatory
bunx crombolo types property move article summary --before body
bunx crombolo types property remove article subtitle      # its values are kept until `types purge`
bunx crombolo types tab add article SEO --after Content
bunx crombolo types tab rename article Extras More
bunx crombolo types tab remove article More --move-to Content
```

A property's `--type` is a data type. The common ones are built in: `textstring`, `textarea`, `richtext`, `numeric`, `trueFalse`, `datePicker`, `contentPicker`, `imageMediaPicker`, `tags`, `formPicker` and more. Your own come from `types new data-type`.

## Compositions

A composition shares properties between types: a type composed of `seoFields` has its properties as its own.

```sh
bunx crombolo types update article --compose seoFields
bunx crombolo types show article
```

A property whose alias a composition already has is refused, wherever it comes from: a command, a hand edit or a deploy. A page would otherwise carry two values under one name, and a view could not tell which it reads. The refusal names the command that takes the extra one away.

## Changing a type

```sh
bunx crombolo types update article --name "News story" --allow-child quote
bunx crombolo types update article --no-at-root
bunx crombolo types remove oldBanner                      # refused while pages use it; --retire keeps them
```

Each change is checked against the site first. A type, data type or view it names has to exist, and a change the content cannot take, such as a data type its stored values do not convert to, is refused with the reason and nothing written. Then it is applied at once. `--dry-run` says what would change and changes nothing; asking for what is already so changes nothing and says so. `--no-` turns a setting off.

## Data types

A data type is an editor with its settings:

```sh
bunx crombolo types editors                               # the editors, and the settings each takes
bunx crombolo types new data-type shortText --editor textstring --max-chars 80
bunx crombolo types new data-type pageBlocks --editor block-list --block feature
bunx crombolo types update pageBlocks --add-block quote --block-label Quote
bunx crombolo types update articlePicker --allow article --start-at /Home/News
bunx crombolo types update gallery --set multiple=true --set 'validationLimit={"max":12}'
bunx crombolo types remove shortText                      # refused while a property uses it
```

`--editor` is one of `textstring`, `textarea`, `rich-text`, `number`, `toggle`, `date`, `dropdown`, `content-picker`, `media-picker`, `element-picker`, `block-list` or `block-grid`. `--set` stores any setting by name, read as JSON when it parses. The data types every site has built in are not changed: make the site's own with `types new data-type` and use that.

## Renaming

```sh
bunx crombolo types rename newsItem article                     # a type; its pages keep their content
bunx crombolo types property rename article subtitle standfirst # a property; its values stay with it
bunx crombolo types rename shortText headline --kind data       # a data type
bunx crombolo types rename newsItem article --everywhere --dry-run
```

A rename changes the alias and nothing else, so what is made of it stays. While anything else names the old alias, the rename is refused and each place is listed: other types, block lists, pickers, workflows, webhooks, content files and views. `--everywhere` renames it in all of them as one step. A view is changed only where it plainly names the alias, such as `model.text('subtitle')`; anywhere else, it is pointed out for you to look at.

## Languages and addresses

```sh
bunx crombolo languages list
bunx crombolo languages add de-DE --fallback en-US
bunx crombolo languages update fr-FR --name Français --mandatory
bunx crombolo languages update fr-FR --default
bunx crombolo languages remove de-DE                     # refused while any page has a version in it

bunx crombolo site urls --show-top-level    # /home/about rather than /about
bunx crombolo site urls --hide-top-level    # the default
```

A site always has one default language, which is never removed. A language another falls back to is not removed until that changes.

Forms, user groups, approval workflows and webhooks are built the same way: see [Forms](/docs/guides/forms/) and [Users and groups](/docs/guides/users-and-groups/).

## How a change reaches the database

On your machine, each command applies its change at once. When the site starts, it compares its definitions with what the database has and applies the difference:

- **In development** any change is applied, and the files are watched, so a change takes effect without a restart.
- **In production** a change is applied only when the definitions' version has gone up, or a newer `CROMBOLO_SCHEMA_REVISION` is deployed. The same version with different definitions is refused.

`bundle build` and `push` raise the version for you when the definitions have changed since it was first applied, so a production site takes what they ship ([Deploying](/docs/guides/deploying/)). `CROMBOLO_SCHEMA_REVISION` orders deploys from a pipeline: set it to the build number, and each deploy is newer than the last.

A site of several nodes is safe during a rolling deploy. The apply runs under a lock, a node whose definitions are older than the database never writes to it, and an older node keeps serving pages until it is replaced. To apply as a pipeline step rather than at start-up, set `CROMBOLO_SYNC_SCHEMA_AT_BOOT=false` and run `bunx crombolo types sync`.

### Removing things

Removing a property retires it: its values stay in the database, out of sight, and putting the property back brings them back. To delete retired properties and their values for good:

```sh
bunx crombolo types purge --older-than 90
```

Removing a type that still has pages is refused, because hiding pages is a content decision; `types remove --retire` retires it, and its pages stay where they are.

## Checking in CI

```sh
bunx crombolo types check --static   # the definitions alone: every alias found, no clashes
bunx crombolo types check            # and what applying them would do to this database
```

`--static` needs no database, so it belongs on every pull request. `types check` names each problem by its type and property, with the command that fixes it, and exits with code 20 when it finds problems and 21 when something needs a person to decide. The full list is in the [exit codes](/docs/reference/exit-codes/).

## Typed views

```sh
bunx crombolo generate
```

`generate` writes an interface for each content type with every property it has, compositions included. Name one in `PageProps` and the view is typed:

```tsx
import type { PageProps } from '@crombolo/crombolo'
import type { Article } from '../../schema/content-types'

export default function ArticlePage({ model }: PageProps<Article>) {
  return <h1>{model.text('title')}</h1>
}
```

A misspelt property is now a compile error, which `crombolo components check` reports in CI. Run `generate` again whenever a type changes, and commit what it writes.

## The files

The definitions are kept under `schema/`, one per file, and that folder is what you commit:

```text
schema/
├── schema.toml              the definitions' version, and how page addresses are built
├── content-types/
├── media-types/
├── member-types/
├── data-types/
├── forms/
├── workflows/
├── user-groups/
├── webhooks/
└── languages.toml
```

You never need to open them, but you may. A file edited by hand is read, checked and applied exactly as a command's change is, and the commands then work on it. A content type looks like this:

```toml
[content-type]
alias = "article"
name = "Article"
allow-at-root = true
compositions = ["seoFields"]
components = ["article"]
default-component = "article"

[[tab]]
name = "Content"

[[tab.property]]
alias = "title"
name = "Title"
type = "textstring"
mandatory = true
```

A problem in a file that does not read at all is named by its file and line. `description` and `notes` are kept when a file is rewritten, but ordinary `#` comments are not, since the commands and the back office write these files too. The back office writes the same files in development; in production they are read-only.

For a site whose types were made in the back office before you began committing them, `types export` writes them out as files. When a release changes the file format, `types rewrite` rewrites every file in the current layout as one reviewable change.

## Where next

- [The `types` commands](/docs/reference/command-line/types/), with every flag.
- [Deploying](/docs/guides/deploying/): how a change reaches production.
