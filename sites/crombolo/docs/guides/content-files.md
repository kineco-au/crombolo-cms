---
title: Content files
summary: Write a site's starting pages, Library elements and media as files, and apply them from the command line.
order: 3
---

A site's content files are its starting content kept in the repository: pages, Library elements and media, written as small TOML files under `content/`. `crombolo bundle apply` turns them into content. A fresh clone plus one command is a populated site, and content that belongs with the code, such as legal pages or a docs section, is reviewed like the code is.

The back office is still where content is edited. The files are where it is declared.

## A page

Each page is a file named for its URL segment, under `content/pages/`. Its children go in a folder of the same name:

```
content/pages/home.toml
content/pages/home/about.toml
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

- **Rich text:** Markdown. Links to `/paths` in the files become links to those pages.
- **Content pickers:** a path such as `/home/about`.
- **Media pickers:** a path under `content/media/`.
- **Element pickers:** a path under `content/library/`.
- **Blocks:** `[{ type = "card", values = { heading = "One" } }]`.
- **Tags, dates, numbers and toggles:** as TOML writes them.

For another culture, add a `[values.fr-FR]` table and give `name` per culture.

## Media

Put the files under `content/media/`, in the folders they should sit in. Each file becomes a media item of the type its extension implies. A sidecar file beside it, `photo.jpg.toml`, can give its name and focal point.

## Commands

```bash
crombolo bundle build --check            # every problem, with its file and line
crombolo bundle apply --dry-run          # what applying would change
crombolo bundle apply --publish          # apply it, and publish it
crombolo bundle export --source --all    # content files from everything already in a site
crombolo start --bundle .                # apply it before serving, once for each change
```

With no bundle named, or with `.`, `bundle apply` applies this site's own content files. Name a bundle instead, and it applies that.

A site made before the `content/` folder had its files under `seed/`. Move them with `git mv seed content && git mv content/content content/pages`.

## Applying again

Applying unchanged files changes nothing. Change a file and apply again, and that change is taken.

An edit made in the back office since the last apply is kept, not overwritten. Only when the same thing changed in both places does `bundle apply` stop and ask, and `--resolve` answers it.

Every apply is a run that `crombolo bundle revert <run>` undoes. `crombolo bundle runs` lists them.

## A whole site as one bundle

`crombolo bundle build` turns a site directory into a bundle carrying its schema, views, styles and content files. A bare site becomes that site with `start --bundle`. This is how the demos start:

```bash
crombolo init --name "Harbourstone"
crombolo bundle build --template demo/harbourstone --out ./harbourstone-bundle
crombolo start --bundle ./harbourstone-bundle --publish
```
