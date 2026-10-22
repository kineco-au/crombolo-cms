# Release notes

What each release changed, newest first, for the people running a site. Each
release's upgrade notes say what an operator must check or do. Story numbers
point at `docs/stories/`.

## Unreleased

Nothing yet.

## v0.24.0 — 2026-10-22

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
