<p align="center">
  <img src="packages/backoffice-host/plugin/branding/logo-surface.svg" alt="crombolo" width="420">
</p>

# Crombolo

Crombolo is a content management system that gives editors the content
management and back-office experience Umbraco editors have come to know, built
on open-source databases and the modern web platform.

- **For editors**, the back office they already know: the content tree, drafts
  and publishing, version history and rollback, media with crops, block
  editors, languages and variants, forms, members, users and permissions. It is
  the open-source Umbraco back office, served by Crombolo.
- **On open-source databases.** SQLite for a site on one machine, with nothing
  to install, and Postgres when it grows. No SQL Server, no licence to buy.
- **On the modern web platform.** A site is a small [Bun](https://bun.sh)
  project in TypeScript. Pages are React-style `.tsx` components rendered on the
  server to plain HTML, the content model is TOML files in the repository, and
  the site, the back office and the API run as one process. No .NET, no Razor.

```tsx
import type { PageProps } from '@crombolo/crombolo'
import { Layout } from './components/layout.tsx'

export default function Article({ model, nav }: PageProps) {
  return (
    <Layout model={model} nav={nav}>
      <h1>{model.text('title')}</h1>
      <div className="prose">{model.html('bodyText')}</div>
      <ul>
        {nav.children(model).map((child) => (
          <li>
            <a href={child.url}>{child.name}</a>
          </li>
        ))}
      </ul>
    </Layout>
  )
}
```

That file is a template. An editor creates a page of that type in the back
office, publishes it, and the component renders it at the page's address.

Crombolo is in active development. What is built and what is planned are
tracked as [stories](docs/stories/README.md).

---

## Getting started

A site is a project of its own: everything it uses arrives from npm, so you do
not need a copy of this repository. You need [Bun](https://bun.sh) 1.3 or later,
and nothing else: a new site uses SQLite, which needs no database server.

```bash
curl -fsSL https://bun.sh/install | bash
```

### An empty site

From the folder you want the site in, make its directory and move into it:

```bash
mkdir my-site && cd my-site
```

Then, from the site's own directory:

```bash
bunx @crombolo/cli init --name "My Site"
bun install
bun start
```

`bun start` prints the back-office address and a username and password to sign
in with. Open `http://localhost:8080/crombolo` and sign in. The site itself, at
`http://localhost:8080/`, answers "not found" until you publish a page:
[adding a page](docs/adding-a-page.md) walks through the content type, the
template and the content.

### A site from a template

To see the templates:

```bash
bunx @crombolo/cli init --template list
```

From the folder you want the site in:

```bash
mkdir my-site && cd my-site
```

Then, from the site's own directory:

```bash
bunx @crombolo/cli init --name "My Site" --template demo/harbourstone
bun install
bun start
```

The first `bun start` adds the template's content, so the site has its pages at
once. `demo/harbourstone` is a fictitious coastal distillery: a home page, an
about page, its range of bottlings and a contact form, with photographs.
`demo/plain-signal` is a mock AI magazine for a general reader: sections,
articles on real advances with credited photographs and their sources, a
sub-editor then editor approval workflow, and a contact form drawn by an
island. The others are `basic` (one page type, one view, one page), `starter` (a header, a
footer and a two-column layout to restyle), and `next` and
`demo/harbourstone-next`, which add a Next.js front end in `web/`
([`docs/delivery-api.md`](docs/delivery-api.md), "A Next.js front end").

### Next steps

- Each `bun start` prints a new password; set `CROMBOLO_ADMIN_PASSWORD` in the
  site's `.env` to keep one ([first boot](docs/operations.md#first-boot)).
- Templates are in `components/`, content types in `schema/`, and settings in
  `crombolo.config.ts` and `.env` ([configuration](docs/configuration.md)).
  Editing a template is picked up without a restart.
- [Writing components](docs/writing-components.md) is the cookbook for
  templates, and [rendering](docs/rendering.md) the reference.
- To run on Postgres, scaffold with `bunx @crombolo/cli init --postgres`, and
  point `CROMBOLO_POSTGRES_URL` in the `.env` it writes at your database.
- To move a site between machines or environments, `bunx crombolo export --site`
  and `bunx crombolo import`, or `crombolo pull` and `push` against a running
  site ([content transfer](docs/content-transfer.md)).
- An existing Umbraco 15+ site comes across with `crombolo import umbraco`,
  which reports what cannot ([Umbraco import](docs/umbraco-import.md)).

---

## What is in the box

| | |
| --- | --- |
| **The back office** | The `@umbraco-cms/backoffice` app, vendored unmodified and served by Bun: content, media, members, document and media types, templates, data types, dictionary, log viewer, users and permissions |
| **Templates** | React-style `.tsx` components rendered on the server to HTML, with no React dependency, no virtual DOM and no hydration; layouts, partials, and islands for the parts that need the browser |
| **Schema as code** | Document and media types as TOML in `schema/`, reviewed in a pull request; the back office's type editor writes the same files |
| **The API** | The Management API the back office speaks, built contract-first from its OpenAPI document, and Umbraco's Delivery API for apps |
| **Upgrades** | Check, fix, then cut over, with older nodes serving reads throughout a rolling deploy |
| **Scaling out** | One process, or editor, visitor and background-job nodes on one Postgres database ([running a cluster](docs/operations.md#running-a-cluster)) |
| **Site size** | Measured on both engines in every release up to 25,000 pages in three cultures on one node, and weekly at 100,000 ([supported workloads](docs/performance.md#supported-workloads-and-resources)) |
| **Content transfer** | Export, check and import content between environments as files; a whole site in one file |
| **Bundles** | npm packages that add back-office screens, content and server code; install from the Marketplace or with `bun add` |
| **Data of your own** | Tables of the site's own, migrated with it and queried with Kysely from pages and routes ([custom tables](docs/data-model.md#custom-tables)) |
| **Storage** | SQLite or Postgres; media on the file system, S3 or Azure, with protected media for members |
| **Forms** | Form building in core: a designer, entries, and workflows on a retrying queue |
| **E-mail** | Opt-in, over Resend, Postmark, Amazon SES or an endpoint of your own |
| **Also** | Redirects, members and public access, hostnames and languages, search, SEO, approval workflows, an audit log, and git from the back office |

It is a poor fit if you need Umbraco packages or plugins (they do not run here),
Razor views, SQL Server, or client-side React with hydration out of the box.

---

## Crombolo development

**For changing crombolo itself.** To build a site, you need none of this:
[Getting started](#getting-started) is all there is to it.

Everything in this section runs from the root of a clone of this repository.
None of these scripts exists in a site made with `init`, which uses
`bun start`.

### Set up

You need Bun 1.3 or later, and Docker with Compose v2 for Postgres and the
containerised test runs. Building the back office also needs Node 24 and npm 11:
it is built from Crombolo's fork of Umbraco's client by that client's own
scripts ([backoffice hosting](docs/backoffice-hosting.md#the-fork-of-umbracos-client)).
Nothing in the build, test or run path needs .NET, and a site needs neither
Node nor npm.

```bash
git clone https://github.com/kineco-au/crombolo-cms.git
cd crombolo-cms
bun install
bun run fork:checkout         # the fork of Umbraco's client, at vendor/umbraco-client
bun run vendor:backoffice     # builds the back office into packages/backoffice-dist/dist
bun run generate:types        # contract types into packages/contracts/generated/
bun run check                 # format, lint, typecheck and the SQL rule
bun run hooks:install         # a pre-push hook running the same gate
```

[`docs/backoffice-hosting.md`](docs/backoffice-hosting.md) says why the back
office is assembled rather than used from npm as it is.

### Run it from source

```bash
bun run start:local           # the reference site in apps/site, on SQLite, port 8080
bun run docker:up             # or Postgres and one node in containers, on the same port
bun run docker:down           # stop them; docker:reset also discards the database
bun run db:up                 # or just Postgres, on localhost:5433, for a host run
```

`start:local` runs the working tree, so a change to crombolo's own code shows at
once; it prints the credentials, as `bun start` does in a site. Only one of
`start:local` and `docker:up` can run at a time, since both use port 8080; set
`PORT` to run on another. With `db:up`, point a host run at Postgres with
`CROMBOLO_DB=postgres` and `CROMBOLO_POSTGRES_URL`.

### The sites in this repository

`sites/` holds the sites this repository builds: `starter`, `demo/harbourstone`,
`demo/harbourstone-next`, `demo/plain-signal` and the product site
`demo/crombolo`. Each is a real
site, and the templates `init` offers are made from them.

```bash
bun run site                            # the list: the sites, then the CLI's templates
bun run site demo/harbourstone          # run a copy in .scaffolds/, on localhost (--docker for the stack)
bun run site demo/harbourstone --fresh  # start that copy again from the site
```

The copy runs on SQLite whatever the environment says, against the working tree
rather than the published packages, so it shows changes not yet released. To get
one of these sites as a site of your own instead, use its template with `init`
([A site from a template](#a-site-from-a-template)). [`docs/configuration.md`](docs/configuration.md)
has the layout of a site, how templates are distributed and the safety rules.

### Running the tests

```bash
bun run check                 # Biome, tsc and the no-hand-written-SQL rule
bun run docker:test:sqlite    # the suite in a container, sharded
bun run docker:test:all       # both databases: the real gate
```

The pre-push hook runs the host gate (contract types, `check`, then the SQLite
suite), so a push that would fail CI's first jobs fails locally instead.
[`docs/testing.md`](docs/testing.md) has the layers, the containers, the
browser suite and the pipeline.

### Publishing the product site

The product site is `sites/crombolo`, run on the hosted platform as an ordinary
tenant, so a release republishes its content the way a customer's CI would:

```bash
bun run brochureware:publish --dry-run    # what it would send, and where
bun run brochureware:publish              # upload, publish, wait
```

What is sent is the committed bundle under `sites/crombolo/bundles/demo-crombolo`,
never the site's local database ([`docs/bundles.md`](docs/bundles.md#the-product-sites-bundle)).
The `brochureware` job in `.github/workflows/release.yml` runs it after the
registry publish, to preview, when the repository variable `BROCHUREWARE_PUBLISH`
is `enabled`; production is promoted by hand.

---

## Documentation

Design documents, in reading order; planned work is in the stories:

| | |
| --- | --- |
| [overview](docs/overview.md) | what this is, the decisions behind it, and the non-goals |
| [architecture](docs/architecture.md) | repo layout, dependency rules, server composition, the toolchain |
| [data-model](docs/data-model.md) | the relational model, the site's and bundles' own tables, and why a node behind the schema may not write |
| [api-contract](docs/api-contract.md) | the vendored contract, and how a handler is held to it |
| [backoffice-hosting](docs/backoffice-hosting.md) | vendoring the SPA, the shells, the auth wire contract, de-branding |
| [rendering](docs/rendering.md) | TSX templates and the JSX runtime, the published cache and how fresh each node is, views, hostnames, cultures |
| [features](docs/features.md) | what is implemented, and what is out of scope |
| [roadmap](docs/roadmap.md) | where this is going, the risks, and what diverges from Umbraco on purpose |
| [stories](docs/stories/README.md) | every piece of work, built and planned, by epic and state |
| [performance](docs/performance.md) | the published cache as a site grows: what a change drops, the measured workloads and budgets, and when another topology is right |
| [testing](docs/testing.md) | the test layers, the containers, the browser suite |
| [schema-as-code](docs/schema-as-code.md) | the TOML format, sync, retirement, coherence across nodes |
| [packaging-and-upgrades](docs/packaging-and-upgrades.md) | environments, the upgrade process, releasing to npm; what each release changed, and what to do on upgrading, in [release-notes](docs/release-notes.md) |
| [schema-at-runtime](docs/schema-at-runtime.md) | the shared schema store, and importing at runtime |
| [content-transfer](docs/content-transfer.md) | the bundle format, and moving content between environments; imports compare three ways against what was last applied |
| [seeds](docs/seeds.md) | a site's starting content as files under `seed/`: the format, the shorthand per editor, and `crombolo seed` |
| [configuration](docs/configuration.md) | every environment variable, and every script; the variable tables are generated from `packages/server/src/settings.ts` by `bun run docs:config` |
| [operations](docs/operations.md) | media storage, redirects, git, security, members; running a cluster: a worker for the jobs, health during upgrades, pausing editing, the commands as functions; the backoffice's health checks and troubleshooting in [diagnostics](docs/diagnostics.md); [webhooks](docs/webhooks.md) |
| [umbraco-import](docs/umbraco-import.md) | importing an existing Umbraco site: the report, what converts, and what is left |
| [next-integration](docs/next-integration.md) | what `@crombolo/next-integration` offers a Next.js front end: reads, caching, preview, members, middleware, components and images |
| [api](docs/api.md) | the supported API: the entry points of `@crombolo/crombolo`, the compatibility promise, and how a snapshot and an import boundary hold it |
| [bundles](docs/bundles.md) | created bundles, extensions as npm dependencies instead of App_Plugins, and bundles with a server half |
| [forms](docs/forms.md) | form building in core: the TOML definition, entries, workflows, and the e-mail port; approval before publishing, as graphs of stages, in [workflows](docs/workflows.md) |
| [audit-log](docs/audit-log.md) | who did what, when and from where: what writes an entry, the Info tab and the dashboard, retention |
| [search](docs/search.md) | backoffice and site search: the indexes on both dialects, the queue that keeps them current, who sees a result |
| [seo](docs/seo.md) | search & sharing in core: the `seoFields` type, `<SeoHead>`, sitemap, robots, the not-found page |
| [adding-a-page](docs/adding-a-page.md) | a walkthrough: the content type, its component (with an async example), the content, shipping it |
| [writing-components](docs/writing-components.md) | the component cookbook: props, lists, styles and SVG, forms and ids, async, context, layouts, interactive parts |
| [brand](docs/brand.md) | the mark, the logo files and the palette taken from them |

---

## Structure

```
crombolo/
├── docs/                          # the detail: design documents, configuration, operations
│   ├── stories/                   # the work, by state: backlog, ready, in progress, completed
│   └── brand/                     # PNG exports of the mark and the full logo, for use outside the product
├── assets/                        # source media for the starter templates, at the size it ships at;
│                                  #    outside the published `files` list, so it is never published twice
├── packages/
│   ├── crombolo/                  # the supported API (docs/api.md): `.` for a site, `./bundle` for a bundle's
│   │                              #    author, `./host` for whoever runs sites, `./branding`, the JSX runtime,
│   │                              #    and a `crombolo` bin that delegates to cli/. Every other package is
│   │                              #    internal unless docs/api.md names it, and says so in its README
│   ├── cli/                       # the command line on oclif, one class per command in src/commands/; `crombolo schema`
│   │                              #    describes it (clispec); templates/ holds `basic`, the sites staged in at pack time
│   ├── server/                    # the composition roots: core.ts, what every node is built on, with createServer for
│   │                              #    the site and createWorker for a node that runs only the jobs (story 223);
│   │                              #    config, ports, adapters, the schema store, git, background jobs, oEmbed, the event
│   │                              #    hubs, member sign-in and public access, the media store seam (file system, S3,
│   │                              #    Azure), imaging and the bundle installer
│   ├── core/                      # domain primitives — problem details, notifications, paging
│   ├── contracts/                 # OpenApi.json (vendored from Umbraco release-18.2.0, never edited; src/overrides.ts) + types
│   ├── data/                      # dialect seam, drivers, Kysely query layer, migrations, repositories, bundle tables
│   ├── content/                   # every page and media write and its rules, whoever starts it (docs/architecture.md)
│   ├── auth/                      # OAuth2 + PKCE, reference tokens, cookie redaction
│   ├── api-management/            # contract-first router, authorization, ports, handlers; `./domain` is all but the
│   │                              #    router and handlers, for code that runs without the API
│   ├── api-delivery/              # Umbraco's Delivery API over the published cache (docs/delivery-api.md)
│   ├── common/                    # the contracts outside code uses: Result, middleware (story 210); built to JS
│   ├── delivery-client/           # a typed client for the Delivery API, for apps; built to JavaScript
│   ├── next-integration/          # the Next.js front end (story 208); built to JavaScript too
│   ├── backoffice-host/           # SPA shells, import map, static serving, graphics, bundle manifest and discovery;
│   │                              #    plugin/ = the Changes dashboard, the Bundles views, the banner,
│   │                              #    the template editor's TSX scaffold and layout;
│   │                              #    plugin/seo/ = Settings → Search & sharing and the page preview
│   │                              #    plugin/branding/ = theme, logos and the overrides that de-Umbraco the client,
│   │                              #    exported as data by src/branding.ts for consumers that draw the brand;
│   │                              #    plugin/localizations/ is generated by `localizations:build`
│   │                              #    `./registry` is the bundle discovery and paths alone, for the worker
│   ├── schema/                    # schema-as-code: TOML model, parser, validator, writer, sync, export, generate, check/fix/upgrade
│   ├── transfer/                  # content transfer: the bundle format, canonical writer, reader, exporter
│   ├── import-umbraco/            # opt-in: an Umbraco backup → a compatibility report, schema files,
│   │                              #    a content bundle package and view stubs; reads a .bacpac without .NET
│   ├── remote-conformance/        # opt-in: checks a server against the remote protocol (docs/remote-protocol.md)
│   ├── simple-redirects/          # opt-in bundle: manage redirects in Settings; the reference example
│   │                              #    of a bundle with a server half (docs/bundles.md)
│   ├── backoffice-dist/           # the built Umbraco backoffice; dist/ is generated, upstream-static/ is committed
│   └── render/                    # the JSX→HTML runtime behind TSX templates, published cache (one view per culture),
│                                  #    URL and hostname routing, language fallback, the dictionary,
│                                  #    value converters (pickers, links, blocks, media and crops), <SeoHead> and the sitemap;
│                                  #    each tag's attributes typed from @types/react, a type-only dependency
├── apps/site/                     # the reference site: crombolo.config.ts, server.ts, components/, schema/
├── sites/                         # the sites this repository builds: starter, harbourstone (and -next), the product site;
│                                  #    private workspaces run from a copy, shipped as templates only on opt-in
├── scripts/                       # vendoring, module-graph check, coverage, versioning and publishing
├── .github/workflows/             # ci.yml on every push to main; release.yml on a v* tag
├── .githooks/                     # pre-push: the host gate, wired by `bun run hooks:install`
├── docker/                        # Dockerfile.cms and .browser, the entrypoint, the Postgres init script
├── compose.yaml                   # Postgres, one CMS node, and three test services behind a profile
├── LICENSE, NOTICE                # MIT, and the attribution for everything redistributed with it
└── tests/                         # the suite; tests/support/ holds the dialect harness and signed-in server
```

A site is three files plus its views and its schema: `crombolo.config.ts`, a
three-line `server.ts`, `components/**/*.tsx`, and `schema/*.toml`. Everything else — the composition root, the
migrations, the backoffice — arrives with `bun add @crombolo/crombolo`. `apps/site` is
exactly that shape and nothing more; `crombolo init` scaffolds the same.

---

## Relationship to Umbraco

Crombolo is its own CMS: its own server, data layer, schema-as-code, upgrade
process, content transfer and rendering. Two things come from Umbraco, both
MIT-licensed and neither .NET-specific:

- **the backoffice**, a standalone Lit SPA published to npm as
  `@umbraco-cms/backoffice`, vendored unmodified at 18.2.0
- **the Management API contract** that SPA speaks, a committed OpenAPI document
  from `release-18.2.0`, which the server here implements

That is the extent of it. Crombolo does not run Umbraco packages or plugins, does
not render Razor, and does not open an Umbraco database, so it is not a drop-in
replacement for an Umbraco install. An existing site comes across with
[`crombolo import umbraco`](docs/umbraco-import.md), which converts what
can be converted and reports what cannot.

For contributors: `Umbraco.Web.UI.Client/mocks/` in the Umbraco repository is an
MSW mock server covering ~45 endpoint groups — the best reference for exact
response shapes when the OpenAPI schema is ambiguous.

---

## Licence

crombolo is MIT licensed — see `LICENSE`.

Umbraco CMS is MIT licensed too. Three things here are redistributed rather than
merely depended on, and `NOTICE` covers all three:

- `packages/backoffice-dist/dist/` is built from the MIT-licensed
  `@umbraco-cms/backoffice` npm package, and bundles the browser packages the
  client needs — monaco, tiptap, lit, rxjs and the rest, all permissively
  licensed
- `packages/backoffice-dist/upstream-static/` holds three CSS files copied
  unmodified from the Umbraco CMS repository
- `packages/contracts/OpenApi.json` is the Umbraco Management API document, copied
  unmodified from `release-18.2.0`

One more thing is in the repository without being in any package:
`tests/fixtures/umbraco/` holds the Umbraco Commerce demo store's database, MIT
licensed, which the importer's tests run against. Its licence is beside it.

`NOTICE` ships inside every published package, because `@crombolo/crombolo` is what a site
installs and what a downstream redistributor reads. `tests/packaging.test.ts`
asserts that each manifest lists it, since npm adds `LICENSE` automatically but
not `NOTICE`.

**No Umbraco trademark is redistributed.** MIT grants copyright permission and
says nothing about trademarks, so the Umbraco wordmark, the "U" roundel favicon
and the installer illustration are deliberately not in this repository.
`BRANDED_ASSETS` in `@crombolo/backoffice-host` serves crombolo's own marks at
those paths instead, and `tests/backoffice-host.test.ts` asserts that none of the
three resolves to a vendored file.

crombolo is an independent project. It is not affiliated with, endorsed by, or
sponsored by Umbraco A/S, which owns the Umbraco trademark.

The enterprise distribution — the container topology and the operations tooling
around it — is a separate, proprietary repository. It consumes these packages;
nothing in it is required to run crombolo.
