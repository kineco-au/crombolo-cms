# Release notes

What each release changed, newest first, for the people running a site. Each
release's upgrade notes say what an operator must check or do. Story numbers
point at `docs/stories/`.

## Unreleased

- **`crombolo init` needs an empty directory.** It scaffolds either a plain
  site or one from `--template`, once; in a directory that is not empty (a
  `.git` folder aside) it now fails with exit code 8 rather than skipping the
  files already there and leaving a template half-applied. `--force`
  scaffolds anyway, overwriting them. Its JSON output no longer has
  `existing`.

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
  `crombolo init --name "Nature's Calendar"` names the package
  `natures-calendar`, not `nature-s-calendar`.

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
