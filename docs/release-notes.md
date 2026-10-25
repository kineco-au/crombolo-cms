# Release notes

What each release changed, newest first, for the people running a site. Each
release's upgrade notes say what an operator must check or do. Story numbers
point at `docs/stories/`.

## Unreleased

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
