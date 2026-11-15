---
title: Remotes, pull and push
summary: Name the sites you work on, sign in from the terminal, pull a copy down to work on, and push your work back.
order: 7
---

A **remote** is a running crombolo site that your local copy can pull from and push to, named once as a profile. Pulling gives you a working copy of an environment, content and all; pushing replaces an environment with your local site. It works like `git pull` and `git push`, but for a whole site: schema, templates, content and media.

Under the hood it is the same whole-site file described in [Content transfer](/docs/guides/content-transfer/), carried for you over HTTPS under your own sign-in. No environment stores credentials for another.

## Turning it on at the remote

A site answers pulls and pushes only when it is told to. On the site you want to reach, set:

```sh
CROMBOLO_REMOTE_ACCESS=all              # or read, or content; off by default
CROMBOLO_REMOTE_ENVIRONMENT=staging     # what this site calls itself; production by default
CROMBOLO_REMOTE_PROTECTED=false         # true by default: a push needs extra permission
```

| Setting | Default | What it does |
| --- | --- | --- |
| `CROMBOLO_REMOTE_ACCESS` | `off` | what the site takes from elsewhere, below |
| `CROMBOLO_REMOTE_ENVIRONMENT` | `production` | the environment's name, as the command line sees it |
| `CROMBOLO_REMOTE_PROTECTED` | `true` | a push here is a push to a protected environment |
| `CROMBOLO_REMOTE_APPROVALS` | `false` | a push to a protected environment waits for someone else to approve it; needs `CROMBOLO_SECRET_KEY` |
| `CROMBOLO_REMOTE_MAX_UPLOAD_GB` | `50` | the largest file a push may upload |

`CROMBOLO_REMOTE_ACCESS` decides how much the site takes. Each level takes everything the one before it does:

| Level | The site takes |
| --- | --- |
| `off` | nothing |
| `read` | pulls |
| `content` | also bundles of content and media, applied and undone |
| `all` | also whole-site pushes, and bundles that change content types, views, styles or code |

A site that still sets `CROMBOLO_REMOTE_ENABLED` will not start until it is replaced with `CROMBOLO_REMOTE_ACCESS`.

### Who may do what

Six permissions, under **Moving whole sites** on a user group in the back office:

| Permission | Allows |
| --- | --- |
| Pull a copy | download a copy with members and users anonymised |
| Pull a full copy | download a copy that includes members and users |
| Push | apply a bundle of content to an unprotected environment |
| Push to a protected site | the same on a protected environment, and approve or decline other people's pushes to it |
| Change a site's structure and code | push a whole site, or apply a bundle that changes its content types, views, styles or code |
| Install code on this site | install a bundle, or apply one whose code changes the site's files |

A whole-site push needs **Push** and **Change a site's structure and code**, and **Push to a protected site** too on a protected environment.

Administrators have every permission except **Install code on this site**, which only a group that names it gives, to administrators too. Give it to a group of its own, with only the people who deploy code in it.

A pull or push acts as the person who signed in, with that person's permissions, and every one is recorded in the audit log.

## Naming your sites

You name the sites you work on once, in a file of your own, and choose one with `--profile` from any folder:

```sh
bunx crombolo profile add default https://example.com --env production
bunx crombolo profile add staging https://staging.example.com --env staging
bunx crombolo profile add riverside-copy --path ~/dev/riverside-copy
bunx crombolo profile list
```

Each is a **profile**: a running site, by its address, or a site folder on this machine. `profile add` checks that the address really is a crombolo site, or that the folder holds one, before it saves it. They are kept in `~/.crombolo/profiles`, which holds addresses and folders only, never a sign-in. You can edit it yourself; `profile add` and `profile remove` change only the profile they are about, and leave your comments where they are.

```toml
[default]
url = "https://example.com"
environment = "production"

[riverside-copy]
path = "~/dev/riverside-copy"
```

A command that can act on the site in this folder does so unless you name another, so nothing goes to production because you forgot where you were. `site deploy`, `remote trust` and `remote job` always act on a running site, and use the `default` profile when you name none. `CROMBOLO_PROFILE` chooses a profile for a whole shell.

A site that still has a `remotes.toml` in its folder, from an earlier release, has it no longer read: `bunx crombolo profile import` in that folder copies it into your profiles, and once everyone has, it can be deleted.

## Signing in

```sh
bunx crombolo login --profile staging
```

`login` prints a short code and opens a page in the site's back office where you approve it, in a browser where you are already signed in. Your password, two-factor code or identity provider never pass through the terminal. `--no-browser` prints the address instead of opening it, for a machine without one.

The sign-in is kept in your operating system's keychain, never in the site's folder or your profiles, and is refreshed as it runs out. On a machine with no keychain, such as a container, it is kept in `~/.crombolo/credentials`, which only you can read, and `login` says so. `CROMBOLO_CREDENTIALS=keychain` or `file` chooses one. Two profiles for the same site share one sign-in. You can see every terminal signed in as you under **Signed-in devices** in your back-office profile, and sign any of them out there.

```sh
bunx crombolo whoami --profile staging    # who you are there, and what you may do
bunx crombolo logout --profile staging    # sign out, here and at the site
```

## Pulling

```sh
bunx crombolo pull --from staging
```

`pull` copies the site `--from` names, or the `default` profile, over the site in this folder. What it does depends on where you run it:

- **In an empty folder** it creates a new site from the remote and starts it, printing a fresh administrator's password.
- **In a site** it replaces that site with the remote's copy. It says first what will be moved to the recycle bin, and asks before going ahead; `--yes` skips the question.

A pull is sealed and anonymised unless you ask otherwise: members become placeholders, back-office users are left out, and every e-mail address in the content is replaced. `--full` brings the real people, and needs the permission for it.

When a site's media library is large, you choose how its files come down:

| Flag | Media files |
| --- | --- |
| none | downloaded with the site |
| `--media-info-only` | fetched one at a time, and only those that changed since your last pull |
| `--lazy-media` | fetched the first time your local site is asked for each one |
| `--no-media` | left out |

After a lazy pull, `crombolo media fetch` downloads everything that is still missing.

Pulling into a Postgres site replaces its database, so it needs a backup first: `CROMBOLO_PG_DUMP`, or `--backup-taken`.

## Pushing

```sh
bunx crombolo push --to staging --dry-run
bunx crombolo push --to staging
```

`push` replaces the site `--to` names, or the `default` profile, with the site in this folder. It always says first what it would move to the recycle bin and which files it would remove there; `--dry-run` stops at that point. The remote takes a backup where it can, then replaces itself as `crombolo site import --replace` would, so what it loses goes to its recycle bin and its own people are kept.

A push to a protected environment needs two more things: `--force`, and the environment's name typed back to confirm it. In a pipeline, `--auto-approve` skips the typing.

```sh
bunx crombolo push --to production --env live --force --auto-approve
```

If the remote has approvals turned on, the push then waits for someone else with the protected-push permission to approve it in the back office. Nobody can approve their own push, and an approval not given within a day expires.

## Between any two sites

`pull` and `push` are one copy with the sides the other way round, and `--from` and `--to` name either side, a running site or a site folder, so you can copy between two sites from any folder:

```sh
bunx crombolo pull --from production --to riverside-copy
bunx crombolo push --from riverside-copy --to staging
bunx crombolo push --from production --to staging --force
```

| Command | `--from` when left out | `--to` when left out |
| --- | --- | --- |
| `push` | the site in this folder | the `default` profile |
| `pull` | the `default` profile | the site in this folder |

The site being replaced keeps its own rules, however it is reached: a site folder is checked and backed up first, and asked about unless `--yes`; a running site's protection, approvals and your permissions there all hold. Between two running sites, everything passes through your machine, media included. An option that only makes sense for a running site, such as `--force` or `--lazy-media`, is refused for a folder. When both sides are running sites, `--from-env` and `--to-env` say which environment of each; `--env` does when only one is.

## In a pipeline

A CI job names its site with `CROMBOLO_PROFILE_URL`, and `CROMBOLO_PROFILE_ENVIRONMENT` when the site has more than one, alongside its other settings, and signs in with the identity its CI provider gives it, so nothing secret is stored:

```yaml
env:
  CROMBOLO_PROFILE_URL: https://example.com
  CROMBOLO_PROFILE_ENVIRONMENT: production
steps:
  - run: bunx crombolo push --force --auto-approve
```

An administrator trusts the job once, in **Settings → CI access** or with `crombolo remote trust add`.

## Applying a bundle

To change part of a running site rather than replace it, apply a bundle there:

```sh
bunx crombolo site apply ./bundles/campaign --profile staging --dry-run
bunx crombolo site apply ./bundles/campaign --profile staging --publish
bunx crombolo site apply --profile staging --publish     # this site's own content files
```

The remote checks the bundle and applies it as [Content transfer](/docs/guides/content-transfer/) describes. From a site directory it sends the content alone; `--structure` sends its schema, views, styles and code too, which needs the remote at `all` and the structure permission. Every apply is a run there:

```sh
bunx crombolo site runs --profile staging
bunx crombolo site revert 5192ca80-… --profile staging
```

## Deploying a site

`site deploy` sends a site directory as it is committed: its content, structure and code, checked first, then applied, then the remote restarted:

```sh
bunx crombolo extension install @acme/crm --grant content.read   # adds it, granting what it asks for
git commit -am "Add the CRM bundle"
bunx crombolo site deploy --profile production
```

A bundle you have as a file goes the same way: `bunx crombolo extension install ./acme-crm-1.2.0.tgz` copies it into `bundles/` and installs it from there. Commit `bundles/` with `package.json` and `bun.lock`, and the deploy carries it.

It needs the remote at `all`, **Change a site's structure and code** and **Install code on this site**. The code it installs runs once the remote restarts; `--no-restart` leaves that to `crombolo restart --profile production`. If the new server does not start, the old one keeps serving and the deploy prints the `site revert` that undoes it.

## Long transfers

Each pull and push runs as a job at the remote, so a site behind a load balancer needs nothing special. The command line waits for up to 30 minutes by default (`--timeout`, in seconds). If it gives up, the job carries on at the remote, and you can pick it up again with the id it printed:

```sh
bunx crombolo remote job 7c0e2d4a-… --profile staging
```

## In scripts

Every command takes `-o json` and exits with a code a script can branch on. The ones a pull or push meets most often:

| Code | Means |
| --- | --- |
| 0 | done |
| 3 | gave up waiting; the job carries on at the remote |
| 4 | not signed in, or the sign-in has lapsed |
| 7 | it would have asked first, and there is no terminal to ask on |
| 8 | the remote said no: a permission, a protected environment, a declined approval |
| 9 | the remote could not be reached |

The rest are in the [exit codes](/docs/reference/exit-codes/) reference.

## Where next

- [The remote commands](/docs/reference/command-line/remotes/), with every flag
- [Content transfer](/docs/guides/content-transfer/), for moving part of a site rather than all of it
