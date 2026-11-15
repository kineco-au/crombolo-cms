# The remote protocol, version 1

A **remote** is a running site that hands out, and accepts, whole-site files
([`content-transfer.md`](content-transfer.md), "A whole site in one file") over
HTTPS, to a person allowed to ask. A developer's `crombolo` CLI pulls a copy of
it and pushes work back (story `108`). The CMS's own server is the reference
implementation (story `107`). Any host may implement the protocol, and
`@crombolo/remote-conformance` checks one against it.

The CMS's rule holds. A transfer produces a file, and no environment keeps
credentials for another. The CLI carries the file, under the developer's own
sign-in.

Everything here is required unless marked optional. All bodies are JSON unless
stated otherwise. Errors are `application/problem+json` with a stable `code`
(see Errors).

## Discovery

`GET /.well-known/crombolo-remote`, unauthenticated:

```json
{
  "protocol": "crombolo-remote",
  "versions": ["1"],
  "bundleFormats": [8, 8],
  "name": "Harbourstone Distillery",
  "api": "https://example.com/umbraco/remote/v1",
  "auth": {
    "deviceAuthorization": "https://example.com/…/security/back-office/device",
    "token": "https://example.com/…/security/back-office/token",
    "clientId": "crombolo-cli",
    "grantType": "urn:ietf:params:oauth:grant-type:device_code"
  },
  "capabilities": ["media-fetch", "approvals"],
  "environments": [{ "id": "production", "name": "production", "protected": true }]
}
```

- **`versions`:** the protocol versions served. A client refuses a remote that
  serves none it speaks.
- **`bundleFormats`:** the oldest and newest bundle formats the remote reads
  (story 306). Before `push`, `site apply --profile` or `site deploy` builds
  anything, the CLI checks that the remote reads the format it writes. Before
  `pull`, it checks that it reads what the remote writes. Either way it says
  which side to upgrade. A remote that names none is a release from before site
  packages, and is refused the same way.
- **What each endpoint takes:** the apply endpoint (`environments/<env>/bundles`)
  and a push take only site packages. `bundle-manage` installs and removes only
  extensions. Each refuses the other kind, naming the command to use.
- **`api`:** the base for everything below. It need not share the discovery
  document's origin.
- **`environments`:** what the remote offers.
  - `id` is lower case letters, digits and dashes.
  - `protected: true` means a push there replaces something people rely on.
- **`capabilities`:** optional features.
  - `media-fetch` means media by reference is offered (see below).
  - `push-check` means a push can be checked before it is sent (see Pushing).
  - `approvals` means a push may wait for approval.
  - `audit` means the audit log can be read (see below).
  - `content-query` means pages can be found by their facts (see below).
  - `content-history` and `recycle-bin` mean a page's history can be read and
    rolled back, and the recycle bin listed and restored from (see below).
  - `members` and `public-access` mean members and their groups can be looked
    after, and who may see a page set (see below).
  - `users` means back-office users can be changed and removed, their sign-ins
    listed and ended, and where a group starts set (see below).
  - `background-jobs` means the site's background jobs can be listed, and a
    failed one run again (see below).
  - `extension-activity` means what an extension did can be read and exported
    (see below).
  - `media-library` and `media-access` mean media can be listed, found, shown
    with what uses it, changed and given folders, and who may see an item read
    and set; `content-show` means a page can be read as `content show` gives it
    (see below).
  - `restart` means the site can be restarted (see below).
  - A client ignores capabilities it doesn't know.

A site that isn't a remote answers 404.

## Signing in

The OAuth 2.0 device authorization grant ([RFC 8628]). The client never sees
the person's password, and the remote's own sign-in (password, two-factor,
identity provider) is whatever it already is.

1. `POST <auth.deviceAuthorization>`, form-encoded, with `client_id=<auth.clientId>`
   and optionally `client_name`, which the approval page shows. The answer:
   `device_code`, `user_code`, `verification_uri`, `verification_uri_complete`,
   `expires_in`, `interval`.
2. The client shows `user_code` and opens `verification_uri_complete`. The
   person approves or declines there, in a browser where they are signed in.
3. The client polls `POST <auth.token>` with `grant_type=<auth.grantType>`,
   `device_code` and `client_id`, no faster than `interval`. Until a decision
   the answer is 400 with `error` set to one of:
   - `authorization_pending`;
   - `slow_down` (add 5 seconds to the interval);
   - `expired_token`;
   - `access_denied`.
4. Approved, the answer is `access_token`, `refresh_token`, `token_type: Bearer`
   and `expires_in`. A device code yields tokens once.
5. The client refreshes with `grant_type=refresh_token`, `refresh_token` and
   `client_id`. The tokens act as the person who approved, with that person's
   permissions, until revoked.

Every request below sends `Authorization: Bearer <access_token>`. Without one,
or with one that has lapsed, the answer is 401 `sign-in-required`.

In the reference server, the person approves at `<backoffice>/device`. Each
sign-in becomes a session listed under **Signed-in devices** in their profile,
where they can sign it out.

### Signing in from CI (`ci-sign-in`, optional)

A CI job has no person to approve a device code. A remote that offers this
(story 160) takes the job's OIDC identity token, which its CI provider signs,
and exchanges it for a short-lived token by OAuth 2.0 token exchange
([RFC 8693]). No secret is set up or stored anywhere. Discovery adds:

```json
"auth": {
  "ci": {
    "tokenExchange": "https://example.com/umbraco/remote/v1/token",
    "grantType": "urn:ietf:params:oauth:grant-type:token-exchange",
    "subjectTokenType": "urn:ietf:params:oauth:token-type:jwt",
    "audience": "https://example.com",
    "issuers": ["https://token.actions.githubusercontent.com", "https://gitlab.com"]
  }
}
```

1. **The identity token.** The job asks its provider for one with `aud` set to
   `auth.ci.audience`.
   - **GitHub Actions:** the job has `permissions: id-token: write`.
   - **GitLab:** the job declares it in `id_tokens`.
2. **The exchange.** `POST <auth.ci.tokenExchange>`, form-encoded, with
   `grant_type`, `subject_token` (the identity token) and `subject_token_type`.
3. **The remote verifies the token:**
   - its signature, against the keys at its issuer's OIDC discovery;
   - `iss`, which must be one of `auth.ci.issuers`;
   - `aud`, which must be the audience;
   - `exp`, `nbf` and `iat`, and a lifetime of an hour at most;
   - `jti`, accepted once.
4. **The rule.** The token must then match a **trust rule** that an
   administrator made on the remote: its issuer, its repository (`repository`
   on GitHub, `project_path` on GitLab), and its branch, tag or environment,
   exactly and with no wildcards.
5. **The answer.** Accepted: `access_token`, `issued_token_type`,
   `token_type: Bearer` and `expires_in`, at most 15 minutes, with no refresh
   token; the job exchanges again. Refused, for any reason: 400 with `error:
   invalid_grant` and nothing that says why. Too many refusals: 429. Over
   plain HTTP: 400.

**What the token may do.** It acts as the rule, not a person: it holds the
rule's remote permissions and nothing more, and it is accepted on these routes
only. It never approves a push (403 `ci-cannot-approve`). `GET me` says who a
token acts as: `{ name, kind: "person" | "ci", permissions }`, and for CI the
rule and the run it came from.

**Disabling or deleting a rule** ends its tokens at once. **Every exchange is
audited,** accepted or refused, and so is everything a CI token does, with the
repository, ref and run it came from.

**Trust rules** are managed by an administrator, never by CI, at `GET|POST
trust` and `PUT|DELETE trust/{key}` and `POST trust/{key}/disable|enable`.
The reference server's Settings screen is **CI access**.

[RFC 8693]: https://www.rfc-editor.org/rfc/rfc8693

## Environments

`GET <api>/environments` lists the environments, each with what this person
may do:

```json
[{ "id": "production", "name": "production", "protected": true,
   "access": "all",
   "may": { "pull": true, "pullFull": false, "push": true, "apply": true,
            "applyStructure": true, "audit": false, "backgroundJobs": true,
            "extensionActivity": true, "mediaLibrary": true,
            "contentShow": true } }]
```

`audit` is there when the remote offers the capability. `backgroundJobs` is
whether this person may see and retry the site's background jobs: the Settings
section, and never CI. `extensionActivity` is whether this person may read what an
extension did, on the same terms. `mediaLibrary` is whether this person may use the
media routes, which need the Media section, and `contentShow` whether they may show
pages, which needs Content; neither is ever CI's. `access` is the site's
`CROMBOLO_REMOTE_ACCESS`, and every `may` is already bounded by it: `apply` needs
`content`, and `push` and `applyStructure` need `all`.

`push` is already false where the environment is protected and the person
lacks the permission for that.

## Jobs

Pulls and pushes are **jobs**. Starting one answers `202` with the job.
`GET <api>/jobs/{id}` answers it again until it settles:

| Field | |
| --- | --- |
| `id`, `kind` (`pull` or `push`), `environment` | |
| `state` | `queued`, `running`, `approval-required`, `done`, `failed`, `refused` |
| `stage`, `progress` | where it has got to, and a percentage, both optional |
| `pollAfter` | seconds until it is worth asking again, while it is still moving |
| `download` | a finished pull: `url`, `expiresAt`, `size`, `sha256` |
| `approvalUrl`, `approvalExpiresAt` | while `approval-required` |
| `problem` | a failed or refused job: `code`, `title`, `detail`, `items` |
| `runId` | a finished push: the import's run, which `site revert` undoes |

A job is visible to the person who started it. On a remote with approvals,
it's also visible to whoever may approve it. Anyone else gets 404.

- **`failed`** means something went wrong, and asking again may work.
- **`refused`** means the remote declined: an import's checks, a decline, or
  an approval that expired.

A job whose worker stopped is reported `failed` with `interrupted`; it never
stays running forever.

## Pulling

`POST <api>/environments/{id}/pulls`:

```json
{ "passphrase": "at least twelve characters", "full": false, "media": "included" }
```

- **`passphrase`** (required, 12+ characters) seals the file.
  - Metadata stays readable: structure, names, schema, files.
  - Content data is sealed: property values, media files, and any people.
- **`full`:** with `false` (the default) people are anonymised. Members become
  placeholders, back-office users are left out, and every email address is
  replaced. `true` carries members and users and needs the full-pull
  permission.
- **`media`** is one of:
  - `included` (the default): the media files are in the file;
  - `omitted`: they aren't;
  - `referenced`: they aren't, and they are fetched one at a time (below).

The finished job's `download.url` serves the file for as long as
`download.expiresAt` allows. A client checks it against `download.sha256`. The
reference server serves downloads only through the API with the bearer token,
never from the media store's public address.

## Pushing

`PUT <api>/environments/{id}/pushes`:
- **Body:** the whole-site file (`application/gzip`).
- **`Content-Length`:** the file's size.
- **`Crombolo-Sha256`:** the file's SHA-256, in hex.
- **`Crombolo-Passphrase`:** the passphrase it was sealed with.

The remote refuses a file whose hash doesn't match (400 `hash-mismatch`)
before anything is replaced. Accepted, the push is a job that:
1. backs up where the remote can;
2. replaces the environment with the file, as `crombolo site import --replace` does;
3. refreshes the published content of the node that took it, so visitors see the
   push at once. The import also tells every other node, through a cache
   instruction; a node skips its own instructions, so this step is what reaches the
   one it ran on.

A push to a protected environment needs the protected-push permission (403
`forbidden-protected` otherwise).

**Checking a push first** (`push-check`, optional). `POST
<api>/environments/{id}/pushes/check` takes `{ "nodes": [keys], "files":
[paths] }`: the file's node keys and the bundle paths of the sections it
carries. Nothing is uploaded, and nothing is written. The answer says what
the push would do here:

```json
{ "environment": "production", "recycles": { "document": 3, "media": 1 },
  "removesFiles": ["styles/old.css"], "keepsPeople": true }
```

`removesFiles` is named by section, never by the remote's own paths. It needs
the same permissions as the push. A client without it can only describe what
it is sending.

## Applying a bundle (`bundle-apply`, optional)

`PUT <api>/environments/{id}/bundles` applies a bundle to the environment, as
`crombolo site apply` does on its own machine (story 167):
- **Body:** the bundle as an npm tarball (`application/gzip`).
- **`Crombolo-Sha256`:** its SHA-256, in hex (400 `hash-mismatch` when it differs).
- **`Crombolo-Options`:** JSON, every field optional: `dryRun`, `publish`,
  `label`, `resolutions`, `resolveAll` and `replaceFiles` (allow replacing
  files the remote has; `site deploy` sends it).

A bundle of content alone needs the `content` level and the push permission. One
that carries content types, views, styles or code needs the `all` level (403
`access-level`) and `Crombolo.Remote.ApplyStructure` (403 `forbidden-structure`).

A bundle whose code, value migrations or templates would change the remote's
files (stories 241, 300, 336) is installed there, and also needs
`Crombolo.Remote.InstallCode`, which administrators hold only when a group gives
it to them (403 `forbidden-code`, listing the files in `items`), and runtime
installs on (409 `installs-elsewhere`: installing code while the site runs is
turned off). Templates a bundle carries unchanged need nothing more. Reverting a
run that installed code or changed templates needs `InstallCode` too. The answer's `code` lists the files a dry run would change; after an
apply it is `{ written, installed, live: false }`: the code runs after a
restart (`restart`).

The answer carries `dryRun`, `structural`, `bundle`, `counts` (`create`,
`update`, `unchanged`, `skip`), `findings` and `outstanding`. A dry run writes
nothing and adds `clean`. An apply adds `runId` and `published`. An apply with
findings outstanding is refused with 409 and the same body, with no `runId`.

`GET <api>/environments/{id}/runs?limit=&offset=` lists the applies, newest
first. `POST <api>/environments/{id}/runs/{run}/revert` with `{ "force": true }`
undoes one; a run that replaced files needs what a structural apply needs, and
one that installed code needs `InstallCode` as well.

## Approvals (optional)

A remote may answer a push with a job in `approval-required`, with an
`approvalUrl` where a person decides that one push. The client waits on the
job as on any other. The protocol says nothing about how the decision is
made.

In the reference server, with `remote.approvals` on, a push to a protected
environment waits:
- **Who decides:** someone else with the protected-push permission, through
  `POST <api>/jobs/{id}/approve` or `…/decline`, or the page at
  `<backoffice>/remote-approval?job=<id>`.
- **Self-approval:** a person can't approve their own push (403 `own-push`).
- **Expiry:** an approval expires after a day (`approval-expired`).
- **The passphrase:** kept meanwhile, sealed with `CROMBOLO_SECRET_KEY`, so
  approvals need that key.

## Media by reference (`media-fetch`, optional)

For a site whose media would make a file too big to move comfortably, the
file carries media metadata only. The manifest says `media: "referenced"`, and
`media.json` names every file with its key, size and etag, and no URI: a file
with no URI is not in the package, and the client fetches it from the remote by
key (bundle format 5, story 195).

| | |
| --- | --- |
| `POST <api>/environments/{id}/media/links` `{ "keys": [...] }` | up to 500 keys at a time; `{ "links": { key: { url, size, etag } \| null } }`, where a link may be the store's own presigned URL or `GET <api>/environments/{id}/media/{key}` |
| `POST <api>/environments/{id}/media/have` `{ "blobs": [{ key, etag? }] }` | `{ "have": [keys] }`: those the remote holds, with the same etag when given |
| `PUT <api>/environments/{id}/media/{key}` | one media file, with `Crombolo-Sha256`; 204 |

- **Pull:** pull with `media: "referenced"`, then fetch each file the client
  doesn't already hold with the same etag.
- **Push:** ask `have`, upload what is missing, then push a file whose media is
  referenced. The import refuses while any referenced file isn't in the store,
  and names them.
- **Permissions:** the same as pulling and pushing.

## The audit log (`audit`, optional)

`GET <api>/environments/{id}/audit` answers a page of who did what:

```json
{ "items": [{ "id": 41812, "occurredAt": "2026-10-24T09:12:03.000Z",
    "category": "content", "action": "Publish", "source": "request",
    "user": { "key": "…", "name": "Ada" },
    "item": { "type": "Document", "key": "…", "name": "About" },
    "ipAddress": "203.0.113.7", "forwardedFor": null, "detail": null }],
  "next": 41812, "truncated": false }
```

| Parameter | |
| --- | --- |
| `before` / `after` | an entry id: newest first below it, or oldest first above it (not both); neither is newest first |
| `limit` | 1 to 500, default 100 |
| `since`, `until` | times |
| `user` | an e-mail address, login or key |
| `category`, `action`, `entity` | as the entries name them |

- **`next`:** the cursor to pass back. Reading forward, it is the last id
  read, or the cursor itself when there was nothing newer. Reading backward,
  it is null at the end.
- **`truncated`:** the `after` entry has been deleted by retention, and so
  have the ones before it, so some entries were never seen.
- **Errors:** a bad query answers 400 `bad-query`. A person who may not read
  the log answers 403 `forbidden`.
- **The reference server** asks for the Settings section, as its audit
  dashboard does, and does not record the read.

## Finding content (`content-query`, optional)

`POST <api>/environments/{id}/content/query` takes the same body as the back
office's `content-query` endpoint and answers the same way, as the signed-in
person: their start nodes, their Browse permission and the properties they may
read ([`search.md`](search.md), "Finding content by its properties").

```json
{ "entity": "document", "contentTypes": ["newsPage"],
  "updated": { "from": "2026-10-01" },
  "properties": [{ "alias": "summary", "op": "empty" }], "take": 25 }
```

```json
{ "total": 3, "exact": true,
  "items": [{ "id": "…", "name": "Harbour lights", "path": [{ "id": "…", "name": "News" }],
    "contentType": { "id": "…", "alias": "newsPage" }, "state": "changed",
    "createDate": "…", "updateDate": "…" }] }
```

- **Errors:** a query that cannot be run answers 400 with `problems`, each
  named. A person without the Content section answers 403 `forbidden`.
- **The reference server** does not record the read.

## Undoing a change (`content-history`, `recycle-bin`, optional)

Story 353. A page's history and the recycle bin, as the back office's Info view
and recycle bin give them, answered as the signed-in person.

| | |
| --- | --- |
| `GET <api>/environments/{id}/content/{key}/history` | `{ page: { key, name }, versions }`, newest first |
| `GET <api>/environments/{id}/content/versions/{version}[?diff=true]` | `{ id, page, name, values, diff? }` |
| `POST <api>/environments/{id}/content/versions/{version}/rollback` `{ publish?, skipApproval? }` | makes it the page's draft, then with `publish` publishes it; `{ page, version, published }` |
| `PUT <api>/environments/{id}/content/versions/{version}/keep` `{ keep }` | keeps it from cleanup, or with `keep: false` stops; `{ version, kept }` |
| `GET <api>/environments/{id}/recycle-bin[?kind=content\|media][&olderThan=<days>]` | `{ items }`, newest first |
| `POST <api>/environments/{id}/recycle-bin/{key}/restore` `{ target? }` | puts it back with what was below it; `target` a key, or null for the top level |
| `GET <api>/environments/{id}/recycle-bin/jobs/{job}` | a restore handed to the background: `{ state, progress, error }` |

```json
{ "page": { "key": "…", "name": "Home" },
  "versions": [{ "id": "1043", "date": "2026-11-15T09:12:03.000Z", "kind": "save",
    "by": { "key": "…", "name": "Ana" }, "draft": true, "live": false, "kept": false }] }
```

- **A version** is the whole page, in every language. `kind` is `save`,
  `publish`, `rollback` or `migrate`; `by` is null for a version no person
  made. `values` are as the command line's `content show` gives them, and
  `diff` lists each property `added` (only in the version), `removed` (only in
  the draft) or `changed`, with its `draft` and `version` values.
- **A bin item** is `{ key, name, kind, trashedAt, by, from }`, `kind` being
  `content` or `media`, and `from` `{ key, path, gone }`: a null key and `/`
  for the top level, and `gone` when that place has been deleted or is in the
  bin itself. Only what was put in the bin is listed, not what went with it.
- **Who:** a person, never CI (403 `needs-person`), with the Content section
  for history, and the Content or Media section for the bin's items of that
  kind (403 `forbidden`). Rolling back, publishing and restoring are checked as
  the back office checks them; `skipApproval` is an administrator's.
- **The level:** a rollback, a keep and a restore need `content` (403
  `access-level`).
- **Errors:** a restore with no `target` whose place is gone answers 409
  `place-gone`. A publish that needs an approval answers 409 `needs-approval`;
  the rollback has been made by then, as a draft. An unknown page, version or
  item answers 404 `not-found`.
- **A large media branch** is restored in the background, answered 202
  `{ item, queued }`; poll the job until `succeeded` or `failed`.
- **The audit log** records `Rollback` and `Restore`, as the back office does.

## Members (`members`, `public-access`, optional)

Story 354. Members and member groups as the Members section has them, and who
may see a page as its public access dialog sets it, answered as the signed-in
person.

| | |
| --- | --- |
| `GET <api>/environments/{id}/members[?group=&type=&find=&skip=&take=]` | `{ items, total }`, by login |
| `GET <api>/environments/{id}/members/{member}` | one member, named by key, e-mail address or login |
| `POST <api>/environments/{id}/members` `{ email, type, login?, name?, groups?, sets?, password? }` | a new member, approved; 201 with the member |
| `PATCH <api>/environments/{id}/members/{key}` | a change, below; `{ member, changed, password }` |
| `DELETE <api>/environments/{id}/members/{key}` | removes them; the member as they were |
| `GET <api>/environments/{id}/member-groups` | `{ groups }`: each `{ key, name, members, pages }` |
| `POST <api>/environments/{id}/member-groups` `{ name }` | a new group; 201 `{ key, name }` |
| `DELETE <api>/environments/{id}/member-groups/{name}[?confirmed=true]` | removes it; its members stay |
| `GET <api>/environments/{id}/content/{key}/access` | who may see the page |
| `PUT <api>/environments/{id}/content/{key}/access` `{ groups?, members?, loginPage?, noAccessPage? }` | makes it for those groups or members; the access as it is then |
| `DELETE <api>/environments/{id}/content/{key}/access` | removes its own rule; `{ access, changed }` |

```json
{ "key": "…", "login": "ana@example.com", "email": "ana@example.com", "name": "Ana Lee",
  "type": "member", "groups": ["Subscribers"], "approved": true, "locked": false,
  "signsIn": "password", "lastSignIn": null, "twoFactor": false, "failedSignIns": 0,
  "values": [{ "property": "phone", "culture": null, "value": "0400 111 222" }] }
```

- **A member** is the summary in a list, and with `twoFactor`, `failedSignIns`,
  the lockout, password and save dates, and `values` alone. `signsIn` is
  `password`, `provider` (only through an identity provider) or `api` (a Delivery
  API client). A sensitive value is left out for a person outside Sensitive data.
- **A change** names only what changes: `email`, `login`, `name`, `sets` (pairs of
  property and value in the shorthand content files use, which the server
  converts), `unset`, `addGroups`, `removeGroups`, `approved`, `locked`, `password`,
  `generatePassword` (answered once as `password`) and `twoFactor: false`. What it
  leaves out is kept; a change to nothing saves nothing, with `changed: false`.
- **A page's access** is `{ page, rule, protectedBy, groups, members, loginPage,
  noAccessPage }`: `rule` is `own`, `ancestor` (the nearest protected ancestor's,
  `protectedBy`) or `none`, open to everyone; each page is `{ key, path }`. A rule
  names groups or members, never both, and at least one, with both pages; a page
  that has its own rule keeps the pages a `PUT` leaves out.
- **Who:** a person, never CI (403 `ci-cannot-change-people`), with the Members
  section for members and groups and the Content section for a page's access (403
  `forbidden`), which also needs the Public access permission on the page.
- **The level:** a write needs `content` (403 `access-level`).
- **Errors:** an unknown member, group or page answers 404 `not-found`; an e-mail
  or login another member has, or a group name taken, 409 `conflict`; a sensitive
  value set by a person outside Sensitive data, 403 `forbidden`; a save that does
  not validate, 400 `invalid` with `items`. Removing a group a page's access names
  answers 409 `conflict`, listing those pages in `items`, unless `confirmed=true`.
- **The audit log** records each write to a member or a group by its key, with the
  person and their address, and never the member's name, e-mail or values. A
  page's access is recorded as the back office's is.

## Users (`users`, optional)

Story 356. Back-office users as the Users section has them, the browsers and
terminals signed in, and where a user group starts and who owns it, answered as
the signed-in person through the same rules.

| | |
| --- | --- |
| `GET <api>/environments/{id}/users?find=<who>` or `users/{who}` | one user, named by key, e-mail address or username |
| `PATCH <api>/environments/{id}/users/{key}` `{ name?, email?, addGroups?, removeGroups?, uiLanguage? }` | a change; `{ user, changed }` |
| `DELETE <api>/environments/{id}/users/{key}` | removes someone who has never signed in; the user as they were |
| `GET <api>/environments/{id}/sign-ins[?user={key}]` | `{ items }`: the caller's open sign-ins, or that user's |
| `DELETE <api>/environments/{id}/sign-ins/{id}` | ends one, by its id or at least its first eight characters; the sign-in |
| `PATCH <api>/environments/{id}/user-groups/{alias}[?dryRun=true]` `{ content?, media?, library?, addOwners?, removeOwners? }` | where it starts and who owns it; `{ group, changed }` |

```json
{ "key": "…", "name": "Ada King", "email": "ada@example.com", "userName": "ada@example.com",
  "state": "Active", "groups": ["editor"], "uiLanguage": null, "lastSignIn": "2026-11-15T09:12:00.000Z" }
```

- **A change** names only what changes; groups by alias. `changed` lists what did
  (`name`, `email`, `userName`, `groups`, `uiLanguage`), empty for a change to
  nothing, which saves nothing. A username that was the e-mail follows a new one
  where usernames are e-mail addresses.
- **A sign-in** is `{ id, user: { key, name }, kind, device, signedIn, lastUsed,
  address, current }`: `kind` is `browser` or `terminal`, a device sign-in, which
  `device` names; `current` marks the one the request's own token belongs to. An
  open one has not ended and still has a refresh token to renew.
- **A group's place** is `{ key, alias, name, content, media, library, owners }`:
  each tree is `{ at, key, path }`, with `at` one of `root`, `none` or `node`, and
  owners by alias. A change names a place by path or key, `root` or `none`; owners are
  added and removed by alias. Owners the group's file names are the file's, so a site
  whose files are not written refuses them (403 `forbidden`). `dryRun=true` says what
  would change and changes nothing.
- **Who:** a person, never CI (403 `ci-cannot-change-people`), with the Users
  section for users and groups (403 `forbidden`). A sign-in needs no section: your
  own are yours, and someone else's are an administrator's. Only an administrator
  changes an administrator's account, or a group; anyone else adds people to and
  takes them out of only the groups they own.
- **The level:** a write needs `content` (403 `access-level`).
- **Errors:** an unknown user, group, place or sign-in answers 404 `not-found`; an
  e-mail or username another user has, 409 `conflict`; a refusal, 403 `forbidden`
  with the reason in `title`: someone who has signed in, yourself, the built-in
  administrator, and a change that would leave the site with no administrator.
- **The audit log** records each write as the Management API records the same change:
  a user's `Save` and `Delete`, a group's `Save` (category `permission`), and
  `EndSession` keyed by whose sign-in it was, with the person and their address, by key.

## Background jobs (`background-jobs`, optional)

Story 359. The site's and its bundles' background jobs as Settings → Background
jobs lists them, and a failed one run again as its button does. They are named
`background-jobs` so they are never confused with `jobs/{id}`, a pull's or a
push's.

| | |
| --- | --- |
| `GET <api>/environments/{id}/background-jobs[?state&owner&skip&take]` | `{ total, waitingSince, items }`, the newest first |
| `GET <api>/environments/{id}/background-jobs/{job}` | one job, by its id or at least its first eight characters |
| `POST <api>/environments/{id}/background-jobs/{job}/retry` | runs a failed job again from its first attempt; `{ ok, job, message }` |

```json
{ "id": "…", "owner": "site", "name": "imports.runBatch", "state": "failed",
  "attempts": 5, "maxAttempts": 5, "nextAttemptAt": "2026-11-15T09:12:00.000Z",
  "progress": { "done": 40, "total": 100, "note": "species checked" },
  "error": "the registry is down", "queuedBy": "Ada King",
  "createdAt": "2026-11-15T09:00:00.000Z", "finishedAt": "2026-11-15T09:12:00.000Z" }
```

- **The list** narrows by `state` (`queued`, `running`, `succeeded`, `failed`) and
  `owner` (`site`, or a bundle's id); `take` is 1 to 200, 50 by default.
  `waitingSince` is set while the node answering leaves its jobs to a worker and
  none is running. A job's payload is its owner's, and is not shown.
- **A prefix** naming two jobs answers 409 `conflict`, naming both; one shorter
  than eight characters, 400 `bad-request`.
- **A retry** is for a failed job only: any other answers 409 `conflict`, with its
  state in `detail`. A node running jobs takes it up within five seconds.
- **Who:** a person with the Settings section, never CI (403
  `ci-cannot-manage-jobs`); without the section, 403 `forbidden`.
- **The level:** a retry needs `content` (403 `access-level`).
- **The audit log** records a retry as the dashboard does: category `system`,
  `Retry` of a `Job` named `owner/name`, with the error it failed with, as the
  person, with their address.

## What an extension did (`extension-activity`, optional)

Story 362. An extension's activity as Installed → "See what it did" reads it, and
the same as its CSV export. They are answered before `bundle-manage`'s
`installed/…` routes, under their own capability, so a site from before them is
told apart by discovery rather than by a 405.

| | |
| --- | --- |
| `GET <api>/environments/{id}/installed/{ext}/activity[?kind&person&since&until&before&limit]` | `{ items, next }`, the newest first |
| `GET <api>/environments/{id}/installed/{ext}/activity/summary` | `{ counts, people, days }`: each kind's count over the window the site keeps, and everyone it acted for |
| `GET <api>/environments/{id}/installed/{ext}/activity.csv[?kind&person&since&until]` | every row the filters match, as `text/csv`: `when,person,kind,area,verb,item,count,outcome,ms` |

```json
{ "id": 812, "extensionId": "crm", "personKey": "…", "personName": "Ada King",
  "kind": "write", "area": "content", "verb": "save", "entityKey": "…", "count": 1,
  "outcome": "ok", "ms": 12, "occurredAt": "2026-11-15T09:12:00.000Z" }
```

- **`{ext}`** is the extension's id, not its package name; a removed extension's rows
  are found by it until they are pruned.
- **The filters:** `kind` is one of `read`, `write`, `request`, `rows`, `call`,
  `screen` and `refused`; `person` is a user's key, e-mail or login, or `itself`,
  and one that is nobody answers 404 `not-found`; `since` and `until` are times.
  `limit` is 1 to 500, 100 by default, and `next` passed back as `before` gives the
  page after. A query that is not one answers 400 `bad-request`.
- **Fresh:** what the extension did in the last second is written before answering.
- **Who:** a person with the Settings section, never CI (403
  `ci-cannot-read-activity`); without the section, 403 `forbidden`. Reading it is
  not itself audited.

## The media library (`media-library`, `media-access`, `content-show`, optional)

Story 355. Media already in the library as the Media section shows and changes it,
who may see an item as its Permissions dialog sets it, and a page as `content show`
gives it. They are named `media-items` and `content-items` so they are never
confused with `media/{key}`, a push's or a pull's file.

| | |
| --- | --- |
| `GET <api>/environments/{id}/media-items[?under&type&name&skip&take]` | `{ total, items }`: with `name`, the items whose names hold it anywhere below `under`; without, the items in `under`, or at the top |
| `GET <api>/environments/{id}/media-items/{item}[?references=true&skip&take]` | one item: type, folder, file and its address, size, width, height, alternative text, focal point, and `access`, the dialog's summary; with `references`, what uses it |
| `PATCH <api>/environments/{id}/media-items/{item}` | `{ name?, alt?, focal?: "x,y", dryRun? }`; answers `{ key, name, path, changed }` |
| `PUT <api>/environments/{id}/media-items/{item}/file[?dryRun=true]` | a new file, streamed as a push's media is, its name in `Crombolo-File-Name` (URI-encoded); the key is kept and the old file removed. Answers as `PATCH` does, with `references` |
| `POST <api>/environments/{id}/media-items/folders` | `{ path }`: makes the folders along it that are missing; `{ key, path, made }` |
| `GET <api>/environments/{id}/media-items/{item}/access` | `{ key, name, path, summary, form, state }`: the dialog's summary and form, and everything it reads |
| `PUT <api>/environments/{id}/media-items/{item}/access` | `{ see?: "anyone" \| "back-office", groups?: [name], level?: "read" \| "change" \| "none", inherit?: boolean }`; answers as `GET` does |
| `GET <api>/environments/{id}/content-items/{page}[?references=true&skip&take]` | `{ key, path, type, typeName, variants, values }`, and `references` when asked |

```json
{ "total": 3, "items": [{ "key": "…", "name": "hero.jpg", "path": "/Gallery/hero.jpg",
  "type": "Image", "folder": false, "size": 81234 }] }
```

- **`{item}` and `{page}`** are a key, or a path (`/Gallery/hero.jpg`) encoded as one
  segment; the route resolves it.
- **Paging:** `take` is 1 to 100, 25 by default.
- **References** are `{ total, items }`, each `{ key, name, kind, path, type }`, `kind`
  one of `page`, `media`, `library`, `member` and `other`: what names the item in its
  values now, as the back office's "Used by" finds it.
- **Refusals:** an item not found, or in the recycle bin, answers 404 `not-found`; one
  outside the person's start nodes, or a change their permissions do not allow, 403
  `forbidden`; alternative text or a focal point its type cannot hold, a file it does
  not take, or a file where a folder is asked for, 422 `refused`, with the types that
  would take the file in `detail`; an unknown member group, 404 with the site's groups
  in `detail`; a body that is not one, 400 `bad-request`. A file past the site's upload
  limit answers 413 `too-large`.
- **Who:** a person with the Media section for `media-items`, or Content for
  `content-items`, within their start nodes; never CI (403
  `ci-cannot-change-media`, "Reading media needs a person" or "Changing media needs a
  person"; `ci-cannot-read-pages` for a page); without the section, 403 `forbidden`.
- **The level:** a change needs `content` (403 `access-level`).
- **The audit log** records a change to an item or a folder made as the back office's
  are, `Save` and `Create` of `Media`, and a change to who may see it as
  `SetPermissions` of `MediaAccess`, with the summary it came to; each as the person,
  with their address.

## Installed bundles (`bundle-manage`, optional)

The bundles the environment depends on, managed as its Settings → Extensions does
(story 241).

| | |
| --- | --- |
| `GET <api>/environments/{id}/installed` | `{ installs, installsElsewhere, restartPending, items }`: each bundle's `packageName`, `version`, `carries`, `wired`, `on`, `permissions` and `granted`; `restartPending` is `{ since, reasons }` or null |
| `POST <api>/environments/{id}/installed` `{ name, version?, grant: [...], applyContent? }` | installs it; the answer carries `dependency`, `message` and `restartPending` |
| `DELETE <api>/environments/{id}/installed/{name}` | removes it |
| `POST <api>/environments/{id}/installed/{id}/disable` or `/enable` | turns its server features off or on, at once; `{ ok, on, message }` |

- **The level:** listing needs `read`, everything else `all` (403
  `access-level`).
- **Installing and removing** need the push permission, ApplyStructure (403
  `forbidden-structure`) and `Crombolo.Remote.InstallCode` (403
  `forbidden-code`), which an administrator holds only when a group gives it
  to them. A site that does not install while it runs answers 409
  `installs-elsewhere`, with what to do instead in `detail`.
- **The grant is the consent.** `grant` must name every permission a bundle
  with server code asks for, and nothing else: otherwise 409 `grant-mismatch`,
  with `not granted: …` and `not asked for: …` in `items`. Nothing is
  installed.
- **Never wired here.** Installing adds the dependency; the site's
  `crombolo.config.ts` turns its server code on, and that arrives by an apply
  of the site's structure.
- **Turning one off or on** needs an administrator, or a CI rule holding
  ApplyStructure (403 `forbidden`); a name the site has no bundle with a server
  half for answers 404.
- **Installed code runs after a restart** ([Restarting](#restarting-restart-optional)).
- **The audit log** records `Install`, `Uninstall`, `Disable` and `Enable`
  against the bundle, as the back office does.

## Restarting (`restart`, optional)

`POST <api>/environments/{id}/restart` asks for a new server, and answers once
it is serving or has failed (story 241). In the reference server, the
`crombolo start` that supervises the site starts the new server beside the old
one, so a restart is not an outage ([`operations.md`](operations.md),
"Restarting"). Code installed since the site started runs once it has
restarted.

- **Who:** the site's level must be `all` (403 `access-level`). A person must
  be an administrator, and CI's trust rule must hold
  `Crombolo.Remote.InstallCode` (403 `forbidden`).
- **The answer:** 200 `{ "restarted": true }`. A new server that failed to
  start answers 502 `restart-failed`, with why in `detail`, and the old server
  is still serving.
- **A site nothing supervises** answers 409 `not-supervised`, and does not offer
  the capability.
- **The audit log** records `RemoteRestart`, or `RemoteRestartFailed` with the
  reason.

## Errors

| Status | `code` | |
| --- | --- | --- |
| 400 | `passphrase-required`, `hash-required`, `hash-mismatch`, `body-required`, `bad-key`, `too-many`, `bad-query`, `bad-request`, `invalid` | the request is wrong; `invalid`, a member that does not validate |
| 401 | `sign-in-required` | no token, or a lapsed one |
| 403 | `forbidden`, `forbidden-protected`, `forbidden-structure`, `forbidden-code`, `own-push`, `needs-person`, `ci-cannot-change-people`, `ci-cannot-manage-jobs` | the person may not; `needs-person`, `ci-cannot-change-people` and `ci-cannot-manage-jobs`, CI may not |
| 403 | `signature-refused` | the site does not take the bundle: unsigned where it requires a signature, from a source it does not list, or a signature that does not check out (story 060) |
| 403 | `access-level` | the site does not take that, at its `CROMBOLO_REMOTE_ACCESS` |
| 404 | `not-found`, `no-such-environment`, `not-enabled` | |
| 409 | `not-waiting`, `approval-expired` | the job is not in a state for that |
| 409 | `place-gone`, `needs-approval` | a restore needs a `target`; a publish needs an approval |
| 409 | `conflict` | an e-mail, login or group name taken, a group a page names removed unconfirmed, a job prefix naming two, or a retry of a job that has not failed |
| 409 | `not-supervised` | nothing on the site can restart it |
| 409 | `installs-elsewhere`, `grant-mismatch` | the site installs no code while it runs; the grant is not what the bundle asks for |
| 410 | `gone` | the download has expired |
| 413 | `too-large` | over the remote's upload limit |
| 502 | `restart-failed` | the new server did not start; the old one is serving |
| 503 | `approvals-unavailable` | the remote cannot hold a push for approval |

## The reference server

Off by default:

| Setting | |
| --- | --- |
| `remote.access` / `CROMBOLO_REMOTE_ACCESS` | what the site takes from elsewhere: `off` (the default), `read`, `content` or `all`, below |
| `remote.environment` / `CROMBOLO_REMOTE_ENVIRONMENT` | this server's environment, default `production` |
| `remote.protected` / `CROMBOLO_REMOTE_PROTECTED` | default true |
| `remote.approvals` / `CROMBOLO_REMOTE_APPROVALS` | protected pushes wait for approval; needs `CROMBOLO_SECRET_KEY` |
| `remote.maxUploadBytes` / `CROMBOLO_REMOTE_MAX_UPLOAD_GB` | default 50 GB, for pushes and media uploads only |

**Access levels** (story 167). Each level takes everything the one before it
does:

| `CROMBOLO_REMOTE_ACCESS` | The site takes |
| --- | --- |
| `off` | nothing: the protocol answers 404 `not-enabled` |
| `read` | pulls |
| `content` | also bundles of content and media, applied and reverted |
| `all` | also whole-site pushes, and bundles that change content types, views, styles or code |

A request the level does not allow is refused with 403 `access-level`, naming
the level it needs. `CROMBOLO_REMOTE_ENABLED`, the switch this replaced, now
stops the site starting, naming `CROMBOLO_REMOTE_ACCESS` instead.

**Permissions.** Each is a user group permission under "Moving whole sites":

| Permission | |
| --- | --- |
| `Crombolo.Remote.Pull` | pull |
| `Crombolo.Remote.PullFull` | a full pull |
| `Crombolo.Remote.Push` | push, and apply or revert a bundle of content |
| `Crombolo.Remote.PushProtected` | push to, and approve pushes to, a protected environment |
| `Crombolo.Remote.ApplyStructure` | "Change a site's structure": a whole-site push, and a bundle that changes content types, stylesheets, scripts or code |
| `Crombolo.Remote.InstallCode` | "Install code on this site": installing a bundle, a bundle whose code, migrations or templates change the site's files (stories 241, 336), and a whole-site push |

A whole-site push and a structural bundle need `ApplyStructure` as well as
`Push`, and `PushProtected` too on a protected environment. A whole-site push
also needs `InstallCode` (story 336): it replaces the site's templates, which
are code, and what it will change is not known until it is uploaded. A bundle of content
alone needs `Push`, and `PushProtected` where the environment is protected.
Administrators have the first five. `InstallCode` is held only where a group
names it, administrators included, and no group has it until someone gives it.

**How it runs:**
- **Where jobs live.** A job runs on the node that took it. Its state is in
  `remote_job` and its file in the media store under `.remote/`, so any node
  in a cluster answers a poll or a download.
- **Clean-up.** Files go an hour after a job finishes, and rows a day after
  that.
- **Upload size.** Only the push and media upload routes take bodies beyond
  `maxRequestBodyBytes`; every other route keeps that limit.
- **Audit.** Every pull, push and approval decision is written to the audit
  log.

## The CLI (stories 108, 352)

`crombolo profile`, `remote trust`, `remote job`, `login`, `logout`, `whoami`,
`pull`, `push` and `media fetch` are this protocol's reference client
(`packages/cli/src/remote/`, `packages/cli/src/profiles/`).

- **Profiles** name the sites a person reaches, in `~/.crombolo/profiles`
  (`CROMBOLO_PROFILES_FILE` puts it elsewhere), a TOML file of their own with a
  table per profile: a hosted site's `url`, with an optional `environment`, or a
  site folder's `path`, absolute or from `~`. A key it doesn't know, a bad name
  or bad TOML is refused, naming the line. `profile add` and `profile remove`
  rewrite only the table they are about, so the person's comments and order
  stay.
- **Which site a command acts on:** `--profile`, then `CROMBOLO_PROFILE`, then
  `CROMBOLO_PROFILE_URL` with `CROMBOLO_PROFILE_ENVIRONMENT`, then the `default` profile. The
  default is used only by a command that always acts on a hosted site
  (`site deploy`, `remote trust`, `remote job`) and for the side of `push` or
  `pull` that defaults to it. A command that can act on this folder's site
  acts on it unless one of the first three says otherwise, so nobody publishes
  to production by forgetting where they are. With nothing chosen and no
  `default`, a hosted-only command is refused, listing the profiles there are.
- **A folder profile** on a single-site command runs the command as it would
  run in that folder. A hosted-only command refuses one.
- **`push` and `pull`** copy one site over another, `--from` and `--to`, each a
  profile and either a folder or hosted. `push` defaults `--from` to this
  folder's site and `--to` to the default; `pull` the other way round. Folder
  to folder is an export applied here, checked and backed up; folder and
  hosted is a push or a pull as above; hosted to hosted is a pull into a
  temporary folder, then a push from it, everything passing through this
  machine. The receiving site's own rules hold either way.
- **Sign-ins** are in the keychain, through `Bun.secrets`, keyed by the API's
  origin and refreshed as they run out, so two profiles for one site share a
  sign-in. A machine whose keychain can't be reached keeps them in
  `~/.crombolo/credentials` instead, JSON by origin, readable only by its owner,
  and `crombolo login` says which it used. `CROMBOLO_CREDENTIALS=keychain|file`
  chooses one. A sign-in is never in the profiles file.
- **A CI job** names its site with `CROMBOLO_PROFILE_URL` (and `CROMBOLO_PROFILE_ENVIRONMENT`)
  alongside its other settings, and signs in with its identity token, as above.
- **A site folder's `remotes.toml`** (before story 352) is no longer read.
  A command run where there is one says once how to move it:
  `crombolo profile import`.
- **Passphrases:** each pull and push seals its file with a passphrase made
  for that transfer alone.
- **A lazily pulled site** reads media through from the remote it came from,
  with `.crombolo/remote-media.json` saying which remote, under the same
  sign-in the CLI keeps.

## Conformance

```bash
bunx crombolo-remote-conformance https://example.com --token <token> [--environment <id>] [--push]
```

The suite is read-only unless `--push` is given. It covers:
- discovery and the device endpoint;
- the API's refusals;
- environments;
- a pull to completion, checked against its stated hash;
- media links, when offered;
- an audit page, oldest first, when offered;
- an unknown page's history and version, and the recycle bin, when offered;
- members and member groups listed and an unknown member not found, and a page's
  access read back, when offered;
- background jobs listed, and a retry of an unknown job and of one that has not
  failed refused, when offered and the token may;
- media listed and one shown with what uses it, an unknown item not found, and its
  name changed and changed back; an item's access read and a change it cannot read
  refused; and a page shown, when offered and the token may;
- a refused tampered push;
- with `--push`, a full push.

The reference server passes it in `tests/remote-conformance.test.ts` on both
database dialects.

[RFC 8628]: https://www.rfc-editor.org/rfc/rfc8628
