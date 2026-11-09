# 308 — Each permission an extension asks for says why

**Epic:** I — Hardening · **Priority:** must · **Size:** XL
**Depends on:** —

## Story

As someone deciding whether to install an extension, I want each thing it asks to
do named, with the author's reason beside it, so that I grant exactly what I
understand and nothing that came with it unasked.

## Context

Manifest schema 3 lists permissions as names. There are eight, mostly per capability
(`BUNDLE_PERMISSIONS`). The install asks a separate question about server code
(`acceptServerCode`), which an extension's templates make meaningless: every
extension may run code. Outbound requests, members, content and users have no
permission at all. See `extension-threat-model.md`, "Permissions an extension asks for".

## Decisions (2026-11-09)

- **Every area has an API now, and each asks read and write separately:**
  - content, media, members, users (read only), forms, form entries, the
    dictionary, content types, webhooks, workflows, redirects and sign-in
    providers;
  - plus `http.outbound`, `routes.public`, `events.content`, `member.delegate` and
    `actAs`, with `templates` reserved for 312.
- **`users.write` is never offered.** Writing users or groups could make anyone an
  administrator, so it stays with administrators.
- **Who an extension acts as:**
  - **Itself, by default:** "Extension <name>" across the whole site, bounded by its
    grant. The audit names it, and approval workflows apply to it as to anyone.
  - **`actAs`:** with this permission it acts for a user instead, bounded by both
    that user's rights and the grant. Whoever grants it chooses which user:
    - the user who installed it;
    - the user calling it, falling back to itself where there is none (a job, an
      event, a public route);
    - a named user.
- **`documents.read` is renamed `content.read`,** with no alias in schema 4.
- **The areas are reached through the Management API:**
  - One `api` capability makes calls as the extension, in the process:
    `api.get('/document-type/…')`, `api.post(…)`.
  - Each granted permission allows a set of paths and methods, checked before the
    call. The API's own validation, permissions, approval workflows and audit then
    apply.
  - Extension authors use Umbraco's documented API. A typed SDK over it is story 315.
- **Least privilege:** acting as itself, an extension's principal holds nothing but
  what its grant gives. Each granted permission becomes the sections, document and
  media permissions on the whole tree, and languages, that its paths need. It is
  never an administrator, so approval workflows always apply to its publishes, and
  nothing administrator-only can be reached. Under `actAs`, the chosen user's own
  rights bound it as well.
- **Schema 3 is not installed any more.** One already installed keeps running with
  the names it declared, flagged "asks for permissions without saying why". A new
  install, or an upgrade to a schema 3 version, is refused, asking for a version that
  says why.

## The design

### The manifest, schema 4

```json
"crombolo": {
  "bundleType": "extension",
  "id": "redirects",
  "schemaVersion": 4,
  "permissions": {
    "redirects.read": "Lists the rules you have added",
    "redirects.write": "Saves the rules you add or change",
    "content.read": "Shows the page each rule sends people to",
    "http.outbound": { "reason": "Checks each target answers", "origins": ["https://api.acme.com"] }
  }
}
```

- **A reason for every permission:** plain text, 1 to 200 characters, shown beside
  the permission's own sentence.
- **Refused, naming each:** a missing reason, an unknown permission, `users.write`,
  or an origin that is not `https://host[:port]` (`http://localhost` only on a
  development site).
- **What the grant covers:** the grant records the permissions, and for
  `http.outbound` its origins. A version that adds a permission or an origin is a
  new grant (story 309).

### The catalogue

| Area | Read | Write | Through |
|---|---|---|---|
| Content | `content.read`: pages, their values by alias, the tree, published and draft | `content.write`: create, update, publish, unpublish, move, trash | The document operations, as `site().content` uses them (298) |
| Media | `media.read` | `media.write` | The media operations; the folder limits of story 222 stay |
| Members | `members.read`: members and their groups, never passwords | `members.write`: create, update, lock, assign groups | The member repositories, through member operations |
| Users | `users.read`: users and groups, never passwords, tokens or second factors | never offered | — |
| Forms | `forms.read`: definitions | `forms.write`: definitions, through the schema writer | Form definitions |
| Form entries | `formEntries.read` | `formEntries.write`: delete | Entries, which hold personal data, so apart from forms |
| Dictionary | `dictionary.read` | `dictionary.write` | Dictionary items |
| Content types | `contentTypes.read`: content, media and element types and data types | `contentTypes.write`, through the schema writer | Schema as code |
| Webhooks | `webhooks.read` | `webhooks.write`: only to its own `http.outbound` origins, and held to story 301's rules | The webhook service |
| Workflows | `workflows.read`, and the requests in flight | `workflows.write`: definitions, through the schema writer | Approval workflows |
| Redirects | `redirects.read` | `redirects.write` | As now |
| Sign-in | `identityProviders.read` | `identityProviders.write` | As now |

Besides the areas:
- `member.delegate` acts for the member calling a site route, as now, and is checked
  on every call (story 309).
- `actAs` acts for a user (above). The grant names the user, or "the installer" or
  "the caller".
- `events.content` is called for content events. An extension with event handlers
  and without it is refused at boot.
- `http.outbound` lets its server half reach the origins it lists, through the host's
  `fetch`. Story 311 enforces it in Deno too, and 313 for its screens.
- `routes.public` lets it answer routes anyone can call. Site routes without it are
  refused at boot.
- `templates` is reserved: it renders components into pages, from story 312.

Writes to content types, forms, workflows and webhooks go through the writers the
back office uses: the schema files, then a sync. A node that cannot write the
site's files refuses them, as the back office does.

### The install

- **No server-code question:** `acceptServerCode`, `needsServerConsent` and the
  "Runs code on the server" tag go.
- **The panel lists every permission:** its sentence and the author's reason, with
  the origins under `http.outbound`.
  - For `actAs`, the panel asks whose: the installer, the caller, or a user picked
    from a list.
  - It always says that an extension's screens act as the signed-in user.
- **The grant is the permissions shown, exactly:** over the API, in the CLI's
  `--grant` flags and from a remote. `--act-as installer|caller|<user>` gives the
  `actAs` choice.
- **An extension that asks for nothing** installs with "asks for nothing on the
  server".

## Implementation plan

1. **The manifest** (`backoffice-host/src/bundle-permissions.ts`,
   `bundle-package.ts`):
   - `BUNDLE_SCHEMA_VERSION` 4, and the permissions object.
   - The new catalogue, with a sentence for each.
   - The reason, origin and `users.write` rules.
   - A schema 3 reader kept for installed ones, with its old names.
   - `declaredPermissions` gives the names, the reasons and the origins.
2. **The grant** (`bundle_grant`): the origins and the `actAs` choice. A migration
   adds `act_as` and keeps origins in `permissions`, as JSON.
3. **The host API** (`server/src/bundle-api.ts`):
   - An `api` capability: `get`, `post`, `put`, `delete` on Management API paths,
     dispatched in-process to the same handler a request reaches.
   - `API_PERMISSIONS` maps each permission to paths and methods. A call no granted
     permission covers is refused before dispatch, naming what it would need.
   - The principal: the extension's own, built from the grant (least privilege), or
     under `actAs` the chosen user, read again on each call.
   - The existing `redirects`, `documents`, `identityProviders` and `media`
     capabilities stay, gated as now; `documents` needs `content.read`.
4. **Boot checks:** event handlers need `events.content`, site routes need
   `routes.public`, and a capability needs its permission. Each is named when
   missing.
5. **The host's `fetch`** for routes, jobs and events: `pinnedFetch`, held to the
   granted origins.
6. **The install:**
   - Marketplace and CLI without the consent question.
   - The panel shows the reasons and the `actAs` choice.
   - Schema 3 is refused for new installs.
7. **Our own:** Simple Redirects and Entra on schema 4, with reasons; Simple
   Redirects asks for `content.read`.
8. **Docs:** `bundles.md` "Permissions" holds the catalogue, and the threat model
   points at it. Release notes: schema 4, the rename, and schema 3 refused, as
   breaking changes.

## Tests

- **Manifest:** schema 4 accepted; a missing reason, an unknown permission,
  `users.write` and a bad origin refused, each named; schema 3 refused for install,
  and loaded when installed.
- **Each area:** a read is refused without its read permission and a write without
  its write permission, and each works with them. A content write follows the
  approval workflows and is audited as the extension.
- **`actAs`:** as the installer, the caller, and a named user, each bounded by that
  user's rights. With no caller, it acts as itself.
- **Boot:** event handlers without `events.content`, and site routes without
  `routes.public`, are refused.
- **Outbound:** a `fetch` to an undeclared origin is refused.
- **Install:** the panel words, no consent question, and the CLI's `--grant` and
  `--act-as`.

## Implemented (0.57.0)

- **The catalogue and schema 4** live in `backoffice-host/src/bundle-permissions.ts`:
  `BUNDLE_PERMISSIONS`, `readPermissions`, and `askedPermissions` (one reader of
  either schema), plus `isSchema3Field`. `BUNDLE_SCHEMA_VERSION` is 4, and
  `OLDEST_BUNDLE_SCHEMA_VERSION` is 3, for extensions already installed.
- **`api`** (`server/src/bundle-api.ts`):
  - `API_PERMISSIONS` maps each permission to path prefixes under the back office,
    reads and writes apart; `permissionsFor` answers what covers a call.
  - The call goes to the server's own handler, set by `core.setBundleDispatch`.
  - It carries a header naming the call and a per-process secret, so `authenticate`
    knows its principal and no request from outside can claim one.
- **The principal:** `extensionPrincipal` builds it from the grant. It is never an
  administrator, holds sections and verbs from the permissions, and covers the
  whole tree and every language. Under `actAs` it is the grant's choice of user,
  read through `userPrincipalByKey`.
- **`fetch`** (a capability) and an event handler's `fetch` are held to
  `declaredOrigins`.
- **The grant** records `origins` and `act_as` (migration 066). `actAsChoice` turns
  `installer`, `caller` or `user:<key>` into what is stored.
- **The install:** `acceptServerCode` and `needsServerConsent` are gone. `needsGrant`
  carries each permission's sentence, reason and origins, and `asksActAs`. A grant
  is recorded for every extension installed. The panel shows reasons and asks
  whom it acts for, and the CLI has `--act-as`.
- **Boot:** schema 4 event handlers need `events.content`, and site routes need
  `routes.public`.
- **Not built here:**
  - The area-by-area typed helpers are story 315.
  - The Installed view's Grant button is story 309's.
  - In the panel, `actAs` offers the installer and the caller; naming another user
    is the CLI's (`--act-as user:<key>`) and the remote's.
- **Tests:** `tests/extension-permissions.test.ts`; the Marketplace and
  bundle-manage tests moved to the grant.

## Acceptance criteria

- [x] A schema 4 manifest with a reason for each permission is accepted, and the
      install panel shows each with its reason.
- [x] A permission with no reason, an unknown one, or a bad origin is refused, naming it.
- [x] Nothing in the install asks about server code.
- [x] A schema 3 extension already installed still loads, flagged; a new install of
      one is refused.
- [x] Each area's API refuses a read or a write its grant does not hold, and works
      when it does.
- [x] `actAs` acts for the installer, the caller or a named user, as granted, and as
      the extension itself where there is no caller.
- [x] `users.write` is refused wherever it is asked for.
- [x] `bundles.md` lists the catalogue, and the threat model points at it.
