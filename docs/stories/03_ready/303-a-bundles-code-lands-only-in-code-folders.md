# 303 — A bundle's code lands only in code folders

**Epic:** I — Hardening · **Priority:** could · **Size:** S
**Depends on:** —

## Story

As someone who installs a bundle's code, I want it written only where the site keeps
code, so that a bundle never replaces the site's config, its environment file or
anything else that decides how the server runs.

## Context

A bundle's `code/` section is joined to `siteDir` path by path (`planCode`,
`bundle-code-install.ts:52`). Any file under the site can be written, including
`crombolo.config.ts`, `.env`, `bunfig.toml` and `node_modules/`. Doing that already
needs `InstallCode`, which is a grant to run code. But replacing the config or the
environment changes more than code: the settings, the secrets and the database the
server runs with. A reviewer reading the bundle's code wouldn't expect any of that.

## The design

- **Allowed:** `code/` may write under the source folders a site declares, plus
  `package.json` and `bun.lock`. The source folders default to `components/`,
  `routes/`, `actions/`, `queries/`, `jobs/`, `islands/` and `lib/`; a site can add
  its own in config.
- **Refused by name:**
  - the config file (`crombolo.config.*`);
  - `.env*`, `bunfig.toml`, `node_modules/`, `schema/`, the media and data folders;
  - any path with a dot segment, or one that would end up outside `siteDir`.
- **When it is checked:** a bundle carrying a refused path fails the check and the
  install, naming each path, before anything is written.

## Acceptance criteria

- [ ] A bundle whose `code/` carries `crombolo.config.ts`, `.env` or `../x.ts` is
      refused at check and at install, naming each, and nothing is written.
- [ ] `code/components/x.tsx` and `code/package.json` install as now.
- [ ] A source folder added in config is accepted.
- [ ] `bundles.md` lists where code may go.
