# Configuration and scripts

Every setting the server reads, and every command the repository defines. The
defaults are chosen so that a clone runs with nothing set.

## How a site is configured

A site's settings come from three places, and the first one that gives a value
wins:

1. **`crombolo.config.ts`**, the site's config file, which exports
   `defineConfig({...})`. Anything set here is fixed for every environment the
   site runs in, and the settings that are code — a provider, a bundle, a
   redirect rule — can only be set here.
2. **The environment**: the variables below, from the process, a container or a
   `.env` file beside the site (Bun reads it on start).
3. **The defaults**, in the tables below.

```ts
import { defineConfig } from '@crombolo/crombolo'

export default defineConfig({
  siteName: 'Acme',
  seo: { titleSuffix: ' | Acme' },
})
```

[`examples/crombolo.config.ts`](examples/crombolo.config.ts) sets every field a
site can set, each with the variable that sets it from the environment where there
is one. It is type-checked with the repository and a test holds it to the config,
so it stays complete. Only the Postgres address (`CROMBOLO_POSTGRES_URL`, which
carries the password), the lock timeout and the path to Deno have no field: they
belong to the machine the site runs on, not to the site.

Grouped settings — `seo`, `remote`, `deliveryApi` — merge field by field, so a
config file that sets the title suffix keeps the environment's sitemap switch.
Relative paths are resolved against the site's own folder, not wherever the
process was started.

```sh
# .env for a site on Postgres, sending e-mail through Resend
CROMBOLO_DB=postgres
CROMBOLO_POSTGRES_URL=postgres://crombolo:crombolo@localhost:5432/acme
CROMBOLO_APPLICATION_URL=https://www.acme.example
CROMBOLO_EMAIL_PROVIDER=resend
CROMBOLO_EMAIL_API_KEY=re_…
CROMBOLO_EMAIL_FROM=no-reply@acme.example
```

## Environment variables

Every variable crombolo reads is declared once, in the settings list in
`packages/server/src/settings.ts`. `loadConfig` reads the environment only
through that list, and the tables below are generated from it by
`bun run docs:config` — edit the list, not the tables. A test fails when the
code reads a variable the list does not declare, when the list declares one
nothing reads, and when these tables and the list disagree.

Settings marked as read by the command line are used by `crombolo` commands
rather than the running server. Secret ones are never printed or logged.

<!-- settings:start -->

### Server

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | string | — | `production` turns off the development conveniences: generated admin passwords, writable schema files, e-mail to the console and relaxed upgrade checks. |
| `PORT` | number | `8080` | The HTTP port. The application URL defaults to localhost on this port. |
| `CROMBOLO_SITE_NAME` | string | `Crombolo` | The site's name, shown in the back office and used when a page is shared. |
| `CROMBOLO_APPLICATION_URL` | string | `http://localhost:<port>` | The site's public address, which invitation and password-reset links point at. |
| `CROMBOLO_ROLE` | `all`, `api`, `web`, `worker` | `all` | What this process serves: everything, the back office and its API, the public site alone, or only the background jobs. Splitting needs Postgres; a misspelt role stops the server. |
| `CROMBOLO_SITE_ACCESS` | `public`, `users` | `public` | Who may see the site: anyone, or only people signed in to its back office, on every node. The site and its back office must be on one host. |
| `CROMBOLO_JOBS` | `on`, `off` | `on` | Whether an all or api node runs the background jobs. Off leaves them to a worker; the node still queues them. |
| `CROMBOLO_NODE_ID` | string | `host:pid` | This node's name, stamped on schema syncs, content changes and the upgrade history. |
| `CROMBOLO_MAX_REQUEST_BODY_MB` | number | `32` | The largest request body the server reads, media uploads included. |
| `CROMBOLO_INSECURE_COOKIES` | `true` / `false` | `false` | Drops the secure cookie requirements, for a plain-http host that is not localhost. |

### Database

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_DB` | `sqlite`, `postgres` | `sqlite` | Which database engine the site runs on. Read by the server and the command line. |
| `CROMBOLO_SQLITE_FILE` | string | `crombolo.sqlite` | The SQLite file, relative to the site, or `:memory:`. Read by the server and the command line. |
| `CROMBOLO_POSTGRES_URL` | string | — | The Postgres connection string. Required when the database is Postgres. Read by the server and the command line. Kept secret: never printed. |
| `DATABASE_URL` | string | — | Used as the Postgres connection string when `CROMBOLO_POSTGRES_URL` is unset. Read by the server and the command line. Kept secret: never printed. |
| `CROMBOLO_LOCK_TIMEOUT_SECONDS` | number | `15` | How long a content write waits for another before it gives up and answers 503. Read by the server and the command line. |
| `CROMBOLO_PG_DUMP` | string | — | A shell command that backs up Postgres before a repair, an upgrade or a purge. It is given `CROMBOLO_BACKUP_STAMP` and `CROMBOLO_BACKUP_REASON`; without it those commands need `--backup-taken`. Read by the server and the command line. |
| `CROMBOLO_UPGRADE_POLICY` | `strict`, `pending-allowed` | strict in production, else pending-allowed | Whether findings that need a person stop an upgrade. Read by the server and the command line. |
| `CROMBOLO_VERSION_CLEANUP` | `true` / `false` | `false` | Runs the hourly clean-up of old content versions. |
| `CROMBOLO_VERSION_CLEANUP_KEEP_ALL_DAYS` | number | `7` | The clean-up keeps every version newer than this many days. A content type's own policy wins. |
| `CROMBOLO_VERSION_CLEANUP_KEEP_LATEST_DAYS` | number | `90` | After that, it keeps each day's latest version for this many days. |
| `CROMBOLO_AUDIT_RETENTION_DAYS` | number | `365` | How many days the audit log keeps an entry. `0` keeps them all. |
| `CROMBOLO_EXTENSION_ACTIVITY_DAYS` | number | `14` | How many days what each extension did is kept for its Activity view in Settings, under Extensions. `0` keeps nothing. |
| `CROMBOLO_EVENT_RETENTION_DAYS` | number | `30` | How many days delivered webhooks, their log, and sent change events are kept. Failed ones stay until retried. `0` keeps them all. |

### Sign-in and secrets

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_ALLOW_PRIVATE_ADDRESSES` | `true` / `false` | — | Lets webhooks, a form's send-to-URL workflow and an identity provider's test reach loopback, private and link-local addresses, for an intranet. On in development, off otherwise. |
| `CROMBOLO_ADMIN_LOGIN` | string | `admin@crombolo.local` | The login of the first administrator. |
| `CROMBOLO_ADMIN_PASSWORD` | string | generated in development | The first administrator's password, used only when the database is created. Unset in production, the site is set up in the browser. Kept secret: never printed. |
| `CROMBOLO_SETUP_CODE` | string | — | Guards "Set up your new site" in production: 16 or more characters, chosen by you. Remove it once the site is set up. Kept secret: never printed. |
| `CROMBOLO_API_CLIENT_ID` | string | — | An API client an unattended install creates in the administrators group; it starts `crombolo-back-office-`. With it, no password administrator is created unless `CROMBOLO_ADMIN_PASSWORD` is set. Read by the server and the command line. |
| `CROMBOLO_API_CLIENT_SECRET` | string | — | That client's secret, set together with the id. It is used once, when the client is created. Kept secret: never printed. |
| `CROMBOLO_LOCAL_ADMIN` | `true` / `false` | `false` | Creates the password administrator even when an API client is set. Honoured only on localhost. |
| `CROMBOLO_LOCKED_IDENTITY_PROVIDERS` | list | — | Identity providers nobody can change in the back office, by id, separated by commas, or `all`: they sign in by the site's configuration alone. A provider declared `locked: true` is locked too. |
| `CROMBOLO_REMOTE_EXCHANGE_PROVIDERS` | list | — | Back-office identity providers, by id, separated by commas, whose tokens the remote exchanges for a sign-in as the person they name, besides those the site's configuration opts in. |
| `CROMBOLO_SECRET_KEY` | string | — | Seals secrets kept in the database, such as a webhook's headers and two-factor keys; 32 or more characters. Features that need it are not offered without it. Kept secret: never printed. |
| `CROMBOLO_USERNAME_IS_EMAIL` | `true` / `false` | `true` | A back office user's login is their e-mail address. |
| `CROMBOLO_USERS_MANAGED_BY` | list | — | The API clients a directory outside the site signs in as. Set, only they add, change, disable or remove back office users or change whom a group holds; each person keeps their own language, avatar, password and two-factor. |
| `CROMBOLO_USERS_MANAGED_AT` | string | — | The directory's address for one user, with `{email}`, `{key}` or `{userName}` filled in: the Users section links each person there. |
| `CROMBOLO_MEMBERS_MANAGED_BY` | list | — | The API clients a directory outside the site provisions members as. A member one of them creates is changed only by it: their name, e-mail, username, approval, groups, properties and removal. Their password and two-factor stay theirs. |
| `CROMBOLO_GROUPS_MANAGED_BY` | list | — | The API clients that define the user groups, outside the site. Set, only they create, change or remove a group: its name, sections, levels, start nodes, languages and per-item permissions. |
| `CROMBOLO_GROUPS_MANAGED_AT` | string | — | Where one group is defined, with `{alias}` or `{key}` filled in: the User Groups section links each group there. |

### Back office and bundles

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_BACKOFFICE_PATH` | string | `/crombolo` | Where the back office is served. |
| `CROMBOLO_CSS_DIR` | string | `css` | The stylesheets the Settings section edits, served at `/css/`. |
| `CROMBOLO_SCRIPTS_DIR` | string | `scripts` | The scripts the Settings section edits, served at `/scripts/`. |
| `CROMBOLO_PUBLIC_DIR` | string | `public` | The site's own files, served at the root of the site at the same paths. |
| `CROMBOLO_APPLY_BUNDLE_CONTENT` | `true` / `false` | `true` | Installing a bundle from the Marketplace also applies the schema, components and content it carries. |
| `CROMBOLO_RUNTIME_INSTALLS` | `true` / `false` | true, false with a schema store | The Packages section installs and removes packages on the running site. Off, they are added to `package.json` and deployed. |
| `CROMBOLO_DENO` | string | the binary the `deno` package installed | The Deno binary installed extensions run under, each in a process of its own. Set it where Deno publishes no build, such as Alpine. |
| `CROMBOLO_BUNDLE_SIGNATURES` | `optional`, `required` | `optional` | Whether this site installs only extensions signed in GitHub Actions with `crombolo bundle sign`. A signature that does not check out is refused either way. Site bundles have their own rule: in production, only from a signer on Settings → Trusted signers. |
| `CROMBOLO_BUNDLE_SOURCES` | list | — | Where a signed bundle has to come from, separated by commas: `org/*`, `org/repo`, or `org/repo@v*` for its tags. Empty takes signed extensions from anywhere. Each is also a trusted CI build for site bundles, locked on Settings → Trusted signers. |
| `CROMBOLO_INSTALLS_ELSEWHERE_MESSAGE` | string | — | With runtime installs off, what the Marketplace says about where bundles are added, in place of "add it to package.json and deploy". For a host that installs them itself. |
| `CROMBOLO_INSTALLS_ELSEWHERE_URL` | string | — | A link shown with that message: the host’s own place for installing bundles. |
| `CROMBOLO_MARKETPLACE_URL` | string | `https://www.npmjs.com/search?q=keywords%3Acrombolo-extension` | Where the Marketplace sends someone browsing for bundles. |
| `CROMBOLO_PACKAGE_KEYWORD` | string | `crombolo-extension` | The npm keyword a bundle publishes under to be found by the Marketplace. |
| `CROMBOLO_NPM_REGISTRY` | string | `https://registry.npmjs.org` | The registry the Marketplace searches, such as a mirror. |

### Schema

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_SCHEMA_DIR` | string | `schema` | Where the schema files live. Nothing is synced when the folder is absent. |
| `CROMBOLO_SCHEMA_REVISION` | string | `0` | Set by a deploy, to order deploys of the same schema version. |
| `CROMBOLO_SCHEMA_CACHE_DIR` | string | `<temp>/crombolo-schema` | Where a schema kept in cloud storage is copied to when the server starts. |
| `CROMBOLO_SCHEMA_WRITABLE` | `true` / `false` | true unless production or with a schema store | Whether the back office may change the schema files. |
| `CROMBOLO_CODE` | `editable`, `locked` | `editable` | Locked, the back office cannot change templates, stylesheets and scripts, for a site whose files come from its repository. |
| `CROMBOLO_ENVIRONMENT` | string | local in development, otherwise production | Which copy of the site this is. A property that varies by environment shows this environment’s own value where it has one, and the shared value otherwise. |
| `CROMBOLO_ENVIRONMENT_VALUES_READONLY` | `true` / `false` | `false` | Whether values set for one environment can only arrive here by a change, rather than being set in this copy of the site. |
| `CROMBOLO_CONTENT` | `editable`, `locked` | `editable` | Locked, pages, media, the Library, types, data types and code cannot be changed here: they arrive only by a change applied from the site where they are made. Members, form entries and what visitors send are written as before. |
| `CROMBOLO_CONTENT_EDITED_AT` | string | `` | Where a locked site's content is edited: the address of the other site's back office, which an item opened here links to and every refusal of a write names. |
| `CROMBOLO_WORKSPACES` | `true` / `false` | `true` | Whether people may open workspaces, to change pages apart from what everyone else sees and look after them there. On unless set to false; off, every workspace route is refused, and nothing else changes. |
| `CROMBOLO_PURGE_AFTER_DAYS` | number | `0` | The fewest days between removing a property from a type and deleting its values for good. A purge sooner than that is refused. |
| `CROMBOLO_WORKSPACES_HOST` | string | — | Where a workspace is looked at before it is merged: a host with `{workspace}` in it, such as `{workspace}.preview.example.com`, and `{host}` for one of the site’s own hosts. Unset, a workspace is opened in a browser on the site’s own address. |
| `CROMBOLO_LINK_MAX_DAYS` | number | `0` | The longest a link made for someone to look at a workspace or at Shared may last, in days. 0 makes no such links. |
| `CROMBOLO_WORKSPACE_LINK_MAX_DAYS` | number | — | Replaced by CROMBOLO_LINK_MAX_DAYS, and read for this release only where that is unset, with a warning at start-up. |
| `CROMBOLO_WORKSPACE_SITES` | number | `3` | How many workspaces one server keeps ready to be looked at at once. |
| `CROMBOLO_WORKSPACE_SITE_IDLE_MINUTES` | number | `15` | How long a workspace is kept ready after the last time it was looked at. |
| `CROMBOLO_WORKSPACE_PROCESSES` | number | `10` | How many workspaces with changed templates one server shows at once, each kept apart from the site. Past it, the one least recently looked at is stopped, and started again when next asked for. |
| `CROMBOLO_WORKSPACE_PROCESS_IDLE_MINUTES` | number | `30` | How long a workspace with changed templates is kept running after the last time it was looked at. |
| `CROMBOLO_WORKSPACE_PROCESS_MEMORY_MB` | number | `1024` | How much memory a workspace with changed templates may use before it is stopped, to start again when next asked for. |
| `CROMBOLO_WORKSPACE_RENDER_SECONDS` | number | `30` | How long a page of a workspace with changed templates may take to show before it is stopped and the page answers with an error. |
| `CROMBOLO_WORKSPACES_REQUIRED` | `true` / `false` | `false` | Whether every change to a page is made in a workspace. What everyone sees then changes only when a workspace is merged; someone who edits without choosing one works in their own. Needs `CROMBOLO_WORKSPACES=true`. |
| `CROMBOLO_APPLY_CHANGES_BY` | `any`, `exchange` | `any` | Who may stage or apply a change from another copy of the site. `exchange`: only a sign-in exchanged through an identity provider's `applyAudience`, so a person's own sign-in never can. |
| `CROMBOLO_SYNC_SCHEMA_AT_BOOT` | `true` / `false` | `true` | Syncs the schema files when the server starts. Turn it off when a deploy runs `crombolo types sync` itself. |

### Components

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_COMPONENTS_DIR` | string | `components` | Where the site's page views and components live. |
| `CROMBOLO_COMPONENTS_CACHE_DIR` | string | `.crombolo/components` | Where components are copied so that an edit is picked up without a restart. Inside the site, and cleared when the server starts. |
| `CROMBOLO_COMPONENTS_GATE_MS` | number | 5000, 500 in development | How often a node looks for changed components, in milliseconds. |
| `CROMBOLO_COMPONENTS_SWAP_MS` | number | 10000, 0 in development | The least time between two changes being picked up, in milliseconds. A save made in the back office is never held back by it. |
| `CROMBOLO_COMPONENTS_GENERATION_LIMIT` | number | `250` | How many changes a node picks up before it stops taking more and keeps serving the last. |
| `CROMBOLO_COMPONENTS_KEEP` | number | 3, all in development | How many earlier copies are kept on disk, for an instant return to one. |
| `CROMBOLO_RENDER_TIMEOUT_MS` | number | `10000` | How long a page may take to render, layouts included, before it fails, in milliseconds. `0` for no limit. |
| `CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE` | number | `2000` | Requests a minute each caller may make to the site's route handlers, on each server, before a 429. High enough to stop only a flood. `0` for no limit. |
| `CROMBOLO_ROUTE_TIMEOUT_MS` | number | `10000` | How long a route handler may take before it answers 504, in milliseconds. `0` for no limit. |
| `CROMBOLO_MIDDLEWARE_TIMEOUT_MS` | number | `2000` | How long a site's whole middleware chain may take, in milliseconds, not counting the page it renders. `0` for no limit. |

### Media

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_MEDIA_DIR` | string | `media` | Where uploaded files live on this disk, served at `/media/`. |
| `CROMBOLO_MEDIA_CACHE_MB` | number | `64` | How much memory, in megabytes, each server gives to the media items it has used most recently. Others are looked up when asked for. |
| `CROMBOLO_MEDIA_STORE` | `filesystem`, `s3`, `azure` | `filesystem` | Where media files are kept. An unrecognised value falls back to the file system. |
| `CROMBOLO_MEDIA_PUBLIC_URL` | string | — | A CDN in front of the media folder: browsers are sent there instead of being served by this server. |
| `CROMBOLO_MEDIA_S3_BUCKET` | string | — | S3: the bucket. |
| `CROMBOLO_MEDIA_S3_REGION` | string | — | S3: the bucket's region. |
| `CROMBOLO_MEDIA_S3_ENDPOINT` | string | — | S3: the endpoint, for an S3-compatible store such as R2, Spaces or MinIO. |
| `CROMBOLO_MEDIA_S3_ACCESS_KEY_ID` | string | — | S3: the access key. Unset, the client's usual credentials are used. |
| `CROMBOLO_MEDIA_S3_SECRET_ACCESS_KEY` | string | — | S3: the access key's secret. Kept secret: never printed. |
| `CROMBOLO_MEDIA_S3_SESSION_TOKEN` | string | — | S3: a session token, for temporary credentials. Kept secret: never printed. |
| `CROMBOLO_MEDIA_S3_PREFIX` | string | — | S3: a folder inside the bucket to keep media under. |
| `CROMBOLO_MEDIA_S3_PUBLIC_URL` | string | — | S3: a public address for the bucket, such as a CDN, that browsers are sent to. |
| `CROMBOLO_MEDIA_S3_PRESIGN_SECONDS` | number | — | S3: sends browsers to a signed bucket address that lasts this many seconds. Use this or a public address, not both. |
| `CROMBOLO_MEDIA_AZURE_ACCOUNT` | string | — | Azure: the storage account. |
| `CROMBOLO_MEDIA_AZURE_CONTAINER` | string | `media` | Azure: the blob container. |
| `CROMBOLO_MEDIA_AZURE_KEY` | string | — | Azure: the account's key. Kept secret: never printed. |
| `CROMBOLO_MEDIA_AZURE_SAS` | string | — | Azure: a shared access signature, instead of the key. Kept secret: never printed. |
| `CROMBOLO_MEDIA_AZURE_ENDPOINT` | string | — | Azure: the blob endpoint, for a sovereign cloud or a local emulator. |
| `CROMBOLO_MEDIA_AZURE_PREFIX` | string | — | Azure: a folder inside the container to keep media under. |
| `CROMBOLO_MEDIA_AZURE_PUBLIC_URL` | string | — | Azure: a public address for the container, such as a CDN, that browsers are sent to. |

### E-mail

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_EMAIL_PROVIDER` | `none`, `resend`, `postmark`, `ses`, `custom` | `none` | How e-mail is sent. Without one, invitations, password resets and form e-mails are unavailable; development prints messages to the console. |
| `CROMBOLO_EMAIL_FROM` | string | — | The sender address. Every provider needs it, and verifies its domain. |
| `CROMBOLO_EMAIL_FROM_NAME` | string | — | The name shown beside the sender address. |
| `CROMBOLO_EMAIL_API_KEY` | string | — | The provider's key: Resend's API key, Postmark's server token, or a bearer token for a custom endpoint. Kept secret: never printed. |
| `CROMBOLO_EMAIL_URL` | string | the provider's own API | The address messages are sent to. Required for a custom endpoint, an override for the others. Must be HTTPS unless it is on this machine. |
| `CROMBOLO_EMAIL_POSTMARK_STREAM` | string | `outbound` | Postmark: the message stream to send on. |
| `CROMBOLO_EMAIL_SES_REGION` | string | `AWS_REGION` | SES: the region to send from. |
| `CROMBOLO_EMAIL_SES_ACCESS_KEY_ID` | string | `AWS_ACCESS_KEY_ID` | SES: the access key, when it differs from the standard AWS one. |
| `CROMBOLO_EMAIL_SES_SECRET_ACCESS_KEY` | string | `AWS_SECRET_ACCESS_KEY` | SES: that access key's secret. Kept secret: never printed. |
| `CROMBOLO_EMAIL_SES_CONFIGURATION_SET` | string | — | SES: the configuration set that governs sending. |
| `CROMBOLO_EMAIL_SES_ENDPOINT` | string | the regional SES address | SES: a private endpoint to send through instead. |

### Members

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_ALLOW_MEMBER_REGISTRATION` | `true` / `false` | `false` | Lets visitors register as members of the site. |
| `CROMBOLO_MEMBER_REGISTRATION_TYPE` | string | `Member` | The member type a registration creates, by alias. |
| `CROMBOLO_MEMBER_REGISTRATION_GROUPS` | list | — | The member groups a registration joins, separated by commas. |
| `CROMBOLO_MEMBER_SESSION_MINUTES` | number | `20160` | How long a member's sign-in lasts, in minutes. The default is 14 days. |
| `CROMBOLO_MAX_FAILED_PASSWORD_ATTEMPTS` | number | `5` | Failed member sign-ins before the member is locked out. `0` never locks out. |
| `CROMBOLO_MEMBERS_SOURCE` | string | — | The address of the site that holds this site's members, such as `https://www.example.com`. Set, the Members section works on that site's members and this site keeps none: members can't sign in or register here. |
| `CROMBOLO_MEMBERS_CLIENT_ID` | string | — | The client id of the service account on that site this site signs in as. Required with `CROMBOLO_MEMBERS_SOURCE`. |
| `CROMBOLO_MEMBERS_CLIENT_SECRET` | string | — | That service account's secret. Kept secret: never printed. |
| `CROMBOLO_MEMBERS_ACTORS_FROM` | list | — | On the site that holds the members: the service accounts, by client id, trusted to say who they act for. A member change through one is recorded in the audit as made by that person, through the account. |

### Public site

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_INDEXABLE` | `true` / `false` | `true` | Off keeps search engines out entirely, for a staging site: robots are refused, there is no sitemap and every page asks not to be indexed. |
| `CROMBOLO_PUBLIC_URL` | string | — | Where visitors see the site, when that is an app on another address, such as https://www.example.com. Used for preferred addresses, the sitemap and robots.txt. |
| `CROMBOLO_SHOW_ERROR_DETAILS` | `true` / `false` | — | Shows a server error's message, the template file and line, and the stack on the error page. On in development, off otherwise; with it off a visitor sees only the error's reference, which the log carries too. |
| `CROMBOLO_LIVE_RELOAD` | `true` / `false` | — | Reloads open pages when the components, the schema or the content change, and shows type errors on them. On in development, off in production and under `bun test`. |
| `CROMBOLO_SITEMAP` | `true` / `false` | `true` | Serves `/sitemap.xml`. |
| `CROMBOLO_TRACK_REDIRECTS` | `true` / `false` | `true` | Renaming or moving a page records a redirect from the address it had. |
| `CROMBOLO_DELIVERY_API` | `true` / `false` | `true` | The Delivery API, which serves the published pages anyone may see as JSON. false turns it off. |
| `CROMBOLO_DELIVERY_API_KEY` | string | — | The key that unlocks a private Delivery API, and previews of unpublished content. Kept secret: never printed. |
| `CROMBOLO_DELIVERY_API_PRIVATE` | `true` / `false` | `false` | Makes the Delivery API private: every request needs the key. Unset, it serves what the site publishes. |
| `CROMBOLO_DELIVERY_API_MEDIA` | `true` / `false` | `false` | The Delivery API serves media as well as content. |
| `CROMBOLO_DELIVERY_API_CORS_ORIGINS` | list | any site, while the API is public | Narrows which other sites may call the Delivery API from the browser, such as https://app.example.com, separated by commas. |
| `CROMBOLO_CACHE_MAX_AGE` | number | — | Seconds browsers and a CDN may reuse a page, an API answer or a media item before asking again; 0 keeps nothing. Unset, nothing is kept. |
| `CROMBOLO_CACHE_STALE_WHILE_REVALIDATE` | number | — | Seconds an out-of-date copy may still be shown while a fresh one is fetched. |
| `CROMBOLO_CACHE_TAG_HEADER` | string | — | The header your CDN purges by, such as Surrogate-Key or Cache-Tag. Set, every answer lists the pages and media in it. |
| `CROMBOLO_CACHE_MODE` | `lifetime`, `check` | `lifetime` | How a CDN keeps copies: for the lifetime set above, or, with check, kept and checked back with the site before each use, served at once while checking and while the site is down. Check suits a CDN with no purge set up. |
| `CROMBOLO_CACHE_STALE_IF_ERROR` | number | `604800` | Seconds a kept copy may still be served while the site is answering with errors. Applies whenever copies are kept. |
| `CROMBOLO_CACHE_CHECK_FLOOR` | number | `60` | With check, seconds a copy is kept before checking when checking means showing the page again, so each CDN location does so at most this often. |
| `CROMBOLO_CACHE_VALIDATOR` | string | `body` | How a CDN checking a kept copy is answered: body renders the page and compares it; published answers from what was last published, without rendering. Use published only when no page shows the time or anything else that changes without a publish. |
| `CROMBOLO_DELIVERY_API_PREVIEW_URL` | string | — | Where Preview opens a page in your app, such as https://app.example.com/preview?path={path}&token={token}. |
| `CROMBOLO_DELIVERY_API_PREVIEW_TOKEN_MINUTES` | number | `60` | How long a preview opened in your app keeps working. |

### Remote

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_REMOTE_ACCESS` | string | `off` | What `crombolo` may do to this site from elsewhere: `off`, `read` (pull), `content` (apply bundles of content) or `all` (whole-site pushes, and bundles that change content types, views or code). Who may do it is still up to their permissions. |
| `CROMBOLO_REMOTE_ENVIRONMENT` | string | the site's environment, CROMBOLO_ENVIRONMENT | The name this site goes by for pull and push: lower case letters, digits and dashes. |
| `CROMBOLO_REMOTE_PROTECTED` | `true` / `false` | `true` | A push here needs the protected-push permission. |
| `CROMBOLO_REMOTE_APPROVALS` | `true` / `false` | `false` | A push to a protected site waits for someone else to approve it. Needs `CROMBOLO_SECRET_KEY`. |
| `CROMBOLO_REMOTE_MAX_UPLOAD_GB` | number | `50` | The largest push, media file or change a client may upload, in gigabytes: a change is taken up to this size wherever workspaces or remote access are on. Every other request keeps the usual body limit. |
| `CROMBOLO_REMOTE_AGENTS_GUIDE` | string | `` | An https address of a guide for coding agents working on a site from this remote, which discovery names and `crombolo pull` writes into AGENTS.md. |
| `CROMBOLO_REMOTE_OIDC_ISSUERS` | string | `` | A self-managed GitLab's address, or several separated by commas, whose CI jobs may sign in beside GitHub Actions and gitlab.com. Each job still needs a trust rule in Settings. |

### Logging

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_LOGS_DIR` | string | `logs` | Where log files are written, a file a day, read by the back office log viewer. |
| `CROMBOLO_LOG_LEVEL` | `trace`, `debug`, `info`, `warning`, `error`, `fatal` | `info` | The least severe level logged. |
| `CROMBOLO_LOG_TO_CONSOLE` | `true` / `false` | `true` | Log events are also printed to the console. |
| `CROMBOLO_TRACE_REQUESTS` | `true` / `false` | `false` | Prints a line on the console as each request arrives and as it is answered. |
| `CROMBOLO_HEAP_INTERVAL_SECONDS` | number | `0` | Every this many seconds, prints the memory in use and the requests in flight. `0` is off. |

### Telemetry

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | string | — | The OpenTelemetry collector traces, metrics and logs are sent to, such as `https://otlp.example.com`. Unset, nothing is sent. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | string | — | Where traces alone are sent, in place of the collector above. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | string | — | Where metrics alone are sent, in place of the collector above. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | string | — | Where log lines alone are sent, in place of the collector above. |
| `OTEL_METRIC_EXPORT_INTERVAL` | number | `60000` | Milliseconds between sending the metrics. |
| `OTEL_EXPORTER_OTLP_HEADERS` | string | — | Headers sent with every export, usually the API key, as `name=value` pairs separated by commas. Never shown in the back office. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf`, `http/json` | `http/protobuf` | How exports are written. |
| `OTEL_SERVICE_NAME` | string | — | The name the site's telemetry is filed under; the site's name when unset. |
| `OTEL_RESOURCE_ATTRIBUTES` | string | — | More attributes for everything sent, such as `deployment.environment.name=production`, separated by commas. |
| `OTEL_TRACES_SAMPLER` | string | `parentbased_always_on` | Which traces are kept: `parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG=0.1` keeps a tenth, for a busy site. |
| `OTEL_TRACES_SAMPLER_ARG` | number | — | The sampler's ratio, from 0 to 1. |
| `CROMBOLO_TRUSTED_PROXIES` | list | — | The load balancers or CDN in front of the site, as addresses or ranges such as `10.0.0.0/8`, separated by commas. A trace a request arrives with is continued only from one of them. |

### Command line

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `CROMBOLO_BOOT_ATTEMPTS` | number | `10` | How many times `crombolo start` tries to start the site, waiting longer each time, before it exits. Read by the command line. |
| `CROMBOLO_ACTOR` | string | the account running the command | Who the audit log records for a command, for a pipeline acting for someone. Read by the command line. |
| `CROMBOLO_PROFILE` | string | — | The profile a command acts on when it is not given `--profile`, for a shell or a job. Read by the command line. |
| `CROMBOLO_PROFILES_FILE` | string | `~/.crombolo/profiles` | Where the profiles are kept, for tests and unusual machines. Read by the command line. |
| `CROMBOLO_PROFILE_URL` | string | — | The address of a hosted site a command acts on when neither `--profile` nor CROMBOLO_PROFILE names one: how a CI job names its site. A Next.js front end reads it as the CMS's address. Read by the command line. |
| `CROMBOLO_PROFILE_ENVIRONMENT` | string | — | With CROMBOLO_PROFILE_URL: that site's environment, when it has more than one. Read by the command line. |
| `CROMBOLO_CREDENTIALS` | `keychain`, `file` | the keychain where there is one | Where sign-ins are kept: the operating system's keychain, or ~/.crombolo/credentials, which only you can read. Left unset, a machine with no keychain uses the file. Read by the server and the command line. |
| `CROMBOLO_CREDENTIALS_FILE` | string | `~/.crombolo/credentials` | The file sign-ins are kept in when they are not in the keychain, for tests and unusual machines. Read by the server and the command line. |
| `CROMBOLO_CLI_ACCESS` | `open`, `sign-in` | `sign-in` in production, `open` otherwise | Whether a command that reads or changes the site needs someone signed in with `crombolo login`. At `open` it runs as the command line unless someone is signed in; at `sign-in` it acts as the person, with their permissions. Read by the server and the command line. |
| `CROMBOLO_CLI_TOKENS` | `true` / `false` | `false` | Whether people may create command-line tokens, for a script or a CI job to run commands as them. Off, no token is made and every existing one is refused, but kept. Read by the server and the command line. |
| `CROMBOLO_CLI_TOKEN_MAX_DAYS` | number | `90` | The most days a command-line token may last. Read by the server and the command line. |
| `CROMBOLO_TOKEN` | string | — | A command-line token: commands act as the person who made it, here or on a hosted site, before anyone's stored sign-in. Read by the command line. Kept secret: never printed. |
| `CROMBOLO_BUNDLE_PASSPHRASE` | string | — | The passphrase for an encrypted content file, instead of being asked for it. Read by the command line. Kept secret: never printed. |
| `CROMBOLO_DEBUG` | `true` / `false` | `false` | Adds the stack trace to an unexpected error. Read by the command line. |
| `CROMBOLO_TEMPLATES_DIR` | string | the templates the command line ships | Where `crombolo init` finds its site templates, for trying a changed one. Read by the command line. |

### AWS credentials

| Setting | Takes | Default | Description |
| --- | --- | --- | --- |
| `AWS_REGION` | string | — | The AWS region, for SES e-mail when it sets none. |
| `AWS_ACCESS_KEY_ID` | string | — | A static AWS access key, for SES e-mail. |
| `AWS_SECRET_ACCESS_KEY` | string | — | That access key's secret. Kept secret: never printed. |
| `AWS_SESSION_TOKEN` | string | — | A session token, for temporary AWS credentials. Kept secret: never printed. |

<!-- settings:end -->

## The sites in this repository

`sites/` holds the sites this repository builds, one directory each, committed:

| Site | Id | Ships with the CLI |
| --- | --- | --- |
| `sites/starter` | `starter` | yes |
| `sites/crombolo-demo` | `demo/crombolo` | yes |
| `sites/harbourstone` | `demo/harbourstone` | yes |
| `sites/plain-signal` | `demo/plain-signal` | yes |
| `sites/crombolo` | `product/crombolo` | no — the product site |

Each is a real site — `package.json`, `crombolo.config.ts`, `server.ts`, `schema/`,
`components/`, `css/` — plus a `site.json` naming it, and its content bundle under
`bundles/<slug>`. Each `package.json` is a private workspace depending on
`crombolo: workspace:*`, so after `bun install` it runs the working tree. What it
writes as it runs — the database, its backups, media, logs, the view cache — is
gitignored. `bun run site <id>` runs a copy of it rather than the site itself
(below), so the committed files change only when you mean them to.

None is published by default. A site whose `site.json` says `"distribute": true`
is staged into `@crombolo/cli`'s `templates/` only while the CLI is packed
(`scripts/publish-packages.ts`, through `scripts/sites.ts`), as `components/`,
`css/` and `schema/` under `files/`, its bundle as `bundle/`, and `CREDITS.md`
beside them; the media types `init` writes for itself are left out. Only
`templates/basic` is committed in the CLI.

A site's content is its content files (`content/`,
[`bundles.md`](bundles.md#content-files)), edited as files and applied by
`crombolo start --bundle .`. Only the product site keeps a built bundle,
which `bun run build:template` regenerates (story 164).

## The demo command and the database it may touch

`bun run site <id>` exists so running one of the sites in `sites/`, or trying a
template the CLI ships, is one command rather than four. A site in `sites/` is
copied into `.scaffolds/<slug>` on its first run and runs from there; a CLI
template is scaffolded first. Two decisions in it are worth
stating, because both are about not damaging anything:

- **The database is forced, not defaulted.** The dialect is SQLite and the file
  is inside the site, whatever the environment says — a `.env` naming
  Postgres, or a `CROMBOLO_SQLITE_FILE` pointing at a real site, is overridden
  rather than honoured. A demo cannot migrate or seed a live database even by
  accident. If a scaffold's own file already holds content the run stops and
  names the two flags that continue it; a site in `sites/` carries on with its
  own.
- **A site runs from a copy.** What the backoffice writes — a form, a workflow,
  a content type, a bundle — goes to the site's files, and in `sites/` those are
  committed. The copy leaves out the database, media, logs, view cache and
  `node_modules`, is kept between runs so content made in it survives, and is
  replaced by `--fresh`. `--in-place` runs the committed site, for changing it
  through the backoffice on purpose; there `--fresh` clears only what it wrote as
  it ran.
- **A scaffold lives in `.scaffolds/<template>`**, not `output/`. The compose stack
  mounts `cms_output:/app/output`, which masks the host directory inside the
  container, so a site scaffolded there would be invisible to `--docker`.
- **Ctrl-C ends the run, the container included.** `--docker` runs the site in a
  `compose run` container, and such a container keeps the port it published once
  its client has gone — so the script waits out its child's shutdown rather than
  dying on the first press, and removes the container by a name it chose itself.
  A second press forces it. A container left by a run that was killed outright is
  cleared by the next one, so nothing needs `docker:down` by hand.
  `.scaffolds/` is inside the bind mount, matches no workspace glob — so it joins
  no `bun install` — and is gitignored. `sites/` is a workspace glob, so its sites
  link to the working tree through their own `workspace:*` dependencies.

Nothing is installed into a scaffold. Resolution walks up to this repository's
`node_modules`, where every `@crombolo/*` name is a workspace symlink, so the
demo serves the working tree. That is the point: a demo that installed from npm
would not show you your own changes.

## Settings with no environment variable

The things a site declares only in `crombolo.config.ts`, because each of them
is code rather than a value:

| Setting | What it is |
| --- | --- |
| `redirects` | rules built with `redirect()`, synced into the database at boot ([`rendering.md`](rendering.md)) |
| `bundles` | the server halves of the bundles this site runs ([`bundles.md`](bundles.md)) |
| `host` | the host service the back office vouches for its user to: `{ origin, signingKey, keyId }`, so a host's tool can tell its own service who is signed in ([`bundles.md`](bundles.md#tools-a-host-provides)) |
| `hostProvided` | package names the installation provides to every site it runs; a whole-site file leaves them out of what it requires ([`bundles.md`](bundles.md#bundles-a-host-provides)) |
| `memberIdentityProviders` | identity providers members sign in with on the site: `entra()`, `awsIdentityCenter()`, `oidc()` ([`operations.md`](operations.md#signing-in-through-an-identity-provider)) |
| `backofficeIdentityProviders` | the same, for backoffice users; a separate list, so staff and members can use different providers. A provider declared `locked: true` takes no change from the back office (story 305); `CROMBOLO_LOCKED_IDENTITY_PROVIDERS` locks by id from the server |
| `islands` | where `'use client'` islands' browser code comes from: built with each generation of views by default, or `{ manifest, devServer }` for a site's own Vite build ([`rendering.md`](rendering.md#islands)) |
| `middleware` | the site's middleware by stage, `{ request, route, page }`, each run in the order listed; its time limit is `CROMBOLO_MIDDLEWARE_TIMEOUT_MS` ([`rendering.md`](rendering.md#middleware)) |
| `database` | the site's own tables, `{ tables: defineSiteTables(steps), anonymise }`: migrated with crombolo's, and what an anonymised export may carry of each ([`data-model.md`](data-model.md#custom-tables)) |
| `jobs` | the site's background jobs, modules each export of which is queued as `site().jobs.enqueue('<module>.<export>', payload)` and run on a node that owns writes ([`rendering.md`](rendering.md#background-jobs)) |
| `schedules` | when the site's jobs run by themselves: `{ job, cron, timezone?, missed? }` |
| `queries` | the site's named queries, modules each export of which runs as `site().queries.<module>.<name>(…)` against the site's tables ([`rendering.md`](rendering.md#named-queries)) |
| `routes` | the site's route handlers, `route(path, handlers, options)`, answered at their paths ahead of content finding; limits `CROMBOLO_ROUTE_TIMEOUT_MS` and `CROMBOLO_ROUTE_RATE_LIMIT_PER_MINUTE` ([`rendering.md`](rendering.md#route-handlers)) |
| `liveReload` | open pages reload when the components, the schema or the content change, and show the background type check's findings; `CROMBOLO_LIVE_RELOAD`, on in development except under `bun test` ([`writing-components.md`](writing-components.md#the-development-loop)) |
| `pages` | the pages in the content tree, by path, that answer `notFound`, `unauthorized` and `error` outcomes from a page's code, per hostname or language if need be ([`rendering.md`](rendering.md#status-pages)) |
| `search` | the search providers, `{ backoffice, site, matchLimit }`: each a factory given the database, the database's own search when unset ([`search.md`](search.md#providers)) |

`deliveryApi` is the same: its switches and key have environment variables
above, and member sign-in — clients, secrets, redirect URLs, the login page — is
set in `crombolo.config.ts` ([`delivery-api.md`](delivery-api.md)).

`seo` sits between the two: its two switches have environment variables above,
and the rest — robots rules, site name, title suffix, sharing image, not-found
page — are set in `crombolo.config.ts` or in Settings → Search & sharing, which
wins field by field ([`seo.md`](seo.md)). `pages.notFound`, when set, wins over
the not-found page.

`errors.showDetails` has `CROMBOLO_SHOW_ERROR_DETAILS` above; the config file wins.

`bundles` has no environment variable deliberately, and the absence is tested. A
variable naming a package would be a way to start third-party code in the server
process without a code change, and the point of the list is that it is a
reviewable, deployed decision:

```ts
import { redirects } from '@crombolo/simple-redirects'
import { defineConfig } from '@crombolo/crombolo'

export default defineConfig({
  bundles: [redirects()],
})
```

Installing an extension from Settings → Extensions gives you its backoffice screen.
This line is what lets it answer a request.

## Service accounts the config names

`content.actAs`, `members.actAs`, `members.managedBy`, `members.actorsFrom`,
`users.managedBy` and `groups.managedBy` each name an API client. Settings → Service accounts (story 433) shows each account with what these make it
used for, and asks before anything they name is disabled, deleted or loses its client id.
Make the account and its client id there, then name the client id here.

## Users managed from outside the site

A site whose back-office people are kept in one directory, shared by several sites,
names the API clients that directory signs in as (story 389):

```ts
export default defineConfig({
  users: {
    managedBy: ['crombolo-back-office-directory'],
    managedAt: 'https://people.example.com/users/{email}',
  },
})
```

or `CROMBOLO_USERS_MANAGED_BY` (client ids, separated by commas) and
`CROMBOLO_USERS_MANAGED_AT`. Both are read at boot and nowhere else.

- **Only those clients** add, invite, change, disable, enable, unlock or remove a
  person, reset their password or two-factor, or change their groups or whom a group
  holds, through the Management API, the remote protocol or the command line.
- **Everyone else is refused,** administrators included, with "Managed outside this
  site" (`operationStatus: ManagedOutside`).
- **Each person still sets their own** language, avatar, password and two-factor.
- **API users stay the administrator's:** created, changed and given secrets as before,
  so the directory's own client can be set up and its secret rotated with this on.
- **What a group may do** (its sections, permissions and start nodes) is edited as
  before; only who is in it is the directory's.
- **An identity provider signs in only people who exist:** it makes no new user and
  changes no groups from its claims. A person the directory disabled is refused as any
  disabled user is.
- **The directory links each person to their sign-in** (story 404), so a provider signs
  them in the first time: `PUT <backoffice>/crombolo/api/users/{key}/logins
  { provider, subject }` (the provider's id as `backofficeIdentityProviders` names it,
  and the provider's subject for the person), `GET` to list a user's links, and
  `DELETE …/logins/{provider}` to remove one. Only the directory's clients, with a
  sign-in token in `Authorization`; without the setting, an administrator. A login
  linked to someone else is refused (409). So the directory creates the user, sets its
  groups, links its login, and the person signs in.
- **A bundle carrying users is refused** (`users-managed`, at its check): a site import
  or bundle apply with users writes no user here. `--exclude-people` leaves its people
  out; a bundle carrying members and no users applies as before.
- **The Users section** offers no way to add, invite, remove, disable, enable or unlock
  a person or to change their groups, and saves only API users. With `managedAt` set,
  each person's actions include "Open where this person is managed", the address with
  `{email}`, `{key}` or `{userName}` filled in.


## User groups defined outside the site

A host that keeps one definition of each user group for every environment names the API
clients that define them (story 405), beside `users`:

```ts
export default defineConfig({
  groups: {
    managedBy: ['crombolo-back-office-directory'],
    managedAt: 'https://people.example.com/groups/{alias}',
  },
})
```

or `CROMBOLO_GROUPS_MANAGED_BY` and `CROMBOLO_GROUPS_MANAGED_AT` (`{alias}` or `{key}`),
read at boot. Either setting may be on without the other.

- **Only those clients** create, change or delete a group, every part of it: name,
  alias, icon, sections, each area's level and verbs, start nodes, languages and
  per-item permissions. Everyone else is refused, administrators included ("Managed
  outside this site"). Who is in a group stays `users`'.
- **User Groups is read-only** in the back office: no create, save or delete, and each
  group links to `managedAt`.
- **An item not here yet:** a per-item permission names it by key and takes effect when
  it arrives. A start node naming it is held by key: until the item arrives the group has
  no start in that tree, so its people see none of it; when it does, it applies.
  `<plugin>/api/users-managed?group=<key>` lists the trees still waiting.
- **A bundle carrying a group's definition is refused** at its check (`groups-managed`),
  as a change carrying one is; `--exclude-people` leaves its people out.

## Members managed from outside the site

A site whose members are kept in a directory, as well as signing up on the site, names
the API clients that directory provisions members as (story 445):

```ts
export default defineConfig({
  members: { managedBy: ['crombolo-back-office-directory'] },
})
```

or `CROMBOLO_MEMBERS_MANAGED_BY` (client ids, separated by commas). The config file's
list wins over the variable.

- **A member one of those clients creates remembers it as their manager**
  (`member.managed_by`, `managedBy` in the Management API's member, with the name of the
  API user the client signs in as). Members made by any other client, by
  `members.actAs`, by sign-up or by an external sign-in have none, and nor does any
  member from before the setting: nothing takes a member on.
- **Only the manager changes them:** their name, e-mail, username, approval, groups,
  member-type properties, and whether they exist. Everyone else is refused,
  administrators included, with "This member comes from a directory outside the site:
  change them there." (403, `operationStatus: ManagedOutside`), in the back office, the
  Management API, the command line, the remote protocol and `site().members` (jobs
  under `members.actAs` included). The member cannot change their own details through
  the site either, and an identity provider's sign-in changes neither their groups nor
  their properties.
- **Still the member's and the site's:** their password (a reset, or a new one set by
  an administrator), turning their second factor off, lockout after failed sign-ins and
  an administrator unlocking them.
- **Handing a member back:** `DELETE <backoffice>/crombolo/api/members/{key}/manager`,
  by the manager alone (403 otherwise), clears it and the member is the site's own;
  audited as `HandBack`. `GET` the same address says who keeps a member, to whoever
  holds Members.
- **The Members section** marks each managed member in the list ("Kept by a
  directory"), and opens them read-only with Save hidden and "Kept by <name>: changes
  are made there." in its footer.

## Members held by another site

Where content is made on one site and served from another (story 388), the members are
the serving site's: they sign up, change their details and sign in there. The site where
content is made names that site, and a service account on it (story 444):

```ts
export default defineConfig({
  members: {
    source: 'https://www.example.com',
    client: { id: 'crombolo-back-office-content-site', secret: process.env.MEMBERS_SECRET ?? '' },
  },
})
```

or `CROMBOLO_MEMBERS_SOURCE`, `CROMBOLO_MEMBERS_CLIENT_ID` and
`CROMBOLO_MEMBERS_CLIENT_SECRET`. A source that is not an `http` or `https` address with
no path, or a source with no client, refuses to boot, saying which.

- **The account** is a service account (story 433) on the serving site with Members; what
  its groups allow there is what this site may do with its members. This site signs in as
  it by client credentials, keeps the token until it expires, and calls that site's
  Management API by the vendored contract (`packages/server/src/members-remote.ts`).
- **Everything that reaches members through the ports** works on that site's: the Members
  section, the member and member group pickers, the Management API's member routes, a
  page's Public Access, preview's groups (story 443) and `site().members`. Nothing is kept
  here but the group list, for a minute, for rendering and preview. A member a directory
  keeps there (story 445) is read-only here too.
- **Public Access stays this site's:** its rules name the serving site's groups and members
  by name, as Umbraco stores them, and travel with the page. Renaming a group from here
  rewrites this site's rules naming it, through the content operations, so the next change
  carries them; the back office first warns how many pages' rules name it
  (`<backoffice>/crombolo/api/member-groups/{key}/rules`).
- **This site holds no members or member groups.** Member sign-in, registration, reset,
  external sign-in and the Delivery API's member routes answer 404; `site export
  --with-members` is refused with a sentence; a bundle carrying members or member groups is refused at its check
  (`members-elsewhere`). Member types stay schema, made here and moved with the rest.
- **The command line and the remote protocol** (story 448) work on the serving site's
  members too, a `crombolo members …` run on this site's database with no server included:
  see docs/operations.md, "Members held by another site". The sign-ins panel reads the
  serving site's `<backoffice>/crombolo/api/members/{key}/sign-ins`, and a reset link is
  sent from it by `POST <backoffice>/crombolo/api/members/{key}/reset-link`, and
  `members link` runs there by `POST <backoffice>/crombolo/api/members/link`, each for a
  principal with Members there.
- **`site().members`** reads and writes the serving site's members through the same
  account. A job needs no `members.actAs`: it acts through the account, and is named in
  that site's audit by what it is (`job imports.nightly`).
- **While the serving site isn't answering,** the Management API answers 503, "Members are
  kept at <site>, which isn't answering.", and nothing is written here. The Members section
  says so, with Try again (`<backoffice>/crombolo/api/members-source`).

**Who acted.** Each write carries `Crombolo-Acting-For: <id>|<name>`, each part
URI-encoded: the back-office user, or the site's code or job that wrote. The serving site
records it as the audit's actor ("by Ada, through Content site") only when the caller is a
service account it lists in `members.actorsFrom` (`CROMBOLO_MEMBERS_ACTORS_FROM`, client
ids separated by commas); from any other caller the header is ignored, and the account is
audited as itself. Any service account with Members may manage members, as the Management
API allows: `actorsFrom` only adds the person's name.

## A site open only to its back-office users

`siteAccess: 'users'` (`CROMBOLO_SITE_ACCESS=users`, story `446`) closes the whole site
to everyone but people who can sign in to its back office, whatever its pages' own
Public Access says: an intranet, a staging copy, or the site content is made on before
it is served elsewhere. `public`, the default, leaves the site as it was.

- **On every role.** A `web` node checks a session as the back office does: sessions are
  reference tokens in the shared database, so it needs no back office of its own.
- **What needs a user:** pages, media, the site's routes and actions, form posts, member
  sign-in pages and routes, search, its scripts, the sitemap, the back office's event hubs and
  the Delivery API. A user in any group is let in: who may sign in at all is for the
  back office and its providers to decide.
- **What doesn't:** the back office's sign-in and its assets, `/health`, `robots.txt`,
  and everything that checks its own credentials: the Management API, the plugin's API
  routes and the remote, the token exchange (story `364`) included. The Delivery API
  with its key (`CROMBOLO_DELIVERY_API_KEY`, sent as `Api-Key`), so a front end holding
  it still reads it. A workspace's link or hand-off (stories `379`, `415`) and a preview
  link (`368`), each by its own token: a preview link opens its one page and what that
  page loads (its stylesheets, scripts, islands and media), and nothing else.
- **A way to look at Shared** (story `447`, [`workspaces.md`](workspaces.md#shared-story-447)):
  `open` for `shared`, or a link someone with the Content section made, swapped for a
  host-only `crombolo-shared` cookie at the site's own address. It lets its holder read
  the site, its pages, media, routes and the Delivery API, never the back office or the
  Management API; to write too only where an administrator opened it, or made the link
  so. A write it doesn't allow is a `401` saying a link only lets them look.
- **Someone not signed in:** a browser opening an address goes to the back office's
  sign-in, with `returnUrl` the path and query it asked for (only ever a path on this
  site), and comes back there signed in. Anything else, an API call or a write, is a
  `401` with problem details. A browser is a `GET` or `HEAD` with no `Authorization`
  that navigates (`Sec-Fetch-Mode`), or, without that header, doesn't ask for JSON alone.
- **The session:** the access token's cookie, else the refresh token's, else the session
  cookie a sign-in through the login page leaves. The refresh token is read as it
  stands, never rotated: refreshing would let a page's parallel requests spend a token
  another of them needs and sign the person out. So reading the site never extends a
  session, and signing out, an ended session or a disabled user closes it at once. A
  write that relies on a cookie and comes from another site is refused, as the
  Management API refuses one.
- **Every answer** carries `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private`,
  in place of anything public a page said; `robots.txt` disallows everything.
- **The same host.** The back office's cookies are host-only (`__Host-`, `Path=/`), so the
  site and its back office must be served on one host: a proxy that sends the back
  office's path to an `api` node and the rest to `web` nodes keeps them so. Boot warns
  when `applicationUrl`'s host isn't among the site's hostnames.

The site's own code never sees the back office's cookies, with either setting: the
access, refresh, session and two-factor cookies are taken from the request the renderer,
the views' `headers()` and `cookies()`, the middleware chain, the site's routes and
actions, and an extension's back-office routes are given.

**One way in.** With `allowLocalLogin: false` and a single back-office identity provider,
the back office's login goes straight to that provider, keeping the return path, here
and on a public site alike. A sign-in it refuses, or one that fails, comes back to the
login screen with its error and Try again, and isn't sent round again.

## E-mail

When the configuration sets no e-mail, an administrator can set it up in Settings → E-mail
(story 340). Whatever the configuration sets wins: with `CROMBOLO_EMAIL_PROVIDER`
set (`none` included, which turns e-mail off) or `email` in `crombolo.config.ts`,
that card is read-only. Whoever sets e-mail decides where password-reset links go,
so a host's choice can't be redirected from the back office.

The card's settings are kept in the database (`key_value`, `crombolo:email`), the
provider's key sealed with `CROMBOLO_SECRET_KEY`; without that key the card can't
keep one. A kept key is used only with the provider and address it was entered
for, so changing either needs it entered again. A change takes effect at once on
the server that saved it, and on the others within 30 seconds, with no restart.
Saving and removing are audited, never with the key.

Opt-in, and off by default. Nothing is installed, no SMTP is spoken, and a site
that configures no provider sends no e-mail — which is a supported state, not a
broken one.

What needs it: inviting backoffice users, resetting a forgotten password,
Forms' Send email workflow, and notifications about page changes. Without a
provider those are **unavailable rather than failing**: the backoffice hides
Invite and offers Create (which shows a generated first password), the sign-in
screen drops "Forgotten password?", the Notifications dialog says the site
can't send e-mail and disables its choices, and `GET
/umbraco/crombolo/api/email` tells a signed-in client why. Subscriptions made
before stay, and start delivering once a provider is set; development sends to
the console, so notifications work there as invitations do. `crombolo status`
has an `email` line, and the boot log says it once.

Set it from the environment, or pass a port as `email` in `crombolo.config.ts`:

```ts
import { resendEmail } from '@crombolo/crombolo'

export default defineConfig({
  email: resendEmail({ apiKey: process.env.RESEND_KEY ?? '', from: { email: 'no-reply@example.com', name: 'Example' } }),
})
```

Four adapters, all plain `fetch` against a provider's HTTPS API:

| Adapter | Takes | Notes |
| --- | --- | --- |
| `resendEmail` | `apiKey`, `from` | Resend verifies the sending domain |
| `postmarkEmail` | `apiKey` (server token), `from`, `messageStream?` | rejects a send on the wrong stream, so the stream is configurable |
| `sesEmail` | `region`, `from`, credentials | SES v2, signed with SigV4; attachments become a raw MIME message |
| `customEmail` | `url`, `from`, `apiKey?`, `headers?` | POSTs this CMS's own JSON to an endpoint the site owns |

### HTTPS is required

Every adapter authenticates with something worth stealing — a bearer token, a
server token, a SigV4 `Authorization` header — so an `http://` endpoint is
refused **at construction**, not on the first send. A site that gets it wrong
fails at boot with the reason; from the environment it is a warning and no
e-mail, because an opt-in feature must never stop a site booting.

The one exception is loopback: `http://localhost:8025` and the rest of
`127.0.0.0/8` and `[::1]` are allowed, because a mail relay in a sidecar is a
real deployment and nothing about it is on a wire. A host that merely looks
local — a service name inside a cluster, or `localhost.example.com` — still
crosses a boundary and is held to HTTPS like anything else.

### SES and its signature

SES authenticates with a Signature Version 4 signature rather than a key, so the
signing is ours (`email-ses.ts`) rather than an SDK's. Hand-rolled signing is
only defensible against known answers, so it is held against two:

- AWS's **published signing-key derivation example** — the `us-east-1`/`iam`
  vector from their own documentation
- **Bun's own SigV4**, which is an independent implementation: `Bun.S3Client.presign`
  signs a canonical request, and ours must produce the identical signature for
  the same inputs. This reaches the canonicalisation and the string-to-sign,
  which a key vector alone does not

Both run on every suite, so a change that breaks the signing fails the build
rather than failing in production.

Credentials come from the options, else from the variables AWS tools already
read. **Instance roles are not resolved** — that needs the metadata service — so
a container wanting SES needs static keys or a session token
(`AWS_SESSION_TOKEN` is signed in when present).

SES's Simple content carries a subject and a body and nothing else, so a message
with an attachment is sent as raw MIME: `multipart/mixed`, with a nested
`multipart/alternative` when there is both text and HTML. Bcc stays out of the
MIME headers and travels in `Destination`, where it cannot be shown to the other
recipients.

No SMTP adapter. Outbound 25/587 is blocked on most container hosts, so an SMTP
client would be protocol risk for a path that often cannot be used; one can be
added behind the same port if a self-hosted mail server turns out to matter.

`email` has three states: a port sends through it, `undefined` lets the
environment decide and falls back in development to printing the message on the
console, and `null` is off outright — console included, so a site that declares
it has no e-mail behaves the same in every environment.

Sending never throws. A provider that is down, a wrong key and a dead network
all come back as a failed send with the provider's own message, which is what
the log records and what an invitation's failure reports.

`sendUserLink` remains, for a site that wants to deliver these two links itself
rather than through a provider — a function in `crombolo.config.ts` handed the
link. It outranks `email`, and `sendUserLink: null` means nobody can be invited
and no password can be reset whatever else is configured.
`allowPasswordReset: true` shows "Forgotten password?" on the sign-in screen,
when a link can actually be delivered.

## Telemetry

Traces, metrics and logs go to an OpenTelemetry collector once one is named
(story 262; what is sent, and what never is: [`operations.md`](operations.md),
"Telemetry"). Three common ones:

```sh
# Datadog, through the Agent's OTLP receiver
OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent:4318

# Grafana Cloud, through the stack's OTLP gateway
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-2.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 of instance-id:token>

# A local collector, to see what is sent
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

In code, the same is `telemetry` in `crombolo.config.ts`, which the variables
override, and the proxies whose `traceparent` is followed are `trustedProxies`:

```ts
export default defineConfig({
  telemetry: { endpoint: 'http://localhost:4318', serviceName: 'riverside-bakery' },
  trustedProxies: ['10.0.0.0/8'],
})
```

## Scripts

| Command                                               | Does                                                                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test`                                            | full suite against SQLite                                                                                                                                     |
| `bun run test:sqlite` / `test:postgres`               | pin the dialect explicitly; `test:postgres` starts the `db` container first                                                                                   |
| `bun run docker:test`                                 | the suite in a container on SQLite, over the mounted source                                                                                                   |
| `bun run docker:test:sqlite` / `docker:test:postgres` | the same, dialect pinned; the SQLite one starts no database                                                                                                   |
| `bun run test:all`                                    | both dialects in sequence                                                                                                                                     |
| `bun run docker:test:all`                             | both dialects in a container, in sequence                                                                                                                     |
| `bun run test:ci`                                     | the suite with the test environment but no dialect pinned — CI sets `CROMBOLO_DB` itself                                                                      |
| `bun run test:browser`                                | the real backoffice in headless Chrome against a throwaway site; fails on console errors, failed requests and 4xx/5xx (`docs/testing.md`)                  |
| `bun run docker:test:browser`                         | the same suite in its own Playwright image; Chromium rather than Chrome (no Linux arm64 Chrome)                                                               |
| `bun run test:load` / `docker:test:load` | the `*.load.ts` suite: concurrent edits on overlapping branches, then an invariant pass; the release pipeline runs it on both dialects |
| `bun run test:bench` / `docker:test:bench` | the `*.bench.ts` suite: a generated 25,000-page site timed against the budgets in `testing.md`; the release pipeline runs it on both dialects |
| `bun run test:integration` / `docker:test:integration` | the `*.integration.ts` suites: the real CLI spawned per step, for creating a site, importing an Umbraco site, content transfer and the upgrade. Named so `bun test` leaves them out; CI always runs them |
| `bun run check`                                       | **the gate**: Biome (formatting, lint, import order) + `tsc --noEmit`                                                                                         |
| `bun run fix`                                         | **fix everything Biome can**: formatting, lint, import order                                                                                                  |
| `bun run format`                                      | rewrite formatting only                                                                                                                                       |
| `bun run format:check`                                | verify formatting only                                                                                                                                        |
| `bun run lint`                                        | lint only                                                                                                                                                     |
| `bun run lint:fix`                                    | apply lint fixes only                                                                                                                                         |
| `bun run typecheck`                                   | `tsc --noEmit` across the workspace                                                                                                                           |
| `bun run check:modules`                               | verify the vendored backoffice links in a browser                                                                                                             |
| `bun run start:local`                                 | **local development**: `crombolo start` in `apps/site` — migrate, seed, reset and print the admin password, serve                                             |
| `bun run start:local:watch`                           | as above, reloading on change                                                                                                                                 |
| `bun run dev`                                         | `apps/site/server.ts` under `bun --watch`, with no password handling                                                                                          |
| `bun run site <id>`                                   | **a site, running**: a copy of a site in `sites/`, or a CLI template scaffolded, in `.scaffolds/`. `--docker` in the compose stack, `--fresh` to copy or scaffold again, `--in-place` to run a site in `sites/` itself, `--reuse` to accept a scaffold whose database holds content, `--dry-run` to say what it would do. Runs the working tree, not the published packages |
| `bunx crombolo <cmd>`                                 | the CLI: `start [--bundle <dir>] [--from <file>]`, `site export`, `import <file> [--replace\|--replace-all]`, `init [--name\|--postgres\|--template]`, `status`, `admin reset-password`, `types check\|sync\|export\|rewrite\|purge\|new\|list\|show\|update\|remove`, `types property add\|update\|move\|remove`, `types tab add\|rename\|move\|remove`, `generate`, `components check\|list\|new`, `assets list\|new`, `content publish\|unpublish\|move\|copy\|sort\|delete`, `audit list\|stream`, `domains [set\|clear\|apply\|undo]`, `dictionary export\|import`, `upgrade [check [--fix]\|--plan\|ledger]`, `profile add\|list\|remove\|import`, `remote trust\|job`, `login\|logout\|whoami`, `pull`, `push`, `media fetch\|import\|export\|move\|delete`, `maintenance pause\|resume\|status`, `site apply\|runs\|revert\|export\|build\|check-code\|install\|uninstall\|list\|deploy\|sign\|verify\|purge`, `users list\|unlock\|enable\|disable\|reset-password\|reset-2fa\|invite`, `api-client rotate`, `index list\|rebuild`, `cache rebuild`, `health`, `recycle-bin empty`, `schema` (this CLI described for machines); every command takes `-o json` |
| `bun add -g @crombolo/cli`                            | the same CLI without a site: `init` somewhere new, or run commands against a site this machine does not serve                                                  |
| `bun run build:template`                              | regenerate the product site's generated docs pages and its bundle (`scripts/build-template.ts`); the other sites and templates are their content files |
| `bun run generate:types`                              | regenerate contract types from `contracts/OpenApi.json`                                                                                                       |
| `bun run docs:config`                                 | regenerate the environment variable tables in this page from the settings list (`packages/server/src/settings.ts`) |
| `bun run coverage:api`                                | implemented vs. total API operations → `docs/api-coverage.md`                                                                                                 |
| `bun run fork:checkout`                               | check out the fork of Umbraco's client (`umbraco/crombolo`) at `vendor/umbraco-client/`                                                                     |
| `bun run fork:pin`                                    | make the fork's checked-out commit the one `main` builds (`packages/backoffice-dist/UMBRACO_CLIENT`)                                                        |
| `bun run fork:build`                                  | build the pinned fork commit's npm package into `output/umbraco-client/`; `vendor:backoffice` runs it                                                       |
| `bun run vendor:backoffice`                           | build `packages/backoffice-dist/dist/` from the fork's package                                                                                                |
| `bun run editors:table`                               | regenerate `packages/schema/src/editors.gen.ts`, each editor the back office offers with its settings and defaults, from the vendored manifests; `--check` fails when it differs, as `tests/editors-table.test.ts` does. Run it after `vendor:backoffice` brings a new client |
| `bun run vendor:refresh-static`                       | re-seed `packages/backoffice-dist/upstream-static/` from the fork's worktree, or `$UMBRACO_SRC`                                                               |
| `bun run localizations:build`                         | regenerate the per-language overrides in `backoffice-host/plugin/localizations/` (the product name, and "content type" for "content type"); `vendor:backoffice` already runs it                                 |
| `bun run docker:down`                                 | stop the test containers and remove any stray `run` container                                                                                                 |
| `bun run docker:reset`                                | the same, and delete the volumes too, including the database                                                                                                   |
| `bun run docker:build`                                | rebuild the CMS image                                                                                                                                         |
| `bun run db:up`                                       | start only Postgres (what `test:postgres` uses)                                                                                                               |
| `bun run release:version <v>`                         | set one version across every published package (the built back office included), the backoffice plugin manifests, `bun.lock` and the `VERSION` constant |
| `bun run release:dry-run`                             | pack every package and check the tarballs, publishing nothing                                                                                                 |
| `bun run release:publish`                             | pack and publish to npm; skips versions the registry already holds                                                                                            |

---
