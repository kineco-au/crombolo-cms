# Building a site from the command line

A worked example: a small bakery site, from an empty directory to pages served
with their blocks, a contact form, an editors' group, an approval workflow and
a bundle to deploy. It uses the CLI alone wherever the CLI can do the job. The
gaps are marked, each with the story that closes it.

The walk was run against 0.46.0 (unreleased) on 2026-11-03, on SQLite. Every
command shown ran as written, with two exceptions:
- `remote add` and `push` in step 8, now `profile add` and `push --to` (story 352);
- steps 2, 4 and 5, rewritten since for stories 253 to 255. The flow they
  describe is run end to end by `tests/integration/cli-site.integration.ts`.

The output quoted is what came back.

## 1. An empty site

```sh
mkdir riverside-bakery && cd riverside-bakery
bunx crombolo init --name "Riverside Bakery" --empty
bun install
```

`init --empty` writes the site's config, `server.ts`, an empty `components/` and
`actions/`, and the definitions every site starts with. Without `--empty`, a
new site also gets a Content Page type, its template and a welcome page
(story 341); this walk builds its own. It names `schema/`
once, as what to commit, and lists the commands to run next (story 252). A
SQLite database is created the first time a command needs one.

## 2. The types

First the data types: a short text, and a block list that offers a
"highlight" block. The block is an element type, so it comes before the list
that offers it. A new element type starts with no properties, and outside the
Library (`--title` and `--library` would add them).

```sh
bunx crombolo types new data-type shortText --editor textstring --max-chars 80

bunx crombolo types new content-type highlight --element --name Highlight --no-view
bunx crombolo types property add highlight heading --type shortText --name Heading
bunx crombolo types property add highlight detail --type textarea --name Detail

bunx crombolo types new data-type pageBlocks --editor block-list --block highlight
```

Then the pages. A content page has a title, a body and blocks. The home page is
composed of it, so it has the same properties, and it may sit at the root.

```sh
bunx crombolo types new content-type contentPage --name "Content page"
bunx crombolo types property update contentPage title --type shortText
bunx crombolo types property add contentPage body --type richtext --name Body
bunx crombolo types property add contentPage blocks --type pageBlocks --name Blocks
bunx crombolo types update contentPage --allow-child contentPage

bunx crombolo types new content-type homePage --name "Home page" --at-root \
  --compose contentPage --allow-child contentPage
```

The home page gets no `title` of its own: it takes the content page's, and a
property of its own with the same alias would be refused (story 255).

Each command is checked against the site, then applied at once:

```
  The content type "Content page" gains "body" (richtext) in the tab "Content".
  schema   applied 1.0.0: created 0 type(s), 1 property, 0 data type(s), 0 language(s)
```

`bunx crombolo types list` and `bunx crombolo types show contentPage` show the
result, and `bunx crombolo site show` shows the whole site (story 252).
`types show homePage` lists the properties it takes from the content page, each
marked `from contentPage`.

## 3. Views

Views are code, and are written as code. `types new` writes a starting view for
each page type, and `components new --block` writes one for a block:

```sh
bunx crombolo components new --block highlight
bunx crombolo generate        # the model types the views are checked against
```

`components/homePage.tsx` was then changed to render the body and blocks:

```tsx
import { Blocks, type PageProps } from '@crombolo/crombolo'

export default function HomePage({ model }: PageProps) {
  return (
    <html lang="en">
      <body>
        <h1>{model.text('title')}</h1>
        {model.html('body')}
        <Blocks items={model.value('blocks')} />
      </body>
    </html>
  )
}
```

[`writing-components.md`](writing-components.md) covers views in full. Renaming
a type or property later (`types rename`, `types property rename
--everywhere`) changes the views that name it as well (story 250).

## 4. A form, a group and a workflow

```sh
bunx crombolo forms new contact --name "Contact us"
bunx crombolo forms field add contact message --type long-answer --caption Message --mandatory
bunx crombolo forms workflow add contact --type send-email --name "Tell the team" \
  --to hello@riverside.example --subject "New enquiry"
bunx crombolo types property add contentPage contactForm --type formPicker --name "Contact form"

bunx crombolo users groups new editors --name Editors --section content --section media \
  --permission content:read --permission content:update \
  --permission content:publish --language all

bunx crombolo workflows new homepage-sign-off --content-type homePage --approver editors
```

A form picked on a page is rendered with `<Form>` ([`forms.md`](forms.md)).

`crombolo users groups permissions`, `users groups sections` and
`webhooks events` list the names these take, each with a line on what it
allows. Permissions are named `area:action`, since pages, Library items, media
and forms each have their own Read and Publish (story 254).

## 5. Pages

```sh
bunx crombolo content new /Home --type homePage \
  --set title="Riverside Bakery" --set body="Bread baked by the river since 1987."
bunx crombolo content block add /Home blocks --type highlight --alias sourdough \
  --set heading=Sourdough --set detail="Three days from starter to loaf."
bunx crombolo content new "/Home/Visit us" --type contentPage \
  --set title="Visit us" --set body="Open every day from 7am." --set contactForm=contact
bunx crombolo content show /Home
```

Values take the shorthand content files use: Markdown for rich text, a path
for a picked page. A block is named by its alias, here `sourdough`, or by its
key. Pages are written to the site's database, as the back office writes
them. `content export --root /Home` writes them out as content files
to ship with the site (story 253).

A blueprint is a page's values saved as a starting point for new pages of its
type, as the back office offers when a page is made (story 358):

```sh
bunx crombolo content blueprint new "Landing page" --from "/Home/Visit us"
bunx crombolo content new "/Home/Spring sale" --blueprint "Landing page" \
  --set title="Spring sale"
bunx crombolo content blueprint list --type contentPage
bunx crombolo content blueprint remove "Landing page" --type contentPage --yes
```

The new page takes the blueprint's type, values and other languages, named by
its path; `--set` changes what the blueprint gives, and the page is made, and
approved, as any page is. A blueprint's name is unique within its type, and one
named for another type is refused. Making one needs Create on the page,
removing one the Settings section, and both are audited.

A Library element is made and changed by the same commands, named
`library:/<folder>/<name>`; a path with no scheme is always a page. A menu's
items are then added by its alias (story 361):

```sh
bunx crombolo content new library:/Main --type menu --set alias=main
bunx crombolo content menu add main /Home --label Home
bunx crombolo content menu add main "/Home/Visit us"
bunx crombolo content menu show main
bunx crombolo content publish library:/Main
```

`update`, `show`, `find --under library:/`, `move`, `copy`, `delete`,
`publish` and `unpublish` take a Library path too; `sort` does not, since the
Library keeps no order of its own. The folder an element goes in has to be
there already: folders are made in the back office's Library or by content
files. A menu changes the site once it is published: until then templates and
the Delivery API keep the published one. Library writes need the Library
section and are audited as the back office's are
([`rendering.md`](rendering.md), "Menus").

## 6. Published, and served

```sh
bunx crombolo content publish /Home --descendants
```

The home page is under the sign-off workflow from step 4, so the publish is
refused:

```
"Home" needs approval through "Homepage sign off" before it is published.
Send it for approval from its Workflow tab. To go ahead anyway, add --skip-approval; …
```

The CLI cannot yet send a page for approval or approve it. → story 240. The
walk went ahead with `--skip-approval`, which the audit log records:

```sh
bunx crombolo content publish /Home --descendants --skip-approval
bun start
```

`/` and `/visit-us` were both served:

```html
<!DOCTYPE html><html lang="en"><body><h1>Riverside Bakery</h1><p>Bread baked by the river since 1987.</p>
<div class="block-highlight">Three days from starter to loaf.</div>…</body></html>
```

The server listens on port 8080 unless `PORT` says otherwise. The walk ran
`PORT=4917 bun server.ts`, since 8080 was taken.

## 7. Media

```sh
bunx crombolo media import ./photos
```

```
  6 file(s) and 0 folder(s) created, 0 already here
```

Imported media goes into the site's database, not its content files. Two ways
to carry it elsewhere:
- `content export --with-media` brings it into files;
- `push` carries the whole site.

## 8. Deployed

There are two ways to deploy:

```sh
bunx crombolo site build . --out ../bakery-bundle
#   wrote    ../bakery-bundle  (riverside-bakery: 2 node(s), with its schema and views)

bunx crombolo profile add live https://riverside.example
bunx crombolo push --to live --dry-run
```

- **A bundle** carries the schema, the views and the content files (export the
  pages made by command first, with `content export`), and
  installs into another site (`crombolo start --bundle … --publish`, or
  `site apply`). It is signed with this site's key, and the other site applies it
  once it trusts that key: `crombolo keys trust <name> --bundle … --site`
  (story 316).
- **`push`** replaces a remote environment with this site
  ([`remotes`](../sites/crombolo/docs/guides/remotes.md)).

The walk built the bundle. It did not push, since there was no remote to push
to.

## On a production site

The walk ran in development, where commands need no sign-in (`CROMBOLO_CLI_ACCESS` is
`open`). With `NODE_ENV=production` it is `sign-in`, and every step from 2 on needs someone
signed in. Start the site and sign in through it, once:

```sh
bunx crombolo start          # in another terminal
bunx crombolo login          # approve the code in the back office
#   signed in to Riverside Bakery as Administrator
bunx crombolo whoami
```

The steps then run as that person, with the server stopped too, while the sign-in lasts:
the audit log names them, and their groups decide what they may do. `crombolo logout`
ends it. A pipeline that runs these commands with nobody there needs a personal access
token (story 351). `docs/operations.md`, "Signing in from the command line".

## The gaps, in one place

| Gap | Story |
|---|---|
| Sending a page for approval, approving and rejecting it | 240 |
