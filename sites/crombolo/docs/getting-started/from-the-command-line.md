---
title: A site from the command line
summary: Build a small bakery site with commands alone, from an empty folder to pages served, a contact form, an editors' group, an approval workflow, a webhook and a bundle to ship.
order: 1
---

This walk builds a small site for a bakery. Every step is a command, and each one is checked against the site before it changes anything. The site's definitions are kept as files under `schema/`, which you commit with the rest of the site, but you never need to open them.

The same steps run on every build of Crombolo, as a test, so what you see here is what happens.

## An empty site

```sh
mkdir riverside-bakery && cd riverside-bakery
bunx @crombolo/cli@latest init --name "Riverside Bakery"
bun install
```

`init` says what it set up and what to run next. A SQLite database is made the first time a command needs one, so there is nothing else to install.

From here on, `bunx crombolo` runs the command line the site installed.

## The types

A type says what a page or block holds. Start with the pieces: a short text, and a "highlight" block with a heading. A block is an element type, so it comes before the list that offers it. A new element type starts empty, and is not offered in the Library unless you add `--library`.

```sh
bunx crombolo types new data-type shortText --editor textstring --max-chars 80

bunx crombolo types new content-type highlight --element --name Highlight --no-view
bunx crombolo types property add highlight heading --type shortText --name Heading

bunx crombolo types new data-type pageBlocks --editor block-list --block highlight
```

Then the page. A content page starts with a mandatory title. Give it a list of blocks, and let pages sit beneath it:

```sh
bunx crombolo types new content-type contentPage --name "Content page" --at-root
bunx crombolo types property add contentPage blocks --type pageBlocks --name Blocks
bunx crombolo types update contentPage --allow-child contentPage
```

Each command is checked and applied at once, and says what it did:

```text
  The content type "Content page" gains "blocks" (pageBlocks) in the tab "Content".
  schema   applied 1.0.0: created 0 type(s), 1 property, 0 data type(s), 0 language(s)
```

`bunx crombolo types show contentPage` shows a type and what uses it. A type composed of another, with `--compose`, takes its properties and shows each one with where it comes from.

## The views

Views are code, and you write them as code. `types new` wrote `components/contentPage.tsx` for the page type. `components new` writes one for the block:

```sh
bunx crombolo components new --block highlight
bunx crombolo generate
```

`generate` writes the model types your views are checked against. Change `components/contentPage.tsx` to show the title and the blocks:

```tsx
import { Blocks, type PageProps } from '@crombolo/crombolo'

export default function ContentPage({ model }: PageProps) {
  return (
    <main>
      <h1>{model.text('title')}</h1>
      <Blocks items={model.value('blocks')} />
    </main>
  )
}
```

A view can pick one block out by its alias too: `model.value('blocks')?.byAlias('sourdough')`.

## A form, a group, a workflow and a webhook

A contact form, with a field for the message, picked on the page:

```sh
bunx crombolo forms new contact --name "Contact us"
bunx crombolo forms field add contact message --type long-answer --caption Message --mandatory
bunx crombolo types property add contentPage contactForm --type formPicker --name "Contact form"
```

A group for the people who edit the site, and a workflow that asks one of them to approve a page before it is published:

```sh
bunx crombolo users groups new editors --name Editors --section content \
  --permission content:read --permission content:publish --language all
bunx crombolo workflows new sign-off --content-type contentPage --approver editors
```

`bunx crombolo users groups permissions` lists the permissions a group can hold, and `bunx crombolo users groups sections` the sections it can open. A permission is named for its area and what it allows, such as `content:publish` or `media:update`.

A webhook, sent whenever a page is published:

```sh
bunx crombolo webhooks new published --url https://example.test/hook --event content-published
```

`bunx crombolo webhooks events` lists the events.

## The pages

Pages are written to the site's database, as the back office writes them. Values take the same shorthand content files use: Markdown for rich text, a path for a picked page.

```sh
bunx crombolo content new /Home --type contentPage --set title="Riverside Bakery"
bunx crombolo content block add /Home blocks --type highlight --alias sourdough \
  --set heading=Sourdough
bunx crombolo content new "/Home/Visit us" --type contentPage \
  --set title="Visit us" --set contactForm=contact
bunx crombolo content show /Home
```

A block is named by its alias, here `sourdough`, or by its key. `content block update`, `move` and `remove` take the same names.

The home page is under the sign-off workflow, so publishing it waits for an editor's approval. To publish it now, and have the audit log record that you did:

```sh
bunx crombolo content publish /Home --descendants --skip-approval
```

## Served

```sh
bunx crombolo site show
bun start
```

`site show` is the whole site in one place: its languages, addresses, types, forms, workflows, groups and webhooks. `bun start` serves it on <http://localhost:8080/>, with the home page at `/` and its child at `/visit-us`. The back office is at <http://localhost:8080/crombolo>, and the start prints how to sign in.

## Shipped

A bundle carries the site's definitions, views and content to another site. Pages made by command live in the database, so export them as content files first:

```sh
bunx crombolo bundle export --source --root /Home
bunx crombolo bundle build . --out ../bakery-bundle
```

When the definitions have changed since their version was first applied, `bundle build` raises the version, so a production site takes the change.

On the other site, `start` applies the bundle, then serves the same pages:

```sh
bunx crombolo start --bundle ../bakery-bundle --publish --replace-files
```

`--replace-files` lets the bundle's definitions take the place of a new site's starting ones. To replace a whole environment from here instead, use `bunx crombolo push`; see [Remotes](/docs/guides/remotes/) and [Deploying](/docs/guides/deploying/).

## What you committed

```text
schema/        the site's definitions: types, forms, groups, workflows, webhooks
components/    its views
content/       its pages, exported as content files
```

The files are readable, and a change to them shows in a review like any other code. Editing one by hand works too: it is checked, and applied, exactly as a command's change is.
