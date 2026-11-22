# 395 — What is live, for an editor where a site is made

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 380, 388, 394

## Story

As an editor working on the copy of a site where it is made, I want to see only the types
and templates the served copy has, and my scheduled publishes passed on like any other,
so that what I publish can go live at once.

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
  `GET` returns it. Unset, nothing is hidden.
- **An editor outside a named workspace** (in their own, `380`) is offered only the
  types, data types, templates and components the served copy holds: what changes up to
  the mark carried, and what the site had before its first recorded change. The rest is
  not in the pickers or the tree, in the back office and the Management API.
- **A named workspace** sees everything, as now: that work goes out in a release.
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

## Acceptance criteria

- [ ] **The mark** is set and read by a caller holding Apply changes, and refused to
      anyone else.
- [ ] **An editor in their own workspace** is offered only the types, templates and
      components up to the mark; a named workspace is offered everything.
- [ ] **With no mark,** nothing is hidden.
- [ ] **A publish of a page using something past the mark** succeeds, and its event names
      what it needs.
- [ ] **Setting a schedule** closes the change and raises the event, and the change's
      bundle carries the schedule.
- [ ] **The event** says whether a person or a tool acting for one made the change, and
      names the change.
- [ ] **A notice** posted for a person shows in their back office once, and is refused
      to a caller without Apply changes.
- [ ] **Tests** on both dialects; `docs/` describes the mark.
