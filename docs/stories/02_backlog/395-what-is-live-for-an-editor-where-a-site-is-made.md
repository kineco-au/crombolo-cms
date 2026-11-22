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

- **The served copy's mark.** A host records on the making copy which of its changes the
  served copy holds, the newest applied one:
  `PUT <plugin>/api/changes/served { "key": "<change key>" }`, needing Apply changes.
  `GET` returns it. Unset, nothing below applies.
- **Schema is built in a named workspace.** On a site with the mark set, a change to a
  type, data type, template, component, stylesheet or script outside a named workspace
  (in Shared, or in a person's own workspace, `380`) is refused, saying to build schema in
  a workspace. In a named workspace it is seen, as now, by its owner and the people it is
  shared with, and stays open to edit there until it is merged.
- **Merged into Shared and not yet served,** schema stays in the Settings tree and can be
  changed again through a named workspace. It is left out only of what a person's own
  workspace offers for making content: the type for a new page, the templates a page may
  use, and the element and block pickers. Once the mark passes it, it is offered.
- **A named workspace** is offered everything, as now: that work goes out in a release.
- **A page already using something not served** still saves and publishes. The event
  says so (`needs: [...]`), so a host can leave it for the next release and say why.
- **Setting or clearing a schedule** closes the person's open change and raises
  `Crombolo.ChangePublished`, as a publish does. The change carries the schedule, and the
  copy it is applied to fires it at its time.
- **The event says who acted:** a person, or a tool acting for one (an exchanged sign-in
  with an actor, `364`), so a host can pass on only a person's. Its payload names the
  change (`Change: { Key, Name }`) beside the page, so a host need not look it up.
- **A host tells the person how it went,** in the back office's own notifications:
  `POST <plugin>/api/notices { user, message, link? }`, needing Apply changes, shown to that
  user once, as a success or a failure.

## Decisions (2026-11-22)

- **Nothing disappears from whoever is building it.** Hiding schema past the mark from
  the tree would hide a new type from the person who made it until it was served. Schema
  is built in a named workspace instead, where it is theirs and the people's they share it
  with, and the mark limits only what making content offers outside one.

## Acceptance criteria

- [ ] **The mark** is set and read by a caller holding Apply changes, and refused to
      anyone else.
- [ ] **With the mark set,** a schema change outside a named workspace is refused, saying
      to build it in a workspace; in a named workspace it is made and edited as now.
- [ ] **Schema merged into Shared past the mark** stays in the Settings tree, and is not
      offered when making content in a person's own workspace until the mark passes it.
- [ ] **A named workspace** is offered everything.
- [ ] **With no mark,** nothing changes.
- [ ] **A publish of a page using something past the mark** succeeds, and its event names
      what it needs.
- [ ] **Setting a schedule** closes the change and raises the event, and the change's
      bundle carries the schedule.
- [ ] **The event** says whether a person or a tool acting for one made the change, and
      names the change.
- [ ] **A notice** posted for a person shows in their back office once, and is refused
      to a caller without Apply changes.
- [ ] **Tests** on both dialects; `docs/` describes the mark.
