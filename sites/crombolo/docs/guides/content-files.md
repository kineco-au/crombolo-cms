---
title: Content files
summary: Write a site's starting pages, Library elements and media as files, and apply them from the command line.
order: 5
---

A site's content files are its starting content kept in the repository: pages, Library elements and media, written as small TOML files under `content/`. `crombolo site apply` turns them into content. A fresh clone plus one command is a populated site, and content that belongs with the code, such as legal pages or a docs section, is reviewed like the code is.

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
- **Blocks:** `[{ type = "card", values = { heading = "One" } }]`. Give a block an `alias = "hero"` to name it by: unique within its list, it is what a view's `byAlias` and `crombolo content block` find it by.
- **Tags, dates, numbers and toggles:** as TOML writes them.

For another culture, add a `[values.fr-FR]` table and give `name` per culture.

## Media

Put the files under `content/media/`, in the folders they should sit in. Each file becomes a media item of the type its extension implies. A sidecar file beside it, `photo.jpg.toml`, can give its name and focal point.

## Commands

```bash
crombolo site build --check            # every problem, with its file and line
crombolo site apply --dry-run          # what applying would change
crombolo site apply --publish          # apply it, and publish it
crombolo content export --all    # content files from everything already in a site
crombolo start --bundle .                # apply it before serving, once for each change
```

With no bundle named, or with `.`, `site apply` applies this site's own content files. Name a bundle instead, and it applies that.

A site made before the `content/` folder had its files under `seed/`. Move them with `git mv seed content && git mv content/content content/pages`.

## Pages from the command line

The same shorthand makes and changes pages without a file. These commands write to the site's database as the back office does, so a page made this way is edited in the back office like any other:

```bash
crombolo content new "/Home/Visit us" --type contentPage --set title="Visit us" --set body="Open from **7am**."
crombolo content update "/Home/Visit us" --set-file body=visit.md --publish
crombolo content block add /Home blocks --type highlight --alias sourdough --set heading=Sourdough
crombolo content block update /Home blocks sourdough --set detail="Three days from starter to loaf."
crombolo content block move /Home blocks sourdough --first
crombolo content show /Home                     # its values, and its blocks with their aliases and keys
```

A page made by `content new` has the key a content file at its path would, so the same command makes the same page in every environment. `crombolo content export --root /Home` writes pages made this way out as content files, to ship with the site.

## Applying again

Applying unchanged files changes nothing. Change a file and apply again, and that change is taken.

An edit made in the back office since the last apply is kept, not overwritten. Only when the same thing changed in both places does `site apply` stop and ask, and `--resolve` answers it.

Every apply is a run that `crombolo site revert <run>` undoes. `crombolo site runs` lists them.

## A whole site as one bundle

`crombolo site build` turns a site directory into a bundle carrying its schema, views, styles and content files. A bare site becomes that site with `start --bundle`. This is how the demos start:

```bash
crombolo init --name "Harbourstone"
crombolo site build --template demo/harbourstone --out ./harbourstone-bundle
crombolo start --bundle ./harbourstone-bundle --publish
```
