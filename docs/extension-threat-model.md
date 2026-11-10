# Extension threat model

What an installed extension could do to a site, what stops it today, and what
does not. An extension is an npm package with a `crombolo` field in its
`package.json` ([`bundles.md`](bundles.md), Part 2 and Part 3). A site package,
the whole site exported to apply elsewhere, is not an extension: it is the
site's own code and is trusted as the site is.

The direction: every extension is untrusted code. It asks for each permission
with a reason, someone grants exactly those, and it then runs, wired by the
CMS, in a process of its own that holds nothing it was not given. The stories
are listed at the end.

## What there is to protect

| Asset | Where it is |
|---|---|
| **Server secrets** | The process environment and `.env`: the secret key, the database URL and password, API client secrets, SMTP and storage credentials |
| **The database** | Every table: content, members, users, audit, sessions, other extensions' tables |
| **The site's files** | `crombolo.config.ts`, `package.json`, `components/`, `schema/`, `.env`, the SQLite file, media |
| **Back-office sessions** | The signed-in user's token, which the Management API accepts for everything that user may do |
| **Members' data and sessions** | Member records, and a member acting through a site route |
| **The network the server sits in** | Loopback, the private network, a cloud's metadata endpoint |
| **Availability** | The server process, its memory and its event loop |

## Who might attack

- **A malicious extension author**, or one whose package was taken over, publishing a version that does more than it says.
- **An honest extension with a bug**, reaching further than it meant to.
- **A back-office user** who may install extensions, but should not be able to use one to reach more than they could themselves.

## How an extension reaches the site today

| Way in | Runs where | Turned on by |
|---|---|---|
| **Server half**: `crombolo.server`, a `ServerBundle` with routes, events, jobs, forms, media and tables | A Deno process of its own (story 311); in the CMS when the site's config imports it | Its grant (stories 309, 310) |
| **Templates**: a `content: true` extension's `components/` | Copied into the site's `components/`, then imported in-process on every render | The Marketplace install itself, with no consent asked |
| **Screens**: `src/backoffice/` files the manifest's `extensions` name, built (story 320) | The back office, in the signed-in user's browser | Being a dependency |
| **Content**: schema, dictionary, content, styles, scripts, public files | Written into the site | The Marketplace install, unless `CROMBOLO_APPLY_BUNDLE_CONTENT` is off |

## Threats

Status: **covered**, **partly** (a gap is named), or **open**.

| # | Threat | Today | Gap |
|---|---|---|---|
| T1 | **Reading server secrets**: `process.env`, `.env`, the secret key | **Covered (311, 312)** for what the CMS starts: its Deno process has no environment and reads only its package, build and data folder | A server half the site imports runs in the CMS |
| T2 | **Going around the API to the database**: opening the SQLite file, importing `@crombolo/data`, `RESET ROLE` out of its own Postgres schema | **Covered (311).** It holds no connection; its queries are run by the CMS on its own tables' connection, one row statement at a time, with `ATTACH`, role changes and `set_config` refused | A server half the site imports holds the CMS's connection |
| T3 | **Calling the host API beyond its permissions** | **Covered (309).** Every capability call is checked against the grant row | — |
| T4 | **Turning itself on, or widening its permissions in an upgrade, without consent** | **Covered (309, 310).** It runs only while its grant covers what its installed version asks for | — |
| T5 | **Writing the site's files**: config, `package.json`, `.env`, components | **Covered (306, 311, 312).** An extension's payload may not carry `code/`, `components/` or value migrations; its process may write only its data folder | Components an install copied before 312 stay in the site, as its own; `bundle list` names them |
| T6 | **Running server code through templates** | **Covered (312).** An extension's components render in its own process, and only with `templates` granted | — |
| T7 | **Outbound requests and SSRF** from the server | **Covered (311, 312)**: Deno allows only the hosts its grant names, and the host's `fetch` adds the address rule (story 301) | — |
| T8 | **Screens misusing the user's session**: calling the Management API as them, sending data anywhere | **Covered (313)** for sending: the back office's content security policy lets its pages reach the site and the origins granted extensions declare, and nothing else. **Asked for (320):** back-office code needs `backoffice.code`, granted under a warning that names the publisher, so none runs that was not granted knowingly | A screen, once granted, can still do anything the signed-in user can on the site itself |
| T9 | **Screens of an extension that is off or ungranted** | **Covered (309).** Their manifests are hidden and their files not served | — |
| T10 | **Acting as a member beyond what was granted** (`member.delegate`) | **Covered (309).** Checked on every call | — |
| T11 | **One extension reading another's data** | **Covered (311).** Separate processes, separate channels, and each one's queries run on its own tables' connection | — |
| T12 | **Code at install time**: lifecycle scripts, migrations, a check that imports | **Covered.** `bun add --ignore-scripts`; story 300: a check imports nothing, and migrations are code | — |
| T13 | **A swapped package**: a version that changed between listing and install, or a registry serving something else | **Covered.** The landed manifest is checked again and removed when it differs. The lockfile pins the hash. Signing is available (story 060) | Signing is optional by default |
| T14 | **Denial of service**: a busy loop, unbounded memory, a crash | **Covered (311)**, but for CPU. A crash or a hang ends its process and its calls, which time out; a 256 MB heap | A busy loop uses a core until its call times out and the process is stopped |
| T15 | **A site package dressed as an extension**, from a registry | **Covered (306).** A site package says what it is, and is never installed from a registry | — |
| T16 | **A site bundle overwritten** on disk, in an artifact store or in transit, or an older one put back | **Covered (316).** In production a site bundle applies only when a key or CI build the site trusts signed it, and never an older version from the same signer without `--allow-downgrade` | Outside production it applies, with a warning |

## What process isolation does and does not stop

The chosen design is a process per extension, run under Deno, whose
permissions the runtime enforces path by path and host by host on macOS, Linux
and Windows alike (D1). The CMS starts it with no environment, no database
credentials, read access to its own package only, write access to its own data
folder only, and network access to its declared origins only. Each call to the
site goes over a channel the CMS checks against the grant.

| Threat | Stopped | Not stopped |
|---|---|---|
| T1 secrets | No environment, and no read access outside its own package, so `.env` is out of reach | — |
| T2 database | No connection or credentials, and the SQLite file is outside what it may read. Its own tables come through the channel, on a connection that reaches only them | — |
| T3, T4, T10 | Every call is checked against the grant row, which records the version and the permissions | — |
| T6 templates | An extension's templates render in its own process, not the CMS's | — |
| T7 outbound | Deno allows only the declared origins, and the host's `fetch` adds the address rule | — |
| T11 | **One extension reading another's data** | **Covered (311).** Separate processes, separate channels, and each one's queries run on its own tables' connection | — |
| T14 | **Denial of service**: a busy loop, unbounded memory, a crash | **Covered (311)**, but for CPU. A crash or a hang ends its process and its calls, which time out; a 256 MB heap | A busy loop uses a core until its call times out and the process is stopped |

What Deno's permissions do not cover is a flaw in Deno itself. Its permission
system has had escape bugs, so the Deno version is pinned and kept current as a
security dependency. Stories 311 and 312 confine a server half the CMS starts
and its components; a server half the site imports never is. `tests/extension-isolation.test.ts` has a test for each row
above ([`extensions.md`](extensions.md)).

## Permissions an extension asks for

Every permission is declared in the manifest with a reason, which the install
shows beside it. A permission given without a reason is refused. A version that
asks for more, or for different ones, is off until someone grants them again.

```json
"crombolo": {
  "id": "redirects",
  "schemaVersion": 5,
  "permissions": {
    "backoffice.code": "Shows the redirects screen in Settings",
    "redirects.read": "Lists the rules you have added",
    "redirects.write": "Saves the rules you add or change",
    "content.read": "Shows the page each rule sends people to"
  }
}
```

The catalogue is in story 308, and once built in [`bundles.md`](bundles.md),
"Permissions". Every area asks read and write separately: content, media,
members, form definitions and entries, the dictionary, content types, webhooks,
workflows, redirects and sign-in providers, with users read only. Besides the areas:
- `http.outbound`, with its origins;
- `routes.public`;
- `events.content`;
- `member.delegate`;
- `actAs`, to act for the installer, the caller or a named user, where it otherwise
  acts as itself;
- `templates`, from 312;
- `backoffice.code`, from 320.

What needs no permission is the extension's own: its log, its own tables, and
the section it declares. Its back-office screens need `backoffice.code` (story 320),
the one permission that is not confined: they act as whoever is signed in.

Never offered, whatever is asked: the server's settings and secrets, the
site's files, writing back-office users or groups, and the Management API as
the CMS.

## Stories

| Story | Covers |
|---|---|
| 306 | A site package says what it is: marked, named apart from extensions, refused from a registry; an extension carries no `code/` (T5, T15) |
| 308 | The permission manifest: each permission with a reason, the area permissions, `http.outbound` origins |
| 309 | A grant is what lets an extension run: the version and permissions granted, checked on every call (T3, T4, T9, T10) |
| 310 | An installed, granted extension runs without wiring; its options come from the config and the back office |
| 311 | A Deno process per extension, confined by Deno's permissions (T1, T2, T7, T11, T14) |
| 312 | An extension's components stay in its package and render in its own process; it writes none of the site's code (T5, T6) |
| 313 | The back office's content security policy names only the origins extensions declared (T8) |
| 320 | An extension's back-office code is asked for, granted under a warning, built, and served only from its build (T8) |
| 316 | A site bundle is applied only from a key or CI build the site trusts (T16) |

Story 303 is absorbed by 306 and 312, and 307 was merged into them.

## Decisions (2026-11-09)

- **D1, confinement beyond the process:** each extension runs under Deno, and
  the CMS stays on Bun. Deno's runtime permissions confine the process's files and
  network on every platform, with no Docker and no OS tools. Deno comes through
  npm with the CMS.
  - First decided as an OS sandbox (bubblewrap, `sandbox-exec`). That was dropped
    because the CMS must run locally without them.
  - Moving the whole CMS to Deno was rejected: its permissions are per process,
    so they would not separate extensions from the CMS. Story 311 has the
    reasoning.
- **D2, an extension's templates** stay in its package and render in its
  process. A site page embeds one by name and gets HTML back, with the page's
  content passed as data. They are never copied into the site's `components/`.
- **D3, one process per extension:** started when first needed, restarted
  after a crash, and isolated from other extensions too.
- **D4, an extension's options:** both. The manifest declares a settings
  schema. `crombolo.config.ts` may set values, plain data under `extensions`,
  which locks them. The back office edits the rest.
