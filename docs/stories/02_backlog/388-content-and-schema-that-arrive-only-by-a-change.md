# 388 — Content and schema that arrive only by a change

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 383

## Story

As someone running a site in two places, one where it is made and one where it is
served, I want the serving copy to refuse edits to its pages, media and schema, so that
it only ever holds what was applied to it.

## Context

A change moves from one site to another (`383`), and applying one has to allow for the
target having been edited since. Where a site is made in one place and served from
another, that allowance is the whole difficulty, and it disappears if the serving copy
cannot be edited. Content mode (`343`) already makes a site's schema files read-only;
this is the same idea for everything a change carries.

## The design

- **A setting** (`content.arrivesByChange`) makes read-only, in the back office and
  through the Management API: pages, media, the Library, types, data types, templates,
  components, stylesheets, scripts, languages, the dictionary, blueprints, form
  definitions and workflow set-up.
- **Applying a change is the one way in** (`383`), through the remote protocol, by a
  caller the site trusts to apply.
- **What stays writable** is what a served site makes for itself: members and their
  groups, form entries, files they upload, redirects it records, its jobs and logs.
- **An item opened in the back office** is shown read-only, with a line saying where it
  is edited and, where the site names an address for that (`content.editedAt`), a link
  to the same item there.
- **Workspaces are off** on such a site (`375`), but for the one made by staging a
  change (`383`), which nobody edits.
- **Each publish on the site where content is made can be passed on.** A publish that
  reaches Shared, straight or from a person's own workspace (`380`), raises a durable
  event (`171`) naming the change it made, so a host can apply it to the serving copy
  at once.
- **A refused write** says the site takes content by change, in the API's problem
  details and in the back office.

## Acceptance criteria

- [ ] **With the setting on,** saving a page, a media item, a type or a component is
      refused, in the back office and the API.
- [ ] **Applying a change** still writes.
- [ ] **Members and form entries** are written as before.
- [ ] **An item opened** shows read-only and links to where it is edited.
- [ ] **A publish on the making site** raises an event naming its change.
- [ ] **With the setting off,** nothing changes.
- [ ] **Tests** on both dialects; `docs/` describes a site made in one place and served
      from another.
