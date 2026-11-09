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
| **Server half**: `crombolo.server`, a `ServerBundle` with routes, events, jobs, forms, media and tables | In the CMS process | An import in `crombolo.config.ts` (story 225) |
| **Templates**: a `content: true` extension's `components/` | Copied into the site's `components/`, then imported in-process on every render | The Marketplace install itself, with no consent asked |
| **Screens**: `plugin/` files in the manifest's `extensions` | The back office, in the signed-in user's browser | Being a dependency |
| **Content**: schema, dictionary, content, styles, scripts, public files | Written into the site | The Marketplace install, unless `CROMBOLO_APPLY_BUNDLE_CONTENT` is off |

## Threats

Status: **covered**, **partly** (a gap is named), or **open**.

| # | Threat | Today | Gap |
|---|---|---|---|
| T1 | **Reading server secrets**: `process.env`, `.env`, the secret key | **Open.** The server half and an extension's templates run in the CMS process | Everything in the environment is readable |
| T2 | **Going around the API to the database**: opening the SQLite file, importing `@crombolo/data`, `RESET ROLE` out of its own Postgres schema | **Open.** Part 4 says so: confinement is a guard against mistakes, not hostility | The connection is the CMS's own |
| T3 | **Calling the host API beyond its permissions** | **Partly.** `gated()` throws for an undeclared method (`bundle-grants.ts:104`) | It checks the package's own declaration, not the grant: the grant row is never read at run time. `log` is ungated |
| T4 | **Turning itself on, or widening its permissions in an upgrade, without consent** | **Partly.** The Marketplace refuses a version that grew a server half or new permissions after `bun add` | `isOn` is "present and not disabled" (`bundle-grants.ts:201`): a missing grant, or a version asking for more, still runs once wired. The config import is the only real gate |
| T5 | **Writing the site's files**: config, `package.json`, `.env`, components | **Partly.** A `code/` section needs install code. An overwrite needs `--replace-files` | An extension may carry `code/`. Its components land in `components/` unasked |
| T6 | **Running server code through templates** | **Open.** An extension's components run in-process on render, while the Marketplace says it has no server code | Consent looks only at `crombolo.server` |
| T7 | **Outbound requests and SSRF** from the server | **Partly.** An event handler's `fetch` refuses private addresses and pins DNS (story 301) | Routes, jobs and templates use the global `fetch`, `Bun.connect` and `node:net`, unchecked and undeclared |
| T8 | **Screens misusing the user's session**: calling the Management API as them, sending data anywhere | **Open.** No content security policy on the back office | A screen can do anything the signed-in user can, and talk to any origin |
| T9 | **Screens of an extension that is off or ungranted** | **Partly.** Their manifests are hidden | Their files are still served (`server.ts:2840`) |
| T10 | **Acting as a member beyond what was granted** (`member.delegate`) | **Partly.** Checked at boot only | No call is gated on it at run time |
| T11 | **One extension reading another's data** | **Partly.** Separate Postgres schemas or SQLite files | Same process and connection: T2 |
| T12 | **Code at install time**: lifecycle scripts, migrations, a check that imports | **Covered.** `bun add --ignore-scripts`; story 300: a check imports nothing, and migrations are code | — |
| T13 | **A swapped package**: a version that changed between listing and install, or a registry serving something else | **Covered.** The landed manifest is checked again and removed when it differs. The lockfile pins the hash. Signing is available (story 060) | Signing is optional by default |
| T14 | **Denial of service**: a busy loop, unbounded memory, a crash | **Open.** Same event loop and heap as the CMS | One extension can stop the site |
| T15 | **A site package dressed as an extension**, from a registry | **Open.** Nothing marks a site package | A package with `code/` and a config installs like any other |

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
| T11 | Separate processes, separate channels | — |
| T14 | A crash or a hang ends that process, not the site; calls time out | A hard memory or CPU cap needs the OS. Deno's heap limit (`--v8-flags=--max-old-space-size`) caps memory, but not CPU |

What Deno's permissions do not cover is a flaw in Deno itself. Its permission
system has had escape bugs, so the Deno version is pinned and kept current as a
security dependency. Until story 311 ships, the docs must not call an extension
sandboxed.

## Permissions an extension asks for

Every permission is declared in the manifest with a reason, which the install
shows beside it. A permission given without a reason is refused. A version that
asks for more, or for different ones, is off until someone grants them again.

```json
"crombolo": {
  "id": "redirects",
  "schemaVersion": 4,
  "permissions": {
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
- `templates`, from 312.

What needs no permission is the extension's own: its log, its own tables, its own
back-office screen and the section it declares.

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
