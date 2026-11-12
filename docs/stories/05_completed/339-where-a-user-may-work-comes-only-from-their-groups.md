# 339 — Where a user may work comes only from their groups

**Epic:** C — The backoffice, end to end · **Priority:** could · **Size:** M
**Depends on:** 338

## Story

As an administrator, I want a user's reach in the site to come from their groups
alone, so that I can tell where someone may work by reading their groups, rather
than working out how their own start nodes combine with the groups'.

## Context

Umbraco gives a user start nodes of their own, for pages, media and library items,
on top of their groups' (`user_start_node`, migration 001). The two are combined
by `combineStartNodes` (`packages/core/src/permissions.ts`): the groups' nodes keep
the topmost, the user's own keep the deepest, and each of the user's replaces any
group node above or below it. Nobody can predict that from the screen, and the
user editor's "Where Mia can work" box and `mayGrantStartNodes` exist only to feed
it. With groups cheap to make, and owners (302) able to run them, a user who needs
a different place belongs in a different group.

Read 2026-11-12: the per-user nodes are read in `UserRepository.access` and
hydrated onto every user; the user editor writes them (`adapters/users.ts`,
`update`, `create`, `calculateStartNodes`); `combineStartNodes` is called from
`access`; the Management API's user contract carries
`documentStartNodeIds`, `hasDocumentRootAccess` and the media and element pairs,
which the vendored user editor shows.

## The design

Planned 2026-11-12. Decided: per-user start nodes are dropped completely, with no
conversion into groups.

Why not convert them: a user's own start nodes do not add to their groups'. They
replace any group start node that overlaps them, so they usually narrow someone
(Editors work everywhere, Mia only under News › Sport). Turning Mia's into an extra
group would widen her to everywhere, because groups combine as a union. Moving her
into a narrowed copy of Editors would keep her reach, but take her out of the
approval stages, owners and group files that name Editors. Neither is a faithful
conversion, so the upgrade drops them and says so.

- **A user's start nodes are their groups' only.** `Principal.startNodes` is
  the groups' union: root if any group has root, else their nodes with any that
  sits below another dropped. `combineStartNodes` and the user's own list go
  (`access.ts:111`, `UserRepository.access`).
- **Migration 076** drops `user_start_node`. Before dropping it, it records each
  user who had start nodes of their own, and what they were:
  - in `upgrade_report`, as a finding the Changes dashboard shows: "Mia Okafor
    worked only under News › Sport; she now works wherever her groups do
    (everywhere). Put her in a group that reaches only there if that was
    meant.";
  - in the audit log.

  A user who had none is untouched.
- **Server:**
  - `mayGrantStartNodes` and the user writes that set start nodes go.
  - `calculateStartNodes` answers the groups' union.
  - The user API keeps its start-node fields (`documentStartNodeIds`,
    `hasDocumentRootAccess`, and the media and element pairs), answered from the
    groups and ignored on write, so the vendored client still loads and saves a
    user.
- **Fork:** the user editor's "Where <name> can work" pickers
  (`user-workspace-assign-access.element.ts`) become read-only text: each place
  the user may work, naming the group it comes from ("News, from Editors;
  everywhere in Media, from Media managers").
- **Group files and bundles** are unaffected: they never carried per-user nodes.
  A site bundle that carries users drops any start nodes on them, with a finding.
- **Release notes:** the upgrade note says users' own start nodes are gone, that
  anyone narrowed by them now reaches what their groups do, and that the Changes
  dashboard names each one.
- **Tests:** the union of group start nodes; the migration's findings and audit
  entries on SQLite and Postgres, with the five rewind places; the user API
  ignoring start nodes on write; a bundle with user start nodes.

## Acceptance criteria

- [x] A user's reach is their groups' union, and `combineStartNodes` is gone.
- [x] The migration drops `user_start_node`, and names each user who had start
      nodes of their own, with what they were and what they now reach, on the
      Changes dashboard and in the audit log.
- [x] The user editor offers no start node picker; its Access box shows where the
      user may work, worked out from their groups.
- [x] The user API answers its own start-node fields as none and ignores them on
      write; calculate-start-nodes answers the groups' union.
- [x] The release notes say the per-user start nodes are gone, that anyone they
      narrowed now reaches what their groups do, and where to see who.

## Implementation

- **Core:** `combineStartNodes` became `unionStartNodes`, the groups' half of
  the old rule. `loadAccess` (`server/src/access.ts`) takes it over the groups'
  start nodes only.
- **Data:**
  - `UserRepository` no longer reads or writes `user_start_node`;
    `UserRecord.startNodes` is always none.
  - `UserUpdate` lost `startNodes`, and `access` lost `userStartNodes`.
  - Migration 076 `DropUserStartNodes` (`user-start-nodes-dropped.ts`) reports
    each user it held (`change_report`, scope `user-start-nodes`) and audits it
    (`StartNodesDropped`), then drops the table.
- **Server:**
  - `mayGrantStartNodes` is gone.
  - A user save ignores start nodes.
  - The user API's start-node fields answer the user's own (none).
  - `calculate-start-nodes` answers the groups' union.
  - Bundles that carry users no longer pass start nodes through.
- **Fork,** commit `c085ee59`: the user screen's Assign Access box keeps only
  Groups. Umbraco's Access box already shows the calculated start nodes, so
  nothing new is drawn.
- **Where it differs from the design:**
  - The API's start-node fields answer "none" rather than the groups' union.
    That is true of the user's own, and the calculated endpoint gives the union.
  - The Access box shows where the user works, but doesn't name the group each
    place comes from.
- **Tests:**
  - `tests/user-start-nodes.test.ts`: migration 076's report, audit and drop.
  - `tests/authorization.test.ts`: the union.
  - `tests/users.test.ts`: saving ignores start nodes, and the calculated
    reach is the groups'.
  - The rewinds in all five places.
