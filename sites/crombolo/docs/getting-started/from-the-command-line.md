---
title: A site from the command line
summary: From an empty folder to a running Crombolo site in a few minutes, signed in to the back office, then on to your own pages, forms, approvals and shipping.
order: 1
walkthrough: true
choice: Database: SQLite, Postgres
---

In a few minutes you will go from an empty folder to a running Crombolo site: a home page served on your own computer, and a back office where you and your editors write and publish content. Every step is a command you can copy and paste. The site keeps its content in SQLite, which needs nothing installed beyond [Bun](https://bun.sh), or in Postgres if you'd rather: pick one at the start.

The first part ends with the site running and you signed in. After that, carry on to shape your own pages with blocks and views, then to the advanced part: a contact form, an editors' group, an approval workflow, a webhook, and the whole site shipped to another server. Everything you set up is kept in files, so it goes into version control with the rest of your code.

## Before you start

### Check your system

Crombolo runs on macOS and Linux, and on Windows through WSL 2, so on Windows open a WSL terminal and run every step there.

```sh
uname -s
```

> You'll see `Darwin` on a Mac, or `Linux` on Linux and in WSL.

> **On Windows without WSL?** Run `wsl --install` in PowerShell as an administrator, restart, then open the Ubuntu terminal it adds.

### Check Bun

Check that Bun 1.3 or later is installed, as it runs the site and its command line.

```sh
bun --version
```

> You'll see a version such as `1.3.4`.

> **Not found, or older than 1.3?** Install it with `curl -fsSL https://bun.sh/install | bash`, or update it with `bun upgrade`, then open a new terminal.

### Check Docker [Postgres]

Check that Docker is running, to start the database in, unless you have a Postgres server of your own.

```sh
docker info --format '{{.ServerVersion}}'
```

> You'll see Docker's version. An error saying it can't connect means Docker isn't running: start Docker Desktop, or the Docker service, and try again.

## Up and running

### Start a Postgres database [Postgres]

Start Postgres in Docker, or use your own server with a database made for the site.

```sh
docker run -d --name riverside-db -p 5432:5432 \
  -e POSTGRES_USER=crombolo -e POSTGRES_PASSWORD=crombolo \
  -e POSTGRES_DB=riverside-bakery postgres:18-alpine
```

> You'll see a long id, as Docker starts the database in the background.

### Make the site [SQLite]

Create a folder and set up a new site in it with no pages yet (`--empty`), its content kept in a file beside it.

```sh
mkdir riverside-bakery && cd riverside-bakery
bunx @crombolo/cli@latest init --name "Riverside Bakery" --empty
```

> You'll see `A site called "Riverside Bakery", on SQLite.`, then the commands to run next.

### Make the site [Postgres]

Create a folder and set up a new site in it, with its content kept in Postgres.

```sh
mkdir riverside-bakery && cd riverside-bakery
bunx @crombolo/cli@latest init --name "Riverside Bakery" --postgres --empty
```

> You'll see `A site called "Riverside Bakery", on Postgres.`, then the commands to run next. The database's address is in `.env`; change `CROMBOLO_POSTGRES_URL` there if yours is somewhere else.

### Install it

Install the site's packages.

```sh
bun install
```

> You'll see Bun install the packages. From here on, `bunx crombolo` runs your site's own command line.

### Add a type of page

Say what a page holds: this one gets a title, and a view that shows it.

```sh
bunx crombolo types new content-type page --name Page --at-root
```

> You'll see `added the content type "Page"` and `created components/page.tsx`.

### Write the home page

Make the home page and publish it.

```sh
bunx crombolo content new /Home --type page --set title=Home --publish
```

> You'll see `made /Home (Page)`, then `published`.

### Start it

Start the site.

```sh
bun start
```

> You'll see `Crombolo is running`, with the addresses of the back office and the site, and a username and password under `Sign in with`.

> **Make a note of the username and password now.** The password is made up fresh each time the site starts, and it isn't shown anywhere else.

### Welcome to Crombolo

Congratulations! Welcome to your new Crombolo site: it's up and running, and ready for content.

- **Your site:** <http://localhost:8080/> shows the home page.
- **The back office:** <http://localhost:8080/crombolo> is where you write and publish content.
- **Signing in:** open the back office and enter the username and password you noted. If you lost them, stop the site with Ctrl+C and run `bun start` again for a new password.
- **Next:** [Templates](/docs/getting-started/templates/) start a site with ready-made pages, and the [Guides](/docs/guides/) explain each part in depth.

## Your own pages

### Stop the site

Press Ctrl+C in the terminal running the site, so the next commands can change it.

> You'll see the site stop, and the prompt return.

### Make a block

Add a highlight block with a heading, as a piece that can go on any page.

```sh
bunx crombolo types new data-type shortText --editor textstring --max-chars 80
bunx crombolo types new content-type highlight --element --name Highlight --no-view
bunx crombolo types property add highlight heading --type shortText --name Heading
```

> You'll see each command say what it added: a data type, then the element type "Highlight", which gains "heading".

### Put blocks on the page

Give the page a list of blocks, and let pages sit beneath it.

```sh
bunx crombolo types new data-type pageBlocks --editor block-list --block highlight
bunx crombolo types property add page blocks --type pageBlocks --name Blocks
bunx crombolo types update page --allow-child page
```

> You'll see `The content type "Page" gains "blocks"`, then that it allows page beneath it.

### Make the views

Write a view for the block, and the types your views are checked against.

```sh
bunx crombolo components new --block highlight
bunx crombolo generate
```

> You'll see `created components/blocks/highlight.tsx`, then `wrote schema/content-types.d.ts`.

### Show the blocks

Change the two views so the page shows its blocks, and the block its heading.

```tsx components/page.tsx
import { Blocks, type PageProps } from '@crombolo/crombolo'

export default function Page({ model }: PageProps) {
  return (
    <html lang="en">
      <body>
        <h1>{model.text('title')}</h1>
        <Blocks items={model.value('blocks')} />
      </body>
    </html>
  )
}
```

```tsx components/blocks/highlight.tsx
import type { BlockProps } from '@crombolo/crombolo'
import type { Highlight } from '../../schema/content-types'

export default function HighlightBlock({ content }: BlockProps<Highlight>) {
  return <h2 class="highlight">{content.text('heading')}</h2>
}
```

> You'll see nothing yet: the views are checked when the site starts.

### Add a block and a page

Put a highlight on the home page, and add a page beneath it.

```sh
bunx crombolo content block add /Home blocks --type highlight --alias sourdough \
  --set heading="Sourdough, baked daily" --publish
bunx crombolo content new "/Home/Visit us" --type page --set title="Visit us" --publish
```

> You'll see `changed /Home blocks: a highlight block "sourdough"`, then `made /Home/Visit us (Page)`, each followed by `published`.

### See it served

Start the site again, with a new password to note.

```sh
bun start
```

> You'll see the home page at <http://localhost:8080/> with its highlight, and the new page at <http://localhost:8080/visit-us>. `bunx crombolo site show` lists everything the site holds.

## Advanced

### Add a contact form

Stop the site, then make a form and pick it on the "Visit us" page.

```sh
bunx crombolo forms new contact --name "Contact us"
bunx crombolo forms field add contact message --type long-answer --caption Message --mandatory
bunx crombolo types property add page contactForm --type formPicker --name "Contact form"
bunx crombolo content update "/Home/Visit us" --set contactForm=contact --publish
```

> You'll see `added the form "Contact us"`, the field it gains, then `saved /Home/Visit us` and `published`.

### Add an editors' group

Make a group for the people who write the site's content.

```sh
bunx crombolo users groups new editors --name Editors --section content \
  --permission content:read --permission content:publish --language all
```

> You'll see `The user group "Editors" (editors) is added.` `bunx crombolo users groups permissions` lists the other permissions a group can hold.

### Ask for approval

Have an editor approve each page before it's published.

```sh
bunx crombolo workflows new sign-off --content-type page --approver editors
```

> You'll see `added the workflow "Sign off"`. From now on, publishing a page waits for an editor to approve it.

### Send a webhook

Tell another service whenever a page is published.

```sh
bunx crombolo webhooks new published --url https://example.test/hook --event content-published
```

> You'll see `added the webhook "published"`. `bunx crombolo webhooks events` lists the other events.

### Package the site

Export the pages as files, and build the whole site into a bundle.

```sh
bunx crombolo content export --root /Home
bunx crombolo site build . --out ../bakery-bundle
```

> You'll see the pages written under `content/`, the version raised to `1.1.0`, then `wrote ../bakery-bundle`, signed by this site's own key.

### Ship it

Make a second site, have it trust the site that signed the bundle (a new site trusts only itself), and start it from the bundle.

```sh
mkdir ../bakery-copy && cd ../bakery-copy
bunx @crombolo/cli@latest init --name "Riverside Bakery" --empty
bun install
bunx crombolo keys trust "Riverside Bakery" --bundle ../bakery-bundle --site
bunx crombolo start --bundle ../bakery-bundle --publish --replace-files
```

> You'll see the same pages served from the new site. To replace a whole environment instead, see [Remotes](/docs/guides/remotes/) and [Deploying](/docs/guides/deploying/).

### What you built

Everything you set up is in three folders, ready to commit.

```text
schema/        the site's definitions: types, forms, groups, workflows, webhooks
components/    its views
content/       its pages, exported as files
```

> You'll see each change in a review like any other code. Editing a file by hand works too: it's checked and applied just as a command's change is.
