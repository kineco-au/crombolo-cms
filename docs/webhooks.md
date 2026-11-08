# Webhooks

A webhook calls a URL when content changes, so a search index, a cache or a
build pipeline can react without polling (story `044`). A server bundle can
handle the same events in code.

## What a webhook is

A URL, the events it hears, optionally the content types it cares about, and
headers to send. It is edited in Settings → Webhooks, Umbraco's own screens,
through the Management API's webhook operations.

| Event | Raised by |
| --- | --- |
| `Umbraco.ContentSaved` | creating or saving a page |
| `Umbraco.ContentPublish` | publishing, by hand or on schedule |
| `Umbraco.ContentUnpublish` | unpublishing, by hand or on schedule |
| `Umbraco.ContentDelete` | deleting a page, from the bin or directly |
| `Umbraco.ContentMovedToRecycleBin` | moving a page to the bin |
| `Umbraco.ContentMoved` | moving a page, or restoring one from the bin |
| `Umbraco.ContentCopied` | copying a page |
| `Umbraco.ContentSorted` | sorting a page's children; the key is the parent's |
| `Umbraco.ContentRolledBack` | rolling a page back to an earlier version |
| `Umbraco.MediaSave` | creating or saving a media item |
| `Umbraco.MediaDelete` | deleting a media item |

The aliases are Umbraco's, so the backoffice's event picker and an imported
site mean the same thing. An event is raised only when the change really
happened. A publish request that only schedules a publish raises nothing until
the schedule runs, and then raises the same event as a publish by hand. Every
document write raises its event from the same place, `webhookFor` in
`@crombolo/content`, so a page published from the command line, by an approval
or by a form's workflow raises what a publish in the backoffice does.

A webhook limited to some content types still hears about a deleted item whose
type can no longer be read. A missed delete is worse than an extra one.

## Where a webhook is kept

Each webhook chooses, on its screen's **Where it's kept** panel:

- **With the site's files**, as `schema/webhooks/<key>.toml`. It is versioned
  and deployed with the site, and a backoffice edit writes the file back, as a
  form's does. A header that carries a secret names a server setting instead:
  `Authorization = "env:CROMBOLO_WEBHOOK_SEARCH_TOKEN"`. A typed-in value is
  refused, so a secret never reaches a repository.
- **In this environment only**, in the database. A secret may be typed in.
  The headers are sealed with AES-256-GCM using `CROMBOLO_SECRET_KEY` (32+
  characters), which lives only in the environment, so a database dump alone
  reveals nothing. Without that key this store is not offered.

A new webhook starts in this environment when the key is set, otherwise with
the files. A node with neither refuses to add one, and says which setting to
add. A webhook holding a typed-in secret cannot move into the files until the
header names a setting instead.

A typed-in secret never comes back from the server: the backoffice sees
`********`, and sending that back keeps what is stored. An `env:` reference is
not a secret, so it is shown as written.

```toml
[webhook]
alias = "searchIndex"
name = "Search index"
url = "https://search.example/hook"
events = ["Umbraco.ContentPublish", "Umbraco.ContentDelete"]
content-types = ["article"]

[webhook.headers]
Authorization = "env:CROMBOLO_WEBHOOK_SEARCH_TOKEN"
```

A file is `schema/webhooks/<alias>.toml` (story 161). Its key is derived from
the alias, so the file carries a `key` line only for a webhook made before, or
in the back office, whose key differs. A back-office save names the file after
the webhook's name. Content types are named by alias, and a uuid is read as a
key. A content type the site has not got matches nothing, so a typo narrows
the webhook rather than widening it, and the server logs it.
`crombolo webhooks new <alias> --url … --event …` writes one, checked as the
server reads it.

## What is sent

A `POST` of Umbraco's Minimal payload, the item's key: `{ "Id": "<key>" }`.
The receiver fetches what it needs, and nothing unpublished leaves the site.
Every delivery carries:

| Header | Value |
| --- | --- |
| `Webhook-Event` | the event alias |
| `Webhook-Retry-Count` | 0 on the first attempt |
| `Webhook-Id` | the webhook's key |
| `Webhook-Delivery` | this delivery's id, the same on every retry, for de-duplication |
| `Webhook-Event-Id` | the change's id, the same for every webhook it reaches (story 171) |

Umbraco's `Umb-` prefix is not used. A webhook may not set these, nor
`Content-Type` or `Host`, itself.

**Crombolo's payload.** A webhook file may set `payload = "crombolo"` to be sent
`{ "Id": "<key>", "ContentType": "<alias>", "Ancestors": ["<parent key>", …] }`,
the ancestors nearest first (story 208). It is what a front end needs to clear
its cache for a page and every page that lists it.
- **Captured with the change,** in the same transaction, so a delete still
  names where the page was.
- **For a page in the recycle bin,** the ancestors are where it was before it
  was trashed.
- **Set in the file only:** the back office has no field for it, and keeps the
  file's choice when it edits the webhook. Such a webhook cannot move into the
  database.

```toml
[webhook]
alias = "nextRevalidate"
url = "https://www.example.com/api/crombolo/revalidate"
events = ["Umbraco.ContentPublish", "Umbraco.ContentUnpublish", "Umbraco.ContentDelete"]
payload = "crombolo"

[webhook.headers]
X-Crombolo-Secret = "env:CROMBOLO_REVALIDATE_SECRET"
```

## Delivery

Delivery is **at least once**, and nothing a committed change raises is lost
to a crash or a restart (story 171).

1. **The change records its event.** Every page and media change writes a row
   to `content_event` in its own transaction. The row holds the facts as they
   were when the change committed: the item, its type, and who made the
   change. A change that rolls back leaves no event, and an event never
   outlives a change that did not happen.
2. **The dispatcher turns it into deliveries.** It runs straight after the
   commit and again every 15 seconds. It picks the listening webhooks and
   bundle handlers, inserts one `webhook_delivery` row per event and webhook,
   and marks the event dispatched, all in one transaction. A crash part way
   repeats the step. The unique key on `(event_id, subscriber)` means a repeat
   queues nothing twice. Changes made from the command line wait for a running
   server's dispatcher.
3. **The delivery job sends them.** It also runs every 15 seconds, on the nodes
   that run jobs. Each row is claimed with
   `UPDATE … WHERE state = 'pending' … RETURNING`, so on a cluster exactly one
   node sends it. A claim left by a node that died is released after 15
   minutes.

A publish quickly followed by an unpublish raises both events, because each
event carries the facts from its own commit. Receivers should de-duplicate on
`Webhook-Delivery`, since a delivery whose answer was lost is sent again.

- **2xx** is delivered.
- **5xx, 408, 429, a timeout (30 s) or a network failure** is retried, at 1,
  5, 15 and 60 minutes, five attempts in all, as form workflows are.
- **Any other status** is not retried: the receiver refused, and will again.
- **An `env:` setting that is not set**, or one a webhook may not send, fails
  at once and says which.
- **An address this site does not send to** fails at once, saying why, with
  nothing sent ("What a webhook may reach").

Every attempt is in the delivery log (`webhook_log`), which the backoffice
shows per webhook and for all of them. It holds the status, the request body
and the names of the headers sent, with their values masked. Of the answer it
keeps only the status, the `Content-Type` and the first 1 KB of a text body:
enough to see why a receiver refused, not enough to read a page back through
it. Nothing of a binary answer is kept, and no other header.

**Keeping and recovering.**
- Delivered rows, log entries and dispatched events are pruned after
  `CROMBOLO_EVENT_RETENTION_DAYS`, 30 by default.
- Failed deliveries and events are kept until someone acts on them:
  - `crombolo events status` shows what is waiting and what failed;
  - `crombolo events failed` says why each failed;
  - `crombolo events retry <id>` or `crombolo events retry --all` sends them
    again.
- The **Outgoing changes** health check, under Servers, warns when anything
  has failed, or when work has waited more than ten minutes.

## What a webhook may reach

Whoever may edit webhooks chooses where they go and what they send, so three
rules keep one from reading the server's secrets or its network (story 301).

- **The variables a header may name.** `env:NAME` takes a variable starting
  `CROMBOLO_WEBHOOK_`, `CROMBOLO_REVALIDATE_SECRET` (made to be sent, to a
  Next.js front end), or one the config lists:

  ```ts
  webhooks: { headerVariables: ['SEARCH_TOKEN'] }
  ```

  No other `CROMBOLO_` setting is ever sent, listed or not, and nor is anything
  else on the server: not the database password, the secret key or a client
  secret. Saving a webhook that names one is refused, saying how to allow it,
  and one stored before fails its delivery with the same words.
- **Where a delivery may go.** The host is resolved before connecting, every
  address it has is checked, and the request goes to the address that was
  checked, with the hostname kept for the `Host` header and the certificate. So
  a name cannot be pointed somewhere else between the check and the connection.
  Refused: loopback, private (10/8, 172.16/12, 192.168/16, `fc00::/7`),
  link-local (169.254/16, a cloud's metadata endpoint among them, and
  `fe80::/10`), carrier-grade NAT (100.64/10), multicast, unspecified and
  broadcast addresses, and IPv4 addresses written as IPv6. Saving checks it
  where the host already resolves; each delivery checks it again, and a refusal
  is not retried. Redirects are never followed.

  ```ts
  webhooks: { allowPrivateAddresses: true }
  ```

  allows those addresses, for an intranet, or a front end beside the CMS on a
  private network. A development site (`NODE_ENV` other than `production`) allows
  them unless this says `false`, since its receivers, such as the Next.js template's at
  `localhost:3000`, are usually on the same machine.
- **What is kept of the answer:** the status, `Content-Type` and 1 KB of text,
  as above.

A bundle's handlers reach the outside through the `fetch` they are given, held
to the same address rule.

## A bundle's handlers

A server bundle declares handlers by event alias:

```ts
export const hooks = (): ServerBundle => ({
  id: 'acme-hooks', section: 'settings', capabilities: [], routes: [],
  events: {
    'Umbraco.ContentPublish': async ({ payload, attempt, fetch, log, signal }) => {
      await fetch('https://cdn.example/purge', { method: 'POST', body: payload.Id })
      return { ok: true }        // or { ok: false, error, retry }
    },
  },
})
```

Each event reaches each handler through the same queue as a webhook: once per
cluster, after the change, with the same retries, and in the delivery log
under `bundle:<id>`. A throw counts as a failure worth retrying. A handler is
given the event, the payload, the attempt number, `fetch`, a log named for the
bundle and a signal that aborts after 30 seconds. It never gets the database.
A bundle naming an event this site does not raise refuses the boot, by name.

The site's own code handles events with `events` in its config instead, each run as a site job
with its tables and `site()` ([`rendering.md`](rendering.md), "Content events"). It is delivered
from the same queue, as the subscriber `site`.
