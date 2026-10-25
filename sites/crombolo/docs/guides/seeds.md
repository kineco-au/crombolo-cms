---
title: Seed files
summary: Write a site's starting pages, Library elements and media as files, and apply them from the command line.
order: 3
---

A seed is a site's starting content kept in the repository: pages, Library elements and media, written as small TOML files. `crombolo seed apply` turns them into content. A fresh clone plus one command is a populated site, and content that belongs with the code, such as legal pages or a docs section, is reviewed like the code is.

The back office is still where content is edited. A seed is where it is declared.

## A page

Each page is a file named for its URL segment, under `seed/content/`. Its children go in a folder of the same name:

```
seed/content/home.toml
seed/content/home/about.toml
```

```toml
type = "page"
name = "Home"

[values]
title = "Welcome"
body = "Read [about us](/home/about)."
```

`type` is the content type. `name` is optional and comes from the file name otherwise. `order` sorts siblings, and `published = false` keeps a page a draft.

## Values

Give each value by its property alias, in the form it reads most naturally:

- **Rich text:** Markdown. Links to `/paths` in the seed become links to those pages.
- **Content pickers:** a path such as `/home/about`.
- **Media pickers:** a path under `seed/media/`.
- **Element pickers:** a path under `seed/library/`.
- **Blocks:** `[{ type = "card", values = { heading = "One" } }]`.
- **Tags, dates, numbers and toggles:** as TOML writes them.

For another culture, add a `[values.fr-FR]` table and give `name` per culture.

## Media

Put the files under `seed/media/`, in the folders they should sit in. Each file becomes a media item of the type its extension implies. A sidecar file beside it, `photo.jpg.toml`, can give its name and focal point.

## Commands

```bash
crombolo seed check            # every problem, with its file and line
crombolo seed apply --dry-run  # what applying would change
crombolo seed apply --publish  # apply it, and publish it
crombolo seed export --all     # seed files from everything already in a site
crombolo start --seed          # apply it before serving, once for each change
```

## Applying again

Applying an unchanged seed changes nothing. Change a file and apply again, and that change is taken.

An edit made in the back office since the last apply is kept, not overwritten. Only when the same thing changed in both places does `seed apply` stop and ask, and `--resolve` answers it.

Every apply is a run that `crombolo content revert <run>` undoes.

## A whole site as one bundle

`crombolo bundle build` turns a site directory into a bundle carrying its schema, views, styles and seed. A bare site becomes that site with `start --bundle`. This is how the demos start:

```bash
crombolo init --name "Harbourstone"
crombolo bundle build --template demo/harbourstone --out ./harbourstone-bundle
crombolo start --bundle ./harbourstone-bundle --publish
```
