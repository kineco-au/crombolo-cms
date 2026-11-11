# Release notes

What each release changed, newest first, for the people running a site. Each
release's upgrade notes say what an operator must check or do. Story numbers
point at `docs/stories/`.

## Unreleased

### Features

- **An extension's screens are described, not shipped (323).** A server half declares
  `screens`, each a `view` and its `actions`, returning a screen from a small catalogue:
  tables, forms with the back office's own page, media and member pickers, buttons,
  notices, tabs and progress. The back office draws it with its own components, so none
  of the extension's code runs in the page and the screen needs no permission. A
  manifest entry names one with `"screen"` at `"crombolo.schemaVersion": 6`.

- **An extension's templates carry no script (330).** What an extension's component renders
  into a page is held to the HTML Sanitizer API's safe baseline: script, frames, objects,
  embeds, event handlers and `javascript:` links are removed, and the rest stays as written.
  Each removal is logged once a boot, naming the extension and the component.
- **What each extension did (327).** Installed shows, per extension, everything it did
  through the CMS and whom it did it for: its writes, reads counted per minute, requests
  out, rows in its own tables, calls, screens, and what its grant refused, with counts at
  the top, filters by kind and person, and an export. Nothing it sent or stored is kept,
  only what kind of thing it was. `CROMBOLO_EXTENSION_ACTIVITY_DAYS` (14) sets how long.
- **An extension installs into a root of its own (326).** `crombolo extension install` and
  the Marketplace install into `extensions/<id>/`, with its own lockfile, and record it in
  `crombolo.extensions.json`; the site's `package.json` and `bun.lock` no longer change.
  Commit the root's `package.json` and `bun.lock` and the record; `node_modules` stays
  ignored. A site package carries them, and an apply installs each root.
- **An extension acts for the person using it (325).** A new permission,
  `user.delegate`: "Act for the person using it in the back office: it can do anything
  they can do here, and everything it does is recorded against them." A job or an event
  acts for whoever granted it. It never installs or grants extensions, or changes users
  and groups, for anyone. The audit log records its writes as the person, with the
  detail "<Extension>, for <person>". It replaces `actAs`.

- **The install panel says what you accept at a glance (324).** Each extension shows one of
  three levels, Limited, Acts as you or Unrestricted, computed from what it asks for, with
  what it sees, changes, sends to and adds; each permission and its reason open on request.
  The same appears in Installed, on every row, and from `crombolo extension install` and
  `grant`, which ask at a terminal before granting either upper level.

### Changes

- **Only an administrator installs, removes or grants an extension (324).** Settings access
  no longer installs one from the Marketplace or removes one from Installed; it still turns
  one off and on. Acts as you and Unrestricted also need a package that is signed, vouched
  for by the host, or built on this machine.
- **Settings is one grant again (322).** Structure, Code and Workflow set-up follow the
  Settings section. The three grants story 296 added, Structure, Components and Workflow
  set-up, are no longer offered in a group's Sections, and the menu under Content shows
  Structure and Code to whoever holds Settings.

### Upgrade notes

- Someone who installed extensions with Settings access alone needs an administrator now,
  or a group that makes them one.
- **An unsigned extension that runs code in the back office, or acts for the person using
  it, can no longer be granted (324).** One already granted keeps running; a new grant, an
  upgrade that asks for more, or a fresh install needs a signed build. A host that wants
  Unrestricted extensions turned on only in the config sets
  `CROMBOLO_UNRESTRICTED_EXTENSIONS=config`.
- **An extension installed as a dependency stops (326).** One listed in the site's
  `package.json` is named at boot and in Installed and is not run. Remove it from
  `package.json` and install it again with `crombolo extension install`, which gives it a
  root of its own. A bundle the site's config wires in `bundles` is the site's own code and
  stays a dependency. A dependency that links to a workspace package still runs outside
  production, and is refused in production.
- **`actAs` is retired (325).** An extension asking for it is refused, and stops until a
  version asking for `user.delegate` is installed: `crombolo extension migrate <dir>`
  rewrites one, and an administrator grants it again. `extensions.<id>.actAs` is gone
  from the config, and `user.delegate` cannot be granted there: grant it in Settings,
  under Extensions, or with `crombolo extension grant --delegate-to <user key>`.
  `--act-as` is gone from `extension install` and `extension grant`.
- **Migration** `AddExtensionActivity` adds the `extension_activity` table (327).
- **Migration** `AddBundleGrantDelegate` adds `bundle_grant.delegate_key`, copying the
  installer from each grant that acted for its installer. `act_as` stays, unread, until
  a later release drops it, so this release upgrades node by node.
- Bundle schema 6 is what this release writes; schema 5 is still read, unchanged. An
  extension that wants a described screen moves to 6.
- A group that held Structure, Components or Workflow set-up without Settings loses those
  screens until it is given Settings. A group file in `schema/user-groups/` that names
  one of them still loads, with the alias dropped. Nothing else changes for a group that
  holds Settings.

## v0.60.0 — 2026-11-10

### Features

- **A host makes custom-table owners itself (321).**
  - `@crombolo/crombolo/host` exports `ownerSetup({ siteName, owner, database, grantee })`:
    the role, schema and statements the CMS would use for the site's tables or an
    extension's, with no connection. A host that never gives a site's database user
    `CREATEROLE` runs them as its own administrator before the site boots, and the
    boot finds them and carries on. `OwnerSetupNeededError` prints the same statements.
  - **A new permission, `data.tables`:** "Keep its own data in the site's database".
    An extension with tables asks for it, and one asking for it must have tables, so
    a host can tell from the package which extensions need a role and schema.

### Upgrade notes

- An extension with tables, at schema 4 or later, must ask for `data.tables`, or the
  boot refuses it. No extension crombolo ships has tables. An installed one asking
  for it in a new version is off until it is granted again.

## v0.59.0 — 2026-11-10

### Features

- **An extension's back-office code is asked for, built and kept apart (320).**
  - **The layout (bundle schema 5):** an extension keeps its server code in
    `src/server/` and its back-office code in `src/backoffice/`, and neither half
    imports the other's folder.
  - **The build:** back-office code may be TypeScript and import npm packages. The
    CMS builds it and serves only that build, so an extension's server source and
    `package.json` are no longer fetchable. Its server half's process can no longer
    read its back-office code.
  - **A new permission, `backoffice.code`:** any back-office code needs it. Its
    screens act as whoever is signed in, with everything that person can do, and
    nothing keeps them apart from the site. The Marketplace and Installed show it
    first, as a warning that names the publisher and what its signature shows, and
    ask for a confirmation of its own before installing or granting. The CLI prints
    the warning and asks.
  - **`crombolo extension migrate <dir> --reason "…"`** rewrites a schema 4
    extension into the layout.
  - **A refused package says why:** the Marketplace says why a package is not an
    extension this site takes.
- **Simple Redirects and Entra** use the layout, and ask for `backoffice.code`.

### Fixes

- **An extension whose event handlers send requests out** may ask for `http.outbound`
  for them; it was refused as a permission none of its capabilities uses.

### Migrations

- None.

### Upgrade notes

- **Every installed extension written before this release is refused** until its
  author runs `crombolo extension migrate` and publishes it again. Installed shows
  why. A site that depends on one stays on its current CMS release until then.
- **A site whose config grants Simple Redirects or Entra** adds `backoffice.code` to
  that grant, or the extension stays off, saying what was not granted:
  `redirects: { grant: ['backoffice.code', 'redirects.read', 'redirects.write', 'content.read'] }`.
- **A host that serves an extension's files itself** serves them from
  `.crombolo/extensions/<id>/backoffice/`, not the package.

## v0.58.1 — 2026-11-10

### Fixes

- **The release's demo bundles are signed when Sigstore's log is slow.** Signing gives
  the log a minute to answer rather than five seconds, after which the client retried an
  upload the log had already taken, and the retry was refused as a duplicate. 0.58.0's
  packages reached npm, but its demo bundles were not attached to the release.

### Upgrade notes

- None: install 0.58.1 in place of 0.58.0.

## v0.58.0 — 2026-11-10

### Features

- **An administrator sets where a page's search and sharing values come from (317).**
  - A content type's `[seo]` table gives its pages' title, description, sharing image
    and preferred address when a page gives none: fixed text, `{alias}` for a property
    of the page, `{#key}` for a dictionary word, or a mix.
  - A page's own Search & sharing fields take the same tokens.
  - In a page's Search & sharing view, an administrator changes each value in place,
    with the page's properties offered after `{` and dictionary words after `{#`.
    Saving asks "This page only" or "Every <type> page", and says how many pages the
    second changes. Where the schema files are read-only, only the first is offered.
  - The view says where each value came from, including the type's setting.
- **A host vouches for the site bundles it applies (319).** `contentImport` and
  `contentCheck` from `@crombolo/crombolo/host` take `{ vouchedBy: 'host' }` as a
  third argument: a production site applies the bundle without a signer of its own,
  still refuses an older version than one the host already vouched for unless
  `allowDowngrade` is given, and still meets the value-migration gate. The run is
  recorded as signed by `host`, and `site runs` lists it as vouched for by the host.
  No request can vouch: the remote protocol, the transfer dashboard and the back
  office's install never pass it.

### Fixes

- **A host's tool reaches its own service from the back office again (318).** The back
  office's content security policy lets its screens reach `config.host.origin`, the
  one origin it already vouches its user to.

### Migrations

- `AddContentTypeSeo` (070): a nullable `seo` column on `content_type`, holding a
  type's `[seo]` values.

### Upgrade notes

- **A host that passed `provenance: 'local'`** to `contentImport` or `contentCheck`
  passes `{ vouchedBy: 'host' }` as the third argument instead. The field is gone from
  `TransferInput`. A bundle vouched for this way still meets the downgrade check and
  the value-migration gate, which `provenance: 'local'` skipped.
- **A page title with braces in it,** such as `{beta}`, now reads `{beta}` as a
  property of the page. Write `{{beta}}` to keep the braces.

## v0.57.0 — 2026-11-10

### Features

- **A site package says what it is (306).** Every bundle states its `bundleType`: `"site"`,
  the site or a part of it moved elsewhere, or `"extension"`, someone's addition to a site.
  - Each way in takes only its own kind: `site apply`, `push`, `pull` and `site deploy` take site
    packages; `bundle install` and the Marketplace take extensions. A site package is never
    installed from a registry.
  - Applying a site package opens with what it replaces: its config, its `package.json`, and the
    dependencies that adds and removes.
  - The integrity hash now covers `bundle.json` and the package's identity, and an empty hash is
    refused.
  - `site runs` labels each run with its kind. `bundle uninstall --revert-content` puts back an
    extension's content.
  - `bundle build <name>` builds a Bundle Editor bundle as an extension, and `bundle check`
    validates an extension package.
  - A remote names the bundle formats it reads, and the CLI checks before building.

- **Each permission an extension asks for says why (308).** Bundle schema 4 gives each
  permission a reason, which the install shows. Every area asks to read and to write apart:
  content, media, members, users (read only), forms, form entries, the dictionary, content types,
  webhooks, workflows, redirects and sign-in providers. `http.outbound`, `routes.public`,
  `events.content` and `actAs` are new too.
  - Extensions reach the areas through the Management API with the new `api` capability, held to
    their grant.
  - Acting as itself, an extension holds nothing it was not granted, and is never an
    administrator.
  - The install has no separate question about server code.

- **A grant is what lets an extension run (309).** An extension runs only while its grant covers
  what its installed version asks for: one that asks for more waits for a grant, and one that asks
  for less stays on, narrowed.
  - Its screens and files are off with it, and every capability call is held to the grant.
  - Installed shows **Grant** for one waiting, and `crombolo bundle grant` grants from the CLI or
    on a remote.
  - An extension wired in the config is "Developer installed".

- **A granted extension runs without wiring (310).** Installing an extension and granting it is
  all it takes: nothing is imported into `crombolo.config.ts`, and it runs after a restart.
  - A site that grants from its code lists the extension under `extensions` in the config, naming
    what it grants; that is shown as "Developer installed".
  - An extension may declare settings, which an administrator sets in Installed or with
    `crombolo bundle settings`. A value in the config's `extensions` entry locks it, and secrets
    are stored sealed. Changed settings take effect when the site restarts.
  - Simple Redirects and Entra offer the section they appear in as a setting.

- **Each extension runs in a process of its own (311).** An installed extension's server half
  runs under Deno, apart from the site, and can reach only what it was granted: no environment
  or secrets, none of the site's files, no database connection, and only the addresses its grant
  names.
  - Its own tables are reached through the site, which runs one statement at a time on the
    connection that reaches only them, and refuses `ATTACH` and role changes.
  - One that throws, hangs or stops fails that request, and the site keeps serving. It is started
    again for the next.
  - One that cannot run apart is left off, and Installed and the health check say why.
  - Extensions are written against the new `@crombolo/extension` SDK.
    `@crombolo/crombolo/bundle` still works.

- **An extension's components render in its own process (312).** An extension's components stay
  in its package and render apart from the site; the page, its layouts and the site's components
  render as before.
  - Its content types name them by its id, `brochures/brochure`, and the template picker lists them
    under its name, read-only.
  - `<Extension use="brochures/card" />` puts one in a site component.
  - Its page templates sit in a site layout picked when it is installed, or later in its settings.
  - It needs the `templates` permission. A render that fails leaves its place empty, and the page
    still renders.
  - Components an earlier install copied into the site are named by `bundle list` and Installed,
    to review.
  - The Bundle Editor makes two kinds of bundle: an extension for other sites, whose templates and
    partial views render in its own process, or a site bundle to move this site, applied with
    `site apply`.

- **A site bundle is applied only from a signer you trust (316).** Every site bundle a site makes
  is signed with its own key, and in production a site applies one only when a key or a CI build
  it trusts signed it.
  - Settings → Trusted signers lists them, as GitHub lists SSH keys: this site's own key, keys of
    people and other sites, and CI builds. Administrators add, rename and remove them, and each
    change is audited.
  - `crombolo keys create` makes a key of your own; `site build --sign-with` signs with it.
    `crombolo keys trust`, `keys untrust` and `keys trusted` manage the list, and `crombolo site key`
    shows this site's key.
  - An older version than one already applied from the same signer is refused, unless
    `--allow-downgrade`, which the audit log records.

- **The back office reaches only the addresses extensions declared (313).** Every back-office page
  sends a content security policy: it talks to the site, and to the addresses granted extensions
  declare, and the browser blocks the rest. What it blocks is written to the site's log. An
  extension's `http.outbound` now says it covers its screens in your browser too.

- **Extensions, by name.** An npm package that adds to a site is an extension everywhere: Settings
  → Extensions (`dashboard/extensions`, the old address redirecting), its words, and
  `crombolo extension install`, `uninstall`, `list`, `grant`, `settings`, `disable`, `enable`,
  `purge`, `check` and `build`. The old `crombolo bundle …` names say where each went. A bundle is
  the file format, and a site bundle a whole site's package.
  - Extensions are published with the `crombolo-extension` keyword. The Marketplace still finds
    those with `crombolo-bundle`.
- **Settings, tidied.**
  - Every tool opens with a title section under its breadcrumb, and Umbraco's own tools, such as
    Webhooks, have shorter headers to match.
  - Search & sharing and Search indexes are one tool, Search, with a tab for each.
  - Relations is under Site, Trusted signers has a description, and Redirects reads "Configure the
    site's redirect rules".
  - CI access says when pull and push are off, and how to turn them on.
  - Trusted signers has **Add my key**, with the steps to make one.
- **Every box in the back office**, and the Settings cards, heads its title on a pale
  brown band. A page's Search & sharing
  view is one card: the result as a search engine shows it, with the page's name, then its
  searchable property values: a value nothing sets says "Not configured", and an empty one shows
  `-`.
- **The demo site** says what Crombolo does for editors and for developers.

### Migrations

- 065 `AddTransferRunBundleType`: a nullable `bundle_type` column on `content_transfer_run`.
- 066 `AddBundleGrantReach`: `origins` and `act_as` on `bundle_grant`.
- 067 `AddExtensionSettings`: the `extension_setting` table, an extension's saved settings.
- 068 `AddBundleKind`: a `kind` column on `bundle`, what a Bundle Editor definition builds.
- 069 `AddTrustedSigners`: the `trusted_signer` table, and `signed_by` on `content_transfer_run`.

### Upgrade notes

- **Breaking, the CLI (306):** the site commands moved under `crombolo site`, and the old names
  now only say where:
  - `export --site` is `site export`, and `import` is `site import`;
  - `bundle build` is `site build`, `bundle apply` is `site apply`, `bundle deploy` is
    `site deploy`;
  - `bundle runs` is `site runs`, `bundle revert` is `site revert`, `bundle check-code` is
    `site check-code`;
  - `bundle export --root` is `site export --subtree`, and `bundle export --source` is
    `content export`.
  - `bundle build <name>` is now the extension build.
- **Breaking, bundles (306):** bundle format 8 is the oldest read. Build site packages again with
  `site build` or `site export`, and download Bundle Editor bundles again.
  - An installed extension whose `package.json` has no `"crombolo.bundleType": "extension"` is
    turned off, and the site starts without it. The health check names it. Its author adds that
    one line and publishes a new version.
  - The CLI and a remote must be on releases that read the same bundle format: upgrade the
    remote first.
  - The product site's committed bundle is format 8, so the platform reads it only once it runs
    this release.
- **Breaking, extensions (309):** an extension installed before this release and not wired in the
  config has no grant, and is off after the upgrade, its screens included. Grant it in Bundles →
  Installed, or with `crombolo bundle grant`. Simple Redirects and Entra, wired in the config,
  are granted by it.
- **Breaking, extensions (308):** bundle schema 4 is current. `documents.read` is now
  `content.read`. A schema 3 extension already installed keeps running, but a new install or an
  upgrade to a schema 3 version is refused. Its author moves `permissions` to an object, a reason
  for each, and `"schemaVersion": 4`. Event handlers then need `events.content`, and site routes
  `routes.public`.
- **Breaking, extensions (311):** an extension's server half runs under Deno.
  - **Containers:** an image must be glibc-based, such as `oven/bun:1-slim`. Alpine has no Deno
    build, and on it extensions do not start. `CROMBOLO_DENO` names a Deno binary to use instead.
  - **Extension authors:**
    - Bun's own APIs (`Bun.file`, `bun:sqlite`) are not available. Use web APIs, the `node:`
      built-ins Deno supports, and the host's capabilities.
    - `context.site()` is not offered: read content through `bundle.api`.
    - An extension can no longer offer `middleware`, nor add form field types until story 312.
  - **Imports:** a server half the site's config still imports runs inside the site, unconfined,
    as before. List it under `extensions` instead.
- **Breaking, extensions (312):** an extension's payload may not carry `components/` or value
  migrations (`schema/migrations/*.ts`): both are code. Its author moves its components into the
  package, declares them in the factory's `components`, names them in its schema as
  `<id>/<component>`, and asks for `templates`. Its components carry no browser code.
- **Breaking, site bundles in production (316):** a production site applies a site bundle only
  when a signer it trusts signed it. Before upgrading production:
  - set `CROMBOLO_SECRET_KEY` on each site that makes site bundles, so it has a key to sign with;
  - on production, trust the sites and people that make its bundles: `crombolo site key` on
    staging, then `crombolo keys trust Staging "<its line>" --site` on production, or Settings →
    Trusted signers;
  - a site that deploys from CI with `--sign` adds its repository as a trusted CI build, or lists
    it in `CROMBOLO_BUNDLE_SOURCES`, which is now read as one.
- **Extensions (313):** an extension's screens may reach only the origins it declares in
  `http.outbound`. One that calls another service from the browser adds that origin, with a reason.
- **The CLI and extensions:** `crombolo bundle install` and the other extension commands are now
  `crombolo extension …`; scripts change the word. `bundle sign`, `verify` and `digest` stay.
  Publishers add the `crombolo-extension` keyword.
- **Breaking, the CLI (310):** `bundle install --wire` is gone. Importing an extension's server
  half in `crombolo.config.ts` still works, with a warning at boot: replace it with an entry under
  `extensions`, `{ redirects: { grant: ['redirects.read', 'redirects.write'] } }`, and drop the
  import and its `bundles` line.


## v0.56.0 — 2026-11-08

### Features

- **Site code writes content and handles its events (298).** `site().content` reads, creates,
  updates, publishes, unpublishes and deletes pages, values by alias, as the API user the config's
  `content.actAs` names, through the same checks, permissions and approval workflows as the back
  office. `events` in the config handles content events by the names webhooks use, each run as a
  site job with the site's tables and `site()`. Every change is audited as the API user, naming
  the route, action, job or event that made it.

### Security

- **Checking a bundle runs none of its code (300).** A check never imports the value migrations a
  bundle carries (`schema/migrations/*.ts`); it lists them as running at install. Installing one
  is installing code: it needs code installs on (`runtimeInstalls`) and install code asked for
  (over the remote API, `Crombolo.Remote.InstallCode`). `bundle apply --local` is unaffected.
- **A webhook reaches only what it should (301).**
  - A header's `env:NAME` takes only a variable starting `CROMBOLO_WEBHOOK_`,
    `CROMBOLO_REVALIDATE_SECRET`, or one listed in the config's `webhooks.headerVariables`.
  - Deliveries, and a bundle's event `fetch`, go to no loopback, private, link-local, CGNAT,
    multicast or mapped address, and connect to the address that was checked.
    `webhooks.allowPrivateAddresses` allows them, and is on by default for a development site.
  - The delivery log keeps the status, `Content-Type` and 1 KB of a text answer, nothing else.

### Fixes

- Leaving a page, a media item or a blueprint while it opens no longer reports an error, or
  takes you back to it after you have gone elsewhere.

### Upgrade notes

- **Breaking, webhooks (301):** a webhook header naming any other server variable stops
  delivering, and its log says why. List the variable in `webhooks: { headerVariables: [...] }`,
  or rename it to start `CROMBOLO_WEBHOOK_`. A production webhook sending to a private address,
  such as a Next.js front end on the same host, needs `webhooks: { allowPrivateAddresses: true }`.
- Delivery log entries from before the upgrade keep the whole answer until they are pruned after
  `CROMBOLO_EVENT_RETENTION_DAYS` (30 by default). A site that keeps them forever (`0`) should
  clear `webhook_log` itself.
- A bundle bringing schema migrations now needs install code asked for (300).
- `site().content` needs nothing unless the site wants it: without `content.actAs`, it refuses
  every write, saying why (298).

## v0.55.0 — 2026-11-08

### Changes

- **Aliases come from names in the form and workflow designers,** as in Umbraco's own editors.
  A new form, field, workflow or stage has its alias follow its name or caption, locked, until it
  is saved or unlocked and written by hand; a caption naming a dictionary item gives the item's
  name. A saved one keeps its alias when renamed, and unlocking it says that what used the old
  alias stops finding it.
- **The form designer's Alias field has no line under it.**
- **The Crombolo logo at the top left no longer lights up on hover;** it is a link home.
- **A page's history opens in a panel.** The History box on the Info view says when the page last
  changed and who changed it, and View all changes slides in every version of the page, newest
  first. Choosing one shows what changed from the version before: each property, its value before
  and after, with who made the change and when. On a page in more than one language, chips by
  culture code, `en-GB`, choose the language, the default first.
- **The tree beside Approvals is one Pending folder** of every request still pending, those
  waiting for you first and marked with an inbox icon. Waiting for me and Decided are gone from
  the tree; the list still shows decided requests.
- **Dictionary words in more of a form,** the default value of a short or long answer among them.
  Typing `{#` anywhere in a box offers the dictionary's items, and the one chosen goes in where the
  cursor is, so `Ask for {#contact.name}` is one box.

### Fixes

- **Every box and switch in the form designer, and on the sign-in screens, has a label,** so screen
  readers name it and the browser console no longer warns that one is missing.

## v0.54.1 — 2026-11-08

v0.54.0 was tagged but not published. Its notes apply to this release.

### Fixes

- **A page opened again before its last load finished** no longer reports an error: the editor
  is loading once, not twice.

## v0.54.0 — 2026-11-08

### Features

- **Dictionary words as chips, in forms and on pages (297).** `{#key}` names a dictionary item
  in a form's words and in a page's text boxes, text areas and rich text, inside blocks too, and
  reads as the item's words in the page's language. In the back office it shows as a chip: click
  its words to see and change them in every language, or × to remove it. Typing `{#` offers the
  items. Search finds a page by the words, and a block label's `{#key}` shows them too.

### Changes

- **Workflows are in Structure, below Forms.** Their tree, with folders, sits beside the list and
  the designer. The list has no Create button: the "+" beside Workflows or a folder starts one,
  as for forms and content types, and Forms' tree has the same "+". Someone with Workflow setup
  and not Structure finds them under Structure, beside forms.
- **Approvals is in the menu under Content,** after Pages, and has no header tab. It is always
  there for groups that have it, and says when no workflow is set up yet. Its three tabs are now
  one list, pending requests by default, with Pending and Decided to choose what it shows and
  pages of 25. The tree beside it has two folders, Waiting for me and Decided. A request, in
  either, opens its page's Workflow tab.
- **Send for approval is in the bottom bar,** beside Save and publish, on a page its workflow
  covers; Request unpublish is in Save and publish's menu. Each asks for a note, and the times
  where the workflow allows them. The Workflow tab shows where a request stands and its history.
- **A page's template is picked in a panel that slides in,** from a tree of every component's
  folders, the first level open, with a search above it that narrows the tree by name. On the
  Info view, one
  the content type does not allow says so, and someone with Structure allows it right there:
  the type gains it, and it can be picked like the others.
- **JSX is coloured in the component editors.** Tags, attributes and their values, and `{…}`
  inside markup, have colours of their own, in page templates and blocks alike.
- **One width for the tree on the left.** Structure and Code now have the same draggable edge as
  Pages, Approvals and Forms, and the width you drag it to is kept for all of them.

### Upgrade notes

- Forms write a dictionary item as `{#key}` now, not `#key`. A site whose schema the server may
  write has its form files rewritten as it starts; elsewhere `#key` still reads for this release,
  and `bundle build --check` reports each one as `bare-dictionary-word`. Write them `{#key}`.
- `section/forms/view/workflows` and `section/settings/dashboard/workflows` still open the
  workflows; Approvals keeps its address, `section/workflow`.

### Fixes

- **Document Blueprints keep the Structure tree.** Opening them no longer hides the tree beside
  them or shows a Settings trail; the menu under Content marks Structure, as for content types.

## v0.53.2 — 2026-11-08

v0.53.1 was tagged but not published. Its notes, and v0.53.0's, apply to this release.

### Features

- **The Library in content files (242).** Folders under `content/library/` are Library folders,
  nested, with their elements, and a page's Form picker can name a Library form by its path, or a
  form by its alias. `bundle export --source` writes both back the same way.
- **Code, not Components or Templating.** The row under the header and the tree beside it now
  share one name for components, modules, stylesheets and scripts.

### Fixes

- **The local Postgres suite has room for its shards (231).** The compose `db` allows 400
  connections, so six shards side by side no longer run out. Run `docker compose up -d db` once.
- **A node records itself in one step.** A node registering at boot and on its first poll at once
  could both find no record of it and both try to add one, and the second failed.

### Upgrade notes

- **No migrations.**
- **A developer's local Postgres** needs `docker compose up -d db` once, for its new connection
  limit. Sites are unaffected.

## v0.53.1 — 2026-11-08

v0.53.0 was tagged but not published. Its notes apply to this release.

### Fixes

- **Leaving a page while it opens no longer throws.** The editor went on loading after it had been
  closed, and reported an error that changed nothing. Clicking from one place to another quickly
  could set this off.
- **The menu under Content follows Home** however Home is reached.

## v0.53.0 — 2026-11-07

### Features

- **Choose what a group sees under Content (296).** A user group can be given Structure,
  Code, Forms or Workflow setup, in its Sections, each without the rest of Settings. The
  server enforces each one, and the row under the header follows them.
- **Forms is part of Structure.** It is a node in Structure's tree, with its folders, forms and
  entries, so the row under the header is now Pages, Structure, Code and Workflows. Create
  under Content Types offers Form. Someone with Forms but not Settings finds their forms under
  Structure too, and old addresses still work.

### Upgrade notes

- **No migrations.**
- **No group loses anything.** Groups keep their sections, and whoever holds Settings has Structure
  and Code. An administrator has Workflow setup. To narrow a group, take Settings away from it
  and give it what it needs in Users, or in its `schema/user-groups/*.toml`:
  `sections = ["content", "structure"]`.
- **Workflow setup is a new choice.** Setting up workflows was for administrators only, and it
  still is until a group is given it. Deciding on a page, in Approvals, is unchanged.
- **Links to Forms keep working,** with Structure marked in the row under the header. The Forms
  folder in Content Types no longer shows there, though the types in it are still in use.

## v0.52.2 — 2026-11-07

v0.52.1 was tagged but not published: a browser test of ours clicked on while a page was still
opening. Its notes and v0.52.0's apply to this release.

### Features

- **Modules beside your components (292).** Plain `.ts` files in `components/` now show in the
  back office, and Module in the create menu starts a new one. They open, save and rename as
  components do, and are checked as `.ts`.
- **One form in every language (293).** A form's words can name dictionary items, such as
  `caption = "#contact.name"`, so a translated site needs only one form. Plain words are
  unchanged. `bundle build --check` reports a name the dictionary doesn't have.
- **Dictionary suggestions in the form editor (294).** Typing `#` in a form's text box lists
  dictionary items, and it says what one reads as.
- **A field's help and messages in the form editor (295).** Help text, the message when a field
  is left empty, and a pattern with its message can now be set there, not only in the file.
- **Entries know their language (293).** A submission saves the language it was filled in, and
  Entries can filter by it.

### Fixes

- **A site built into a bundle keeps its `.ts` files (292).** They were left out, so a view
  importing one failed once the bundle was applied.

## v0.52.1 — 2026-11-07

### Fixes

- **The view editor knows your site's views.** An import such as `../shared/layout.tsx` no
  longer shows as an error in the back office's code editor, and one that really is wrong
  still does. A view opens in its own folder, with the site's other views beside it.
- **The demo site's dates are right in any time zone.** v0.52.0's tests failed on a server
  east of Greenwich, which stopped that release reaching npm.
- **A session ending asks you to sign in, on every screen (291).** Screens such as Forms used
  to show an error, or look empty, with no way back. They now open the sign-in dialog, and
  carry on once you have signed in.
- **The word "false" no longer shows above Forms and Workflows.**

### Upgrade notes

- Nothing to do. v0.52.0 was tagged but not published, so its notes below apply to this
  release.

## v0.52.0 — 2026-11-07

### Features

- **Home is where the back office opens (288).** The Overview is now Home: signing in
  opens it and the logo leads back to it, for anyone with the Content section. It holds the version and
  system information, which replace the logo's popover. Opening Content now goes
  straight to your first page, or says there are none yet. Settings has a breadcrumb
  on its cards, and every trail there starts at Home.
- **A menu under Content (289).** Pages, Structure, Components, Forms and Workflows now sit
  together in a row under the header, showing what you may open. Forms has left the header,
  and Settings no longer has its Build group. Old addresses still work.
- **Forms and workflows have folders (289).** Both list in a tree beside the editor, and can
  be organised into folders, which are real folders of files in `schema/`. The Forms root
  lists every form's entries, and each form has an Entries tab.
- **From a page to what defines it (289).** A page's tree actions offer Edit content type and
  Edit template.
- **Anything turned off says why (289).** Forms and workflows say so up front when a site
  can't change them, and offer no way to try, in place of an error on saving.
- **A full demo site about Crombolo (290).** `crombolo init --template demo/crombolo` starts
  a site with a home page built from blocks, features filtered by category, people from the
  Library, a blog with tags and paging, search, a contact form and site settings, all in
  English and Spanish, with its content published.
- **A language can live at a path on any hostname (290).** `host = "/es"` in `domains.toml`
  serves Spanish under `/es` wherever the site runs, with no hostname to set.
- **Forms opens on the list of forms,** with Entries after it.
- **The theme is chosen in your profile.** The header's theme button is gone. A choice
  made in the profile now follows you to another browser, as the button's did.
- **Settings' e-mail notice is shorter.** "E-mail is not set up." expands to the details,
  with what is unavailable as a list.
- **A template's element has its name (287).** An element picked from the Library
  has `name`, in the page's culture, so a list of labels such as a post's
  categories can show it. A block's element has `name` as `null`. The Delivery API
  gives a picked element its name too, where it always sent an empty string.

### Fixes

- **Block labels show their values.** A block's label in a data type file uses `{=heading}`.
  The form the docs gave, `{{heading}}`, was shown as written, and the demos now use the
  right one. Renaming a property follows it.
- **Library elements are read in the page's language (290).** They always showed the default
  language's values, whatever the page's language.

- **Home after signing back in (288).** When a session ended, the page could stay on an
  error after signing back in. It now waits for the sign-in and loads.
- **A date is the same on any server (286).** On a server not on UTC, a date
  picker's value moved by the server's offset when a template read it, so a site
  in Australia showed a date before 10am as the day before. The value stored was
  right, and the back office showed it correctly.
- **A date with a time in a content file keeps it (286).** Built on a machine not
  on UTC, a content file's date and time was stored moved by that machine's
  offset. A date alone was not affected.
- **A date filter with a time compares the right moment (286).**

### Upgrade notes

- **A site with `{{heading}}` in a block's label:** change it to `{=heading}` in its data type
  file, or the label stays as written.
- **The product site's id is now `product/crombolo` (290),** and `demo/crombolo` is the new
  demo. Its committed bundle keeps the name `demo-crombolo`, so what the platform receives
  has the same identity. A site's `site.json` can name its bundle with `"bundle"`.

- Nothing needs migrating for dates entered in the back office: they read correctly
  once upgraded.
- A date and time that came from a content file built outside UTC is stored moved,
  and cannot be told from a real value. Correct it in the back office, or change
  and re-apply the file.
- A template that added an offset to work around this should stop.
- No migrations.

## v0.51.1 — 2026-11-07

### Fixes

- **An import reaches every running node (285).** A `bundle apply` or `import`
  run in a process of its own, such as a cron job or a one-off container, wrote
  the files and told no one. Views stayed old, `asset()` kept writing addresses
  that answered `404`, and on a network folder new `public/` files were missing
  until a restart. Nodes now pick up all of it, and a `bundle revert` does the
  same.
- **An import from the back office takes effect at once (285).** It, and a bundle
  installed from the Marketplace, left the node's views as they were.
- **A node that lost touch for over a day catches up (285).** One that missed
  instructions now looks at its views, stylesheets, scripts and `public/` again.

### Upgrade notes

- During a rolling upgrade, a node not yet on this release empties its page and
  media caches when it reads a `public/` change. It is slower for a moment, and
  serves nothing wrong.
- No migrations.

## v0.51.0 — 2026-11-06

### Features

- **A site's public folder (284).** Files in `public/` are served at the root of
  the site at the same paths, so a logo, a font, a favicon or a verification
  file needs no media item or route. `asset()` gives them a hashed address kept
  for a year, a site's middleware runs on them, and `public/.well-known/` is
  served. Bundles, `push` and `pull` carry the folder. `crombolo components
  check` names a file that clashes with a reserved path or a route, and the
  server logs a file that hides a page. `CROMBOLO_PUBLIC_DIR` sets the folder.
- **The dictionary as a file (168).** `crombolo dictionary import` and `export`
  take a `.toml` file you can write by hand, chosen by its extension, and
  `content/dictionary.toml` works among a site's content files. New commands:
  `dictionary set` for one translation, and `dictionary list --missing <iso>` to
  find what is untranslated. `dictionary import` gains `--dry-run`.
- **One media file from the command line (168).** `crombolo media import` takes
  a file as well as a folder, with `--name`, `--alt` and `--focal x,y`.
- **Alt text on images (168).** The Image media type has an `altText` field on
  every site, for editors and for templates to read as a field.

### Fixes

- **`crombolo dictionary import` reaches running servers (168).** It changed the
  database without telling them, so they showed the old translations until they
  next refreshed.

### Upgrade notes

- Bundles are now format 7. A site on 0.50 or earlier refuses one, saying to
  upgrade, so upgrade the destination first. Format 5 and 6 bundles still load.
- A `public/` file now wins over a page, a route or the generated `robots.txt`
  at its address. A site that already has a `public/` folder should run
  `crombolo components check` and read its server log before upgrading.
- A `crombolo.code` glob no longer matches `public/`, which travels on its own.
- A whole-site `pull` or `push` replaces `public/`, so a file only on the
  destination is removed. `push --dry-run` lists it.
- A site that overrides Image in `schema/media-types/` should add `altText` to
  that file. Without it `--alt` is refused, and the next schema change drops
  the field.
- In `crombolo media import`, the JSON and help now call the argument `path`,
  not `dir`.
- Migration `AddImageAltText` adds the field to Image. A site with its own
  `altText` keeps it.

## v0.50.0 — 2026-11-06

### Fixes

- **Library folders travel with their elements (283).** A bundle now carries the
  folders above an element, and a folder can be chosen as a root. An element keeps
  its folder, and a picker that starts at one still works. A revert removes the
  folders an import made unless something else now sits in them. A whole-site
  export used to leave out elements in folders; it now carries them.

### Upgrade notes

- Bundles are now format 6. A site on 0.49 or earlier refuses one, saying to
  upgrade, so upgrade the destination first. Format 5 bundles still load.
- No migrations.

## v0.49.0 — 2026-11-05

### Features

- **A marked gap in a template (281).** `<Gap reason="…" was="…">` marks a part
  a template could not keep: visitors see its children or nothing, and an
  editor's preview shows a grey box saying what is missing. `crombolo components
  gaps` lists the gaps in a site, and `components check` lists them too, without
  failing.
- **A site can be written from the public package (278).**
  `@crombolo/crombolo/transfer` gives a tool outside this repository the schema
  and bundle writers, under the same compatibility promise as the rest of the
  package.

### Removed

- **`crombolo import umbraco` (279).** The `report` and `apply` commands and
  `@crombolo/import-umbraco` have left the CMS. The command now says that
  Crombolo Cloud moves Umbraco sites. `crombolo import <file>` stays.

### Upgrade notes

- A script that runs `crombolo import umbraco` needs replacing, as it now refuses.
- No migrations.

## v0.48.1 — 2026-11-05

### Fixes

- **A request made just after a restart reaches the new server.** During a
  supervised restart the old server kept listening on the shared port for a
  second, so a page asked for right after `bundle deploy` or `crombolo
  restart` could come from the server it replaced, with what it had cached:
  a page missing, or no template. It now stops listening as soon as the new
  one serves.
- **A pushed or applied template takes effect at once.** A push, a bundle
  applied to a remote, or a revert wrote the new views, but the running server
  kept the old ones until it restarted. It now reloads them, and tells the
  site's other servers.
- **A deploy from GitLab CI signs in once.** A remote takes each identity
  token once, and GitLab gives a job one, so `bundle deploy`'s second sign-in
  (to apply, after checking) was refused. A command now signs in once per
  remote.

- **`crombolo status` no longer goes to npm.** In a folder with no
  `node_modules` above it, the check that views can load made Bun try to install
  the package, which could hang a read-only command. It now answers at once
  that views cannot load from there.

### Tests

- `tests/integration/remote-deploy.integration.ts`: a template edited on one
  machine reaches a second running server by `push` and by `bundle deploy`,
  through the real command line. The test image has `git`, which `bundle
  deploy` needs.

### Upgrade notes

- No migrations, and nothing to do.

## v0.48.0 — 2026-11-05

### The back office

- **Publishing a Library element publishes only the languages chosen, and
  "Schedule…" waits for its date** (266). Before, publishing one language of
  an element published all of them, and scheduling one published it at once.
  Element schedules are run with the pages' by scheduled publishing.
- **"Public access" opens on the rules a page already has** (267). Pages
  protected directly or through a page above them now say so in the tree,
  list views and search, so the dialog loads their rules rather than
  starting empty. How protected pages are served is unchanged.
- **Pages and elements with a publish to come are marked** (268), with
  Umbraco's clock sign in the tree, list views and the Library.
- **A page's list view searches, sorts and names who edited** (269). The
  search box and the built-in columns' sorting work, in the language shown,
  and "Created by", "Last edited by" and whether a page has children are
  filled in.
- **"Ignore user start nodes" works on pickers** (270). A content, media or
  URL picker with it on lets an editor kept to part of the site browse and
  pick from all of it; everywhere else their start nodes still apply.
- **The copy dialog no longer offers "Relate to original"** (271), which had
  no effect: copies are not related to the page they came from.
- **A list view sorts by its property columns** (276): numbers and dates in
  their own order, text in the language shown, pages without a value last.

### Search

- **Search through providers a site can replace** (273). Back-office search
  and site search each go through a provider, the database's own by default,
  and `search: { backoffice, site }` in `crombolo.config.ts` replaces either.
  A provider is given each item's text, and told of moves and deletions. A
  failure leaves the work queued, and the status checks gain a Search group.
  `searchProviderConformance` checks a provider. See `docs/search.md`,
  "Providers".

### Planned

- Stories for what Umbraco's back office and roadmap have that Crombolo does
  not yet: shared Library elements inside block editors and the Single Block
  editor (272), the back office on Umbraco 19 (277), who else is editing a
  page (274), and an accessibility pass over Crombolo's own screens (275).

### Migrations

- **063 `AddSearchRemovals`:** the `search_removal` table, which records what
  a delete for good takes away, for providers outside the database. Additive,
  and applied by `crombolo upgrade`.

### Upgrade notes

- Run `crombolo upgrade` for migration 063. A site keeping the database's
  own search needs nothing else: it searches exactly as before.
- A site that replaces a search provider should rebuild that index from the
  Search indexes dashboard, or with `crombolo index rebuild`, so the provider
  starts from every item.

## v0.47.0 — 2026-11-04

### Behind a CDN

- **A CDN's check is answered without rendering, when a site asks** (258).
  With `cache.validator = 'published'` (or `CROMBOLO_CACHE_VALIDATOR`), a
  page's or Delivery API answer's ETag comes from what was last published,
  the site's code and the Crombolo version, not from its body. Each server
  remembers what it last sent each address, so a CDN checking back gets a
  `304` with no render, and any publish changes every ETag. Public access is
  still checked on every `304`, and a request from a signed-in member always
  renders. A type can keep `validator = 'body'`, for pages that show the time.
  Off unless turned on.
- **Changing who may see a page now tells every server** (258), as a publish
  does, so a page listing only what a visitor may open is fresh everywhere.
- **`cache.mode: 'check'`** (259), for a CDN with no purge set up: copies are
  kept, served at once, checked back with the site behind the visitor, and
  served for a week while the site is down. With `validator: 'published'`
  each check is answered without rendering; with the default ETag a copy is
  kept a minute first, so a page is rendered at most once a minute per CDN
  location. `CROMBOLO_CACHE_MODE`, `CROMBOLO_CACHE_STALE_IF_ERROR`,
  `CROMBOLO_CACHE_CHECK_FLOOR`.
- **Every kept copy may be served while the site is down** (259): each
  lifetime now carries `stale-if-error`, a week unless set.
- **Stylesheets and scripts at addresses that change with their content**
  (260). `asset('/css/site.css')` gives `/css/site.3f9a1c2b.css`, kept for a
  year, and an address whose hash is no longer the file's answers `404`. The
  plain address is asked for again each time, now with an ETag. The scripts
  Crombolo writes (forms, bundle, islands and deferred loaders) are kept a
  year at their own hashed addresses, and their plain addresses drop from an
  hour to `no-cache`. The site templates link their stylesheets with
  `asset()`.

### Members and shared pages

- **Pages are shared with signed-in members unless they show them** (263). A
  page used to be private whenever a member was signed in. Now it is private
  only when a view it renders, or anything it imports from the views,
  mentions `member`. A page that does says `Vary: X-Crombolo-Member`, so a
  CDN that sets that header from the member cookie shares every other page
  with members too ("Members and a shared cache" in `operations.md`).
- **`'use deferred'` parts** (263). A view file starting with
  `'use deferred'` is fetched by the browser in a request of its own, for the
  visitor, so the page around it stays shared: `<Greeting fallback={…} />`
  writes its fallback into the page, and `/crombolo/deferred.js` puts the
  visitor's part in its place, from a signed, private address.
- **The back office shows which pages are shared, and helps share them**
  (264). A page's Info tab says how long its copies are kept and which files
  make it each member's own, each linked to its editor; the view editor notes
  a line that mentions the member; Insert offers "A personalised part", and
  the partial view insert is back, writing its import; "Personalised part"
  and "Interactive part" are snippets to start a view from; and Preview
  switches between signed out and a chosen member, for users with Members,
  each switch in the audit log. The Insert menu's new entries are a commit on
  the back-office fork (`umbraco/crombolo`).

### Telemetry

- **Traces, metrics and logs over OpenTelemetry** (262). Set
  `OTEL_EXPORTER_OTLP_ENDPOINT`, or `telemetry` in `crombolo.config.ts`, and
  every role sends each request, render, database statement, Delivery API
  answer, job run, webhook delivery and e-mail as spans, the request, render,
  cache, job and webhook metrics, and its log lines under their trace, to
  Datadog, Grafana, Honeycomb or any collector. Nothing personal is sent, and
  log lines go as their templates, never their values. Unset, nothing is
  loaded or sent. A request's `traceparent` is followed only from
  `CROMBOLO_TRUSTED_PROXIES` (`trustedProxies` in code); webhooks send theirs
  on. The log file records each line's `TraceId` and `SpanId`, and System
  information says where telemetry goes. Idle, it costs about a third of a
  percent of a core and 13 MB.

### Getting started

- **"A site from the command line" is a walkthrough.** A step at a time, with
  Back and Next, the commands to copy, and what you will see after each. It
  starts by checking your system, Bun and, for Postgres, Docker; switches
  between SQLite and Postgres; and its first part ends with the site running
  and you signed in, with a prompt to note the password `bun start` prints.
  Your own pages come next, then forms, groups, workflows, webhooks and
  shipping. The integration suite runs the page's own commands.

### Migrations

None.

### Upgrade notes

- **A view or package that reads the member some other way.** A page is now
  shared with members unless a view it renders mentions `member` (263). Code
  outside the views is not read: a component from a package that calls
  `usePage().member` itself, without a view passing the member in, would be
  shown to one member and shared with the next. Pass the member to it as a
  prop from a view, or make it a `'use deferred'` part.
- **A CDN that skipped its cache for the member cookie** can keep doing so.
  To share pages that do not show the member with members too, set
  `X-Crombolo-Member` from the cookie instead.
- **Lifetimes gain `stale-if-error=604800`** (259): a CDN or browser may serve
  a kept copy for a week while the site answers with errors. Set
  `staleIfError: 0` to keep the old header.
- **Link stylesheets and scripts with `asset()`** to have them kept for a year:
  `<link rel="stylesheet" href={asset('/css/site.css')} />`. The plain
  addresses still work, asked for again on every request.
- **New dependencies:** OpenTelemetry's API and SDK packages, loaded only when
  telemetry is turned on.

## v0.46.1 — 2026-11-03

- **`bundle deploy` checks for uncommitted changes first** (256). 0.46.0 raised
  the definitions' version before that check, so a site with uncommitted
  changes could be refused for something else, such as a type removed with its
  pages still there. Uncommitted changes are now refused first, as before 0.46.0.
  The version is raised only on a clean site, and the deploy then asks for that
  commit.
- **The large benchmark** signs in again after generating its site, and has
  limits on how long its job, its tests and its generation may take.

## v0.46.0 — 2026-11-03

- **Getting started from the command line** (256). The product site's Getting
  started section now has:
  - a walkthrough that builds a site with commands alone, from `crombolo init`
    to pages served and shipped as a bundle;
  - a page for each template site, saying what is in it and how to create and
    start it. Each page is generated from the template's manifest, with its
    `TEMPLATE.md` folded in.
- **The command line's spec in the repository** (256). `docs/cli/clispec.json`
  and `docs/cli/commands.md` describe every command, its arguments, flags,
  outputs, errors and exit codes. Both are generated from the commands by
  `bun run cli:spec`, and a test fails when they are stale, so a change to a
  command shows in review.
- **The guides written command line first** (257).
  - Content types (formerly Schema as code) is built around the `types`
    commands, with the files as a short last section.
  - Forms, and Users and groups, are new guides.
  - Deploying opens with shipping a site by bundle, deploy or push.
  - A test checks every `crombolo` command line in the guides against the
    CLI.
- **`bundle deploy` raises the version too** (256). Like `bundle build` and
  `push`, it raises the definitions' version when they changed since it was
  first applied. A deploy sends only what is committed, so it then asks for
  that commit.
- **Compositions shown and checked** (255).
  - **`types show`:** a composed type lists the properties it takes from its
    compositions, in their tabs, each marked with where it comes from. In
    `-o json` each property has `from`, plus `via` when it comes through a
    composition's own composition.
  - **Clashes refused:** a property whose alias a composition already has is
    refused, as are two compositions bringing the same alias. That holds for
    every command, for a hand edit and when a site starts. The refusal names
    the command that fixes it.
  - **`types new`:**
    - with `--compose`, a type gets no `title` of its own when a composition
      has one;
    - `--no-title` leaves the title out of any type;
    - a new element type starts with no properties and outside the Library.
      `--title` and `--library` add them, where before it had both unasked.
  - **Upgrade note:** a site whose definitions already have such a clash no
    longer applies them. Run `crombolo types check` before upgrading, and
    remove each property it names with the command it gives.
- **Permissions, sections and events by plain names** (254).
  - **Listings:** `crombolo users groups permissions`,
    `crombolo users groups sections` and `crombolo webhooks events` list what
    the group and webhook commands take, each with a line on what it allows.
    Each listing takes `-o json`.
  - **Permissions** are named `area:action`, for example `content:publish`,
    `library:read`, `media:update`, `forms:manage` and `form-entries:view`. A
    bare `publish` is refused with the areas it could mean. Groups keep the
    stored names (`Umb.Document.Publish`), which the commands still take, and
    `users groups show` prints the plain ones.
  - **Events** are named from what they say, such as `content-published`.
    `Umbraco.ContentPublish` still works.
  - **An unknown name** is refused with the names allowed.
  - **Form types:** `forms field add --type` and `forms workflow add --type`
    take kebab case (`long-answer`, `send-email`), as `--editor` does. Camel
    case still works, and `--editor` takes it too.
- **The command line speaks in the site's terms** (252). A problem names its
  definition and the part of it, with the command that changes it: *The content
  type "Content page", its property "body": unknown data type "nothing"
  (`crombolo types property update contentPage body`)*.
  - **Files that won't read:** a file that does not read at all is named by its
    file and line. The problems it causes elsewhere, such as an unknown type it
    would have defined, are left out.
  - **No file names when adding:** `types new`, `forms new`, `workflows new`,
    `webhooks new` and `languages add` say what was added, not the file
    written. `languages list` says "The site is in English (en-US) only".
  - **`crombolo init`** says what it set up and leads with the next commands.
    `schema/` is named once, as what to commit, and `--verbose` lists the files.
  - **`crombolo site show`** is the site in one place: its languages, page
    addresses, types by kind, forms, workflows, user groups and webhooks. Each
    line names the command that shows more. `crombolo status` points at it.
  - **The version, raised when shipped:** `bundle build` of a site, and
    `push`, raise its definitions' version a minor step when they changed
    since that version was first applied there. A production site refuses
    changed definitions under the same version, and only a hand edit could
    raise it before.
  - **Error details print in words:** they no longer print as
    `[object Object]`, as some of `bundle apply`'s did.
  - **Upgrade note:** in `-o json`, the `problems` of `types check` and
    `types sync` are now objects (`text`, `message`, `definition`, `part`,
    `file`, `line`) rather than strings. A script that read them as strings
    should read `text`.
- **Pages written from the command line** (253). `crombolo content new <path>
  --type <type>` makes a page with its values. `content update` changes its
  values, name and view, and `content show` shows its values and blocks. The
  values are given in the shorthand content files use: Markdown, paths, and
  JSON for toggles, numbers and lists.
  - **Blocks:** `content block add|update|move|remove` edits a page's blocks,
    each named by its alias or key.
  - **Saving:** pages are saved as drafts, through the same rules as the back
    office. `--publish` saves and publishes in one step, so a page that cannot
    be published is not changed.
  - **Keys:** a new page has the key its content file would have.
- **Block aliases** (253). A block can be given an alias, unique within its
  list:
  - set in the back office or in a content file (`alias = "hero"`);
  - read in a view with `model.value('blocks').byAlias('hero')`;
  - carried by the Delivery API on the block item.

  A save where two blocks share one is refused.
- **Blocks from content files open cleanly in the back office** (253). Each
  value in a block is stored with its editor, as the back office stores it, so
  opening the page no longer logs "Editor alias not found".
- **Renames that keep their content** (250): `crombolo types rename <alias>
  <new>` renames a content, element, media, member or data type, and `crombolo
  types property rename <type> <property> <new>` a property. Each keeps its key,
  so pages, items and values stay with it. A rename is refused while anything
  else names the old alias, listing each place; `--everywhere` renames it in the
  other definitions, the site's content files and its views in one step, and
  writes the views' model types again. `types show` now lists the content files
  and views that use a type, and applying a release says what it renames.
- **Every site definition changed from the command line** (251), each checked
  against the site before anything is written and applied at once, with
  `--dry-run`, `--no-apply` and `-o json`:
  - **Forms:** `crombolo forms list|show|update|remove`, `forms field
    add|update|move|remove` (with `--show-when` conditions), `forms page …`,
    `forms group …` and `forms workflow add|update|remove`. A form a page or
    Library form uses is not removed.
  - **Approval workflows:** `workflows list|show|update|remove` and `workflows
    stage add|update|remove`; removing a workflow withdraws its waiting
    requests, saying how many.
  - **Webhooks:** `webhooks list|show|update|remove`; a secret header only as
    `env:NAME`.
  - **Languages:** `languages update|remove`; a language pages have a version in
    is not removed.
  - **User groups:** `users groups list|show|new|update|remove|export`; a group
    made in the back office is exported to become one of the site's own before
    the CLI changes it, and one with users is removed only with
    `--move-users-to`.
  - **Page addresses:** `crombolo site urls --hide-top-level|--show-top-level`.

- **Data types changed from the command line** (249): `crombolo types update
  <data type>` stores any setting with `--set` (as given; it takes effect when
  the editor uses that name), takes the named settings `types new data-type`
  does, adds and removes a block list's blocks, and sets a picker's allowed types
  and start node by a page's path. `types remove` removes a data type nothing
  uses, and `types editors` lists the editors and their settings.

- **Types changed from the command line** (248): `crombolo types update` (a
  type's settings, allowed children, compositions and views), `types remove`
  (refused while pages use it; `--retire` keeps them), `types property
  add|update|move|remove` and `types tab add|rename|move|remove`. Each is
  checked against the site before anything is written, applied at once, and
  takes `--dry-run` and `--no-apply`.
  - **`types add-property` is now `types property add`**, with no alias kept.
    It no longer leaves a changed definition behind when the site refuses it.

- **`crombolo types list` and `types show`** (247): every content, element,
  media, member and data type the site has, and one in full, with its tabs and
  properties, what uses it (child rules, compositions, block lists, pickers),
  how many items use it, and whether it is applied yet.

- **The Media section at a million items** (246).
  - **The tree lists a folder's sub-folders before its files**, a page at a time
    with **Load more**. Editors see the change wherever a folder's manual sort
    order mixed folders and files: folders now come first. Opening the tree at an
    item no longer reads its whole folder.
  - **A folder's grid and list views** page in the database, so a folder of any
    size opens as quickly as a small one.
  - **Moving a folder** is one change however much is in it, and **trashing,
    restoring, moving or deleting more than 5,000 items, or emptying a bin that
    large, runs in the background**: the header shows its progress, and the tree
    refreshes when it ends.
  - **Migration 062** (`AddMediaTreeOrder`) adds `node.tree_group` and an index.
    It only adds.

- **A bundle installed from a file is kept in the site** (245):
  `crombolo bundle install ./x.tgz` copies it to `bundles/<name>-<version>.tgz`
  and installs it from there, so it is committed with the site and installs the
  same way everywhere; it used to name the file wherever it was downloaded. A
  site bundle carries the files its `package.json` names, so a deploy installs
  them on the remote too.

- `/crombolo/bundle.js` is served on an `api` node as well (220), as the other
  site scripts already were, so a proxy that sends `/crombolo/*` to the api
  node no longer breaks `crombolo.fetch` on the site's pages. The paths a proxy
  must send to a node that serves the site are listed in `docs/rendering.md`,
  "Behind a proxy".

- **A host checks a bundle's signature from `@crombolo/crombolo/host`** (244):
  `verifyPackage`, `verifyProvenance`, `provenanceProblem`, `describeProvenance`
  and their types, so a host that installs bundles itself holds them to the
  site's rule, in the back office's words.
  - **A new signature state, `unchecked`:** when Sigstore's trusted root cannot
    be fetched and none is cached, a signed bundle is *Couldn't be checked right
    now* rather than *Signature not accepted*. It is still refused under every
    policy; trying again later may succeed. Code that matches on states should
    handle it.

## v0.45.0 — 2026-11-02

- **Signed bundles** (060). A bundle can say where it was built:
  `crombolo bundle sign` (or `bundle build --sign`) signs it in GitHub Actions
  from the commit or tag it was built at, with Sigstore and no keys, and writes
  `provenance.json` into it with links to the commit, the tag and the public log.
  Signing is optional.
  - **Checked wherever a bundle arrives**, before anything is written. A
    signature that does not check out is always refused. The install panel,
    Settings → Bundles → Installed and `bundle list` show *Signed: built from
    github.com/org/repo at v1.2.0* or *Not signed*. `crombolo bundle verify`
    checks one without installing it.
  - **Two new settings:** `CROMBOLO_BUNDLE_SIGNATURES=required` refuses unsigned
    bundles, and `CROMBOLO_BUNDLE_SOURCES` says which repositories signed
    bundles may come from.
  - **Crombolo's own bundles are signed** from each release tag: the Redirects
    and Microsoft Entra bundles on npm, and each demo site, now also attached
    to the GitHub release as a signed bundle (`demo-harbourstone-<version>.tgz`
    and the others). `CROMBOLO_BUNDLE_SOURCES=kineco-au/crombolo-cms@v*` takes
    only ours.
  - **From a private repository**, `bundle sign` stops unless given
    `--public-log`: the public log records the repository's name, workflow, tag
    or branch and commit, though never the bundle or its code.
- **Bundles, installed and deployed from the command line** (241).
  - `crombolo bundle list`, `install`, `uninstall`, `disable` and `enable`
    do what Settings → Bundles does, here or with `--remote`. `--grant` names
    every permission a bundle asks for; a version asking for more is refused.
  - `bundle install --wire` adds the bundle's server code to
    `crombolo.config.ts`, for you to commit; `bundle install <site-bundle>
    --code-into <dir>` replaces `bundle install-code`, which is gone.
  - **Applying a bundle installs the code it carries**, which it used to leave
    for a host. A site bundle now always carries `package.json`, `bun.lock` and
    `crombolo.config.ts` once the site has a lockfile, so a new dependency and
    its import travel with `bundle apply --structure`. `bundle revert` puts the
    code back.
  - `bundle deploy --remote <name>` builds what is committed, checks it on the
    remote, applies it and restarts the remote.
  - **`crombolo start` supervises the server**, and `crombolo restart [--remote]`
    restarts it: the old server serves until the new one is healthy, and keeps
    serving if it is not. Nothing else restarts a site; installed code waits,
    and Settings → Bundles and the health checks say so.
  - **A new permission, "Install code on this site"**
    (`Crombolo.Remote.InstallCode`), is needed to install bundles or a bundle's
    code on a remote. **Administrators do not have it** unless a group gives it
    to them: give it to a group of its own. A CI trust rule can name it.
  - **Upgrade note:** nobody holds the new permission after upgrading, so a CI
    job or person that applies bundles with code needs a group, or a trust
    rule, that names it.

## v0.44.0 — 2026-11-02

- **Forms in the Library** (239). Each of a site's forms is a type in
  Library → Create, and an editor's Library form gives it a heading, an
  introduction, the submit button's text, a thank-you or a page to go to, and
  who is e-mailed. One form can back several Library forms. A page's Form
  picker picks a Library form; a page that names a form itself still works, in
  the form's own words. Entries record the Library form they came through, and
  Entries can filter by it.
  - **Migration 059** (`AddFormLibrary`) adds `content_type.form_key` and
    `form_entry.library_key`. It only adds columns.
- **Deploying from CI** (160): a GitHub Actions or GitLab job can pull and
  push with no person and no stored secret. An administrator trusts the job
  under **Settings → CI access**, or with `crombolo remote trust`, naming its
  repository and branch, tag or environment and what it may do. The job's
  provider-signed identity token is exchanged for a 15-minute token that acts
  as that rule. CI never approves a push. Every sign-in, refusal and action is
  audited.
  - **Remotes are HTTPS only:** the CLI no longer reaches a remote over plain
    HTTP, except one on the same machine.
  - **Migration 061** (`AddRemoteTrust`) adds the trust rules and CI tokens.
- **A site is built and changed from the CLI with bundles** (167). The seed
  commands are gone; bundles do what they did, locally or on a remote:

  | Was | Now |
  | --- | --- |
  | `seed check` | `bundle build --check` |
  | `seed apply`, `content import` | `bundle apply [--dry-run] [--publish]` |
  | `content check` | `bundle apply --dry-run` |
  | `seed export` | `bundle export --source` |
  | `content runs`, `content revert` | `bundle runs`, `bundle revert` |
  | `bundle check` (code) | `bundle check-code` |
  | `start --seed` | `start --bundle .` |

  `bundle apply --remote <name>` sends a site's content to a remote, or with
  `--structure` its content types, views, styles and code too, and `bundle runs`
  and `bundle revert` take `--remote` as well.
  - **Content files move:** a site's `seed/` folder is now `content/`, with
    `pages/` (was `seed/content/`), `library/` and `media/`. A site with a
    `seed/` folder is refused with the command that moves it:
    `git mv seed content && git mv content/content content/pages`.
  - **`CROMBOLO_REMOTE_ENABLED` is replaced by `CROMBOLO_REMOTE_ACCESS`:**
    `off` (the default), `read` (pulls), `content` (bundles of content) or
    `all` (whole-site pushes and bundles that change structure). A site that
    still sets `CROMBOLO_REMOTE_ENABLED` refuses to start, naming the new
    variable. **Upgrade note:** a site that took pushes needs
    `CROMBOLO_REMOTE_ACCESS=all`.
  - **A new permission, "Change a site's structure and code"**
    (`Crombolo.Remote.ApplyStructure`), for groups and CI trust rules, is
    needed for a whole-site push and a bundle that changes structure.
    Administrators have it. **Upgrade note:** give it to any other group, or
    CI rule, that pushes.
- **Bundles is in Settings** (238): the Bundles card, under a new Extensions
  group, opens Marketplace, Installed and Created as tabs. The header has no
  Bundles tab, and an old Bundles address opens the same screen in Settings.
  Extension insights moves to a new Developers group.
  - **Who can use it changes:** anyone whose group has Settings can open
    Bundles. Bundles had its own section permission, which is gone.
  - **Upgrade note:** a group your site gave Bundles but not Settings loses
    Bundles. Give it Settings if it should keep it.
  - **Migration 060** (`MoveBundlesIntoSettings`) removes that permission from
    every group.
- The Overview's greeting and empty lists are shorter (236).

- Settings cards head their title on a dark band in white, in light and dark
  mode (234).
- Each bundle's Settings cards are a group of their own, under the bundle's
  name with a link to the bundle, and show the description its manifest gives,
  as the redirects bundle's now does (234).
- Extensions (Settings) no longer lists Umbraco's internal loaders, such as
  "Umb.Bundle.HealthCheck", which read as bundles but are not ones you install.
- The Settings landing page scrolls when its cards run past the window (234).

## v0.43.1 — 2026-11-01

v0.43.0's release pipeline stopped at the browser suite, so it was never
published; this is it. Three browser tests still assumed the back office as it
was before this release: one found a page by a name the Overview now shows too,
and two waited for a sidebar that Settings' tools now hide.

## v0.43.0 — 2026-11-01

- **Signing in opens on an Overview** (story 236) in place of the Welcome page.
  It shows:
  - the pages changed most recently, with their type, status, when and who;
  - how many pages are drafts and how many are published, each listing those
    pages;
  - what people did lately;
  - New content.

  Each person sees only the pages they may see.
- **The back office's new look** (story 237):
  - a white header, with the current section in terracotta;
  - one deep terracotta accent with white text on buttons, links, the active
    tab and the selected item;
  - the sidebar a white panel beside the cream page;
  - soft-shadowed cards on the Overview and in Settings.

  Dark mode follows the same pattern, and every pairing passes the WCAG AA
  contrast check.
- **Redirect URL Management is the Redirects card in Settings** (story 237),
  so the Content section opens on the Overview with no tabs. Only people with
  Settings can manage redirects now. A page's own redirects are still on its
  Info tab.
- **A quieter console.** The back office no longer logs Umbraco's internal
  deprecation notices, such as "Implicit classic tree view fallback … removed in
  Crombolo 20", or Lit's development-only warnings ("scheduled an update after
  an update completed"). It now ships Lit's production build, as Umbraco does.
- **Lato's licence ships with the fonts.** `@crombolo/backoffice-dist` now carries
  the SIL Open Font License beside the Lato font files it serves, and `NOTICE`
  names them.
- **A new site's empty page is a getting-started guide** (story 236). Until
  something is published, the site shows "Nothing is published yet" and a
  link to the back office. A click opens four steps to a first page (sign in,
  configure page metadata, write its template, publish) and where things live.
  It is styled as Crombolo in light and dark, and still answers 404.

- **Settings opens on a page of cards** (story 234). The cards are grouped Build,
  Site, Health, History and Other, each saying what the tool is for, in place of
  a row of tabs beside a tree. Every page under Settings is headed by the same
  breadcrumb trail, such as Settings › Health Check or Settings › Structure.
  Structure (content, media and member types, data types, languages)
  and Code (components, stylesheets, scripts) each open their own tree, and no
  other tool shows one. Logs, Extensions, Relations and Webhooks, which were in
  the tree, are cards. A card shows only to someone who can open it, and a
  bundle's Settings dashboard shows under Other. Bookmarked addresses still open,
  and the Welcome tab's address opens the cards. If e-mail isn't set up, a
  banner above the cards says so.
- **Workflows are set up from Settings, and the Workflows section is now
  Approvals** (story 234). The list of workflows and the designer are a
  Workflows card under Build, for administrators. Approvals holds Waiting for me,
  which it opens on, In flight and Decided. User groups keep the section as they
  had it.
- **Approvals shows only when it has something to show** (story 234). The
  section and a page's Workflow tab appear while the site has a workflow or a
  request is open. Saving the first workflow brings them in at once.
- **Deleting a workflow withdraws the requests waiting under it** (story 234),
  whatever its `on-change` says, and the designer names those pages before it
  deletes. A workflow removed by a deploy does the same. Each request's history
  says the workflow was removed. Before, a `keep` workflow's requests stayed
  waiting for an approval that guarded nothing, since a page no workflow covers
  publishes directly.
- **`@latest` in the docs.** The docs now run `bunx @crombolo/cli@latest`, so
  `bunx` fetches the newest CLI rather than one it cached, which makes a site on
  an older crombolo.

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
