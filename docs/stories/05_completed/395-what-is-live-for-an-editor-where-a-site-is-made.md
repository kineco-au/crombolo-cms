# 395 — What is live, for an editor where a site is made

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 380, 388, 394

## Story

As an editor working on the copy of a site where it is made, I want to be offered only the
types and templates the served copy has when I make a page, and my scheduled publishes
passed on like any other, so that what I publish can go live at once; and as someone
building schema, I want it to stay in front of me until it is released.

## Context

A site made in one place and served from another (`388`) passes each publish on: the
publish closes the editor's change and raises `Crombolo.ChangePublished`, and a host
applies that change to the served copy (`394`).

Two things get in the way.

- **The making copy can be ahead.** Schema and templates merged there but not yet on
  the served copy are offered to editors, and a page using one cannot be applied until
  they are.
- **A scheduled publish closes nothing.** Setting a schedule saves the page. Its change
  stays open until the editor's next publish, so the served copy never learns of it,
  although a change's bundle already carries a page's schedule.

## The design

- **The served copy's mark.** A host reports to the making copy each change it applies to
  the served copy, pages included:
  `PUT <plugin>/api/changes/served { "key": "<change key>" }`, needing Apply changes, bearer
  only as `394`'s routes. The reports are kept as a set, since pages go out at once and a
  release later, so the served copy holds changes out of order. Schema is served when the
  change that last touched it is reported, or is older than the first report. `GET` returns
  the newest reported change and how many schema changes are not yet reported. With nothing
  reported, nothing below applies.
- **Schema is built in a named workspace.** On a site with the mark set, a change to a
  type, data type, template, component, stylesheet or script outside a named workspace
  (in Shared, or in a person's own workspace, `380`) is refused, saying to build schema in
  a workspace. In a named workspace it is seen, as now, by its owner and the people it is
  shared with, and stays open to edit there until it is merged.
- **Merged into Shared and not yet served,** schema stays in the Settings tree and can be
  changed again through a named workspace. It is left out only of what a person's own
  workspace offers for making content: the type for a new page, the templates a page may
  use, and the element and block pickers. Once the mark passes it, it is offered. Only
  schema the served copy does not have at all is left out: one changed since (a property
  added) is offered as it is now, and a page using it says so in its event.
- **A named workspace** is offered everything, as now: that work goes out in a release.
- **A page already using something not served** still saves and publishes. The event
  says so, so a host can leave it for the next release and say why:
  `needs: [{ key, name, items: [{ kind, alias }] }]`, each unreported change that made or
  last changed the page's type, its template or the element types its blocks use, with
  what it is needed for.
- **Setting or clearing a schedule** closes the person's open change and raises
  `Crombolo.ChangePublished`, as a publish does. The change carries the schedule, and the
  copy it is applied to fires it at its time.
- **The event says who acted:** a person, or a tool acting for one (an exchanged sign-in
  with an actor, `364`), so a host can pass on only a person's. A command-line token or an
  API user counts as the person or account it belongs to. Its payload names the
  change (`Change: { Key, Name }`) beside the page, so a host need not look it up.
- **A host tells the person how it went,** in the back office's own notifications:
  `POST <plugin>/api/notices { user, message, link?, kind: "success" | "failure" }`,
  needing Apply changes, shown to that user once, as a success or a failure. A notice is
  kept until seen: shown at once in a back office they have open, or the next time they
  open one, and dropped unseen after 30 days.

## Decisions (2026-11-22)

- **Nothing disappears from whoever is building it.** Hiding schema past the mark from
  the tree would hide a new type from the person who made it until it was served. Schema
  is built in a named workspace instead, where it is theirs and the people's they share it
  with, and the mark limits only what making content offers outside one.
- **D1 — the host reports each apply.** A single "newest applied" mark breaks when a page
  published after a pending release is applied first: the release would count as served.
  The reports are a set; schema is served when its last change is reported or predates
  the first report.
- **D2 — only schema made past the mark is held back.** A type changed since is offered as
  it is now, so editors keep their everyday types while a release waits; the event's
  `needs` names the change, and the host holds the page.
- **D3 — `needs` names the changes and what each is needed for** (`{ kind, alias }`), so a
  host can tell the person what the page waits on without a lookup.
- **D4 — a tool is an exchanged sign-in with an actor,** only. Command-line tokens and API
  users count as whoever they belong to.
- **D5 — notices are kept until seen,** in a table of their own (a migration), dropped
  unseen after 30 days.
- **The refusal of schema outside a named workspace** is the workspace scope's, as with
  `CROMBOLO_WORKSPACES_REQUIRED`: the back office and the Management API. The command line
  and installed code are not refused; they go out as a release already.

## Acceptance criteria

- [x] **The mark** is set and read by a caller holding Apply changes, and refused to
      anyone else.
- [x] **With the mark set,** a schema change outside a named workspace is refused, saying
      to build it in a workspace; in a named workspace it is made and edited as now.
- [x] **Schema merged into Shared past the mark** stays in the Settings tree, and is not
      offered when making content in a person's own workspace until the mark passes it.
- [x] **A named workspace** is offered everything.
- [x] **With no mark,** nothing changes.
- [x] **A publish of a page using something past the mark** succeeds, and its event names
      what it needs.
- [x] **Setting a schedule** closes the change and raises the event, and the change's
      bundle carries the schedule.
- [x] **The event** says whether a person or a tool acting for one made the change, and
      names the change.
- [x] **A notice** posted for a person shows in their back office once, and is refused
      to a caller without Apply changes.
- [x] **Tests** on both dialects; `docs/` describes the mark.

## Built (2026-11-22)

- **The mark:** migration 091 (`AddServedChanges`): `served_change`, one row per change a
  host reported (`ServedChangeRepository`), and `backoffice_notice`
  (`BackofficeNoticeRepository`). The routes are `served-api.ts`, answered in `server.ts`
  before `394`'s, bearer only, each asking `mayApplyChanges`.
- **What is served:** `served-schema.ts` reads each `schema/content-types/` and
  `components/` file's versions from `change_item`; a version is served when its change was
  reported or began before the oldest reported one. A file whose last creation is not
  served is hidden; every unserved version is pending, for `needs`. Cached per database by
  a fingerprint of the reports and the change items.
- **Refusing and offering:** the router's `scope` in `server.ts` wraps the workspace scope.
  With no workspace or `mine`, a schema write (`isSchemaWrite`) is 409 "Build this in a
  workspace"; `allowed-at-root`, `allowed-children` and `allowed-in-library` lose hidden
  types; with `Crombolo-Purpose: content`, a type's templates and a block editor's blocks
  lose hidden ones (`withoutUnserved`). The back office sends the header outside Settings
  (`workspace-client.js`, `purposeFor`).
- **The event:** `content-events.ts` records a `scheduled` event, and a publish with a
  schedule, as a `schedules/<page>` item of the change (`ChangeRepository.scheduleOf`), then
  closes it; `change` gains `by`, `tool` (from the audit context's exchange actor) and
  `needs`. `webhookPayload` names it as `Change` in both payloads.
- **The schedule travels:** the bundle's page `after.schedule` (`PageSchedule`); staging
  keeps it on the staged change, and `mergeStaged` sets it on Shared once merged, as a merge
  drops a workspace's own schedules.
- **Notices:** `notices.js` takes `notices/mine` as the back office opens and every 15
  seconds, shown with the back office's own notifications; polled rather than pushed, so it
  works whichever node the host posted to.
- **Departures:** a template made through the template API is not recorded as a change (the
  back office writes components as files), so only a component file's change counts. Media
  types are not held back: the story holds back what making a page offers.
- **Tests:** `tests/served-changes.test.ts`, on both dialects.
