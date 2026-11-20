# 388 — Content and schema that arrive only by a change

**Epic:** S — Workspaces and changes · **Priority:** should · **Size:** M
**Depends on:** 383, 391

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

- **`CROMBOLO_CONTENT=locked`** (`content: 'editable' | 'locked'` in the config, unset
  is `editable`) makes read-only, in the back office and through the Management API,
  what a change carries (`381`, `383`): pages, media, the Library, types, data types,
  templates, components, stylesheets and scripts. Locked content implies
  `CROMBOLO_CODE=locked` (`391`).
- **Languages, the dictionary, blueprints, form definitions and workflow set-up stay
  writable** until changes carry them (`392`), which locks them then.
- **Applying a change is the one way in** (`383`), through the remote protocol, by a
  caller holding the new remote permission **Apply changes**, granted to a group or a
  CI token.
- **What stays writable** is what a served site makes for itself: members and their
  groups, form entries, files they upload, redirects it records, its jobs and logs.
- **An item opened in the back office** is shown read-only, with a line saying where it
  is edited and, where the site names an address for that (`content.editedAt`), a link
  to the same item there.
- **Workspaces are off** on such a site (`375`), but for the one made by staging a
  change (`383`), which nobody edits.
- **Each publish on the site where content is made can be passed on.** A publish that
  reaches Shared, straight or from a person's own workspace (`380`), closes the
  person's open change (`381` groups direct edits per person over ten minutes) and
  raises a durable event (`171`) naming it, so a host can apply a finished change to
  the serving copy at once. Their next edit starts a new change.
- **A refused write** says the site takes content by change, in the API's problem
  details and in the back office.

## Decisions (settled 2026-11-20)

- **Lock what changes carry.** The kinds a change does not carry yet stay writable on a
  locked site; `392` makes changes carry them, and they are locked from then.
- **`CROMBOLO_CONTENT=editable|locked`,** the twin of `391`'s `CROMBOLO_CODE`; `391`
  retires `CROMBOLO_CONTENT_MODE`, so it lands first. Locked content implies locked code.
- **A remote permission, Apply changes,** checked by `383`'s apply route; not Install
  code (`336`).
- **A publish closes the publisher's open change,** so the event names a finished one
  and a change is still applied once.
- **The refusal is the workspace scope's** (`375`): the same check that refuses a direct
  write when a workspace is required, with its own reason.

## Acceptance criteria

- [ ] **With `CROMBOLO_CONTENT=locked`,** saving a page, a media item, a Library item, a
      type, a data type or a component is refused, in the back office and the API,
      saying the site takes content by change.
- [ ] **Languages and the dictionary** are still written on a locked site.
- [ ] **A caller without Apply changes** is refused an apply.
- [ ] **Applying a change** still writes.
- [ ] **Members and form entries** are written as before.
- [ ] **An item opened** shows read-only and links to where it is edited.
- [ ] **A publish on the making site** closes the publisher's change and raises an
      event naming it; their next edit is a new change.
- [ ] **With the setting off,** nothing changes.
- [ ] **Tests** on both dialects; `docs/` describes a site made in one place and served
      from another.
