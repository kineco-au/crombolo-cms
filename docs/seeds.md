# Seed files

A site's starting content as files in the repository (story 163): its pages,
its Library elements and its media, written by a person, compiled into the
bundle format and applied through the import. A clone and one command give a
populated site, and content that belongs with the code (legal pages, a docs
section, fixtures) is reviewed and versioned with it.

The back office stays where content is edited. Seeds are how content is
declared.

## Layout

```
seed/
├── content/
│   ├── home.toml          # a page; its URL segment is the file name
│   └── home/              # the pages under it
│       ├── about.toml
│       └── contact.toml
├── library/
│   └── hero-card.toml     # a Library element (at the top level only, for now)
└── media/
    └── logos/             # a media folder
        ├── mark.png       # a media item, typed by its extension
        └── mark.png.toml  # its sidecar, optional
```

## An item

```toml
type = "page"            # the content type alias; required
name = "Home"            # or { "en-US" = "Home", "fr-FR" = "Accueil" }; default: from the file name
key = "…"                # optional: otherwise derived from the path
order = 1                # optional: siblings sort by order, then name
template = "page"        # optional: default, the type's own
published = false        # optional: everything else is published by `seed apply --publish`

[values]
title = "Welcome"

[values.fr-FR]           # values for one culture
title = "Bienvenue"
```

**Keys.** An item's key is a version 5 uuid of its kind and path
(`content/home/about`) under Crombolo's seed namespace
(`packages/server/src/seed/keys.ts`). A rebuild therefore names the same
nodes, and two sites built from one seed share keys, which is what lets
pulls and pushes match them. Renaming a file makes a new page. `seed check`
says so when a page of that name is already there under another key, and
`key = "…"` keeps the old one.

## Values

Values are given by property alias, in a shorthand for each editor:

| Editor | Shorthand | Stored as |
| --- | --- | --- |
| Text box, text area | a string | the string |
| Rich text | Markdown, or `{ html = "…" }` | `{ markup, blocks: null }`, with links to content paths as local links |
| Content picker | a content path, `/home/about` | `umb://document/<key>` |
| Media picker | a media path, or a list of them | the picker's items, with each item's type |
| Element picker | a Library path, or a list | the element keys |
| Multi-URL picker | paths, URLs, or `{ path \| url, name, target }` | the links |
| Block list and block grid | `[{ type = "<element alias>", values = {…}, settings = {…} }]` (grid: `columns`, `rows`) | layout, content data and settings data, with derived block keys |
| Tags | a list of strings | the list |
| Date | a TOML date, or an ISO 8601 string | an ISO 8601 string |
| Toggle | `true` or `false` | the boolean |
| Number | a number | the number |

- **A path** names a seed item by its path (`/home/about`), or a page already
  on the site by its names. A uuid is taken as it is.
- **Any other editor** takes its value in the editor's stored shape, as does
  any value given as a table that is not one of the shorthands. `seed export`
  writes that shape.

## Media

A file under `seed/media/` becomes a media item:
- **Type:** the type its extension implies, as an upload's is.
- **Folders:** a directory becomes a Folder.
- **Sidecar:** `photo.jpg.toml` gives `name`, `type`, `key`, `order`,
  `focalPoint = { left, top }` and `[values]`.
- **The bytes** travel in the bundle. The file is stored as an import stores
  it, at `/media/<the first 8 hex of its key>/<file>`, with its width, height,
  size and extension.

## Commands

| Command | Does |
| --- | --- |
| `crombolo seed check` | checks every file against the site's schema; exits 20 with each finding as `file:line  message` |
| `crombolo seed build --out <dir>` | writes the bundle, an npm package `content import` reads |
| `crombolo seed apply [--publish] [--dry-run]` | builds it and imports it, with the import's `--resolve` flags; `--dry-run` is the import's check |
| `crombolo seed export <page>…` | writes seed files from pages already in the site |
| `crombolo start --seed` | applies the seed before the site serves, once for each change to it |

- **What `seed check` finds:** an unknown type or property, a value its
  editor cannot take, a path that names nothing, a language the site has not
  got, a type its parent does not allow, an element in the content tree or a
  page in the Library, a duplicate key, and a TOML syntax error.
- **Where it reads from:** a seed compiles against the site's database, so
  `seed check` in CI runs against a site booted from the schema.
- **Lines:** `Bun.TOML` gives no positions, so a finding's line comes from
  reading the file's tables and keys (`seed/lines.ts`).
- **A syntax error** is placed by parsing ever longer prefixes of the file.

## Applying, and applying again

`seed apply` is `content import` with the compiled bundle, so it backs up,
checks, applies in one transaction and records a run that `content revert`
undoes.

**Applying again is three-way.** The import records what it applied to each
node (`content_applied`, `content-transfer.md`, "The import"). On the next
apply:

| Since the last apply | Result |
| --- | --- |
| changed only in the seed | taken |
| changed only in the back office | kept, and reported |
| changed in both | a conflict for a person, answered with `--resolve` |
| nothing | nothing written, no new version |

Names, order and place follow the same rule.

**Identity.** A seed's bundle id is derived from its content. That is how
`start --seed` applies it once for each change: a standing run for that id
means the site already has this version.

## Where the code is

| Code | What it does |
| --- | --- |
| `packages/server/src/seed/read.ts` | walks `seed/` |
| `packages/server/src/seed/compile.ts` | checks the items and builds the bundle |
| `packages/server/src/seed/export.ts` | writes seed files from a site |
| `packages/cli/src/commands/seed/` | the commands |

The compiler is in the server rather than `@crombolo/transfer`. It reads the
site's database, uses the media port's rule for which type takes a file, and
writes through the transfer package's pure writer (`writeBundle`).

## Not yet

- **Library folders:** Library elements sit at the top of `seed/library`, and
  folders under it are reported, not read.
- **Segments:** segment variants of a value are given in the stored shape
  only.
- **Out of scope** (story 163): public access, users and members, content
  templates, and the demo sites as seeds (story 164).
