# Running a site

What a deployed site needs beyond the code: where uploads live, how a URL that
moved keeps working, how schema travels, and what the security model is.

## First boot

A site self-hosted on your own cloud starts one of two ways, and neither uses
Umbraco's install wizard: those endpoints answer 501 on purpose (`roadmap.md`).

- **From a pipeline**, everything is a setting: the database
  (`CROMBOLO_DB`, `CROMBOLO_POSTGRES_URL`) and the first administrator
  (`CROMBOLO_ADMIN_LOGIN`, `CROMBOLO_ADMIN_PASSWORD`). The password seeds only a
  database being created. A later start never resets, re-enables or signs out an
  existing administrator.
- **On Postgres, with tables of the site's or a bundle's own** (story 189), the
  database user also needs `CREATEROLE` and `CREATE` on the database: the
  first boot makes a login-less role and a schema for each owner. Without them
  it stops and prints the few statements to run once as a user that may, and
  the next boot checks what they made ([`data-model.md`](data-model.md#custom-tables)).
- **From a cloud console**, set `CROMBOLO_SETUP_CODE` to a value of at least 16
  characters that only you know, and leave the password unset. The first visit
  to the backoffice opens **Set up your new site** (`<backoffice>/setup`), which
  asks for your name, e-mail, password and that code. `crombolo start` prints
  the address but never the code.

- **From a pipeline, with sign-in only through an identity provider**
  (`allowLocalLogin: false`), seed the API client the pipeline signs in with:
  `CROMBOLO_API_CLIENT_ID` (starting `crombolo-back-office-`) and
  `CROMBOLO_API_CLIENT_SECRET`. The install creates an API user in the
  administrators group holding that client, and **no password administrator**
  unless `CROMBOLO_ADMIN_PASSWORD` is set too. The site counts as set up. The
  pipeline gets a token with the client-credentials grant
  (`POST …/security/back-office/token`, `grant_type=client_credentials`),
  local sign-in or not.
  - An existing site gains the client the next time it starts, and a site
    still waiting for setup stops waiting.
  - A client that exists is never changed from config: rotate its secret
    through the Management API.
  - The secret is never printed or logged.
  - On your own machine, `CROMBOLO_LOCAL_ADMIN=true` still seeds the password
    administrator, so `crombolo start` prints a sign-in. It is honoured only
    in development with no `applicationUrl`, or one on localhost, and the demo
    sites set it. Anywhere else it is ignored, and the log says so (story
    `034`).

Setup is recorded in the database, so a restart cannot reopen it, and neither
can deleting the administrator later. It closes for good when it completes,
inside a lock, so two attempts at once create one account. The code is compared
in constant time. Wrong codes are limited per caller and across all callers.
Once the site is set up, the log warns (by name, never by value) while
`CROMBOLO_SETUP_CODE` is still set. Remove it then.

**When the server cannot start** — the database is unreachable, refuses the
sign-in or does not exist, an upgrade is waiting, or `schema/` has errors —
`crombolo start` keeps listening:

- It serves a page saying what is wrong and which setting or command fixes it.
  The database is named by host and database only, never by its URL.
- `/health` answers 503, so a load balancer keeps traffic away.
- It retries with backoff (2s, doubling, at most 60s), up to
  `CROMBOLO_BOOT_ATTEMPTS` (10). Then it exits non-zero, so the platform's
  restart policy and alerts take over.

A database that comes up after the server is picked up without a restart.

**Upgrading.** `crombolo upgrade check`, then `crombolo upgrade`. Each framework
step commits with its own record in the ledger. A step that fails is rolled back
and named, with what to do. The next run carries on from that step and never
repeats one that landed. The Changes dashboard shows the version, when the site
was installed, and its last upgrade.

## Media storage

Where uploaded bytes live is one interface — `MediaStore` in
`packages/server/src/media-store.ts` — so a site can move its media library off
the local disk without anything above it changing. It has four verbs (`get`,
`put`, `delete`, `list`) plus an optional `publicUrl`, and that is all the media
library, the image processor and the temporary-upload flow use.

Three stores ship:

| Store                     | Helper                                       | Notes                                                                                                            |
| ------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **File system** (default) | `fileSystemMediaStore(dir)`                  | files under `mediaDir`, exactly where Umbraco puts them                                                          |
| **S3**                    | `s3MediaStore({ bucket, … })`                | via Bun's own S3 client — no dependency; works with AWS, Cloudflare R2, DigitalOcean Spaces, MinIO, Backblaze B2 |
| **Azure Blob Storage**    | `azureMediaStore({ account, container, … })` | the REST API with Shared Key or SAS auth — no SDK dependency                                                     |

A site picks one in `crombolo.config.ts`:

```ts
import { defineConfig, s3MediaStore } from "@crombolo/crombolo";

export default defineConfig({
    mediaStore: s3MediaStore({
        bucket: "my-site-media",
        region: "ap-southeast-2",
    }),
});
```

…or leaves it to the environment, which is what a container deployment wants:

```sh
CROMBOLO_MEDIA_STORE=s3
CROMBOLO_MEDIA_S3_BUCKET=my-site-media
CROMBOLO_MEDIA_S3_REGION=ap-southeast-2
# CROMBOLO_MEDIA_S3_ENDPOINT=…  for R2, Spaces or MinIO
# CROMBOLO_MEDIA_S3_PREFIX=uploads
# CROMBOLO_MEDIA_S3_PUBLIC_URL=https://cdn.example.com   redirect browsers to a CDN
# CROMBOLO_MEDIA_S3_PRESIGN_SECONDS=300                  or to a signed bucket URL
```

```sh
CROMBOLO_MEDIA_STORE=azure
CROMBOLO_MEDIA_AZURE_ACCOUNT=mysite
CROMBOLO_MEDIA_AZURE_CONTAINER=media
CROMBOLO_MEDIA_AZURE_KEY=…          # or CROMBOLO_MEDIA_AZURE_SAS=?sv=…
```

Credentials left unset fall back to whatever the underlying client would find
anyway, so a machine with an instance role needs none configured. An
unrecognised `CROMBOLO_MEDIA_STORE` degrades to the file system rather than
losing the media library.

Three things follow from the interface rather than from any one store:

- **Serving.** By default this server streams the bytes, which keeps a bucket
  private; it streams from the local file when the store has one, so a
  disk-backed site still gets `sendfile`. A store that returns a `publicUrl`
  gets browsers redirected to it instead — except for a protected file, which
  is always streamed by this server, `private, no-store` (story 196). Anything
  the public address serves is open to whoever has the link, so keep protected
  files in a store nothing public fronts ([`rendering.md`](rendering.md),
  "Protected media").
- **Image variants.** Crops and resizes are cached _in the store_, under
  `.cache/`, keyed by the source's etag — so a replaced original invalidates its
  crops with nothing tracking that, and one node's work serves every node.
- **Temporary uploads.** These go to the store too, under `.temp/`, so a
  load-balanced set can place an upload a different node received.

Writing another store is implementing those four verbs;
`tests/media-store.test.ts` drives the whole media library against one backed by
a `Map`, which is the check that the seam is real.

---

## Redirects

A URL that has worked keeps working. Three things feed one table, `redirect_url`,
and one matching pass: the URL tracker, the site's own code, and — with the
redirects bundle installed — an administrator.

**The URL tracker.** Renaming or moving a published page records a 301 from the
URL it answered on, for the page and every published descendant, per culture —
Umbraco's behaviour, including the parts that are easy to get wrong: a recycle-bin
move records nothing (there is no new URL to point at), a rename that is reverted
removes the rule that would otherwise redirect the live URL to itself, and the 301
is sent uncacheable on purpose, because browsers cache them hard enough that a
rename-and-rename-back would otherwise stick for anyone who saw the first answer.
A tracked rule names the _document_, so two successive renames leave the oldest
URL pointing at where the page is now rather than chaining redirects. Set
`trackRedirects: false` to turn it off, as Umbraco's `DisableRedirectUrlTracking`
does.

One case goes further than Umbraco: **re-ordering root pages**. Under
`HideTopLevelNodeFromPath` the first root is `/` and the others are `/<segment>`,
so sorting the roots moves them — and Umbraco's tracker listens only to publish
and move, which leaves that one silent. Sorting is tracked here for the same reason
renaming is.

**Redirects in code.** A site declares its own with `redirect()`, which Umbraco
has no equivalent for — its answer is a rewrite rule in front of the site:

```ts
import { defineConfig, redirect } from '@crombolo/crombolo'

export default defineConfig({
  redirects: [
    redirect('/contact-us', '/contact'),
    redirect('/old-blog/*', '/news/$1'), //     a subtree; $1 is the tail
    redirect('/*', 'https://new.example.com/$1'), // the whole site
    redirect(/^\/product\/(\d+)$/, '/products/$1'), // captures substitute
    redirect('/docs/*', 'https://docs.example.com/$1', { status: 302 }),
    redirect('/legacy', { document: 'a3f1…' }), // follows the page's renames
  ],
})
```

A target may be a path, an absolute URL, or `{ document }` — a document key,
resolved when the request arrives, so the redirect follows the page when someone
later renames or moves it, and stops matching if the page is unpublished rather
than sending visitors to a dead URL.

**Redirects in the backoffice.** `@crombolo/simple-redirects` adds a Redirects
screen under Settings → Advanced, which is what the third-party Umbraco redirect
packages add over Umbraco's own dashboard: creating and editing a rule, not only
listing and deleting the ones a rename recorded. It offers everything the matcher
supports, and the rules it writes sit between the two above in precedence —
configured rules first, then these, then tracked ones.

It is opt-in twice over. `bun add @crombolo/simple-redirects` puts the screen in
the backoffice, and the endpoints behind it answer only once the site imports the
bundle's server half:

```ts
import { redirects } from '@crombolo/simple-redirects'

export default defineConfig({
  bundles: [redirects()],
})
```

Only a rule added there can be changed there. A configured rule belongs to the
file — the next boot would put a deletion back — and a tracked one belongs to the
page that was renamed, so both are listed and both refuse to be edited.
[`bundles.md`](bundles.md) covers why that split exists.

Three consequences of how these are wired:

- **Page routing wins.** Redirects are matched only once route resolution has
  found nothing, so a rule can sit in config for years without ever hiding a live
  page. Declaring one for a URL that a page occupies is allowed and simply inert
  until the page goes.
- **The database follows the file.** Configured rules are synced into
  `redirect_url` at boot, so the backoffice lists everything in force in one
  place. They are marked as owned by the configuration and the API refuses to
  delete one (409) — the next boot would put it back.
- **Hostnames scope a tracked rule by document, not by name.** A rule recorded
  under a hostname stores the key of the document that hostname roots, so
  changing the hostname leaves every redirect below it working.

In the backoffice this is Umbraco's own **Redirect URL Management** dashboard, the
**Redirects** card in Settings (it was in the Content section until story 237),
plus the redirects listed on each page's Info tab. The
tracker's on/off switch there is read-only, matching Umbraco, which deprecated
the endpoint in v17 and made it a no-op in favour of configuration.

## Source control from the backoffice

Optional, like everything else here. Configured, an editor can see what the
repository is missing and send it, without ever meeting git:

```ts
export default defineConfig({
  git: { provider: gitHub({ repository: 'kineco-au/site', token: process.env.GITHUB_TOKEN }) },
})
```

```
GET  <backoffice>/crombolo/api/git/status    where it would send
GET  <backoffice>/crombolo/api/git/diff      what the repository is missing
POST <backoffice>/crombolo/api/git/commit    send it
```

A pull request by default — a schema change arriving as a PR is reviewable, one
arriving on `main` is not; `pullRequest: false` commits straight to the branch.

Over GitHub's REST API rather than a `git` binary, because the CMS image has no
git and should not grow one, and a shallow clone per diff to compare a handful of
TOML files would be absurd. The commit is built the long way — blobs, a tree, a
commit, then moving a ref — so the whole change lands as one commit, which is what
a reviewer wants, and a partly-applied change is not a state that can happen.
`GitProvider` is the seam; GitHub is the implementation that ships.

## Members and public access

Members are content nodes with a sign-in facet: `node` + `content` +
`content_version` + a `member` row, so member types, properties and versioning
are machinery that already exists. The backoffice manages them through the
contract; the front end signs them in through four endpoints of ours, since
Umbraco has no fixed URLs for this (a site writes a surface controller):

|                                  |                                                     |
| -------------------------------- | --------------------------------------------------- |
| `POST /umbraco/members/login`    | `username`, `password`, `rememberMe?`, `returnUrl?` |
| `POST /umbraco/members/logout`   |                                                     |
| `POST /umbraco/members/register` | off unless `allowMemberRegistration`                |
| `GET /umbraco/members/current`   | the signed-in member, or `401`                      |

A form post is answered with a redirect, a JSON post with JSON, so the same
endpoint serves a plain `<form>` in a template and a `fetch` from the page. A
`returnUrl` must be a local path, which closes the open redirect a login form
would otherwise be.

A session is a signed ticket in a cookie — no server-side session table, so a
load-balanced set needs only the shared signing key (generated once into
`key_value`). The ticket carries the member's security stamp and it is checked on
every request, so changing a password or locking an account ends every session it
had, immediately.

Public access protects a branch by member group or by named member. As Umbraco
does, a protected page is **rewritten** to its login or error page rather than
redirected, so the visitor keeps the URL they asked for; the nearest protected
ancestor governs, and a login page inside the branch it protects still renders.
A template receives the member as a prop:

```tsx
export default function Page({ model, member }) {
    return member ? (
        <Article model={model} />
    ) : (
        <SignInForm returnUrl={model.url} />
    );
}
```

## Signing in through an identity provider

Members and backoffice users can sign in through an OpenID Connect provider
instead of a password (story 031). The two audiences have separate lists, so a
site can sign staff in with Entra and members with AWS:

```ts
import { awsIdentityCenter, defineConfig, entra } from '@crombolo/crombolo'

export default defineConfig({
  backofficeIdentityProviders: [
    entra({
      tenantId: process.env.ENTRA_TENANT_ID!,
      clientId: process.env.ENTRA_CLIENT_ID!,
      clientSecret: process.env.ENTRA_CLIENT_SECRET!,
      emailsVerified: true,
      groups: { map: { '<entra group object id>': 'editor' } },
    }),
  ],
  memberIdentityProviders: [
    awsIdentityCenter({
      issuer: process.env.IDC_ISSUER!,
      clientId: process.env.IDC_CLIENT_ID!,
      clientSecret: process.env.IDC_CLIENT_SECRET!,
      defaultGroups: ['Members'],
    }),
  ],
  allowLocalLogin: false, // staff sign in through Entra only
})
```

**The presets.** `entra({ tenantId, clientId, clientSecret })` knows Entra's
issuer for the tenant, `awsIdentityCenter({ issuer, clientId, clientSecret })`
takes the instance's issuer, and `oidc({ id, name, issuer, clientId, … })`
covers any other provider (Google, Okta, Auth0, Keycloak). They all ask for the
`openid profile email` scopes and read `email`, `name` and, for group mapping,
`groups`. Each one also takes:

| Option | Default | What it does |
| --- | --- | --- |
| `id`, `name` | the preset's | the id in its URLs and in `external_login`; the button text |
| `autoCreate` | `true` | create a member or user for an account nobody has yet |
| `linkByEmail` | `false` | link a first sign-in to an existing account with the same email, if the provider says the email is verified |
| `emailsVerified` | `false` | treat every email from this provider as verified. Entra sends no `email_verified` claim, so set this for a tenant whose emails are your organisation's own |
| `groups` | none | `{ claim?, map }`: claim values mapped to member groups (members) or user group aliases (users), made to match on every sign-in; groups outside the map are left alone |
| `defaultGroups` | none | groups a new account joins |
| `memberType` | `memberRegistrationType` | members only: the type a new member is created as |

A group map can name any user group, administrators included.

**Registering the app.** Give the provider these redirect URLs, with your
site's address (`CROMBOLO_APPLICATION_URL` when it is behind a proxy):

| Audience | Redirect URL |
| --- | --- |
| Members | `https://<site>/umbraco/members/external/<id>/callback` |
| Backoffice | `https://<site>/umbraco/management/api/v1/security/back-office/external/<id>/callback` |

In Entra: an app registration of the web platform, with a client secret. For
group mapping, add the `groups` claim under Token configuration. Its values are
group object ids, which is what the `map` keys are.

**What a sign-in does.**
- The browser leaves with `state`, a `nonce` and a PKCE challenge, carried in a
  short-lived signed cookie. The ID token that comes back is verified with
  `jose` against the provider's published keys: signature, issuer, audience,
  expiry and nonce.
- The account is found by the `external_login` row (provider and subject), so
  a changed email doesn't break it.
- A first sign-in is linked or created as the options say, and a taken email
  is refused rather than merged.
- It ends exactly as a password sign-in does. A member gets the member cookie,
  so protected pages and the Delivery API's app sign-in work unchanged; an app
  can send `identity_provider=UmbracoMembers.<id>` to go straight to the
  provider. A user gets the backoffice session, and the login page shows a
  button per provider. `allowLocalLogin: false` makes those the only way in:
  the password form is hidden, and the password and two-factor sign-in
  endpoints answer 403.
- A member with no password shows as External only in the backoffice. A
  provisioning job creates one through `POST /member` by leaving `password` out
  (story `035`). Such a member cannot use the login form — it refuses them as it
  refuses a wrong password, without counting the attempt, so guesses never lock
  out their provider sign-in — until `PUT /member/{id}` sets a `newPassword`.

For a site's own login form, `externalSignInUrl('<id>', returnUrl)` from
`@crombolo/crombolo` is the link.

**Changing an Entra sign-in without a deploy.** Install `@crombolo/entra` and
add `entraSettings()` to `bundles`. Settings → Advanced → Microsoft Entra then
edits each Entra provider the config declares: tenant, client id and secret,
the sign-in options, group mappings and default groups. A change applies at the
next sign-in on every node, and "Use the code's settings" puts it back. Keeping
a client secret there needs `CROMBOLO_SECRET_KEY` ([`bundles.md`](bundles.md)).

**Locking a provider** (story 305). A provider the back office must not change,
such as one a hosting platform relies on to decide who signs in, is locked:
`locked: true` on `oidc({...})` or `entra({...})`, or, without touching the
site's code, `CROMBOLO_LOCKED_IDENTITY_PROVIDERS` on the server, its ids
separated by commas, or `all`. Either one locks it. A locked provider signs in by
the config alone, ignoring anything stored before it was locked; every change is
refused, naming who locked it; Entra's screen shows it read-only, and "Clear the
changes it ignores" removes what was stored. The boot warns of a locked id the
config does not declare.

**Where a secret goes** (story 305). A client secret kept here is sent only to
the issuer and client id it was set for, and the config's own only to the
config's issuer and client id. Changing the issuer, an Entra tenant or the
client id needs the new secret in the same save ("A new issuer needs its own
secret"); changing them back to the config's drops the kept secret. A provider
that sends somewhere the config did not name with no secret of its own, as an
override from before 0.62 may, signs nobody in until one is set: the sign-in
says it is not available, the boot and the log say why, and the screen asks for
the secret. Every change and reset is audited, with the fields changed and
never a secret.

## Two-factor sign-in

Backoffice users and members can turn on a second factor: an authenticator app
(RFC 6238 — six digits, 30-second steps, which every app reads), with ten
one-time recovery codes for a lost phone. It needs `CROMBOLO_SECRET_KEY`, since
each secret is kept sealed with it; without the key the option is not offered.

**Users** turn it on from their profile (Configure two-factor authentication):
scan the QR code, enter the first code, and keep the recovery codes shown once.
Signing in then asks for a code after the password; a recovery code works in its
place, once. An administrator turns it off for someone from that user's
two-factor settings in Users.

**Members** have no screen of ours; a site builds its own from these endpoints,
which answer JSON:

|                                         |                                                         |
| --------------------------------------- | ------------------------------------------------------- |
| `GET /umbraco/members/2fa`              | `available`, `enabled`, `recoveryCodesLeft`             |
| `POST /umbraco/members/2fa/setup`       | a new `secret`, its `qrCodeSetupImageUrl` and `otpauthUri` |
| `POST /umbraco/members/2fa/enable`      | `secret`, `code` → the `recoveryCodes`, shown once      |
| `POST /umbraco/members/2fa/disable`     | `code`, from the app or a recovery code                 |
| `POST /umbraco/members/login/2fa`       | `code`, `returnUrl?` — the second step of signing in    |

With it on, `POST /umbraco/members/login` does not sign in: a JSON post answers
`{ "twoFactorRequired": true }`, a form post goes back to `returnUrl` with
`memberTwoFactorRequired=1`, and the code goes to `login/2fa` within five
minutes. A wrong code there adds `memberLoginFailed=1`. An administrator turns
it off with the two-factor toggle in the member's workspace.

A code is accepted a step either side of now, for clock drift, and never twice:
the last step used is recorded. A wrong code counts towards lockout as a wrong
password does. Recovery codes are kept as SHA-256 hashes. Turning it on while
it is already on is refused (`ProviderAlreadySetup` for users, `400` for
members), so a signed-in session alone cannot swap in its own app. Moving to
another app means turning it off with a code from the current one or a recovery
code, then on again, which issues new recovery codes.

## A site as a remote

With `CROMBOLO_REMOTE_ACCESS` set, the site answers the remote protocol
([`remote-protocol.md`](remote-protocol.md), story `107`). It is `off` by
default, and each level takes everything the one before it does (story 167):

| `CROMBOLO_REMOTE_ACCESS` | The site takes |
| --- | --- |
| `off` | nothing |
| `read` | pulls |
| `content` | also bundles of content and media, applied and reverted |
| `all` | also whole-site pushes, and bundles that change content types, views, styles or code |

`CROMBOLO_REMOTE_ENABLED`, the switch this replaced, now stops the site
starting and names the new setting. A developer's `crombolo` can then:
- sign in with a code they approve in the back office;
- pull a sealed, anonymised copy of the site;
- apply a bundle there: `crombolo site apply --remote <name>`, with
  `site runs --remote <name>` and `site revert <run> --remote <name>`;
- push the whole site back. A push to a protected environment needs its own
  permission, and with `CROMBOLO_REMOTE_APPROVALS` it waits for someone else
  to approve it.

The permissions are under "Moving whole sites" in a user group. A bundle of
content needs Push, and Push protected as well on a protected environment. A
whole-site push, or a bundle that changes content types, views, styles or code,
also needs "Change a site's structure and code"
(`Crombolo.Remote.ApplyStructure`). Installing a bundle, or a bundle whose code
changes the site's files, needs "Install code on this site"
(`Crombolo.Remote.InstallCode`) too, which administrators hold only when a
group gives it to them (story 241): give it to a group of its own. The health
check "Installing code" names who holds it. People
see the terminals signed in as them under **Signed-in devices** in their
profile, and sign them out there. Each pull and push is a job, so a
load-balanced set needs no stickiness: the job's state is in the database and
its file in the media store. Run `bunx crombolo-remote-conformance <url>
--token <token>` to check a remote against the specification.

From the developer's side (story `108`):

```bash
crombolo remote add production https://example.com   # kept in remotes.toml, committed
crombolo login                                        # a code to approve in the back office
crombolo pull [--full] [--media-info-only | --lazy-media]
crombolo push [--force [--auto-approve]] [--media-info-only]
```

- **`pull`:**
  - In an empty folder it starts the site, as `start --from` does. In a
    folder that holds a site it replaces it, after saying what will be
    recycled; it asks first unless `--yes` is given.
  - The copy is sealed and anonymised unless `--full`. The passphrase is made
    for that one pull and never shown.
- **`push`:**
  - It shows what it would recycle and remove on the remote first.
  - A protected environment needs `--force` and its name typed back
    (`--auto-approve` skips the typing), and the remote may still hold the
    push for someone else's approval.
- **Media by reference:** `--media-info-only` moves media one file at a time,
  only what changed, and `--lazy-media` fetches each file the first time the
  local site is asked for it.
- **Sign-ins** live in the operating system's keychain, never in the folder.
- **Exit codes:** as every command's ([Exit codes](#exit-codes)). The ones a
  pull or push meets most: 3 gave up waiting (the job carries on at the remote;
  `crombolo remote job <id>` watches it again), 4 not signed in or the sign-in
  has lapsed, 7 it would have asked and there is no terminal, 8 the remote
  refused (a permission, a protected environment, an approval declined), 9 the
  remote could not be reached.

### Deploying from CI

A CI job pulls and pushes as a **trust rule** on the site (story 160), proved
by its provider's signed identity token, so there is no password or key to
store in the pipeline.

1. **Add the rule.** An administrator adds it once per site, in **Settings →
   CI access**, or from their own signed-in machine:

   ```bash
   crombolo remote trust add production --name "Deploys" --provider github \
     --repository acme/site --branch main --may push --may push-protected \
     --may apply-structure
   ```

   `push-protected` lets the job change a protected site, such as production,
   with nobody approving it. Leave it out to keep that for people.
   `apply-structure` is what a whole-site push needs on top; a job that only
   applies bundles of content can do without it.
2. **GitHub Actions:** give the job `permissions: id-token: write`, then run
   the CLI as usual:

   ```yaml
   permissions:
     id-token: write
     contents: read
   steps:
     - uses: actions/checkout@v4
     - run: bunx crombolo push production --force --auto-approve
   ```

3. **GitLab CI:** declare an identity token named `CROMBOLO_ID_TOKEN` for the
   site's address:

   ```yaml
   deploy:
     id_tokens:
       CROMBOLO_ID_TOKEN:
         aud: https://example.com
     script:
       - bunx crombolo push production --force --auto-approve
   ```

   A self-managed GitLab is trusted once the site names it:
   `CROMBOLO_REMOTE_OIDC_ISSUERS=https://gitlab.example.com`.

**How it behaves:**
- **Choosing the sign-in:** the CLI uses the job's identity when it has one,
  and a person's `crombolo login` otherwise. It keeps the token in memory
  only.
- **What it may do:** a job's token acts as its rule, which can never approve
  pushes or manage CI access.
- **Revoking:** disabling the rule stops the job at once.
- **One token per GitLab job:** a GitLab job's identity token is exchanged
  once and lasts 15 minutes. A longer GitLab job needs a second job, while
  GitHub asks for a fresh one each time.

## Scripting the command line

Every command takes `-o json` (or the older `--json`): its result is one JSON
document on stdout, and everything else — progress, warnings, questions — goes
to stderr in either mode. Text stays the default when the output is piped, so
nothing that reads it today changes. `crombolo schema` describes every command
for a machine as a [clispec](https://clispec.dev) v0.3 document: its arguments,
whether it changes anything, what it prints, how it fails. `crombolo schema
site apply` narrows it to one. It reads no site, no network and no sign-in.

A command that would ask first refuses at once when there is no terminal, with
`confirmation_required` and the flag that answers it (`--yes`, or `--auto-approve`
for a protected push); it never waits on stdin. `--dry-run` on `extension purge` and
`push` says what would go and changes nothing. `admin reset-password --stdin`
reads the new password from a pipe, so it never sits in shell history.

### A site built from the command line

An empty directory reaches a published, working site without the back office
or an editor (story 180). `tests/integration/hello-world.integration.ts` is the
worked example. CI runs it, one step per test, in this order:

| Step | Command |
| --- | --- |
| Scaffold | `crombolo init --name "Hello"` |
| A page type and its view | `crombolo types new content-type page --at-root` |
| Another property | `crombolo types property add page body --type textarea` |
| Check | `crombolo types check` |
| The home page | `content/pages/home.toml`, then `crombolo site build --check` and `site apply` |
| Publish | `crombolo content publish /Home` |
| An image in a folder | `crombolo media import <dir>`, then `media move` |
| An administrator | `crombolo admin reset-password -o json` |
| Health | `crombolo health` |
| Serve | `crombolo start`, then `GET /` and the back-office sign-in |

A site no server has ever run is a full site. Opening the database (every
command does) and every schema sync link the built-in Folder media type to the
built-in media types the site has, as a server's start does
(`linkMediaFolders`, `packages/server/src/media-folders.ts`, and the end of
`syncSchema`'s transaction). So images go into
folders by `media move` or by a site's content files from the first command. A schema file that
defines Folder is left to say what Folder allows.

### Running a site from the command line

These open the site's database directly rather than going through the server,
so they work when the site will not boot; in a container, run them with `docker
exec`. Each writes an audit entry, and each takes `-o json`.

**People** (story 151) go through the same rules as the Users section:

| Command | What it does |
|---|---|
| `crombolo users list` | everyone, the built-in administrator included: groups, state, last sign-in |
| `crombolo users unlock <who>` | clears a lockout and the failed sign-ins |
| `crombolo users disable <who>` / `enable <who>` | stops someone signing in, ending their sessions, and lets them again |
| `crombolo users reset-password <who> [--stdin]` | a generated password, printed, or one piped in; their sessions end |
| `crombolo users reset-2fa <who>` | removes their second factors, for a lost authenticator |
| `crombolo users invite <email> --group <alias>` | creates the user and prints the link they set a password with, for a site with no e-mail |
| `crombolo api-client rotate [--client <id>]` | a new secret for the seeded API client, printed once; put it in `CROMBOLO_API_CLIENT_SECRET` |

`<who>` is an e-mail address or a username, in any case.

**The running site** (story 152):

- `crombolo index list` shows what each search index holds and what is waiting
  for it. `crombolo index rebuild [InternalIndex|MembersIndex]` indexes
  everything again. The index is in the database, so one rebuild serves every
  node, and search keeps answering meanwhile; `--queue-only` leaves the
  indexing to the running site.
- `crombolo cache rebuild` asks every node to rebuild its published cache. It
  writes a cache instruction, as an editor's save does, stamped as the command
  line so no node passes it over as its own; each node acts at its next poll.
  Only the database has to be reachable.
- `crombolo health [--group <name>]` runs Settings › Health Check, and exits 20
  when a check fails, for a monitor or a deploy to gate on.
- `crombolo recycle-bin empty [--content|--media] [--older-than <days>]`
  deletes what is in the bin for good, media files included, asking first unless
  `--yes`; `--dry-run` lists it. An item's trash date is recorded from 0.16.0
  (migration 042); `--older-than` keeps one trashed before that, and says how
  many it kept.

**Moving, copying, sorting and deleting** (story 165), through the same
operations as the backoffice, as the person at the command line:

| Command | Does |
| --- | --- |
| `crombolo content move <page>… --to <page\|/>` | moves pages and their branches; `/` is the top level |
| `crombolo content copy <page> --to <page\|/> [--descendants]` | a draft copy with a free name, and its branch with `--descendants` |
| `crombolo content sort <parent\|/> <child>…` | the children named first, in that order; the rest keep theirs after them |
| `crombolo content delete <page>…` | to the recycle bin; `recycle-bin empty` deletes for good |
| `crombolo media move <item>… --to <folder\|/>` / `media delete <item>…` | the same for media |

A page is named by its path or its uuid, and a child of `content sort` by its
name under the parent too. Every item is checked before any is written: one
that cannot go where it is asked (a type its new parent does not allow, a page
below itself) stops the lot, and the failure lists each one and why.
`--dry-run` says what would change. Each change is in the audit log under the
operator's name, and a move records the redirects an editor's move would. An
item already where it was asked to go is reported unchanged.

**Content files** (stories 163 and 167): `crombolo site build --check`,
`site apply`, `content export` and `start --bundle .` turn a site's
`content/` directory into content through the import, three-way on every apply
([`bundles.md`](bundles.md#content-files)).

**The audit log** (story 156): `crombolo audit list` pages it newest first,
and `crombolo audit stream [--follow]` ships it as NDJSON to a log store. Both
read without writing, locally or from a hosted site with `--remote`
(`audit-log.md`, "Reading it").

**Media in bulk** (story 153): `crombolo media import <dir> [--under <folder>]`
makes a media folder for each directory and an item for each file, typed by its
extension as an upload is, through the same upload path. Run it again after a
stop: a file already there with the same bytes is skipped, and one whose bytes
differ is reported and left. `--dry-run` says what it would create. `crombolo
media export [<folder>] --out <dir>` writes the files back out as folders.

### Restarting

`crombolo start` supervises the server it starts (story 241). The server runs
as a child process, and a restart is a new child rather than an outage:

1. A new server starts beside the one serving, on the same port (`reusePort`).
   It boots fully before it listens, so it never answers with the page a
   starting site shows.
2. Once it is serving, it takes over. The old one stops listening at once, so
   every new connection reaches the new server, then stops, finishing what it
   was answering first. Both share the port while they overlap, and the kernel
   would otherwise go on handing the old one new connections, so a request made
   just after a restart was reported could be answered by the server it
   replaced.
3. A new server that fails to boot, or is not up within two minutes, is
   stopped. The old one keeps serving, and the failure says why: the last lines
   the new server wrote.

What starts a restart:
- `crombolo restart`, in the site's directory, or `crombolo restart --remote
  <name>` for a remote ([`remote-protocol.md`](remote-protocol.md),
  "Restarting").
- SIGHUP to the `crombolo start` process.

Installing a bundle, or the code a bundle carries, is live after a restart, and
until then `.crombolo/restart-pending.json` says what is waiting. A server that
boots clears it.

The supervisor keeps two files in the site's `.crombolo/`:
- `supervisor.json`: its pid, the serving child's pid, and the port, while it
  runs.
- `restart.json`: when the last restart was, whether it worked, and if not why.

It is the same in development, where a restart also keeps the administrator's
password as it is. SIGINT and SIGTERM stop the supervisor and its server
together, with the exit codes a start had before: a second signal leaves at
once. A server that exits by itself takes the supervisor with it, so a
platform's restart policy still sees a crash. `crombolo pull`, which serves the
site it pulled, does not supervise, so nothing restarts it.

### Plugins

One plugin extends the CLI: `@crombolo/cloud`, for a site hosted on Crombolo
Cloud (story 158). Add it to the site — `bun add -d @crombolo/cloud` — or
install it globally beside the CLI, and its commands appear as `crombolo cloud
…`, in `crombolo --help`, in `crombolo schema` and on the reference page.
Without it nothing changes; `crombolo cloud` alone says how to add it, and
exits 2 as an unknown command does. The CLI's `package.json` names it under
`oclif.optionalPlugins`, and `packages/cli/src/load.ts` looks for it in the
site's `node_modules`, then beside the CLI; no other plugin is loaded.

A plugin is an oclif package whose commands come from `@crombolo/cli/plugin`,
never from the CLI's internal paths:

```ts
import { BaseCommand, Flags, discover, keychain, RemoteClient } from '@crombolo/cli/plugin'

export default class CloudStatus extends BaseCommand {
  static override summary = 'what the platform says about this site'
  static override flags = { url: Flags.string({ required: true }) }
  static override spec = {
    effects: 'read_only',
    cardinality: 'single',
    outputFields: [{ name: 'state', type: 'string' }],
  } as const

  async run() {
    const { flags } = await this.parse(CloudStatus)
    const client = new RemoteClient(await discover(flags.url), keychain())
    // …
    return { state }
  }
}
```

Extending `BaseCommand` gives a command the global `-o json`, the failure
envelope and exit codes (`this.fail(kind, message, hint)`), and its entry in
`crombolo schema`, which needs the `spec`. Its own `package.json` sets
`oclif.commands`, `topicSeparator: " "` and the `cloud` topic. `signIn`,
`discover`, `RemoteClient` and `keychain` are the ones `crombolo login` and
`pull` use, so a sign-in made by either is the other's: a person signs in once.
`tests/fixtures/cloud-plugin` is a working example, used by
`tests/cli-plugin.test.ts` and never shipped.

### Exit codes

A failure exits with its kind's code, and in JSON mode the last line of stderr is
one envelope: `{"kind", "message", "hint"?, "details"?}`. A check that finds what
it was asked to look for exits with an outcome's code instead, with no envelope:
its findings are its output. `packages/cli/src/errors.ts` is this table.

| Code | Kind or outcome | When |
|---|---|---|
| 0 | | it did what was asked |
| 1 | `internal` | something unexpected |
| 2 | `usage` | an unknown command or flag, a missing argument, a bad value |
| 3 | `timeout` | gave up waiting; a remote job carries on (`crombolo remote job <id>`) |
| 4 | `auth` | not signed in, a lapsed sign-in, or a missing or wrong passphrase |
| 5 | `not_found` | no such remote, environment, page, run, bundle, file or account |
| 6 | `conflict` | someone else is changing it, or it exists with a different value |
| 7 | `confirmation_required` | it would have asked, and there is no terminal |
| 8 | `refused` | findings outstanding, a permission, a protected environment |
| 9 | `unavailable` | the database or the remote could not be reached |
| 10 | `io` | a file could not be read or written |
| 20 | outcome `problems_found` | `status`, `types check`, `components check` found problems |
| 21 | outcome `blocked` | `site apply --dry-run`, `upgrade check`: a person must resolve something first |
| 130 | `interrupted` | stopped by a signal |

**Changed in 0.15.0.** Before it, nearly every failure exited 1, a refusal before
sending exited 2, and an unknown command exited 0. A script that tested for 1
should test for non-zero, or for the kind it means. Schema-as-code moved from
`crombolo schema …` to `crombolo types …`; the old names still run, with a
deprecation notice, until the next minor release.

## Is every node serving the latest content?

Each node reports the content checkpoint its published cache serves (story
174; `rendering.md`, "Freshness").

- **`/health`** has a `content` block: `checkpoint` is what the node serves,
  `latest` is the latest committed checkpoint, `behind` says whether the node
  lags, and `builtAt` is when its snapshot was built. These are numbers and
  times only, never content.
- **The Servers health check** lists what each node serves. It warns when a
  node has served older content than the latest for more than a minute.
- **`crombolo cache rebuild`** waits, 30 seconds by default (`--wait`), until
  every node seen in the last minute serves the new checkpoint, and names the
  ones that do not.

Set `CROMBOLO_NODE_ID` to something stable per node. The default,
`host:process`, changes on every restart, so a restarted node shows up as a new
one and the old row lingers until it ages out.

## Notifications about page changes

An editor chooses, in a page's **Notifications**, which of Umbraco's eleven
actions on it they want to hear about: publish, save, create, move, copy,
sort, move to the recycle bin, restore, roll back, public access and
permissions. A subscription covers the pages under it too, as in Umbraco, so
"create" on a section tells you of every new page in it. Story 045.

- **When.** Every page change records an event in its own transaction, with
  the page's name and place as they were (story 171). That covers the
  backoffice, scheduled publishing, approvals, the command line and a
  user-group save that changes a page's permissions. The dispatcher matches
  each event to its subscribers just after the commit. A crash in between
  loses nothing, because the event waits to be dispatched. The person who
  made the change is never told about it. `crombolo events status` shows what
  is waiting, and `crombolo events retry` sends failed work again
  (`webhooks.md`, "Delivery").
- **The outbox.** Each person's notifications wait a minute in
  `content_notification`, so a save and a publish arrive as one e-mail; a
  branch publish is one line, "and 12 pages under it".
- **Sending.** A job on the nodes that run jobs (`all` and `api`) sends every
  15 seconds. Each person's rows are claimed by one node, so a cluster sends
  each e-mail once. Before sending it checks again that the person is still
  enabled, has an e-mail address and can still see the page; a row that fails
  that is skipped with the reason. A provider that refuses is retried with
  backoff, and after five attempts the rows are marked failed with its error.
  A row a node took and never finished (it died) is retried after 15 minutes.
  Sent and skipped rows are pruned after 30 days.
- **The e-mail** is plain text: who did what to which page and when, a link to
  edit it in the back office when `CROMBOLO_APPLICATION_URL` is set, and why
  the reader gets it.
- **Without e-mail** nothing is queued, the dialog says the site can't send
  e-mail and disables its choices, and the API refuses a new subscription;
  clearing one still works.

## Security

The posture is Umbraco's where the contract sets it, and stricter where the
contract says nothing. What is worth knowing as an operator:

| Area                    |                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backoffice sessions     | Reference tokens, stored hashed, in `__Host-` HttpOnly cookies; PKCE is mandatory; a reused refresh token or a replayed code ends the whole session                       |
| `returnUrl`             | Reduced to a local path by `localReturnUrl`, server-side and again in the login page — resolved against an origin, so `/\host` and a tab-smuggled `//host` are caught too |
| Lockout                 | Checked before the password, so a locked account cannot be used to confirm which guess was the real one; a wrong two-factor code counts as a wrong password               |
| Plugin routes           | The endpoints outside the contract answer to the same authority as the operations beside them: Settings for git, schema import and the upgrade findings                    |
| List views              | `collection/document/{id}` and `collection/media` need Read on the parent, so a start node bounds them as it bounds the tree; a child explicitly denied Read is left out of the page and the total |
| Media                   | Content types come from the file name, never from the uploader's header; served with `nosniff` and `Content-Security-Policy: sandbox`, which denies script to SVG and HTML  |
| Member endpoints        | Posts from another origin, a sibling subdomain included, are refused by `isSameOrigin`. These act on a cookie and have no antiforgery token. Registration uses the configured type and a password policy |
| Cookie-signed-in writes | A Management API or plugin-route write signed in by the session cookie must come from this site (`Sec-Fetch-Site`, else `Origin` against the host or `applicationUrl`); a real bearer token is exempt |
| Local login off         | `allowLocalLogin: false` refuses the password and two-factor sign-in endpoints, not only the form                                                                         |
| Preview                 | A draft renders only for an editor who could read the document: the Content section, a start node above it, and Read on it                                                |
| Document patch          | Needs Update on the node, as a save does; paths walk own properties only and refuse `__proto__`, `constructor` and `prototype`                                            |
| Request bodies          | Capped at 32 MiB (`CROMBOLO_MAX_REQUEST_BODY_MB`) rather than Bun's 128 MB default                                                                                        |

Two things follow Umbraco rather than improving on it, deliberately, and are
worth a decision per site:

- **Rich text is not sanitized.** Umbraco's default is `NoopHtmlSanitizer`, and
  `model.html('alias')` renders what an editor stored. A careless or compromised
  editor account is therefore a stored-XSS vector for visitors. Closing this
  properly means choosing a sanitizer, which is a dependency decision rather than
  a default we should pick for a site — link URLs are already scheme-checked, so
  `javascript:` from the link picker does not survive.
- **SVG and HTML may be uploaded** to the media library, as Umbraco's own
  disallow-list allows. The `sandbox` header above is what makes that safe to
  serve; a site wanting them refused outright should narrow the upload settings.

## Behind a CDN

Pages, Delivery API answers and media say how long a browser or a CDN may keep
them, and whether they changed. Story `057`; the policy is
`packages/render/src/cache-policy.ts`.

**Nothing is kept unless the site says so.** Without settings, pages and API
answers carry no lifetime, as before. Three levels, each optional, the narrowest
one set winning:

```ts
// crombolo.config.ts
export default defineConfig({
  cache: {
    maxAge: 60,                 // seconds; 0 keeps nothing
    staleWhileRevalidate: 300,
    types: { newsListing: { maxAge: 10 }, contactPage: { maxAge: 3600 } },
    tagHeader: 'Surrogate-Key', // or Cache-Tag; unset, no tags
  },
})
```

| Level | Where | Applies to |
| --- | --- | --- |
| Site | `cache.maxAge`, `cache.staleWhileRevalidate` — or `CROMBOLO_CACHE_MAX_AGE`, `CROMBOLO_CACHE_STALE_WHILE_REVALIDATE` | pages and API answers |
| Type | `cache.types`, by content or media type alias, in code | that type's pages, API answers and media files |
| Page or media item | "Keep copies for", for a type that composes `cacheFields` (pages) or `mediaCacheFields` (media) | that page or item |

"Keep copies for" offers *Don't keep copies*, *1 minute*, *5 minutes*, *1 hour*
and *1 day*; left empty, the type's or the site's applies. A type opts in as it
does to Search & sharing:

```toml
# schema/content-types/article.toml
compositions = ["seoFields", "cacheFields"]

# schema/media-types/document.toml
compositions = ["mediaCacheFields"]
```

- **A list** — a Delivery API query, `items`, a search — takes the shortest
  lifetime among the pages in it; one that keeps nothing keeps the list from
  being kept.
- **Media files** are `public, max-age=31536000, immutable` unless their item or
  type says otherwise: a replaced file gets a new address, so the bytes at one
  never change. The site's lifetime does not apply to them. *Don't keep copies*
  on an item is for a file that may have to be withdrawn. When the media store
  serves files itself (a bucket or CDN URL), only the redirect carries these
  headers.
- **Nothing personal is kept**, whatever is configured: a page seen by a signed-in
  member, a page in a members-only branch (including the login page a visitor
  sees at its address), a form's answer, a preview, an API answer to a member's
  token or from a non-public API are all `private, no-store`.
- **ETags** on every page and API answer, over the body unless the site
  answers from what was published (below); a matching `If-None-Match` is a
  `304` with no body.
- **Purge tags**, with `tagHeader` set: a page lists its own key and its
  ancestors'; an API answer every page, element and media key in it, and a query
  the page it fetched from; a media file its key. Space-separated for
  `Surrogate-Key`, comma-separated otherwise.

### Keeping and checking: `check`

For a CDN with no purge set up, the recommended setting (story 259):

```ts
// crombolo.config.ts
export default defineConfig({
  cache: { mode: 'check', validator: 'published' }, // or CROMBOLO_CACHE_MODE=check
})
```

Every public page and API answer is then sent
`public, max-age=0, stale-while-revalidate=86400, stale-if-error=604800`:
the CDN serves its copy at once, asks the site in the background whether it
still holds, and keeps serving it for up to a week while the site is down. A
publish is seen at the next check, and a visitor never waits for one.

- **The check costs what the ETag costs.** With `validator: 'published'` it
  is a `304` without rendering (below). With the default, over the body, it
  is a render, so `check` keeps such a copy a minute first
  (`max-age=60`, `cache.checkFloor` or `CROMBOLO_CACHE_CHECK_FLOOR`) and each
  CDN location renders a page at most once a minute. The site says so in
  its log as it starts.
- **Overrides:** `staleWhileRevalidate` (a day) and `staleIfError` (a week),
  at the site or for a type; `maxAge` replaces the `0` or the floor. A
  page's own "Keep copies for" still wins, and *Don't keep copies* still
  sends `no-store`. Private answers stay `private, no-store`.
- **Browsers** get the same header, so a returning visitor's copy is checked
  too, cheaply, and shown while it is. A site that wants the browser to wait
  for the check would add `must-revalidate`; that is not a setting today.
- **When a lifetime is better:** a CDN that purges on publish, through the
  webhook below, can keep copies for long lifetimes and ask the site almost
  never. A page that shows the time is better kept for a short lifetime than
  checked against what was published.
- **Every lifetime** now carries `stale-if-error`, a week unless
  `staleIfError` or `CROMBOLO_CACHE_STALE_IF_ERROR` says otherwise. A site
  that keeps nothing keeps nothing on an error either.

### Checking back instead of purging

A CDN that keeps a copy and checks back with `If-None-Match` is correct with
no purge at all: the site says whether the copy still holds. By default it
finds out by rendering the page and comparing, so a check costs as much as the
page. Story `258` lets a site answer from what was published instead, without
rendering:

```ts
// crombolo.config.ts
export default defineConfig({
  cache: {
    mode: 'check',                  // the CDN checks back each time (above)
    validator: 'published',         // or CROMBOLO_CACHE_VALIDATOR=published
    types: { eventsThisWeek: { validator: 'body' } },
  },
})
```

The ETag is then made from the newest published change, the site's views,
its installed packages, the Crombolo version, and the page and address. Any
publish, unpublish, move, sort, delete, media save, dictionary change, change
to who may see a page, code deploy or upgrade changes every page's ETag, so
menus, listings and breadcrumbs are never left behind. The cost is one render
per page per CDN location after each change, rather than a purge.

- **Only for pages that change with a publish.** A page showing the time, a
  random pick or something fetched from elsewhere would be confirmed until the
  next publish. Give its type `validator: 'body'`, which wins over the site's.
  It is off unless asked for, so nothing changes on upgrade.
- **Delivery API answers** take the same rule, with the query string and the
  headers they vary by in the ETag. An answer holding a form is always over
  its body.
- **Each server remembers** the ETag it last sent for each address and the
  headers that went with it. A check for one it holds is a `304` with the same
  lifetime and purge tags, and a check for one it does not, after a restart or
  on another server, renders once.
- **Who may see a page is still checked**, so a page made members-only is
  never confirmed from the public copy.
- **A check from a signed-in member always renders.** One carrying the
  member cookie (`umbMember<site name>`, `__Host-umbMember<site name>` over
  HTTPS), a preview or a form's answer is rendered as usual.

### Members and a shared cache

A page is the same for a signed-in member as for anyone unless it depends on
them: unless a file it renders mentions `member` (story 263, "Caching,
inferred" in [`rendering.md`](rendering.md)). Such a page carries
`Vary: X-Crombolo-Member`, and every other page carries nothing about members,
so the CDN can share it with everyone. Parts that greet the member are
`'use deferred'` parts, fetched by the browser, private, from
`/crombolo/deferred`.

For that, the CDN sets `X-Crombolo-Member` on each request from whether the
member cookie is present, before it looks for a kept copy:

```vcl
# Fastly / Varnish
set req.http.X-Crombolo-Member = if(req.http.Cookie ~ "umbMember", "1", "0");
```

```js
// a Cloudflare Worker
const member = /umbMember/.test(request.headers.get('cookie') ?? '') ? '1' : '0'
request = new Request(request, { headers: { ...Object.fromEntries(request.headers), 'X-Crombolo-Member': member } })
```

A CDN that cannot set a header should instead pass every request carrying the
member cookie straight through. The answers to members are then always fresh,
and only signed-out visitors share copies. `/crombolo/deferred` is always
`private, no-store`.

### Purging on publish

Not needed when the CDN checks back as above. A purge cuts the time a stale
copy can be served to nothing, at the cost of a hook.

A webhook for `Umbraco.ContentPublish` and `Umbraco.ContentUnpublish` tells the
CDN ([`webhooks.md`](webhooks.md)). Its payload is the page's key; with tags,
purge it and its ancestors, which is every list that could hold it:

```ts
// a bundle's webhook handler, or any receiver
'Umbraco.ContentPublish': async ({ payload, fetch }) => {
  const site = 'https://cms.example.com/crombolo/delivery/api/v2'
  const above = await (await fetch(`${site}/content?fetch=ancestors:${payload.Id}&take=100`)).json()
  await fetch('https://api.cdn.example/purge', {
    method: 'POST',
    body: JSON.stringify({ tags: [payload.Id, ...above.items.map((page) => page.id)] }),
  })
}
```

Without tags, purge everything on publish; with short lifetimes and
`staleWhileRevalidate`, many sites need no purge at all.

## Telemetry

A site can send its traces, metrics and logs to the tool a team already
watches, over OpenTelemetry (story 262). Nothing is sent, and nothing of
OpenTelemetry is loaded, until a collector is named:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp.example.com
OTEL_EXPORTER_OTLP_HEADERS=authorization=Bearer%20…   # usually the API key
OTEL_SERVICE_NAME=riverside-bakery                   # the site's name by default
```

or, in code, `telemetry: { endpoint, serviceName }` in `crombolo.config.ts`,
where the variables win. OpenTelemetry's own variables are honoured as its
specification names them, the per-signal endpoints, `OTEL_EXPORTER_OTLP_PROTOCOL`
(`http/protobuf` by default, or `http/json`), `OTEL_RESOURCE_ATTRIBUTES`,
`OTEL_TRACES_SAMPLER` and its argument, and nothing invented beside them. The
Settings section's System information says where it is sent, as which
service, from which role, and never the headers.

- **Traces:** each request (`GET /{page}`, by route template, with its status
  and the page's content type), its render, each database statement under
  it (operation, table, and the text with placeholders, never a value), a
  Delivery API answer, a background job's run, a webhook's delivery and an
  e-mail sent. A webhook receiver is sent `traceparent`, so it can join the
  trace. Every trace is kept, unless `OTEL_TRACES_SAMPLER` says otherwise:
  `parentbased_traceidratio` with `OTEL_TRACES_SAMPLER_ARG=0.1` keeps a tenth.
- **An incoming trace** is continued only on a request from one of the
  site's trusted proxies, `CROMBOLO_TRUSTED_PROXIES` or `trustedProxies` in
  code, addresses or ranges such as `10.0.0.0/8`. Any other request starts a
  trace of its own, so a visitor cannot choose trace ids or force sampling.
- **Metrics:** `http.server.request.duration` by route, method and status;
  `crombolo.render.duration` by template; `crombolo.published_cache.lookups`,
  hit or miss; `crombolo.job.runs` and `crombolo.job.duration` by job and
  outcome; `crombolo.webhook.deliveries` and `crombolo.webhook.retries`; and
  `crombolo.job.queue.depth`.
- **Logs:** every line the site logs, with the trace and span it was written
  under, which the log file also records as `TraceId` and `SpanId`. A line
  is sent as its template, `Webhook {webhook} failed: {error}`, never with its
  values.
- **Never sent:** a member, an e-mail address, a form's answer, a query
  string's values or a page's content. Attributes are shapes and ids, and a
  test holds every one to an allow-list.
- **Every role sends**, the worker's included, naming its role as
  `crombolo.node.role` and its node as `service.instance.id`, so a trace that
  crosses a page and a job reads as one.
- **A quiet site sends little:** a statement is a span only under a request
  or a job, and the search index's tick and the queue's upkeep, every few
  seconds, are not traced.

### Datadog

Through the Datadog Agent with its OTLP receiver turned on
(`DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT=0.0.0.0:4318`):

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://datadog-agent:4318
OTEL_SERVICE_NAME=riverside-bakery
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production
```

### Grafana Cloud

The stack's OTLP gateway, from its OpenTelemetry tile, with the instance id
and a token as basic authentication:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-2.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 of instance-id:token>
OTEL_SERVICE_NAME=riverside-bakery
```

### A local collector

OpenTelemetry's own collector, printing what arrives, to see it working:

```yaml
# otel-collector.yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
exporters:
  debug:
    verbosity: detailed
service:
  pipelines:
    traces: { receivers: [otlp], exporters: [debug] }
    metrics: { receivers: [otlp], exporters: [debug] }
    logs: { receivers: [otlp], exporters: [debug] }
```

```sh
docker run --rm -p 4318:4318 -v "$PWD/otel-collector.yaml:/etc/otelcol/config.yaml" \
  otel/opentelemetry-collector:latest
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bun start
```

## Running a cluster

A deployed site is run as well as served: backed up, given content, upgraded.
The commands that do it are the `crombolo` binary's, and the same functions are
exported from `@crombolo/cli` — `backup`, `contentCheck`, `contentImport`,
`contentExport`, `upgradePlan`, `upgradeCheck`, `upgradeFix`, `upgradeRun`,
`pauseEditing`, `resumeEditing`, `editingPaused` — taking a resolved config and
returning results as data, for tooling that drives an environment without a
terminal. The `@crombolo/crombolo` umbrella exports `createServer`, for a host process
that needs the server handle rather than only what `Bun.serve` takes.

### Nodes sharing a folder

Nodes can share `components/`, `css/`, `scripts/` and `public/` on one folder, such
as NFS. A change reaches them through the database, not the folder (story 285): a
file watcher sees nothing another machine writes to a network file system.

- **An import or a revert tells every node,** from whichever process ran it: a
  `site apply` or `import` in a cron job or one-off container, the back office,
  or a push. Nothing restarts. A file section the import did not change is not
  mentioned.
- **What a node does:** it takes a new snapshot of its views, hashes its stylesheets
  and scripts again, and lists `public/` again. It hears within its poll, 5 seconds
  or sooner on Postgres.
- **A slow folder.** NFS clients cache listings and file details, usually for up to
  a minute, so a node can be told before it can see the file. It lists `public/`
  again after 5, 15, 30, 60 and 90 seconds to cover that. A mount that caches for
  longer than that, through `acdirmax` or `actimeo`, needs them lowered, or a new
  file stays unseen until a restart or the next import.
- **Writing a file by hand, or syncing one in,** tells nobody. A new `public/` file
  on a network folder stays unseen until a restart or the next import, and a
  changed stylesheet keeps its old `asset()` address, which answers `404`.
- **A node that lost touch** for longer than instructions are kept, a day, sees that
  it missed some and looks at all of these again.
- **If a node could not be told,** the import still succeeds and logs a warning
  saying to restart the nodes or import again.

### A worker for the jobs

A busy site can run its background jobs on a node of their own (story 223), so a
long import or a nightly export never competes with editors' saves or visitors'
pages. Every job is claimed in the database, so the work moves without moving
any data:

| Node | `CROMBOLO_ROLE` | Serves | Needs |
| --- | --- | --- | --- |
| Editors | `api`, with `CROMBOLO_JOBS=off` | the back office and the Management API | Postgres; the media store; e-mail, for invitations |
| Visitors | `web` | the public site and the Delivery API | Postgres; the media store |
| Jobs | `worker` | `/health` alone | Postgres; the media store; e-mail; the site's components, for e-mails |

- **Starting.** `CROMBOLO_ROLE=worker crombolo start`, or `createWorker(config)`
  from `@crombolo/server/worker` in a host process. A worker never migrates or
  seeds, and refuses a database with migrations pending, as a `web` node does:
  `crombolo upgrade` runs them, once. It needs Postgres.
- **What it runs.** Scheduled publishing, the event outbox, webhooks, form
  workflows, notifications, search indexing, the hourly upkeep, and the site's
  and its bundles' own jobs and schedules (story 187). It builds the published
  cache only when a job asks for it, and renders e-mails through the site's
  components. No page, back office or API is mounted; any path but `/health`
  gets a 404 with no body.
- **Leaving jobs to it.** `CROMBOLO_JOBS=off` on the `api` (or `all`) node stops
  that node running them. It still queues them: a save, a route or a named query
  records the work and wakes the worker over Postgres `NOTIFY`, so webhooks and
  search follow a save as quickly as before. The worker also looks every few
  seconds, in case it missed one. `CROMBOLO_JOBS=off` on a `web` or `worker` node
  stops the boot.
- **Its health.** `/health` answers 200 while the worker is current with the
  database. It answers 503 once the database is ahead of it, as an `api` node
  does. It also reports the job it is running and when it last claimed one.
  `crombolo health` gives the troubleshooting report for any node.
- **Stopping and dying.** A worker that is stopped aborts its running job's
  signal and waits ten seconds. If the job hasn't finished by then, the worker
  puts it back in the queue without counting the attempt. A job claimed by a
  worker that stopped answering goes back after two minutes. Either way, the
  next worker to claim it runs it, once.
- **No worker running.** Work queues safely and runs when a worker starts.
  After five minutes with no live worker in `server`, the `api` node:
  - says so in its `/health` (`jobs.waitingSince`), staying 200;
  - shows a warning on Settings → Background jobs;
  - logs one warning.
  Nothing drains, so editors keep working.
- **One worker.** The claims make more than one safe, but more than one worker
  is not what this story tested; run one.

A single process (`all`, the default) runs everything as before. `api` plus
`web` without a worker still runs the jobs on the `api` node.

`crombolo start` loads the server package as a whole, so a worker started from
the command line has the back office's code in memory, though nothing of it is
built or mounted. A host that imports `createWorker` from
`@crombolo/server/worker` loads only what the worker uses.

### Health while the database moves

`/health` is what a load balancer drains on, so what makes it fail is chosen
carefully:

| Node | Behind the database (an upgrade or a schema deploy cut over) | A contract has run past it | Editing paused |
| --- | --- | --- | --- |
| `web` | **200**, `readOnly: true` — its reads are still correct as-of its own state | 503 | 200 |
| `api`, `all` | 503 — editors must land on a node that can save | 503 | 200 |
| `worker` | 503 — it writes, as an `api` node does; its jobs wait for a node that is current | 503 | 200 |

The `web` row is what keeps an upgrade invisible to readers. A new node cannot
boot until the upgrade has run, and every old node falls behind the moment it
does; if old renderers drained then, there would be a window with nothing
healthy to serve. An expand-only change — every minor and patch from 1.0,
since a contract may then only ship in a major (`packaging-and-upgrades.md`) — leaves an
old node's reads correct, so it keeps serving until it is replaced. A
contract (a framework contract, or `types purge`) is ledgered as one, and a
`web` node that is behind drains as soon as it sees one ran after it booted.

### Pausing editing

```
crombolo maintenance pause --reason "restoring Monday's backup"
crombolo maintenance status
crombolo maintenance resume
```

A flag in `key_value`, read by the write gate inside every editor's write
transaction, so it takes effect on every node at once rather than at the next
poll. A refused save is a 409 like any other, naming the reason. Readers are
unaffected and no node drains; `/health` reports `paused` so the backoffice can
say why saves fail. Content imports are not editor writes and are not refused —
which is what lets a restore proceed while editors wait.

### Reading the cluster back

Every node records itself in `server` — its id, schema state and role — at boot
and on each poll. `liveNodes(db, { seenWithinMs })`, exported from the
umbrella, returns the nodes that have polled within a window: which are
answering the public site, which the editor, and on which schema state.

## Documents

|                                                                     |                                                                                                                                         |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [`overview.md`](overview.md)                             | mission, decisions, non-goals, Umbraco→crombolo glossary                                                                                |
| [`architecture.md`](architecture.md)                     | module boundaries, server composition, cross-cutting infrastructure                                                                     |
| [`data-model.md`](data-model.md)                         | schema, naming map, the versioning model, dialect strategy, migrations                                                                  |
| [`api-contract.md`](api-contract.md)                     | routing, response conventions, the document payload, build order                                                                        |
| [`backoffice-hosting.md`](backoffice-hosting.md)         | serving the SPA, import map, the auth contract, boot sequence                                                                           |
| [`rendering.md`](rendering.md)                           | TSX templates, the published-content model, URL routing                                                                                 |
| [`features.md`](features.md)                             | must-have / could-have / out-of-scope inventory                                                                                         |
| [`roadmap.md`](roadmap.md)                               | direction, risks and deliberate divergences                                                                                        |
| [`stories/`](stories/README.md)                          | every piece of work, built and planned, by epic and state                                                                          |
| [`testing.md`](testing.md)                               | test strategy and what story `001` covers                                                                                                   |
| [`schema-as-code.md`](schema-as-code.md)                 | content types, data types and languages as TOML files; sync; the backoffice writes them                                                |
| [`packaging-and-upgrades.md`](packaging-and-upgrades.md) | how a site consumes the framework; migration ledger, `--plan`, expand/contract; the pre-upgrade check and `--fix` that gate the upgrade |
| [`schema-at-runtime.md`](schema-at-runtime.md)           | the shared schema store, importing files at runtime, how the version moves with the change, and getting it back into git                   |
| [`content-transfer.md`](content-transfer.md)             | moving content between environments: the bundle format, what travels and what never does, dependency classification, naming a node         |
| [`remote-protocol.md`](remote-protocol.md)               | the remote protocol: discovery, device sign-in, pulls and pushes as jobs, approvals, media by reference, conformance |
