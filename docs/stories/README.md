# Crombolo — stories

Every piece of work on the CMS, built and planned, as one story per
deliverable. The docs one level up describe what exists and why — read
[`../overview.md`](../overview.md) and [`../architecture.md`](../architecture.md)
first — and point here by story number for anything still to come. Where the
project is heading, its risks and its deliberate divergences from Umbraco are in
[`../roadmap.md`](../roadmap.md).

## How this directory works

| Directory | State |
|---|---|
| `01_on_hold/` | Started, then paused. No successor; may be picked up again |
| `02_backlog/` | Not started, and blocked by a dependency that has not shipped |
| `03_ready/` | Not started, and every dependency has shipped |
| `04_in_progress/` | Being worked — one story, or one related group |
| `05_completed/` | Shipped, tested, green on both dialects |
| `06_abandoned/` | Will not be built — superseded or dropped; kept for the analysis |

The numeric prefixes keep the directories in lifecycle order; a directory exists
only while it holds a story. **The backlog/ready split is mechanical:** a story
is ready when every entry in its `**Depends on:**` line is in `05_completed/`.
Completing a story promotes whatever it unblocked. Stories refer to each other
**by number, not by link** — they move between directories, and the tables below
are the one place tracking where each lives.

Each story has the same shape: a header line with its epic, priority
(`must`, `should`, `could`) and size (`S`, `M`, `L`); its dependencies; the
story itself; context; acceptance criteria as a checklist; and, once built,
what was built. A story is done when it works in the actual Umbraco backoffice,
never when an endpoint merely returns 200, and it is green against SQLite and
Postgres both.

Numbers are allocated in tens per epic, so an epic can grow without
renumbering.

**Restructured 2026-10-14.** The stories were cut from what used to be the
phases and work packages of `roadmap.md`, and from the not-yet-built sections
of the other docs. The old labels map as follows: Phases 0–4 are `001`–`005`;
5a, 5b and 5c.1–5c.4 are `010`–`015`; WP-6.1 to 6.7 are `020`–`026` and
WP-6.11 is `027`; WP-6.8 is `030` (built) and `031`; WP-6.9 is `040`–`048`;
WP-6.12 is `070`–`072`; WP-6.13 is `060`–`061`; WP-6.14 is
`062`; Phase 7 is `080`–`086`; `087` was added to it later.

## Delivery order

What a running site notices first, measured against the contract with
`bun run coverage:api` and against Umbraco's source for what the contract does
not cover.

| Order | Story | Why here |
|---|---|---|
| 1 | `045` — E-mail delivery | done |
| 2 | `031` — External identity providers | done |
| 3 | `032` — Two-factor sign-in | done |
| 4 | `044` — Webhooks | done |
| 5 | `050` — The Delivery API | The largest absence for anyone wanting headless |
| 6 | `060` — Provenance | A runtime install runs third-party code with the user's session, and nothing names its publisher |
| 7 | `085` — A full Postgres parity run | The conformance suite green on both dialects is the hardening exit |
| — | the rest | Ranked within their epics below; diagnostics and tooling (`047`, `048`) are last because no visitor sees them |

## Stories

### Epic A — Foundations

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `001` | Skeleton and contract | must | L | done | — |
| `002` | The backoffice boots | must | M | done | 001 |
| `003` | Auth | must | L | done | 002 |
| `004` | Schema and content types | must | L | done | 003 |
| `005` | The vertical slice | must | L | done | 004 |

### Epic B — Packaging and upgrades

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `010` | Packaging | must | M | done | 005 |
| `011` | Schema as code and the value layer | must | L | done | 010 |
| `012` | Framework migrations, hardened | must | M | done | 011 |
| `013` | Pending elements at runtime | must | M | done | 012 |
| `014` | Check, fix, upgrade | must | L | done | 013 |
| `015` | The upgrade dashboard and the static check | must | M | done | 014 |

### Epic C — The backoffice, end to end

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `020` | The document workspace | must | M | done | 005, 015 |
| `021` | The Settings section | must | L | done | 020 |
| `022` | Property editors that need the server | must | L | done | 021 |
| `023` | Media | must | L | done | 022 |
| `024` | Content editing completion | must | L | done | 020 |
| `025` | Variants and localisation | must | M | done | 024 |
| `026` | Users and user groups | must | L | done | 020 |
| `027` | The Library section (elements) | should | M | done | 024 |
| `028` | Approval before publishing | should | L | done | — |
| `029` | Scheduled publishing through approval | could | M | done | 028 |

### Epic D — Members and identity

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `030` | Members and member types | must | L | done | 023, 026 |
| `031` | External identity providers | should | L | done | 030 |
| `032` | Two-factor sign-in | should | M | done | — |
| `033` | Entra settings bundle | could | M | done | 031 |
| `034` | An unattended install seeds an API client | should | S | done | 031 |
| `035` | A member created without a password | should | S | done | 031 |

### Epic E — Cross-cutting

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `040` | The log viewer | should | M | done | — |
| `041` | References and content-type transfer | should | M | done | — |
| `042` | Redirects and the URL tracker | must | M | done | — |
| `043` | Search over content | must | L | done | — |
| `044` | Webhooks | should | M | done | — |
| `045` | E-mail delivery | must | M | done | — |
| `046` | Relations and relation types | could | S | done | 041 |
| `047` | Diagnostics: health checks, telemetry, profiling and troubleshooting | could | M | done | — |
| `048` | The rest of the contract | could | M | done | — |
| `049` | Light and dark in the back office | should | M | done | — |

### Epic F — Headless

What a single-page app or any other front end built apart from the site needs
around the read API. `051` comes first: until the API answers cross-origin
requests, only server-side and build-time front ends can call it.

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `050` | The Delivery API | should | L | done | — |
| `051` | An app on another site reads the API | must | S | done | — |
| `052` | Types for every content type | should | M | done | — |
| `053` | An app previews drafts | should | L | done | 051 |
| `054` | One lookup answers a route | should | M | done | — |
| `055` | Search and sharing details reach the app | should | S | done | — |
| `056` | An app renders a form itself | could | M | done | 051 |
| `057` | A CDN can cache the site and the API | should | L | done | — |
| `058` | Translations, menus and site settings reach the app | could | M | ready | 141 |

### Epic G — Trusting and extending bundles

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `060` | Provenance: where a bundle's code came from | should | M | ready | 010 |
| `061` | Reviewed publishers | could | M | backlog | 060 |
| `062` | Tables a bundle owns | should | L | done | 063 |
| `063` | A bundle is an npm package | should | L | done | — |
| `178` | The back office vouches for its user to a host | should | S | done | 063, 177 |

### Epic H — Importing a site

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `070` | Import schema, content and views | should | L | done | — |
| `071` | Import members, users, redirects, protected pages and schedules | should | L | done | 070 |
| `072` | Proven on real exports from Umbraco 15, 16 and 18 | should | M | ready | 070 |
| `073` | Import a WordPress site | should | L | backlog | 141, 142 |
| `074` | An Umbraco extension exports a crombolo bundle | should | L | ready | 104, 105 |

### Epic I — Hardening

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `080` | Install and upgrade flows | should | M | done | 015 |
| `081` | Concurrency and locking under load | should | M | done | — |
| `082` | Version cleanup at scale | could | S | ready | — |
| `083` | Audit log | should | M | done | — |
| `084` | Problem-details parity | should | M | ready | — |
| `085` | A full Postgres parity run | must | M | ready | — |
| `086` | Performance of the tree and the published cache | should | M | done | — |
| `087` | A ready-to-run container image | should | M | ready | — |
| `088` | A read-only group changes nothing | must | M | done | 023, 026, 027, 028 |

### Epic J — Forms

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `090` | Choices from a prevalue source | should | M | done | — |
| `091` | An e-mail template for the send-e-mail workflow | should | M | done | — |
| `092` | Form entries are deleted on a schedule | should | S | ready | — |
| `093` | A multi-page form steps a page at a time | could | M | done | — |
| `094` | The form designer edits layout | should | M | done | — |
| `095` | Field and workflow types from a bundle | could | L | done | — |

### Epic K — Moving content

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `100` | Clone an environment, anonymised | should | L | ready | 108 |
| `101` | The dry run predicts publish refusals | could | S | done | — |
| `102` | Per-property conflict resolutions | could | M | done | — |
| `103` | Resolve transfer conflicts in the backoffice | should | M | done | — |
| `104` | A whole site in one file | should | M | done | 106 |
| `105` | Start a site from a file | should | L | done | 104, 106 |
| `106` | An imported schema reaches the schema store | must | S | done | — |
| `107` | The remote protocol | should | L | done | 104, 105, 106 |
| `108` | crombolo pull and push | should | M | done | 107 |
| `177` | A host's own bundles stay with the host | should | S | done | 063, 104 |

### Epic L — Routing

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `110` | URL options Umbraco sites rely on | could | S | done | — |

### Epic M — Running at scale

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `120` | Cache instructions arrive without polling | could | S | done | — |
| `121` | Reads from a Postgres replica | could | M | ready | 174 |

### Epic N — The assistant (closed with 179)

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `130` | The assistant converts Razor views | could | M | abandoned | 070 |
| `179` | The assistant leaves the CMS | should | M | done | 178 |

### Epic O — Building a site

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `140` | Site search for visitors | should | M | done | — |
| `141` | Navigation menus | should | M | done | — |
| `142` | Blogging basics: taxonomies, archives and feeds | should | M | ready | — |
| `143` | Comments with moderation | could | M | ready | — |
| `144` | Themes configured without code | could | L | ready | — |

### Epic P — The command line

What the CLI lacks against [clispec.dev](https://clispec.dev/) is `150`. The
rest are what the Management API can do that a script or an operator cannot,
short of signing in as a person. The CLI does not mirror the API: editing
content, data types, templates and the rest stays in the back office, or in files
under `schema/` — and, for a site's starting content, in seed files (Epic Q).

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `150` | A scriptable CLI | should | L | done | — |
| `151` | People from the command line | should | M | done | — |
| `152` | Operating a running site | should | M | done | — |
| `153` | Media in bulk | should | M | done | — |
| `154` | Redirects as data | could | S | ready | — |
| `155` | Members out and in | could | M | ready | — |
| `156` | The audit log from the command line | could | M | done | — |
| `157` | A docs section on the product site | should | L | done | 150 |
| `158` | A hosting plugin for the CLI | should | S | done | 150 |
| `159` | A site file without its hostnames | should | S | done | 104, 105 |

### Epic Q — A site from the command line

A whole working site — schema, content, media, people and access — set up from
an empty folder with the CLI alone, scriptable in CI, never opening the back
office. Most of it is already files or commands; these are the gaps. Content is
declared as seed files compiled to a bundle and applied through the existing
import (`163`), not mirrored as imperative commands. Where groups and access
live (`162`) and how a remote site is changed short of a whole push (`160`,
`167`) are open questions; `160` and `167` are security critical and need
elaborating before work starts.

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `160` | Signing in to a remote from CI | should | M | ready | — |
| `161` | Schema files without the raw keys | should | L | ready | — |
| `162` | User and member groups as files | should | M | ready | — |
| `163` | Content as code: seed files | should | XL | ready | — |
| `164` | The demo sites from seed files | should | M | backlog | 163 |
| `165` | Moving, sorting and deleting content | could | M | done | — |
| `166` | People and access per environment | should | M | backlog | 162 |
| `167` | Changing a remote site piece by piece | should | M | backlog | 160 |
| `168` | The dictionary and single media files | could | S | ready | — |
| `180` | A working site from an empty directory, from the command line | should | S | backlog | 163 |

### Epic R — Architecture and reliability

Follow-ups from the architecture review against the eight greenfield targets.
The baseline was approximately **3.1/5** overall: extension API 3, application
layer 3, publishing consistency 3.5, reads and caching 3, concurrency and side
effects 2.5, persistence 4, frontend simplicity 2, and runtime composition 3.5.
These are design assessments, not security certification or new benchmark
results. The existing versioned storage and vendored editor remain deliberate
choices; replacing either is not a deliverable in this epic.

Start with shared content operations (`170`), durable events (`171`) and stale
edit protection (`172`). The supported extension boundary (`173`) and published
snapshot checkpoints (`174`) can start independently. Checkpoints unblock read
replicas (`121`) and measured cache growth (`175`); durable events underpin
independent workers (`176`). Version-history cleanup remains `082`.

The stories describe proposed outcomes and record decisions to resolve before
implementation; creating them does not settle those architectural choices.

| # | Story | Priority | Size | State | Depends on |
|---|---|---|---|---|---|
| `170` | The same content rules from every entry point | should | L | done | 028, 081, 083 |
| `171` | Published changes reliably reach subscribers | should | XL | done | 170, 044, 045 |
| `172` | An older edit cannot overwrite a newer one | should | M | done | 170, 081 |
| `173` | A supported API for extensions | should | M | ready | 062, 063 |
| `174` | Renderers know which published changes they serve | should | L | done | 011, 120 |
| `175` | Published cache growth stays within measured limits | could | L | ready | 086, 174 |
| `176` | Background jobs run independently | could | L | ready | 171 |
