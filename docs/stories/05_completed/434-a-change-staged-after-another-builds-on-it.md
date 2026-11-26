# 434 — A change staged after another that made the same page builds on it

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** S
**Depends on:** 383, 394, 421

## Story

As a host passing changes between sites one at a time, I want a change staged into a
workspace after the one that made a page to change that page, so that a run of changes
stages into one workspace as it was made at the source.

## Context

Reported on 0.80.1 by a host's deployment work, which passes changes from site A to site B.
First reported as a staged-then-merged change not being held; corrected by the reporter on
2026-11-26 with the exact calls.

On A, through the Management API with `crombolo-workspace: mine`:

1. `POST /document` makes a page, and `PUT /document/{key}/publish` publishes it.
2. That gives two merges into Shared, a second apart: "Changes by Proof Owner" and
   "Published "Proof page X"".

On B, for each change in order, the host takes A's `GET /changes/{id}/bundle` and sends it to
B's `PUT /changes?stage=true`: the first with no `into`, the second with
`into=<the workspace the first returned>`. No `editable`, no edit between them.

The first stages. The second answers a conflict: "Proof page X is here already under its key,
so it could not be made again." The second bundle carries the page as made, though the first
change in the same workspace already made it.

The reporter's promotion and publish sign-offs wait on it (2026-11-26).

### Findings (2026-11-26)

- `stagePage` (`server/src/change-transfer.ts`) already looks in the workspace first
  (story 421), so a page an earlier staged change made should be found and changed, not
  made again. Either it is not found there, or the duplicate is raised by a later step
  (publishing it, placing it among its siblings) and worded as "here already".
- That wording is chosen for any unique or duplicate error while staging a page, so it may
  not name the real step.
- Why the publish's change carries the page as made is worth knowing too: a publish passed
  on from a person's own workspace (397) may record the page as new when the page's first
  merge left it unpublished.

- **Not reproduced yet (2026-11-26, on the code after 0.80.1, SQLite and Postgres):** a page
  made and published in an own workspace through the Management API, the own workspace then
  merged, gives three changes (an edit, "Published", "Changes by ..."). Staged one after
  another into one workspace with `into`, oldest first or as `GET /changes` lists them, all
  three stage with no conflict. So the reporter's sites differ in something these tests do
  not have: an API user's token rather than a signed-in person, B holding the page already,
  or a page with a parent or a different type. Ask the reporter for both bundles.

## Acceptance criteria

- [x] A test reproduces the report before anything is changed: two changes from a person's
      own workspace on one site, the page made then published, staged one after the other
      into one workspace on another, the second with `into`.
- [x] The second change stages, changing the page the first made; merging the workspace
      gives the page published, and both changes are held.
- [x] The same two changes sent with `PUT /changes` one after the other, without staging,
      apply as they do today.
- [x] A change that really makes a page already in Shared under its key is still refused,
      and a duplicate raised elsewhere while staging names what failed rather than "here
      already".
- [x] Tests on SQLite and Postgres; the release notes.

## The cause (2026-11-26)

Reproduced on Postgres with the reporter's error. A type made in a workspace has its node
row in Shared and is marked on `content_type.workspace_id`; staging's type lookup
(`typeKeyHere`) and story 403's check (`lackingIn`) read the node's column, so took a type
another workspace had staged for the site's own. A page staged elsewhere was made with it,
and that workspace's discard then failed on Postgres (`content_content_type_id_fkey`) and
rolled back, leaving it open and holding its pages' keys, so every later stage of them was
"here already". Keys unique across the site make one open workspace block another: story
436, decided with this one, lets each workspace make its own.

## What was built

- `change-transfer.ts`: types looked up on their type row; a page whose type is in neither
  the site nor its workspace is 403's conflict; a change's types are built before its pages;
  a page another open workspace is making is a conflict naming it (`makingElsewhere`); a
  staging failure names its step (`StagingStep`), "here already" only for making it.
- `WorkspaceRepository.discard` deletes the workspace's pages before its schema, and
  `typesUsedElsewhere` refuses a discard, from the route and the idle sweep, naming what
  uses its types (`usedElsewhereWords`, `workspaces.ts`).
- Tests: `change-transfer.test.ts` (the report, a type staged elsewhere, the same page in
  two workspaces), `workspace-schema-api.test.ts` (a type and a page of it discarded),
  `workspaces-api.test.ts` (Shared is never discarded).
