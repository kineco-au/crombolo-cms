# Release notes

What each release changed, newest first, for the people running a site. Each
release's upgrade notes say what an operator must check or do. Story numbers
point at `docs/stories/`.

## Unreleased

## v0.42.1 — 2026-10-31

v0.42.0's pipelines failed to build the back office, so it was never published;
this is it, with:

- **A fresh clone builds the back office.** The build asked git whether the
  pinned commit of the fork of Umbraco's client was present in a way that answers
  yes for any commit ID, so a clone without the fork's branches, as CI's is,
  never fetched them. It now checks for the commit itself.

## v0.42.0 — 2026-10-31

- **The back office is built from Crombolo's fork of Umbraco's client** (story
  235). Crombolo's changes to Umbraco's back office are commits on the fork's
  `umbraco/crombolo` branch, in this repository, instead of patches over
  Umbraco's built code and runtime rewrites of its internals. The plugin now
  reaches the back office only through the extension registry and the fork's
  seams (`umbCromboloHooks`), and a test holds it to that. The back office
  behaves as before. Building it from source needs Node 24 and npm 11 as well
  as Bun; a site needs neither.
- **Sites installed from npm get the back office as built.** The packaged
  back office (`@crombolo/backoffice-dist`) kept the version of the Umbraco
  release it vendors, so npm still served its first build, from 14 October,
  and none of the changes since reached a site installed from npm, such as
  Settings being left out of the section tabs. It now shares crombolo's version
  and ships with every release.
- **Page addresses, Changes, Audit log and Background jobs open again.** Each
  failed in Settings with "provideContext is not a function". Settings gives
  every dashboard a context, which they could not take.
- **Examine Management is now Search indexes**, saying what it manages.
- **The Workflows section opens on the list of workflows** for administrators;
  everyone else still opens on *Waiting for me*.
- **Plain Signal's mammogram article** shows a mammogram with a small cancer
  marked, in place of a photograph of one being taken.

## v0.41.1 — 2026-10-31

v0.41.0's release pipeline failed, so it was never published; this is it, with:

- **Tags keep the spelling of the page that used them first.** Two pages
  spelling a tag differently ("News" and "news") showed whichever the database
  read first, which on Postgres could change from one listing to the next.
- Migration 058 records 0.41.1, the release it ships in.

## v0.41.0 — 2026-10-31

- **The Bundle Editor** (story 233). Creating or editing a bundle in Packages →
  Created opens Crombolo's own editor in place of Umbraco's package builder.
  It holds what the builder did, in four tabs (Content, Types, Code and
  Language), opens and saves the same definitions, and says "bundle"
  throughout. It is what lets a bundle carry more than Umbraco's builder knows.
- **Bundles carry forms, approval workflows and user groups** (story 226). The
  Bundle Editor's Forms, Workflows and User groups tabs pick the site's own. A
  workflow brings the document types it covers and the groups that approve
  it, and a form brings the document type its "save as content" step creates;
  each is ticked, saying what added it, and can be left out with a warning.
  Migration 058 adds where a bundle keeps these picks.

- **Plain Signal, a magazine demo** (story 232). `crombolo init --template
  demo/plain-signal` makes a mock AI magazine for a general reader: sections,
  six articles on real advances with openly licensed photographs, their
  credits and their sources, a site-settings footer, a two-stage approval
  workflow (sub-editors, then editors) with its groups declared in
  `schema/user-groups/`, and a contact form drawn by a React island from the
  Delivery API, with the server's form as its fallback.
- **Dates in seed files** (story 232). An unquoted TOML date, such as
  `publishedOn = 2024-12-05`, was refused by every seed; it is now read, and a
  date picker's value is stored as a save stores it, so a seed exported and
  applied again is unchanged.

- **User groups as files** (story 228). A site declares the user groups its
  code relies on, such as the approvers an approval workflow names, in
  `schema/user-groups/*.toml`: name, icon, sections, permission verbs and
  languages, synced at every boot. Start nodes, per-page permissions and members
  stay each environment's, set in Users. In development the Users section writes
  a change back to the file; elsewhere the file's fields are read-only there.
  Bundles and site files carry the groups with the rest of `schema/`.

- **No visitor waits out a rebuild** (story 230). A visitor whose request
  meets a rebuild of the published cache waits at most 50 ms for it, then is
  answered from the version before; an editor's own change still waits for
  the rebuild that holds it. At 25,000 pages the slowest render through a
  burst of publishes is now about 55 ms, down from over a second. The
  benchmark gains a 1,000 ms budget for the slowest render.

**Upgrading:** migration 058 adds a column to `bundle`, run by `crombolo
upgrade` or at the next start.

## v0.40.0 — 2026-10-31

- **Server actions** (story 219). A form, or an island, calls a function on
  the server directly, as Next.js's `'use server'` does. List a module of them
  in `crombolo.config.ts` (`actions: { profile }`); `<form
  action={profile.save}>` then posts to it without JavaScript and returns to the
  page, where `actionState(profile.save)` reads how it went. An island given an
  action as a prop calls it from the browser and gets a `Result` back, and it
  works with React 19's `<form action>` and `useActionState`. Posts go through
  route handlers' checks: CSRF, the rate limit and the time limit. Views import
  actions as `#actions/…`; new sites get the mapping in `package.json`, and an
  existing site adds `"imports": { "#actions/*": "./actions/*" }` to use them.
  The Harbourstone demo's bottlings gain a "Remind me" form.

- **Translations and site settings reach the app** (story 058). The Delivery
  API answers `GET dictionary`, every dictionary item in the request's culture
  as key to text, with the same language fallback as `dictionary()`, and
  `?keys=` to narrow it. A content type marked `site-settings = true` is a
  site's settings: its page, directly below the site's root, has no address,
  is read by templates as `settings` and by apps from `GET settings`, and is
  left out of navigation, menus, the sitemap and search. A status check names a
  second settings page under one root, or one deeper in the tree.
  `@crombolo/delivery-client` and the Next.js client have `dictionary()` and
  `settings()`. The Harbourstone demos' footers now come from a settings page.
  Migration 057 adds the flag.

## v0.39.1 — 2026-10-31

- **Publishing many pages at once is faster** (story 175). Each publish waits
  for the published cache to rebuild, and changes made while it rebuilt each
  started a rebuild of their own, competing with the rest. They now share one
  rebuild after the one running, so 1,000 publishes through the API on a
  25,000-page site take about half as long. Nothing to do but upgrade.

## v0.39.0 — 2026-10-31

- **A route handler's signal ends once it has answered** (story 224). A route
  whose code listened to `signal` and never stopped kept every request in
  memory for good, about 5 KB each. The signal is now aborted once the answer
  has been sent, its body read to the end, failed or cancelled, so a streamed
  body still reads from it to its last chunk. Work a handler leaves running
  after it answers, still listening to the signal, is now stopped then.

- **Bundles in the site's code are approved, and an administrator can disable
  one** (story 225). Wiring a bundle in `crombolo.config.ts` now approves it:
  it runs from its first boot, and the boot records what it may do as approved
  by the site's code, in the audit log too. In Packages → Installed,
  **Disable** turns a bundle off (its pages answer 503, its jobs wait, its
  screens are hidden) and **Enable** turns it back on; a disabled bundle stays
  off through updates until it is enabled. A bundle still declares its
  permissions and is still held to them. Migration 056 records who disabled a
  bundle.

  **Upgrade:** a bundle waiting for approval runs once you upgrade. A bundle
  whose approval you withdrew in 0.38 runs too: disable it in Packages →
  Installed if it should stay off. `crombolo bundle grant` is gone; remove it
  from any pipeline.

- **A worker from the host entry** (story 223). `createWorker`, `WorkerHandle`
  and `WorkerHealth` are exported from `@crombolo/crombolo/host`, so a host
  that boots its nodes itself can boot a worker without reaching into
  `@crombolo/server`. Nothing changes for a site.

## v0.38.1 — 2026-10-30

v0.38.0 was tagged but never published: its release checks failed. This is
v0.38.0 with those fixed, and nothing else changed for a site.

- The browser test of a picked image expects the `rnd` cache buster crop URLs
  carry since story 199.
- The release's Small benchmark, and the weekly Large one, name the benchmark
  as a path, so it runs; a failed Large run now fails its workflow.
- Migrations 054 and 055 record v0.38.1, the release they reach sites in.

## v0.38.0 — 2026-10-30

- **A node that runs only the background jobs** (story 223). Set
  `CROMBOLO_ROLE=worker` on a node that should run only the jobs:
  - scheduled publishing, webhooks, form e-mails, notifications, search
    indexing, and the site's and its bundles' own jobs;
  - it answers `/health` and nothing else, so a long import never competes with
    editors or visitors;
  - set `CROMBOLO_JOBS=off` on the `api` node to leave its jobs to the worker.
    The `api` node still queues work and wakes the worker at once, so webhooks
    and search follow a save as quickly as before;
  - if no worker has been running for five minutes, the `api` node says so in
    `/health` and on Settings → Background jobs, and keeps working.

  A worker needs Postgres and never migrates. A single-process site, and
  `api` plus `web` without a worker, are unchanged.

  **Upgrade:** nothing to do unless you add a worker; docs/operations.md,
  "A worker for the jobs", shows the topology.

- **Page renders no longer leak memory** (found by story 175's benchmark).
  Every page render was kept in memory for good, so a busy site grew until it
  ran out; a site under steady traffic now stays level. Nothing to do but
  upgrade.

- **Pages keep serving while the published cache rebuilds** (story 175). A
  publish rebuilds the cache; a visitor arriving meanwhile used to wait for the
  whole rebuild, about 0.6 s at 25,000 pages. They are now served the previous
  version until it finishes, and the request that made the change answers only
  once its rebuild is done, so the editor sees it at once. The release now
  measures 1,000- and 25,000-page sites on both engines, and a weekly run
  measures 100,000; docs/performance.md lists the supported workloads and
  what they need.

- **Rich text as JSON** (story 216). The Delivery API answers every rich-text
  value as a tree of elements, Umbraco's `RichTextOutputAsJson` form, so an app
  renders each tag with its own component and needs no HTML parser. Links to
  pages carry their route, links to media and images their media URL, and
  blocks their place in the text. `@crombolo/delivery-client` types the tree
  (`RichTextValue`) and adds `walkRichText` and `decodeEntities`;
  `crombolo generate --delivery` types rich-text properties as
  `RichTextValue | null`. In a Next.js front end, `<RichText>` renders the tree
  and takes `components` per tag and `blocks` per element type.

  **Upgrade:** the `{ markup, blocks }` form is gone, with no setting to bring
  it back. A Delivery API client that reads `markup`, including one written for
  Umbraco's default output, must read the tree instead. In a Next.js front end,
  replace `ApiRichText` with `RichTextValue`; `<RichText value={…}>` keeps
  working. Sites that render with crombolo's own templates are unaffected.

- **Live reload and a better error page in development** (story 214).
  - **Open pages reload** when you save a component (on disk or in the back
    office's template editor), change the schema, publish, unpublish or delete
    content, or the server restarts.
  - **A template error** shows the code around the failing line and the
    components that were rendering, as well as the message and stack.
  - **Type errors** are checked in the background after each save. They're
    printed in the terminal and shown in a banner on open pages, and never
    stop a page rendering.
  - **Next.js front ends** get `<CromboloLiveReload />`, which refreshes the
    page when content or the schema changes. The `next` template includes it.
  - `CROMBOLO_LIVE_RELOAD` turns it on or off. It is on in development, and
    off in production and under `bun test`.

- **One way of building SQL** (story 221). crombolo's queries are now built
  with Kysely, a typed query builder, in place of hand-written SQL strings, and
  checked against the types of its tables on SQLite and Postgres both. Nothing
  changes for a site or its editors: no migration, no setting, and the same
  behaviour on both databases. `crombolo upgrade --plan` shows a bundle's
  table changes in lower-case SQL.

- **Background jobs** (story 187). The site and its bundles queue work that
  does not fit in a request, such as an import or a nightly export, and run it
  on a schedule. The site lists job modules in its config (`jobs`) and queues
  one with `site().jobs.enqueue(…)`; a bundle declares `jobs` and uses
  `context.bundle.jobs`. Schedules are cron expressions in a timezone, and
  exactly one server runs each. A failed job is tried again a few times, then
  waits in **Settings → Background jobs**, where it can be run again. Migration
  055 adds the queue.

- **Bundles ask for permissions** (story 222). A bundle's package now lists
  what it may do with the site, such as reading redirects or adding media for a
  signed-in member, and an administrator approves all of it before the bundle
  runs: in the install panel, or with **Approve and turn on** on its card in
  Packages → Installed, and withdrawn there. Until then the bundle is off: its
  routes say it is waiting, its events wait, and its screens are hidden. A new
  version that asks for more is off until that is approved. Each environment
  keeps its own approvals, and `crombolo bundle grant <id>` approves one from a
  pipeline. Migration 054 adds the table they are kept in.
  - **Upgrade note: approve your bundles.** After upgrading, every wired bundle
    with a server half is off until it is approved, Simple Redirects and
    Microsoft Entra included. Approve each in Packages → Installed, or run
    `crombolo bundle grant <id>` on each environment.
  - **Upgrade note for bundle authors: schema 3.** A server half declares
    `"crombolo": { "schemaVersion": 3, "permissions": [...] }`, with `[]` for one
    that needs nothing; a package written for schema 2 is refused. Using `media`
    needs `member.delegate` as well as `media.read` or `media.write`.
    `docs/bundles.md`, "Permissions", lists them.

- **Crop URLs with Umbraco's options** (story 199). `cropUrl()` takes the
  options of Umbraco's `GetCropUrl` as one object: a named crop at another
  size, `quality`, `anchor`, `preferFocalPoint`, `useCropDimensions`, `ratio`,
  `cacheBuster` and `furtherOptions`, as well as the size, mode and format it
  took before. `cropUrl('hero')` works as it did. Image URLs now carry a cache
  buster (`rnd`) from the image's last change, so a replaced image is fetched
  afresh by browsers and CDNs; `cacheBuster: false` turns it off. The image
  route reads `ranchor`, and serves `format=avif` as AVIF where the server can
  encode it and as WebP where it cannot.

- **Tables of the site's own** (story 189). A site declares tables in its
  config with `defineSiteTables`, migrated with crombolo's, and queries them
  through named queries: modules listed in `queries`, called from pages and
  routes as `site().queries.<module>.<name>(…)`. Queries are written with
  Kysely, so the same code runs on SQLite and Postgres, with joins, grouping
  and aggregates. The builder gains decimals, foreign keys between a site's or
  bundle's own tables, unique columns, and descending and partial indexes, and
  a site's step may be SQL. On Postgres each owner's tables are in a schema of
  their own under a role made for this database; on SQLite, in a file beside
  crombolo's. Backups copy them; `crombolo export --with-site-data` carries
  them sealed in a whole-site file, an import writes them back, and a pull
  carries them. `database.anonymise` (and `crombolo.anonymise` in a bundle's
  `package.json`) says what an anonymised copy may keep; any other table
  arrives empty.
  - **Upgrade note: bundle tables move.** A bundle's tables are no longer
    `bundle_<id>__<table>` tables in crombolo's schema behind the `tables`
    capability. They are made afresh in the bundle's own schema or file, and a
    bundle's handlers use `context.bundle.database`, a Kysely handle; the
    `tables` capability, `BundleTablesCapability`, `TableHandle`, `Where` and
    `site().sql` are gone. Data in old `bundle_` tables is not moved: copy what
    you need, then drop them.
  - **Upgrade note: database roles.** On Postgres the CMS's database user needs
    `CREATEROLE` and `CREATE` on the database for a site or bundle with tables,
    or the first boot prints the SQL for an operator to run once.

## v0.37.0 — 2026-10-29

- **Pages with the site's own logic, the Next.js way** (story 206). A template
  can read the request and end the page early, with the App Router's names:
  - `@crombolo/crombolo/navigation`: `redirect` (307), `permanentRedirect`,
    `notFound`, `forbidden`, `unauthorized` and `rethrow`, plus `foundAt` (302),
    `movedPermanentlyTo`, `seeOther`, `badRequest`, `gone` and
    `unprocessableContent`. Each throws from any depth and the page answers its
    status. Unsafe redirect targets are refused.
  - `@crombolo/crombolo/headers`: `cookies()` and `headers()`. Pages get
    `searchParams` as a promise.
  - `@crombolo/crombolo/server`: `site()`, the site's services as the visitor,
    returning a `Result` that ends with `unwrap()`. `site().media` answers only
    what the visitor may read.
  - **Status pages**: `pages: { notFound, unauthorized, error }` in
    `crombolo.config.ts` name pages by path, rendered with the status at the
    address asked for and told what happened through `usePage().outcome`. Any
    other case shows a generic page.
  - **Caching is inferred**: a page that reads the request is sent
    `private, no-store`. `export const dynamic` and `revalidate` override that.
  - `generateMetadata` feeds `<SeoHead>`, and a template may be a folder with a
    `page.tsx` (`crombolo components new --folder`).
  - In preview, a page that redirects shows the editor a notice instead.

- **A Next.js front end** (story 208).
  - **`crombolo init --template next`** scaffolds an empty site with a Next.js
    App Router app in `web/`, already wired for preview, revalidation and member
    sign-in. `--next` adds the same app to any template. `bun run dev` starts the
    CMS and the app together.
  - **`@crombolo/next-integration`** reads the site:
    - `page()` returns a `Result`, and `resolvePage()` ends it with Next's own
      `redirect` or `notFound`;
    - `metadata()` gives Next's `Metadata`;
    - answers are cached by tag on Next.js 16, or under one site tag on 15;
    - pages rendered per request revalidate with `If-None-Match`;
    - it handles Draft Mode, members' sessions (sealed and refreshed),
      protected media, an image loader, `<RichText>`, and block lists and grids.
  - **The proxy** answers CMS redirects with their own status, misses with a
    real 404, and sends visitors to sign in for members-only pages.
  - **`demo/harbourstone-next`** is Harbourstone on Next.js, with a whisky
    comparison page. Visitors choose up to four bottlings, side by side, and
    the selection is kept in the link.
  - **A webhook file can set `payload = "crombolo"`** to be sent the item's
    content type and its ancestors. They are captured with the change, so a
    delete still says where the page was.
  - **The Delivery API's route lookup** names the page `pages.notFound` gives.
  - **The delivery client** gained preview, `seo`, sitemap, forms, answer keys
    and tags, and conditional requests.
  - **CI** builds and runs a scaffolded app on Next.js 15 and 16
    (`bun run smoke:next`).

- **Interactive islands** (story 209).
  - **A component whose first line is `'use client'` runs in the browser,** as
    in Next.js. A template uses it like any other. Its props travel as JSON,
    its `children` are rendered on the server and passed to it, and `load`
    and `fallback` say when it mounts and what shows until then.
  - **The browser code is built with each generation of views** and served
    for good, so a page and its islands always match.
  - **`<Island name>`** mounts a Vue, Lit or plain module's
    `mount(element, props)`.
  - **`islands.manifest`** serves a site's own Vite build instead.
  - **A client component importing server code** is refused, naming both
    files.
  - **No inline script:** a strict `script-src 'self'` policy works, and pages
    stay cacheable.
  - **The TSX `demo/harbourstone`** gains the whisky comparison page as an
    island, the same page harbourstone-next draws in Next.js.

- **Middleware** (story 210).
  - **A site lists its middleware in `crombolo.config.ts`** by stage:
    - `request` runs before redirects and content finding;
    - `route` runs once the page is found;
    - `page` runs after public access.

    Each stage is an onion: answer outright, change the request (headers and
    cookies reach the page), rewrite to another of the site's pages, or change
    the answer.
  - **Public access is always checked** on the page that finally renders.
  - **The contract is published** in the new `@crombolo/common`, so a package
    or a server bundle can offer middleware. Only the config adds it to the
    chain.
  - **Matchers** take Next.js's syntax, and `fromNextMiddleware` brings an
    existing Next.js middleware in as one link.
  - **Caching and limits:** reading or setting cookies keeps the answer
    private. The whole chain has one time limit,
    `CROMBOLO_MIDDLEWARE_TIMEOUT_MS`, which doesn't count the page's
    rendering.
- **Route handlers** (story 211).
  - **A site lists its own endpoints in `crombolo.config.ts`**:
    `routes: [route('/api/records/:species', { GET, POST }, options)]`, from
    `@crombolo/crombolo/routes`. A route answers at its path ahead of content
    finding. When it hides a published page, the new "Routes and pages" status
    check says so.
  - **A handler** gets the request and a context: `params`, `cookies`,
    `setCookie`, `site()`, `member()` and an abort `signal`. It returns a
    `Response`, or a `Result`: the value is sent as JSON, and an outcome
    answers its status. Errors are problem+json, or the status page for a
    browser. A 500 carries a reference that the log line shares too.
  - **Safe by default:**
    - answers are `private, no-store` unless a read sets its own caching;
    - a member's cookie-authenticated write must come from the site itself,
      or carry the anti-forgery token;
    - every route has a flood limit of 2000 requests a minute per caller
      (`CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE`);
    - a handler has 10 seconds (`CROMBOLO_ROUTE_TIMEOUT_MS`).

    Per route: `members`, `csrf`, `rateLimit` and `cors`.
  - **`fromRouteModule`** takes a Next.js `route.ts` as it is.
  - **A server bundle's routes are route handlers too.** Its site routes
    answer at the paths it declares, wherever the site lists the bundle, and
    its back-office routes stay under the back office with
    `audience: 'backoffice'`. `simple-redirects` and `entra` have moved over.
- **`@crombolo/common`** holds the contracts outside code is written against:
  `Result` and `Outcome` (from 206), the middleware contract and the route
  contract.
  `@crombolo/next-integration` now uses it rather than a copy. The same names
  come from the same entry points as before.

### Upgrade notes

- **Bundles with a server half must be updated** (story 211, no
  compatibility layer).
  - **Removed:** the old route objects (`ServerBundleRoute`, `audience:
    'member' | 'public'`, `BundleRequest` and their kin), and the site
    routes under `/crombolo/bundle/<id>/`.
  - **What a bundle changes:** it declares its routes with `route()` and adds
    `"schemaVersion": 2` to its package's `crombolo` field.
  - **Refused until then:** a server bundle without it, at install and at
    boot.
  - **The steps:** `docs/bundles.md`, "Routes". Browser code that called
    `/crombolo/bundle/<id>/…` calls the route's new path.
- **A site that uses islands installs `react` and `react-dom`.** Crombolo
  depends on neither, and a site without islands needs neither.
- **A template error now answers an HTML error page**, not plain text. It shows
  a reference that the log line carries too. `CROMBOLO_SHOW_ERROR_DETAILS`
  (`errors.showDetails`) adds the message, file and line, and stack. It is on
  when `NODE_ENV` is not `production`, as the old development text was.
- **A page rendered for a signed-in member** is still never cached. A template
  that exports `dynamic = 'force-static'` is the exception: it renders without
  the member, so it can be shared.
- **`pages.notFound` wins over Settings → Search & sharing's not-found page**
  when set. A site that sets neither keeps the plain `Not Found`.

## v0.36.2 — 2026-10-29

- v0.36.1 was tagged but never published: the server-bundle routes tests reset
  the Postgres database while the previous test's site was still running,
  which could deadlock. Each site now closes before the next starts, as the
  import tests do (story 200). No change to the CMS itself.

## v0.36.1 — 2026-10-29

- v0.36.0 was tagged but never published: the browser test for media Public
  Access (story 205) opened the item's actions menu before it was ready. It
  now retries opening it, and names its member group and member uniquely so a
  retry can run. No change to the CMS itself.

## v0.36.0 — 2026-10-29

- **Media permissions are a Public Access section that inherits** (stories
  203–205). A media folder or item's **Permissions** dialog holds **Public
  Access** with two toggles. Read is **Enabled** (the default: anyone with the
  link), **Disabled** (back-office users only) or **Custom**. Write is **No
  Public Access** or **Custom**. Public write is never allowed.
  - **Custom names member groups, individual members, or both**, separately
    for reading and writing. A member in a chosen group or chosen by name
    gets in.
  - **Inherit parent permissions** is ticked on a child file or folder unless
    it has settings of its own. It follows the nearest folder above that has
    settings, or the defaults when none has. Unticking it starts the item's
    own settings from what it inherited. A root item has no checkbox.
  - **Inheritance is live.** New files and folders follow their folder, so a
    change to a folder applies straight away to everything below that
    inherits. Before, a new file was given a copy of the folder's settings
    when it was added.
  - The line above the section, and the media workspace's info panel, say
    where the settings come from and who they let in.
  - Serving, crops, the Delivery API's media lists and items, member writes
    through server bundles, caching and content bundles all apply the same
    grants. A bundle carries individual grants by member key, without needing
    the members in it; a member who is absent gains no access.

  **Upgrade notes.** Existing settings are kept. Files given a copy of their
  folder's settings by an earlier release show as overrides, with
  **Inherit parent permissions** unticked: tick it to have them follow the
  folder. An "all signed-in members" read and a folder's "only the member who
  added it" setting for new uploads keep working, though the dialog no longer
  offers them. `docs/rendering.md`, "Protected media".

  **Migration:** 053 `AddMediaMemberGrants` (expand): `media_access_member`,
  one row per rule and member with separate read and write flags.

- **A page's form picker shows its form and its fields** (story 202). The
  dropdown was empty even with a form saved. It now lists the forms and shows
  the saved one, and **View form fields** expands the form's pages, groups,
  fields, required markers, help and choices without changing it. An
  unavailable saved form stays visible until cleared. `docs/forms.md`.
- **`crombolo init` needs an empty directory.** It scaffolds either a plain
  site or one from `--template`, once. In a directory that is not empty (a
  `.git` folder aside) it now fails with exit code 8, rather than skipping the
  files already there and leaving a template half-applied. `--force`
  scaffolds anyway, overwriting them. Its JSON output no longer has
  `existing`.
- The release's Postgres load tests and benchmarks run as three parallel jobs
  (story 201), so publishing waits for the slowest rather than all three in
  turn.

## v0.35.2 — 2026-10-28

- The bundle import tests finish the source site's background work before
  resetting the database for the target (story 200), which could deadlock on
  Postgres and had failed a release run. No change to the CMS itself.

## v0.35.1 — 2026-10-28

- v0.35.0 was tagged but never published: the browser suite's own test page
  read a media picker without awaiting it (story 197). It now awaits it.
- **Security fixes.**
  - `crombolo seed export` no longer writes outside `seed/`. A media folder
    named `.` or `..` was written as that path segment, so an editor could
    have a file written anywhere the operator's account can write. Such a
    folder is now exported as `item`, and every write is checked to stay
    under `seed/`.
  - A member deleting or moving a media folder through a server bundle now
    needs write permission on everything in it (story 198). Before, write
    permission on the folder alone took every other member's files to the
    recycle bin with it.
  - `crombolo bundle check` and `checkBundleCode` no longer run the bundle's
    `crombolo.config.ts`. They check the packages it declares instead, and
    report the server bundles those carry as `serverBundles` in place of
    `wired`. The wiring is checked when the host first starts the code.
- **`bundle check` is only the code check.** It had also been an alias of
  `content check`, which the code check hid. Use `content check` for a
  bundle's content.

### Upgrade notes

- A host that read `wired` from `bundle check` or `checkBundleCode` reads
  `serverBundles`, and starts the installed code once before serving from it
  to catch wiring problems.

## v0.35.0 — 2026-10-28

- **A server bundle can manage media as the signed-in member** (story 198).
  A bundle asks for the new `media` capability and declares the folders it
  uses by path, `media: { folders, types?, maxBytes }`. It creates, reads,
  changes and deletes media items as that member, under the media permissions,
  or as the user on a back-office route; a public route may not use it.
  - **A declared folder that does not exist refuses the boot**, naming the
    bundle and the path. The back office shows which bundle uses a folder and
    asks before renaming, moving or deleting it or a folder above it.
  - **The member is recorded as the file's creator**, the folder's defaults
    are stamped on it, and the audit log names the member and the bundle.
  - **What members may upload is set per folder**, in the Permissions panel:
    "File types members may upload here", ticked from a list, and an optional
    largest size. Nothing is accepted that is not ticked. A file is recognised
    by its first bytes, and its extension must agree.
  - **A member's image is stored upright and without its metadata**: no
    location, camera or time is ever served. What it said is handed to the
    bundle instead. An image that cannot be prepared on the server is
    refused.
  - Back-office uploads are unchanged.

  `docs/bundles.md`, Part 3, "Media as the member"; `docs/rendering.md`,
  "What members may upload".

  **Migration:** 052 `AddMediaMemberUploads` (expand): `member_types` and
  `member_max_bytes` on `media_access`.

- **A server bundle can serve members and visitors** (story 186). A route
  declares an `audience`: `'backoffice'` (the default, so every existing route
  is unchanged), `'member'`, `{ member: { groups } }` or `'public'`. Member
  and public routes answer at `/crombolo/bundle/<id>/…` on `all` and `web`
  nodes, never on `api` nodes.
  - **The member** is the one the site's cookie signs in, or a Delivery API
    member token names. The handler gets them as a frozen `BundleMember`:
    key, name, username, e-mail and groups. A visitor gets 401, and a member
    outside the route's groups 403.
  - **A cookie-driven write needs an anti-forgery token.** Put
    `<AntiforgeryMeta />` in the layout and load `/crombolo/bundle.js`, whose
    `crombolo.fetch` sends it. A request with a member token needs none.
  - **Rate limits** per route, `rateLimit: { max, perSeconds, by }`, by member
    or by caller, answering 429 with `retry-after`. Each server counts on its
    own, so behind N servers a route allows up to N times its limit.
  - **Other origins** on the Delivery API's allow-list get CORS headers.
  - **Every handler gets `caller`**, saying who the host resolved the request
    to.
  - A route group that does not exist is reported at boot as a warning.

  `docs/bundles.md`, Part 3, "Routes for members and visitors".

- **Media cached apart from pages** (story 197). A media library can grow to
  millions of items without every server holding it, and an upload no longer
  makes a server rebuild its pages:
  - **The page snapshot no longer holds media.** Its memory and build time no
    longer grow with the library.
  - **A media cache** holds the items used most recently, within a memory
    budget: `CROMBOLO_MEDIA_CACHE_MB` (`mediaCacheMegabytes`), 64 by default.
    It fills from indexed lookups by key and by file address.
  - **A media change drops only what it touched**, on every server: the item,
    and what is below it when it moved. It no longer rebuilds the pages, and a
    page change no longer drops media. A server that missed changes empties
    its media cache and refills it as items are asked for.
  - **`/media/…`** finds its item through the file address index, with no map
    over all media.
  - **The Delivery API's media endpoints** page in the database, in the same
    order and with the same documents as before.
  - **`crombolo media import`** tells the servers about the items it made a
    batch at a time.
  - **Adding to a large folder** no longer reads every item already in it to
    find the new one's place.

  **Migration:** 051 `AddMediaPagingIndexes` (expand): an index on `node`
  for a folder's children in order, and one on `cache_instruction.checkpoint`.

  **Upgrade notes — views must await media.** This release breaks views, as
  story 173's promise says a minor must not without a deprecation first.
  Keeping media synchronous for one more minor would have meant keeping every
  media item in every server's memory for that minor, which is what this
  release fixes. Each accessor that can resolve media now returns a promise:

  | Accessor | Now | The change to make |
  | --- | --- | --- |
  | `model.media(alias)` | `Promise<MediaWithCrops[]>` | `const [hero] = await model.media('hero')` |
  | `model.value(alias)` for a Media Picker | a promise of the pick, the picks or null | `await model.value('hero')` |
  | `model.value(alias)` for a Multinode Treepicker | `Promise<Array<PublishedContent \| PublishedMedia>>` | `await model.value('related')` |
  | `model.value(alias)` for a Multi URL Picker | `Promise<Link[]>` | `await model.value('links')` |
  | `model.html(alias)` | `RawHtml`, or a promise of it when the text links to media | none: `{model.html('body')}` renders either |
  | `model.value(alias)` for rich text | the markup, or a promise of it | write rich text with `html()` |
  | `model.text(alias)` for rich text | links to media are `#` | write rich text with `html()` |
  | `effectiveMeta(…)`, `<SeoHead>` | promises | `await effectiveMeta(…)`; `<SeoHead>` needs nothing |

  - A component that awaits one is declared `async`:
    `export default async function Home({ model }: PageProps)`. JSX renders
    async components as any other.
  - Elements have the same, a block's `content.media('image')` among them.
  - `<div setInnerHTML={{ __html: model.text('body'), dangerously: true }} />`
    still renders, but a link to media in the text is `#`: write
    `<div>{model.html('body')}</div>`.
  - `crombolo components check` reports each `media()` used without `await`,
    with its line and the change to make; with `typescript` installed, the
    compiler reports the rest.
  - `crombolo generate` now types media pickers, tree pickers, link pickers
    and rich text as promises. Run it again.
  - `menu()`, `text()` and every other editor's value are unchanged.
    `MediaWithCrops` and `PublishedMedia` are exported as types.
  - Every view in this repository's sites and the `basic` template is updated.

- **Media only the right people can read** (story 196). A media folder or item
  has **Permissions** in the back office:
  - **Who can see and change it,** by member group. A folder's permissions
    cover everything below it, and a nearer folder or item can set its own:
    stricter, looser, or open to anyone again.
  - **What files added to a folder later get:** who can see them (anyone with
    the link, the folder's groups, or only the member who added the file) and
    who can change them. Each new file keeps what it was given, and its own
    setting can be changed.
  - **The member who added a file** is recorded with it.
  - **A "Protected" badge** in the media workspace.

  Serving follows them:
  - A protected file, and its crops, go only to someone allowed to read it:
    a member of its groups (by the site's cookie or a Delivery API member
    token), or an editor with the Media section within their start nodes.
    They are streamed with `Cache-Control: private, no-store`, and never sent
    to a store's public address. Anyone else gets 404.
  - A `/media/` address that no media item, page upload field or user's avatar
    owns now answers 404.
  - The Delivery API leaves protected media out of its lists, and its item
    answers 401 or 403. A page's media picker keeps only the item's id and
    name for someone who cannot read it.
  - The permissions travel with content transfer and whole-site files.

  **Migration:** 050 `AddMediaAccess` (expand): `media_access`,
  `media_access_rule` and `node_file`, and `file_url`, `creator_member_key`,
  `read_policy` and `write_policy` on `content`. Existing media items get their
  `file_url`, and pages their uploads, as it runs.

  **Upgrade notes:**
  - A file in the media store that no media item or page upload names is no
    longer served. One placed there by hand needs a media item.
  - A file in the recycle bin is now served only to back-office users.
  - A file a visitor uploaded through a form is no longer served at its
    address. A workflow that attaches uploads still attaches it.
  - A CDN or public bucket in front of the media store serves everything it
    holds to anyone: keep protected files out of it (`docs/rendering.md`,
    "Protected media"). The server warns at boot when a store has a public
    address.

- **A bundle's media files are listed in `media.json`, and left out unless
  asked** (story 195). Bundle format 5:
  - **The list.** Every media file the content names is listed in `media.json`
    at the package root, which the integrity hash covers. A carried file has
    the URI `bundle://<bundle id>/media/<key>`.
  - **The bytes** sit under `media/`, where they sat under `blobs/`.
  - **What is refused.** A file under `media/` that `media.json` does not
    list, and a URI pointing outside the bundle.
  - **The option.** Every command that writes a bundle leaves media out unless
    given `--with-media`: `bundle build`, `content export` (with
    `--include-content`) and `export`. The back office's created-package
    download offers "Include media files", unticked.

  **Upgrade notes:**
  - `export` no longer includes media by default: pass `--with-media`.
  - `--with-blobs` and `--no-media` still work for this minor, deprecated.
  - A bundle written before this release is refused with a message saying to
    rebuild it.
  - `pull` and `push` are unchanged.

## v0.34.0 — 2026-10-28

- **A supported API, with a compatibility promise** (story 173). `@crombolo/crombolo`
  is now the one supported package, split by audience:
  - `@crombolo/crombolo` for a site;
  - `@crombolo/crombolo/bundle` for a server bundle's author;
  - `@crombolo/crombolo/host` for whoever runs sites, including the upgrade,
    import and export operations that came from `@crombolo/cli`.

  A patch never breaks it, and a minor does so only after one minor of
  deprecation. Every other `@crombolo/*` package is internal and says so in
  its README. A committed snapshot of every exported name, and a test of who
  imports what, hold the boundary. `docs/api.md`.

  **Upgrade notes:** nothing breaks in this release.
  - The bundle and host names that sat at the root still work there,
    deprecated, through 0.34. Their new homes are listed in `docs/api.md`,
    "Moving to the entry points".
  - A bundle that imported types from `@crombolo/server` imports them from
    `@crombolo/crombolo/bundle`.
  - A host that imported from `@crombolo/cli` imports from
    `@crombolo/crombolo/host`.
  - `@crombolo/simple-redirects` and `@crombolo/entra` no longer depend on
    `@crombolo/server`. Their peer on `@crombolo/crombolo` is all they need.

- **Installing a bundle that runs code on the server takes an explicit yes**
  (story 194). On the Marketplace:
  - a bundle with server code is tagged "Runs code on the server", in warning
    colour;
  - installing one opens a panel in its card that says what the code can reach
    and names the publisher;
  - the install button stays disabled until "I trust this publisher with the
    site's server" is ticked.

  The server enforces it, and every install is safer:
  - Without the yes the install is refused, and a version that turns out to
    have server code is removed again.
  - Only bundles are installed: a package that is not one, or one whose
    contents the registry cannot confirm, is refused.
  - Installs run with `--ignore-scripts`.
  - Each install and uninstall is recorded once in the audit log, naming the
    package and whether server code was accepted.

  **Upgrade notes:** a script that calls `POST …/bundles/install` for a bundle
  with server code sends `"acceptServerCode": true`. A call for a package that
  is not a bundle is now refused, where before it was installed.

## v0.33.1 — 2026-10-28

- **Bundles say which layout they are in.** 0.33.0 moved `bundle.json` to the
  package root without raising the bundle format, so an old and a new bundle
  carried the same version numbers. Every bundle is now written as format 4,
  whatever it carries. A bundle older than 0.33.1, whether at format 1, 2 or 3
  or with `"content"` naming a folder, is refused with a message saying to
  rebuild it with the command that made it. Before, it got an error about a
  missing `bundle.json` (story 193).

  **Upgrade notes:** rebuild any bundle written by 0.33.0 or earlier.

## v0.33.0 — 2026-10-28

- **One manifest for the whole bundle** (story 193). A bundle package now has
  `bundle.json` at its root, beside `package.json`, and everything it carries
  beside them: nodes, media, sealed values, people, the sections, and a site's
  code. One integrity hash in `bundle.json` covers all of it. Code is a
  section like `schema/`, listed under `carries.code`, so the second hash in
  `crombolo.code` that 0.32.0 wrote is gone. `crombolo.content` is now `true`
  rather than a folder name, and `files` lists what the bundle carries.

  **Upgrade notes:** a bundle written before this release, with its payload in
  `content/`, is not read. Rebuild it with the command that made it
  (`bundle build`, `content export`, `export`, or a created package's
  download). A bundle you publish yourself changes `"content": "content"` to
  `"content": true`, and moves `content/*` to the package root.
- **v0.32.0 was tagged and not published.** Its Release run failed on the
  concurrency load test. The cause was in the test, not the CMS: a save raced
  a permanent delete and was refused for naming no revision rather than for
  the missing page. Everything in v0.32.0 ships in this release.

## v0.32.0 — 2026-10-28

- **A site's bundle can carry its code** (story 192):
  - **Building it.** `crombolo bundle build` packs the files the site's
    `package.json` names in `crombolo.code`, or that `--code` names, under
    `code/`, with `package.json`, `bun.lock` and `crombolo.config.ts`. A hash
    of its own covers them. Secrets, databases, `node_modules` and the
    folders the bundle already carries are never packed.
  - **Checking it.** `crombolo bundle check <bundle>` installs the code from
    its lockfile with no install scripts and reads its config in a process
    with an empty environment. It lists every problem with the server bundles
    the config wires, by the rules the boot applies.
  - **Installing it.** `crombolo bundle install-code <bundle> <dir>` installs
    the code where a host starts it.
  - **Importing it.** `content import` and `start --bundle` leave the code
    alone, and say the bundle carries some.
  - **For hosts.** Both are exported as `checkBundleCode` and
    `installBundleCode` from `@crombolo/crombolo`.
- **A new site lists `@crombolo/*` as peers.** `crombolo init` writes
  `@crombolo/crombolo`, and any `@crombolo` server bundle a template wires,
  under `peerDependencies`, so a host that runs the site provides the CMS.
  `bun install` still installs peers, so nothing changes locally. Bundle
  discovery and the Marketplace read peers as well as dependencies.

  **Upgrade notes:** an existing site keeps working as it is. A site whose
  bundle will carry its code moves its `@crombolo/*` entries from
  `dependencies` to `peerDependencies`, which `bundle check` asks for.

- **A site's `server.ts` boots with its own `crombolo.config.ts`.** The
  `server.ts` that `crombolo init` wrote called `crombolo()` without the
  config, so `bun run dev`, and any host that runs `server.ts`, started the
  site without its name, its server bundles or anything else the config set.
  `crombolo start` was unaffected: it reads the config itself.

  **Upgrade notes:** an existing site fixes its `server.ts` by hand:

  ```ts
  import { crombolo } from '@crombolo/crombolo'
  import config from './crombolo.config.ts'

  export default await crombolo(config)
  ```

## v0.31.0 — 2026-10-27

- **An apostrophe in a site's name no longer splits its package name.**
  `crombolo init --name "Harbour's Edge"` names the package
  `harbours-edge`, not `harbour-s-edge`.

## v0.30.3 — 2026-10-27

- **A new site type-checks out of the box.** `crombolo init` now adds
  `@types/bun` to the site's `devDependencies`, which its `tsconfig.json`
  already named. Before, `crombolo components check` on a freshly scaffolded
  site failed with `TS2688: Cannot find type definition file for 'bun'`. An
  existing site fixes it with `bun add -d @types/bun`.
- **The docs scaffold a site with `bunx @crombolo/cli init`.** `bunx crombolo
  init` named an npm package that does not exist. Inside a site, after `bun
  install`, `bunx crombolo` still runs the installed command line.

## v0.30.2 — 2026-10-25

- **A stopping server waits for a background job already running** before it
  closes its database. Before, a job such as a search-indexing pass could be
  left holding row locks, which deadlocked the next thing to use the database.
  A Postgres CI run hit it, and v0.30.1's release was held back by it.

## v0.30.1 — 2026-10-25

- **The command line no longer loses the end of its output on a slow pipe.**
  It waits for stdout and stderr to drain before it ends. Before, output piped
  to a busy reader could arrive cut off, with exit code 0: `upgrade --plan`
  stopped at 47 KB of 170 KB on a CI runner, and v0.30.0's release was held
  back by it.

## v0.30.0 — 2026-10-25

- **Blocks render their own components** (story 184): `<Blocks
  items={model.value('sections')} />` renders each Block List or Block Grid
  block with `components/blocks/<element alias>.tsx`. A template can map a
  type to its own component, and a missing component shows only in preview. A
  grid renders Umbraco's block-grid markup.
  - `crombolo components new --block <alias>` scaffolds a typed block
    component, and `components check` warns of one that names no element
    type.
  - Block Grid values now carry their areas' aliases and spans, and the
    grid's column count.
  - The Harbourstone demo's highlights are blocks now.

- **Find pages by their facts** (story 183): `POST
  <backoffice>/crombolo/api/content-query` and `crombolo content find` find
  pages by type, place, dates, state, name, full text and up to five value
  comparisons, as the signed-in user, over the drafts. Numbers and dates
  compare as numbers and dates. A filter on a property the user may not read is
  refused. `content find --remote` searches a hosted site through the new
  `content-query` remote capability.

- **Side panels** (story 182): a bundle's `sidePanel` docks beside the
  back office's view, keeps its state as the editor moves around, and is
  remembered per user. It can be resized, becomes a sheet on narrow windows,
  and gets a header toggle with `meta.toggle`. Extensions control it through
  the `Crombolo.Context.SidePanel` context.

## v0.29.1 — 2026-10-25

- **CI only; no change to the packages' behaviour.** Two tests that failed by
  chance on a busy runner are fixed. One matched a member's name inside a hash;
  the other boots four sites within CI's 5s limit. The pipeline's Postgres now
  runs with `fsync`, `synchronous_commit` and `full_page_writes` off, to shorten
  the Postgres test and benchmark jobs.

## v0.29.0 — 2026-10-25

- **A demo site in three commands** (story 164): `crombolo init`, `crombolo
  bundle build sites/harbourstone --out <dir>` (or `--template
  demo/harbourstone`), then `crombolo start --bundle <dir> --publish`.
  - `bundle build` turns a site directory (schema, views, styles and seed) into
    one bundle, compiling the seed against that schema with no database of its
    own.
  - `start --bundle` now installs a bundle that carries schema and views, then
    boots again to load them.
- **The demo sites are seed files.** Their pages, Library elements and
  photographs live in each site's `seed/`. `crombolo init --template` copies
  them, and the new site's `start` script is `crombolo start --seed
  --publish`, so its starting content is files to edit. Templates no longer
  ship pre-built bundles, and the TypeScript builders are gone. Node keys are
  kept, so a site that already holds a demo sees no change.
- **`crombolo seed export --all`** writes every page, Library element and media
  item (with its file) as seed files, in the shorthand `seed apply` reads back:
  rich text as `{ html }`, pickers and links as paths, blocks as tables.
- **`crombolo content export` is `crombolo bundle export`**; the old name still
  runs, and says it is deprecated. `seed build` is now `bundle build`.
- **A site built from a config that names a dialect boots on that dialect**,
  where `bootstrapDatabase` used to follow `CROMBOLO_DB` instead.
- **Schema files carry no keys** (story 161). Sync derives each type's,
  property's and data type's key from its alias, so two nodes syncing the same
  new files assign the same keys. A production node no longer refuses a file
  without keys, and nothing is written back for a new type.
  - **Data types name types by alias:** picker filters, allowed element types,
    and a block editor's blocks, which can now be written as
    `[[data-type.block]]` tables with named groups and grid areas. `types
    check` names an alias that is not there.
  - **Nested config is written as TOML tables,** not JSON strings.
  - **Webhook files are `schema/webhooks/<alias>.toml`,** with content types
    by alias.
- **A site never started holds images in its folders** (story 180). Opening
  the database and every schema sync now let the built-in Folder hold the
  built-in media types, as a server's start did. So `media move` into a folder,
  or a seed with an image in one, works from the first command. An empty
  directory reaches a published site, signed in and checked, through the
  command line alone (`docs/operations.md`).
- **A host can install a site's bundles** (story 181). `cromboloServer()`
  returns the server handle, and its `reloadBundles()` takes up packages the
  host wrote to `package.json` and `node_modules` without a restart. Open back
  offices are told "Extensions changed — reload to use them". A server half is
  never mounted by a reload. `installsElsewhere` (`CROMBOLO_INSTALLS_ELSEWHERE_MESSAGE`
  and `_URL`) replaces the Marketplace's deploy wording with the host's own.
  `validateBundlePackage` and `peerRangeProblem` are exported from
  `@crombolo/crombolo`.
- **Schema from the command line:** `types new content-type` takes
  `--compose`, `--allow-child`, `--vary-by-culture`, `--vary-by-segment`,
  `--library` and `--list-view`. `types new data-type <alias> --editor
  <preset>` writes a data type for twelve common editors. There are new
  commands: `languages add` and `languages list`, `forms new`, `workflows new`
  and `webhooks new`. Each refuses an alias that names nothing before it
  writes.

**Upgrade notes:** a site's existing keys stay: a row is found by alias, and a
development sync writes its key back where it differs from the derived one, so
existing files and content are unchanged. Deleting a key line changes nothing
on a database that has the row. On a fresh database it gives the derived key,
and block values store element type keys, so content moved there must come
with its schema. The demo sites' schema files are now keyless, so a demo installed
fresh gets new type keys. One already installed keeps its own.

**Upgrade notes:** a site scaffolded from a template before this release keeps
its `start --bundle bundles/<template>` script and bundle, and still works.
Moving it to its seed is `crombolo seed export --all`, then switching the
script to `crombolo start --seed --publish`.

## v0.28.0 — 2026-10-25

- **Seed files** (story 163): a site's starting pages, Library elements and
  media as TOML files under `seed/`, written in a shorthand per editor
  (Markdown, paths for pickers, blocks as tables), with `crombolo seed check`
  (every problem by file and line), `seed build`, `seed apply [--publish]
  [--dry-run]`, `seed export` and `start --seed` (applied once per change).
  An empty directory now reaches a served page through the command line alone.
- **Imports compare three ways.** Every import records what it applied to each
  node, so the next one takes a change only the bundle made, keeps one only the
  site made, and asks only when both changed. Names, place and order follow the
  same rule. Pulls, pushes and `start --bundle` get it too.
- **An unchanged re-import writes nothing**, where it used to add a version to
  every page.

**Migration:** 049 `AddContentApplied` (expand), a table of what each import
applied.

**Upgrade notes:** nodes imported before this release have no record, so the
first import after upgrading compares them as before, and any difference is
still a question. Every import after that is three-way.

## v0.27.0 — 2026-10-24

- **Move, copy, sort and delete from the command line** (story 165):
  `crombolo content move|copy|sort|delete` and `crombolo media move|delete`.
  Each takes `--dry-run`, checks everything named before changing anything,
  writes the audit entry under the operator's name, and a move keeps the old
  addresses working as an editor's move does.
- **A page or media item goes only where its parent's type allows it**, through
  the Management API as well as the command line. Until now only the
  backoffice's pickers held to this, so a script could create a page under a
  type that does not allow it. Approvals, schedules and form workflows are not
  affected, and nor are seeds or `content import`.
- **Media writes are recorded with the change**, as page writes are: the audit
  entry and webhook event commit in the same transaction, from the backoffice
  and the command line alike. `recycle-bin empty` now deletes media the same way.
- **A rename published from the command line records its redirect.** The
  command line's own published cache was not dropped after a change, so the
  tracker compared the new address with itself.

- **The audit log from the command line** (story 156): `crombolo audit list`
  pages it newest first, with a cursor, and `crombolo audit stream [--follow]`
  prints NDJSON for a log store or SIEM. Both have filters for time, person,
  category, action and item. They read through a connection that cannot write,
  and `--remote` reads a hosted site through the remote protocol's new `audit`
  capability, for people with the Settings section.
- **An integration test walks a site from an empty directory** to a served
  page through the CLI alone (`tests/integration/hello-world.integration.ts`).
  Its steps that need seed files wait for story 163; the gaps it found are
  story 180.

**Upgrade notes:** a script that creates or moves pages through the Management
API under a type that does not allow them now gets a 400; allow the type on the
parent, or place the page where it is allowed.

## v0.26.0 — 2026-10-23

- **The AI assistant has left the CMS.** The back office's assistant drawer,
  its changesets, its MCP endpoint and its Bedrock provider are gone, and so
  is the CMS's only cloud SDK. An assistant is now something a host provides:
  browser code it lists as `hostProvided` (`177`), working through the
  Management API as the person signed in, and telling the host's own service
  who that is with a host token (`178`). `bundles.md`, "Tools a host
  provides", shows how. `179`
- **Migrations:** 048 drops the assistant's two tables, `assistant_changeset`
  and `assistant_change`. It is the first migration that removes something;
  before 1.0, any release may.
- **Upgrade notes:**
  - **Apply or discard any open assistant changesets before upgrading.** They
    are dropped with their tables, not carried anywhere.
  - Remove `assistant` from `crombolo.config.ts`: a config that still names
    it refuses to start, saying why.
  - `bedrock`, `AssistantProvider`, `BedrockOptions`, `ConverseInput` and
    `ConverseResult` are no longer exported from `@crombolo/crombolo`.
  - `CROMBOLO_ASSISTANT_MODEL`, `CROMBOLO_ASSISTANT_MCP` and `AWS_PROFILE` are
    no longer read. The other AWS variables remain, for SES e-mail.
  - `@crombolo/assistant` is no longer published with the rest. Its existing
    versions stay on npm.
  - This release removes something from the database, so upgrade a cluster in
    one step rather than one server at a time: an older server still running
    would look for the dropped tables.
- **The back office can vouch for its user to a host's own service.** With
  `host` set in `crombolo.config.ts`, a host's back-office tool can ask for a
  five-minute signed token saying who is signed in, and send it to the host's
  service, which checks it with its key alone. Nothing changes without
  `host`. `178`
- **A host's own bundles stay with the host.** An installation that runs sites
  for other people lists the packages it provides to every site as
  `hostProvided` in `crombolo.config.ts`. A whole-site file no longer names
  them, so a site exported from the host starts anywhere with only the bundles
  it chose itself. `177`
- **The APIs move off `/umbraco`.** The Management API and the back office's
  live updates are served under the back office's own path:
  `/crombolo/management/api/v1` by default, following `backOfficePath` when a
  site moves it. The Delivery API is at `/crombolo/delivery/api/v2`, wherever
  the back office is. The back office, the served API description and the
  typed Delivery API client use the new paths.
- **Upgrade notes:**
  - Umbraco's paths keep working, so nothing that calls the API breaks:
    `/umbraco/management/api/…`, `/umbraco/delivery/api/…` and the hubs.
    Change your own API clients to the new paths when convenient. The old ones
    will go in a later major release.
  - `@crombolo/delivery-client` now asks at `/crombolo/delivery/api/v2`. For a
    site on 0.25 or older, pass `apiPath: '/umbraco/delivery/api/v2'`.
  - External sign-in callback addresses do not change, so nothing needs
    re-registering with a sign-in provider.
- **Every server knows which published changes it shows.** Each change to
  published content gets a number, in the order the changes were saved. A
  server compares the number it serves with the latest, and catches up
  automatically. A change can no longer be missed because its notice arrived
  late or got lost, as could happen with long imports and schema syncs. `174`
- **Each rebuild of a server's published content is one consistent moment.**
  It never mixes before and after a change, and never shows something another
  request has not finished saving. On SQLite, a rebuild no longer holds up
  saves. `174`
- **See it.** `/health` and the Servers health check show which change each
  server serves, and warn when one has been behind for over a minute.
  `crombolo cache rebuild` now waits until every server has rebuilt. `174`
- **Fixes:** `174`
  - Dictionary edits, deleted pages and redirects now reach every server.
    Before, the other servers kept the old content until something else
    changed.
- **Import a file without its people.** `--exclude-people` on `crombolo import
  --replace`, `content check` and `content import` (and `excludePeople` in
  `@crombolo/transfer`) leaves the members, users and groups a file carries
  out, so content can arrive without anyone who signs in. The site's own
  people are untouched, and a file with open content needs no passphrase for
  the people it leaves.
- **Migrations:** 047 adds the change counter, and records on each server
  which change it serves.
- **Upgrade notes:**
  - Set `CROMBOLO_NODE_ID` to a stable name per server, so the Servers check
    follows the same server across restarts.
  - Changes to different kinds of published content (pages, media, schema,
    domains) now save one at a time; pages already did.

## v0.24.1 — 2026-10-22

v0.24.0 was tagged but never published: two of its release checks still
expected a page save without the new revision. This is the first 0.24 release
on npm, and everything below ships in it.


- **An older copy of a page can no longer overwrite a newer one.** When someone
  else saved, published or rolled back a page after an editor opened it, that
  editor's save is refused instead of silently replacing their work. The editor's
  changes stay on screen, and a banner offers to open the latest version in a new
  tab. `172`
- **Approvals publish what was approved.** A page changed after it was approved,
  without the request following the change, goes back to its editor to be
  approved again. `172`
- **The assistant cannot overwrite a change made while you reviewed its
  proposal.** Its check and its save now happen as one step. `172`
- **Webhooks and change e-mails survive a crash.** Every page and media change
  records what it announces in the same step as the change. A restart, a crash
  or a command-line publish can no longer lose a webhook or a change e-mail,
  and a quick publish then unpublish sends both. `171`
- **See and resend what failed.** `crombolo events status`, `crombolo events
  failed` and `crombolo events retry` cover webhooks, change e-mails and the
  changes waiting between them. A new health check, Outgoing changes, warns
  about failures or a backlog. `171`
- **Fixes:** `171`
  - A webhook delivery left behind by a server that stopped mid-send is sent
    again after 15 minutes.
  - Old deliveries, delivery logs and cache records are pruned.
  - A slow background job no longer delays scheduled publishing.
  - Emptying the recycle bin in the backoffice raises a "deleted" webhook for
    each page, as the command line does.
- **Migrations:** 046 adds the outbox of changes waiting to be passed on, and
  links webhook deliveries and change e-mails to the change they came from.
- **Upgrade notes:**
  - Deliveries carry a new `Webhook-Event-Id` header. Receivers should still
    de-duplicate on `Webhook-Delivery`, since delivery is at least once.
  - A page change's audit entry is now saved with the change: if it cannot be
    written, the change fails too.
  - New setting `CROMBOLO_EVENT_RETENTION_DAYS` (30): how long delivered
    webhooks and their log are kept.
  - Management API clients that save pages must read the page first and send its
    `ETag` back as `If-Match`. A user's save without one is refused with `428`,
    and a save from an older copy with `412`. `If-Match: *` overwrites
    deliberately. Command-line, scheduled and imported changes are unaffected
    (`docs/api-contract.md`).

## v0.23.0 — 2026-10-22

- **The same rules from everywhere.** Every way of changing a page follows the
  same permission, approval, audit and webhook rules: the backoffice, the command
  line, approvals, scheduled publishing and form workflows. `170`
- **The command line respects approval workflows.** `content publish` and
  `content unpublish` refuse a page an approval workflow covers, and say why.
  `--skip-approval` goes ahead anyway, and the audit log records that it did.
  `170`
- **Command-line changes name who made them**: `CROMBOLO_ACTOR`, else the
  operating-system user. Publishes by approval name the approver, scheduled ones
  "The schedule", and form workflows "The form "<name>"". `170`
- **Fixes:** `170`
  - `content unpublish --at` scheduled a *publish*. `--at` is now when the
    command's own action happens, and `--until` the opposite.
  - Publishing several pages from the command line, and create-and-publish, now
    succeed or fail as one change.
  - Scheduling from the command line covers every language named.
  - A publish that only schedules no longer fires a webhook.
  - Scheduled publishing tracks redirects.
  - Restoring a page fires a "moved" webhook. New "sorted" and "rolled back"
    webhook events.
  - Saving a form submission as a page is now in the audit log.
- **Migrations:** none.
- **Upgrade notes:**
  - Scripts that publish pages under an approval workflow are refused unless they
    pass `--skip-approval`.
  - Check scripts that use `content unpublish --at`: it now does what it says.
  - A new package, `@crombolo/content`, ships with the rest.

## v0.22.0 — 2026-10-22

- **Apps on other websites can call the Delivery API**, from the addresses in
  `deliveryApi.cors.allowedOrigins` or `CROMBOLO_DELIVERY_API_CORS_ORIGINS`.
  None by default. `051`
- **A typed client for apps.** `crombolo generate --delivery --out <file>`
  writes types for every content and media type. `@crombolo/delivery-client` is
  the client, installed in the app. `052`
- **Draft preview in an app**, with a preview key or a short-lived editor token,
  and a "preview in app" button in the backoffice once it is set up
  (`preview.url`, `preview.tokenMinutes`). `053`
- **One call answers an address.** `GET v2/route` returns the page, a redirect or
  the not-found page, minding domains and languages. `054`
- **Search and sharing details for apps.** `seo=true` adds meta tags, language
  versions and the public address. The sitemap is available as data, and
  `seo.publicUrl` / `CROMBOLO_PUBLIC_URL` sets the public address. `055`
- **Apps can render forms themselves** (`GET v2/forms/{key}`), and take
  submissions from allowed addresses. **Security fix:** a form picked on a page
  no longer exposes its workflows' settings through the Delivery API. `056`
- **Caching for CDNs.** Cache lifetimes for pages and API answers can be set
  site-wide, per type, and per page or media item ("Keep copies for"). Pages
  get ETags, and cache tags are optional. Members-only pages, previews and form
  answers are always private. `057`
- **Navigation menus.** Editors build menus in the Library, by alias, for
  templates and `GET v2/menus/{alias}`. The starter site's header uses one.
  `141`
- **Migrations:** none.
- **Upgrade notes:**
  - Caching is off by default.
  - Members-only and preview responses are always private, whatever is
    configured.
  - Other websites are refused until you allow them.
  - A user without media Change permission sees media read-only.

## v0.21.0 — 2026-10-20

- **Read-only groups only read.** `088`
  - Media gets Browse and Change permissions, enforced on every media change and
    hidden in the backoffice.
  - Library element permissions are enforced by the server.
  - A save that changes a property the user may only read is refused, naming
    the property.
  - Asking to publish or unpublish a page needs Read and Update on it.
  - Turning URL tracking off site-wide needs Settings.
- **Fix:** external sign-in (Google, Microsoft and the like) returns visitors to
  the address they used, not always the configured application URL.
- **Migrations:** 045 gives every group with the Media section the new media
  permissions.
- **Upgrade notes:**
  - No group loses media access. Untick Change to make a group's media
    read-only.
  - Writers can no longer delete, move, publish or unpublish elements through
    the API.
  - Register each address the site answers on as a callback with your sign-in
    provider.

## v0.20.0 — 2026-10-19

- **Scheduled publishing through approval.** When a workflow allows it ("Requests
  can say when to publish", off by default), an editor sends a page with a
  publish or unpublish time, and approval schedules it. `029`
- **A scheduled request stays open until it runs.** Edits meanwhile follow the
  workflow's on-edit rule. A direct publish by someone who may skip supersedes
  the request, and withdrawing it clears the schedule. A time already passed
  publishes at once. A page that cannot be published at its time goes back to
  its editor. `029`
- **Migrations:** 044 stores requested times on approval requests.
- **Upgrade notes:**
  - Requests already in progress are unaffected.
  - Times are stored in UTC and run within about a minute.

## v0.19.0 — 2026-10-19

- **Security:**
  - A backoffice change made with a browser session must come from the site
    itself, which blocks forged requests from other sites. API tokens are
    unaffected.
  - Member sign-in and registration refuse posts from other origins.
  - With `allowLocalLogin: false`, password and two-factor sign-in are refused,
    not just hidden.
  - Two-factor sign-in must be turned off, with a code, before another
    authenticator app can be set up.
  - Draft previews show only to editors who can read the page.
  - Patching a page needs Update. Pages a user may not read are left out of
    list views, and version reads check permissions.
- **Migrations:** none.
- **Upgrade notes:**
  - Behind a proxy that ends TLS, set `applicationUrl` or forward the host
    header.
  - Password sign-in through the API stops working when local login is off.
