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
            "applyStructure": true, "audit": false } }]
```

`audit` is there when the remote offers the capability. `access` is the site's
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
| `runId` | a finished push: the import's run, which `bundle revert` undoes |

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
2. replaces the environment with the file, as `crombolo import --replace` does;
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
`crombolo bundle apply` does on its own machine (story 167):
- **Body:** the bundle as an npm tarball (`application/gzip`).
- **`Crombolo-Sha256`:** its SHA-256, in hex (400 `hash-mismatch` when it differs).
- **`Crombolo-Options`:** JSON, every field optional: `dryRun`, `publish`,
  `label`, `resolutions` and `resolveAll`.

A bundle of content alone needs the `content` level and the push permission. One
that carries content types, views, styles or code needs the `all` level (403
`access-level`) and `Crombolo.Remote.ApplyStructure` (403 `forbidden-structure`).

The answer carries `dryRun`, `structural`, `bundle`, `counts` (`create`,
`update`, `unchanged`, `skip`), `findings` and `outstanding`. A dry run writes
nothing and adds `clean`. An apply adds `runId` and `published`. An apply with
findings outstanding is refused with 409 and the same body, with no `runId`.

`GET <api>/environments/{id}/runs?limit=&offset=` lists the applies, newest
first. `POST <api>/environments/{id}/runs/{run}/revert` with `{ "force": true }`
undoes one; a run that replaced files needs what a structural apply needs.

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

## Errors

| Status | `code` | |
| --- | --- | --- |
| 400 | `passphrase-required`, `hash-required`, `hash-mismatch`, `body-required`, `bad-key`, `too-many`, `bad-query` | the request is wrong |
| 401 | `sign-in-required` | no token, or a lapsed one |
| 403 | `forbidden`, `forbidden-protected`, `forbidden-structure`, `own-push` | the person may not |
| 403 | `access-level` | the site does not take that, at its `CROMBOLO_REMOTE_ACCESS` |
| 404 | `not-found`, `no-such-environment`, `not-enabled` | |
| 409 | `not-waiting`, `approval-expired` | the job is not in a state for that |
| 410 | `gone` | the download has expired |
| 413 | `too-large` | over the remote's upload limit |
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
| `Crombolo.Remote.ApplyStructure` | "Change a site's structure and code": a whole-site push, and a bundle that changes content types, views, styles or code |

A whole-site push and a structural bundle need `ApplyStructure` as well as
`Push`, and `PushProtected` too on a protected environment. A bundle of content
alone needs `Push`, and `PushProtected` where the environment is protected.
Administrators have all five.

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

## The CLI (story 108)

`crombolo remote`, `login`, `logout`, `whoami`, `pull`, `push` and `media fetch`
are this protocol's reference client (`packages/cli/src/remote/`).
- **Remotes** are in `remotes.toml`.
- **Sign-ins** are in the keychain, through `Bun.secrets`, keyed by the API's
  origin and refreshed as they run out.
- **Passphrases:** each pull and push seals its file with a passphrase made
  for that transfer alone.
- **A lazily pulled site** reads media through from the remote it came from,
  with `.crombolo/remote-media.json` saying which remote.

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
- a refused tampered push;
- with `--push`, a full push.

The reference server passes it in `tests/remote-conformance.test.ts` on both
database dialects.

[RFC 8628]: https://www.rfc-editor.org/rfc/rfc8628
