# 370 — `init` writes a guide for agents

**Epic:** Q — A site from the command line · **Priority:** should · **Size:** S
**Depends on:** 352

## Story

As a developer starting a site, I want it to arrive with what a coding agent needs to know,
and with what the host it came from asks of agents, so that the agent's first attempt
follows the rules and I don't explain them each time.

## Context

Agents read `AGENTS.md` first. A site from `crombolo init`, or from a pull into an empty
folder (which starts the site through `init`), has none. The CMS's own rules for agents
(how a site is laid out, schema as files, the checks to run) are the CMS's to write. A
host can have rules of its own, such as where work goes or how to publish, and only it
knows them.

## The design

- **Discovery's optional `agents: { guide: "<https URL>" }`:** a Markdown guide for agents
  working on a site from this remote. `docs/remote-protocol.md` describes it; the
  conformance suite checks it is https when present.
- **`init` writes `AGENTS.md`:**
  - **The CMS's own guide,** between `<!-- crombolo -->` and `<!-- /crombolo -->`:
    - the folders and what each holds;
    - schema as files, and `crombolo schema`;
    - generating types;
    - the checks before a push: `crombolo site build` and `crombolo components check`;
    - where the documentation is.
    It is kept short and versioned with the CLI.
  - **For a pull into an empty folder from a remote that names a guide:**
    - the guide is fetched over https, following no redirect, at most 64 KB, as text;
    - it is written between `<!-- remote:<origin> -->` and `<!-- /remote:<origin> -->`;
    - a guide that can't be fetched is a line in the output, never a failed pull.
- **Never over what the developer wrote:**
  - an existing `AGENTS.md` keeps everything outside the blocks;
  - a block is added or replaced, never anything else;
  - `--no-agents` writes none.
- **`crombolo agents refresh`:**
  - writes the CMS's block again;
  - fetches the guide of each profile the site names (D1), and replaces those blocks;
  - removes a remote's block whose profile is gone or no longer named;
  - `--dry-run` shows the change.
- **`crombolo agents link <profile>` and `unlink <profile>`** change which profiles the
  site names.
- **A guide is data, not instructions to the CLI:** it is written as text and never run.
  The block says where it came from.

## Decisions

- **D1: the site names the profiles it came from.** A pull into an empty folder from a
  profile writes that profile's name, with the origin it had, to `.crombolo/profiles.json`
  (`{ "profiles": [{ "name", "origin" }] }`), the origin so a gone profile's block is found,
  gitignored with the rest of `.crombolo/`, since profile names are each person's own.
  `agents refresh` looks each name up in `~/.crombolo/profiles`, refetches that site's
  guide and replaces its block (marked by origin), and removes a remote block whose
  origin no listed profile names; a listed name with no profile is said and its block
  removed. Blocks of remotes outside the record are left alone, so a teammate's clone
  loses nothing. `crombolo agents link <profile>` and `unlink <profile>` keep the record,
  for a renamed profile or a pull from a bare URL, whose guide is written but kept only
  once a profile is linked. The record moves with the folder, and `~/.crombolo/profiles`
  stays a list of sites.
- **D2 a: the CMS's own discovery advertises a guide from a setting.** `remote.agentsGuide`
  in the config, or `CROMBOLO_REMOTE_AGENTS_GUIDE`, is an https URL that discovery
  passes through as `agents.guide`; anything but https stops the site starting. It is
  the deployer's, like the remote's other settings, not the back office's: a guide kept
  as a page (story 371) is edited there, and its address set here.
- **A guide can't forge a block:** `<!-- crombolo`, `<!-- /crombolo`, `<!-- remote:` and
  `<!-- /remote:` inside a fetched guide are escaped before it is written, so it can't
  close its own block or pass as the CMS's.

## Acceptance criteria

- [x] `init` writes `AGENTS.md` with the CMS's block, and none with `--no-agents`.
- [x] A pull into an empty folder from a remote naming a guide adds its block, and one that
      can't be fetched is skipped with a line.
- [x] An existing `AGENTS.md` keeps every line outside the blocks, through `init`, a pull
      and `agents refresh`.
- [x] `crombolo agents refresh` brings the blocks up to date and removes a gone remote's;
      `agents link` and `unlink` change the profiles it reads.
- [x] Discovery's `agents.guide` is in `docs/remote-protocol.md`, and the conformance
      suite checks its form.

## Out of scope

- Skills or prompts for any one agent product.
- `CLAUDE.md` and other product-specific files. Agents that read them find `AGENTS.md`.

## Built

- **The blocks:** `packages/cli/src/support/agents.ts`: crombolo's guide (`cmsGuide`,
  versioned with the CLI), adding, replacing and removing a block with every other line
  kept, a remote's guide with its markers escaped, `fetchGuide` (https or this machine,
  no redirect, 64 KB read at most, text only) and the site's record of profiles.
- **`init`** writes crombolo's block unless `--no-agents`, and an `AGENTS.md` already in
  the folder no longer makes it refuse.
- **A pull into an empty folder** (`guidesAfterPull`, `site-copy.ts`) writes crombolo's
  block and the remote's guide, a guide that can't be fetched being a line, and records
  the profile; `pull --no-agents` writes none.
- **`crombolo agents refresh|link|unlink`** (`commands/agents/`, `agents-refresh.ts`).
- **The server:** `remote.agentsGuide` / `CROMBOLO_REMOTE_AGENTS_GUIDE`, refused at boot
  unless https (or this machine), named by discovery as `agents.guide`.
- **Conformance:** `agents.guide` is an https address when present.
- **Tests:** `tests/agents-guide.test.ts`.
- **Docs:** `remote-protocol.md`, `building-a-site-from-the-cli.md`, the configuration and
  CLI references and the release notes.

